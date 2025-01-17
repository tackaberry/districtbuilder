#
# Auto Scaling resources
#
data "template_cloudinit_config" "container_instance_cloud_config" {
  gzip          = true
  base64_encode = true

  part {
    content_type = "text/cloud-config"
    content = templatefile("${path.module}/cloud-config/base-container-instance.yml.tmpl", {
      ecs_cluster_name = aws_ecs_cluster.app.name,

      # I graphed the memory usage of the container vs. the number of memory map
      # areas the process consumed after we set vm.max_map_count to an
      # arbitrarily high value. The line of best fit is f(x) = 2997.2x and has
      # an R^2 of 0.9017. The root-mean-square deviation is 3736, and the
      # largest difference between prediction vs. reality is 4791. Setting the
      # intercept to 8 * 1024 appears to give us an adequate safety margin.
      #
      # Also, this method of determining a value for vm.max_map_count is only
      # efficient if the container's memory usage equals the total memory of
      # the host. So, there will always be a huge margin, but I feel that it's
      # better than choosing an arbitrary constant.
      #
      # See: doc/DistrictBuilder_Memory_Usage_vs_Memory_Map_Areas.xlsx
      #
      # Edit 3-17-2022, doubled map count to account for new cache architecture
      vm_max_map_count = local.container_instance_app_memory * 6 + (8 * 1024)
    })
  }
}

# Pull the image ID for the latest Amazon ECS-optimized Amazon Linux 2 AMI
# https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-optimized_AMI.html#al2ami
data "aws_ssm_parameter" "ecs_image_id" {
  name = "/aws/service/ecs/optimized-ami/amazon-linux-2/recommended/image_id"
}

data "aws_ami" "ecs_ami" {
  owners = ["self", "amazon", "aws-marketplace"]

  filter {
    name   = "image-id"
    values = [data.aws_ssm_parameter.ecs_image_id.value]
  }
}

resource "aws_launch_template" "container_instance" {
  block_device_mappings {
    device_name = data.aws_ami.ecs_ami.root_device_name

    ebs {
      volume_type = var.container_instance_root_block_device_type
      volume_size = var.container_instance_root_block_device_size
    }
  }

  credit_specification {
    cpu_credits = "standard"
  }

  disable_api_termination = false

  name_prefix = "lt${title(var.environment)}ContainerInstance-"

  iam_instance_profile {
    name = aws_iam_instance_profile.ecs_container_instance_role.name
  }

  image_id = data.aws_ami.ecs_ami.image_id

  instance_initiated_shutdown_behavior = "terminate"
  instance_type                        = var.container_instance_type
  key_name                             = var.aws_key_name
  vpc_security_group_ids               = [aws_security_group.app.id]
  user_data                            = data.template_cloudinit_config.container_instance_cloud_config.rendered

  monitoring {
    enabled = true
  }
}

locals {
  # Increase the size of the ASG to `ASG Minimums * 2 + 1` during every deploy.
  # This doubles the capacity of the ASG to allow the new version of tasks to come
  # online. The + 1 should be taken out of service immediately, where as it will
  # take 10 minutes for the next instance.
  container_instance_asg_override_desired_capacity = var.container_instance_app_desired_count * 2 + 1
  container_instance_asg_min_size                  = var.container_instance_app_desired_count
  container_instance_asg_max_size                  = var.container_instance_app_desired_count * 2 + 1
}

resource "aws_autoscaling_group" "container_instance" {
  lifecycle {
    create_before_destroy = true
  }

  name = "asg${title(var.environment)}ContainerInstance"

  launch_template {
    id      = aws_launch_template.container_instance.id
    version = "$Latest"
  }

  health_check_grace_period = var.container_instance_asg_health_check_grace_period
  health_check_type         = "EC2"
  desired_capacity          = local.container_instance_asg_override_desired_capacity
  termination_policies      = ["OldestLaunchConfiguration", "Default"]
  min_size                  = local.container_instance_asg_min_size
  max_size                  = local.container_instance_asg_max_size
  enabled_metrics = [
    "GroupMinSize",
    "GroupMaxSize",
    "GroupDesiredCapacity",
    "GroupInServiceInstances",
    "GroupPendingInstances",
    "GroupStandbyInstances",
    "GroupTerminatingInstances",
    "GroupTotalInstances",
  ]
  vpc_zone_identifier = module.vpc.private_subnet_ids

  tag {
    key                 = "Name"
    value               = "ContainerInstance"
    propagate_at_launch = true
  }

  tag {
    key                 = "Project"
    value               = var.project
    propagate_at_launch = true
  }

  tag {
    key                 = "Environment"
    value               = var.environment
    propagate_at_launch = true
  }
}

resource "aws_cloudwatch_metric_alarm" "cpu_reservation" {
  alarm_name          = "alarm${title(var.environment)}CPUReservation"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "CPUReservation"
  namespace           = "AWS/ECS"
  period              = 600
  statistic           = "Average"
  threshold           = 100

  dimensions = {
    ClusterName = aws_ecs_cluster.app.name
  }

  alarm_actions = [aws_autoscaling_policy.container_instance_cpu_reservation.arn]
}

resource "aws_autoscaling_policy" "container_instance_cpu_reservation" {
  name                   = "asgScalingPolicy${title(var.environment)}CPUReservation"
  adjustment_type        = "ChangeInCapacity"
  autoscaling_group_name = aws_autoscaling_group.container_instance.name
  policy_type            = "SimpleScaling"

  scaling_adjustment = -1
  cooldown           = local.app_health_check_grace_period_seconds
}

#
# ECS resources
#
data "aws_ec2_instance_type" "container_instance" {
  instance_type = var.container_instance_type
}

locals {
  # CPU units allocation at the task level cannot exceed 10 vCPUs.
  # https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html#task_size
  container_instance_app_cpu = min(var.container_instance_app_cpu, 10240)

  # We reserve 4 GB of memory for the ECS container agent and other critical
  # system processes. I observed that an r5.2xlarge running zero tasks used
  # approximately 3.52 GB of memory. Although we could reserve this at the ECS
  # container agent level, we still need to define a memory limit for the task
  # that fits within the available memory on the instance.
  # https://docs.aws.amazon.com/AmazonECS/latest/developerguide/memory-management.html
  container_instance_app_memory = data.aws_ec2_instance_type.container_instance.memory_size - var.container_instance_reserved_memory
}

resource "aws_ecs_task_definition" "app_container_instance" {
  family                   = "${var.environment}App_EC2LaunchType"
  network_mode             = "awsvpc"
  requires_compatibilities = ["EC2"]
  # These are hard limits of CPU units and memory, specified at the task level.
  # https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html#task_size
  cpu    = local.container_instance_app_cpu
  memory = local.container_instance_app_memory

  container_definitions = templatefile("${path.module}/task-definitions/app.json.tmpl", merge(
    local.shared_app_task_def_template_vars,
    {
      max_old_space_size = floor(local.container_instance_app_memory * var.max_old_space_size_scale_factor)
    }
  ))

  tags = {
    Name        = "${var.environment}App_EC2LaunchType",
    Project     = var.project
    Environment = var.environment
  }
}

resource "aws_ecs_service" "app_container_instance" {
  name            = "${var.environment}App_EC2LaunchType"
  cluster         = aws_ecs_cluster.app.name
  task_definition = aws_ecs_task_definition.app_container_instance.arn

  desired_count                      = var.container_instance_app_desired_count
  deployment_minimum_healthy_percent = var.container_instance_app_deployment_min_percent
  deployment_maximum_percent         = var.container_instance_app_deployment_max_percent

  health_check_grace_period_seconds = local.app_health_check_grace_period_seconds

  launch_type = "EC2"

  network_configuration {
    security_groups = [aws_security_group.app.id]
    subnets         = module.vpc.private_subnet_ids
  }

  ordered_placement_strategy {
    type  = "spread"
    field = "attribute:ecs.availability-zone"
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "app"
    container_port   = var.app_port
  }

  depends_on = [
    aws_lb_listener.app,
  ]
}

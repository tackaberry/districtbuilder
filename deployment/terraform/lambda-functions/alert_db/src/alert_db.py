import json
import logging
import os

import requests

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
ch = logging.StreamHandler()
logger.addHandler(ch)

ENVIRONMENT = os.getenv("ENVIRONMENT", "Staging")
SLACK_BOT_WEBHOOK = os.getenv("SLACK_BOT_WEBHOOK")
APP_NAME = "districtbuilder"
SERVER_NAME = "DatabaseServer"

DB_ALARM_NAMES = [
    f"alarm{ENVIRONMENT}{SERVER_NAME}CPUUtilization-"
    f"{APP_NAME}-{ENVIRONMENT.lower()}",
    f"alarm{ENVIRONMENT}{SERVER_NAME}DiskQueueDepth-"
    f"{APP_NAME}-{ENVIRONMENT.lower()}",
    f"alarm{ENVIRONMENT}{SERVER_NAME}FreeableMemory-"
    f"{APP_NAME}-{ENVIRONMENT.lower()}",
    f"alarm{ENVIRONMENT}{SERVER_NAME}FreeStorageSpace-"
    f"{APP_NAME}-{ENVIRONMENT.lower()}",
]


def handler(event, context):
    if SLACK_BOT_WEBHOOK is not None:
        for record in event["Records"]:
            sns = record["Sns"]
            message = json.loads(sns["Message"])
            alarm_name = message["AlarmName"]
            new_state = message['NewStateValue']
            reason = message['NewStateReason']

            if alarm_name in DB_ALARM_NAMES:
                slack_message = {
                    "text": f":alert::alert::alert: {alarm_name} state is "
                    f" now {new_state}: {reason}\n"
                    f"```\n{message}```"
                }
                slack_message = {
                    "text": f":white_check_mark: {alarm_name} has recovered"
                    if new_state.lower() == "ok"
                    else f":alert::alert::alert: {alarm_name} state is "
                    f" now {new_state}: {reason}\n"
                    f"```\n{message}```"
                }
                logger.info(
                    json.dumps({
                        "alarm_name": alarm_name.lower(),
                        "action": "Sending message to Slack",
                        "message": slack_message
                    })
                )
                post_to_slack_resp = requests.post(
                    SLACK_BOT_WEBHOOK,
                    json.dumps(slack_message).encode('utf-8')
                )
                try:
                    post_to_slack_resp.raise_for_status()
                except Exception as e:
                    print("Response content:\n{}".format(
                        post_to_slack_resp.content))
                    raise e

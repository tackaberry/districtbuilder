import { Logger } from "@nestjs/common";
import { readFileSync } from "fs";
import _ from "lodash";
import os from "os";
import Queue from "promise-queue";
import { spawn, Worker, Thread, ModuleThread } from "threads";
import { TaskRunFunction } from "threads/dist/master/pool-types";
import { IStaticMetadata, DistrictsDefinition } from "../../shared/entities";
import { NUM_WORKERS } from "./common/constants";
import { formatBytes } from "./common/functions";
import { RegionConfig } from "./region-configs/entities/region-config.entity";
import { Functions, MergeArgs } from "./worker";

// Timeout after which we kill/recreate the worker thread
const TASK_TIMEOUT_MS = 90_000;

// Reserve about 50% of memory for responding to requests and loading topology data from disk
// Remaining amount is split amongst each worker for topology data
// This strategy seems to work for any amount of host memory and targets total memory
// in use maxing out at around 80%
const dockerMemLimit = Number(
  readFileSync("/sys/fs/cgroup/memory/memory.limit_in_bytes", { encoding: "ascii" })
);
const hostmem = os.totalmem();
const totalmem = Math.min(hostmem, dockerMemLimit);
// Targets:
// 3Gb of cache for 12Gb total (dev)
// 13Gb of cache for 31Gb total (32Gb instance w/ ~1Gb for ECS agent)
// 28Gb of cache for 63Gb total (64Gb instance w/ ~1Gb ECS agent)
export const cacheSize = totalmem * 0.5 - 3 * 1024 * 1024 * 1024;
const maxWorkerCacheSize = Math.ceil(cacheSize / NUM_WORKERS);

const logger = new Logger("worker-pool");
logger.debug({
  dockerMemLimit: formatBytes(dockerMemLimit),
  hostmem: formatBytes(hostmem),
  maxCacheSize: formatBytes(maxWorkerCacheSize)
});

// Implementing our own queuing system instead of using threads Pool in order to handle errors
// and thread termination with more precision
const workers: Array<Promise<ModuleThread<Functions> | undefined>> = [...Array(NUM_WORKERS)].map(
  () => Promise.resolve(undefined)
);
const timeouts: Array<NodeJS.Timeout | undefined> = [...Array(NUM_WORKERS)].fill(undefined);

// Track region size & worker size so we can kill/recreate workers when they exceed a maximum size
const workerSizes = [...Array(NUM_WORKERS)].map(() => 0);

// Each queue controls access to a specific worker thread, which runs one task at a time
const workerQueues = [...Array(NUM_WORKERS)].map(() => new Queue(1));

type WorkerThread = ModuleThread<Functions>;

// Not that important to limit small regions, but large regions in every worker will eat up our cache
const MAX_PER_REGION = Math.ceil(NUM_WORKERS / 2);

// Not specific to a worker thread, this controls access to queueing new tasks onto threads
const taskRunnerQueue = new Queue(1);

// We need to terminate workers cleanly when running the test suite
export async function terminatePool() {
  const workerThreads = await Promise.all(workers);
  return Promise.all(workerThreads.map(worker => worker && Thread.terminate(worker)));
}

function getSettledQueues(workerQueues: Queue[], indexes: number[]) {
  return indexes.filter(
    i => workerQueues[i].getPendingLength() === 0 && workerQueues[i].getQueueLength() === 0
  );
}

// Keep track of which regions have been routed to which workers, in order of recency
// We'll try to reroute back to those same workers later to re-use the workers cached data
let workersByRegion: { [id: string]: number[] } = {};
let workersByRecency: number[] = [];

async function findQueue(regionConfig: RegionConfig): Promise<number> {
  const workerLacksRegion = (worker: number) =>
    !workersByRegion[regionConfig.id] || !workersByRegion[regionConfig.id].includes(worker);

  const availableWorkerIndexes = [...workerQueues.keys()].filter(workerLacksRegion);
  const lastUsed = workersByRegion[regionConfig.id] || [];

  const lastUsedSettled = getSettledQueues(workerQueues, lastUsed);
  const settledQueues = getSettledQueues(workerQueues, availableWorkerIndexes);
  const size = regionConfig.layerSizeInBytes;

  // Choose our next index by size
  const willFit = (worker: number) => workerSizes[worker] + size < maxWorkerCacheSize;
  const getBestFit = (workers: number[]) =>
    _.minBy(workers.filter(willFit), idx => maxWorkerCacheSize - (workerSizes[idx] + size));

  const workerToUse: number =
    // First check for available workers that were used for this region, get most recent
    (lastUsedSettled.length > 0
      ? lastUsedSettled[0]
      : // If there are settled queues that will fit use those first
      lastUsed.length < MAX_PER_REGION && settledQueues.some(willFit)
      ? getBestFit(settledQueues)
      : // If there are unsettled queues that will fit, we'd rather block until they're ready
      // than be forced to terminate a thread to make room
      lastUsed.length < MAX_PER_REGION && availableWorkerIndexes.some(willFit)
      ? getBestFit(availableWorkerIndexes)
      : // If nothing will fit use the least recently used worker, which wil get terminated
      lastUsed.length < MAX_PER_REGION
      ? // eslint-disable-next-line functional/immutable-data
        workersByRecency.pop()
      : // If there are no settled workers and we hit the limit on adding more, use the most recent for this region
        lastUsed[0]) || 0;

  // If this region wasn't already in this workers cache, update the worker size
  // This may trigger recreating the worker thread if we would exceed the max size
  if (workerLacksRegion(workerToUse)) {
    if (workerSizes[workerToUse] + size > maxWorkerCacheSize) {
      await createWorker(workerToUse, "OoM");
      // eslint-disable-next-line functional/immutable-data
      workerSizes[workerToUse] = 0;
      workersByRegion = _.mapValues(workersByRegion, workers =>
        workers.filter(w => w !== workerToUse)
      );
    }
    // eslint-disable-next-line functional/immutable-data
    workerSizes[workerToUse] += size;
  }
  // Move this worker to the top of the list of workers for this region/overall
  // eslint-disable-next-line functional/immutable-data
  workersByRegion[regionConfig.id] = [
    workerToUse,
    ...lastUsed.filter(worker => worker != workerToUse)
  ];
  workersByRecency = [workerToUse, ...workersByRecency.filter(worker => worker != workerToUse)];

  return workerToUse;
}

function createWorker(index: number, cause = ""): Promise<WorkerThread> {
  terminateWorker(index, cause);
  const worker = spawn<Functions>(new Worker("./worker", { workerData: { index } }));
  // eslint-disable-next-line functional/immutable-data
  workers[index] = worker;
  workers[index]
    .then(() => {
      logger.debug(`Created worker ${index}`);
    })
    .catch(e => {
      logger.error(`Failed to create worker ${index}: ${JSON.stringify(e)}`);
    });
  return worker;
}

function terminateWorker(index: number, cause: string) {
  void workers[index].then(worker => {
    // If a worker times out or errors, or reaches its max cache size, we replace it
    if (worker) {
      logger.log(
        `Terminating worker ${index} due to ${cause}, worker sizes: ${workerSizes
          .map((size, idx) => `${idx}: ${formatBytes(size)}`)
          .join(`, `)}, total rss: ${formatBytes(process.memoryUsage().rss)}`
      );
      void Thread.terminate(worker);
    }
  });
}

function clearQueueTimeout(index: number) {
  // Clear the timeout so we don't run the cleanup function
  const timeout = timeouts[index];
  timeout && clearTimeout(timeout);
  // eslint-disable-next-line functional/immutable-data
  timeouts[index] = undefined;
}

async function queueWithTimeout<R>(
  regionConfig: RegionConfig,
  cb: TaskRunFunction<WorkerThread, R>,
  timeout = TASK_TIMEOUT_MS
) {
  // This function is run within a queue and encompasses finding a worker queue and running a task.
  //
  // Without this queuing to limit concurrency, I encountered problems limiting regions to a
  // max number of workers, due to race conditions when finding settled workers
  return new Promise<R>(resolve => {
    void taskRunnerQueue.add(async () => {
      const workerIndex = await findQueue(regionConfig);
      const task = workerQueues[workerIndex].add(() =>
        workers[workerIndex].then(worker =>
          // If we haven't created the worker yet, do so now
          worker ? cb(worker) : createWorker(workerIndex).then(cb)
        )
      );
      resolve(
        new Promise((resolve, reject) => {
          // Clear pre-existing timeouts if we're adding a new one before cleanup could happen
          clearQueueTimeout(workerIndex);
          if (timeout) {
            // eslint-disable-next-line functional/immutable-data
            timeouts[workerIndex] = setTimeout(() => {
              terminateWorker(workerIndex, "timeout");
              reject();
            }, timeout);
          }
          task
            .then(worker => {
              // Clear out any timeouts after the task completes
              clearQueueTimeout(workerIndex);
              resolve(worker);
            })
            .catch(error => {
              terminateWorker(workerIndex, "error");
              reject(error);
            });
        })
      );
    });
  });
}

export const merge = (args: MergeArgs) =>
  queueWithTimeout(args.regionConfig, worker => worker.merge(args));

export const importFromCSV = (
  staticMetadata: IStaticMetadata,
  regionConfig: RegionConfig,
  blockToDistricts: {
    readonly [block: string]: number;
  }
) =>
  queueWithTimeout(regionConfig, worker =>
    worker.importFromCSV(staticMetadata, regionConfig, blockToDistricts)
  );

export const exportToCSV = (
  staticMetadata: IStaticMetadata,
  regionConfig: RegionConfig,
  districtsDefinition: DistrictsDefinition
) =>
  queueWithTimeout(regionConfig, worker =>
    worker.exportToCSV(staticMetadata, regionConfig, districtsDefinition)
  );

export const getTopologyProperties = (
  regionConfig: RegionConfig,
  staticMetadata: IStaticMetadata,
  timeout?: number
) =>
  queueWithTimeout(
    regionConfig,
    worker => worker.getTopologyProperties(regionConfig, staticMetadata),
    timeout
  );

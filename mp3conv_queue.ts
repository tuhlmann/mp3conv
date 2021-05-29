import { parse } from "https://deno.land/std/flags/mod.ts";
import { resolve } from "https://deno.land/std/path/mod.ts";
import { existsSync, walk, WalkEntry } from "https://deno.land/std/fs/mod.ts";

/*
This is an old implementation using a queue to communicate the files for conversion
between the producer and the consumer.
*/

const VideoExtension = ".mp4";
const AudioExtension = ".mp3";

const MaxConcurrentProcesses = 1;

// TODO: define correct generic type
const PROCESS_QUEUE: Array<ProcessQueueEntry> = [];
let PROMISE_QUEUE: Array<QueryablePromise<string>> = [];

interface ProcessQueueEntry {
  entry: WalkEntry;
  mp3Filename: string;
  command: Deno.RunOptions;
}

function getMp3Filename(entry: WalkEntry) {
  const pos = entry.path.lastIndexOf(".");
  const name = entry.path.substr(0, pos > 0 ? pos : entry.path.length) +
    AudioExtension;
  return name;
}

function existsProcessQueueEntry(entry: WalkEntry) {
  return PROCESS_QUEUE.some((v) => v.entry.path === entry.path);
}

function addToProcessQueue(entry: ProcessQueueEntry) {
  console.log(`Add to queue conversion of ${entry.entry.name}`);

  PROCESS_QUEUE.push(entry);
}

function processQueuedCommand(
  entry: ProcessQueueEntry,
): QueryablePromise<string> {
  const promise = new Promise<string>((resolve, reject) => {
    const cmd = Deno.run(entry.command);
    cmd.status().then(
      (ok) => {
        if (ok.code === 0) {
          console.log(
            `Created audio file ${entry.mp3Filename}`,
          );
          resolve(entry.mp3Filename);
        } else {
          reject(entry.mp3Filename);
        }
      },
      (err) => {
        console.log(`Error converting file ${entry.entry.name}: ${err}`);
        reject(entry.mp3Filename);
      },
    ).finally(() => {
      cmd.output().then((_) => {});
      cmd.stderrOutput().then((_) => {});
      cmd.close();
    });
  });
  return new QueryablePromise(promise);
}

async function processQueueEntry() {
  if (PROMISE_QUEUE.length < MaxConcurrentProcesses && PROCESS_QUEUE.length) {
    const entry = PROCESS_QUEUE.pop();
    if (entry) {
      PROMISE_QUEUE.push(processQueuedCommand(entry));
    }
  } else {
    await Promise.any(PROMISE_QUEUE.map((p) => p.promise));
    PROMISE_QUEUE = PROMISE_QUEUE.filter((p) => !p.isFulfilled());
  }
}

/**
 * Check the PROCESS_QUEUE:
 *   - take X elements, start them.
 *   - when one is finished, replenish
 *   - when all are finished, return
 */
async function processQueue() {
  let allFilesProcessed = false;
  do {
    if (PROCESS_QUEUE.length) {
      await processQueueEntry();
    } else {
      allFilesProcessed = true;
    }
  } while (!allFilesProcessed);
}

async function walkDirectory(path: string): Promise<void> {
  // TODO: Why is every file entry shown twice?
  for await (const entry of walk(path)) {
    //console.log(`Looking at ${entry.path}`);
    if (
      entry.isFile && entry.name.endsWith(VideoExtension) &&
      !existsSync(getMp3Filename(entry)) && !existsProcessQueueEntry(entry)
    ) {
      const mp3File = getMp3Filename(entry);
      addToProcessQueue({
        entry,
        mp3Filename: mp3File,
        command: {
          cmd: [
            "ffmpeg",
            "-i",
            entry.path,
            "-vn",
            "-ar",
            "48000",
            "-b:a",
            "137K",
            mp3File,
          ],
          stdout: "piped",
          stderr: "piped",
        },
      });
    } else if (entry.isDirectory && entry.path !== path) {
      console.log("Process directory " + entry.path);

      await walkDirectory(entry.path);
    }
  }
}

async function main(args: string[]) {
  const {
    _: [dir = "."],
  } = parse(args);

  const dirFullPath = resolve(Deno.cwd(), String(dir));

  console.log("Process directory " + dirFullPath);
  // TODO: remove await here, but make sure there are already entries processed before we check the queue
  await walkDirectory(dirFullPath);

  console.log(`Processing ${PROCESS_QUEUE.length} files...`);

  await processQueue();

  await Promise.all(PROMISE_QUEUE.map((p) => p.promise));
  console.log("All files processed");
}

if (import.meta.main) {
  main(Deno.args);
}

/// UTILITY CODE

class QueryablePromise<T> {
  _isResolved: boolean;
  _isRejected: boolean;

  readonly promise: Promise<T>;

  constructor(promise: Promise<T>) {
    this.promise = promise;
    this._isRejected = false;
    this._isResolved = false;
    promise.then(
      (v) => {
        this._isResolved = true;
        return v;
      },
      (e) => {
        this._isRejected = true;
        throw e;
      },
    );
  }

  isFulfilled() {
    return this._isResolved || this._isRejected;
  }

  isResolved() {
    return this._isResolved;
  }

  isRejected() {
    return this._isRejected;
  }
}

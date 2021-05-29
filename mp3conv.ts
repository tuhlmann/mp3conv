import { parse } from "https://deno.land/std/flags/mod.ts";
import { resolve } from "https://deno.land/std/path/mod.ts";
import { existsSync, walk, WalkEntry } from "https://deno.land/std/fs/mod.ts";
import { QueryablePromise } from "./queryable_promise.ts";

/*
This implementation uses an async generator function to provide convertables
that are pulled (requested) by the consumer.
*/

class FileConversionSource {
  private readonly VideoExtension = ".mp4";
  private readonly AudioExtension = ".mp3";

  readonly basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  private getMp3Filename(entry: WalkEntry) {
    const pos = entry.path.lastIndexOf(".");
    const name = entry.path.substr(0, pos > 0 ? pos : entry.path.length) +
      this.AudioExtension;
    return name;
  }

  async *walkDirectory(
    path: string = this.basePath,
  ): AsyncGenerator<ProcessQueueEntry> {
    // TODO: Why is every file entry shown twice?
    for await (const entry of walk(path)) {
      //console.log(`Looking at ${entry.path}`);
      if (
        entry.isFile && entry.name.endsWith(this.VideoExtension) &&
        !existsSync(
          this.getMp3Filename(entry),
        )
      ) {
        const mp3File = this.getMp3Filename(entry);
        yield ({
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

        // return await this.walkDirectory(entry.path);
      }
    }
  }
}

class AudioConverter {
  private readonly MaxConcurrentProcesses = 6;

  private PROMISE_QUEUE: Array<QueryablePromise<string>> = [];

  private processQueuedCommand(
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

  async processFile(entry: ProcessQueueEntry) {
    if (this.PROMISE_QUEUE.length < this.MaxConcurrentProcesses) {
      this.PROMISE_QUEUE.push(this.processQueuedCommand(entry));
    } else {
      await Promise.any(this.PROMISE_QUEUE.map((p) => p.promise));
      this.PROMISE_QUEUE = this.PROMISE_QUEUE.filter((p) => !p.isFulfilled());
      this.processFile(entry);
    }
  }

  async allFinished() {
    await Promise.all(this.PROMISE_QUEUE.map((p) => p.promise));
  }
}

interface ProcessQueueEntry {
  entry: WalkEntry;
  mp3Filename: string;
  command: Deno.RunOptions;
}

async function main(args: string[]) {
  const {
    _: [dir = "."],
  } = parse(args);

  const dirFullPath = resolve(Deno.cwd(), String(dir));

  console.log("Process directory " + dirFullPath);

  const fileProducer = new FileConversionSource(dirFullPath);
  const converter = new AudioConverter();

  const fileProducerIterator = fileProducer.walkDirectory();

  /**
   * Pull entries that need conversion and start as many concurrent converters as configured
   */
  for await (const entry of fileProducerIterator) {
    // console.log("Converting entry " + entry.entry.name);
    await converter.processFile(entry);
  }

  await converter.allFinished();
  console.log("All files processed");
}

if (import.meta.main) {
  await main(Deno.args);
}

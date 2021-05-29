# Mp3conv
Concurrently extract audio from video files in a directory tree.

## What

I was downloading a playlist of videos from Vimeo and structuring them in a directory tree. To have them available as audio files for listening on the go I wanted to create an mp3 file alongside the existing mp4. I also wanted to play around with Deno (https://deno.land), hence this little project. It's pretty crude and would need some enhancement to make it more useful, but maybe the code here can help anyone as it is already.

## How

To run the application you need to have a recent and working Deno installation. Head over to https://deno.land/#installation to grab the install for your system.

You also need `ffmpeg` installed and in your path, which should be the case on a standard Linux distribution.

Running this script is pretty straight forward. Suppose the tree with mp4 video files is in `/home/sam/Video`, then cd into the directory where you downloaded this script to and issue this command:

```bash
deno run -A --unstable mp3conv.ts /home/sam/Video
```

Mp3Conv will now walk the given directory and all sub directories recursively and find all video files with extension `.mp4`. It will then check if there is already an audio file with the same name but the `mp3` extension next to it. If so, it will skip this file. If not, it will run ffmpeg to convert it. It will run multiple converters concurrently, the number of which is configurable. 

Please note that the video file is only read, it's not deleted or otherwise altered. At least, it should not :)

If your files are on a local or fast usb disk you can start multiple converters. I tested with 24 on my Ryzen 12 core machine and it worked fine and fast. If your files are read (and written) to a network volume, you may configure the number of concurrent processes to just one, because reading and writing over network is usually much slower than the conversion itself.

## Configuration

Open the script file and play around with the following settings:

- `MaxConcurrentProcesses` - number of concurrently started converters. Set to `1` for single conversion, set as high as your CPU, memory, SSD, etc. can handle.
- `VideoExtension` - the extension by which video files are searched, '.mp4' by default
- `AudioExtension `- the extension by which audio files are searched, '.mp3' by default

In addition to that, the following `ffmpeg` command is stitched together:

```bash
ffmpeg -i <videofile> -vn -ar 48000 -b:a 137K <audiofile>
```

Change the command line params to your liking.



## Technical Details

I wanted to practice the use of the producer / consumer pattern in Javascript. I've done this in Scala, Go or Clojure, but Javascript is a bit different in that it doesn't have parallel threads (it as worker threads now, I know). 

However, generators can be viewed as semi-coroutines (https://en.wikipedia.org/wiki/Coroutine#Comparison_with_generators), so I wanted to test that.

I created a class `FileConversionSource` that wraps all the code needed to walk the directory tree, find video files, see if the audio already exists, etc. This one wraps an async generator `*walkDirectory`, that can be viewed from the outside as an async iterator, that will return new valid entries until all entries are found and then returns. That means, we can simply iterate over the found entries by:

```typescript
const fileProducer = new FileConversionSource(dirFullPath);
const converter = new AudioConverter();
const fileProducerIterator = fileProducer.walkDirectory();

for await (const entry of fileProducerIterator) {
  await converter.processFile(entry);
}
```

Each found entry is handed over to the `AudioConverter` for processing. The `AudioConverter` keeps a list of all currently running processes. If the list if full (has reached `MaxConcurrentProcesses` in length) it will wait until one process finishes and then start this new conversion process.

After all converter processes have started we leave the `for` loop and then wait on this line:

```typescript
await converter.allFinished();
```

It's just calling a `Promise.all()` on the array of running processes.

Because Javascripts promises don't come with a flag to check if they are finished or not I wrapped them in a `QueryablePromise` class (I found similar code online and modified it a bit for Typescript and to be used for class composition instead of extending Promise itself).



## Further Information About Generators

- https://medium.com/front-end-weekly/modern-javascript-and-asynchronous-programming-generators-yield-vs-async-await-550275cbe433
- https://exploringjs.com/es6/ch_generators.html
- https://thecodebarbarian.com/async-generator-functions-in-javascript.html

# Things to Improve

- make video and audio file extension configurable through command line switches
- configure number of concurrent converter processes
- ability to add an output path that would mirror the input directory tree and contain all the created audio files.
- Configure `ffmpeg` through the command line.



# Disclaimer

This is provided as is. Feel free to use the code for purposes legal in your country, don't do illegal stuff with it!

Also, I can't be held accountable for anything that goes wrong, where the script will somehow mess up your video files or anything else!


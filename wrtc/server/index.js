const { Command } = require('commander');

const wrtc = require('wrtc');
const Peer = require('simple-peer');

const ws = require('ws');
const net = require('net');

const tmp = require('tmp');
const path = require('path')
const fs = require('fs')

const FFmpeg = require('fluent-ffmpeg');

const Chunker = require('./chunker');


const program = new Command();
program
  .option('-i, --input <path or url>', 'ffmpeg input path or url')
  .option('-f, --ffmpeg_path <path>', 'ffmpeg executable binary path')
  .option('-w, --width <pixel>', 'ffmpeg input path', 960)
  .option('-h, --height <pixel>', 'ffmpeg input path', 540)
  .option('-s, --sample_rate <freq>', 'ffmpeg sample rate', 48000)
  .option('-c, --audio_channel <ch>', 'ffmpeg audio channel', 2)
  .option('-w, --signaling_port <ch>', 'signaling port', 9000)
  .option('-a, --accel <name>', 'hardware decoding');

program.parse(process.argv);
const options = program.opts();

const width = Number.parseInt(options.width) || 960;
const height = Number.parseInt(options.height) || 540;
const sampleRate = Number.parseInt(options.sample_rate) || 48000;
const audioChannels = Number.parseInt(options.audio_channel) || 2;

const server = new ws.Server({
  port: Number.parseInt(options.signaling_port) || 9000
});

const videoChunker = new Chunker(width * height * 1.5); // YUV420
const audioChunker = new Chunker(2 * audioChannels * sampleRate / 100);
videoChunker.on('data', () => {});
audioChunker.on('data', () => {});


const videoSocketPath = path.resolve(path.basename(`${tmp.tmpNameSync()}.unix`));
const audioSocketPath = path.resolve(path.basename(`${tmp.tmpNameSync()}.unix`));
const videoServer = net.createServer((socket) => { socket.pipe(videoChunker); })
const audioServer = net.createServer((socket) => { socket.pipe(audioChunker); })
try { fs.unlinkSync(videoSocketPath); } catch (error) {}
try { fs.unlinkSync(audioSocketPath); } catch (error) {}
videoServer.listen(videoSocketPath);
audioServer.listen(audioSocketPath);


const ffmpeg = FFmpeg(options.ffmpeg_path);
if (options.input == null || options.input === '-' || options.input === 'pipe:0') {
  ffmpeg.input(process.stdin)
} else {
  ffmpeg.input(options.input);
}
ffmpeg
  .inputOptions([
    `-re`,
    `-analyzeduration 500000`,
    `-fflags nobuffer`,
    `-max_delay 250000`,
    `-threads 0`,
    `-hwaccel ${options.accel || 'none'}`
  ])
  .output(`unix://${videoSocketPath}`)
  .outputOptions([
    `-map 0:v:0`,
    `-f rawvideo`,
    `-c:v rawvideo`,
    `-s ${width}x${height}`,
    `-pix_fmt yuv420p`,
  ])
  .output(`unix://${audioSocketPath}`)
  .outputOptions([
    `-map 0:a:0`,
    `-f s16le`,
    `-c:a pcm_s16le`,
    `-ar ${sampleRate}`,
    `-ac ${audioChannels}`,
  ])
  .on('end', () => { process.exit(0); })
  .run()

process.on("exit", () => {
  ffmpeg.kill();
  try { fs.unlinkSync(videoSocketPath); } catch (error) {}
  try { fs.unlinkSync(audioSocketPath); } catch (error) {}
})
process.on("SIGINT", () => { process.exit(0); });

server.on('connection', (socket) => {
  const audio = new wrtc.nonstandard.RTCAudioSource();
  const audioTrack = audio.createTrack();
  const audioListener = (chunk) => {
    audio.onData({
      samples: new Int16Array(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.length)),
      sampleRate,
      channelCount: audioChannels
    });
  };
  audioChunker.on('data', audioListener);

  const video = new wrtc.nonstandard.RTCVideoSource();
  const videoTrack = video.createTrack();
  const videoListener = (chunk) => {
    video.onFrame({
      width,
      height,
      data: new Uint8ClampedArray(chunk)
    });
  };
  videoChunker.on('data', videoListener);

  const peer = new Peer({ initiator: false, wrtc, stream: new wrtc.MediaStream([videoTrack, audioTrack]), config: { iceServers: []} });
  socket.on('message', (data) => {
    peer.signal(data);
  });
  peer.on('signal', (data) => {
    socket.send(JSON.stringify(data));
  });

  socket.on('close', () => {
    peer.destroy()
    audioTrack.stop()
    videoTrack.stop()
    audioChunker.removeListener('data', audioListener);
    videoChunker.removeListener('data', videoListener);
  })
})

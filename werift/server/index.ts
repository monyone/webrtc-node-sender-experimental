import {
  MediaStreamTrack,
  RTCPeerConnection,
  RTCRtpCodecParameters,
  RtpPacket,
} from "werift";
import { Server } from "ws";
import { createSocket } from "dgram";

const server = new Server({ port: 9000 });
const videoServer = createSocket("udp4");
videoServer.bind(5000);
const audioServer = createSocket("udp4");
audioServer.bind(5002);

server.on("connection", async (socket) => {
  const pc = new RTCPeerConnection({
    codecs: {
      video: [
        new RTCRtpCodecParameters({
          mimeType: "video/H264",
          clockRate: 90000,
          rtcpFeedback: [
            { type: "ccm", parameter: "fir" },
            { type: "nack" },
            { type: "nack", parameter: "pli" },
            { type: "goog-remb" },
          ],
        }),
      ],
      audio: [
        new RTCRtpCodecParameters({
          mimeType: "audio/opus",
          clockRate: 48000,
          channels: 2
        }),
      ]
    },
  });

  const videoTrack = new MediaStreamTrack({ kind: "video" });
  const audioTrack = new MediaStreamTrack({ kind: "audio" });
  pc.addTrack(videoTrack);
  pc.addTrack(audioTrack);

  pc.connectionStateChange
    .watch((state) => state === "connected")
    .then(() => {
      videoServer.on("message", (data) => {
        videoTrack.writeRtp(data);
      });
      audioServer.on("message", (data) => {
        audioTrack.writeRtp(data);
      });
    });

  await pc.setLocalDescription(await pc.createOffer());
  const sdp = JSON.stringify(pc.localDescription);
  socket.send(sdp);

  socket.on("message", (data: any) => {
    const msg = JSON.parse(data);
    if (msg.sdp) {
      pc.setRemoteDescription(msg);
    } else if (msg.candidate) {
      pc.addIceCandidate(msg);
    }
  });
});


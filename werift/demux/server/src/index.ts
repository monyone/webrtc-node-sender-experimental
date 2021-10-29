import {
  MediaStreamTrack,
  RTCPeerConnection,
  RTCRtpCodecParameters,
  RtpPacket,
} from "werift";
import { Server } from "ws";
import { createSocket } from "dgram";

import {
  TSPacket,
  TSPacketQueue,
  TSSection,
  TSSectionQueue,
  TSPES,
  TSPESQueue,
 } from 'arib-mpeg2ts-parser';
import { Writable }  from 'stream';

import { EventEmitter } from 'events';

import { generateRTPHeader } from './rtp';
import { generateH264RTPPayloads } from './h264'
import { generateAACRTPPayloads } from './aac'
import { generateOpusRTPPayloads } from './opus'

const emitter: EventEmitter = new EventEmitter();

class TSPESExtractor extends Writable {
  private packetQueue: TSPacketQueue = new TSPacketQueue();

  private pmtPid: number | null = null;
  private avcPid: number | null = null;
  private aacPid: number | null = null;
  private opusPid: number | null = null;

  private avcSequenceNumber: number = 0;
  private aacSequenceNumber: number = 0;
  private opusSequenceNumber: number = 0;

  private patSectionQueue: TSSectionQueue = new TSSectionQueue();
  private pmtSectionQueue: TSSectionQueue = new TSSectionQueue();
  private avcPESQueue: TSPESQueue = new TSPESQueue();
  private aacPESQueue: TSPESQueue = new TSPESQueue();
  private opusPESQueue: TSPESQueue = new TSPESQueue();

  _write(chunk: Buffer, encoding: 'binary', callback: (error?: Error | null) => void): void {
    this.packetQueue.push(chunk);

    while (!this.packetQueue.isEmpty()) {
      const packet: Buffer = this.packetQueue.pop()!;
      const pid: number = TSPacket.pid(packet);

      if (pid === 0x00) { // PAT
        this.patSectionQueue.push(packet)
        while (!this.patSectionQueue.isEmpty()) { 
          const PAT = this.patSectionQueue.pop()!;
          if (TSSection.CRC32(PAT) != 0) { continue; }

          let begin = TSSection.EXTENDED_HEADER_SIZE;
          while (begin < TSSection.BASIC_HEADER_SIZE + TSSection.section_length(PAT) - TSSection.CRC_SIZE) {
            const program_number = (PAT[begin + 0] << 8) | PAT[begin + 1];
            const program_map_PID = ((PAT[begin + 2] & 0x1F) << 8) | PAT[begin + 3];
            if (program_map_PID === 0x10) { begin += 4; continue; } // NIT

            if (this.pmtPid == null) {
              this.pmtPid = program_map_PID;
            }

            begin += 4;
          }
        }
      } else if (pid === this.pmtPid) {
        this.pmtSectionQueue.push(packet)
        while (!this.pmtSectionQueue.isEmpty()) {
          const PMT = this.pmtSectionQueue.pop()!;
          if (TSSection.CRC32(PMT) != 0) { continue; }

          const program_info_length = ((PMT[TSSection.EXTENDED_HEADER_SIZE + 2] & 0x0F) << 8) | PMT[TSSection.EXTENDED_HEADER_SIZE + 3];
          let begin = TSSection.EXTENDED_HEADER_SIZE + 4 + program_info_length;

          while (begin < TSSection.BASIC_HEADER_SIZE + TSSection.section_length(PMT) - TSSection.CRC_SIZE) {
            const stream_type = PMT[begin + 0];
            const elementary_PID = ((PMT[begin + 1] & 0x1F) << 8) | PMT[begin + 2];
            const ES_info_length = ((PMT[begin + 3] & 0x0F) << 8) | PMT[begin + 4];

            if (stream_type === 0x1B) { // AVC1
              this.avcPid = elementary_PID;
            } else if(stream_type === 0x0F) { // AAC
              this.aacPid = elementary_PID;
            } else if(stream_type === 0x06) {
              for (let descriptor = begin + 5; descriptor < begin + 5 + ES_info_length; ) {
                const descriptor_tag = PMT[descriptor + 0];
                const descriptor_length = PMT[descriptor + 1];

                if (descriptor_tag === 0x05) {
                   const base = descriptor + 2;
                   const decoded = PMT.slice(base, base + descriptor_length).toString('ascii');
                   if (decoded === 'Opus') {
                     this.opusPid = elementary_PID;
                   }
                }

                descriptor += 2 + descriptor_length;
              }
            }

            begin += 5 + ES_info_length;
          }
        }
      } else if (pid === this.avcPid) {
        this.avcPESQueue.push(packet);
        while (!this.avcPESQueue.isEmpty()) {
          const AVC: Buffer = this.avcPESQueue.pop()!;

          let pts = 0;
          pts *= (1 << 3); pts += ((AVC[TSPES.PES_HEADER_SIZE + 3 + 0] & 0x0E) >> 1);
          pts *= (1 << 8); pts += ((AVC[TSPES.PES_HEADER_SIZE + 3 + 1] & 0xFF) >> 0);
          pts *= (1 << 7); pts += ((AVC[TSPES.PES_HEADER_SIZE + 3 + 2] & 0xFE) >> 1);
          pts *= (1 << 8); pts += ((AVC[TSPES.PES_HEADER_SIZE + 3 + 3] & 0xFF) >> 0);
          pts *= (1 << 7); pts += ((AVC[TSPES.PES_HEADER_SIZE + 3 + 4] & 0xFE) >> 1);

          const PES_header_data_length = AVC[TSPES.PES_HEADER_SIZE + 2];
          let begin = TSPES.PES_HEADER_SIZE + 3 + PES_header_data_length;
          let prev: number | null = null;
          while (begin < AVC.length) {
            if (begin + 2 >= AVC.length) { break; }

            if (AVC[begin + 0] !== 0) { begin += 1; continue; }
            if (AVC[begin + 1] !== 0) { begin += 1; continue; }
            if (AVC[begin + 2] !== 1) { begin += 1; continue; }

            if (prev != null) {
              const NALu = AVC.slice(prev + 3, begin);
              const nal_unit_type = NALu[0] & 0x1F;
              if (nal_unit_type !== 9) {
                generateH264RTPPayloads(NALu).forEach((fragment) => {
                  const rtp = Buffer.concat([generateRTPHeader({
                    payload_type: 96,
                    sequence_number: this.avcSequenceNumber,
                    timestamp: pts,
                  }), fragment]);
                  this.avcSequenceNumber += 1;
                  if (this.avcSequenceNumber >= 2 ** 16) {
                    this.avcSequenceNumber = 0;
                  }
                  emitter.emit('video', rtp);
                });
              }
            }
            prev = begin;
            begin += 1;
          }

          begin = AVC.length;
          if (prev == null) {
             prev = TSPES.PES_HEADER_SIZE + 3 + PES_header_data_length;
          }

          {
            const nal_unit_type = AVC[prev + 3] & 0x1f;
            if (nal_unit_type !== 9) {
              const NALu = AVC.slice(prev + 3, begin);
              const rtps = generateH264RTPPayloads(NALu);
              rtps.forEach((fragment, index) => {
                const rtp = Buffer.concat([generateRTPHeader({
                  payload_type: 96,
                  sequence_number: this.avcSequenceNumber,
                  timestamp: pts,
                  marker: index === rtps.length - 1 ? 1 : 0,
                }), fragment]);
                this.avcSequenceNumber += 1;
                if (this.avcSequenceNumber >= 2 ** 16) {
                  this.avcSequenceNumber = 0;
                }
                emitter.emit('video', rtp);
              });
            }
          }
        }
      } else if (pid === this.aacPid) {
        this.aacPESQueue.push(packet);
        while (!this.aacPESQueue.isEmpty()) {
          const AAC: Buffer = this.aacPESQueue.pop()!;

          let pts = 0;
          pts *= (1 << 3); pts += ((AAC[TSPES.PES_HEADER_SIZE + 3 + 0] & 0x0E) >> 1);
          pts *= (1 << 8); pts += ((AAC[TSPES.PES_HEADER_SIZE + 3 + 1] & 0xFF) >> 0);
          pts *= (1 << 7); pts += ((AAC[TSPES.PES_HEADER_SIZE + 3 + 2] & 0xFE) >> 1);
          pts *= (1 << 8); pts += ((AAC[TSPES.PES_HEADER_SIZE + 3 + 3] & 0xFF) >> 0);
          pts *= (1 << 7); pts += ((AAC[TSPES.PES_HEADER_SIZE + 3 + 4] & 0xFE) >> 1);

          const PES_header_data_length = AAC[TSPES.PES_HEADER_SIZE + 2];
          const begin = TSPES.PES_HEADER_SIZE + 3 + PES_header_data_length;

          const rtps = generateAACRTPPayloads(AAC.slice(begin));
          rtps.forEach((fragment, index) => {
            const rtp = Buffer.concat([generateRTPHeader({
              payload_type: 97,
              sequence_number: this.aacSequenceNumber,
              timestamp: pts,
              marker: index === rtps.length - 1 ? 1 : 0,
            }), fragment]);
            this.aacSequenceNumber += 1;
            if (this.aacSequenceNumber >= 2 ** 16) {
              this.aacSequenceNumber = 0;
            }
            emitter.emit('audio', rtp);
          });
        }
      } else if (pid === this.opusPid) {
        this.opusPESQueue.push(packet);
        while (!this.opusPESQueue.isEmpty()) {
          const OPUS: Buffer = this.opusPESQueue.pop()!;

          let pts = 0;
          pts *= (1 << 3); pts += ((OPUS[TSPES.PES_HEADER_SIZE + 3 + 0] & 0x0E) >> 1);
          pts *= (1 << 8); pts += ((OPUS[TSPES.PES_HEADER_SIZE + 3 + 1] & 0xFF) >> 0);
          pts *= (1 << 7); pts += ((OPUS[TSPES.PES_HEADER_SIZE + 3 + 2] & 0xFE) >> 1);
          pts *= (1 << 8); pts += ((OPUS[TSPES.PES_HEADER_SIZE + 3 + 3] & 0xFF) >> 0);
          pts *= (1 << 7); pts += ((OPUS[TSPES.PES_HEADER_SIZE + 3 + 4] & 0xFE) >> 1);

          const PES_header_data_length = OPUS[TSPES.PES_HEADER_SIZE + 2];
          const begin = TSPES.PES_HEADER_SIZE + 3 + PES_header_data_length;

          const rtps = generateOpusRTPPayloads(OPUS.slice(begin));
          rtps.forEach((fragment, index) => {
            const rtp = Buffer.concat([generateRTPHeader({
              payload_type: 97,
              sequence_number: this.opusSequenceNumber,
              timestamp: pts * 48000 / 90000 + 20 * 48 * index, // assume 20ms sample per fragment
              marker: 1,
            }), fragment]);
            this.opusSequenceNumber += 1;
            if (this.opusSequenceNumber >= 2 ** 16) {
              this.opusSequenceNumber = 0;
            }
            emitter.emit('audio', rtp);
          });
        }
      }
    }

    callback();
  } 
}

process.stdin.pipe(new TSPESExtractor());

const server = new Server({ port: 9000 });
server.on("connection", async (socket) => {
  const pc = new RTCPeerConnection({
    codecs: {
      video: [
        new RTCRtpCodecParameters({
          mimeType: "video/H264",
          clockRate: 90000,
          payloadType: 96,
          rtcpFeedback: [
            { type: "ccm", parameter: "fir" },
            { type: "nack" },
            { type: "nack", parameter: "pli" },
            { type: "goog-remb" },
          ],
          parameters: {
            'profile-level-id': '42e01f',
            'level-asymmetry-allowed': 1,
            'packetization-mode': 1,
          },
        }),
      ],
      audio: [
        new RTCRtpCodecParameters({
          mimeType: "audio/opus",
          clockRate: 48000,
          payloadType: 97,
          channels: 2,
          parameters: {
            'sprop-stereo': '1'
          },
        }),
      ]
    },
  });

  const videoTrack = new MediaStreamTrack({ kind: "video" });
  pc.addTrack(videoTrack);

  const audioTrack = new MediaStreamTrack({ kind: "audio" });
  pc.addTrack(audioTrack);

  pc.connectionStateChange
    .watch((state) => state === "connected")
    .then(() => {
      emitter.on('video', (rtp) => {
        const packet = RtpPacket.deSerialize(rtp);
        //console.log(packet);
        videoTrack.writeRtp(rtp);
      });

      emitter.on('audio', (rtp) => {
        const packet = RtpPacket.deSerialize(rtp);
        //console.log(packet);
        audioTrack.writeRtp(rtp);
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



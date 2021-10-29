type RTPHeader = {
  version: number,
  padding: number,
  extension: number, 
  csrc_count: number,
  marker: number,
  payload_type: number,
  sequence_number: number,
  timestamp: number,
  ssrc: number,
};

export const generateRTPHeader = ({
  version = 2,
  padding = 0,
  extension = 0, 
  csrc_count = 0,
  marker= 0,
  payload_type,
  sequence_number,
  timestamp,
  ssrc = 0,
} : Pick<RTPHeader, 'payload_type' | 'sequence_number' | 'timestamp'> & Partial<RTPHeader>) => {
  const header = Buffer.alloc(12);
  header.writeUInt8(
    ((version & 0x03) << 6) | ((padding & 0x01) << 5) | ((extension & 0x01) << 4) | ((csrc_count & 0x0F) << 0),
    0
  );
  header.writeUInt8(
    ((marker & 0x01) << 7) | ((payload_type & 0x7F) << 0),
    1
  );
  header.writeUInt16BE(sequence_number, 2);
  header.writeUInt32BE(timestamp, 4);
  header.writeUInt32BE(ssrc, 8);
  return header;
};


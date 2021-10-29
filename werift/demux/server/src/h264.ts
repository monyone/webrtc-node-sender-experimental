const ebspToRbsp = (ebsp: Buffer): Buffer => {
  const rbsp_bytes = [ebsp[0], ebsp[1]];
  for (let i = 2; i < ebsp.length; i++) {
    if (ebsp[i - 2] === 0 && ebsp[i - 1] === 0 && ebsp[i] === 3) {
      if (i + 1 < ebsp.length && (ebsp[i + 1] == 1 || ebsp[i + 1] === 2 || ebsp[i + 3] === 3)) {
        continue;
      }
    }

    rbsp_bytes.push(ebsp[i]);
  }

  const rbsp = Buffer.from(rbsp_bytes);
  return rbsp;
}

export const generateH264RTPPayloads = (ebsp: Buffer, fragmentation_length: number = 1400): Buffer[] => {
  const result = [];

  //const payload = ebspToRbsp(ebsp);
  const payload = ebsp;

  if (payload.length <= fragmentation_length) {
    result.push(payload);
    return result;
  }

  const nri = (payload[0] & 0x60) >> 5;
  const type = payload[0] & 0x1F;

  for (let offset = 1; offset < payload.length; offset += fragmentation_length - 2) {
    const begin = offset;
    const end = Math.min(offset + fragmentation_length - 2, payload.length);

    const S = begin === 1;
    const E = end === payload.length;

    const FU_indicator = Buffer.from([
     (nri << 5) | 28
    ]);
    const FU_header = Buffer.from([
     (S ? 1 : 0) << 7 | (E ? 1 : 0) << 6 | type
    ]);
    result.push(Buffer.concat([FU_indicator, FU_header, payload.slice(begin, end)]));
  }
  return result;
};

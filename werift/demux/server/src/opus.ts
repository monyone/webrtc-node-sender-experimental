export const generateOpusRTPPayloads = (opus: Buffer): Buffer[] => {
  const result = [];

  for (let offset = 0; offset < opus.length; ) {
    const opus_pending_trim_start = (opus[offset + 1] & 0x10) !== 0;
    const trim_end = (opus[offset + 1] & 0x08) !== 0;

    let index = offset + 2;
    let size = 0;

    while (opus[index] === 0xFF) {
      size += 255;
      index += 1;
    }
    size += opus[index];
    index += 1;
    index += opus_pending_trim_start ? 2 : 0;
    index += trim_end ? 2 : 0;
    
    result.push(opus.slice(index, index + size));
    offset = index + size;
  }

  return result;
};

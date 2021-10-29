export const generateAACRTPPayloads = (aac: Buffer): Buffer[] => {
  const result = [];
  
  for (let index = 0; index < aac.length; index++) {
    const protection = (aac[index + 1] & 0x01) !== 0;
    const frameLength = (((aac[index + 3] & 0x03) << 11) | (aac[index + 4] << 3) | (aac[index + 5] >> 5)) - (protection ? 7 : 9);

    const begin = index + (protection ? 7 : 9);
    const end = Math.min(aac.length, begin + frameLength);
    const payload = Buffer.concat([
      Buffer.from([
        0x00,
        0x10,
        (frameLength >> 5 & 0xFF),
        (frameLength << 3 & 0xF8),
      ]),
      aac.slice(begin, end),
    ])

    result.push(payload);
  }

  return result;
};

/** A valid Ogg/Opus container carrying a silence frame; no private recording. */
export function opusSilenceFixture(): Buffer {
  const head = Buffer.alloc(19);
  head.write('OpusHead');
  head[8] = 1;
  head[9] = 1;
  head.writeUInt16LE(312, 10);
  head.writeUInt32LE(48000, 12);
  const tags = Buffer.alloc(16);
  tags.write('OpusTags');
  const packets = [head, tags, Buffer.from([0xf8, 0xff, 0xfe])];
  return Buffer.concat(
    packets.map((packet, index) => {
      const page = Buffer.alloc(28 + packet.length);
      page.write('OggS');
      page[5] = index === 0 ? 2 : index === 2 ? 4 : 0;
      page.writeBigUInt64LE(index === 2 ? 960n : 0n, 6);
      page.writeUInt32LE(42, 14);
      page.writeUInt32LE(index, 18);
      page[26] = 1;
      page[27] = packet.length;
      packet.copy(page, 28);
      let crc = 0;
      for (const byte of page) {
        crc ^= byte << 24;
        for (let bit = 0; bit < 8; bit++)
          crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
      }
      page.writeUInt32LE(crc >>> 0, 22);
      return page;
    }),
  );
}

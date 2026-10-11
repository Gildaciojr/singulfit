/** Validate container framing and checksums, not just a spoofable OggS prefix. */
export function validOggAudio(content: Buffer): boolean {
  let offset = 0;
  let pages = 0;
  let audioHeader = false;
  while (offset < content.length) {
    if (
      offset + 27 > content.length ||
      content.toString('ascii', offset, offset + 4) !== 'OggS' ||
      content[offset + 4] !== 0
    )
      return false;
    const segments = content[offset + 26];
    const headerEnd = offset + 27 + segments;
    if (headerEnd > content.length) return false;
    let bodySize = 0;
    for (let i = offset + 27; i < headerEnd; i++) bodySize += content[i];
    const end = headerEnd + bodySize;
    if (end > content.length) return false;
    let crc = 0;
    for (let i = offset; i < end; i++) {
      const byte = i >= offset + 22 && i < offset + 26 ? 0 : content[i];
      crc ^= byte << 24;
      for (let bit = 0; bit < 8; bit++)
        crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
    }
    if (crc >>> 0 !== content.readUInt32LE(offset + 22)) return false;
    if (pages === 0) {
      if (!(content[offset + 5] & 2)) return false;
      audioHeader =
        (bodySize >= 19 &&
          content.toString('ascii', headerEnd, headerEnd + 8) === 'OpusHead') ||
        (bodySize >= 30 &&
          content[headerEnd] === 1 &&
          content.toString('ascii', headerEnd + 1, headerEnd + 7) === 'vorbis');
    }
    offset = end;
    pages++;
  }
  return audioHeader && pages >= 2;
}

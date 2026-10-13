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

/** Single-stream Opus duration; reject unknown clocks and chained streams. */
export function oggOpusDurationSeconds(content: Buffer): number | null {
  if (!validOggAudio(content)) return null;
  let offset = 0;
  let serial: number | null = null;
  let sequence = 0;
  let packetIndex = 0;
  let preSkip = 0;
  let samples = 0;
  let lastGranule = 0n;
  let ended = false;
  let fragments: Buffer[] = [];
  while (offset < content.length) {
    if (ended) return null;
    const flags = content[offset + 5];
    const pageSerial = content.readUInt32LE(offset + 14);
    if (serial === null) serial = pageSerial;
    if (
      pageSerial !== serial ||
      content.readUInt32LE(offset + 18) !== sequence++ ||
      Boolean(flags & 1) !== Boolean(fragments.length) ||
      (offset > 0 && flags & 2)
    )
      return null;
    const count = content[offset + 26];
    let body = offset + 27 + count;
    for (let i = 0; i < count; i++) {
      const size = content[offset + 27 + i];
      fragments.push(content.subarray(body, body + size));
      body += size;
      if (size === 255) continue;
      const packet = Buffer.concat(fragments);
      fragments = [];
      if (packetIndex === 0) {
        if (
          packet.length < 19 ||
          packet.toString('ascii', 0, 8) !== 'OpusHead' ||
          packet[8] !== 1
        )
          return null;
        preSkip = packet.readUInt16LE(10);
      } else if (packetIndex === 1) {
        if (packet.length < 16 || packet.toString('ascii', 0, 8) !== 'OpusTags')
          return null;
      } else {
        if (!packet.length) return null;
        const config = packet[0] >> 3;
        const frameSamples =
          config < 12
            ? [480, 960, 1920, 2880][config & 3]
            : config < 16
              ? 480 << (config & 1)
              : 120 << (config & 3);
        const code = packet[0] & 3;
        if (code === 3 && packet.length < 2) return null;
        const frames = code === 0 ? 1 : code === 3 ? packet[1] & 63 : 2;
        if (!frames || frameSamples * frames > 5760) return null;
        samples += frameSamples * frames;
      }
      packetIndex++;
    }
    const granule = content.readBigUInt64LE(offset + 6);
    if (granule !== 0xffffffffffffffffn) {
      if (granule < lastGranule || granule > BigInt(samples)) return null;
      lastGranule = granule;
    }
    ended = Boolean(flags & 4);
    offset = body;
  }
  if (
    !ended ||
    fragments.length ||
    packetIndex < 3 ||
    lastGranule <= BigInt(preSkip)
  )
    return null;
  // Packet clock also bounds work; a forged final granule cannot hide long audio.
  return Math.max(Number(lastGranule) - preSkip, samples - preSkip) / 48000;
}

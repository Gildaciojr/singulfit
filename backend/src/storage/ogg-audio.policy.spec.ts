import { validOggAudio, oggOpusDurationSeconds } from './ogg-audio.policy';
import { opusSilenceFixture } from '../audio/audio.fixture';

describe('Ogg/Opus media integrity', () => {
  it('accepts a complete checksummed synthetic Opus stream', () => {
    expect(validOggAudio(opusSilenceFixture())).toBe(true);
    expect(oggOpusDurationSeconds(opusSilenceFixture())).toBeCloseTo(0.0135);
  });

  function durationFixture(frameCount: number, forged = false) {
    const original = opusSilenceFixture();
    const pages: Buffer[] = [original.subarray(0, 91)];
    for (let index = 0; index < frameCount; index++) {
      const page = Buffer.from(original.subarray(91));
      page[5] = index === frameCount - 1 ? 4 : 0;
      page.writeUInt32LE(index + 2, 18);
      page.writeBigUInt64LE(BigInt(forged ? 960 : (index + 1) * 960), 6);
      page.writeUInt32LE(0, 22);
      let crc = 0;
      for (const byte of page) {
        crc ^= byte << 24;
        for (let bit = 0; bit < 8; bit++)
          crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
      }
      page.writeUInt32LE(crc >>> 0, 22);
      pages.push(page);
    }
    return Buffer.concat(pages);
  }

  it('bounds duration using the packet clock even if granules hide long audio', () => {
    expect(oggOpusDurationSeconds(durationFixture(6000))).toBeLessThanOrEqual(
      120,
    );
    expect(oggOpusDurationSeconds(durationFixture(6001))).toBeGreaterThan(120);
    expect(oggOpusDurationSeconds(durationFixture(6001, true))).toBeGreaterThan(
      120,
    );
  });
  it('rejects missing EOS and chained streams rather than guessing duration', () => {
    const stream = opusSilenceFixture();
    expect(oggOpusDurationSeconds(Buffer.concat([stream, stream]))).toBeNull();
    expect(oggOpusDurationSeconds(stream.subarray(0, 91))).toBeNull();
  });
  it.each([
    Buffer.alloc(0),
    Buffer.from('OggS'),
    Buffer.from('encrypted .enc bytes'),
  ])('rejects malformed or encrypted bytes: %j', (content) => {
    expect(validOggAudio(content)).toBe(false);
  });
  it('rejects truncation, tampering, invalid version and missing audio pages', () => {
    const original = opusSilenceFixture();
    const tampered = Buffer.from(original);
    tampered[tampered.length - 1] ^= 1;
    const invalidVersion = Buffer.from(original);
    invalidVersion[4] = 1;
    for (const content of [
      original.subarray(0, original.length - 1),
      original.subarray(0, 47),
      tampered,
      invalidVersion,
    ])
      expect(validOggAudio(content)).toBe(false);
  });
});

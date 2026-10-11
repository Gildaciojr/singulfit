import { validOggAudio } from './ogg-audio.policy';
import { opusSilenceFixture } from '../audio/audio.fixture';

describe('Ogg/Opus media integrity', () => {
  it('accepts a complete checksummed synthetic Opus stream', () => {
    expect(validOggAudio(opusSilenceFixture())).toBe(true);
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

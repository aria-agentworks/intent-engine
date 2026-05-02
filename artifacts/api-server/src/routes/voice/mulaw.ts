// ── G.711 mu-law (u-law) codec ── pure JS, no native deps ──────────────────
// Twilio Media Streams send 8-bit mu-law at 8000 Hz.
// OpenAI TTS PCM is 16-bit signed at 24000 Hz.
// We need:  ulawToLinear, linearToUlaw, resample 24kHz→8kHz, WAV wrapper.

const ULAW_BIAS = 0x84;
const ULAW_CLIP = 32635;

// Decode a single mu-law byte → 16-bit signed PCM
export function decodeUlawSample(b: number): number {
  b = ~b & 0xff;
  const sign = b & 0x80;
  const exp = (b >> 4) & 0x07;
  const mantissa = b & 0x0f;
  let sample = ((mantissa << 3) + ULAW_BIAS) << exp;
  sample -= ULAW_BIAS;
  return sign ? -sample : sample;
}

// Encode a 16-bit signed PCM sample → mu-law byte
export function encodeUlawSample(sample: number): number {
  let sign = 0;
  if (sample < 0) {
    sample = -sample;
    sign = 0x80;
  }
  sample = Math.min(sample, ULAW_CLIP);
  sample += ULAW_BIAS;
  let exp = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exp > 0; exp--, mask >>= 1) {}
  const mantissa = (sample >> (exp + 3)) & 0x0f;
  return (~(sign | (exp << 4) | mantissa)) & 0xff;
}

// Decode an entire mu-law Buffer → Int16Array (PCM 8kHz)
export function ulawToLinear(buf: Buffer): Int16Array {
  const out = new Int16Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    out[i] = decodeUlawSample(buf[i]!);
  }
  return out;
}

// Encode Int16Array (PCM) → Buffer of mu-law bytes
export function linearToUlaw(pcm: Int16Array): Buffer {
  const out = Buffer.allocUnsafe(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    out[i] = encodeUlawSample(pcm[i]!);
  }
  return out;
}

// Simple linear resampler: Int16Array from srcRate → dstRate
export function resample(
  samples: Int16Array,
  srcRate: number,
  dstRate: number
): Int16Array {
  if (srcRate === dstRate) return samples;
  const ratio = srcRate / dstRate;
  const outLen = Math.floor(samples.length / ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, samples.length - 1);
    const frac = srcIdx - lo;
    out[i] = Math.round((samples[lo]! * (1 - frac)) + (samples[hi]! * frac));
  }
  return out;
}

// Wrap PCM16 samples in a minimal WAV header so Whisper accepts it
export function wrapInWav(pcm: Int16Array, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcm.length * 2;
  const headerSize = 44;
  const buf = Buffer.allocUnsafe(headerSize + dataSize);

  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);           // Subchunk1Size (PCM)
  buf.writeUInt16LE(1, 20);            // AudioFormat (PCM)
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < pcm.length; i++) {
    buf.writeInt16LE(pcm[i]!, headerSize + i * 2);
  }
  return buf;
}

// ── Energy-based Voice Activity Detector ─────────────────────────────────────
// Works at 8000 Hz (Twilio mu-law stream rate).
// Splits audio stream into utterances: silence → speech → silence.

const FRAME_MS = 20;                   // 20 ms frames
const SAMPLES_PER_FRAME = 160;        // 8000 Hz × 0.020 s
const SPEECH_THRESHOLD = 300;         // RMS energy to count as speech
const SILENCE_FRAMES_NEEDED = 40;     // 40 × 20ms = 800 ms silence → end of phrase
const MIN_SPEECH_FRAMES = 5;          // 5 × 20ms = 100 ms minimum to trigger

function rms(samples: Int16Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += (samples[i]! * samples[i]!);
  }
  return Math.sqrt(sum / samples.length);
}

export interface VadResult {
  complete: boolean;
  samples?: Int16Array;
}

export class VAD {
  private accumulator: number[] = [];  // raw samples from incoming chunks (partial frames)
  private speechBuffer: Int16Array[] = [];
  private silenceCount = 0;
  private speechCount = 0;
  private active = false;

  // Feed raw 8kHz PCM samples (from one mu-law packet, typically 160 samples).
  // Returns { complete: true, samples } when a full utterance is ready.
  addChunk(chunk: Int16Array): VadResult {
    // Accumulate into frame-sized slices
    for (let i = 0; i < chunk.length; i++) {
      this.accumulator.push(chunk[i]!);
    }

    let result: VadResult = { complete: false };

    while (this.accumulator.length >= SAMPLES_PER_FRAME) {
      const frame = new Int16Array(this.accumulator.splice(0, SAMPLES_PER_FRAME));
      const energy = rms(frame);
      const isSpeech = energy > SPEECH_THRESHOLD;

      if (isSpeech) {
        this.speechCount++;
        this.silenceCount = 0;
        this.active = true;
        this.speechBuffer.push(frame);
      } else if (this.active) {
        this.silenceCount++;
        this.speechBuffer.push(frame); // include trailing silence for natural cutoff

        if (this.silenceCount >= SILENCE_FRAMES_NEEDED && this.speechCount >= MIN_SPEECH_FRAMES) {
          result = { complete: true, samples: this.drain() };
          this.reset();
          break;
        }
      }
    }

    return result;
  }

  private drain(): Int16Array {
    const total = this.speechBuffer.reduce((n, b) => n + b.length, 0);
    const out = new Int16Array(total);
    let offset = 0;
    for (const b of this.speechBuffer) {
      out.set(b, offset);
      offset += b.length;
    }
    return out;
  }

  reset() {
    this.accumulator = [];
    this.speechBuffer = [];
    this.silenceCount = 0;
    this.speechCount = 0;
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }
}

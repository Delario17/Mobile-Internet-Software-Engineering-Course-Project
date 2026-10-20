// P1-FR-006/007: measured PCM phrase ranges, not word timestamps or forced alignment.
export interface SpeechWindow { startSample: number; endSample: number; }
export function speechWindows(pcm: Int16Array): SpeechWindow[] {
  const frame: number = 320; // 20ms at 16kHz
  const energies: number[] = [];
  for (let offset: number = 0; offset < pcm.length; offset += frame) {
    let sum: number = 0;
    const end: number = Math.min(offset + frame, pcm.length);
    for (let i: number = offset; i < end; i++) { sum += pcm[i] * pcm[i]; }
    energies.push(Math.sqrt(sum / (end - offset)));
  }
  // ponytail: conservative energy VAD; all boundaries require human review. Neural VAD can replace it.
  const threshold: number = 180;
  const result: SpeechWindow[] = [];
  let start: number = -1;
  let lastVoice: number = -1;
  let covered: number = 0;
  for (let i: number = 0; i <= energies.length; i++) {
    const voiced: boolean = i < energies.length && energies[i] >= threshold;
    if (voiced) {
      if (start < 0) { start = Math.max(covered, (i - 5) * frame, 0); }
      lastVoice = i;
    }
    if (start >= 0 && (i === energies.length || i - lastVoice >= 25 || (i + 1) * frame - start >= 240000)) {
      const end: number = Math.min(pcm.length, (lastVoice + 6) * frame, start + 240000);
      if (end - start >= 3200) { result.push({ startSample: start, endSample: end }); }
      covered = end; start = -1;
    }
  }
  return result;
}

import { RenderPiece } from './Project';
import { Cancellation, Progress } from './Capabilities';

// P1-FR-014/016/017/018, architecture ADR-007: one PCM/WAV render for preview and export.
// First release matches recorder resolution: 16kHz mono S16LE. Sources stay immutable.
export async function renderWave(manifest: RenderPiece[], load: (id: string) => Promise<Int16Array | undefined>,
  cancellation: Cancellation, progress: (value: Progress) => void): Promise<ArrayBuffer> {
  let durationUs: number = 0;
  for (const piece of manifest) {
    if (![piece.startUs, piece.endUs, piece.outputStartUs, piece.fadeInUs, piece.fadeOutUs].every(
      (value: number) => Number.isSafeInteger(value) && value >= 0) || piece.endUs <= piece.startUs ||
      piece.outputStartUs !== durationUs || piece.fadeInUs + piece.fadeOutUs > piece.endUs - piece.startUs) {
      throw new Error('RENDER_RANGE');
    }
    durationUs += piece.endUs - piece.startUs;
  }
  if (durationUs <= 0 || durationUs > 1800000000) { throw new Error('RENDER_TOO_LONG'); }
  const count: number = Math.round(durationUs * 16000 / 1000000);
  const result: ArrayBuffer = new ArrayBuffer(44 + count * 2);
  const header: DataView = new DataView(result);
  header.setUint32(0, 0x52494646); header.setUint32(4, 36 + count * 2, true);
  header.setUint32(8, 0x57415645); header.setUint32(12, 0x666d7420);
  header.setUint32(16, 16, true); header.setUint16(20, 1, true); header.setUint16(22, 1, true);
  header.setUint32(24, 16000, true); header.setUint32(28, 32000, true);
  header.setUint16(32, 2, true); header.setUint16(34, 16, true);
  header.setUint32(36, 0x64617461); header.setUint32(40, count * 2, true);
  const output: Int16Array = new Int16Array(result, 44);
  for (const piece of manifest) {
    if (cancellation.cancelled) { throw new Error('CANCELLED'); }
    const pcm: Int16Array | undefined = await load(piece.assetId);
    const start: number = Math.round(piece.startUs * 16000 / 1000000);
    const dest: number = Math.round(piece.outputStartUs * 16000 / 1000000);
    const end: number = Math.round((piece.outputStartUs + piece.endUs - piece.startUs) * 16000 / 1000000);
    const length: number = end - dest;
    // Metadata duration can differ from final decoder PTS by <20ms; only that tail may be silence padded.
    if (!pcm || pcm.length <= start || start + length > pcm.length + 320) { throw new Error('RENDER_ASSET'); }
    const fadeIn: number = Math.round(piece.fadeInUs * 16000 / 1000000);
    const fadeOut: number = Math.round(piece.fadeOutUs * 16000 / 1000000);
    for (let offset: number = 0; offset < length; offset += 16000) {
      if (cancellation.cancelled) { throw new Error('CANCELLED'); }
      for (let i: number = offset; i < Math.min(length, offset + 16000); i++) {
        let gain: number = 1;
        if (fadeIn > 0 && i < fadeIn) { gain = i / fadeIn; }
        if (fadeOut > 0 && i >= length - fadeOut) { gain = Math.min(gain, (length - 1 - i) / fadeOut); }
        output[dest + i] = Math.round((start + i < pcm.length ? pcm[start + i] : 0) * gain);
      }
      progress({ completed: Math.min(count, dest + offset + 16000), total: count });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  if (cancellation.cancelled) { throw new Error('CANCELLED'); }
  return result;
}

// Read our ADR-007 PCM/WAV without asking a compressed-audio codec to decode raw PCM.
export function decodePcmWave(bytes: ArrayBuffer): Int16Array | undefined {
  if (bytes.byteLength < 12) { return undefined; }
  const view: DataView = new DataView(bytes);
  if (view.getUint32(0) !== 0x52494646 || view.getUint32(8) !== 0x57415645) { return undefined; }
  if (view.getUint32(4, true) + 8 > bytes.byteLength) { throw new Error('WAV_INVALID'); }
  let valid: boolean = false;
  let dataStart: number = -1;
  let dataLength: number = 0;
  for (let offset: number = 12; offset + 8 <= bytes.byteLength;) {
    const tag: number = view.getUint32(offset);
    const size: number = view.getUint32(offset + 4, true);
    const start: number = offset + 8;
    if (start + size > bytes.byteLength) { throw new Error('WAV_INVALID'); }
    if (tag === 0x666d7420 && size >= 16) {
      valid = view.getUint16(start, true) === 1 && view.getUint16(start + 2, true) === 1 &&
        view.getUint32(start + 4, true) === 16000 && view.getUint16(start + 14, true) === 16;
    } else if (tag === 0x64617461) { dataStart = start; dataLength = size; }
    offset = start + size + size % 2;
  }
  if (!valid) { return undefined; } // Other WAV formats use the official media decoder.
  if (dataStart < 0 || dataLength <= 0 || dataLength % 2 !== 0) { throw new Error('WAV_INVALID'); }
  return new Int16Array(bytes.slice(dataStart, dataStart + dataLength));
}

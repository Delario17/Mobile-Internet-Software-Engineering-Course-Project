import { fileIo as fs } from '@kit.CoreFileKit';
import { decode } from 'libaudiopcm.so';
import { decodePcmWave } from '../domain/PcmRender';

export async function decodeAudio(fd: number, size: number): Promise<ArrayBuffer> {
  const signature: ArrayBuffer = new ArrayBuffer(12);
  if (fs.readSync(fd, signature, { offset: 0, length: 12 }) === 12 &&
    new DataView(signature).getUint32(0) === 0x52494646) {
    const prefix: ArrayBuffer = new ArrayBuffer(Math.min(size, 65536));
    const read: number = fs.readSync(fd, prefix, { offset: 0, length: prefix.byteLength });
    const header: DataView = new DataView(prefix);
    let canonical: boolean = false;
    for (let pos: number = 12; pos + 24 <= read;) {
      const length: number = header.getUint32(pos + 4, true);
      if (header.getUint32(pos) === 0x666d7420 && length >= 16) {
        canonical = header.getUint16(pos + 8, true) === 1 && header.getUint16(pos + 10, true) === 1 &&
          header.getUint32(pos + 12, true) === 16000 && header.getUint16(pos + 22, true) === 16;
        break;
      }
      pos += 8 + length + length % 2;
    }
    if (!canonical) { return await decode(fd, size); }
    if (size > 57665536 || size < 44) { throw new Error('ASR_AUDIO_TOO_LONG'); }
    const bytes: ArrayBuffer = new ArrayBuffer(size);
    let cursor: number = 0;
    while (cursor < size) {
      const chunk: ArrayBuffer = new ArrayBuffer(Math.min(1048576, size - cursor));
      const count: number = fs.readSync(fd, chunk, { offset: cursor, length: chunk.byteLength });
      if (count <= 0) { throw new Error('ASR_DECODE_FAILED'); }
      new Uint8Array(bytes, cursor, count).set(new Uint8Array(chunk, 0, count)); cursor += count;
    }
    try {
      const pcm: Int16Array | undefined = decodePcmWave(bytes);
      if (pcm) { return pcm.buffer as ArrayBuffer; }
    } catch { throw new Error('ASR_DECODE_FAILED'); }
  }
  return await decode(fd, size);
}

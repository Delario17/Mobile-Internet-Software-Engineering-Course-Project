# Offline ASR Implementation Plan

**Goal:** P1-FR-006/007/010/019: recognize immutable local audio using official offline Chinese CoreSpeechKit; persist real audio phrase ranges with unknown confidence requiring review.
**Architecture:** API20 native demux/audio decoder produces 16k mono PCM in an asynchronous N-API worker. ArkTS detects bounded speech windows and streams each window to CoreSpeechKit. EditorSession commits the detached result using the existing recoverable store.
**Constraints:** compatible/target remain 6.0.0(20); no network permission; no generated transcript; no claimed word alignment; existing edits/takes must never be silently replaced.

- [x] Add failing tests for PCM windows (silence, pauses, long speech, bounds), recognition callbacks/cancel/errors and session persistence.
- [x] Add native `libaudiopcm.so` using OH_AVSource, OH_AVDemuxer and API20 synchronous OH_AudioCodec, bounded memory/time and cancellation; expose async decode and cancel only.
- [x] Add CoreSpeechKit adapter: offline zh-CN, correct 640-byte frames, start/complete lifecycle, timeout/cancel/shutdown, real text only, unknown confidence, refuse rerun over existing segments/takes.
- [x] Route recognize, extend operation deadline for real-time streaming, add actionable resource messages.
- [x] Run Node checks, official ArkTS/native build, emulator install and offline case. Record actual engine availability, source integrity and restart evidence; do not call an unsupported emulator a passing recognition test.
- [x] Review, update API evidence/status/test guide, commit and push.

Validation boundary: WLAN-off recognition passed; this emulator exposes no airplane-mode setting, so airplane-mode and reference-phone acceptance remain explicitly unverified. Official result has no word timing/confidence; phrase ranges are measured and require review. See docs/offline-asr-acceptance.md.

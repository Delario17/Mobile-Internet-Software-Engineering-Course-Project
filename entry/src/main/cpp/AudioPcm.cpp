// P1-FR-006: official API20 local decoder. No network, microphone or source writes.
#include <napi/native_api.h>
#include <multimedia/player_framework/native_avsource.h>
#include <multimedia/player_framework/native_avdemuxer.h>
#include <multimedia/player_framework/native_avcodec_audiocodec.h>
#include <multimedia/player_framework/native_avbuffer.h>
#include <multimedia/player_framework/native_avformat.h>
#include <unistd.h>
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstring>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
constexpr size_t MAX_SAMPLES = 16000 * 1800; // 30min/57.6MB output, reject instead of truncating.
struct Job {
    int fd = -1;
    int64_t size = 0;
    std::atomic<bool> cancelled{false};
    std::vector<int16_t> pcm;
    const char *error = nullptr;
    napi_deferred deferred = nullptr;
    napi_async_work work = nullptr;
};
std::mutex jobMutex;
Job *active = nullptr;
void Check(bool ok) { if (!ok) throw std::runtime_error("ASR_DECODE_FAILED"); }
struct Decoder {
    OH_AVSource *source = nullptr;
    OH_AVDemuxer *demux = nullptr;
    OH_AVCodec *codec = nullptr;
    OH_AVFormat *format = nullptr;
    bool started = false;
    ~Decoder() {
        if (codec) { if (started) OH_AudioCodec_Stop(codec); OH_AudioCodec_Destroy(codec); }
        if (format) OH_AVFormat_Destroy(format);
        if (demux) OH_AVDemuxer_Destroy(demux);
        if (source) OH_AVSource_Destroy(source);
    }
};
void Decode(Job &job) {
    Decoder d;
    d.source = OH_AVSource_CreateWithFD(job.fd, 0, job.size);
    Check(d.source != nullptr);
    OH_AVFormat *info = OH_AVSource_GetSourceFormat(d.source);
    int32_t count = 0;
    bool valid = info && OH_AVFormat_GetIntValue(info, OH_MD_KEY_TRACK_COUNT, &count);
    if (info) OH_AVFormat_Destroy(info);
    Check(valid && count > 0 && count < 100);
    int track = -1;
    for (int i = 0; i < count; i++) {
        OH_AVFormat *f = OH_AVSource_GetTrackFormat(d.source, i);
        int32_t type = -1;
        if (f && OH_AVFormat_GetIntValue(f, OH_MD_KEY_TRACK_TYPE, &type) && type == MEDIA_TYPE_AUD) {
            d.format = f; track = i; break;
        }
        if (f) OH_AVFormat_Destroy(f);
    }
    Check(track >= 0);
    const char *mime = nullptr;
    Check(OH_AVFormat_GetStringValue(d.format, OH_MD_KEY_CODEC_MIME, &mime));
    d.demux = OH_AVDemuxer_CreateWithSource(d.source);
    Check(d.demux && OH_AVDemuxer_SelectTrackByID(d.demux, track) == AV_ERR_OK);
    d.codec = OH_AudioCodec_CreateByMime(mime, false);
    Check(d.codec != nullptr);
    Check(OH_AVFormat_SetIntValue(d.format, OH_MD_KEY_AUDIO_SAMPLE_FORMAT, SAMPLE_S16LE));
    Check(OH_AVFormat_SetIntValue(d.format, OH_MD_KEY_ENABLE_SYNC_MODE, 1));
    Check(OH_AudioCodec_Configure(d.codec, d.format) == AV_ERR_OK);
    Check(OH_AudioCodec_Prepare(d.codec) == AV_ERR_OK);
    Check(OH_AudioCodec_Start(d.codec) == AV_ERR_OK);
    d.started = true;
    bool inputEnd = false, outputEnd = false;
    int32_t rate = 0, channels = 0, sampleFormat = -1;
    auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(90);
    while (!outputEnd) {
        if (job.cancelled) throw std::runtime_error("CANCELLED");
        if (std::chrono::steady_clock::now() > deadline) throw std::runtime_error("ASR_DECODE_TIMEOUT");
        uint32_t index = 0;
        if (!inputEnd) {
            auto status = OH_AudioCodec_QueryInputBuffer(d.codec, &index, 1000);
            if (status == AV_ERR_OK) {
                OH_AVBuffer *buffer = OH_AudioCodec_GetInputBuffer(d.codec, index);
                Check(buffer && OH_AVDemuxer_ReadSampleBuffer(d.demux, track, buffer) == AV_ERR_OK);
                OH_AVCodecBufferAttr attr{};
                Check(OH_AVBuffer_GetBufferAttr(buffer, &attr) == AV_ERR_OK);
                inputEnd = (attr.flags & AVCODEC_BUFFER_FLAGS_EOS) != 0;
                Check(OH_AudioCodec_PushInputBuffer(d.codec, index) == AV_ERR_OK);
            } else Check(status == AV_ERR_TRY_AGAIN_LATER);
        }
        auto status = OH_AudioCodec_QueryOutputBuffer(d.codec, &index, 1000);
        if (status == AV_ERR_STREAM_CHANGED || (status == AV_ERR_OK && rate == 0)) {
            OH_AVFormat *output = OH_AudioCodec_GetOutputDescription(d.codec);
            valid = output && OH_AVFormat_GetIntValue(output, OH_MD_KEY_AUD_SAMPLE_RATE, &rate) &&
                OH_AVFormat_GetIntValue(output, OH_MD_KEY_AUD_CHANNEL_COUNT, &channels) &&
                OH_AVFormat_GetIntValue(output, OH_MD_KEY_AUDIO_SAMPLE_FORMAT, &sampleFormat);
            if (output) OH_AVFormat_Destroy(output);
            Check(valid && rate >= 8000 && rate <= 192000 && channels > 0 && channels <= 8 && sampleFormat == SAMPLE_S16LE);
        }
        if (status == AV_ERR_STREAM_CHANGED || status == AV_ERR_TRY_AGAIN_LATER) continue;
        Check(status == AV_ERR_OK);
        OH_AVBuffer *buffer = OH_AudioCodec_GetOutputBuffer(d.codec, index);
        OH_AVCodecBufferAttr attr{};
        Check(buffer && OH_AVBuffer_GetBufferAttr(buffer, &attr) == AV_ERR_OK);
        outputEnd = (attr.flags & AVCODEC_BUFFER_FLAGS_EOS) != 0;
        if (attr.size > 0) {
            Check(attr.offset >= 0 && attr.size % (2 * channels) == 0 &&
                static_cast<int64_t>(attr.offset) + attr.size <= OH_AVBuffer_GetCapacity(buffer));
            auto bytes = OH_AVBuffer_GetAddr(buffer);
            Check(bytes != nullptr);
            const int16_t *samples = reinterpret_cast<const int16_t *>(bytes + attr.offset);
            int frames = attr.size / (2 * channels);
            // Map output samples to actual decoder presentation timestamps, including source gaps.
            int64_t first = std::llround(attr.pts * 16000.0 / 1000000.0);
            int64_t last = first + std::llround(frames * 16000.0 / rate);
            if (last > static_cast<int64_t>(MAX_SAMPLES)) throw std::runtime_error("ASR_AUDIO_TOO_LONG");
            if (last > 0) {
                job.pcm.resize(std::max(job.pcm.size(), static_cast<size_t>(last)), 0);
                for (int64_t t = std::max<int64_t>(0, first); t < last; t++) {
                    double position = (t - first) * static_cast<double>(rate) / 16000;
                    int a = std::min(static_cast<int>(position), frames - 1), b = std::min(a + 1, frames - 1);
                    double mix = 0, fraction = position - a;
                    for (int c = 0; c < channels; c++) mix += samples[a * channels + c] * (1 - fraction) + samples[b * channels + c] * fraction;
                    job.pcm[t] = static_cast<int16_t>(std::clamp(mix / channels, -32768.0, 32767.0));
                }
            }
        }
        Check(OH_AudioCodec_FreeOutputBuffer(d.codec, index) == AV_ERR_OK);
    }
    Check(!job.pcm.empty());
}
void Execute(napi_env, void *data) {
    auto &job = *static_cast<Job *>(data);
    try { Decode(job); } catch (const std::exception &error) {
        const std::string message = error.what();
        job.error = message == "CANCELLED" ? "CANCELLED" : message == "ASR_AUDIO_TOO_LONG" ? "ASR_AUDIO_TOO_LONG" : "ASR_DECODE_FAILED";
    } catch (...) { job.error = "ASR_DECODE_FAILED"; }
    close(job.fd); job.fd = -1;
}
void Complete(napi_env env, napi_status status, void *data) {
    std::unique_ptr<Job> job(static_cast<Job *>(data));
    { std::lock_guard<std::mutex> lock(jobMutex); active = nullptr; }
    napi_value value = nullptr;
    void *output = nullptr;
    if (!job->error && !job->cancelled && status == napi_ok &&
        napi_create_arraybuffer(env, job->pcm.size() * 2, &output, &value) == napi_ok) {
        memcpy(output, job->pcm.data(), job->pcm.size() * 2);
        napi_resolve_deferred(env, job->deferred, value);
    } else {
        napi_value message;
        napi_create_string_utf8(env, job->cancelled ? "CANCELLED" : job->error ? job->error : "ASR_DECODE_FAILED", NAPI_AUTO_LENGTH, &message);
        napi_create_error(env, nullptr, message, &value);
        napi_reject_deferred(env, job->deferred, value);
    }
    napi_delete_async_work(env, job->work);
}
napi_value Start(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value args[2], promise, name;
    int32_t fd = -1; int64_t size = 0;
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    if (argc != 2 || napi_get_value_int32(env, args[0], &fd) != napi_ok ||
        napi_get_value_int64(env, args[1], &size) != napi_ok || fd < 0 || size <= 0) {
        napi_throw_error(env, nullptr, "ASR_DECODE_FAILED"); return nullptr;
    }
    std::lock_guard<std::mutex> lock(jobMutex);
    if (active) { napi_throw_error(env, nullptr, "BUSY"); return nullptr; }
    auto job = std::make_unique<Job>();
    job->fd = dup(fd); job->size = size;
    if (job->fd < 0) { napi_throw_error(env, nullptr, "ASR_DECODE_FAILED"); return nullptr; }
    napi_create_promise(env, &job->deferred, &promise);
    napi_create_string_utf8(env, "LocalAudioDecode", NAPI_AUTO_LENGTH, &name);
    if (napi_create_async_work(env, nullptr, name, Execute, Complete, job.get(), &job->work) != napi_ok ||
        napi_queue_async_work(env, job->work) != napi_ok) {
        close(job->fd);
        if (job->work) napi_delete_async_work(env, job->work);
        napi_throw_error(env, nullptr, "ASR_DECODE_FAILED"); return nullptr;
    }
    active = job.release();
    return promise;
}
napi_value Cancel(napi_env env, napi_callback_info) {
    std::lock_guard<std::mutex> lock(jobMutex);
    if (active) active->cancelled = true;
    napi_value value; napi_get_undefined(env, &value); return value;
}
napi_value Init(napi_env env, napi_value exports) {
    napi_property_descriptor properties[] = {
        {"decode", nullptr, Start, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"cancelDecode", nullptr, Cancel, nullptr, nullptr, nullptr, napi_default, nullptr}
    };
    napi_define_properties(env, exports, 2, properties); return exports;
}
napi_module module = {1, 0, nullptr, Init, "audiopcm", nullptr, {0}};
__attribute__((constructor)) void Register() { napi_module_register(&module); }
}

"""Original procedural pressure/lunge sound; Python standard library only.

Run beside this script to regenerate truth-denied.wav and its measured report.
No recordings, sound libraries, speech, or third-party audio are used.
"""

from array import array
import hashlib
import json
import math
from pathlib import Path
import random
import sys
import wave


RATE = 24000
DURATION = 2.8
SEED = 2026090605
PEAK_TARGET = 0.60
OUT = Path(__file__).resolve().parent


def smoothstep(a, b, value):
    x = max(0.0, min(1.0, (value - a) / (b - a)))
    return x * x * (3.0 - 2.0 * x)


def main():
    rng = random.Random(SEED)
    samples = []
    thud_phase = 0.0
    throat_phase = 0.0
    low = mid = warm = 0.0
    # Two low-pass states isolate a band of breath, without a sharp hiss.
    low_alpha = 1.0 - math.exp(-2.0 * math.pi * 230.0 / RATE)
    mid_alpha = 1.0 - math.exp(-2.0 * math.pi * 1800.0 / RATE)
    warm_alpha = 1.0 - math.exp(-2.0 * math.pi * 820.0 / RATE)
    for i in range(round(RATE * DURATION)):
        t = i / RATE
        noise = rng.uniform(-1.0, 1.0)
        low += low_alpha * (noise - low)
        mid += mid_alpha * (noise - mid)
        warm += warm_alpha * (noise - warm)
        air = mid - low

        # A low drum-like body is audible immediately, then settles in pitch.
        thud_phase += 2.0 * math.pi * (45.0 + 59.0 * math.exp(-t / 0.054)) / RATE
        thud_env = smoothstep(0.0, 0.009, t) * math.exp(-t / 0.32)
        thud = thud_env * (0.94 * math.sin(thud_phase)
                           + 0.18 * math.sin(thud_phase * 1.97))

        # The held breath and vibrating throat carry the eye's forward motion.
        # They reach full pressure at 0.17s, hold to 0.60s, and exhale slowly.
        hold = smoothstep(0.015, 0.17, t) * math.exp(-max(0.0, t - 0.60) / 0.69)
        throat_phase += 2.0 * math.pi * (73.0 - 15.0 * smoothstep(0.1, 1.9, t)
                                       + 1.8 * math.sin(2.0 * math.pi * 4.1 * t)) / RATE
        throat = (0.22 * math.sin(throat_phase)
                  + 0.075 * math.sin(throat_phase * 2.02 + 0.3)
                  + 0.042 * math.sin(throat_phase * 3.07 + 0.6))
        roughness = 0.78 + 0.14 * math.sin(2.0 * math.pi * 23.0 * t)
        breath = hold * (throat + roughness * (0.39 * air + 0.11 * warm))

        # Quiet inharmonic resonances suggest a taut bronze structure.
        metal = 0.0
        for frequency, amplitude, decay, phase in (
            (229.0, 0.050, 0.97, 0.4),
            (361.0, 0.036, 0.73, 1.1),
            (517.0, 0.021, 0.52, 2.0),
        ):
            bend = 1.7 * math.sin(2.0 * math.pi * 2.6 * t)
            metal += amplitude * math.exp(-max(0.0, t - 0.54) / decay) * math.sin(
                2.0 * math.pi * frequency * t + bend + phase)
        metal *= smoothstep(0.02, 0.09, t)

        # A final fade precedes exactly 20ms of digital silence.
        tail = 1.0 - smoothstep(DURATION - 0.19, DURATION - 0.02, t)
        sample = (thud + breath + metal) * tail
        if t >= DURATION - 0.02:
            sample = 0.0
        samples.append(sample)

    assert all(math.isfinite(x) for x in samples)
    raw_peak = max(abs(x) for x in samples)
    normalized = [x * PEAK_TARGET / raw_peak for x in samples]
    pcm = array('h', [round(x * 32767) for x in normalized])
    if sys.byteorder != 'little':
        pcm.byteswap()
    wav_path = OUT / 'truth-denied.wav'
    with wave.open(str(wav_path), 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(RATE)
        output.writeframes(pcm.tobytes())

    # Reopen the actual deliverable: report measured quantized samples.
    with wave.open(str(wav_path), 'rb') as output:
        channels, width, rate, frames, compression, _ = output.getparams()
        measured = array('h', output.readframes(frames))
        if sys.byteorder != 'little':
            measured.byteswap()
    floats = [x / 32768.0 for x in measured]
    peak = max(abs(x) for x in floats)
    peak_index = max(range(len(measured)), key=lambda i: abs(measured[i]))
    silent_tail = 0
    for value in reversed(measured):
        if value:
            break
        silent_tail += 1
    rms = math.sqrt(sum(x * x for x in floats) / len(floats))
    report = {
        'file': wav_path.name,
        'source': 'Original deterministic procedural synthesis; no source recordings or third-party audio.',
        'generator': Path(__file__).name,
        'seed': SEED,
        'channels': channels,
        'sample_rate_hz': rate,
        'sample_width_bits': width * 8,
        'format': 'PCM16 little-endian WAV',
        'compression': compression,
        'frames': frames,
        'duration_seconds': frames / rate,
        'peak_linear': round(peak, 8),
        'peak_dbfs': round(20 * math.log10(peak), 4),
        'rms_linear': round(rms, 8),
        'rms_dbfs': round(20 * math.log10(rms), 4),
        'peak_at_seconds': round(peak_index / rate, 6),
        'initial_180ms_peak_linear': round(max(abs(x) for x in floats[:round(rate * 0.18)]), 8),
        'first_nonzero_at_seconds': next(i for i, value in enumerate(measured) if value) / rate,
        'silent_tail_samples': silent_tail,
        'silent_tail_seconds': silent_tail / rate,
        'finite_synthesis': all(math.isfinite(x) for x in normalized),
        'clipped_samples': sum(abs(x) >= 32767 for x in measured),
        'sha256': hashlib.sha256(wav_path.read_bytes()).hexdigest(),
    }
    assert channels == 1 and width == 2 and rate == RATE
    assert frames == round(RATE * DURATION)
    assert peak <= 0.62 and silent_tail >= round(0.02 * RATE)
    assert report['clipped_samples'] == 0
    assert report['first_nonzero_at_seconds'] < 0.018
    assert report['initial_180ms_peak_linear'] > 0.40
    (OUT / 'truth-validation.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()

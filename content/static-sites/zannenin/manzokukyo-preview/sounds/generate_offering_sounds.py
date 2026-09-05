"""Generate five original offering-game effects using only Python's standard library.

No recordings, external sound assets, speech, or network access are used.
Run this file directly; it writes only offering-*.wav and offering-validation.json.
"""

import hashlib
import json
import math
from pathlib import Path
import random
import struct
import wave


RATE = 24000
PEAK = 0.62
TAU = 2 * math.pi
OUTPUT = Path(__file__).resolve().parent
RNG = random.Random(9052026)


def envelope(t, duration, attack=0.008, release=0.045):
    return min(1.0, t / attack) * min(1.0, max(0.0, (duration - t) / release))


def add_event(samples, start, duration, voice, level=1.0):
    first = round(start * RATE)
    for offset in range(min(round(duration * RATE), len(samples) - first)):
        samples[first + offset] += level * voice(offset / RATE, duration)


def bell(frequency):
    def voice(t, duration):
        partials = ((1.0, 1.0), (2.0, 0.25), (3.01, 0.08))
        body = sum(level * math.sin(TAU * frequency * ratio * t) for ratio, level in partials)
        return body * envelope(t, duration, 0.004, 0.04) * math.exp(-t / (duration * 0.42))
    return voice


def brass(frequency):
    def voice(t, duration):
        phase = TAU * frequency * t + 0.022 * math.sin(TAU * 5.0 * t)
        body = sum(math.sin(phase * partial) / partial ** 1.38 for partial in range(1, 8))
        return body * envelope(t, duration, 0.023, min(0.16, duration * 0.4))
    return voice


def empty():
    samples = [0.0] * round(0.6 * RATE)

    def slide(t, duration):
        phase = TAU * (430 * t + (105 - 430) * t * t / (2 * duration))
        phase += 0.22 * math.sin(TAU * 10 * t)
        tone = math.sin(phase) + 0.23 * math.sin(2 * phase) + 0.1 * math.sin(3 * phase)
        return tone * envelope(t, duration, 0.018, 0.06) * (1 - 0.45 * t / duration)

    def plop(t, duration):
        phase = TAU * (150 * t - 60 * t * t / (2 * duration))
        return math.sin(phase) * envelope(t, duration, 0.006, 0.025) * math.exp(-t / 0.043)

    add_event(samples, 0.022, 0.43, slide, 0.7)
    add_event(samples, 0.445, 0.115, plop, 0.8)
    return samples


def coin():
    samples = [0.0] * round(0.7 * RATE)

    def strike(t, duration):
        partials = ((1660, 1.0), (2377, 0.52), (3479, 0.3), (5129, 0.13), (7331, 0.06))
        ring = sum(level * math.sin(TAU * frequency * t) * math.exp(-t / (0.095 - i * 0.012))
                   for i, (frequency, level) in enumerate(partials))
        tick = RNG.uniform(-1, 1) * math.exp(-t / 0.004) * 0.18
        box = (math.sin(TAU * 184 * t) + 0.4 * math.sin(TAU * 283 * t)) * math.exp(-t / 0.11) * 0.28
        return (ring + tick + box) * envelope(t, duration, 0.0015, 0.025)

    for start, duration, level in ((0.025, 0.4, 0.8), (0.245, 0.32, 0.5), (0.38, 0.26, 0.29), (0.47, 0.21, 0.15)):
        add_event(samples, start, duration, strike, level)
    return samples


def note():
    samples = [0.0] * round(0.6 * RATE)
    fast = slow = 0.0
    bursts = ((0.025, 0.085, 0.7), (0.125, 0.095, 1.0), (0.23, 0.08, 0.72),
              (0.32, 0.075, 0.54), (0.41, 0.07, 0.39), (0.49, 0.055, 0.24))
    for index in range(len(samples)):
        t = index / RATE
        white = RNG.uniform(-1, 1)
        fast += 0.64 * (white - fast)
        slow += 0.065 * (white - slow)
        flutter = sum(level * math.sin(math.pi * (t - start) / duration) ** 2
                      for start, duration, level in bursts if start <= t <= start + duration)
        samples[index] = (fast - slow) * flutter * 0.7
    add_event(samples, 0.45, 0.125, bell(245), 0.022)
    return samples


def blessing():
    samples = [0.0] * round(1.1 * RATE)
    for start, frequency, level in ((0.025, 523.25, 0.55), (0.19, 659.25, 0.55),
                                    (0.355, 783.99, 0.55), (0.52, 1046.5, 0.56),
                                    (0.67, 1567.98, 0.18)):
        add_event(samples, start, min(0.53, 1.07 - start), bell(frequency), level)
    return samples


def royal():
    samples = [0.0] * round(1.8 * RATE)
    for start, duration, frequency, level in ((0.025, 0.2, 523.25, 0.36),
                                             (0.275, 0.2, 783.99, 0.36),
                                             (0.52, 0.285, 1046.5, 0.34)):
        add_event(samples, start, duration, brass(frequency), level)
    for frequency, level in ((261.63, 0.18), (523.25, 0.25), (659.25, 0.19), (783.99, 0.19), (1046.5, 0.14)):
        add_event(samples, 0.86, 0.83, brass(frequency), level)
    for start, frequency in ((0.99, 1567.98), (1.13, 2093.0), (1.27, 2637.02)):
        add_event(samples, start, 1.76 - start, bell(frequency), 0.105)

    def drum(t, duration):
        phase = TAU * (92 * t - 30 * t * t / (2 * duration))
        return math.sin(phase) * envelope(t, duration, 0.004, 0.04) * math.exp(-t / 0.065)

    for start in (0.025, 0.52, 0.86):
        add_event(samples, start, 0.23, drum, 0.25)
    return samples


def write_effect(name, samples):
    # Fade into twenty milliseconds of silence, including the last PCM sample.
    active_end = len(samples) / RATE - 0.02
    for index in range(len(samples)):
        t = index / RATE
        fade_in = min(1.0, t / 0.004)
        fade_out = min(1.0, max(0.0, (active_end - t) / 0.035))
        samples[index] *= fade_in * fade_out
    assert samples and all(math.isfinite(value) for value in samples)
    source_peak = max(abs(value) for value in samples)
    assert source_peak > 0
    pcm = [round(value / source_peak * PEAK * 32767) for value in samples]
    assert all(-32768 < value < 32767 for value in pcm)
    payload = struct.pack(f'<{len(pcm)}h', *pcm)
    target = OUTPUT / f'offering-{name}.wav'
    with wave.open(str(target), 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(RATE)
        output.writeframes(payload)
    # Measure the written PCM rather than relying on pre-quantization samples.
    with wave.open(str(target), 'rb') as written:
        assert (written.getnchannels(), written.getsampwidth(), written.getframerate()) == (1, 2, RATE)
        frames = written.getnframes()
        decoded = struct.unpack(f'<{frames}h', written.readframes(frames))
    peak = max(abs(value) for value in decoded) / 32768
    rms = math.sqrt(sum((value / 32768) ** 2 for value in decoded) / frames)
    assert peak <= 0.65 and decoded[0] == 0 and decoded[-1] == 0
    assert all(value == 0 for value in decoded[-round(0.02 * RATE):])
    return {
        'file': target.name,
        'sample_rate': RATE,
        'channels': 1,
        'bits_per_sample': 16,
        'frames': frames,
        'duration_seconds': frames / RATE,
        'peak_linear': round(peak, 8),
        'peak_dbfs': round(20 * math.log10(peak), 3),
        'rms_dbfs': round(20 * math.log10(rms), 3),
        'clipped_samples': sum(abs(value) >= 32767 for value in decoded),
        'first_sample': decoded[0],
        'last_sample': decoded[-1],
        'silent_tail_ms': 20,
        'sha256': hashlib.sha256(target.read_bytes()).hexdigest()
    }


def main():
    results = [write_effect(name, generator()) for name, generator in (
        ('empty', empty), ('coin', coin), ('note', note), ('blessing', blessing), ('royal', royal)
    )]
    report = {'origin': 'Original procedural synthesis; no external recordings or assets.', 'effects': results}
    (OUTPUT / 'offering-validation.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    for result in results:
        print(f"{result['file']}: {result['duration_seconds']:.2f}s, peak={result['peak_linear']:.6f}, "
              f"{result['peak_dbfs']:.3f}dBFS, clipped={result['clipped_samples']}")


if __name__ == '__main__':
    main()

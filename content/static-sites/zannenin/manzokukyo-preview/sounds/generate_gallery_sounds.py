"""Original gallery effects: deterministic synthesis, Python standard library only.

Regenerates five mono PCM16 WAVs and gallery-validation.json beside this file.
No recordings, sampled instruments, third-party audio or impulse responses are used.
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
PEAK_TARGET = 0.60
SEED = 2026090706
OUT = Path(__file__).resolve().parent
TAU = 2.0 * math.pi
DURATIONS = {"reveal": 0.64, "collect": 1.10, "complete": 2.40,
             "unseal": 4.40, "door": 1.80}
EVENTS = {
    "reveal": [(0.0, "paper fold"), (0.045, "gold leaf friction"), (0.30, "second dry brush")],
    "collect": [(0.0, "seal impact"), (0.045, "seal seats"), (0.080, "clear bell")],
    "complete": [(index * 0.24, "collection tone %d" % (index + 1)) for index in range(6)],
    "unseal": [(index * 0.35, "metal clasp %d" % (index + 1)) for index in range(6)]
              + [(2.50, "low room resonance"), (3.20, "warm bell chord")],
    "door": [(0.0, "latch weight"), (0.065, "hinge begins"), (0.34, "timber creak"),
             (0.86, "hinge releases"), (1.12, "hall air")],
}


def smoothstep(start, end, value):
    x = max(0.0, min(1.0, (value - start) / (end - start)))
    return x * x * (3.0 - 2.0 * x)


def envelope(time, attack, decay):
    return 0.0 if time < 0.0 else smoothstep(0.0, attack, time) * math.exp(-time / decay)


def noise_bands(count, seed):
    """Dry, medium and warm noise with deterministic simple one-pole filters."""
    rng = random.Random(seed)
    low = mid = high = warm = 0.0
    coefficients = [1.0 - math.exp(-TAU * f / RATE) for f in (400.0, 1850.0, 5600.0, 210.0)]
    result = []
    for _ in range(count):
        white = rng.uniform(-1.0, 1.0)
        low += coefficients[0] * (white - low)
        mid += coefficients[1] * (white - mid)
        high += coefficients[2] * (white - high)
        warm += coefficients[3] * (white - warm)
        result.append((high - low, mid - low, warm))
    return result


def strike(time, frequency, weight=1.0):
    """An immediate, damped seal or wooden impact with a falling pitch."""
    if time < 0.0:
        return 0.0
    phase = TAU * (frequency * time + frequency * 0.028 * (1.0 - math.exp(-time / 0.016)))
    return weight * envelope(time, 0.0015, 0.085) * (
        math.sin(phase) + 0.19 * math.sin(phase * 2.19 + 0.2))


def bell(time, frequency, decay=0.40):
    """Hand-composed inharmonic modes; a soft bell, not a sampled instrument."""
    if time < 0.0:
        return 0.0
    modes = ((1.0, 1.0, 1.0), (2.012, 0.22, 0.56), (2.756, 0.11, 0.40), (4.071, 0.035, 0.25))
    return smoothstep(0.0, 0.004, time) * sum(
        amplitude * math.exp(-time / (decay * length)) * math.sin(TAU * frequency * ratio * time)
        for ratio, amplitude, length in modes)


def clasp(time, index, noise):
    if time < 0.0:
        return 0.0
    shift = 1.0 + index * 0.025
    body = strike(time, 158.0 + index * 4.0, 0.32)
    metal = sum(amplitude * envelope(time, 0.001, decay) * math.sin(TAU * frequency * shift * time)
                for frequency, amplitude, decay in ((463, 0.36, 0.054), (897, 0.23, 0.042),
                                                    (1447, 0.12, 0.035), (2329, 0.040, 0.022)))
    release = 0.10 * bell(time - 0.026, 1120.0 * shift, 0.045)
    grit = 0.34 * noise * envelope(time, 0.001, 0.013)
    return body + metal + release + grit


def synthesize(name):
    count = round(RATE * DURATIONS[name])
    bands = noise_bands(count, SEED + list(DURATIONS).index(name))
    samples = []
    hinge_phase = 0.0
    for index in range(count):
        time = index / RATE
        dry, air, warm = bands[index]
        if name == "reveal":
            fold = strike(time, 112.0, 0.19)
            friction = (envelope(time - 0.045, 0.040, 0.085)
                        + 0.62 * envelope(time - 0.30, 0.035, 0.068))
            grains = 0.74 + 0.17 * math.sin(TAU * 43.0 * time) + 0.09 * math.sin(TAU * 97.0 * time)
            shimmer = 0.026 * bell(time - 0.058, 1396.91, 0.095) + 0.018 * bell(time - 0.312, 1760.0, 0.060)
            sample = fold + 1.42 * dry * friction * grains + 0.16 * warm * friction + shimmer
        elif name == "collect":
            stamp = strike(time, 94.0, 0.86) + 0.20 * strike(time - 0.045, 166.0)
            contact = 0.30 * air * envelope(time, 0.0015, 0.019)
            seal_bell = 0.39 * bell(time - 0.080, 440.0, 0.32)
            sample = stamp + contact + seal_bell
        elif name == "complete":
            frequencies = (293.6648, 349.2282, 440.0, 523.2511, 587.3295, 698.4565)
            sample = 0.0
            for note, frequency in enumerate(frequencies):
                elapsed = time - note * 0.24
                sample += (0.33 + note * 0.012) * bell(elapsed, frequency, 0.44 + note * 0.022)
                sample += 0.012 * air * envelope(elapsed, 0.012, 0.095)
            sample += 0.070 * bell(time, 146.8324, 0.74)
        elif name == "unseal":
            sample = sum(0.66 * clasp(time - latch * 0.35, latch, air) for latch in range(6))
            elapsed = time - 2.50
            if elapsed >= 0.0:
                phase = TAU * (49.0 * elapsed + 0.55 * (1.0 - math.exp(-elapsed / 0.075)))
                sample += envelope(elapsed, 0.022, 0.43) * (0.54 * math.sin(phase)
                    + 0.14 * math.sin(phase * 2.006) + 0.10 * warm)
            chord_time = time - 3.20
            sample += (0.27 * bell(chord_time, 293.6648, 0.46)
                       + 0.13 * bell(chord_time, 349.2282, 0.40)
                       + 0.11 * bell(chord_time, 440.0, 0.38))
        elif name == "door":
            latch = strike(time, 71.0, 0.77) + 0.10 * bell(time, 227.0, 0.12)
            hinge_env = smoothstep(0.065, 0.20, time) * (1.0 - smoothstep(0.99, 1.45, time))
            hinge_frequency = 158.0 - 61.0 * smoothstep(0.08, 1.23, time) + 8.0 * math.sin(TAU * 2.4 * time)
            hinge_phase += TAU * hinge_frequency / RATE
            shudder = 0.76 + 0.17 * math.sin(TAU * 17.0 * time) + 0.07 * math.sin(TAU * 29.0 * time)
            hinge = hinge_env * shudder * (0.10 * math.sin(hinge_phase)
                + 0.053 * math.sin(hinge_phase * 2.021 + 0.6)
                + 0.035 * math.sin(hinge_phase * 3.073 + 1.2) + 0.22 * air)
            timber = (0.13 * bell(time - 0.34, 136.0, 0.14)
                      + 0.105 * bell(time - 0.86, 112.0, 0.18))
            gust = smoothstep(0.24, 0.83, time) * (1.0 - smoothstep(1.15, 1.70, time))
            sample = latch + hinge + timber + gust * (0.22 * air + 0.12 * warm)
        samples.append(sample)

    # Short, quiet mono wall reflections support the stone setting without muddying attacks.
    # Reveal remains dry so that its paper texture reads at low listening levels.
    reflected = samples[:]
    reflections = ((0.019, 0.04), (0.051, 0.025)) if name == "reveal" else ((0.031, 0.085), (0.073, 0.047), (0.127, 0.027))
    for delay, level in reflections:
        shift = round(delay * RATE)
        for index in range(shift, count):
            reflected[index] += level * samples[index - shift]
    average = sum(reflected) / count
    duration = DURATIONS[name]
    faded = [(value - average) * smoothstep(0.0, 0.001, index / RATE)
             * (1.0 - smoothstep(duration - 0.15, duration - 0.02, index / RATE))
             if index < count - round(RATE * 0.02) else 0.0
             for index, value in enumerate(reflected)]
    assert all(math.isfinite(value) for value in faded)
    peak = max(abs(value) for value in faded)
    return [value * PEAK_TARGET / peak for value in faded]


def write_and_measure(name, samples):
    pcm = array("h", (round(value * 32767) for value in samples))
    if sys.byteorder != "little":
        pcm.byteswap()
    path = OUT / ("gallery-%s.wav" % name)
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(RATE)
        output.writeframes(pcm.tobytes())
    with wave.open(str(path), "rb") as output:
        channels, width, rate, frames, compression, _ = output.getparams()
        measured = array("h", output.readframes(frames))
    if sys.byteorder != "little":
        measured.byteswap()
    floats = [value / 32768.0 for value in measured]
    peak = max(abs(value) for value in floats)
    rms = math.sqrt(sum(value * value for value in floats) / frames)
    silent_tail = 0
    for value in reversed(measured):
        if value:
            break
        silent_tail += 1
    event_measurements = []
    for offset, label in EVENTS[name]:
        window = floats[round(offset * rate):round((offset + 0.12) * rate)]
        event_measurements.append({"at_seconds": round(offset, 3), "event": label,
                                   "following_120ms_peak_linear": round(max(abs(value) for value in window), 8)})
    report = {
        "file": path.name,
        "seed": SEED + list(DURATIONS).index(name),
        "channels": channels, "sample_rate_hz": rate, "sample_width_bits": width * 8,
        "format": "PCM16 little-endian WAV", "compression": compression,
        "frames": frames, "duration_seconds": frames / rate,
        "peak_linear": round(peak, 8), "peak_dbfs": round(20.0 * math.log10(peak), 4),
        "rms_linear": round(rms, 8), "rms_dbfs": round(20.0 * math.log10(rms), 4),
        "dc_offset_linear": round(sum(floats) / frames, 9),
        "maximum_adjacent_step_linear": round(max(abs(floats[i] - floats[i - 1]) for i in range(1, frames)), 8),
        "first_nonzero_at_seconds": next(i for i, value in enumerate(measured) if value) / rate,
        "silent_tail_samples": silent_tail, "silent_tail_seconds": silent_tail / rate,
        "finite_synthesis": all(math.isfinite(value) for value in samples),
        "clipped_samples": sum(abs(value) >= 32767 for value in measured),
        "events": event_measurements,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }
    assert channels == 1 and width == 2 and rate == RATE and compression == "NONE"
    assert frames == round(DURATIONS[name] * RATE)
    assert 0.599 <= peak <= 0.601
    assert silent_tail >= round(0.02 * RATE)
    assert report["clipped_samples"] == 0 and report["finite_synthesis"]
    assert abs(report["dc_offset_linear"]) < 0.003
    assert report["first_nonzero_at_seconds"] < 0.004
    assert all(item["following_120ms_peak_linear"] > 0.035 for item in event_measurements)
    return report


def main():
    reports = [write_and_measure(name, synthesize(name)) for name in DURATIONS]
    report = {"source": "Original deterministic procedural synthesis; no source recordings, sampled instruments or third-party audio.",
              "generator": Path(__file__).name, "effects": reports}
    (OUT / "gallery-validation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for result in reports:
        print("%s: %.2f s, peak %.5f, RMS %.2f dBFS, %d clipped, %.3f s silent tail" % (
            result["file"], result["duration_seconds"], result["peak_linear"], result["rms_dbfs"],
            result["clipped_samples"], result["silent_tail_seconds"]))


if __name__ == "__main__":
    main()

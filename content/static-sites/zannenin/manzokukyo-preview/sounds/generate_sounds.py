"""Original, deterministic physical-texture sound effects for the preview hall.

No recordings, downloaded samples, or third-party impulse responses are used.
Requires Python 3.10+, NumPy and SciPy. Outputs 44.1 kHz / stereo / PCM16 WAV.
"""

from pathlib import Path
import json
import math
import wave

import numpy as np
from scipy import signal

SR = 44100
OUT = Path(__file__).resolve().parent
RNG = np.random.default_rng(71442026)


def timeline(duration):
    return np.arange(round(duration * SR)) / SR


def filtered_noise(n, low=40, high=9000, order=2):
    x = RNG.normal(size=n)
    sos = signal.butter(order, [low, high], btype="bandpass", fs=SR, output="sos")
    x = signal.sosfilt(sos, x)
    return x / max(np.std(x), 1e-9)


def attack_decay(t, attack, decay):
    return (1 - np.exp(-np.maximum(t, 0) / attack)) * np.exp(-np.maximum(t, 0) / decay) * (t >= 0)


def layer(target, source, at=0.0, level=1.0):
    start = round(at * SR)
    end = min(len(target), start + len(source))
    if end > start:
        target[start:end] += source[:end-start] * level


def impact(duration=0.14, body=140, brightness=3000, soft=0.0025):
    t = timeline(duration)
    grains = filtered_noise(len(t), 170, brightness) * attack_decay(t, soft, 0.016)
    dull = filtered_noise(len(t), 35, 650) * attack_decay(t, 0.005, 0.025)
    pressure = np.sin(2 * np.pi * (body * t + 7 * (1 - np.exp(-t / 0.018))))
    pressure *= attack_decay(t, 0.002, 0.025)
    return grains * 0.34 + dull * 0.42 + pressure * 0.5


def modes(duration, frequencies, decays, level=1.0, attack=0.0018):
    """Inharmonic, gently unstable material modes, with no quantized melody."""
    t = timeline(duration)
    y = np.zeros_like(t)
    for i, (freq, decay) in enumerate(zip(frequencies, decays)):
        phase = 2 * np.pi * freq * t + 0.035 * np.sin(2 * np.pi * (2.1 + i * .63) * t)
        amp = 1 / ((i + 1) ** .78)
        y += amp * np.sin(phase) * attack_decay(t, attack, decay)
    return y * level / 1.8


def room(x, wet=0.2, decay=0.33, spread=0.65):
    """A generated, decorrelated stone-room response with damped reflections."""
    n = len(x)
    ir_n = min(round((decay * 2.7 + .06) * SR), n)
    t = np.arange(ir_n) / SR
    stereo = []
    for side in (-1, 1):
        ir = np.zeros(ir_n)
        for delay, gain in [(0.019,.28),(.041,.2),(.067,.15),(.099,.1),(.141,.075)]:
            idx = round((delay + side * .0029 * spread) * SR)
            if 0 < idx < ir_n:
                ir[idx] = gain * RNG.uniform(.82, 1.08)
        diffuse = filtered_noise(ir_n, 150, 4700)
        diffuse *= np.exp(-t / decay) * (1 - np.exp(-t / .048))
        diffuse[:round(.022 * SR)] = 0
        ir += diffuse * .007
        reflection = signal.fftconvolve(x, ir)[:n]
        stereo.append(x + wet * reflection)
    return np.stack(stereo, axis=1)


def make_tap():
    y = np.zeros(round(.24 * SR))
    layer(y, impact(.13, 245, 4700), .003, .66)
    layer(y, modes(.20, [756, 1547, 2911, 4203], [.043,.028,.014,.011]), .003, .18)
    layer(y, impact(.085, 390, 3800, .001), .026, .13)
    return room(y, .16, .075)


def make_step(variant):
    y = np.zeros(round(.8 * SR))
    layer(y, impact(.19, 95 + variant * 9, 2650), .004, .62)
    layer(y, impact(.17, 125 + variant * 7, 1950, .005), .075 + variant * .01, .37)
    t = timeline(.24)
    friction = filtered_noise(len(t), 440, 5100) * attack_decay(t, .025, .033)
    flutter = (.5 + .5 * np.sin(2 * np.pi * 83 * t)) ** 2
    layer(y, friction * flutter, .045, .20)
    layer(y, modes(.3, [186, 327, 517], [.033,.023,.015]), .02, .10)
    return room(y, .45, .21)


def make_discover():
    y = np.zeros(round(.88 * SR))
    for at, freq, amp in [(0.004,1379,.6),(.055,2213,.32),(.091,3271,.15)]:
        duration = .85-at
        layer(y, modes(duration, [freq, freq*1.481, freq*2.623], [.20,.11,.056], attack=.009), at, amp)
    t = timeline(.35)
    y[:len(t)] += filtered_noise(len(t), 2100, 7900) * attack_decay(t, .03, .072) * .035
    return room(y, .46, .23, 1.0)


def make_projector():
    t = timeline(.86)
    y = np.zeros_like(t)
    # A slightly irregular take-up reel: more mechanical rattle than a motor tone.
    for i, at in enumerate([.004,.058,.109,.157,.199,.244,.290,.337,.386,.439,.491,.551,.612]):
        layer(y, impact(.052, 225+(i%3)*42, 3700, .0008), at, .25 * (1-at/.9))
        layer(y, modes(.08, [475,1123,2395], [.012,.009,.004]), at+.006, .09)
    whirr = filtered_noise(len(t), 85, 860)
    modulation = .6+.22*np.sin(2*np.pi*36*t)+.1*np.sin(2*np.pi*69*t)
    whirr *= modulation * np.sin(np.pi * np.clip(t/.69, 0, 1)) ** 1.2
    y += whirr * .072
    return room(y, .19, .12)


def make_transmission():
    t = timeline(.78)
    y = np.zeros_like(t)
    layer(y, impact(.1, 360, 5600), .002, .2)
    # Filtered static flutter, small tuning-wheel rubs, and a paper-like release.
    band = filtered_noise(len(t), 520, 3700)
    flutter = (.53+.23*np.sin(2*np.pi*(11*t+12*t*t))+.19*np.sin(2*np.pi*43*t))
    env = attack_decay(t, .021, .13)
    y += band * flutter * env * .24
    for at, high, level in [(.083,4900,.06),(.179,6900,.055),(.307,3300,.036)]:
        st = timeline(.17)
        rub = filtered_noise(len(st), 1200, high) * attack_decay(st, .006, .027)
        layer(y, rub, at, level)
    # Low resonant cabinet material is quieter than the flutter.
    layer(y, modes(.58, [403, 621, 1276], [.11,.056,.028], attack=.009), .015, .016)
    return room(y, .24, .14)


def make_portrait():
    y = np.zeros(round(.80 * SR))
    layer(y, modes(.78, [829, 1437, 2249, 3651], [.19,.13,.067,.041], attack=.008), .005, .44)
    t = timeline(.20)
    layer(y, filtered_noise(len(t), 800, 4900) * attack_decay(t, .005, .014), .003, .068)
    return room(y, .41, .20, 1.0)


def make_door():
    duration = 2.25
    t = timeline(duration)
    y = np.zeros_like(t)
    # Two-part latch release gives a visual handle action a clear physical point.
    layer(y, impact(.23, 126, 3500, .0018), .009, .54)
    layer(y, modes(.24, [356, 794, 1459], [.055,.028,.013]), .012, .19)
    layer(y, impact(.22, 76, 2300), .102, .35)
    n = len(t)
    motion = np.sin(np.pi * np.clip((t-.17)/1.44, 0, 1)) ** 1.5
    slow_random = signal.sosfilt(signal.butter(2, 7, fs=SR, output="sos"), RNG.normal(size=n))
    slow_random /= max(np.std(slow_random), 1e-9)
    base = 94 + 39*np.sin(np.pi*np.clip((t-.18)/1.5,0,1)) + 4*slow_random
    phase = 2*np.pi*np.cumsum(base)/SR
    creak = sum(np.sin(phase*h + .16*np.sin(t*(13+h*3))) / h**1.45 for h in range(1,9))
    # Stick/slip windows vary continuously so the door never resembles an alarm.
    grip = np.clip(.43+.26*np.sin(2*np.pi*8.3*t)+.18*np.sin(2*np.pi*19.7*t)+.11*slow_random, .03, 1)
    y += creak * grip * motion * .18
    grain = filtered_noise(n, 160, 2400)
    y += grain * motion * grip * .059
    # A few irregular timber ticks and hinge scrapes during the movement.
    for at, amp, pitch in [(.34,.055,244),(.48,.046,319),(.79,.042,220),(1.02,.057,275),(1.34,.034,189)]:
        layer(y, impact(.075,pitch,2400,.001), at, amp)
    hall = filtered_noise(n, 55, 970)
    bloom = np.sin(np.pi*np.clip((t-.55)/1.7,0,1))**2
    y += hall * bloom * .051
    layer(y, impact(.28,65,1600,.009), 1.55, .15)
    return room(y, .44, .28, 1.0)


def make_enter():
    t = timeline(1.10)
    y = modes(1.10, [196, 311.2, 586.8, 1023], [.28,.26,.19,.10], attack=.065) * .19
    air = filtered_noise(len(t), 160, 2100)
    y += air * np.sin(np.pi*np.clip(t/.89,0,1))**2 * .022
    layer(y, modes(.78, [1638,2471], [.16,.10], attack=.032), .065, .055)
    return room(y, .53, .29, 1.0)


def export(name, stereo, peak):
    # DC rejection, short entrance guard and generous click-free terminal fade.
    stereo = signal.sosfilt(signal.butter(2, 28, btype="highpass", fs=SR, output="sos"), stereo, axis=0)
    count = len(stereo)
    fade_in = min(round(.001 * SR), count)
    fade_out = min(round(.075 * SR), count)
    stereo[:fade_in] *= np.linspace(0, 1, fade_in)[:,None]
    stereo[-fade_out:] *= np.linspace(1, 0, fade_out)[:,None] ** 2
    stereo *= peak / max(np.max(np.abs(stereo)), 1e-9)
    stereo[-round(.004 * SR):] = 0
    # TPDF dither is tiny; preserve the explicit silent guards exactly.
    dither = (RNG.random(stereo.shape) - RNG.random(stereo.shape)) / 65536
    dither[np.abs(stereo) < 1e-9] = 0
    pcm = np.round(np.clip(stereo + dither, -1, 1) * 32767).astype("<i2")
    target = OUT / name
    with wave.open(str(target), "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(SR)
        wav.writeframes(pcm.tobytes())
    with wave.open(str(target), "rb") as wav:
        assert wav.getnchannels() == 2 and wav.getsampwidth() == 2 and wav.getframerate() == SR
        samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2").astype(float) / 32768
        assert np.isfinite(samples).all()
        actual_peak = np.max(np.abs(samples))
        rms = np.sqrt(np.mean(samples**2))
        assert actual_peak < .55 and np.count_nonzero(samples[-300:]) == 0
        return {
            "file": name, "durationSeconds": round(wav.getnframes()/SR,3),
            "sampleRateHz": SR, "channels": 2, "bitsPerSample": 16,
            "peakDbFS": round(20*math.log10(max(actual_peak,1e-9)),2),
            "rmsDbFS": round(20*math.log10(max(rms,1e-9)),2),
            "bytes": target.stat().st_size, "silentTailMs": 4,
        }


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    recipes = [
        ("tap.wav", make_tap, .32),
        ("step-1.wav", lambda: make_step(0), .30),
        ("step-2.wav", lambda: make_step(1), .30),
        ("discover.wav", make_discover, .25),
        ("projector.wav", make_projector, .30),
        ("transmission.wav", make_transmission, .24),
        ("portrait.wav", make_portrait, .24),
        ("door-open.wav", make_door, .49),
        ("enter.wav", make_enter, .28),
    ]
    report = [export(name, recipe(), peak) for name, recipe, peak in recipes]
    (OUT / "validation.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()

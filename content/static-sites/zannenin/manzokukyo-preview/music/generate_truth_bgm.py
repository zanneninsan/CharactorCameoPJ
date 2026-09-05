"""Original, deterministic instrumental score for the Manzokukyo truth chamber.

All oscillators, envelopes and reverberation are synthesized here. No samples,
recordings, downloaded impulse responses, or external music models are used.
Run: python generate_truth_bgm.py [--output DIRECTORY]
Requires Python, numpy, scipy, soundfile and ffmpeg/ffprobe on PATH.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import re
import subprocess

import numpy as np
from scipy import signal
import soundfile as sf

SR = 44100
BPM = 64
BEAT = 60 / BPM
BAR = 4 * BEAT
DURATION = 16 * BAR  # Exactly 60 seconds, including the looped reverberation.
N = round(DURATION * SR)
SEED = 20260906
RNG = np.random.default_rng(SEED)

# MIDI notes are an executable score, not just names for arbitrary oscillators.
# Every harmony lasts two bars. The last D minor chord joins the first naturally.
CHORDS = [
    (0,  "Dm(add9)",   [50, 57, 60, 64, 65], 38),
    (2,  "Bbmaj9",     [46, 53, 57, 60, 62], 34),
    (4,  "Dm(add9)",   [50, 57, 64, 65, 69], 38),
    (6,  "C(add9)",    [48, 55, 62, 64, 67], 36),
    (8,  "Gm9",        [43, 50, 53, 57, 58], 31),
    (10, "Bbmaj7(#11)",[46, 53, 57, 62, 64], 34),
    (12, "A7sus4(b9)",[45, 52, 55, 58, 62], 33),
    (14, "Dm(add9)",   [50, 57, 60, 64, 65], 38),
]
MOTIFS = [
    # A: D5, A4, E5, F5. A': octave glint and a changed spatial response.
    (0,  [74, 69, 76, 77], 0.93),
    (4,  [74, 69, 76, 77], 1.00),
    # B transposes the contour into the G-minor harmony.
    (8,  [67, 62, 69, 70], 0.94),
    # Tension, then a two-bar return to the opening motif.
    (12, [69, 64, 70, 74], 0.86),
    (14, [74, 69, 76, 77], 0.72),
]


def hz(midi: int) -> float:
    return 440.0 * 2.0 ** ((midi - 69) / 12.0)


def smoothstep(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def add_wrapped(bus: np.ndarray, mono: np.ndarray, start: float,
                amplitude: float, pan: float = 0.0) -> None:
    """Circular scheduling carries every release across the 60-second boundary."""
    pan = np.clip(pan, -1, 1)
    gains = np.array([math.cos((pan + 1) * math.pi / 4),
                      math.sin((pan + 1) * math.pi / 4)]) * amplitude
    begin = round(start * SR) % N
    remaining = len(mono)
    source_at = 0
    while remaining:
        length = min(remaining, N - begin)
        bus[begin:begin + length] += mono[source_at:source_at + length, None] * gains
        remaining -= length
        source_at += length
        begin = 0


def choir_pad(midi: int, seconds: float, variation: int) -> np.ndarray:
    """Slow vowel-like additive synthesis: no recorded or intelligible voice."""
    t = np.arange(round(seconds * SR), dtype=np.float64) / SR
    fundamental = hz(midi)
    out = np.zeros_like(t)
    # Broad formants stay gentle. Individual detuned voices have independent phase.
    for cents, voice_gain in [(-4.6, .30), (0, .45), (4.0, .25)]:
        freq = fundamental * 2 ** (cents / 1200)
        phase = RNG.uniform(0, 2 * np.pi)
        vibrato = .035 * np.sin(2 * np.pi * (.19 + variation * .006) * t + phase)
        for harmonic in range(1, 17):
            partial = harmonic * freq
            if partial > 3600:
                break
            formants = (.85 * np.exp(-.5 * ((partial - 460) / 190) ** 2)
                        + .45 * np.exp(-.5 * ((partial - 1070) / 310) ** 2)
                        + .12 * np.exp(-.5 * ((partial - 2450) / 500) ** 2))
            weight = (0.17 + formants) / harmonic ** 1.18
            out += (voice_gain * weight *
                    np.sin(2 * np.pi * partial * t + harmonic * vibrato + phase))
    env = smoothstep(t / 1.65) * smoothstep((seconds - t) / 2.3)
    env *= .90 + .10 * np.sin(2 * np.pi * t / (seconds * 1.7) + variation * .7)
    return out * env


def bronze_bell(midi: int, seconds: float = 4.8, glass: bool = False) -> np.ndarray:
    t = np.arange(round(seconds * SR), dtype=np.float64) / SR
    frequency = hz(midi)
    out = np.zeros_like(t)
    # Mostly harmonic bronze body, with a quiet inharmonic glass overtone.
    ratios = [1, 2, 3.002, 4.018, 5.39, 6.80] if not glass else [1, 2.01, 3.99, 5.36]
    levels = [1, .28, .13, .055, .025, .012] if not glass else [.75, .22, .11, .035]
    for i, (ratio, level) in enumerate(zip(ratios, levels)):
        phase = RNG.uniform(-.08, .08)
        decay = (1.65 if not glass else 2.15) / (1 + i * .42)
        out += level * np.exp(-t / decay) * np.sin(2 * np.pi * frequency * ratio * t + phase)
    # A rounded mallet attack, not a sharp transient competing with the eye sound.
    env = smoothstep(t / .014) * smoothstep((seconds - t) / .45)
    return out * env


def low_pulse(midi: int, seconds: float = 1.8) -> np.ndarray:
    t = np.arange(round(seconds * SR), dtype=np.float64) / SR
    f = hz(midi)
    out = np.sin(2 * np.pi * f * t) + .13 * np.sin(2 * np.pi * f * 2 * t)
    env = smoothstep(t / .12) * np.exp(-t / .55) * smoothstep((seconds - t) / .3)
    return out * env


def shimmer(seconds: float, pitch: int) -> np.ndarray:
    t = np.arange(round(seconds * SR), dtype=np.float64) / SR
    # A faint, pitched light above the room. No riser or jumpscare swell.
    env = np.sin(np.pi * t / seconds) ** 3
    return (.65 * np.sin(2 * np.pi * hz(pitch) * t)
            + .20 * np.sin(2 * np.pi * hz(pitch + 12) * t)) * env


def reverberate_circular(dry: np.ndarray) -> np.ndarray:
    """Original synthetic hall, circular convolution preserves its full loop tail."""
    ir_n = round(4.4 * SR)
    t = np.arange(ir_n) / SR
    wet = np.empty_like(dry)
    for channel in range(2):
        noise = RNG.normal(0, 1, ir_n)
        # Diffuse brass-and-stone tail; high frequencies disappear before the body.
        noise = signal.sosfilt(signal.butter(2, [210, 4200], 'bandpass', fs=SR, output='sos'), noise)
        noise *= np.exp(-t / .93) * smoothstep((t - .095) / .10)
        noise *= smoothstep((4.4 - t) / .35)
        noise /= np.sqrt(np.sum(noise * noise))
        ir = np.zeros(N)
        ir[:ir_n] = noise * .40
        # Unequal left/right reflection timings provide space without phasey widening.
        for delay, gain in [(.037, .17), (.071, .12), (.113, .095), (.173, .07), (.281, .04)]:
            ir[round((delay + channel * .0083) * SR)] += gain
        source = .84 * dry[:, channel] + .16 * dry[:, 1 - channel]
        wet[:, channel] = np.fft.irfft(np.fft.rfft(source) * np.fft.rfft(ir), n=N)
    return wet


def render_score() -> np.ndarray:
    pads = np.zeros((N, 2), dtype=np.float64)
    bells = np.zeros_like(pads)
    bass = np.zeros_like(pads)
    air = np.zeros_like(pads)
    for chord_number, (bar, name, notes, root) in enumerate(CHORDS):
        for voice, midi in enumerate(notes):
            pan = [-.62, .46, -.28, .66, .08][voice]
            # Start the slow attack slightly before the bar to keep transitions breathing.
            note = choir_pad(midi, 2 * BAR + 2.5, chord_number + voice)
            add_wrapped(pads, note, bar * BAR - .7, .069 * [1, .92, .85, .70, .62][voice], pan)
        # A quiet root every bar, with selective, softer afterbeats; space stays open.
        for relative_bar in range(2):
            add_wrapped(bass, low_pulse(root), (bar + relative_bar) * BAR + .12,
                        .079 if relative_bar == 0 else .057, 0)
        if chord_number in [1, 3, 4, 6]:
            add_wrapped(bass, low_pulse(root + 12, 1.35), (bar + 1) * BAR + 2.65 * BEAT, .025, .07)

    rhythm = [.5, 2.25, 4.5, 6.5]
    for section, (bar, notes, strength) in enumerate(MOTIFS):
        for i, (midi, beat) in enumerate(zip(notes, rhythm)):
            pan = [-.30, .24, -.08, .36][i] * (-1 if section % 2 else 1)
            bell = bronze_bell(midi)
            add_wrapped(bells, bell, bar * BAR + beat * BEAT,
                        .114 * strength * [1, .72, .88, .78][i], pan)
            # Subtle opposite-wall echo, always quieter than the melody.
            add_wrapped(bells, bell, bar * BAR + beat * BEAT + .75 * BEAT,
                        .013 * strength, -pan)

    # Sparse replies distinguish A / A' / B, without filling every beat.
    for bar, beat, midi, amp, pan in [
        (3, .75, 77, .030, .48), (3, 2.5, 76, .027, -.33),
        (6, 2.5, 86, .021, .58), (7, 1.75, 79, .024, -.50),
        (9, 2.0, 62, .033, -.43), (11, 1.5, 69, .029, .35),
        (13, 3.0, 73, .020, -.20),
    ]:
        add_wrapped(bells, bronze_bell(midi, glass=True), bar * BAR + beat * BEAT, amp, pan)
    for bar, midi, pan in [(2.5, 81, -.70), (6.5, 86, .72), (10.5, 81, -.62), (14.0, 88, .64)]:
        add_wrapped(air, shimmer(5.0, midi), bar * BAR, .007, pan)

    # Pads receive more room than the close bell, bass remains dry and intelligible.
    wet = reverberate_circular(pads * .90 + bells * .74 + air)
    mix = pads + bells + bass + air + .50 * wet
    # A periodic FFT high-pass removes DC/subsonics without creating filter-edge seams.
    bins = np.fft.rfftfreq(N, 1 / SR)
    highpass = 1 - np.exp(-(bins / 31) ** 4)
    lowpass = 1 / np.sqrt(1 + (bins / 7400) ** 8)
    for channel in range(2):
        mix[:, channel] = np.fft.irfft(np.fft.rfft(mix[:, channel]) * highpass * lowpass, n=N)
    return mix


def run(command: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(command, check=True, capture_output=True)


def loudness(path: Path) -> dict:
    result = run(['ffmpeg', '-hide_banner', '-nostats', '-i', str(path), '-af',
                  'loudnorm=I=-19:TP=-2:LRA=11:print_format=json', '-f', 'null', '-'])
    report = result.stderr.decode('utf8', errors='replace')
    match = re.search(r'\{\s*"input_i".*?\}', report, re.S)
    if not match:
        raise RuntimeError('ffmpeg loudness report missing')
    data = json.loads(match.group(0))
    return {'integrated_lufs': float(data['input_i']),
            'true_peak_dbfs': float(data['input_tp']),
            'loudness_range_lu': float(data['input_lra']),
            'method': 'ffmpeg loudnorm EBU R128 input measurement'}


def inspect_audio(path: Path) -> dict:
    probe = json.loads(run(['ffprobe', '-v', 'error', '-show_streams', '-show_format',
                           '-of', 'json', str(path)]).stdout)
    raw = run(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'f32le',
               '-acodec', 'pcm_f32le', '-ar', str(SR), '-ac', '2', '-']).stdout
    pcm = np.frombuffer(raw, dtype='<f4').reshape(-1, 2).astype(np.float64)
    deltas = np.diff(pcm, axis=0)
    acceleration = np.diff(pcm, n=2, axis=0)
    boundary_delta = pcm[0] - pcm[-1]
    boundary_acceleration = (pcm[1] - pcm[0]) - boundary_delta
    p99 = np.percentile(np.abs(deltas), 99, axis=0)
    a99 = np.percentile(np.abs(acceleration), 99, axis=0)
    peak = np.max(np.abs(pcm))
    rms = np.sqrt(np.mean(pcm * pcm))
    stream = probe['streams'][0]
    seam_pass = bool(np.all(np.abs(boundary_delta) < np.maximum(.00015, 3 * p99))
                     and np.all(np.abs(boundary_acceleration) < np.maximum(.0002, 3 * a99)))
    return {
        'file': path.name,
        'bytes': path.stat().st_size,
        'codec': stream['codec_name'],
        'sample_rate': int(stream['sample_rate']),
        'channels': stream['channels'],
        'decoded_frames': len(pcm),
        'decoded_duration_seconds': len(pcm) / SR,
        'container_duration_seconds': float(probe['format'].get('duration', len(pcm) / SR)),
        'sample_peak_dbfs': float(20 * np.log10(max(peak, 1e-12))),
        'rms_dbfs': float(20 * np.log10(max(rms, 1e-12))),
        'silent_frames': int(np.count_nonzero(np.max(np.abs(pcm), axis=1) < 1e-7)),
        'loudness': loudness(path),
        'loop_seam': {
            'boundary_delta_left_right': boundary_delta.tolist(),
            'ordinary_delta_abs_p99_left_right': p99.tolist(),
            'boundary_derivative_change_left_right': boundary_acceleration.tolist(),
            'ordinary_derivative_change_abs_p99_left_right': a99.tolist(),
            'max_delta_abs': float(np.max(np.abs(deltas))),
            'pass': seam_pass,
            'criterion': 'Boundary value step and derivative change each below 3x ordinary 99th percentile (PCM quantization floors 0.00015 / 0.0002).',
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    print('Rendering 16-bar original score at 64 BPM...', flush=True)
    mix = render_score()
    raw_path = out / 'truth-chamber-bgm-render.wav'
    sf.write(raw_path, mix, SR, subtype='FLOAT')
    measured = loudness(raw_path)
    gain_db = min(-19 - measured['integrated_lufs'], -2.3 - measured['true_peak_dbfs'])
    mix *= 10 ** (gain_db / 20)
    if np.max(np.abs(mix)) >= 1:
        raise RuntimeError('Unexpected clipping')
    master = out / 'truth-chamber-bgm.wav'
    sf.write(master, mix, SR, subtype='PCM_16')
    raw_path.unlink()
    print(f'Mastered with {gain_db:+.2f} dB linear gain; encoding...', flush=True)
    common = ['ffmpeg', '-y', '-v', 'error', '-i', str(master), '-map_metadata', '-1',
              '-metadata', 'title=Truth Chamber — The Word Behind the Eye',
              '-metadata', 'comment=Original procedural instrumental; no third-party samples']
    flac = out / 'truth-chamber-bgm.flac'
    mp3 = out / 'truth-chamber-bgm.mp3'
    run(common + ['-c:a', 'flac', '-compression_level', '8', str(flac)])
    # MP3's MDCT sees silence outside a file, rather than the circular waveform.
    # A 16 ms rounded boundary window on the fallback only prevents that encoder
    # transient. The master and primary FLAC retain their unbroken circular tails.
    fallback_mix = mix.copy()
    edge_n = round(.016 * SR)
    edge = smoothstep(np.linspace(0, 1, edge_n))
    fallback_mix[:edge_n] *= edge[:, None]
    fallback_mix[-edge_n:] *= edge[::-1, None]
    fallback_source = out / 'truth-chamber-bgm-mp3-source.wav'
    sf.write(fallback_source, fallback_mix, SR, subtype='PCM_16')
    fallback_command = common.copy()
    fallback_command[fallback_command.index(str(master))] = str(fallback_source)
    run(fallback_command + ['-c:a', 'libmp3lame', '-b:a', '192k', '-write_xing', '1',
                            '-id3v2_version', '3', str(mp3)])
    fallback_source.unlink()
    print('Decoding and validating WAV, FLAC and MP3...', flush=True)
    reports = [inspect_audio(path) for path in [master, flac, mp3]]
    report = {
        'title': 'Truth Chamber — The Word Behind the Eye',
        'seed': SEED,
        'bpm': BPM,
        'bars': 16,
        'time_signature': '4/4',
        'nominal_duration_seconds': DURATION,
        'synthesis': 'Original additive instruments and circular synthetic reverberation; no external samples or impulse responses.',
        'normalization': {'type': 'linear gain, no limiter', 'target_lufs': -19, 'gain_db': gain_db},
        'arrangement': [{'bar': bar + 1, 'chord': name, 'midi_voices': voices, 'bass_midi': bass}
                        for bar, name, voices, bass in CHORDS],
        'formats': reports,
        'auditioned': False,
        'notes': [
            'WAV and FLAC are exact 60-second gapless PCM loops. HTMLMediaElement loop timing remains browser-dependent.',
            'MP3 is the compatibility fallback, carries encoder delay/padding metadata; container duration can exceed decoded duration.',
            'MP3 only: a 16 ms smoothstep window at each boundary prevents MDCT edge transients. No duration or silence is added; the primary FLAC and master are unchanged.',
            'Seam validation tests decoded values and slopes; it is not a substitute for listening.',
        ],
    }
    (out / 'truth-bgm-validation.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf8')
    for result in reports:
        print(json.dumps({key: result[key] for key in ['file', 'bytes', 'decoded_duration_seconds', 'sample_peak_dbfs', 'loudness', 'loop_seam']}, ensure_ascii=False), flush=True)
    if any(not result['loop_seam']['pass'] for result in reports):
        raise RuntimeError('An audio format failed seam validation')
    if any(result['loudness']['true_peak_dbfs'] > -2 for result in reports):
        raise RuntimeError('True peak exceeded headroom requirement')
    if any(abs(result['decoded_duration_seconds'] - DURATION) > 1 / SR for result in reports):
        raise RuntimeError('Decoded duration mismatch')


if __name__ == '__main__':
    main()

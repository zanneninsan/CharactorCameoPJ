"""Original synthesized meadow breeze; no external samples. Four-second soft gust."""
from pathlib import Path
import math
import random
import struct
import wave

rate, seconds = 22050, 4
rng = random.Random(916)
low = drift = 0.0
samples = []
for i in range(rate * seconds):
    t = i / rate
    low += .065 * (rng.uniform(-1, 1) - low)
    drift += .001 * (low - drift)
    envelope = math.sin(math.pi * t / seconds) ** .8
    gust = .72 + .20 * math.sin(t * 2.1) + .08 * math.sin(t * 7.7)
    samples.append((low - drift) * envelope * gust)
peak = max(map(abs, samples))
samples = [value * .52 / peak for value in samples]
output = Path(__file__).with_name('gallery-world-wind.wav')
with wave.open(str(output), 'wb') as sound:
    sound.setnchannels(1)
    sound.setsampwidth(2)
    sound.setframerate(rate)
    sound.writeframes(b''.join(struct.pack('<h', round(value * 32767)) for value in samples))
print(f'{output.name}: {seconds}s mono PCM, peak={max(map(abs, samples)):.2f}, rms={math.sqrt(sum(v*v for v in samples)/len(samples)):.3f}')

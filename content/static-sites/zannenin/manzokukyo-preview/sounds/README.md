# Manzokukyo corridor: original sound effects

These nine effects are **procedurally synthesized sounds, not recordings**. They use original layered noise, inharmonic material resonators, mechanical micro-impacts, and a generated stereo room response. No downloaded samples or third-party impulse responses are incorporated.

All files are 44.1 kHz, stereo, uncompressed PCM16 WAV. The short, damped room reflections are already rendered into the assets; additional Web Audio reverb is unnecessary. Sources have generous headroom, no clipping, click-free fades, and a short silent terminal guard. `validation.json` contains format, duration, peak and RMS measurements from reopening the written WAVs.

| File | Character | Suggested action | Duration |
| --- | --- | --- | --- |
| `tap.wav` | Soft metal latch touching stone | Interface activation | 0.24 s |
| `step-1.wav` | Heel, sole, fine grit, stone reflections | Left step | 0.80 s |
| `step-2.wav` | Alternate heel and sole timbre | Right step | 0.80 s |
| `discover.wav` | Small irregular glass/metal shimmer | An object comes into reach | 0.88 s |
| `projector.wav` | Reel clicks and motor friction | Anime projector activation | 0.86 s |
| `transmission.wav` | Filtered static, flutter, tuning-wheel friction | X/radio object activation | 0.78 s |
| `portrait.wav` | Touched glass and delicate frame resonance | Character portrait activation | 0.80 s |
| `door-open.wav` | Double latch, low timber creak, hinge friction, hall air | Door begins opening | 2.25 s |
| `enter.wav` | Soft low room resonance with an airy upper tail | Sound consent / arrival | 1.10 s |

## Integration

- Load/decode after or around the first consent dialog; call `AudioContext.resume()` directly in the user's "sound on" click. Report successful audio activation only after resume succeeds.
- Run every effect and the ambience through one master gain and obey the persistent sound toggle. Start a master around 0.65, with footstep gains around 0.45 and door gain around 0.8 relative to the other effects, then audition in the full mix.
- Alternate the two footsteps on actual forward progress. A minimum step gap of 330-450 ms prevents repeated scroll/touch events from turning them into a machine gun. Apply only tiny playback-rate variation (approximately 0.96-1.04).
- Play discovery once per object on first approach, with a 500 ms global minimum interval. Do not replay discovery on every frame or pointer move.
- Activate an object-specific effect immediately when clicked. Preserve a direct anchor for the destination and respect modified clicks and keyboard use. For links in the current tab, a short deliberate departure animation can let the action sound read before navigation; do not insert a long forced wait.
- Synchronize the first door latch with the handle/door action. The main door movement runs approximately 0.17-1.6 s; the remaining 0.65 s is the hall-air tail.
- Fade the master on mute/visibility loss and stop running loop sources. Resume ambience only while consent is active and the page is visible.

## Regenerate

Run `python generate_sounds.py` with NumPy and SciPy available. Generation uses a fixed seed and writes assets plus `validation.json` beside the script. The generator performs PCM format, finite sample, peak, and silent-tail assertions.

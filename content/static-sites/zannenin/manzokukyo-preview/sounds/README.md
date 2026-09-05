# Manzokukyo corridor: original sound effects

The nine corridor effects, five offering effects and one truth-chamber effect are **procedurally synthesized sounds, not recordings**. The corridor sounds use original layered noise, inharmonic material resonators, mechanical micro-impacts, and a generated stereo room response. No downloaded samples or third-party impulse responses are incorporated.

Corridor files are 44.1 kHz stereo PCM16 WAV. The short, damped room reflections are already rendered into the assets; additional Web Audio reverb is unnecessary. Sources have generous headroom, no clipping, click-free fades, and a short silent terminal guard. `validation.json` contains format, duration, peak and RMS measurements from reopening the written WAVs.

The five offering files are 24 kHz mono PCM16 WAV, synthesized with Python's standard library. `offering-empty.wav` is a comic descending tone (0.60 s); `offering-coin.wav` is a coin dropping into a box (0.70 s); `offering-note.wav` is a paper flutter (0.60 s); `offering-blessing.wav` is a celebratory arpeggio (1.10 s); `offering-royal.wav` is a fanfare (1.80 s). Their measured peak is at most 0.62, with a silent 20 ms tail. Reproduce them with `python generate_offering_sounds.py`; `offering-validation.json` records the measurements. Closing the offering dialog cancels only its current effects, leaving the ambience under the existing sound controls.

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
| `truth-denied.wav` | Low impact, taut bronze and held breath, slow retreat | Truth chamber eye lunges after a wrong word | 2.80 s |

The truth-chamber effect is 24 kHz mono PCM16, synthesized with Python's standard library. It reaches its attack in the first 180 ms, holds tension until about 0.6 s and decays with the eye's retreat. Reproduce it with `python generate_truth_sound.py`; `truth-validation.json` records a measured peak below 0.60 and a silent tail longer than 20 ms. Only the truth page requests this extra sound. Repeated mistakes, success, the guestbook and page hiding cancel its previous playback; the existing consent, volume and mute controls still apply.

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

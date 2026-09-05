# Manzokukyo corridor: original sound effects

The nine corridor effects, five offering effects, one truth-chamber effect and five gallery effects are **procedurally synthesized sounds, not recordings**. The corridor sounds use original layered noise, inharmonic material resonators, mechanical micro-impacts, and a generated stereo room response. No downloaded samples or third-party impulse responses are incorporated.

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
| `gallery-reveal.wav` | Dry paper fold, fine gold-leaf friction and a faint frame shimmer | Reveal a gallery record | 0.64 s |
| `gallery-collect.wav` | Immediate heavy seal impact, followed by one clear bell | Collect a seal | 1.10 s |
| `gallery-complete.wav` | Six ascending, softly resonant bell notes | All six seals are collected | 2.40 s |
| `gallery-unseal.wav` | Six metal clasps, low room resonance, warm bell chord | The collected seals release the lock | 4.40 s |
| `gallery-door.wav` | Weighty latch, uneven timber and hinge creaks, hall air | Open the red door | 1.80 s |

The truth-chamber effect is 24 kHz mono PCM16, synthesized with Python's standard library. It reaches its attack in the first 180 ms, holds tension until about 0.6 s and decays with the eye's retreat. Reproduce it with `python generate_truth_sound.py`; `truth-validation.json` records a measured peak below 0.60 and a silent tail longer than 20 ms. Only the truth page requests this extra sound. Repeated mistakes, success, the guestbook and page hiding cancel its previous playback; the existing consent, volume and mute controls still apply.

The gallery files are original 24 kHz mono PCM16 WAVs. Reproduce them with `python generate_gallery_sounds.py`; only Python's standard library is required. Dry filtered noise, damped material modes, hand-composed bell tones and quiet generated wall reflections suggest a restrained, slightly unsettling museum. The reveal is intentionally short and dry. The collection impact begins immediately, with its bell at 0.080 s. The completion's six notes begin at 0, 0.24, 0.48, 0.72, 0.96 and 1.20 s. The unlock sound releases six clasps at exactly 0, 0.35, 0.70, 1.05, 1.40 and 1.75 s; low resonance enters at 2.50 s and the warm bell chord at 3.20 s. Keep the unlock playback rate at 1 when synchronizing these events with animation.

`gallery-validation.json` measures the written files, including each event's following 120 ms, peak/RMS, DC offset, format, first onset, silent tail and SHA-256. Each file targets a 0.60 peak, has no clipped samples, fades smoothly and ends with at least 20 ms of digital silence. No recordings, sampled instruments, external sound libraries or third-party impulse responses are used. Gallery actions use the shared session's effect gain and existing sound consent/mute controls; adding these files does not change the listener's setting.

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

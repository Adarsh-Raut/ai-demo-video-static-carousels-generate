"""Our own cartoon "whoop" hop sounds for audio/sfx (synthesised, no licence needed).

Usage: python whoop.py <out_dir>
Writes whoop-a.wav and whoop-b.wav (a little higher). Each rises for 0.17 s and peaks there
(media.ts places it so that peak lands on the picture), then a short settle.
"""
import sys

import numpy as np
import soundfile as sf

SR = 48000


def lowpass(x, fc):
    a = np.exp(-2 * np.pi * fc / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def whoop(base, top):
    rise, hold = 0.17, 0.16
    n = int((rise + hold) * SR)
    t = np.arange(n) / SR
    # Rising glide (ease-out) up to the peak, a tiny overshoot, then settle; light wobble.
    k = np.clip(t / rise, 0, 1)
    f = base * (top / base) ** (1 - (1 - k) ** 2)
    f = np.where(t < rise, f, top * (1 + 0.04 * np.exp(-(t - rise) / 0.03)))
    f *= 1 + 0.015 * np.sin(2 * np.pi * 26 * t)
    ph = 2 * np.pi * np.cumsum(f) / SR
    # Rounded square-ish tone with a second harmonic: voice-like, cartoon "woop".
    x = np.tanh(2.2 * np.sin(ph)) + 0.35 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph)
    x = lowpass(x, 2600)
    e = np.minimum(1, t / 0.02) * np.where(t < rise, 0.75 + 0.25 * k, np.exp(-(t - rise) / 0.07))
    y = x * e
    return (y / np.max(np.abs(y)) * 0.9).astype(np.float32)


out = sys.argv[1] if len(sys.argv) > 1 else "."
sf.write(f"{out}/whoop-a.wav", whoop(230, 640), SR)
sf.write(f"{out}/whoop-b.wav", whoop(260, 720), SR)
print("wrote whoop-a.wav, whoop-b.wav")

"""Beat grid of a music track, numpy only.

Usage: python beats.py <mono float32 raw file at 22050 Hz> <out.json>
(src/beats.ts decodes any format to that with ffmpeg first.)

1. Onset strength: positive spectral flux of a log-magnitude STFT (hop 256, ~86 frames/s).
2. Tempo: autocorrelation of the onset envelope, weighted toward ~115 BPM (60-180 BPM range).
3. Beats: dynamic programming (Ellis 2007), which places each beat on an onset while
   keeping the spacing close to the tempo.
4. Downbeats: of the four phases of every-4th beat, the one with the most low-end (kick and
   bass) onset energy.
Writes {"bpm", "beats": [s...], "downbeats": [s...], "confidence"}.
"""
import json
import sys

import numpy as np

SR = 22050
HOP = 256
NFFT = 1024
FPS = SR / HOP


def stft_mag(x):
    win = np.hanning(NFFT).astype(np.float32)
    n = 1 + max(0, (len(x) - NFFT) // HOP)
    idx = np.arange(NFFT)[None, :] + HOP * np.arange(n)[:, None]
    return np.abs(np.fft.rfft(x[idx] * win, axis=1))


def flux(mag):
    lm = np.log1p(100 * mag)
    d = np.diff(lm, axis=0, prepend=lm[:1])
    return np.maximum(d, 0)


def normalize(env):
    k = int(FPS * 0.5)
    trend = np.convolve(env, np.ones(k) / k, mode="same")
    env = np.maximum(env - trend, 0)
    return env / (env.std() + 1e-9)


def tempo(env):
    lo, hi = int(FPS * 60 / 180), int(FPS * 60 / 60)
    e = env - env.mean()
    ac = np.correlate(e, e, mode="full")[len(e) - 1 :][: hi + 2]
    lags = np.arange(lo, hi + 1)
    bpm = 60 * FPS / lags
    prior = np.exp(-0.5 * (np.log2(bpm / 115) / 0.9) ** 2)
    score = ac[lags] * prior
    i = int(np.argmax(score))
    # parabolic refinement of the lag
    if 0 < i < len(lags) - 1:
        a, b, c = score[i - 1], score[i], score[i + 1]
        off = 0.5 * (a - c) / (a - 2 * b + c + 1e-12)
    else:
        off = 0.0
    period = lags[i] + off
    conf = float(ac[lags[i]] / (ac[0] + 1e-9))
    return period, conf


def track(env, period, alpha=400.0):
    n = len(env)
    score = env.astype(np.float64).copy()
    back = -np.ones(n, dtype=int)
    lo, hi = int(round(period / 2)), int(round(period * 2))
    prev = np.arange(-hi, -lo + 1)
    pen = -alpha * np.log(-prev / period) ** 2
    for t in range(hi, n):
        cand = score[t + prev] + pen
        j = int(np.argmax(cand))
        score[t] = env[t] + cand[j]
        back[t] = t + prev[j]
    # end on the best-scoring frame within the last period
    tail = np.arange(max(0, n - int(period)), n)
    t = int(tail[np.argmax(score[tail])])
    beats = [t]
    while back[t] >= 0:
        t = back[t]
        beats.append(t)
    beats = np.array(beats[::-1])
    # extend backwards to the start of the track at the tempo
    while beats[0] - period > 0:
        beats = np.insert(beats, 0, int(round(beats[0] - period)))
    return beats


def main():
    x = np.fromfile(sys.argv[1], dtype=np.float32)
    mag = stft_mag(x)
    fl = flux(mag)
    env = normalize(fl.sum(axis=1))
    freqs = np.fft.rfftfreq(NFFT, 1 / SR)
    low = normalize(fl[:, freqs < 180].sum(axis=1))
    period, conf = tempo(env)
    frames = track(env, period)
    # snap each beat to the strongest onset within ±2 frames
    snapped = []
    for f in frames:
        a, b = max(0, f - 2), min(len(env), f + 3)
        snapped.append(a + int(np.argmax(env[a:b])))
    frames = np.array(snapped)
    # The tracker can lock onto the off-beat (hats and bass between kicks). Kicks carry the
    # most low-end onset energy, so keep whichever train has more of it.
    half = int(round(period / 2))
    on = low[frames[frames < len(low)]].mean()
    shifted = frames + half
    shifted = shifted[shifted < len(low)]
    if len(shifted) and low[shifted].mean() > 1.15 * on:
        frames = shifted
    phase = int(np.argmax([low[frames[p::4]].mean() if len(frames[p::4]) else 0 for p in range(4)]))
    times = frames / FPS + NFFT / 2 / SR  # a frame's flux peaks half a window before the attack
    # skip silence at the very start: the first beat must have some energy
    rms = np.sqrt(np.convolve(x**2, np.ones(HOP) / HOP, mode="same"))[::HOP]
    floor = 0.05 * rms.max()
    keep = [i for i, f in enumerate(frames) if rms[min(f, len(rms) - 1)] > floor]
    first = keep[0] if keep else 0
    beats = times[first:]
    downs = [t for i, t in enumerate(times) if i >= first and (i - phase) % 4 == 0]
    bpm = 60 * FPS / period
    json.dump(
        {"bpm": round(float(bpm), 2), "confidence": round(conf, 3), "beats": [round(float(t), 4) for t in beats], "downbeats": [round(float(t), 4) for t in downs]},
        open(sys.argv[2], "w"),
    )


main()

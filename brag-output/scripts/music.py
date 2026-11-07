"""Soundtrack for the vihara.ai brag: 120 BPM, C major, 22 s, music and SFX as one piece.

Every event sits on the beat grid counted from 0 s (beat = 0.5 s). Writes music.wav (48 kHz stereo).
"""
import sys
import numpy as np
import soundfile as sf

SR = 48000
BPM = 120
BEAT = 60 / BPM
DUR = 22.0
N = int(SR * DUR)
rng = np.random.default_rng(7)

L = np.zeros(N)
R = np.zeros(N)
verb_send = np.zeros(N)


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def place(sig, t, gain=1.0, pan=0.0, verb=0.0):
    i = int(round(t * SR))
    if i >= N:
        return
    sig = sig[: N - i]
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    L[i : i + len(sig)] += sig * gain * l * 1.414
    R[i : i + len(sig)] += sig * gain * r * 1.414
    verb_send[i : i + len(sig)] += sig * gain * verb


def env(n, a=0.005, d=0.2, s=0.0, rel=0.05, hold=None):
    t = np.arange(n) / SR
    e = np.where(t < a, t / a, s + (1 - s) * np.exp(-(t - a) / d))
    if hold is not None:
        k = int(hold * SR)
        if k < n:
            e[k:] *= np.exp(-np.arange(n - k) / SR / rel)
    return e


def lowpass(x, fc):
    a = np.exp(-2 * np.pi * fc / SR)
    y = np.zeros_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = (1 - a) * x[i] + a * acc
        y[i] = acc
    return y


def lp_fast(x, fc, passes=2):
    # one-pole lowpass via cumulative filter in blocks (vectorised with lfilter-free trick)
    a = np.exp(-2 * np.pi * fc / SR)
    for _ in range(passes):
        y = np.empty_like(x)
        acc = 0.0
        # chunked python loop is slow for long signals; use recursive doubling instead
        y = _iir1(x, a)
        x = y
    return x


def _iir1(x, a):
    # y[n] = (1-a) x[n] + a y[n-1], computed exactly with blockwise scan
    out = np.empty_like(x)
    B = 4096
    prev = 0.0
    powers = a ** np.arange(1, B + 1)
    for s in range(0, len(x), B):
        blk = (1 - a) * x[s : s + B]
        n = len(blk)
        # convolution of blk with a^k kernel via cumulative trick
        k = a ** np.arange(n)
        y = np.convolve(blk, k)[:n] + prev * powers[:n]
        out[s : s + n] = y
        prev = y[-1]
    return out


def highpass(x, fc):
    return x - lp_fast(x, fc, 1)


def saw(f, n, detune=0.0):
    t = np.arange(n) / SR
    out = np.zeros(n)
    for d in (-detune, 0, detune) if detune else (0,):
        ph = (t * f * (1 + d) + rng.random()) % 1.0
        out += 2 * ph - 1
    return out / (3 if detune else 1)


# ---------- instruments ----------

def kick(level=1.0):
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    f = 48 + 110 * np.exp(-t / 0.035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / 0.18)
    click = rng.standard_normal(n) * np.exp(-t / 0.003) * 0.15
    return (body + click) * level


def hat(open_=False):
    n = int((0.25 if open_ else 0.06) * SR)
    x = highpass(rng.standard_normal(n), 7000)
    return x * env(n, 0.001, 0.09 if open_ else 0.018)


def clap():
    n = int(0.3 * SR)
    x = rng.standard_normal(n)
    x = highpass(lp_fast(x, 2600), 900)
    e = np.zeros(n)
    for k, off in enumerate((0, 0.009, 0.018)):
        i = int(off * SR)
        e[i:] += np.exp(-np.arange(n - i) / SR / (0.006 if k < 2 else 0.11))
    return x * e * 0.9


def bass(m, length):
    n = int(length * SR)
    f = hz(m)
    t = np.arange(n) / SR
    sub = np.sin(2 * np.pi * f * t)
    grit = lp_fast(saw(f, n), 420) * 0.6
    return (sub + grit) * env(n, 0.006, 0.6, 0.55, 0.03, hold=length - 0.03)


def pad(notes, length):
    n = int(length * SR)
    x = sum(saw(hz(m), n, detune=0.004) for m in notes) / len(notes)
    x = lp_fast(x, 1500)
    t = np.arange(n) / SR
    e = np.minimum(1, t / 0.25) * np.minimum(1, (length - t) / 0.3).clip(0, 1)
    return x * e


def pluck(m, length=0.9, bright=0.5):
    # Karplus-Strong
    f = hz(m)
    p = int(SR / f)
    n = int(length * SR)
    buf = lp_fast(rng.standard_normal(p), 2000 + 6000 * bright, 1)
    out = np.zeros(n)
    out[:p] = buf
    for i in range(p + 1, n):
        out[i] = 0.497 * (out[i - p] + out[i - p - 1])
    t = np.arange(n) / SR
    return out * np.exp(-t / (length * 0.45)) * 0.9


def swell(length, peak_at_end=True):
    n = int(length * SR)
    x = rng.standard_normal(n)
    t = np.arange(n) / SR
    e = (t / length) ** 2.2
    x = highpass(lp_fast(x, 3500), 500)
    return x * e * 0.5


def tick():
    n = int(0.025 * SR)
    x = highpass(rng.standard_normal(n), 3000)
    return x * env(n, 0.0005, 0.004)


# ---------- arrangement ----------

C, G, Am, F = [48, 52, 55, 60], [43, 50, 55, 59], [45, 52, 57, 60], [41, 48, 53, 57]
prog = [C, G, Am, F]
roots = {0: 36, 1: 31, 2: 33, 3: 29}
bars = int(DUR / (4 * BEAT))  # 11

for b in range(bars):
    t0 = b * 4 * BEAT
    ch = prog[b % 4]
    final = b >= 10  # 20-22 s: closing chord only
    if final:
        place(pad([48, 55, 60, 64, 67], 2.0), t0, 0.34, verb=0.5)
        place(bass(36, 1.9), t0, 0.5)
        place(kick(), t0, 0.8)
        for k, m in enumerate([72, 76, 79, 84]):
            place(pluck(m, 1.6, 0.4), t0 + k * BEAT / 2, 0.20, pan=-0.3 + 0.2 * k, verb=0.6)
        continue
    place(pad([m + 12 for m in ch], 4 * BEAT + 0.05), t0, 0.22, verb=0.4)
    typing = 4.0 <= t0 < 8.0
    for k in range(4):
        tb = t0 + k * BEAT
        if not (typing and k % 2 == 1):
            place(kick(), tb, 0.85)
        # bass on the off-beat (house pump)
        place(bass(roots[b % 4] + (12 if k == 3 and b % 2 else 0), BEAT * 0.45), tb + BEAT / 2, 0.42)
        place(hat(), tb + BEAT / 2, 0.16, pan=0.25)
        if t0 >= 8.0:
            place(hat(), tb, 0.07, pan=-0.25)
            place(hat(), tb + BEAT * 0.25, 0.05, pan=0.3)
            place(hat(), tb + BEAT * 0.75, 0.05, pan=0.3)
        if k in (1, 3) and t0 >= 8.0:
            place(clap(), tb, 0.38, verb=0.25)
    # melody arp from 12 s on: chord tones in eighths
    if 12.0 <= t0 < 17.0:
        tones = [m + 24 for m in ch[1:]] + [ch[1] + 36]
        for k in range(8):
            place(pluck(tones[k % 4], 0.5, 0.35), t0 + k * BEAT / 2, 0.08, pan=0.4 * (-1) ** k, verb=0.35)

# --- hook: Bid. List. Sell. All with AI. ---
for t, m in ((0.0, 72), (0.5, 76), (1.0, 79)):
    place(pluck(m, 1.0, 0.6), t, 0.30, pan=0.0, verb=0.35)
for m in (60, 64, 67, 72, 76):
    place(pluck(m, 1.4, 0.5), 1.5, 0.16, verb=0.45)

# --- scene changes: swell peaking on the downbeat ---
for t in (4.0, 8.0, 12.0, 17.0):
    place(swell(1.0), t - 1.0, 0.16, verb=0.3)
place(kick(1.2), 17.0, 0.5)  # extra weight on the outro panel
place(pad([36, 48, 55, 64], 1.2), 17.0, 0.18, verb=0.6)

# --- scene 2: typing 4.4-5.9 on 16ths, enter + cards ---
t = 4.5
while t < 5.95:
    place(tick(), t, 0.10, pan=rng.uniform(-0.2, 0.2))
    t += BEAT / 4
place(clap(), 6.0, 0.30, verb=0.3)
for k, m in enumerate((69, 72, 76)):  # Am chord tones, bar starting 4 s is G, 6 s is Am
    place(pluck(m, 0.8, 0.5), 6.0 + k * 0.25, 0.20, pan=-0.3 + 0.3 * k, verb=0.3)

# --- scene 3: ring spins on 9, 10, 11 ---
for t, m in ((9.0, 79), (10.0, 81), (11.0, 77)):
    place(swell(0.45), t - 0.45, 0.10)
    place(pluck(m, 0.7, 0.5), t, 0.16, verb=0.35)

# --- scene 4: stats land on 12.5, 13.0, 13.5 (on beats) ---
for t, m in ((12.5, 72), (13.0, 76), (13.5, 79)):
    place(pluck(m, 0.9, 0.6), t, 0.22, verb=0.35)

# --- reverb (exponential noise IR) ---
irn = int(1.6 * SR)
ir = rng.standard_normal(irn) * np.exp(-np.arange(irn) / SR / 0.45)
ir = lp_fast(ir, 5000, 1)
ir /= np.sqrt(np.sum(ir**2))
from numpy.fft import rfft, irfft

m = 1 << int(np.ceil(np.log2(N + irn)))
wet = irfft(rfft(verb_send, m) * rfft(ir, m), m)[:N] * 0.35
L += wet
R += np.roll(wet, int(0.011 * SR))

# --- fade the tail, soft clip ---
fade = int(1.2 * SR)
for ch_ in (L, R):
    ch_[-fade:] *= np.linspace(1, 0, fade) ** 1.5
mix = np.stack([L, R], 1)
mix /= np.max(np.abs(mix)) / 0.9
mix = np.tanh(mix * 1.1) / np.tanh(1.1)
sf.write(sys.argv[1] if len(sys.argv) > 1 else "music.wav", mix, SR)
print("wrote", mix.shape[0] / SR, "s")

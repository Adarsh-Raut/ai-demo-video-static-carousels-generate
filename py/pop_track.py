"""An original upbeat pop track for motion videos, synthesised locally with numpy.

Usage: python pop_track.py <out.wav> [--bpm 101.8] [--bars 12] [--tail 1.4] [--hops 22,24,25,26,27]

Style target: a bright, bouncy launch-video bed (punchy kick, deep bouncing bass, claps,
a marimba-like pluck, a glassy FM bell hook, a soft pumping pad) with pitched "whoop" hops
on chosen beats. Key E minor, chords Em - C - G - D, one per bar.
Structure (bars from 0): bar 0 sparse intro (pluck + bell), bars 1..N-2 full groove,
last bar a final hit that rings out. --hops are absolute beat numbers (bar * 4 + beat)
where a whoop lands (peaks on the beat).
"""
import argparse

import numpy as np
import soundfile as sf

p = argparse.ArgumentParser()
p.add_argument("out")
p.add_argument("--bpm", type=float, default=101.8)
p.add_argument("--bars", type=int, default=12)
p.add_argument("--tail", type=float, default=1.4)
p.add_argument("--hops", default="22,24,25,26,27")
p.add_argument("--seed", type=int, default=3)
a = p.parse_args()

SR = 48000
BEAT = 60 / a.bpm
BAR = 4 * BEAT
DUR = a.bars * BAR + a.tail
N = int(DUR * SR)
rng = np.random.default_rng(a.seed)
L = np.zeros(N)
R = np.zeros(N)
SEND = np.zeros(N)  # reverb send
KICKS = []  # kick times, for the sidechain pump


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def iir1(x, fc):
    """One-pole low-pass, blockwise-exact."""
    a1 = np.exp(-2 * np.pi * fc / SR)
    out = np.empty_like(x)
    B = 4096
    prev = 0.0
    pw = a1 ** np.arange(1, B + 1)
    for s in range(0, len(x), B):
        blk = (1 - a1) * x[s : s + B]
        n = len(blk)
        y = np.convolve(blk, a1 ** np.arange(n))[:n] + prev * pw[:n]
        out[s : s + n] = y
        prev = y[-1]
    return out


def lp(x, fc, passes=2):
    for _ in range(passes):
        x = iir1(x, fc)
    return x


def hp(x, fc):
    return x - iir1(x, fc)


def place(sig, t, gain=1.0, pan=0.0, verb=0.0, duck=True):
    i = int(round(t * SR))
    if i >= N or i + len(sig) <= 0:
        return
    if i < 0:
        sig, i = sig[-i:], 0
    sig = sig[: N - i] * gain
    l, r = np.cos((pan + 1) * np.pi / 4) * 1.414, np.sin((pan + 1) * np.pi / 4) * 1.414
    tgt = (L, R) if not duck else (DL, DR)
    tgt[0][i : i + len(sig)] += sig * l
    tgt[1][i : i + len(sig)] += sig * r
    SEND[i : i + len(sig)] += sig * verb


# Ducked bus (pumped by the kick) and dry bus (drums, never ducked).
DL = np.zeros(N)
DR = np.zeros(N)


def env(n, a=0.003, d=0.2):
    t = np.arange(n) / SR
    return np.minimum(1, t / a) * np.exp(-t / d)


# ---------- instruments ----------

def kick():
    n = int(0.42 * SR)
    t = np.arange(n) / SR
    f = 46 + 120 * np.exp(-t / 0.028)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.2)
    click = hp(rng.standard_normal(n), 2500) * np.exp(-t / 0.004) * 0.35
    return np.tanh(1.6 * (body + click)) * 0.95


def clap():
    """Big, bright backbeat: a layered clap over a snare body with a long noise tail."""
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    x = hp(lp(rng.standard_normal(n), 5200, 1), 900)
    e = np.zeros(n)
    for k, off in enumerate((0, 0.009, 0.018, 0.027)):
        i = int(off * SR)
        e[i:] += np.exp(-np.arange(n - i) / SR / (0.006 if k < 3 else 0.2))
    tail = hp(rng.standard_normal(n), 2500) * np.exp(-t / 0.16) * 0.5
    body = np.sin(2 * np.pi * (190 + 60 * np.exp(-t / 0.01)) * t) * np.exp(-t / 0.06) * 0.6
    return np.tanh(1.4 * (x * e + tail + body)) * 0.9


def shaker():
    n = int(0.07 * SR)
    t = np.arange(n) / SR
    return hp(rng.standard_normal(n), 6500) * np.minimum(1, t / 0.012) * np.exp(-t / 0.025)


def bass(m, length):
    """Deep bouncing bass: sine + a little saturation, quick pluck then sustain."""
    n = int(length * SR)
    t = np.arange(n) / SR
    f = hz(m)
    x = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t)
    e = np.minimum(1, t / 0.004) * (0.55 + 0.45 * np.exp(-t / 0.09)) * np.minimum(1, (length - t) / 0.02).clip(0, 1)
    return np.tanh(1.8 * x * e) * 0.8


def marimba(m, length=0.5):
    n = int(length * SR)
    t = np.arange(n) / SR
    f = hz(m)
    x = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.22) + 0.5 * np.sin(2 * np.pi * f * 3.93 * t) * np.exp(-t / 0.04)
    return x * np.minimum(1, t / 0.002) * 0.55


def bell(m, length=0.9):
    """Glassy FM bell: modulator at 3.5x, index falling fast."""
    n = int(length * SR)
    t = np.arange(n) / SR
    f = hz(m)
    idx = 3.2 * np.exp(-t / 0.08) + 0.4
    x = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * 3.5 * t))
    return x * np.minimum(1, t / 0.002) * np.exp(-t / 0.35) * 0.4


def pad(notes, length):
    n = int(length * SR)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for m in notes:
        for d in (-0.006, 0.0, 0.006):
            ph = (t * hz(m) * (1 + d) + rng.random()) % 1
            x += 2 * ph - 1
    x = lp(x / (3 * len(notes)), 1800)
    return x * np.minimum(1, t / 0.15) * np.minimum(1, (length - t) / 0.2).clip(0, 1) * 0.5


def whoop(peak_t):
    """A pitched hop: a quick rising glide that peaks on the beat, then a little boop."""
    rise, hold = 0.17, 0.12
    n = int((rise + hold) * SR)
    t = np.arange(n) / SR
    # Glide up about an octave and a half into the beat, with a little wobble on top.
    f = np.where(t < rise, 210 * (2.9 ** (t / rise) ** 0.8), 609) * (1 + 0.02 * np.sin(2 * np.pi * 28 * t))
    ph = 2 * np.pi * np.cumsum(f) / SR
    # Rich, voice-like tone: a soft square-ish wave through a moving band-pass ("oo" to "ee").
    x = np.tanh(2.5 * np.sin(ph)) + 0.35 * np.sin(2 * ph)
    x = hp(lp(x, 1600 + 1400 * min(1.0, 1.0), 1), 180)
    e = np.minimum(1, t / 0.025) * np.where(t < rise, 0.7 + 0.3 * t / rise, np.exp(-(t - rise) / 0.06))
    place(x * e * 0.5, peak_t - rise, pan=0.0, verb=0.3, duck=False)


# ---------- arrangement ----------

E, C, G, D = 0, 1, 2, 3
CHORDS = {E: [52, 55, 59], C: [48, 52, 55], G: [55, 59, 62], D: [50, 54, 57]}  # Em, C, G, D
ROOT = {E: 40, C: 36, G: 43, D: 38}  # E2, C2, G2, D2
prog = [E, C, G, D]
# Original 2-bar bell hook in E minor pentatonic (8th-note grid, None = rest).
HOOK_A = [76, None, 79, 81, None, 83, 81, 79, 76, None, 74, 76, None, 79, None, None]
HOOK_B = [76, None, 79, 81, None, 83, 86, 83, 81, None, 79, 81, None, 76, None, None]
# Bass rhythm per bar in 8ths: (step, length in 8ths, octave up?)
BASS = [(0, 2, 0), (3, 1, 0), (4, 2, 0), (6, 1, 1), (7, 1, 0)]

last = a.bars - 1
for b in range(a.bars):
    t0 = b * BAR
    ch = prog[b % 4]
    if b == last:
        # Final hit: kick, clap, low E, full chord on bell and marimba, ringing out.
        place(kick(), t0, 0.9, duck=False)
        place(clap(), t0, 0.5, verb=0.3, duck=False)
        place(bass(ROOT[E], BAR + a.tail * 0.6), t0, 0.8)
        for m in CHORDS[E] + [64, 71]:
            place(bell(m + 12, 2.4), t0, 0.22, verb=0.5)
            place(marimba(m, 1.2), t0, 0.35, verb=0.3)
        place(pad([52, 59, 64, 67], BAR + a.tail), t0, 0.3, verb=0.4)
        continue
    intro = b == 0
    # Marimba arpeggio in 8ths over the chord.
    arp = CHORDS[ch] + [CHORDS[ch][1] + 12]
    for k in range(8):
        place(marimba(arp[[0, 1, 2, 3, 2, 1, 2, 3][k]] + 12, 0.45), t0 + k * BEAT / 2, 0.36 if intro else 0.32, pan=0.3 * (-1) ** k, verb=0.2)
    # Bell hook (A on even bars, B on odd).
    hook = HOOK_A if b % 2 == 0 else HOOK_B
    for k, m in enumerate(hook[:8] if b % 2 == 0 else hook[8:]):
        if m is not None:
            place(bell(m, 0.8), t0 + k * BEAT / 2, 0.3 if intro else 0.3, pan=-0.15, verb=0.3)
    if intro:
        continue
    # Groove: kick on every beat, clap on 2 and 4, shaker 16ths, bass, pad.
    for k in range(4):
        tb = t0 + k * BEAT
        place(kick(), tb, 0.72, duck=False)
        KICKS.append(tb)
        if k in (1, 3):
            place(clap(), tb, 0.62, verb=0.3, duck=False)
        for s in range(4):
            place(shaker(), tb + s * BEAT / 4, 0.12 if s % 2 else 0.07, pan=0.35, duck=False)
    for step, ln, up in BASS:
        place(bass(ROOT[ch] + 12 * up, ln * BEAT / 2 * 0.92), t0 + step * BEAT / 2, 0.36)
    place(pad([m + 12 for m in CHORDS[ch]], BAR + 0.05), t0, 0.3, verb=0.35)

# Whoops on the hop beats.
for hb in [int(x) for x in a.hops.split(",") if x.strip()]:
    whoop(hb * BEAT)

# ---------- sidechain pump, reverb, master ----------

pump = np.ones(N)
for kt in KICKS:
    i = int(kt * SR)
    n = min(int(BEAT * SR), N - i)
    t = np.arange(n) / SR
    pump[i : i + n] = np.minimum(pump[i : i + n], 0.35 + 0.65 * (1 - np.exp(-t / 0.09)))
L += DL * pump
R += DR * pump

irn = int(1.4 * SR)
ir = lp(rng.standard_normal(irn) * np.exp(-np.arange(irn) / SR / 0.38), 6000, 1)
ir /= np.sqrt((ir**2).sum())
m = 1 << int(np.ceil(np.log2(N + irn)))
wet = np.fft.irfft(np.fft.rfft(SEND, m) * np.fft.rfft(ir, m), m)[:N] * 0.3
L += wet
R += np.roll(wet, int(0.013 * SR))

mix = np.stack([L, R], 1)
fade = int(0.6 * SR)
mix[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 2
mix /= np.max(np.abs(mix)) / 0.95
mix = np.tanh(mix * 1.3) / np.tanh(1.3)
sf.write(a.out, mix.astype(np.float32), SR)
print(f"wrote {a.out}: {DUR:.2f} s at {a.bpm} BPM, {a.bars} bars")

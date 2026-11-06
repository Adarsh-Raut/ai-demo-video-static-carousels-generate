// Listing reel: spec → photos + voice + word timings → a 1080×1920 HyperFrames project.
//
// Every scene but the end card puts the listing photo in a rounded card at close to its
// native size (listing photos are ~1024 px wide, too soft to fill a vertical frame) over a
// pre-blurred backdrop of the same photo. Text stays inside the band Instagram and TikTok
// leave clear (168–1330 px, left of the action rail); captions sit at the bottom of it.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { esc, GSAP, Sfx } from "../media.ts";
import { probeDuration, readJson, round, run, workDir, writeJson } from "../util.ts";
import { speak, type Word, wordTimings } from "../voice.ts";
import { photoUrl } from "./listing.ts";
import type { ReelScene, ReelSpec } from "./reel-spec.ts";

const W = 1080;
const H = 1920;
const LEAD = 0.2; // voice starts this far into its scene
const TAIL = 0.35;
const END_HOLD = 0.9; // the end card stays up after its line
const MIN: Record<ReelScene["kind"], number> = { hook: 2.6, value: 3.6, tour: 3.2, auction: 2.8, cta: 2.6 };
const COL = { x: 60, w: 900 }; // text column, clear of the action rail
const CARD = { x: 48, w: 984 };
const CAP_BOTTOM = 1326; // captions grow upward from here, up to two lines

type Line = { file: string; text: string; duration: number; words: Word[] };
type VoiceMap = Record<string, Line>;
type Slot = { scene: ReelScene; start: number; duration: number };

// ---------- assets ----------

export async function prepareAssets(spec: ReelSpec, specDir: string, { force = false } = {}) {
  const { project } = workDir(spec.id);
  const dir = join(project, "assets", "photos");
  mkdirSync(dir, { recursive: true });
  for (const i of usedPhotos(spec)) {
    const photo = join(dir, `p${i}.jpg`);
    if (force || !existsSync(photo)) {
      const res = await fetch(photoUrl(spec.photos[i]));
      if (!res.ok) throw new Error(`photo ${i}: HTTP ${res.status}`);
      writeFileSync(photo, Buffer.from(await res.arrayBuffer()));
      // The backdrop is blurred and darkened once here, not with CSS filters at render time.
      run("ffmpeg", ["-y", "-v", "error", "-i", photo, "-vf",
        "scale=1240:2200:force_original_aspect_ratio=increase,crop=1240:2200,gblur=sigma=38,eq=brightness=-0.08:saturation=1.15",
        "-q:v", "3", join(dir, `p${i}-bg.jpg`)]);
    }
  }
  if (spec.brand.logo) {
    const logo = join(project, "assets", "logo.png");
    if (force || !existsSync(logo)) {
      if (/^https?:/.test(spec.brand.logo)) {
        const res = await fetch(spec.brand.logo);
        if (!res.ok) throw new Error(`logo: HTTP ${res.status}`);
        writeFileSync(logo, Buffer.from(await res.arrayBuffer()));
      } else copyFileSync(resolve(specDir, spec.brand.logo), logo);
    }
  }
}

function usedPhotos(spec: ReelSpec) {
  return [...new Set(spec.scenes.flatMap((s) => ("photos" in s ? s.photos : "photo" in s ? [s.photo] : [])))];
}

// ---------- voice ----------

// One WAV per scene plus word timings for the captions. A line is only re-spoken when its
// text or the voice changed.
export function reelVoice(spec: ReelSpec, { force = false } = {}): VoiceMap {
  const { dir, project } = workDir(spec.id);
  const voDir = join(project, "assets", "vo");
  mkdirSync(voDir, { recursive: true });
  const cachePath = join(dir, "voice.json");
  const cache = existsSync(cachePath) ? readJson<VoiceMap & { _voice?: unknown }>(cachePath) : {};
  const sameVoice = JSON.stringify(cache._voice) === JSON.stringify(spec.voice);
  const out: VoiceMap = {};
  for (const s of spec.scenes) {
    if (!s.narration.trim()) continue;
    const file = join(voDir, `${s.id}.wav`);
    const hit = cache[s.id];
    if (!force && sameVoice && hit?.text === s.narration && existsSync(file)) {
      out[s.id] = hit;
      continue;
    }
    console.log(`tts  ${s.id}`);
    speak(s.narration, file, spec.voice);
    const duration = round(probeDuration(file));
    out[s.id] = { file: `assets/vo/${s.id}.wav`, text: s.narration, duration, words: wordTimings(file, s.narration, duration) };
  }
  writeJson(cachePath, { ...out, _voice: spec.voice });
  return out;
}

// ---------- compose ----------

export function composeReel(spec: ReelSpec, specDir: string, vo: VoiceMap) {
  const { project } = workDir(spec.id);
  mkdirSync(join(project, "compositions"), { recursive: true });
  let t = 0;
  const slots: Slot[] = spec.scenes.map((scene) => {
    const v = vo[scene.id];
    let d = Math.max(MIN[scene.kind], v ? LEAD + v.duration + TAIL : 0);
    if (scene.kind === "tour") d = Math.max(d, scene.photos.length * 1.1);
    if (scene.kind === "cta") d += END_HOLD;
    const slot = { scene, start: round(t), duration: round(d) };
    t += d;
    return slot;
  });
  const total = round(t);
  const sfx = new Sfx(project);
  slots.forEach((slot, i) => {
    const html = sceneHtml(spec, slot, vo[slot.scene.id], (kind, at, vol, dur) => sfx.place(kind, slot.start + at, vol, dur));
    writeFileSync(join(project, "compositions", `${slot.scene.id}.html`), html);
    if (i > 0) sfx.place("whoosh", slot.start, 0.42);
  });

  const audio = slots
    .filter((s) => vo[s.scene.id])
    .map((s) => `<audio id="vo-${s.scene.id}" data-start="${round(s.start + LEAD)}" data-duration="${vo[s.scene.id].duration}" data-track-index="10" data-volume="1" src="${vo[s.scene.id].file}"></audio>`);
  if (spec.music) {
    const src = resolve(specDir, spec.music);
    mkdirSync(join(project, "assets", "music"), { recursive: true });
    copyFileSync(src, join(project, "assets", "music", basename(src)));
    audio.push(`<audio id="music" data-timeline-role="music" data-start="0" data-duration="${total}" data-track-index="11" data-volume="${spec.musicVolume}" data-fade-in="0.2" data-fade-out="1.2" loop src="assets/music/${basename(src)}"></audio>`);
  }
  writeFileSync(join(project, "index.html"), indexHtml(spec, slots, total, [...audio, ...sfx.tags]));
  writeJson(join(project, "hyperframes.json"), {
    $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
    registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
    paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
    media: { autoProxy: true },
  });
  writeJson(join(project, "meta.json"), { id: spec.id, name: `${spec.brand.name} reel` });
  console.log(`compose  ${slots.length} scenes, ${total}s → ${project}`);
  return total;
}

type Cue = (kind: "pop" | "impact" | "sparkle" | "whoosh" | "click", at: number, volume: number, duration?: number) => void;

function sceneHtml(spec: ReelSpec, slot: Slot, vo: Line | undefined, cue: Cue) {
  const { scene, duration: D } = slot;
  const id = scene.id;
  const parts = { html: [] as string[], tw: [] as string[] };
  const add = (html: string, ...tw: string[]) => {
    parts.html.push(html);
    parts.tw.push(...tw);
  };

  if (scene.kind === "cta") {
    paperScene(spec, scene, D, cue, add);
  } else {
    const photos = scene.kind === "tour" ? scene.photos : [scene.photo];
    const slice = D / photos.length;
    // Backdrop: the blurred photo, swapped with each cut, drifting slowly.
    photos.forEach((p, k) => {
      const start = round(k * slice);
      const dur = round(k === photos.length - 1 ? D - start : slice + 0.3);
      add(
        `<div id="${id}-bg${k}" class="clip layer" data-start="${start}" data-duration="${dur}" style="z-index:${1 + k}"><img id="${id}-bg${k}-img" class="bg" data-layout-allow-overflow src="assets/photos/p${p}-bg.jpg" alt=""></div>`,
        k ? `tl.fromTo("#${id}-bg${k}-img", { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power1.out" }, ${start});` : "",
        `tl.fromTo("#${id}-bg${k}-img", { scale: 1.08 }, { scale: 1, duration: ${dur}, ease: "none" }, ${start});`,
      );
    });
    add(`<div class="shade" style="z-index:9"></div>`);

    const card = scene.kind === "hook" ? { top: 640, h: 524 } : { top: 180, h: 640 };
    add(
      `<div id="${id}-card" class="card" style="top:${card.top}px; height:${card.h}px; z-index:10">${photos
        .map((p, k) => {
          const start = round(k * slice);
          const dur = round(k === photos.length - 1 ? D - start : slice + 0.3);
          return `<div id="${id}-ph${k}" class="clip layer" data-start="${start}" data-duration="${dur}"><img id="${id}-ph${k}-img" class="photo" data-layout-allow-overflow src="assets/photos/p${p}.jpg" alt=""></div>`;
        })
        .join("")}</div>`,
      // The first scene's card is there from frame 0 (it is the thumbnail); later ones rise in.
      slot.start > 0 ? `tl.fromTo("#${id}-card", { y: 140, scale: 0.94, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.5, ease: "expo.out" }, 0);` : "",
      ...photos.flatMap((_, k) => {
        const start = round(k * slice);
        const dur = round(k === photos.length - 1 ? D - start : slice + 0.3);
        const drift = k % 2 ? -1 : 1;
        return [
          k ? `tl.fromTo("#${id}-ph${k}-img", { xPercent: ${100 * drift} }, { xPercent: 0, duration: 0.38, ease: "power3.out" }, ${start});` : "",
          `tl.fromTo("#${id}-ph${k}-img", { scale: 1.04, x: ${-16 * drift} }, { scale: 1.12, x: ${16 * drift}, duration: ${dur}, ease: "none" }, ${start});`,
        ];
      }),
    );
    if (scene.kind === "tour") photos.forEach((_, k) => k && cue("whoosh", k * slice, 0.22));

    if (scene.kind === "hook") hookText(spec, scene, add, cue);
    if (scene.kind === "value") valuePanel(spec, scene, D, add, cue);
    if (scene.kind === "tour") chips(scene, D, add, cue);
    if (scene.kind === "auction") auctionTile(scene, D, add, cue);
  }

  if (spec.captions && vo && scene.kind !== "cta") captionsHtml(id, vo.words, D, spec.brand.highlight, add);

  return `<template>
  <style>
    ${styles(spec)}
  </style>
  <div id="root" data-composition-id="${id}" data-width="${W}" data-height="${H}">
    ${parts.html.join("\n    ")}
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
    ${parts.tw.filter(Boolean).join("\n    ")}
    window.__timelines["${id}"] = tl;
  </script>
</template>
`;
}

type Add = (html: string, ...tw: string[]) => void;
type Of<K extends ReelScene["kind"]> = Extract<ReelScene, { kind: K }>;

// One line of text, sized down until it fits the column at roughly `k` em per character.
const fit = (text: string, width: number, max: number, k = 0.68) => Math.round(Math.min(max, width / (text.length * k)));

function hookText(spec: ReelSpec, s: Of<"hook">, add: Add, cue: Cue) {
  const id = s.id;
  if (s.kicker) add(`<div id="${id}-kicker" class="kicker" style="top:196px">${esc(s.kicker)}</div>`, `tl.fromTo("#${id}-kicker", { x: -24 }, { x: 0, duration: 0.5, ease: "expo.out" }, 0);`);
  add(
    `<div id="${id}-headline" class="headline" style="top:272px; font-size:${fit(s.headline, COL.w, 136)}px">${esc(s.headline)}</div>`,
    `tl.fromTo("#${id}-headline", { scale: 1.06 }, { scale: 1, duration: 0.6, ease: "expo.out" }, 0);`,
  );
  if (s.price) {
    add(
      `<div id="${id}-pricerow" class="pricerow" style="top:430px"><span class="pricelabel">${esc(s.priceLabel)}</span><span id="${id}-price" class="price">${esc(s.price)}</span></div>`,
      `tl.set("#${id}-price", { rotation: -2 }, 0);`,
      `tl.to("#${id}-price", { scale: 1.16, duration: 0.12, ease: "power2.out" }, 0.35);`,
      `tl.to("#${id}-price", { scale: 1, duration: 0.45, ease: "back.out(3)" }, 0.47);`,
    );
    cue("impact", 0.4, 0.5);
  }
  void spec;
}

function valuePanel(spec: ReelSpec, s: Of<"value">, D: number, add: Add, cue: Cue) {
  const id = s.id;
  const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  const strikeAt = 0.55;
  const countAt = 0.62;
  const badgeAt = round(Math.min(2.2, D - 1.2));
  add(
    `<div id="${id}-panel" class="clip panel" data-start="0.2" data-duration="${round(D - 0.2)}" style="top:856px; height:304px">
      <div class="label">${esc(spec.brand.name.toUpperCase())} ESTIMATE</div>
      <div class="was"><span id="${id}-was">${money(s.estimate)}</span><span id="${id}-strike" class="strike"></span></div>
      <div class="label accent">STARTING BID</div>
      <div id="${id}-now" class="now">${money(s.estimate)}</div>
    </div>`,
    `tl.fromTo("#${id}-panel", { scale: 0.86, y: -24 }, { scale: 1, y: 0, duration: 0.5, ease: "expo.out" }, 0.2);`,
    `tl.fromTo("#${id}-strike", { scaleX: 0 }, { scaleX: 1, duration: 0.35, ease: "power2.inOut" }, ${strikeAt});`,
    // The starting bid ticks down from the estimate to the real price.
    `const ${camel(id)}N = { v: ${s.estimate} };`,
    `tl.to(${camel(id)}N, { v: ${s.price}, duration: 0.9, ease: "power3.out", onUpdate: () => { document.querySelector("#${id}-now").textContent = "$" + Math.round(${camel(id)}N.v).toLocaleString("en-US"); } }, ${countAt});`,
  );
  add(
    `<div id="${id}-badge" class="badge" style="top:770px">${esc(s.badge)}</div>`,
    `tl.fromTo("#${id}-badge", { scale: 0, rotation: -14, opacity: 0 }, { scale: 1, rotation: -4, opacity: 1, duration: 0.5, ease: "back.out(2.2)" }, ${badgeAt});`,
  );
  cue("pop", strikeAt, 0.3);
  cue("impact", badgeAt + 0.08, 0.55);
}

function chips(s: Of<"tour">, D: number, add: Add, cue: Cue) {
  const step = Math.min(0.5, (D - 1.4) / Math.max(1, s.chips.length));
  s.chips.forEach((c, j) => {
    const at = round(0.35 + j * step);
    const x = COL.x + (j % 2) * 462;
    const y = 870 + Math.floor(j / 2) * 144;
    add(
      `<div id="${s.id}-chip${j}" class="chip" style="left:${x}px; top:${y}px; font-size:${fit(c, 330, 50, 0.66)}px"><span class="dot"></span>${esc(c)}</div>`,
      `tl.fromTo("#${s.id}-chip${j}", { scale: 0.6, y: 30, opacity: 0 }, { scale: 1, y: 0, opacity: 1, duration: 0.42, ease: "back.out(2)" }, ${at});`,
    );
    cue("pop", at, 0.3, Math.max(0.2, step - 0.04));
  });
}

function auctionTile(s: Of<"auction">, D: number, add: Add, cue: Cue) {
  const id = s.id;
  add(
    `<div id="${id}-tile" class="clip panel tile" data-start="0.25" data-duration="${round(D - 0.25)}" style="top:856px; height:304px">
      <div class="label accent"><span id="${id}-live" class="live"></span>${esc(s.label)}</div>
      <div id="${id}-date" class="date" style="font-size:${fit(s.date, 780, 118, 0.7)}px">${esc(s.date)}</div>
      ${s.time ? `<div class="time">${esc(s.time)}</div>` : ""}
    </div>`,
    `tl.fromTo("#${id}-tile", { scale: 0.86, y: -24 }, { scale: 1, y: 0, duration: 0.5, ease: "expo.out" }, 0.25);`,
    `tl.fromTo("#${id}-date", { scale: 1.25, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.45, ease: "expo.out" }, 0.55);`,
    `tl.fromTo("#${id}-live", { scale: 1, opacity: 1 }, { scale: 1.6, opacity: 0.35, duration: 0.6, ease: "sine.inOut", yoyo: true, repeat: 5 }, 0.3);`,
  );
  cue("pop", 0.6, 0.35);
}

function paperScene(spec: ReelSpec, s: Of<"cta">, D: number, cue: Cue, add: Add) {
  const id = s.id;
  add(
    `<div class="paper"></div><div id="${id}-orb0" class="orb" style="left:-260px; top:120px"></div><div id="${id}-orb1" class="orb" style="left:520px; top:1180px"></div>`,
    `tl.fromTo("#${id}-orb0", { x: 0, y: 0 }, { x: 120, y: 60, duration: ${round(D)}, ease: "none" }, 0);`,
    `tl.fromTo("#${id}-orb1", { x: 0, y: 0 }, { x: -110, y: -70, duration: ${round(D)}, ease: "none" }, 0);`,
  );
  add(
    spec.brand.logo
      ? `<img id="${id}-logo" class="logo" src="assets/logo.png" alt="${esc(spec.brand.name)}">`
      : `<div id="${id}-logo" class="logo wordmark">${esc(spec.brand.name)}</div>`,
    `tl.fromTo("#${id}-logo", { scale: 0.86, opacity: 0, y: 30 }, { scale: 1, opacity: 1, y: 0, duration: 0.6, ease: "expo.out" }, 0.12);`,
  );
  add(
    `<div id="${id}-headline" class="cta-headline">${esc(s.headline)}</div>`,
    `tl.fromTo("#${id}-headline", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.55, ease: "expo.out" }, 0.4);`,
  );
  add(
    `<div id="${id}-button" class="button"><span id="${id}-shine" class="shine" data-layout-ignore></span>${esc(s.button)}</div>`,
    `tl.fromTo("#${id}-button", { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5, ease: "back.out(2)" }, 0.7);`,
    `tl.fromTo("#${id}-shine", { x: -300 }, { x: 760, duration: 0.9, ease: "power2.inOut" }, 1.2);`,
  );
  if (s.sub) add(`<div id="${id}-sub" class="cta-sub">${esc(s.sub)}</div>`, `tl.fromTo("#${id}-sub", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power2.out" }, 1.0);`);
  cue("sparkle", 0.2, 0.45);
  cue("pop", 0.75, 0.3);
}

// Word-by-word captions: short groups that fit one line, the spoken word lit up.
function captionsHtml(id: string, words: Word[], D: number, hl: string, add: Add) {
  // A group ends at punctuation once it has been up long enough to read, or when the
  // next word would overflow two lines.
  const groups: Word[][] = [];
  for (const w of words) {
    const g = groups.at(-1);
    const len = g ? g.map((x) => x.text).join(" ").length + 1 + w.text.length : Infinity;
    const shown = g ? w.start - g[0].start : 0;
    const glued = g && /^(sq|\$|a|an|the)$/i.test(g.at(-1)!.text); // never end a line on these
    if (!g || (!glued && (len > 32 || g.length >= 7 || (/[.,!?]$/.test(g.at(-1)!.text) && shown >= 1.2)))) groups.push([w]);
    else g.push(w);
  }
  groups.forEach((g, n) => {
    const start = round(Math.max(0, LEAD + g[0].start - 0.06));
    const next = groups[n + 1];
    const end = Math.min(D, next ? LEAD + next[0].start - 0.06 : LEAD + g.at(-1)!.end + 0.4);
    const gid = `${id}-cap${n}`;
    add(
      `<div id="${gid}" class="clip cap" data-start="${start}" data-duration="${round(end - start)}" style="bottom:${H - CAP_BOTTOM}px">${g
        .map((w, i) => `<span id="${gid}-w${i}" class="w">${esc(w.text)}</span>`)
        .join(" ")}</div>`,
      ...g.map((w, i) => {
        const on = round(LEAD + w.start);
        const off = i < g.length - 1 ? round(LEAD + g[i + 1].start) : undefined;
        const d = round(Math.max(0.02, Math.min(0.08, (off ?? on + 1) - on - 0.01)));
        return [
          `tl.fromTo("#${gid}-w${i}", { scale: 1, color: "#ffffff" }, { scale: 1.1, color: "${hl}", duration: ${d}, ease: "power2.out" }, ${on});`,
          off !== undefined ? `tl.to("#${gid}-w${i}", { scale: 1, color: "#ffffff", duration: 0.1 }, ${off});` : "",
        ].join("\n    ");
      }),
    );
  });
}

const camel = (s: string) => s.replace(/-(\w)/g, (_, c) => c.toUpperCase());

// ---------- look ----------

function styles(spec: ReelSpec) {
  const { accent, ground, paper, highlight, font } = spec.brand;
  return `#root { position: absolute; inset: 0; overflow: hidden; font-family: "${font}", sans-serif; color: #fff; background: ${ground}; }
    .layer { position: absolute; inset: 0; overflow: hidden; }
    .bg { position: absolute; left: -80px; top: -140px; width: 1240px; height: 2200px; object-fit: cover; }
    .shade { position: absolute; inset: 0; background: linear-gradient(180deg, ${ground}b3 0%, ${ground}40 30%, ${ground}40 52%, ${ground}cc 64%, ${ground}e6 100%); }
    .card { position: absolute; left: ${CARD.x}px; width: ${CARD.w}px; border-radius: 40px; overflow: hidden; background: ${ground};
      box-shadow: 0 40px 90px rgba(0,0,0,.5), 0 0 0 3px rgba(255,255,255,.22); }
    .photo { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .kicker { position: absolute; z-index: 15; left: ${COL.x}px; padding: 12px 24px; border-radius: 999px; background: ${accent}; font-size: 30px; font-weight: 700; letter-spacing: .06em; }
    .headline { position: absolute; z-index: 15; left: ${COL.x}px; width: ${COL.w}px; font-weight: 900; line-height: 1; letter-spacing: -.02em; white-space: nowrap; transform-origin: 0 50%;
      text-shadow: 0 8px 40px rgba(0,0,0,.45); }
    .pricerow { position: absolute; z-index: 15; left: ${COL.x}px; width: ${COL.w}px; display: flex; align-items: center; gap: 28px; white-space: nowrap; }
    .pricelabel { font-size: 54px; font-weight: 900; letter-spacing: -.01em; text-shadow: 0 6px 30px rgba(0,0,0,.45); }
    .price { display: inline-block; padding: 4px 30px 10px; border-radius: 28px; background: ${accent}; font-size: 150px; font-weight: 900; letter-spacing: -.03em; line-height: 1.05;
      box-shadow: 0 24px 60px ${accent}80; }
    .panel { position: absolute; z-index: 15; left: ${COL.x}px; width: ${COL.w}px; transform-origin: 50% 0; padding: 34px 44px; border-radius: 36px; background: #ffffff; color: #0b0d17;
      box-shadow: 0 30px 80px rgba(0,0,0,.35); }
    .label { font-size: 28px; font-weight: 700; letter-spacing: .12em; color: #6b7080; display: flex; align-items: center; gap: 14px; }
    .label.accent { color: ${accent}; }
    .was { position: relative; display: inline-block; margin: 4px 0 14px; font-size: 58px; font-weight: 700; color: #545a6b; }
    .strike { position: absolute; left: -6px; right: -6px; top: 52%; height: 7px; border-radius: 4px; background: #e5383b; transform-origin: 0 50%; }
    .now { font-size: 92px; font-weight: 900; letter-spacing: -.03em; line-height: 1; color: #0b0d17; }
    .badge { position: absolute; z-index: 16; left: 40px; padding: 16px 30px; border-radius: 20px; background: ${highlight}; color: #0b0d17; font-size: 46px; font-weight: 900;
      letter-spacing: -.01em; box-shadow: 0 18px 50px rgba(0,0,0,.35); }
    .chip { position: absolute; z-index: 15; width: 438px; height: 120px; display: flex; align-items: center; gap: 18px; padding: 0 30px; border-radius: 30px; background: #ffffff;
      color: #0b0d17; font-weight: 900; letter-spacing: -.01em; white-space: nowrap; box-shadow: 0 20px 50px rgba(0,0,0,.3); }
    .dot { width: 18px; height: 18px; border-radius: 50%; background: ${accent}; flex: none; }
    .tile .date { font-weight: 900; letter-spacing: -.03em; line-height: 1.05; margin-top: 10px; transform-origin: 0 50%; white-space: nowrap; }
    .tile .time { font-size: 54px; font-weight: 700; color: #545a6b; }
    .live { width: 18px; height: 18px; border-radius: 50%; background: #e5383b; }
    .cap { position: absolute; left: ${COL.x}px; width: ${COL.w}px; text-align: center; font-size: 58px; font-weight: 900; line-height: 1.1; letter-spacing: -.01em;
      text-shadow: 0 4px 16px rgba(0,0,0,.75), 0 0 3px rgba(0,0,0,.9); z-index: 20; }
    .cap .w { display: inline-block; margin: 0 .13em; }
    .cap { text-wrap: balance; }
    .paper { position: absolute; inset: 0; background: ${paper}; }
    .orb { position: absolute; width: 820px; height: 820px; border-radius: 50%; background: radial-gradient(circle, ${accent}38 0%, transparent 68%); }
    .logo { position: absolute; left: 230px; top: 470px; width: 620px; }
    .wordmark { font-size: 120px; font-weight: 900; color: #0b0d17; text-align: center; }
    .cta-headline { position: absolute; left: ${COL.x + 30}px; width: ${COL.w}px; top: 720px; text-align: center; font-size: 92px; font-weight: 900; line-height: 1.02;
      letter-spacing: -.03em; color: #0b0d17; }
    .button { position: absolute; left: 50%; top: 960px; margin-left: -260px; width: 520px; height: 128px; display: flex; align-items: center; justify-content: center;
      overflow: hidden; border-radius: 999px; background: ${accent}; color: #fff; font-size: 60px; font-weight: 900; letter-spacing: -.01em; box-shadow: 0 24px 60px ${accent}66; }
    .shine { position: absolute; top: -20px; bottom: -20px; left: 0; width: 120px; background: linear-gradient(100deg, transparent, rgba(255,255,255,.55), transparent); }
    .cta-sub { position: absolute; left: ${COL.x + 30}px; width: ${COL.w}px; top: 1140px; text-align: center; font-size: 44px; font-weight: 700; color: #545a6b; }`;
}

function indexHtml(spec: ReelSpec, slots: Slot[], total: number, audio: string[]) {
  const hosts = slots
    .map(
      (s, i) =>
        `<div id="${s.scene.id}" data-composition-id="${s.scene.id}" data-composition-src="compositions/${s.scene.id}.html" data-start="${s.start}" data-duration="${s.duration}" data-track-index="1" data-track-kind="graphics" data-width="${W}" data-height="${H}" style="z-index:${i + 1}"></div>`,
    )
    .join("\n      ");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <script src="${GSAP}"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: ${spec.brand.ground}; }
      #root { width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-fps="30" data-width="${W}" data-height="${H}" data-motion-blur="on">
      ${hosts}
      ${audio.join("\n      ")}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`;
}

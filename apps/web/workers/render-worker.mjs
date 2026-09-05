import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// apps/web/src/workers/render-worker.ts
import { parentPort } from "node:worker_threads";

// packages/music/src/scales.ts
var SCALES = [
  { name: "major", intervals: [0, 2, 4, 5, 7, 9, 11], aliases: ["ionian"] },
  { name: "minor", intervals: [0, 2, 3, 5, 7, 8, 10], aliases: ["natural-minor", "aeolian"] },
  { name: "harmonic-minor", intervals: [0, 2, 3, 5, 7, 8, 11] },
  { name: "melodic-minor", intervals: [0, 2, 3, 5, 7, 9, 11] },
  { name: "dorian", intervals: [0, 2, 3, 5, 7, 9, 10] },
  { name: "phrygian", intervals: [0, 1, 3, 5, 7, 8, 10] },
  { name: "lydian", intervals: [0, 2, 4, 6, 7, 9, 11] },
  { name: "mixolydian", intervals: [0, 2, 4, 5, 7, 9, 10] },
  { name: "locrian", intervals: [0, 1, 3, 5, 6, 8, 10] },
  {
    name: "phrygian-dominant",
    intervals: [0, 1, 4, 5, 7, 8, 10],
    aliases: ["spanish-gypsy", "phrygian-major"]
  },
  { name: "double-harmonic", intervals: [0, 1, 4, 5, 7, 8, 11] },
  { name: "hungarian-major", intervals: [0, 3, 4, 6, 7, 9, 10] },
  { name: "neapolitan-minor", intervals: [0, 1, 3, 5, 7, 8, 11] },
  { name: "major-pentatonic", intervals: [0, 2, 4, 7, 9] },
  { name: "minor-pentatonic", intervals: [0, 3, 5, 7, 10] },
  { name: "blues", intervals: [0, 3, 5, 6, 7, 10] },
  { name: "whole-tone", intervals: [0, 2, 4, 6, 8, 10] },
  { name: "diminished", intervals: [0, 2, 3, 5, 6, 8, 9, 11] }
];
function getScale(name) {
  const lower = name.toLowerCase();
  for (const s of SCALES) {
    if (s.name.toLowerCase() === lower)
      return s;
    if (s.aliases) {
      for (const a of s.aliases) {
        if (a.toLowerCase() === lower)
          return s;
      }
    }
  }
  return null;
}
function scalePcs(rootPc, scale) {
  return scale.intervals.map((iv) => ((rootPc + iv) % 12 + 12) % 12);
}
function degreeToPc(rootPc, scale, degree) {
  const len = scale.intervals.length;
  if (len === 0)
    return (rootPc % 12 + 12) % 12;
  const idx = (degree % len + len) % len;
  const interval = scale.intervals[idx];
  return ((rootPc + interval) % 12 + 12) % 12;
}
function degreeToMidi(rootPc, scale, degree, octave = 4) {
  const len = scale.intervals.length;
  const baseMidi = 12 * (octave + 1) + rootPc;
  if (len === 0)
    return baseMidi;
  const octaveOffset = Math.floor(degree / len);
  const idx = (degree % len + len) % len;
  const interval = scale.intervals[idx];
  return baseMidi + 12 * octaveOffset + interval;
}
function isInScale(rootPc, scale, midi) {
  const pc = (midi % 12 + 12) % 12;
  const pcs = scalePcs(rootPc, scale);
  return pcs.includes(pc);
}
function stableDegrees(scale) {
  const intervals = scale.intervals;
  if (intervals.length < 2)
    return [0];
  let fifthIdx = 1;
  let bestDist = 12;
  for (let i = 1;i < intervals.length; i++) {
    const iv = intervals[i];
    const dist = Math.min((iv - 7 + 12) % 12, (7 - iv + 12) % 12);
    if (dist < bestDist) {
      bestDist = dist;
      fifthIdx = i;
    }
  }
  return [0, fifthIdx];
}
// packages/music/src/rng.ts
class Rng {
  state;
  constructor(seed) {
    this.state = seed >>> 0;
  }
  next() {
    this.state = this.state + 1831565813 >>> 0;
    let t = this.state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  range(min, max) {
    return min + this.next() * (max - min);
  }
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  pick(arr) {
    if (arr.length === 0)
      throw new Error("Rng.pick: empty array");
    return arr[this.int(0, arr.length - 1)];
  }
}
// packages/music/src/motif.ts
var DEFAULT_OPTS = {
  seed: 1,
  steps: 32,
  density: 0.6,
  glideProb: 0.4,
  responseShift: 1,
  strongBeats: [0, 8, 16, 24]
};
function generateMotif(rootPc, scale, opts = {}) {
  const o = { ...DEFAULT_OPTS, ...opts };
  const rng = new Rng(o.seed);
  const notes = [];
  const half = Math.floor(o.steps / 2);
  const stable = stableDegrees(scale);
  let prevMidi = null;
  let lastDegree = 0;
  const placeNote = (step, degree, velocity) => {
    const midi = degreeToMidi(rootPc, scale, degree, 4);
    const delta = prevMidi === null ? 0 : Math.abs(midi - prevMidi);
    const glide = prevMidi !== null && delta >= 1 && delta <= 3 && rng.next() < o.glideProb;
    notes.push({ step, midi, velocity, durationSteps: 2, glide });
    prevMidi = midi;
    lastDegree = degree;
  };
  for (let step = 0;step < half; step++) {
    if (rng.next() > o.density)
      continue;
    let degree;
    if (o.strongBeats.includes(step)) {
      degree = stable[rng.int(0, stable.length - 1)];
    } else if (prevMidi === null) {
      degree = stable[rng.int(0, stable.length - 1)];
    } else {
      degree = lastDegree + rng.pick([-1, 1]);
    }
    placeNote(step, degree, 0.7);
  }
  for (let step = half;step < o.steps; step++) {
    if (step === o.steps - 1) {
      const midi = degreeToMidi(rootPc, scale, 0, 4);
      notes.push({ step, midi, velocity: 0.85, durationSteps: 2, glide: false });
      prevMidi = midi;
      lastDegree = 0;
      continue;
    }
    if (rng.next() > o.density)
      continue;
    let degree;
    if (o.strongBeats.includes(step)) {
      degree = stable[rng.int(0, stable.length - 1)] + o.responseShift;
    } else {
      degree = lastDegree + rng.pick([-1, 1]);
    }
    placeNote(step, degree, 0.7);
  }
  return notes;
}
// packages/music/src/motif-v2.ts
var idCounter = 0;
function defaultId() {
  idCounter += 1;
  return `motif-${idCounter.toString(36)}`;
}
function intervalDirection(interval) {
  if (interval > 0)
    return 1;
  if (interval < 0)
    return -1;
  return 0;
}
function createMotif(notes, opts) {
  const sorted = notes.slice().sort((a, b) => a.step - b.step);
  const intervals = [];
  const contour = [];
  for (let i = 1;i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const iv = cur.midi - prev.midi;
    intervals.push(iv);
    contour.push(intervalDirection(iv));
  }
  const pcSet = new Set;
  let minMidi = Number.POSITIVE_INFINITY;
  let maxMidi = Number.NEGATIVE_INFINITY;
  for (const n of sorted) {
    pcSet.add((n.midi % 12 + 12) % 12);
    if (n.midi < minMidi)
      minMidi = n.midi;
    if (n.midi > maxMidi)
      maxMidi = n.midi;
  }
  const pitchClasses = Array.from(pcSet).sort((a, b) => a - b);
  const register = {
    min: sorted.length === 0 ? 0 : minMidi,
    max: sorted.length === 0 ? 0 : maxMidi
  };
  const accentPattern = new Array(Math.max(1, opts.steps)).fill(false);
  for (const n of sorted) {
    if (n.step >= 0 && n.step < accentPattern.length)
      accentPattern[n.step] = n.accent;
  }
  const rhythmicDensity = opts.steps > 0 ? Math.min(1, sorted.length / opts.steps) : 0;
  return {
    id: opts.id || defaultId(),
    rootPc: opts.rootPc,
    scaleName: opts.scaleName,
    notes: sorted,
    steps: opts.steps,
    role: opts.role ?? "lead",
    contour,
    intervals,
    pitchClasses,
    register,
    rhythmicDensity,
    accentPattern,
    sourceMotifId: opts.sourceMotifId,
    transformHistory: opts.transformHistory ? opts.transformHistory.slice() : []
  };
}
function motifSimilarity(a, b) {
  if (a.notes.length === 0 && b.notes.length === 0)
    return 1;
  if (a.notes.length === 0 || b.notes.length === 0)
    return 0;
  const contourMatch = alignSequences(a.contour, b.contour);
  const contourLen = Math.max(a.contour.length, b.contour.length, 1);
  const contourScore = contourMatch / contourLen;
  const accentLen = Math.min(a.accentPattern.length, b.accentPattern.length);
  let accentHits = 0;
  for (let i = 0;i < accentLen; i++) {
    if (a.accentPattern[i] === b.accentPattern[i])
      accentHits++;
  }
  const accentScore = accentLen > 0 ? accentHits / accentLen : 0.5;
  const intervalClassA = a.intervals.map((iv) => {
    const cls = (iv % 12 + 12) % 12;
    return iv < 0 ? -cls : cls;
  });
  const intervalClassB = b.intervals.map((iv) => {
    const cls = (iv % 12 + 12) % 12;
    return iv < 0 ? -cls : cls;
  });
  const intervalMatch = alignSequences(intervalClassA, intervalClassB);
  const intervalLen = Math.max(intervalClassA.length, intervalClassB.length, 1);
  const intervalScore = intervalMatch / intervalLen;
  return 0.45 * contourScore + 0.35 * intervalScore + 0.2 * accentScore;
}
function alignSequences(a, b) {
  if (a.length === 0 || b.length === 0)
    return 0;
  const maxOffset = Math.min(3, Math.abs(a.length - b.length) + 2);
  let best = 0;
  for (let offset = -maxOffset;offset <= maxOffset; offset++) {
    let hits = 0;
    let compared = 0;
    for (let i = 0;i < a.length; i++) {
      const j = i + offset;
      if (j < 0 || j >= b.length)
        continue;
      compared++;
      if (a[i] === b[j])
        hits++;
    }
    if (compared > 0 && hits > best)
      best = hits;
  }
  return best;
}
// packages/music/src/motif-memory.ts
var DEFAULT_SALIENCE = 0.5;
var DEFAULT_CONFIDENCE = 0.5;
var CONFIDENCE_LEARNING_RATE = 0.3;

class MotifMemory {
  entries = new Map;
  currentBar = 0;
  ingest(motif, bar, opts = {}) {
    this.currentBar = Math.max(this.currentBar, bar);
    const existing = this.entries.get(motif.id);
    if (existing) {
      existing.salience = Math.max(existing.salience, opts.salience ?? existing.salience);
      if (opts.role && !existing.roles.includes(opts.role))
        existing.roles.push(opts.role);
      this.entries.set(motif.id, existing);
      return;
    }
    const entry = {
      motif,
      age: bar,
      usageCount: 0,
      successCount: 0,
      failCount: 0,
      confidence: opts.confidence ?? DEFAULT_CONFIDENCE,
      salience: opts.salience ?? DEFAULT_SALIENCE,
      lastUsedBar: -1,
      roles: opts.role ? [opts.role] : []
    };
    this.entries.set(motif.id, entry);
  }
  retrieve(id) {
    return this.entries.get(id);
  }
  findSimilar(motif, limit) {
    const scored = [];
    for (const entry of this.entries.values()) {
      if (entry.motif.id === motif.id)
        continue;
      const sim = motifSimilarity(entry.motif, motif);
      scored.push({ entry, sim });
    }
    scored.sort((a, b) => b.sim - a.sim);
    return scored.slice(0, Math.max(0, limit)).map((s) => s.entry);
  }
  findByRole(role, limit) {
    const matches = Array.from(this.entries.values()).filter((e) => e.roles.includes(role));
    matches.sort((a, b) => b.salience - a.salience);
    return matches.slice(0, Math.max(0, limit));
  }
  markUsed(id, bar, success) {
    const entry = this.entries.get(id);
    if (!entry)
      return;
    this.currentBar = Math.max(this.currentBar, bar);
    entry.usageCount += 1;
    if (success)
      entry.successCount += 1;
    else
      entry.failCount += 1;
    const total = entry.successCount + entry.failCount;
    const rate = total > 0 ? entry.successCount / total : DEFAULT_CONFIDENCE;
    entry.confidence = entry.confidence * (1 - CONFIDENCE_LEARNING_RATE) + rate * CONFIDENCE_LEARNING_RATE;
    entry.age = Math.max(0, bar - entry.lastUsedBar);
    entry.lastUsedBar = bar;
  }
  get age() {
    let max = 0;
    for (const e of this.entries.values()) {
      const a = e.lastUsedBar < 0 ? this.currentBar : this.currentBar - e.lastUsedBar;
      if (a > max)
        max = a;
    }
    return max;
  }
  get size() {
    return this.entries.size;
  }
  leastUsed(limit) {
    const arr = Array.from(this.entries.values());
    arr.sort((a, b) => a.usageCount - b.usageCount || b.age - a.age);
    return arr.slice(0, Math.max(0, limit));
  }
  mostSuccessful(limit) {
    const arr = Array.from(this.entries.values());
    arr.sort((a, b) => b.confidence - a.confidence);
    return arr.slice(0, Math.max(0, limit));
  }
  toJSON() {
    return Array.from(this.entries.values());
  }
  clear() {
    this.entries.clear();
    this.currentBar = 0;
  }
}
// packages/music/src/transformation.ts
function snapToScale(midi, rootPc, scale) {
  if (isInScale(rootPc, scale, midi))
    return midi;
  for (let offset = 1;offset <= 6; offset++) {
    if (isInScale(rootPc, scale, midi + offset))
      return midi + offset;
    if (isInScale(rootPc, scale, midi - offset))
      return midi - offset;
  }
  return midi;
}
function deriveId(source, suffix) {
  return `${source.id}:${suffix}`;
}
function withTransform(source, notes, steps, name) {
  const derived = createMotif(notes, {
    id: deriveId(source, name),
    rootPc: source.rootPc,
    scaleName: source.scaleName,
    steps,
    role: source.role,
    sourceMotifId: source.id,
    transformHistory: [...source.transformHistory, name]
  });
  return derived;
}
function transpose(motif, semitones, rootPc, scale) {
  const notes = motif.notes.map((n) => ({
    ...n,
    midi: snapToScale(n.midi + semitones, rootPc, scale)
  }));
  return withTransform(motif, notes, motif.steps, `transpose(${semitones})`);
}
function invert(motif, rootPc, scale) {
  if (motif.notes.length === 0)
    return withTransform(motif, [], motif.steps, "invert");
  const first = motif.notes[0];
  const notes = motif.notes.map((n) => {
    if (n === first)
      return { ...n };
    const offset = n.midi - first.midi;
    return { ...n, midi: snapToScale(first.midi - offset, rootPc, scale) };
  });
  return withTransform(motif, notes, motif.steps, "invert");
}
function retrograde(motif) {
  const positions = motif.notes.map((n) => ({ step: n.step, durationSteps: n.durationSteps }));
  const reversedContent = motif.notes.slice().reverse();
  const notes = reversedContent.map((n, i) => ({
    ...n,
    step: positions[i]?.step ?? n.step,
    durationSteps: positions[i]?.durationSteps ?? n.durationSteps
  }));
  return withTransform(motif, notes, motif.steps, "retrograde");
}
function callResponse(motif, rootPc, scale, seed) {
  const rng = new Rng(seed);
  const stable = stableDegrees(scale);
  const candidates = stable.length >= 2 ? [stable[1], stable[0]] : [4, 0];
  const shift = rng.pick(candidates);
  const first = motif.notes[0];
  const shiftMidi = first ? degreeToMidi(rootPc, scale, shift, 4) - first.midi : 0;
  const notes = motif.notes.map((n, i) => {
    const isLast = i === motif.notes.length - 1;
    if (isLast) {
      return { ...n, midi: degreeToMidi(rootPc, scale, 0, 4), accent: true };
    }
    return { ...n, midi: snapToScale(n.midi + shiftMidi, rootPc, scale) };
  });
  return withTransform(motif, notes, motif.steps, `callResponse(${shift})`);
}
// packages/music/src/phrase-planner.ts
var STEPS_PER_BAR = 16;
function generateMotifV2(context, seed, role) {
  const scale = getScale(context.scaleName);
  if (!scale) {
    throw new Error(`planPhrase: unknown scale "${context.scaleName}"`);
  }
  const effectiveDensity = Math.min(0.18, clamp01(context.density));
  const legacy = generateMotif(context.tonic, scale, {
    seed,
    steps: STEPS_PER_BAR,
    density: effectiveDensity,
    glideProb: 0.3
  });
  const octaveShift = (context.octave - 4) * 12;
  const notes = legacy.map((n, i) => ({
    step: n.step,
    midi: n.midi + octaveShift,
    velocity: n.velocity,
    durationSteps: n.durationSteps,
    accent: i === 0 || i === legacy.length - 1 || n.step % 4 === 0
  }));
  return createMotif(notes, {
    id: `seed-${seed.toString(36)}-${role}`,
    rootPc: context.tonic,
    scaleName: context.scaleName,
    steps: STEPS_PER_BAR,
    role
  });
}
function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}
// packages/music/src/motif-quality.ts
var TRIVIAL_IDENTITIES = new Set(["c:|i:|a:", "c:0,0,0,0|i:p0,p0,p0,p0|a:10000"]);
// packages/music/src/style-grammar.ts
var STYLE_GRAMMARS = {
  "full-on": {
    name: "full-on",
    subdivision: 4,
    kickPattern: "FOUR_ON_FLOOR",
    bassAlignment: "LOCKED",
    syncopationBudget: 0.7,
    swing: 0,
    preferredScales: ["phrygian-dominant", "phrygian"],
    chordChangeRate: 0.25,
    tensionPreference: 0.45,
    tessituraCenter: 67,
    maxLeap: 7,
    densityTarget: 8,
    motifRecurrenceTarget: 0.55,
    phraseLength: 8,
    sectionLength: 64,
    contrastLevel: 0.6,
    developmentStyle: "LINEAR",
    cadenceStrength: 0.7
  },
  progressive: {
    name: "progressive",
    subdivision: 4,
    kickPattern: "FOUR_ON_FLOOR",
    bassAlignment: "COMPLEMENTARY",
    syncopationBudget: 0.25,
    swing: 0.05,
    preferredScales: ["minor", "dorian"],
    chordChangeRate: 0.5,
    tensionPreference: 0.3,
    tessituraCenter: 64,
    maxLeap: 5,
    densityTarget: 5,
    motifRecurrenceTarget: 0.65,
    phraseLength: 8,
    sectionLength: 64,
    contrastLevel: 0.4,
    developmentStyle: "GRADUAL",
    cadenceStrength: 0.8
  },
  dark: {
    name: "dark",
    subdivision: 4,
    kickPattern: "PSY_KICK",
    bassAlignment: "LOCKED",
    syncopationBudget: 0.2,
    swing: 0,
    preferredScales: ["phrygian", "locrian"],
    chordChangeRate: 0.125,
    tensionPreference: 0.7,
    tessituraCenter: 60,
    maxLeap: 5,
    densityTarget: 3,
    motifRecurrenceTarget: 0.75,
    phraseLength: 8,
    sectionLength: 64,
    contrastLevel: 0.3,
    developmentStyle: "SUDDEN",
    cadenceStrength: 0.5
  },
  acid: {
    name: "acid",
    subdivision: 4,
    kickPattern: "BROKEN",
    bassAlignment: "COMPLEMENTARY",
    syncopationBudget: 0.65,
    swing: 0.12,
    preferredScales: ["minor", "blues"],
    chordChangeRate: 0.5,
    tensionPreference: 0.55,
    tessituraCenter: 65,
    maxLeap: 4,
    densityTarget: 5,
    motifRecurrenceTarget: 0.8,
    phraseLength: 8,
    sectionLength: 64,
    contrastLevel: 0.5,
    developmentStyle: "SUDDEN",
    cadenceStrength: 0.6
  }
};
var DEFAULT_STYLE = "full-on";
function getStyleGrammar(styleName) {
  return STYLE_GRAMMARS[styleName] ?? STYLE_GRAMMARS[DEFAULT_STYLE];
}
// packages/music/src/groove-plan.ts
function kickStepsForPattern(pattern, stepsPerBar) {
  const beat = Math.max(1, Math.round(stepsPerBar / 4));
  switch (pattern) {
    case "FOUR_ON_FLOOR":
      return [0, beat, beat * 2, beat * 3];
    case "PSY_KICK":
      return [0, beat * 2];
    case "BROKEN":
      return [0, Math.round(beat * 0.75), Math.round(beat * 1.5), Math.round(beat * 2.5)];
    case "SPARSE":
      return [0];
    default:
      return [0, beat, beat * 2, beat * 3];
  }
}
function hatStepsForStyle(style, stepsPerBar) {
  const beat = Math.max(1, Math.round(stepsPerBar / 4));
  const half = Math.max(1, Math.round(stepsPerBar / 8));
  switch (style) {
    case "OFFBEAT":
      return [half, beat + half, beat * 2 + half, beat * 3 + half];
    case "DRIVING": {
      const out = [];
      for (let s = 0;s < stepsPerBar; s += half)
        out.push(s);
      return out;
    }
    case "SPARSE":
      return [beat, beat * 3];
    case "NONE":
      return [];
    default:
      return [half, beat + half, beat * 2 + half, beat * 3 + half];
  }
}
function accentGrid(stepsPerBar) {
  const beat = Math.max(1, Math.round(stepsPerBar / 4));
  return [0, beat, beat * 2, beat * 3];
}
function clamp012(v) {
  return Math.max(0, Math.min(1, v));
}
function buildGroovePlan(opts) {
  const { context, seed, bars } = opts;
  const grammar = opts.grammar ?? getStyleGrammar(context.sectionRole || "full-on");
  const rng = new Rng(seed);
  const stepsPerBar = 16;
  const kickSteps = kickStepsForPattern(grammar.kickPattern, stepsPerBar);
  const accents = accentGrid(stepsPerBar);
  let hatStyle;
  if (grammar.kickPattern === "PSY_KICK") {
    hatStyle = "SPARSE";
  } else if (grammar.syncopationBudget > 0.6) {
    hatStyle = "DRIVING";
  } else if (grammar.syncopationBudget < 0.25) {
    hatStyle = "OFFBEAT";
  } else {
    hatStyle = "OFFBEAT";
  }
  if (rng.next() < 0.15 && hatStyle === "OFFBEAT")
    hatStyle = "SPARSE";
  const hatSteps = hatStepsForStyle(hatStyle, stepsPerBar);
  const bassKickAlignment = grammar.bassAlignment === "LOCKED" ? "LOCKED" : "COMPLEMENTARY";
  const phraseLength = grammar.phraseLength;
  const fillBars = [];
  for (let bar = phraseLength - 1;bar < bars; bar += phraseLength) {
    fillBars.push(bar);
  }
  const baseDensity = clamp012(grammar.densityTarget / 16);
  const density = clamp012(baseDensity + rng.range(-0.03, 0.03));
  const syncopationBudget = clamp012(grammar.syncopationBudget + rng.range(-0.02, 0.02));
  const swing = clamp012(grammar.swing);
  const beat = Math.max(1, Math.round(stepsPerBar / 4));
  const accent = new Array(stepsPerBar).fill(0);
  for (const s of accents)
    accent[s] = 1;
  const half = Math.max(1, Math.round(stepsPerBar / 8));
  for (let s = half;s < stepsPerBar; s += half) {
    if (accent[s] === 0)
      accent[s] = 0.3 + syncopationBudget * 0.4;
  }
  const microtiming = new Array(stepsPerBar).fill(0);
  if (swing > 0) {
    for (let s = 0;s < stepsPerBar; s++) {
      if (s % (half * 2) === half)
        microtiming[s] = swing * 0.15;
    }
  }
  const kickMap = new Array(stepsPerBar).fill(0);
  for (const s of kickSteps)
    kickMap[s] = 1;
  const bassAccentMap = new Array(stepsPerBar).fill(0);
  if (bassKickAlignment === "LOCKED") {
    for (const s of kickSteps)
      bassAccentMap[s] = 1;
  } else {
    const complementary = [half, beat + half, beat * 2 + half, beat * 3 + half];
    for (const s of complementary) {
      if (s < stepsPerBar)
        bassAccentMap[s] = 0.8;
    }
  }
  const ghostMap = new Array(stepsPerBar).fill(0);
  for (let s = 0;s < stepsPerBar; s++) {
    if (accent[s] === 0 && kickMap[s] === 0) {
      ghostMap[s] = syncopationBudget * 0.3;
    }
  }
  const pulse = beat;
  return {
    subdivision: grammar.subdivision,
    kickSteps,
    bassKickAlignment,
    accentSteps: accents,
    hatSteps,
    hatStyle,
    syncopationBudget,
    swing,
    fillBars,
    density,
    stepsPerBar,
    pulse,
    accent,
    microtiming,
    bassAccentMap,
    ghostMap,
    kickMap
  };
}
// packages/music/src/arrangement-state.ts
var ARRANGEMENT_ROLE_MAP = {
  INTRO: {
    kick: false,
    bass: false,
    lead: false,
    hats: false,
    percussion: false,
    fills: false,
    texture: true
  },
  GROOVE: {
    kick: true,
    bass: true,
    lead: false,
    hats: true,
    percussion: true,
    fills: false,
    texture: false
  },
  BUILD: {
    kick: true,
    bass: true,
    lead: true,
    hats: true,
    percussion: true,
    fills: true,
    texture: false
  },
  DROP: {
    kick: true,
    bass: true,
    lead: true,
    hats: true,
    percussion: true,
    fills: true,
    texture: false
  },
  BREAK: {
    kick: false,
    bass: true,
    lead: true,
    hats: false,
    percussion: false,
    fills: false,
    texture: true
  },
  DEVELOPMENT: {
    kick: true,
    bass: true,
    lead: true,
    hats: true,
    percussion: true,
    fills: false,
    texture: false
  },
  PEAK: {
    kick: true,
    bass: true,
    lead: true,
    hats: true,
    percussion: true,
    fills: true,
    texture: false
  },
  RELEASE: {
    kick: true,
    bass: true,
    lead: false,
    hats: true,
    percussion: false,
    fills: false,
    texture: true
  },
  OUTRO: {
    kick: false,
    bass: false,
    lead: false,
    hats: false,
    percussion: false,
    fills: false,
    texture: true
  }
};
var ARRANGEMENT_DENSITY = {
  INTRO: 0.2,
  GROOVE: 0.5,
  BUILD: 0.65,
  DROP: 0.8,
  BREAK: 0.25,
  DEVELOPMENT: 0.7,
  PEAK: 0.9,
  RELEASE: 0.5,
  OUTRO: 0.2
};
var ARRANGEMENT_ENERGY = {
  INTRO: 0.3,
  GROOVE: 0.5,
  BUILD: 0.7,
  DROP: 0.9,
  BREAK: 0.3,
  DEVELOPMENT: 0.75,
  PEAK: 1,
  RELEASE: 0.5,
  OUTRO: 0.2
};
var STATE_ORDER = [
  "INTRO",
  "GROOVE",
  "BUILD",
  "DROP",
  "BREAK",
  "DEVELOPMENT",
  "PEAK",
  "RELEASE",
  "OUTRO"
];
var STATE_FRACTIONS = {
  INTRO: 0.04,
  GROOVE: 0.12,
  BUILD: 0.12,
  DROP: 0.12,
  BREAK: 0.06,
  DEVELOPMENT: 0.18,
  PEAK: 0.18,
  RELEASE: 0.12,
  OUTRO: 0.06
};
function clamp013(v) {
  return Math.max(0, Math.min(1, v));
}
var SHORT_ARC = ["GROOVE", "BUILD", "PEAK"];
var MINIMAL_ARC = ["GROOVE", "PEAK"];
var SINGLE_STATE = ["GROOVE"];
function arcForBars(bars) {
  if (bars >= 8)
    return STATE_ORDER;
  if (bars >= 4)
    return SHORT_ARC;
  if (bars >= 2)
    return MINIMAL_ARC;
  return SINGLE_STATE;
}
function planArrangement(opts) {
  const { bars, seed, context } = opts;
  const rng = new Rng(seed);
  const arc = arcForBars(bars);
  const slots = [];
  let bar = 0;
  const rawCounts = arc.map((state) => {
    const frac = STATE_FRACTIONS[state];
    const raw = Math.max(2, Math.round(bars * frac / 2) * 2);
    return raw;
  });
  const rawTotal = rawCounts.reduce((a, b) => a + b, 0);
  let diff = bars - rawTotal;
  const adjusted = rawCounts.slice();
  if (diff < 0) {
    for (let i = adjusted.length - 2;i >= 0 && diff < 0; i--) {
      const trim = Math.min(adjusted[i] - 2, -diff);
      adjusted[i] -= trim;
      diff += trim;
    }
  } else if (diff > 0) {
    adjusted[adjusted.length - 1] += diff;
  }
  for (let i = 0;i < STATE_ORDER.length; i++) {
    const state = STATE_ORDER[i];
    const count = adjusted[i] ?? 0;
    const roles = ARRANGEMENT_ROLE_MAP[state];
    const baseDensity = ARRANGEMENT_DENSITY[state];
    const baseEnergy = ARRANGEMENT_ENERGY[state];
    for (let j = 0;j < count && bar < bars; j++) {
      const dJitter = rng.range(-0.03, 0.03);
      const eJitter = rng.range(-0.03, 0.03);
      slots.push({
        barIndex: bar,
        state,
        roles: { ...roles },
        density: clamp013(baseDensity + dJitter),
        energy: clamp013(baseEnergy + eJitter)
      });
      bar++;
    }
  }
  return { bars, slots, seed };
}
// packages/music/src/bass-vocabulary.ts
var BASS_FUNCTIONS = ["ROOT", "THIRD", "FIFTH", "SEVENTH", "OCTAVE"];
function degreeToBassNote(degree, ctx) {
  const midi = degreeToMidi(ctx.tonic, ctx.scale, degree, ctx.bassOctave);
  return { midi, fn: BASS_FUNCTIONS[degree] ?? "PASSING" };
}
function clampBass(midi) {
  let m = midi;
  while (m < 36)
    m += 12;
  while (m > 59)
    m -= 12;
  return m;
}
function dedupe(notes) {
  notes.sort((a, b) => a.step - b.step);
  const out = [];
  for (const n of notes) {
    if (!out.some((d) => d.step === n.step))
      out.push(n);
  }
  return out;
}
function rollingBass(ctx) {
  const notes = [];
  const rootMidi = degreeToMidi(ctx.tonic, ctx.scale, 0, ctx.bassOctave);
  const fifthMidi = degreeToMidi(ctx.tonic, ctx.scale, 4, ctx.bassOctave);
  const octaveMidi = degreeToMidi(ctx.tonic, ctx.scale, 0, ctx.bassOctave + 1);
  notes.push({ midi: rootMidi, step: 0, durationSteps: 1, function: "ROOT", isAnticipation: false });
  const kickSet = new Set(ctx.kickPlan.onsets);
  for (const step of ctx.kickPlan.onsets) {
    if (step === 0)
      continue;
    notes.push({ midi: rootMidi, step, durationSteps: 1, function: "ROOT", isAnticipation: false });
    const offStep = step + 2;
    if (offStep < ctx.groove.stepsPerBar && !kickSet.has(offStep)) {
      if (ctx.rng.next() < 0.6) {
        notes.push({
          midi: fifthMidi,
          step: offStep,
          durationSteps: 1,
          function: "FIFTH",
          isAnticipation: false
        });
      } else {
        notes.push({
          midi: octaveMidi,
          step: offStep,
          durationSteps: 1,
          function: "OCTAVE",
          isAnticipation: false
        });
      }
    }
  }
  if (ctx.isLast) {
    const lastStep = ctx.groove.stepsPerBar - 2;
    const filtered = notes.filter((n) => n.step < lastStep);
    notes.length = 0;
    notes.push(...filtered);
    notes.push({
      midi: fifthMidi,
      step: lastStep,
      durationSteps: 1,
      function: "CADENCE",
      isAnticipation: false
    });
    notes.push({
      midi: rootMidi,
      step: lastStep + 1,
      durationSteps: 2,
      function: "CADENCE",
      isAnticipation: false
    });
  }
  return dedupe(notes.map((n) => ({ ...n, midi: clampBass(n.midi) })));
}
function syncopatedBass(ctx) {
  const notes = [];
  const rootMidi = degreeToMidi(ctx.tonic, ctx.scale, 0, ctx.bassOctave);
  const fifthMidi = degreeToMidi(ctx.tonic, ctx.scale, 4, ctx.bassOctave);
  const thirdMidi = degreeToMidi(ctx.tonic, ctx.scale, 2, ctx.bassOctave);
  const seventhMidi = degreeToMidi(ctx.tonic, ctx.scale, 6, ctx.bassOctave);
  const beat = Math.max(1, Math.round(ctx.groove.stepsPerBar / 4));
  const half = Math.max(1, Math.round(ctx.groove.stepsPerBar / 8));
  notes.push({ midi: rootMidi, step: 0, durationSteps: 2, function: "ROOT", isAnticipation: false });
  const kickSet = new Set(ctx.kickPlan.onsets);
  for (const step of ctx.kickPlan.onsets) {
    if (step === 0)
      continue;
    const antStep = step - 1;
    if (antStep > 0 && !kickSet.has(antStep) && !notes.some((n) => n.step === antStep)) {
      const pitch = ctx.rng.next() < 0.5 ? thirdMidi : fifthMidi;
      notes.push({
        midi: pitch,
        step: antStep,
        durationSteps: 1,
        function: "ANTICIPATION",
        isAnticipation: true
      });
    }
    notes.push({ midi: rootMidi, step, durationSteps: 1, function: "ROOT", isAnticipation: false });
  }
  const syncopatedSteps = [beat + half, beat * 3 + half];
  for (const step of syncopatedSteps) {
    if (step >= ctx.groove.stepsPerBar)
      continue;
    if (notes.some((n) => n.step === step))
      continue;
    if (ctx.rng.next() < 0.4 + ctx.syncopation * 0.4) {
      const useSeventh = ctx.rng.next() < 0.3;
      notes.push({
        midi: useSeventh ? seventhMidi : fifthMidi,
        step,
        durationSteps: 1,
        function: useSeventh ? "SEVENTH" : "FIFTH",
        isAnticipation: false
      });
    }
  }
  if (ctx.isLast) {
    const lastStep = ctx.groove.stepsPerBar - 2;
    const filtered = notes.filter((n) => n.step < lastStep);
    notes.length = 0;
    notes.push(...filtered);
    notes.push({
      midi: fifthMidi,
      step: lastStep,
      durationSteps: 1,
      function: "CADENCE",
      isAnticipation: false
    });
    notes.push({
      midi: rootMidi,
      step: lastStep + 1,
      durationSteps: 2,
      function: "CADENCE",
      isAnticipation: false
    });
  }
  return dedupe(notes.map((n) => ({ ...n, midi: clampBass(n.midi) })));
}
function melodicBass(ctx) {
  const notes = [];
  const beat = Math.max(1, Math.round(ctx.groove.stepsPerBar / 4));
  const pcs = scalePcs(ctx.tonic, ctx.scale);
  const degreeContour = [0, 2, 4, 2];
  let degIdx = 0;
  notes.push({
    midi: degreeToMidi(ctx.tonic, ctx.scale, 0, ctx.bassOctave),
    step: 0,
    durationSteps: 2,
    function: "ROOT",
    isAnticipation: false
  });
  for (let b = 1;b < 4; b++) {
    const step = b * beat;
    if (step >= ctx.groove.stepsPerBar)
      continue;
    const degree = degreeContour[degIdx % degreeContour.length] ?? 0;
    degIdx++;
    const { midi, fn } = degreeToBassNote(degree, ctx);
    notes.push({ midi, step, durationSteps: 2, function: fn, isAnticipation: false });
  }
  const passStep = beat * 2 + Math.max(1, Math.round(beat / 2));
  if (passStep < ctx.groove.stepsPerBar && !notes.some((n) => n.step === passStep)) {
    if (ctx.rng.next() < 0.4) {
      const passDegree = (degreeContour[degIdx % degreeContour.length] ?? 0) + 1;
      const { midi } = degreeToBassNote(passDegree % pcs.length, ctx);
      notes.push({
        midi,
        step: passStep,
        durationSteps: 1,
        function: "PASSING",
        isAnticipation: false
      });
    }
  }
  if (ctx.isLast) {
    const lastStep = ctx.groove.stepsPerBar - 2;
    const filtered = notes.filter((n) => n.step < lastStep);
    notes.length = 0;
    notes.push(...filtered);
    notes.push({
      midi: degreeToMidi(ctx.tonic, ctx.scale, 4, ctx.bassOctave),
      step: lastStep,
      durationSteps: 1,
      function: "CADENCE",
      isAnticipation: false
    });
    notes.push({
      midi: degreeToMidi(ctx.tonic, ctx.scale, 0, ctx.bassOctave),
      step: lastStep + 1,
      durationSteps: 2,
      function: "CADENCE",
      isAnticipation: false
    });
  }
  return dedupe(notes.map((n) => ({ ...n, midi: clampBass(n.midi) })));
}
function acidBass(ctx) {
  const notes = [];
  const rootMidi = degreeToMidi(ctx.tonic, ctx.scale, 0, ctx.bassOctave);
  const fifthMidi = degreeToMidi(ctx.tonic, ctx.scale, 4, ctx.bassOctave);
  const beat = Math.max(1, Math.round(ctx.groove.stepsPerBar / 4));
  notes.push({ midi: rootMidi, step: 0, durationSteps: 1, function: "ROOT", isAnticipation: false });
  for (let b = 1;b < 4; b++) {
    const step = b * beat;
    if (step >= ctx.groove.stepsPerBar)
      continue;
    const approachStep = step - 1;
    if (approachStep > 0 && !notes.some((n) => n.step === approachStep)) {
      notes.push({
        midi: clampBass(rootMidi - 1),
        step: approachStep,
        durationSteps: 1,
        function: "APPROACH",
        isAnticipation: false
      });
    }
    const center = b % 2 === 0 ? fifthMidi : rootMidi;
    notes.push({
      midi: center,
      step,
      durationSteps: 1,
      function: b % 2 === 0 ? "FIFTH" : "ROOT",
      isAnticipation: false
    });
  }
  const offStep = beat * 3 + Math.max(1, Math.round(beat / 2));
  if (offStep < ctx.groove.stepsPerBar && !notes.some((n) => n.step === offStep)) {
    if (ctx.rng.next() < 0.6) {
      notes.push({
        midi: clampBass(rootMidi - 1),
        step: offStep,
        durationSteps: 1,
        function: "APPROACH",
        isAnticipation: false
      });
    }
  }
  if (ctx.isLast) {
    const lastStep = ctx.groove.stepsPerBar - 2;
    const filtered = notes.filter((n) => n.step < lastStep);
    notes.length = 0;
    notes.push(...filtered);
    notes.push({
      midi: fifthMidi,
      step: lastStep,
      durationSteps: 1,
      function: "CADENCE",
      isAnticipation: false
    });
    notes.push({
      midi: rootMidi,
      step: lastStep + 1,
      durationSteps: 2,
      function: "CADENCE",
      isAnticipation: false
    });
  }
  return dedupe(notes.map((n) => ({ ...n, midi: clampBass(n.midi) })));
}
function sparseBass(ctx) {
  const notes = [];
  const rootMidi = degreeToMidi(ctx.tonic, ctx.scale, 0, ctx.bassOctave);
  const fifthMidi = degreeToMidi(ctx.tonic, ctx.scale, 4, ctx.bassOctave);
  const beat = Math.max(1, Math.round(ctx.groove.stepsPerBar / 4));
  notes.push({
    midi: rootMidi,
    step: 0,
    durationSteps: beat * 2,
    function: "ROOT",
    isAnticipation: false
  });
  if (!ctx.isLast) {
    const step = beat * 2;
    if (step < ctx.groove.stepsPerBar) {
      notes.push({
        midi: fifthMidi,
        step,
        durationSteps: beat * 2,
        function: "FIFTH",
        isAnticipation: false
      });
    }
  }
  if (ctx.isLast) {
    const lastStep = ctx.groove.stepsPerBar - 2;
    const filtered = notes.filter((n) => n.step < lastStep);
    notes.length = 0;
    notes.push(...filtered);
    notes.push({
      midi: fifthMidi,
      step: lastStep,
      durationSteps: 1,
      function: "CADENCE",
      isAnticipation: false
    });
    notes.push({
      midi: rootMidi,
      step: lastStep + 1,
      durationSteps: 2,
      function: "CADENCE",
      isAnticipation: false
    });
  }
  return dedupe(notes.map((n) => ({ ...n, midi: clampBass(n.midi) })));
}
function tensionBass(ctx) {
  const notes = [];
  const rootMidi = degreeToMidi(ctx.tonic, ctx.scale, 0, ctx.bassOctave);
  const seventhMidi = degreeToMidi(ctx.tonic, ctx.scale, 6, ctx.bassOctave);
  const secondMidi = degreeToMidi(ctx.tonic, ctx.scale, 1, ctx.bassOctave);
  const octaveMidi = degreeToMidi(ctx.tonic, ctx.scale, 0, ctx.bassOctave + 1);
  const beat = Math.max(1, Math.round(ctx.groove.stepsPerBar / 4));
  notes.push({ midi: rootMidi, step: 0, durationSteps: 1, function: "ROOT", isAnticipation: false });
  for (let b = 1;b < 3; b++) {
    const step = b * beat;
    if (step >= ctx.groove.stepsPerBar)
      continue;
    const useSeventh = ctx.rng.next() < 0.5;
    notes.push({
      midi: useSeventh ? seventhMidi : secondMidi,
      step,
      durationSteps: 1,
      function: useSeventh ? "SEVENTH" : "PASSING",
      isAnticipation: false
    });
  }
  const expStep = beat * 3;
  if (expStep < ctx.groove.stepsPerBar) {
    notes.push({
      midi: octaveMidi,
      step: expStep,
      durationSteps: 1,
      function: "OCTAVE",
      isAnticipation: false
    });
  }
  if (ctx.isLast) {
    const lastStep = ctx.groove.stepsPerBar - 2;
    const filtered = notes.filter((n) => n.step < lastStep);
    notes.length = 0;
    notes.push(...filtered);
    notes.push({
      midi: degreeToMidi(ctx.tonic, ctx.scale, 4, ctx.bassOctave),
      step: lastStep,
      durationSteps: 1,
      function: "CADENCE",
      isAnticipation: false
    });
    notes.push({
      midi: rootMidi,
      step: lastStep + 1,
      durationSteps: 2,
      function: "CADENCE",
      isAnticipation: false
    });
  }
  return dedupe(notes.map((n) => ({ ...n, midi: clampBass(n.midi) })));
}
function generateBassByVocabulary(vocabulary, ctx) {
  switch (vocabulary) {
    case "ROLLING":
      return rollingBass(ctx);
    case "SYNCOPATED":
      return syncopatedBass(ctx);
    case "MELODIC":
      return melodicBass(ctx);
    case "ACID":
      return acidBass(ctx);
    case "SPARSE":
      return sparseBass(ctx);
    case "TENSION":
      return tensionBass(ctx);
    default:
      return rollingBass(ctx);
  }
}

// packages/music/src/harmonic-plan.ts
var PSYTRANCE_PROGRESSIONS = {
  hypnotic: [0, 0, 0, 0],
  dark: [0, 1, 0, 1],
  uplifting: [0, 5, 3, 4],
  epic: [0, 3, 5, 4],
  classic: [0, 4, 5, 3],
  minor: [0, 5, 3, 4],
  "psy-dominant": [0, 1, 0, 6],
  "t-s-t-d": [0, 3, 0, 4]
};
function functionForPhrase(phraseIndex, isLastPhrase) {
  if (isLastPhrase)
    return "TONIC";
  const idx = (phraseIndex % 4 + 4) % 4;
  if (idx === 0)
    return "TONIC";
  if (idx === 1)
    return "SUBDOMINANT";
  if (idx === 2)
    return "TONIC";
  return "DOMINANT";
}
function cadenceTargetForRole(role, isLastPhrase, tonicPc, thirdPc, fifthPc) {
  if (isLastPhrase || role === "RESOLUTION" || role === "RELEASE") {
    return { pc: tonicPc, degree: 0, function: "ROOT" };
  }
  if (role === "RESPONSE" || role === "ANSWER") {
    return { pc: thirdPc, degree: 2, function: "THIRD" };
  }
  if (role === "BUILD" || role === "DEVELOPMENT") {
    return { pc: fifthPc, degree: 4, function: "FIFTH" };
  }
  return { pc: tonicPc, degree: 0, function: "ROOT" };
}
function buildHarmonicPlan(opts) {
  const scale = getScale(opts.scaleName);
  const tonic = opts.tonic;
  const pcs = scale ? scalePcs(tonic, scale) : [tonic, (tonic + 7) % 12];
  const functionSeq = ["TONIC", "SUBDOMINANT", "TONIC", "DOMINANT"];
  const progressionName = opts.progressionName ?? "t-s-t-d";
  const progressionDegrees = PSYTRANCE_PROGRESSIONS[progressionName] ?? PSYTRANCE_PROGRESSIONS["t-s-t-d"];
  const changeRate = opts.chordChangeRate ?? 0.25;
  const barsPerChord = Math.max(1, Math.round(1 / Math.max(0.125, changeRate)));
  const chords = [];
  const overallFunction = functionForPhrase(opts.phraseIndex, opts.isLastPhrase);
  const hasLearned = opts.learnedConfidence !== undefined && opts.learnedConfidence > 0.3 && opts.learnedPcProfile !== undefined && opts.learnedPcProfile.some((v) => v > 0.05);
  for (let bar = 0;bar < opts.bars; bar += barsPerChord) {
    const slotIdx = Math.floor(bar / barsPerChord);
    const _degree = progressionDegrees[(slotIdx % progressionDegrees.length + progressionDegrees.length) % progressionDegrees.length] ?? 0;
    const fn = functionSeq[(slotIdx % 4 + 4) % 4] ?? "TONIC";
    let chordTones;
    if (fn === "TONIC") {
      chordTones = [pcs[0] ?? tonic, pcs[2] ?? (tonic + 4) % 12, pcs[4] ?? (tonic + 7) % 12];
    } else if (fn === "SUBDOMINANT") {
      chordTones = [
        pcs[3] ?? (tonic + 5) % 12,
        pcs[5] ?? (tonic + 7) % 12,
        pcs[7 % pcs.length] ?? (tonic + 11) % 12
      ];
    } else if (fn === "DOMINANT") {
      chordTones = [
        pcs[4] ?? (tonic + 7) % 12,
        pcs[6 % pcs.length] ?? (tonic + 11) % 12,
        pcs[8 % pcs.length] ?? (tonic + 2) % 12
      ];
    } else {
      chordTones = [
        pcs[1] ?? (tonic + 2) % 12,
        pcs[3] ?? (tonic + 5) % 12,
        pcs[5] ?? (tonic + 7) % 12
      ];
    }
    if (hasLearned && opts.learnedPcProfile) {
      const sortedPcs = opts.learnedPcProfile.map((weight, pc) => ({ pc, weight })).filter((x) => pcs.includes(x.pc) && !chordTones.includes(x.pc)).sort((a, b) => b.weight - a.weight);
      if (sortedPcs.length > 0 && sortedPcs[0]) {
        chordTones = [chordTones[0] ?? tonic, chordTones[1] ?? tonic, sortedPcs[0].pc];
      }
    }
    chords.push({
      startBar: opts.startBar + bar,
      endBar: opts.startBar + Math.min(opts.bars, bar + barsPerChord),
      rootPc: chordTones[0] ?? tonic,
      chordTones,
      tension: opts.tensionPreference ?? 0.4,
      function: fn
    });
  }
  const tonicPc = pcs[0] ?? tonic;
  const thirdPc = pcs[2] ?? (tonic + 4) % 12;
  const fifthPc = pcs[4] ?? (tonic + 7) % 12;
  const cadenceTarget = cadenceTargetForRole(opts.phraseRole, opts.isLastPhrase, tonicPc, thirdPc, fifthPc);
  return {
    chords,
    cadenceTarget,
    overallFunction,
    tonic,
    scaleName: opts.scaleName
  };
}
function chordAtBar(plan, bar) {
  for (const c of plan.chords) {
    if (bar >= c.startBar && bar < c.endBar)
      return c;
  }
  return plan.chords[plan.chords.length - 1] ?? null;
}
function nextChordAfterBar(plan, bar) {
  let found = false;
  for (const c of plan.chords) {
    if (found)
      return c;
    if (bar >= c.startBar && bar < c.endBar)
      found = true;
  }
  return null;
}
function isAnticipationBar(plan, bar) {
  const cur = chordAtBar(plan, bar);
  const next = nextChordAfterBar(plan, bar);
  if (!cur || !next)
    return false;
  return bar === cur.endBar - 1 && cur.rootPc !== next.rootPc;
}
function cadenceMidi(plan, target, registerCenter) {
  const scale = getScale(plan.scaleName);
  if (!scale)
    return registerCenter;
  let base = registerCenter;
  const basePc = (base % 12 + 12) % 12;
  base = base - basePc + target.pc;
  while (base < registerCenter - 12)
    base += 12;
  while (base > registerCenter + 12)
    base -= 12;
  return base;
}

// packages/music/src/interaction-grammar-consumer.ts
function blend(defaultValue, learnedValue, confidence) {
  return defaultValue * (1 - confidence) + learnedValue * confidence;
}
function bassOnsetProbability(opts) {
  const stepIdx = (opts.step % 16 + 16) % 16;
  const defOn = opts.defaultOnKick ?? 0.85;
  const defOff = opts.defaultOffKick ?? 0.15;
  if (opts.kickHas) {
    const learned2 = opts.grammar.kickBass.bassOnKickProb[stepIdx] ?? defOn;
    return blend(defOn, learned2, opts.confidence);
  }
  const learned = opts.grammar.kickBass.bassOffKickProb[stepIdx] ?? defOff;
  return blend(defOff, learned, opts.confidence);
}
function leadResponseBoost(opts) {
  let maxBoost = 0;
  for (const bs of opts.bassOnsets) {
    const offset = opts.step - bs;
    if (offset === 1)
      maxBoost = Math.max(maxBoost, 0.6);
    else if (offset === 2)
      maxBoost = Math.max(maxBoost, 0.4);
    else if (offset === 3)
      maxBoost = Math.max(maxBoost, 0.2);
  }
  return maxBoost * opts.confidence;
}
function leadIntervalScore(opts) {
  const def = opts.defaultScore ?? 0.5;
  const prefs = opts.grammar.harmonyLead.intervalPreferences[opts.rootPc];
  if (!prefs)
    return def;
  const learned = prefs[opts.interval] ?? 0;
  return blend(def, learned, opts.confidence);
}
function densityForEnergy(opts) {
  const def = opts.defaultDensity ?? 0.5;
  const bin = Math.min(9, Math.max(0, Math.floor(opts.energy * 10)));
  const learned = opts.grammar.energyDensity.densityByEnergy[bin] ?? def;
  return blend(def, learned, opts.confidence);
}
function registerForTension(opts) {
  const def = opts.defaultRegister ?? 67;
  const bin = Math.min(9, Math.max(0, Math.floor(opts.tension * 10)));
  const learned = opts.grammar.tensionRegister.registerByTension[bin] ?? def;
  return blend(def, learned, opts.confidence);
}
function bassTransitionProbability(opts) {
  const def = opts.defaultProbability ?? 0.25;
  const row = opts.grammar.bassTransitions.transitions[opts.fromDegree];
  if (!row)
    return def;
  const learned = row[opts.toDegree] ?? 0;
  return blend(def, learned, opts.confidence);
}
function pickNextBassDegree(opts) {
  if (opts.candidates.length === 0)
    return 0;
  if (opts.candidates.length === 1)
    return opts.candidates[0];
  const scored = opts.candidates.map((deg) => ({
    deg,
    score: bassTransitionProbability({
      fromDegree: opts.fromDegree,
      toDegree: deg,
      grammar: opts.grammar,
      confidence: opts.confidence
    })
  }));
  const total = scored.reduce((s, x) => s + x.score, 0);
  if (total <= 0)
    return opts.candidates[Math.floor(opts.rng.next() * opts.candidates.length)];
  let r = opts.rng.next() * total;
  for (const s of scored) {
    r -= s.score;
    if (r <= 0)
      return s.deg;
  }
  return scored[scored.length - 1].deg;
}

// packages/music/src/interaction-grammar.ts
function createEmptyInteractionGrammar() {
  return {
    kickBass: {
      bassOnKickProb: new Array(16).fill(0.5),
      bassOffKickProb: new Array(16).fill(0.2)
    },
    bassTransitions: { transitions: {} },
    harmonyLead: { intervalPreferences: {} },
    energyDensity: { densityByEnergy: new Array(10).fill(0.5) },
    tensionRegister: { registerByTension: new Array(10).fill(67) },
    confidence: 0
  };
}

// packages/music/src/learned-context.ts
function createEmptyLearnedContext() {
  return {
    tempo: { tempo: 145, tempoConfidence: 0, phaseRelationship: 0 },
    harmony: {
      key: 4,
      mode: "phrygian-dominant",
      tonalCenterConfidence: 0,
      pitchClassProfile: new Array(12).fill(0),
      harmonicRhythm: 0.25,
      rootMovement: [],
      intervalPreferences: {}
    },
    rhythm: {
      subdivision: 4,
      swing: 0,
      syncopation: 0,
      accentProfile: new Array(16).fill(0),
      kickGrammar: new Array(16).fill(0),
      bassRhythmGrammar: new Array(16).fill(0),
      hatGrammar: new Array(16).fill(0),
      ghostProbability: 0
    },
    bass: {
      degreePreferences: {},
      intervalTransitionProfile: {},
      register: 2,
      octaveBehavior: 0,
      approachToneProfile: 0,
      phraseEndingProfile: 0,
      kickRelationship: "LOCKED"
    },
    melody: {
      contourProfile: [0.33, 0.33, 0.34],
      intervalProfile: {},
      registerProfile: 67,
      phraseLength: 8,
      restProfile: 0.2,
      cadenceProfile: 0.5,
      scaleDegreePreferences: {},
      motifBehavior: "NEUTRAL",
      callResponseProfile: 0.3
    },
    arrangement: {
      energyCurve: [],
      densityCurve: [],
      buildBehavior: 0.3,
      dropBehavior: 0.3,
      breakdownBehavior: 0.2,
      roleActivationProfile: {}
    },
    timbre: {
      brightness: 0.5,
      spectralCentroid: 2000,
      harmonicity: 0.5,
      noisiness: 0.3,
      transientCharacter: 0.5,
      attack: 0.01,
      decay: 0.3,
      sustain: 0.5,
      roughness: 0.3,
      subEnergy: 0.5,
      midEnergy: 0.5,
      highEnergy: 0.5,
      saturation: 0.3,
      confidence: 0
    },
    meta: {
      confidence: 0,
      novelty: 0.5,
      source: "empty",
      observationWindow: 0,
      reward: 0,
      usageCount: 0,
      fingerprint: ""
    }
  };
}

// packages/music/src/phrase-material.ts
function snapToScale2(midi, rootPc, scale) {
  if (isInScale(rootPc, scale, midi))
    return midi;
  for (let offset = 1;offset <= 6; offset++) {
    if (isInScale(rootPc, scale, midi + offset))
      return midi + offset;
    if (isInScale(rootPc, scale, midi - offset))
      return midi - offset;
  }
  return midi;
}
function mean(values) {
  if (values.length === 0)
    return 0;
  let s = 0;
  for (const v of values)
    s += v;
  return s / values.length;
}
function pcsOf(midis) {
  const set = new Set;
  for (const m of midis)
    set.add((m % 12 + 12) % 12);
  return Array.from(set).sort((a, b) => a - b);
}
function intervalsOf(midis) {
  const out = [];
  for (let i = 1;i < midis.length; i++) {
    const prev = midis[i - 1];
    const cur = midis[i];
    if (prev !== undefined && cur !== undefined)
      out.push(cur - prev);
  }
  return out;
}
function motifToPhraseMaterial(motif, stepsPerBar) {
  const notes = motif.notes;
  const pitchContour = [];
  const rhythmPattern = [];
  const accentPattern = [];
  const noteDurations = [];
  for (const n of notes) {
    pitchContour.push(n.midi);
    rhythmPattern.push((n.step % stepsPerBar + stepsPerBar) % stepsPerBar);
    accentPattern.push(n.velocity);
    noteDurations.push(n.durationSteps);
  }
  const intervals = intervalsOf(pitchContour);
  return {
    motifId: motif.id,
    pitchContour,
    intervalSequence: intervals,
    rhythmPattern,
    onsetPositions: rhythmPattern.slice(),
    accentPattern,
    noteDurations,
    registerProfile: mean(pitchContour),
    harmonicTargets: pcsOf(pitchContour),
    stepsPerBar,
    transformHistory: motif.transformHistory.slice(),
    rhythmicCell: deriveRhythmicCell(rhythmPattern),
    intervalCell: deriveIntervalCell(intervals),
    contour: classifyContour(intervals),
    accentShape: { weights: accentPattern.slice(), climaxPosition: findClimax(accentPattern) },
    densityShape: [Math.min(1, pitchContour.length / stepsPerBar)],
    registerShape: [mean(pitchContour)],
    harmonicTargetShape: pcsOf(pitchContour),
    cadenceTarget: pitchContour.length > 0 ? ((pitchContour[pitchContour.length - 1] ?? 0 % 12) + 12) % 12 : null,
    phraseArc: buildPhraseArc(1, mean(pitchContour), 0.3),
    developmentHistory: []
  };
}
function cloneMaterial(src, newId, op) {
  return {
    motifId: newId,
    pitchContour: src.pitchContour.slice(),
    intervalSequence: src.intervalSequence.slice(),
    rhythmPattern: src.rhythmPattern.slice(),
    onsetPositions: src.onsetPositions.slice(),
    accentPattern: src.accentPattern.slice(),
    noteDurations: src.noteDurations.slice(),
    registerProfile: src.registerProfile,
    harmonicTargets: src.harmonicTargets.slice(),
    stepsPerBar: src.stepsPerBar,
    transformHistory: [...src.transformHistory, op],
    rhythmicCell: src.rhythmicCell.slice(),
    intervalCell: src.intervalCell.slice(),
    contour: src.contour,
    accentShape: {
      weights: src.accentShape.weights.slice(),
      climaxPosition: src.accentShape.climaxPosition
    },
    densityShape: src.densityShape.slice(),
    registerShape: src.registerShape.slice(),
    harmonicTargetShape: src.harmonicTargetShape.slice(),
    cadenceTarget: src.cadenceTarget,
    phraseArc: src.phraseArc,
    developmentHistory: src.developmentHistory.slice()
  };
}
function deriveRhythmicCell(rhythmPattern) {
  if (rhythmPattern.length === 0)
    return [0];
  if (rhythmPattern.length === 1)
    return [0];
  const offsets = [];
  for (let i = 1;i < rhythmPattern.length; i++) {
    const cur = rhythmPattern[i] ?? 0;
    const first = rhythmPattern[0] ?? 0;
    offsets.push(cur - first);
  }
  if (rhythmPattern.length <= 4)
    return [0, ...offsets];
  for (let cellLen = 2;cellLen <= 4; cellLen++) {
    if (rhythmPattern.length >= cellLen * 2) {
      const cell = rhythmPattern.slice(0, cellLen);
      let repeats = true;
      for (let i = cellLen;i < rhythmPattern.length; i++) {
        if (rhythmPattern[i] !== cell[i % cellLen]) {
          repeats = false;
          break;
        }
      }
      if (repeats) {
        const cellOffsets = [0];
        for (let i = 1;i < cellLen; i++) {
          const cur = cell[i] ?? 0;
          const first = cell[0] ?? 0;
          cellOffsets.push(cur - first);
        }
        return cellOffsets;
      }
    }
  }
  return [0, ...offsets];
}
function deriveIntervalCell(intervals) {
  if (intervals.length === 0)
    return [0];
  if (intervals.length <= 3)
    return intervals.slice();
  for (let cellLen = 2;cellLen <= 3; cellLen++) {
    if (intervals.length >= cellLen * 2) {
      const cell = intervals.slice(0, cellLen);
      let repeats = true;
      for (let i = cellLen;i < intervals.length; i++) {
        if (intervals[i] !== cell[i % cellLen]) {
          repeats = false;
          break;
        }
      }
      if (repeats)
        return cell.slice();
    }
  }
  return intervals.slice(0, 3);
}
function classifyContour(intervals) {
  if (intervals.length === 0)
    return "flat";
  let up = 0;
  let down = 0;
  for (const iv of intervals) {
    if (iv > 0)
      up++;
    else if (iv < 0)
      down++;
  }
  if (up === intervals.length)
    return "ascending";
  if (down === intervals.length)
    return "descending";
  const midpoint = Math.floor(intervals.length / 2);
  const firstHalfUp = intervals.slice(0, midpoint).filter((iv) => iv > 0).length;
  const secondHalfDown = intervals.slice(midpoint).filter((iv) => iv < 0).length;
  if (firstHalfUp >= midpoint * 0.6 && secondHalfDown >= (intervals.length - midpoint) * 0.6)
    return "arch";
  const firstHalfDown = intervals.slice(0, midpoint).filter((iv) => iv < 0).length;
  const secondHalfUp = intervals.slice(midpoint).filter((iv) => iv > 0).length;
  if (firstHalfDown >= midpoint * 0.6 && secondHalfUp >= (intervals.length - midpoint) * 0.6)
    return "valley";
  let changes = 0;
  for (let i = 1;i < intervals.length; i++) {
    if (Math.sign(intervals[i] ?? 0) !== Math.sign(intervals[i - 1] ?? 0) && intervals[i] !== 0)
      changes++;
  }
  if (changes >= intervals.length * 0.4)
    return "wave";
  return "flat";
}
function findClimax(accents) {
  if (accents.length === 0)
    return 0.5;
  let maxIdx = 0;
  let maxVal = -1;
  for (let i = 0;i < accents.length; i++) {
    if (accents[i] ?? 0 > maxVal) {
      maxVal = accents[i] ?? 0;
      maxIdx = i;
    }
  }
  return accents.length > 1 ? maxIdx / (accents.length - 1) : 0.5;
}
function buildPhraseArc(bars, registerCenter, baseTension) {
  const stages = [];
  const focalBar = Math.max(1, Math.floor(bars * 0.6));
  const cadenceBar = bars - 1;
  const fractions = [0.1, 0.2, 0.25, 0.15, 0.15, 0.15];
  const labels = [
    "OPEN",
    "ESTABLISH",
    "DEVELOP",
    "FOCAL",
    "RELEASE",
    "CADENCE"
  ];
  let cursor = 0;
  const tensionTrajectory = [];
  for (let i = 0;i < 6; i++) {
    const len = Math.max(1, Math.round(bars * (fractions[i] ?? 0.15)));
    const start = Math.min(cursor, bars - 1);
    const end = Math.min(cursor + len, bars);
    const stageTension = i === 3 ? Math.min(1, baseTension + 0.4) : i === 5 ? baseTension * 0.2 : baseTension + i * 0.05;
    const stageDensity = i === 0 ? 0.3 : i === 5 ? 0.4 : Math.min(0.9, 0.4 + i * 0.1);
    const stageRegister = i === 3 ? registerCenter + 4 : i === 5 ? registerCenter - 2 : registerCenter + (i - 2) * 2;
    const label = labels[i] ?? "DEVELOP";
    stages.push({
      stage: label,
      barRange: [start, end],
      density: stageDensity,
      register: stageRegister,
      tension: Math.max(0, Math.min(1, stageTension))
    });
    tensionTrajectory.push(Math.max(0, Math.min(1, stageTension)));
    cursor = end;
  }
  if (stages.length > 0 && stages[stages.length - 1]?.stage !== "CADENCE") {
    stages.push({
      stage: "CADENCE",
      barRange: [Math.max(0, bars - 1), bars],
      density: 0.4,
      register: registerCenter - 2,
      tension: Math.max(0, Math.min(1, baseTension * 0.2))
    });
    tensionTrajectory.push(Math.max(0, Math.min(1, baseTension * 0.2)));
  }
  return { stages, focalBar, cadenceBar, tensionTrajectory };
}
function arcStageAt(arc, bar) {
  for (const s of arc.stages) {
    if (bar >= s.barRange[0] && bar < s.barRange[1])
      return s;
  }
  return arc.stages[arc.stages.length - 1] ?? null;
}
function continueMaterial(src) {
  return cloneMaterial(src, `${src.motifId}:continue`, "CONTINUE");
}
function developMaterial(src, ctx) {
  const scale = ctx.scale ?? getScale(ctx.scaleName);
  if (src.pitchContour.length < 2 || !scale)
    return cloneMaterial(src, `${src.motifId}:develop`, "DEVELOP");
  const pcs = scalePcs(ctx.tonic, scale);
  const out = cloneMaterial(src, `${src.motifId}:develop`, "DEVELOP");
  const variation = ctx.variationAmount ?? 0.3;
  const lastIdx = src.pitchContour.length - 1;
  const prevMidi = src.pitchContour[lastIdx - 1] ?? ctx.rootMidi;
  const curMidi = src.pitchContour[lastIdx] ?? ctx.rootMidi;
  const dir = curMidi >= prevMidi ? 1 : -1;
  const curPc = (curMidi % 12 + 12) % 12;
  const curDegIdx = pcs.indexOf(curPc);
  const nextDegIdx = curDegIdx >= 0 ? (curDegIdx + dir + pcs.length) % pcs.length : 0;
  const nextPc = pcs[nextDegIdx] ?? curPc;
  let newMidi = curMidi - curPc + nextPc;
  if (ctx.rng.next() < variation * 0.5)
    newMidi += dir * 12;
  newMidi = snapToScale2(newMidi, ctx.tonic, scale);
  out.pitchContour[lastIdx] = newMidi;
  if (src.pitchContour.length >= 3 && ctx.rng.next() < variation * 0.6) {
    const idx = src.pitchContour.length - 2;
    const base = src.pitchContour[idx] ?? ctx.rootMidi;
    const step = ctx.rng.pick([1, -1, 2, -2]);
    out.pitchContour[idx] = snapToScale2(base + step, ctx.tonic, scale);
  }
  out.intervalSequence = intervalsOf(out.pitchContour);
  out.registerProfile = mean(out.pitchContour);
  out.harmonicTargets = pcsOf(out.pitchContour);
  return out;
}
function variateMaterial(src, ctx) {
  if (src.pitchContour.length < 3)
    return cloneMaterial(src, `${src.motifId}:variate`, "VARIATE");
  const out = cloneMaterial(src, `${src.motifId}:variate`, "VARIATE");
  const i = 1 + Math.floor(ctx.rng.next() * (src.pitchContour.length - 2));
  const j = i + 1;
  const tmp = out.pitchContour[i];
  out.pitchContour[i] = out.pitchContour[j];
  out.pitchContour[j] = tmp;
  const tmpV = out.accentPattern[i];
  out.accentPattern[i] = out.accentPattern[j];
  out.accentPattern[j] = tmpV;
  const tmpD = out.noteDurations[i];
  out.noteDurations[i] = out.noteDurations[j];
  out.noteDurations[j] = tmpD;
  out.intervalSequence = intervalsOf(out.pitchContour);
  out.registerProfile = mean(out.pitchContour);
  out.harmonicTargets = pcsOf(out.pitchContour);
  return out;
}
function answerMaterial(src, ctx) {
  const scale = ctx.scale ?? getScale(ctx.scaleName);
  if (src.pitchContour.length < 2 || !scale)
    return cloneMaterial(src, `${src.motifId}:answer`, "ANSWER");
  const out = cloneMaterial(src, `${src.motifId}:answer`, "ANSWER");
  const first = src.pitchContour[0] ?? ctx.rootMidi;
  for (let i = 1;i < src.pitchContour.length; i++) {
    const offset = (src.pitchContour[i] ?? first) - first;
    out.pitchContour[i] = snapToScale2(first - offset, ctx.tonic, scale);
  }
  out.intervalSequence = intervalsOf(out.pitchContour);
  out.registerProfile = mean(out.pitchContour);
  out.harmonicTargets = pcsOf(out.pitchContour);
  return out;
}
function contrastMaterial(src, ctx) {
  const scale = ctx.scale ?? getScale(ctx.scaleName);
  if (!scale)
    return cloneMaterial(src, `${src.motifId}:contrast`, "CONTRAST");
  const pcs = scalePcs(ctx.tonic, scale);
  const len = Math.max(3, Math.min(6, src.pitchContour.length || 4));
  const pitchContour = [];
  let cur = ctx.rootMidi;
  for (let i = 0;i < len; i++) {
    const pc = ctx.rng.pick(pcs);
    const oct = 4 + (ctx.rng.next() < 0.3 ? 1 : 0);
    const candidate = degreeToMidi(ctx.tonic, scale, pcs.indexOf(pc) >= 0 ? pcs.indexOf(pc) : 0, oct);
    pitchContour.push(snapToScale2(candidate, ctx.tonic, scale));
    cur = candidate;
  }
  const rhythmPattern = [];
  const accentPattern = [];
  const noteDurations = [];
  let step = 0;
  for (let i = 0;i < len; i++) {
    rhythmPattern.push(step % src.stepsPerBar);
    accentPattern.push(i === 0 ? 0.9 : 0.5 + ctx.rng.next() * 0.3);
    noteDurations.push(ctx.rng.pick([1, 1, 2]));
    step += ctx.rng.pick([1, 2, 2]);
  }
  const intervals = intervalsOf(pitchContour);
  return {
    motifId: `${src.motifId}:contrast-${Date.now().toString(36)}`,
    pitchContour,
    intervalSequence: intervals,
    rhythmPattern,
    onsetPositions: rhythmPattern.slice(),
    accentPattern,
    noteDurations,
    registerProfile: mean(pitchContour),
    harmonicTargets: pcsOf(pitchContour),
    stepsPerBar: src.stepsPerBar,
    transformHistory: [...src.transformHistory, "CONTRAST"],
    rhythmicCell: deriveRhythmicCell(rhythmPattern),
    intervalCell: deriveIntervalCell(intervals),
    contour: classifyContour(intervals),
    accentShape: { weights: accentPattern.slice(), climaxPosition: findClimax(accentPattern) },
    densityShape: [Math.min(1, pitchContour.length / src.stepsPerBar)],
    registerShape: [mean(pitchContour)],
    harmonicTargetShape: pcsOf(pitchContour),
    cadenceTarget: pitchContour.length > 0 ? ((pitchContour[pitchContour.length - 1] ?? 0 % 12) + 12) % 12 : null,
    phraseArc: buildPhraseArc(1, mean(pitchContour), 0.3),
    developmentHistory: src.developmentHistory.slice()
  };
}
function intensifyMaterial(src, ctx) {
  if (src.pitchContour.length === 0)
    return cloneMaterial(src, `${src.motifId}:intensify`, "INTENSIFY");
  const out = cloneMaterial(src, `${src.motifId}:intensify`, "INTENSIFY");
  const newPitches = [];
  const newRhythm = [];
  const newAccent = [];
  const newDurations = [];
  for (let i = 0;i < src.pitchContour.length; i++) {
    const midi = src.pitchContour[i];
    const step = src.rhythmPattern[i];
    const dur = src.noteDurations[i];
    const vel = src.accentPattern[i];
    newPitches.push(midi);
    newRhythm.push(step);
    newAccent.push(vel);
    newDurations.push(Math.max(1, Math.floor(dur / 2)));
    if (dur >= 2 && ctx.rng.next() < (ctx.variationAmount ?? 0.5) + 0.3) {
      const subStep = (step + Math.floor(dur / 2)) % src.stepsPerBar;
      newPitches.push(midi);
      newRhythm.push(subStep);
      newAccent.push(vel * 0.7);
      newDurations.push(Math.max(1, dur - Math.floor(dur / 2)));
    }
  }
  out.pitchContour = newPitches;
  out.rhythmPattern = newRhythm;
  out.onsetPositions = newRhythm.slice();
  out.accentPattern = newAccent;
  out.noteDurations = newDurations;
  out.intervalSequence = intervalsOf(newPitches);
  out.registerProfile = mean(newPitches);
  out.harmonicTargets = pcsOf(newPitches);
  return out;
}
function reduceMaterial(src) {
  if (src.pitchContour.length <= 1)
    return cloneMaterial(src, `${src.motifId}:reduce`, "REDUCE");
  const keep = Math.max(1, Math.ceil(src.pitchContour.length / 2));
  const out = cloneMaterial(src, `${src.motifId}:reduce`, "REDUCE");
  out.pitchContour = src.pitchContour.slice(0, keep);
  out.rhythmPattern = src.rhythmPattern.slice(0, keep);
  out.onsetPositions = src.onsetPositions.slice(0, keep);
  out.accentPattern = src.accentPattern.slice(0, keep);
  out.noteDurations = src.noteDurations.slice(0, keep);
  out.intervalSequence = intervalsOf(out.pitchContour);
  out.registerProfile = mean(out.pitchContour);
  out.harmonicTargets = pcsOf(out.pitchContour);
  return out;
}
function breakMaterial(src) {
  if (src.pitchContour.length === 0)
    return cloneMaterial(src, `${src.motifId}:break`, "BREAK");
  const out = cloneMaterial(src, `${src.motifId}:break`, "BREAK");
  out.pitchContour = [src.pitchContour[0]];
  out.rhythmPattern = [0];
  out.onsetPositions = [0];
  out.accentPattern = [0.9];
  out.noteDurations = [src.stepsPerBar];
  out.intervalSequence = [];
  out.registerProfile = out.pitchContour[0];
  out.harmonicTargets = pcsOf(out.pitchContour);
  return out;
}
function resolveMaterial(src, ctx) {
  const scale = ctx.scale ?? getScale(ctx.scaleName);
  if (!scale || src.pitchContour.length === 0)
    return cloneMaterial(src, `${src.motifId}:resolve`, "RESOLVE");
  const pcs = scalePcs(ctx.tonic, scale);
  const targetPc = ctx.cadenceTargetPc ?? pcs[0] ?? ctx.tonic;
  const out = cloneMaterial(src, `${src.motifId}:resolve`, "RESOLVE");
  let cur = src.pitchContour[src.pitchContour.length - 1] ?? ctx.rootMidi;
  let step = ((src.rhythmPattern[src.rhythmPattern.length - 1] ?? 0) + 2) % src.stepsPerBar;
  let guard = 0;
  while ((cur % 12 + 12) % 12 !== targetPc && guard < 8) {
    const curPc = (cur % 12 + 12) % 12;
    const curDegIdx = pcs.indexOf(curPc);
    const nextDegIdx = curDegIdx >= 0 ? (curDegIdx - 1 + pcs.length) % pcs.length : 0;
    const nextPc = pcs[nextDegIdx] ?? targetPc;
    cur = cur - curPc + nextPc;
    cur = snapToScale2(cur, ctx.tonic, scale);
    out.pitchContour.push(cur);
    out.rhythmPattern.push(step);
    out.onsetPositions.push(step);
    out.accentPattern.push(0.7);
    out.noteDurations.push(1);
    step = (step + 1) % src.stepsPerBar;
    guard++;
  }
  out.pitchContour.push(cur);
  out.rhythmPattern.push(step);
  out.onsetPositions.push(step);
  out.accentPattern.push(1);
  out.noteDurations.push(2);
  out.intervalSequence = intervalsOf(out.pitchContour);
  out.registerProfile = mean(out.pitchContour);
  out.harmonicTargets = pcsOf(out.pitchContour);
  return out;
}
function transitionMaterial(src, ctx) {
  const scale = ctx.scale ?? getScale(ctx.scaleName);
  if (!scale)
    return cloneMaterial(src, `${src.motifId}:transition`, "TRANSITION");
  const pcs = scalePcs(ctx.tonic, scale);
  const out = cloneMaterial(src, `${src.motifId}:transition`, "TRANSITION");
  let cur = src.pitchContour[src.pitchContour.length - 1] ?? ctx.rootMidi;
  let step = ((src.rhythmPattern[src.rhythmPattern.length - 1] ?? 0) + 2) % src.stepsPerBar;
  const rootPc = pcs[0] ?? ctx.tonic;
  let guard = 0;
  while ((cur % 12 + 12) % 12 !== rootPc && guard < 6) {
    const curPc = (cur % 12 + 12) % 12;
    const curDegIdx = pcs.indexOf(curPc);
    const dir = curDegIdx > 0 ? -1 : 0;
    const nextDegIdx = curDegIdx >= 0 ? (curDegIdx + dir + pcs.length) % pcs.length : 0;
    const nextPc = pcs[nextDegIdx] ?? rootPc;
    cur = cur - curPc + nextPc;
    cur = snapToScale2(cur, ctx.tonic, scale);
    out.pitchContour.push(cur);
    out.rhythmPattern.push(step);
    out.onsetPositions.push(step);
    out.accentPattern.push(0.6);
    out.noteDurations.push(1);
    step = (step + 1) % src.stepsPerBar;
    guard++;
  }
  out.intervalSequence = intervalsOf(out.pitchContour);
  out.registerProfile = mean(out.pitchContour);
  out.harmonicTargets = pcsOf(out.pitchContour);
  return out;
}
function applyOperatorToMaterial(op, src, ctx) {
  switch (op) {
    case "CONTINUE":
      return continueMaterial(src);
    case "DEVELOP":
      return developMaterial(src, ctx);
    case "ANSWER":
      return answerMaterial(src, ctx);
    case "CONTRAST":
      return contrastMaterial(src, ctx);
    case "VARIATE":
      return variateMaterial(src, ctx);
    case "INTENSIFY":
      return intensifyMaterial(src, ctx);
    case "REDUCE":
      return reduceMaterial(src);
    case "BREAK":
      return breakMaterial(src);
    case "RESOLVE":
      return resolveMaterial(src, ctx);
    case "TRANSITION":
      return transitionMaterial(src, ctx);
    default:
      return continueMaterial(src);
  }
}

// packages/music/src/rhythmic-space-map.ts
function buildRhythmicSpaceMap(opts) {
  const { stepsPerBar, kickOnsets, bassOnsets, accentSteps } = opts;
  const kickSet = new Set(kickOnsets);
  const bassSet = new Set(bassOnsets);
  const accentSet = new Set(accentSteps);
  const hatSet = new Set(opts.hatOnsets ?? []);
  const harmSet = new Set(opts.harmonicChangeSteps ?? []);
  const anticiSet = new Set(opts.bassAnticipationSteps ?? []);
  const cells = [];
  for (let step = 0;step < stepsPerBar; step++) {
    const kickHas = kickSet.has(step);
    const bassHas = bassSet.has(step);
    const occupied = kickHas || bassHas;
    const open = !occupied;
    const kickStrength = kickHas ? 1 : 0;
    const bassStrength = bassHas ? 1 : 0;
    const drumAccent = (accentSet.has(step) ? 0.6 : 0) + (hatSet.has(step) ? 0.3 : 0);
    const harmonicAccent = harmSet.has(step) ? 1 : 0;
    let preferredLead;
    if (open) {
      preferredLead = 0.6 + Math.min(0.3, drumAccent) + harmonicAccent * 0.1;
    } else if (kickHas && !bassHas) {
      preferredLead = 0.25 + harmonicAccent * 0.2;
    } else if (bassHas && !kickHas) {
      preferredLead = 0.2;
    } else {
      preferredLead = 0.1;
    }
    if (anticiSet.has(step))
      preferredLead = Math.max(preferredLead, 0.7);
    let preferredResponse = 0;
    for (const bs of bassOnsets) {
      const offset = step - bs;
      if (offset === 1)
        preferredResponse = Math.max(preferredResponse, 0.85);
      else if (offset === 2)
        preferredResponse = Math.max(preferredResponse, 0.6);
      else if (offset === 3)
        preferredResponse = Math.max(preferredResponse, 0.35);
    }
    if (bassHas)
      preferredResponse = Math.min(preferredResponse, 0.15);
    cells.push({
      step,
      kickStrength,
      bassStrength,
      drumAccent,
      harmonicAccent,
      occupied,
      open,
      preferredLead,
      preferredResponse
    });
  }
  return { stepsPerBar, cells };
}
function cellAt(map, step) {
  const wrapped = (step % map.stepsPerBar + map.stepsPerBar) % map.stepsPerBar;
  const cell = map.cells[wrapped];
  if (!cell) {
    return {
      step: wrapped,
      kickStrength: 0,
      bassStrength: 0,
      drumAccent: 0,
      harmonicAccent: 0,
      occupied: false,
      open: true,
      preferredLead: 0.5,
      preferredResponse: 0
    };
  }
  return cell;
}

// packages/music/src/sound-dna.ts
function timbreToSoundDNA(timbre) {
  return {
    brightness: timbre.brightness,
    harmonicity: timbre.harmonicity,
    noisiness: timbre.noisiness,
    attack: timbre.attack,
    spectralCentroid: timbre.spectralCentroid,
    subEnergy: timbre.subEnergy,
    saturation: timbre.saturation,
    roughness: timbre.roughness,
    transientCharacter: timbre.transientCharacter,
    stereoWidth: 0.5
  };
}
function renderSynthRecipe(dna, role) {
  const oscillators = [];
  if (dna.roughness > 0.5 && role === "bass") {
    oscillators.push({
      type: "fm",
      detuneCents: 0,
      mix: 1,
      octaveOffset: 0,
      fmAmount: dna.roughness * 0.8
    });
  } else if (dna.brightness > 0.65) {
    oscillators.push({ type: "saw", detuneCents: 0, mix: 0.6, octaveOffset: 0 });
    oscillators.push({
      type: "square",
      detuneCents: dna.harmonicity > 0.5 ? 7 : 0,
      mix: 0.3,
      octaveOffset: 0
    });
    if (dna.harmonicity > 0.6) {
      oscillators.push({ type: "saw", detuneCents: -7, mix: 0.3, octaveOffset: 1 });
    }
  } else if (dna.brightness > 0.35) {
    oscillators.push({ type: "triangle", detuneCents: 0, mix: 0.7, octaveOffset: 0 });
    oscillators.push({ type: "saw", detuneCents: 0, mix: 0.2, octaveOffset: 0 });
  } else {
    oscillators.push({ type: "sine", detuneCents: 0, mix: 0.8, octaveOffset: 0 });
    if (dna.subEnergy > 0.5) {
      oscillators.push({ type: "sine", detuneCents: 0, mix: 0.5, octaveOffset: -1 });
    }
  }
  let filter;
  if (dna.brightness > 0.65 && role !== "kick") {
    filter = {
      topology: "moog-ladder",
      cutoffHz: 200 + dna.brightness * 4000,
      resonance: 0.2 + dna.noisiness * 0.4,
      envelopeAmount: 0.3 + dna.transientCharacter * 0.3
    };
  } else if (dna.brightness < 0.3) {
    filter = {
      topology: "one-pole-lp",
      cutoffHz: 100 + dna.brightness * 800,
      resonance: 0,
      envelopeAmount: 0.2
    };
  } else if (role === "hats" || role === "percussion") {
    filter = {
      topology: "biquad-hp",
      cutoffHz: 2000 + dna.brightness * 4000,
      resonance: 0.3,
      envelopeAmount: 0.1
    };
  } else {
    filter = {
      topology: "biquad-lp",
      cutoffHz: 300 + dna.brightness * 3000,
      resonance: 0.1 + dna.noisiness * 0.3,
      envelopeAmount: 0.2 + dna.transientCharacter * 0.2
    };
  }
  const envelope = {
    attackSec: dna.attack > 0.5 ? 0.05 + dna.attack * 0.2 : Math.max(0.001, dna.attack * 0.01),
    decaySec: 0.05 + (1 - dna.transientCharacter) * 0.5,
    sustain: dna.transientCharacter > 0.5 ? 0.3 : 0.6,
    releaseSec: 0.1 + (1 - dna.transientCharacter) * 0.4
  };
  let saturation;
  if (dna.saturation > 0.6) {
    saturation = { type: "hard-clip", drive: 0.5 + dna.saturation * 0.4 };
  } else if (dna.saturation > 0.3) {
    saturation = { type: "tanh", drive: 0.3 + dna.saturation * 0.4 };
  } else if (dna.noisiness > 0.4) {
    saturation = { type: "soft-clip", drive: 0.2 + dna.noisiness * 0.3 };
  } else {
    saturation = { type: "none", drive: 0 };
  }
  let lfo;
  if (dna.roughness > 0.5 && role === "bass") {
    lfo = { target: "cutoff", rateHz: 4 + dna.roughness * 8, depth: 0.3, waveform: "sine" };
  } else if (dna.harmonicity > 0.6 && role === "lead") {
    lfo = { target: "pitch", rateHz: 5, depth: 0.1, waveform: "triangle" };
  } else if (dna.noisiness > 0.5 && role === "pad") {
    lfo = { target: "amplitude", rateHz: 3, depth: 0.3, waveform: "sine" };
  } else {
    lfo = { target: "none", rateHz: 0, depth: 0, waveform: "sine" };
  }
  const stereo = {
    width: dna.stereoWidth,
    pingPong: dna.noisiness > 0.5 ? 0.2 + dna.noisiness * 0.3 : 0
  };
  return {
    role,
    oscillators,
    filter,
    envelope,
    saturation,
    lfo,
    stereo,
    fingerprint: `${role}:${oscillators.map((o) => o.type).join("+")}:${filter.topology}:${saturation.type}:${lfo.target}`
  };
}

// packages/music/src/tension-dimensions.ts
function deriveTensionDimensions(tension) {
  const t = Math.max(0, Math.min(1, tension));
  return {
    harmonic: t,
    melodic: Math.round(3 + t * 7),
    rhythmic: 0.1 + t * 0.7,
    register: Math.round(2 + t * 6),
    density: 0.5 + t * 0.8,
    spectral: 0.2 + t * 0.7,
    expectation: 0.05 + t * 0.45
  };
}
function applyHarmonicTension(chordTones, tension, scalePcs2) {
  const dims = deriveTensionDimensions(tension);
  if (dims.harmonic < 0.4)
    return chordTones;
  const extensions = scalePcs2.filter((pc) => !chordTones.includes(pc));
  if (extensions.length === 0)
    return chordTones;
  const idx = Math.floor(dims.harmonic * (extensions.length - 1));
  const ext = extensions[Math.min(idx, extensions.length - 1)];
  if (ext !== undefined)
    return [...chordTones, ext];
  return chordTones;
}
function applyRegisterTension(registerCenter, tension) {
  const dims = deriveTensionDimensions(tension);
  return registerCenter + (tension - 0.5) * dims.register;
}
function applyDensityTension(baseDensity, tension) {
  const dims = deriveTensionDimensions(tension);
  return Math.max(0.1, Math.min(1, baseDensity * dims.density));
}

// packages/music/src/voice-plans.ts
function emptyBassPlan() {
  return { notes: [], onsets: [] };
}
function emptyLeadPlan() {
  return { notes: [] };
}

// packages/music/src/composition-engine.ts
var BASS_OCTAVE = 2;
var LEAD_MIN_MIDI = 60;
var LEAD_MAX_MIDI = 84;

class CompositionEngine {
  memory;
  seed;
  context;
  grammar;
  preferenceFor;
  learned;
  interactionGrammar;
  previousPhraseMaterial;
  developmentOperator;
  relationalOff;
  identity;
  constructor(opts) {
    this.memory = opts.memory ?? new MotifMemory;
    this.seed = opts.seed;
    this.context = opts.context;
    this.grammar = opts.grammar ?? getStyleGrammar(opts.context.sectionRole || "full-on");
    this.preferenceFor = opts.preferenceFor ?? null;
    this.learned = opts.learnedContext ?? opts.identity?.learned ?? createEmptyLearnedContext();
    this.interactionGrammar = opts.interactionGrammar ?? opts.identity?.grammar ?? createEmptyInteractionGrammar();
    this.previousPhraseMaterial = opts.previousPhraseMaterial ?? null;
    this.developmentOperator = opts.developmentOperator ?? null;
    this.relationalOff = opts.relationalGenerationOff ?? false;
    this.identity = opts.identity ?? null;
    if (this.identity) {
      this.context = {
        ...this.context,
        energy: this.identity.energy,
        tension: this.identity.tension,
        density: 0.3 + this.identity.energy * 0.4
      };
    }
    this.seedMemory();
  }
  composePhrase(opts) {
    const { bars, arrangementState, groove, harmonicContext } = opts;
    const intent = opts.intent;
    const rng = new Rng(this.seed * 7919 + bars * 31 + arrangementState.length * 17 + harmonicContext.length * 7 >>> 0);
    const roles = { ...ARRANGEMENT_ROLE_MAP[arrangementState] };
    if (intent) {
      if (intent.bassPressure < 0.3)
        roles.bass = false;
      if (intent.leadPressure < 0.3)
        roles.lead = false;
      if (intent.groovePressure < 0.3) {
        roles.kick = false;
        roles.hats = false;
      }
      if (intent.texturePressure > 0.6)
        roles.hats = true;
    }
    const phraseMotif = opts.callbackMotif ?? this.choosePhraseMotif(rng, opts.previousPhrase);
    const callbackTo = opts.callbackMotif?.id;
    const harmonicPlan = buildHarmonicPlan({
      bars,
      startBar: opts.startBar ?? 0,
      tonic: this.context.tonic,
      scaleName: this.context.scaleName,
      phraseIndex: opts.phraseIndex ?? 0,
      isLastPhrase: opts.isLastPhrase ?? false,
      phraseRole: opts.phraseRole,
      chordChangeRate: this.grammar.chordChangeRate,
      tensionPreference: this.grammar.tensionPreference,
      learnedPcProfile: this.learned.harmony.pitchClassProfile,
      learnedConfidence: this.learned.meta.confidence,
      progressionName: this.context.progressionName
    });
    let phraseMaterial;
    if (this.previousPhraseMaterial && this.developmentOperator) {
      const scale = getScale(this.context.scaleName);
      const fallbackScale = getScale("phrygian-dominant");
      const rootMidi = degreeToMidi(this.context.tonic, scale ?? fallbackScale ?? getScale("minor"), 0, 4);
      phraseMaterial = applyOperatorToMaterial(this.developmentOperator, this.previousPhraseMaterial, {
        tonic: this.context.tonic,
        scaleName: this.context.scaleName,
        scale: scale ?? undefined,
        rootMidi,
        rng,
        variationAmount: 0.4,
        cadenceTargetPc: harmonicPlan.cadenceTarget.pc
      });
    } else {
      phraseMaterial = motifToPhraseMaterial(phraseMotif, groove.stepsPerBar);
    }
    const half = Math.floor(bars / 2);
    const composedBars = [];
    const grammarConfidence = this.interactionGrammar.confidence;
    const tensionDims = deriveTensionDimensions(this.context.tension);
    for (let bar = 0;bar < bars; bar++) {
      const isLast = bar === bars - 1;
      const isResponse = bar >= half;
      const bassRng = new Rng(this.seed * 131 + bar * 53 + 11 >>> 0);
      const leadRng = new Rng(this.seed * 191 + bar * 71 + 23 >>> 0);
      const absoluteBar = (opts.startBar ?? 0) + bar;
      const activeChord = chordAtBar(harmonicPlan, absoluteBar);
      const barChordTones = activeChord?.chordTones ?? harmonicContext;
      const nextChord = nextChordAfterBar(harmonicPlan, absoluteBar);
      const isAnticipation = isAnticipationBar(harmonicPlan, absoluteBar);
      const kickPlan = this.composeKickPlan(bar, groove, rng);
      const kickNotes = kickPlan.onsets;
      let hatNotes = [];
      if (roles.hats) {
        hatNotes = Array.from(new Set(groove.hatSteps)).sort((a, b) => a - b);
        const learnedHats = this.learned.rhythm.hatGrammar;
        if (this.learned.meta.confidence > 0.3 && learnedHats.some((v) => v > 0.1)) {
          const hatRng = new Rng(this.seed * 223 + bar * 47 + 13 >>> 0);
          const generated = [];
          for (let step = 0;step < groove.stepsPerBar; step++) {
            const prob = learnedHats[step % 16] ?? 0;
            const styleHas = groove.hatSteps.includes(step);
            const blended = styleHas ? 0.7 : prob * 0.5;
            if (hatRng.next() < blended) {
              generated.push(step);
            }
          }
          hatNotes = generated.length > 0 ? generated.sort((a, b) => a - b) : hatNotes;
        }
      }
      let bassPlan = emptyBassPlan();
      if (roles.bass) {
        if (this.relationalOff) {
          bassPlan = this.composeBassLegacy(bar, groove, bassRng, isLast);
        } else if (this.identity) {
          const bassScale = getScale(this.context.scaleName);
          if (bassScale) {
            const vocabNotes = generateBassByVocabulary(this.identity.bassVocabulary, {
              bar,
              groove,
              kickPlan,
              chordTones: barChordTones,
              tonic: this.context.tonic,
              scaleName: this.context.scaleName,
              scale: bassScale,
              isLast,
              isAnticipationBar: isAnticipation,
              rng: bassRng,
              intervalWidth: this.identity.bassIntervalWidth,
              syncopation: this.identity.syncopation,
              bassOctave: BASS_OCTAVE,
              tension: this.context.tension
            });
            bassPlan = { notes: vocabNotes, onsets: vocabNotes.map((n) => n.step) };
          }
        } else {
          bassPlan = this.composeBassPlan({
            bar,
            groove,
            kickPlan,
            chordTones: barChordTones,
            harmonicFunction: activeChord?.function ?? "TONIC",
            isLast,
            rng: bassRng,
            grammarConfidence,
            isAnticipationBar: isAnticipation
          });
        }
      }
      const bassNotes = bassPlan.notes.map((n) => ({
        midi: n.midi,
        step: n.step,
        durationSteps: n.durationSteps,
        function: n.function
      }));
      const spaceMap = buildRhythmicSpaceMap({
        stepsPerBar: groove.stepsPerBar,
        kickOnsets: kickPlan.onsets,
        bassOnsets: bassPlan.onsets,
        accentSteps: groove.accentSteps,
        hatOnsets: hatNotes,
        harmonicChangeSteps: isAnticipation ? [groove.stepsPerBar - 1] : [],
        bassAnticipationSteps: bassPlan.notes.filter((n) => n.isAnticipation).map((n) => n.step)
      });
      let leadPlan = emptyLeadPlan();
      if (roles.lead) {
        if (this.relationalOff) {
          const legacyNotes = this.composeLeadLegacy(bar, bars, phraseMotif, barChordTones, leadRng, isResponse);
          leadPlan = { notes: legacyNotes.map((n) => ({ ...n, role: "CONTINUATION" })) };
        } else {
          leadPlan = this.composeLeadPlan({
            bar,
            bars,
            groove,
            kickPlan,
            bassPlan,
            spaceMap,
            harmonicPlan,
            activeChord: activeChord ?? null,
            nextChord,
            isAnticipation,
            isLast,
            isResponse,
            phraseMaterial,
            phraseRole: opts.phraseRole ?? "STATEMENT",
            rng: leadRng,
            grammarConfidence
          });
        }
      }
      const leadNotes = leadPlan.notes.map((n) => ({
        midi: n.midi,
        step: n.step,
        durationSteps: n.durationSteps,
        velocity: n.velocity
      }));
      let adjustedBass = bassNotes;
      let adjustedLead = leadNotes;
      if (intent) {
        if (intent.bassPressure < 0.6 && adjustedBass.length > 1) {
          const keepRatio = Math.max(0.3, intent.bassPressure);
          const keepCount = Math.max(1, Math.floor(adjustedBass.length * keepRatio));
          adjustedBass = adjustedBass.slice(0, keepCount);
        }
        if (intent.leadPressure < 0.6 && adjustedLead.length > 1) {
          const keepRatio = Math.max(0.2, intent.leadPressure);
          const keepCount = Math.max(1, Math.floor(adjustedLead.length * keepRatio));
          adjustedLead = adjustedLead.slice(0, keepCount);
        }
        if (intent.registerShift !== 0 && adjustedLead.length > 0) {
          const shift = intent.registerShift * 12;
          adjustedLead = adjustedLead.map((n) => ({
            ...n,
            midi: Math.max(LEAD_MIN_MIDI, Math.min(LEAD_MAX_MIDI, n.midi + shift))
          }));
        }
        if (intent.restPressure > 0.5 && bar % 4 === 2) {
          adjustedLead = [];
        }
        if (intent.texturePressure > 0.6 && hatNotes.length === 0 && roles.hats) {
          hatNotes.push(2, 6, 10, 14);
        }
      }
      const soundDNA = timbreToSoundDNA(this.learned.timbre);
      soundDNA.brightness = Math.max(0, Math.min(1, soundDNA.brightness * 0.5 + tensionDims.spectral * 0.5));
      const synthRecipes = {
        kick: renderSynthRecipe(soundDNA, "kick"),
        bass: renderSynthRecipe(soundDNA, "bass"),
        lead: renderSynthRecipe(soundDNA, "lead"),
        hats: renderSynthRecipe(soundDNA, "hats")
      };
      composedBars.push({
        barIndex: bar,
        arrangementState,
        groove,
        kickNotes,
        bassNotes: adjustedBass,
        leadNotes: adjustedLead,
        hatNotes,
        harmonicContext: barChordTones.slice(),
        roles: { ...roles },
        timbreIntent: this.learned.meta.confidence > 0.3 ? {
          brightness: this.learned.timbre.brightness,
          harmonicity: this.learned.timbre.harmonicity,
          noisiness: this.learned.timbre.noisiness,
          attack: this.learned.timbre.attack,
          subEnergy: this.learned.timbre.subEnergy
        } : undefined,
        harmonicPlan,
        activeChord: activeChord ?? undefined,
        spaceMap,
        kickPlan,
        bassPlan,
        leadPlan,
        synthRecipes,
        soundDNA
      });
    }
    return {
      bars: composedBars,
      phraseArc: { opening: 0, peak: half, resolution: Math.max(0, bars - 1) },
      motifIds: [phraseMotif.id],
      callbackTo,
      seed: this.seed,
      phraseMaterial,
      developmentOperator: this.developmentOperator ?? undefined,
      harmonicPlan
    };
  }
  composeSection(opts) {
    const groove = buildGroovePlan({
      context: this.context,
      seed: this.seed,
      bars: opts.bars,
      grammar: this.grammar
    });
    const arrangement = planArrangement({
      bars: opts.bars,
      seed: this.seed,
      context: this.context
    });
    const groups = [];
    let curState = null;
    let curStart = 0;
    for (let bar = 0;bar < opts.bars; bar++) {
      const slot = arrangement.slots[bar];
      const state = slot?.state ?? "GROOVE";
      if (curState === null) {
        curState = state;
        curStart = bar;
      } else if (state !== curState) {
        groups.push({ state: curState, start: curStart, length: bar - curStart });
        curState = state;
        curStart = bar;
      }
    }
    if (curState !== null) {
      groups.push({
        state: curState,
        start: curStart,
        length: opts.bars - curStart
      });
    }
    const totalPhrases = groups.length;
    const phrases = [];
    const bars = [];
    let prev;
    let firstPhraseMotif;
    for (let phraseIdx = 0;phraseIdx < groups.length; phraseIdx++) {
      const group = groups[phraseIdx];
      const isLastPhrase = phraseIdx === totalPhrases - 1;
      const harmonicContext = this.chooseHarmonicForPhrase(phraseIdx);
      const callbackMotif = isLastPhrase && firstPhraseMotif ? firstPhraseMotif : undefined;
      const phraseRole = this.derivePhraseRole(group.state, phraseIdx, isLastPhrase);
      const phrase = this.composePhrase({
        bars: group.length,
        arrangementState: group.state,
        groove,
        harmonicContext,
        previousPhrase: prev,
        callbackMotif,
        startBar: group.start,
        phraseIndex: phraseIdx,
        isLastPhrase,
        phraseRole
      });
      for (const b of phrase.bars) {
        const absoluteBar = b.barIndex + group.start;
        const absSlot = arrangement.slots.find((s) => s.barIndex === absoluteBar);
        const out = { ...b, barIndex: absoluteBar };
        if (absSlot) {
          out.roles = { ...absSlot.roles };
        }
        bars.push(out);
      }
      phrases.push(phrase);
      if (phraseIdx === 0) {
        const id = phrase.motifIds[0];
        if (id) {
          const entry = this.memory.retrieve(id);
          if (entry)
            firstPhraseMotif = entry.motif;
        }
      }
      prev = phrase;
    }
    return { bars, phrases, arrangement, groove, seed: this.seed };
  }
  renderNotes(section) {
    const kick = [];
    const bass = [];
    const lead = [];
    const hats = [];
    for (const bar of section.bars) {
      for (const step of bar.kickNotes)
        kick.push({ step, bar: bar.barIndex });
      for (const n of bar.bassNotes) {
        bass.push({ midi: n.midi, step: n.step, bar: bar.barIndex, function: n.function });
      }
      for (const n of bar.leadNotes) {
        lead.push({ midi: n.midi, step: n.step, bar: bar.barIndex, velocity: n.velocity });
      }
      for (const step of bar.hatNotes)
        hats.push({ step, bar: bar.barIndex });
    }
    return { kick, bass, lead, hats };
  }
  seedMemory() {
    if (this.memory.size > 0)
      return;
    const baseMotif = generateMotifV2({ ...this.context, octave: 4 }, this.seed * 7 + 1 >>> 0, "lead");
    this.memory.ingest(baseMotif, 0, { salience: 0.7, role: "lead" });
    const altMotif = generateMotifV2({ ...this.context, octave: 4 }, this.seed * 13 + 31 >>> 0, "lead");
    this.memory.ingest(altMotif, 0, { salience: 0.6, role: "lead" });
  }
  choosePhraseMotif(rng, previousPhrase) {
    if (previousPhrase && rng.next() < 0.3) {
      const prevId = previousPhrase.motifIds[0];
      if (prevId) {
        const entry = this.memory.retrieve(prevId);
        if (entry)
          return entry.motif;
      }
    }
    const candidates = [];
    for (let i = 0;i < 3; i++) {
      const freshSeed = this.seed * 101 + rng.int(1, 1e6) + i * 7919 >>> 0;
      candidates.push(generateMotifV2({ ...this.context, octave: 4 }, freshSeed, "lead"));
    }
    if (this.preferenceFor) {
      const prefFn = this.preferenceFor;
      const scored = candidates.map((m) => ({ motif: m, score: prefFn ? prefFn(m) : 0.5 }));
      scored.sort((a, b) => b.score - a.score);
      if (rng.next() < 0.7) {
        const best = scored[0];
        this.memory.ingest(best.motif, 0, { salience: 0.6, role: "lead" });
        return best.motif;
      }
      const pick = candidates[rng.int(0, candidates.length - 1)];
      this.memory.ingest(pick, 0, { salience: 0.6, role: "lead" });
      return pick;
    }
    const motif = candidates[0];
    this.memory.ingest(motif, 0, { salience: 0.6, role: "lead" });
    return motif;
  }
  chooseHarmonicForPhrase(phraseIndex) {
    const scale = getScale(this.context.scaleName);
    if (!scale)
      return [this.context.tonic];
    const pcs = scalePcs(this.context.tonic, scale);
    if (pcs.length < 5)
      return [pcs[0] ?? this.context.tonic];
    const pcProfile = this.learned.harmony.pitchClassProfile;
    const hasLearnedHarmony = this.learned.meta.confidence > 0.3 && pcProfile.some((v) => v > 0.05);
    const idx = (phraseIndex % 4 + 4) % 4;
    let baseChord;
    if (idx === 0) {
      baseChord = [pcs[0] ?? 0, pcs[2] ?? 0, pcs[4] ?? 0];
    } else if (idx === 1) {
      baseChord = [pcs[3] ?? 0, pcs[5] ?? 0, pcs[7 % pcs.length] ?? 0];
    } else if (idx === 2) {
      baseChord = [pcs[0] ?? 0, pcs[2] ?? 0, pcs[4] ?? 0];
    } else {
      baseChord = [pcs[4] ?? 0, pcs[6 % pcs.length] ?? 0, pcs[8 % pcs.length] ?? 0];
    }
    if (hasLearnedHarmony) {
      const sortedPcs = pcProfile.map((weight, pc) => ({ pc, weight })).filter((x) => pcs.includes(x.pc) && !baseChord.includes(x.pc)).sort((a, b) => b.weight - a.weight);
      if (sortedPcs.length > 0 && sortedPcs[0]) {
        const top = sortedPcs[0];
        baseChord = [baseChord[0] ?? 0, baseChord[1] ?? 0, top.pc];
      }
    }
    return baseChord;
  }
  derivePhraseRole(state, phraseIdx, isLastPhrase) {
    if (isLastPhrase)
      return "RESOLUTION";
    if (state === "INTRO" || state === "BUILD")
      return "INTRO";
    if (state === "BREAK" || state === "DROP")
      return "BUILD";
    if (state === "OUTRO")
      return "RESOLUTION";
    if (phraseIdx % 2 === 1)
      return "RESPONSE";
    return "STATEMENT";
  }
  composeKickPlan(bar, groove, _phraseRng) {
    let onsets = Array.from(new Set(groove.kickSteps)).sort((a, b) => a - b);
    const learnedKick = this.learned.rhythm.kickGrammar;
    const kickConf = this.learned.meta.confidence;
    if (kickConf > 0.3 && learnedKick.some((v) => v > 0.1)) {
      const kickRng = new Rng(this.seed * 211 + bar * 43 + 7 >>> 0);
      const generated = [];
      for (let step = 0;step < groove.stepsPerBar; step++) {
        const prob = learnedKick[step % 16] ?? 0;
        const styleHas = groove.kickSteps.includes(step);
        const blended = styleHas ? 0.8 : prob * 0.6;
        if (kickRng.next() < blended) {
          generated.push(step);
        }
      }
      if (!generated.includes(0))
        generated.unshift(0);
      onsets = generated.sort((a, b) => a - b);
    }
    const velocities = onsets.map((s) => s === 0 ? 1 : 0.7 + groove.accent[s] * 0.2);
    return { onsets, velocities };
  }
  composeBassPlan(opts) {
    const scale = getScale(this.context.scaleName);
    if (!scale)
      return emptyBassPlan();
    const { groove, kickPlan, rng, isLast, grammarConfidence } = opts;
    const rootMidi = degreeToMidi(this.context.tonic, scale, 0, BASS_OCTAVE);
    const fifthMidi = degreeToMidi(this.context.tonic, scale, 4, BASS_OCTAVE);
    const octaveMidi = degreeToMidi(this.context.tonic, scale, 0, BASS_OCTAVE + 1);
    const thirdMidi = degreeToMidi(this.context.tonic, scale, 2, BASS_OCTAVE);
    const seventhMidi = degreeToMidi(this.context.tonic, scale, 6, BASS_OCTAVE);
    const tension = this.grammar.tensionPreference;
    const bassDegPrefs = this.learned.bass.degreePreferences;
    const hasLearnedBass = Object.keys(bassDegPrefs).length > 0 && this.learned.meta.confidence > 0.3;
    const notes = [];
    let prevDegree = 0;
    const pickDegreeByPreferences = () => {
      if (hasLearnedBass) {
        const degrees = Object.entries(bassDegPrefs);
        const totalWeight = degrees.reduce((s, [, w]) => s + w, 0);
        let r = rng.next() * totalWeight;
        for (const [degStr, weight] of degrees) {
          r -= weight;
          if (r <= 0)
            return Number.parseInt(degStr, 10);
        }
      }
      return [0, 4, 2, 6][Math.floor(rng.next() * 4)] ?? 0;
    };
    const chooseNextDegree = (candidates) => {
      const row = this.interactionGrammar.bassTransitions.transitions[prevDegree];
      if (hasLearnedBass && grammarConfidence > 0.1 && row && Object.keys(row).length > 0) {
        return pickNextBassDegree({
          fromDegree: prevDegree,
          candidates,
          grammar: this.interactionGrammar,
          confidence: grammarConfidence,
          rng
        });
      }
      if (hasLearnedBass) {
        return pickDegreeByPreferences();
      }
      return candidates[Math.floor(rng.next() * candidates.length)] ?? 0;
    };
    const degreeToNote = (deg) => {
      const midi = degreeToMidi(this.context.tonic, scale, deg, BASS_OCTAVE);
      const fns = ["ROOT", "THIRD", "FIFTH", "SEVENTH", "OCTAVE"];
      return { midi, fn: fns[deg] ?? "PASSING" };
    };
    notes.push({
      midi: rootMidi,
      step: 0,
      durationSteps: 2,
      function: "ROOT",
      isAnticipation: false
    });
    prevDegree = 0;
    const kickSet = new Set(kickPlan.onsets);
    if (groove.bassKickAlignment === "LOCKED") {
      for (const step of kickPlan.onsets) {
        if (step === 0)
          continue;
        if (rng.next() < 0.3 + tension * 0.2) {
          const deg = chooseNextDegree([0, 4, 2, 6]);
          const { midi, fn } = degreeToNote(deg);
          const dur = rng.next() < 0.5 ? 1 : 2;
          notes.push({ midi, step, durationSteps: dur, function: fn, isAnticipation: false });
          prevDegree = deg;
        } else {
          notes.push({
            midi: rootMidi,
            step,
            durationSteps: 2,
            function: "ROOT",
            isAnticipation: false
          });
        }
      }
    }
    for (let step = 1;step < groove.stepsPerBar; step++) {
      if (kickSet.has(step))
        continue;
      const kickHas = false;
      const prob = bassOnsetProbability({
        step,
        kickHas,
        grammar: this.interactionGrammar,
        confidence: grammarConfidence,
        defaultOnKick: 0.3 + tension * 0.2,
        defaultOffKick: 0.1 + groove.syncopationBudget * 0.2
      });
      if (rng.next() < prob) {
        const deg = chooseNextDegree([0, 4, 2, 6]);
        const { midi, fn } = degreeToNote(deg);
        const isAnticipation = opts.isAnticipationBar && step >= groove.stepsPerBar - 2;
        const dur = rng.next() < 0.5 ? 1 : 2;
        notes.push({
          midi,
          step,
          durationSteps: dur,
          function: isAnticipation ? "ANTICIPATION" : fn,
          isAnticipation
        });
        prevDegree = deg;
      }
    }
    const beat = Math.max(1, Math.round(groove.stepsPerBar / 4));
    const offbeatVariation = (opts.bar * 7 + this.seed * 13) % 4;
    const offbeatTargets = offbeatVariation === 0 ? [beat * 2, beat * 3] : offbeatVariation === 1 ? [beat + 1, beat * 3 + 1] : offbeatVariation === 2 ? [beat * 2 + 1] : [beat * 3, beat * 3 + 2];
    for (const step of offbeatTargets) {
      if (notes.some((n) => n.step === step))
        continue;
      if (step >= groove.stepsPerBar)
        continue;
      if (rng.next() < 0.2 + groove.syncopationBudget * 0.3 + tension * 0.2) {
        const useApproach = rng.next() < 0.3;
        if (useApproach) {
          const approachMidi = rootMidi + (rng.next() < 0.5 ? -1 : 1);
          notes.push({
            midi: approachMidi,
            step,
            durationSteps: 1,
            function: "APPROACH",
            isAnticipation: false
          });
        } else {
          const useThird = rng.next() < 0.5;
          notes.push({
            midi: useThird ? thirdMidi : seventhMidi,
            step,
            durationSteps: 1,
            function: useThird ? "THIRD" : "PASSING",
            isAnticipation: false
          });
        }
      }
    }
    if (rng.next() < 0.15 + tension * 0.15) {
      const jumpStep = beat * 2;
      if (!notes.some((n) => n.step === jumpStep)) {
        notes.push({
          midi: octaveMidi,
          step: jumpStep,
          durationSteps: 1,
          function: "OCTAVE",
          isAnticipation: false
        });
      }
    }
    if (isLast) {
      const lastStep = groove.stepsPerBar - 2;
      const filtered = notes.filter((n) => n.step < lastStep);
      notes.length = 0;
      notes.push(...filtered);
      notes.push({
        midi: fifthMidi,
        step: lastStep,
        durationSteps: 1,
        function: "CADENCE",
        isAnticipation: false
      });
      notes.push({
        midi: rootMidi,
        step: lastStep + 1,
        durationSteps: 2,
        function: "CADENCE",
        isAnticipation: false
      });
    }
    for (const n of notes) {
      while (n.midi < 36)
        n.midi += 12;
      while (n.midi > 59)
        n.midi -= 12;
    }
    notes.sort((a, b) => a.step - b.step);
    const deduped = [];
    for (const n of notes) {
      if (!deduped.some((d) => d.step === n.step))
        deduped.push(n);
    }
    return { notes: deduped, onsets: deduped.map((n) => n.step) };
  }
  composeLeadPlan(opts) {
    const scale = getScale(this.context.scaleName);
    if (!scale)
      return emptyLeadPlan();
    const {
      groove,
      bassPlan,
      spaceMap,
      harmonicPlan,
      activeChord,
      nextChord,
      isLast,
      rng,
      grammarConfidence,
      phraseMaterial
    } = opts;
    const arcStage = arcStageAt(phraseMaterial.phraseArc, opts.bar);
    const tensionDims = deriveTensionDimensions(this.context.tension);
    const stageLabel = arcStage?.stage ?? "DEVELOP";
    const isFocalBar = stageLabel === "FOCAL";
    const isOpenBar = stageLabel === "OPEN";
    const isCadenceStage = stageLabel === "CADENCE";
    const arcStrength = this.identity ? 1 : 0.3;
    const baseDensity = 0.3 + this.context.energy * 0.4;
    const learnedDensity = densityForEnergy({
      energy: this.context.energy,
      grammar: this.interactionGrammar,
      confidence: grammarConfidence,
      defaultDensity: baseDensity
    });
    const targetDensity = applyDensityTension(learnedDensity, this.context.tension);
    const baseRegister = this.grammar.tessituraCenter + (this.context.tension - 0.5) * 6;
    const learnedRegister = registerForTension({
      tension: this.context.tension,
      grammar: this.interactionGrammar,
      confidence: grammarConfidence,
      defaultRegister: baseRegister
    });
    const targetRegister = applyRegisterTension(learnedRegister, this.context.tension);
    const maxInterval = tensionDims.melodic;
    let contourShape = phraseMaterial.contour;
    if (this.identity) {
      switch (this.identity.leadVocabulary) {
        case "DESCENDING_NARROW":
          contourShape = opts.bar < opts.bars / 2 ? "arch" : "descending";
          break;
        case "ASCENDING_WIDE":
          contourShape = opts.bar < opts.bars / 2 ? "ascending" : "arch";
          break;
        case "ARCH_BALANCED":
          contourShape = isFocalBar ? "arch" : "flat";
          break;
        case "WAVE_SYNCOPATED":
          contourShape = "wave";
          break;
      }
    }
    const chordPcs = activeChord?.chordTones ?? [];
    const cadenceTarget = harmonicPlan.cadenceTarget;
    const rootPc = activeChord?.rootPc ?? this.context.tonic;
    const pcs = scalePcs(this.context.tonic, scale);
    const extendedChordTones = applyHarmonicTension(chordPcs, this.context.tension, pcs);
    let rhythmicCell = phraseMaterial.rhythmicCell;
    if (rhythmicCell.length === 0) {
      const openSteps = spaceMap.cells.filter((c) => c.open).sort((a, b) => b.preferredLead - a.preferredLead).slice(0, 4).map((c) => c.step).sort((a, b) => a - b);
      rhythmicCell = openSteps.length > 0 ? openSteps : [2, 6, 10, 14];
    }
    const bassOnsets = bassPlan.onsets;
    const leadDesire = new Array(groove.stepsPerBar).fill(0);
    for (let step = 0;step < groove.stepsPerBar; step++) {
      const cell = cellAt(spaceMap, step);
      let desire = cell.preferredLead;
      desire += leadResponseBoost({
        step,
        bassOnsets,
        grammar: this.interactionGrammar,
        confidence: grammarConfidence
      });
      if (isFocalBar && cell.open)
        desire += 0.3 * arcStrength;
      if (isOpenBar)
        desire *= 1 - 0.4 * arcStrength;
      if (opts.isAnticipation && step >= groove.stepsPerBar - 2)
        desire += 0.4;
      if (isLast && step >= groove.stepsPerBar - 2)
        desire += 0.5;
      leadDesire[step] = desire;
    }
    const targetCount = Math.max(1, Math.round(targetDensity * groove.stepsPerBar));
    const stepOrder = leadDesire.map((desire, step) => ({ step, desire })).sort((a, b) => b.desire - a.desire).slice(0, targetCount).map((x) => x.step).sort((a, b) => a - b);
    let pitchPool = phraseMaterial.pitchContour.slice();
    if (pitchPool.length === 0) {
      pitchPool = pcs.map((pc) => degreeToMidi(this.context.tonic, scale, pcs.indexOf(pc), 4));
    }
    if (pitchPool.length > 0) {
      const poolMean = pitchPool.reduce((s, m) => s + m, 0) / pitchPool.length;
      const offset = Math.round(targetRegister - poolMean);
      pitchPool = pitchPool.map((m) => {
        const shifted = m + offset;
        for (let off = 0;off <= 2; off++) {
          if (isInScale(this.context.tonic, scale, shifted + off))
            return shifted + off;
          if (isInScale(this.context.tonic, scale, shifted - off))
            return shifted - off;
        }
        return shifted;
      });
    }
    pitchPool = pitchPool.map((m) => {
      let midi = m;
      while (midi < LEAD_MIN_MIDI)
        midi += 12;
      while (midi > LEAD_MAX_MIDI)
        midi -= 12;
      return midi;
    });
    const notes = [];
    let prevMidi = null;
    const chordToneMidis = extendedChordTones.map((pc) => {
      let midi = pc + 60;
      while (midi < targetRegister - 6)
        midi += 12;
      while (midi > targetRegister + 6)
        midi -= 12;
      while (midi < LEAD_MIN_MIDI)
        midi += 12;
      while (midi > LEAD_MAX_MIDI)
        midi -= 12;
      return midi;
    });
    const primaryPool = this.identity ? chordToneMidis.length > 0 ? chordToneMidis : pitchPool : pitchPool;
    for (let i = 0;i < stepOrder.length; i++) {
      const step = stepOrder[i];
      const isCadenceStep = (isLast || isCadenceStage) && step >= groove.stepsPerBar - 2;
      const isResponseStep = leadResponseBoost({
        step,
        bassOnsets,
        grammar: this.interactionGrammar,
        confidence: grammarConfidence
      }) > 0.3;
      const isAnticipationStep = opts.isAnticipation && step >= groove.stepsPerBar - 2;
      const progress = i / Math.max(1, stepOrder.length - 1);
      let midi;
      let role;
      if (isCadenceStep) {
        midi = cadenceMidi(harmonicPlan, cadenceTarget, targetRegister);
        if (step !== (stepOrder[stepOrder.length - 1] ?? groove.stepsPerBar - 1)) {
          midi = cadenceMidi(harmonicPlan, cadenceTarget, targetRegister) - 2;
        }
        role = "CADENCE";
      } else if (isAnticipationStep && nextChord) {
        const nextPcs = nextChord.chordTones;
        midi = (nextPcs[Math.floor(rng.next() * nextPcs.length)] ?? nextChord.rootPc) + 60;
        while (midi < LEAD_MIN_MIDI)
          midi += 12;
        while (midi > LEAD_MAX_MIDI)
          midi -= 12;
        role = "ANTICIPATION";
      } else {
        const candidates = primaryPool.map((candMidi) => {
          const interval = prevMidi !== null ? candMidi - prevMidi : 0;
          const pc = (candMidi % 12 + 12) % 12;
          const isChordTone = chordPcs.includes(pc);
          const harmonyScore = isChordTone ? 0.7 : 0.05;
          const intervalScore = leadIntervalScore({
            interval,
            rootPc,
            grammar: this.interactionGrammar,
            confidence: grammarConfidence
          });
          let contourScore = 0;
          if (prevMidi !== null) {
            const dir = Math.sign(candMidi - prevMidi);
            switch (contourShape) {
              case "ascending":
                contourScore = dir > 0 ? 0.3 : dir < 0 ? -0.2 : 0;
                break;
              case "descending":
                contourScore = dir < 0 ? 0.3 : dir > 0 ? -0.2 : 0;
                break;
              case "arch":
                contourScore = progress < 0.5 ? dir > 0 ? 0.2 : -0.1 : dir < 0 ? 0.2 : -0.1;
                break;
              case "valley":
                contourScore = progress < 0.5 ? dir < 0 ? 0.2 : -0.1 : dir > 0 ? 0.2 : -0.1;
                break;
              case "wave":
                contourScore = i % 2 === 0 ? dir > 0 ? 0.2 : -0.1 : dir < 0 ? 0.2 : -0.1;
                break;
              case "flat":
                contourScore = dir === 0 ? 0.2 : 0;
                break;
            }
          }
          const melodicPenalty = Math.abs(interval) > maxInterval ? -0.5 : 0;
          const leapPenalty = prevMidi !== null && Math.abs(interval) > this.grammar.maxLeap ? -0.5 : 0;
          return {
            midi: candMidi,
            score: harmonyScore + intervalScore * 0.3 + contourScore + melodicPenalty + leapPenalty
          };
        });
        candidates.sort((a, b) => b.score - a.score);
        const pick = rng.next() < 0.7 ? candidates[0] ?? { midi: targetRegister } : candidates[Math.floor(rng.next() * Math.min(3, candidates.length))] ?? {
          midi: targetRegister
        };
        midi = pick.midi;
        role = isResponseStep ? "RESPONSE" : opts.isResponse ? "RESPONSE" : "CONTINUATION";
      }
      if (prevMidi !== null) {
        const interval = midi - prevMidi;
        if (Math.abs(interval) > this.grammar.maxLeap) {
          midi = prevMidi + Math.sign(interval) * this.grammar.maxLeap;
        }
      }
      while (midi < LEAD_MIN_MIDI)
        midi += 12;
      while (midi > LEAD_MAX_MIDI)
        midi -= 12;
      const velocity = role === "CADENCE" ? 0.95 : role === "ANTICIPATION" ? 0.8 : role === "RESPONSE" ? 0.6 : isFocalBar ? 0.85 : 0.7;
      notes.push({
        midi,
        step,
        durationSteps: isCadenceStep ? 2 : 1,
        velocity,
        role
      });
      prevMidi = midi;
    }
    return { notes };
  }
  composeBassLegacy(_bar, groove, rng, isLast) {
    const scale = getScale(this.context.scaleName);
    if (!scale)
      return emptyBassPlan();
    const rootMidi = degreeToMidi(this.context.tonic, scale, 0, BASS_OCTAVE);
    const fifthMidi = degreeToMidi(this.context.tonic, scale, 4, BASS_OCTAVE);
    const octaveMidi = degreeToMidi(this.context.tonic, scale, 0, BASS_OCTAVE + 1);
    const thirdMidi = degreeToMidi(this.context.tonic, scale, 2, BASS_OCTAVE);
    const seventhMidi = degreeToMidi(this.context.tonic, scale, 6, BASS_OCTAVE);
    const beat = Math.max(1, Math.round(groove.stepsPerBar / 4));
    const tension = this.grammar.tensionPreference;
    const bassDegPrefs = this.learned.bass.degreePreferences;
    const hasLearnedBass = Object.keys(bassDegPrefs).length > 0 && this.learned.meta.confidence > 0.3;
    const chooseBassPitch = (rng2) => {
      if (hasLearnedBass) {
        const degrees = Object.entries(bassDegPrefs);
        const totalWeight = degrees.reduce((s, [, w]) => s + w, 0);
        let r = rng2.next() * totalWeight;
        for (const [degStr, weight] of degrees) {
          r -= weight;
          if (r <= 0) {
            const deg = Number.parseInt(degStr, 10);
            const midi = degreeToMidi(this.context.tonic, scale, deg, BASS_OCTAVE);
            const fns = ["ROOT", "THIRD", "FIFTH", "SEVENTH", "OCTAVE"];
            return { midi, fn: fns[deg] ?? "PASSING" };
          }
        }
      }
      const useFifth = rng2.next() < 0.5;
      return useFifth ? { midi: fifthMidi, fn: "FIFTH" } : { midi: octaveMidi, fn: "OCTAVE" };
    };
    const notes = [];
    notes.push({
      midi: rootMidi,
      step: 0,
      durationSteps: 2,
      function: "ROOT",
      isAnticipation: false
    });
    if (groove.bassKickAlignment === "LOCKED") {
      for (const step of groove.kickSteps) {
        if (step === 0)
          continue;
        if (rng.next() < 0.3 + tension * 0.2) {
          const pitch = chooseBassPitch(rng);
          const dur = rng.next() < 0.5 ? 1 : 2;
          notes.push({
            midi: pitch.midi,
            step,
            durationSteps: dur,
            function: pitch.fn,
            isAnticipation: false
          });
        } else {
          notes.push({
            midi: rootMidi,
            step,
            durationSteps: 2,
            function: "ROOT",
            isAnticipation: false
          });
        }
      }
    } else {
      const half = Math.max(1, Math.round(groove.stepsPerBar / 8));
      const complementary = [half, beat + half, beat * 2 + half, beat * 3 + half];
      for (const step of complementary) {
        if (groove.kickSteps.includes(step) || step === 0)
          continue;
        const pitch = chooseBassPitch(rng);
        notes.push({
          midi: pitch.midi,
          step,
          durationSteps: 1,
          function: pitch.fn,
          isAnticipation: false
        });
      }
    }
    if (rng.next() < 0.15 + tension * 0.15) {
      const jumpStep = beat * 2;
      if (!notes.some((n) => n.step === jumpStep)) {
        notes.push({
          midi: octaveMidi,
          step: jumpStep,
          durationSteps: 1,
          function: "OCTAVE",
          isAnticipation: false
        });
      }
    }
    if (isLast) {
      const lastStep = groove.stepsPerBar - 2;
      const filtered = notes.filter((n) => n.step < lastStep);
      notes.length = 0;
      notes.push(...filtered);
      notes.push({
        midi: fifthMidi,
        step: lastStep,
        durationSteps: 1,
        function: "CADENCE",
        isAnticipation: false
      });
      notes.push({
        midi: rootMidi,
        step: lastStep + 1,
        durationSteps: 2,
        function: "CADENCE",
        isAnticipation: false
      });
    }
    for (const n of notes) {
      while (n.midi < 36)
        n.midi += 12;
      while (n.midi > 59)
        n.midi -= 12;
    }
    notes.sort((a, b) => a.step - b.step);
    const deduped = [];
    for (const n of notes) {
      if (!deduped.some((d) => d.step === n.step))
        deduped.push(n);
    }
    return { notes: deduped, onsets: deduped.map((n) => n.step) };
  }
  composeLeadLegacy(bar, bars, phraseMotif, harmonicContext, rng, isResponse) {
    const scale = getScale(this.context.scaleName);
    if (!scale || phraseMotif.notes.length === 0)
      return [];
    let motif = phraseMotif;
    if (isResponse) {
      motif = callResponse(phraseMotif, this.context.tonic, scale, this.seed + bar * 17 >>> 0);
    } else if (bar > 0) {
      const variationChoice = (bar * 3 + this.seed) % 5;
      if (variationChoice === 0) {
        const t = rng.pick([-3, -2, 2, 3]);
        motif = transpose(phraseMotif, t, this.context.tonic, scale);
      } else if (variationChoice === 1) {
        if (rng.next() < 0.3) {
          motif = invert(phraseMotif, this.context.tonic, scale);
        } else {
          const t = rng.pick([-2, 0, 2]);
          if (t !== 0)
            motif = transpose(phraseMotif, t, this.context.tonic, scale);
        }
      } else if (variationChoice === 2) {
        if (rng.next() < 0.2) {
          motif = retrograde(phraseMotif);
        }
      } else if (variationChoice === 3) {
        if (rng.next() < 0.25) {
          const halfNotes = phraseMotif.notes.slice(0, Math.ceil(phraseMotif.notes.length / 2));
          if (halfNotes.length > 0) {
            motif = { ...phraseMotif, notes: halfNotes };
          }
        }
      }
    }
    const notes = motif.notes.map((n) => {
      let midi = n.midi;
      while (midi < LEAD_MIN_MIDI)
        midi += 12;
      while (midi > LEAD_MAX_MIDI)
        midi -= 12;
      return { midi, step: n.step, durationSteps: n.durationSteps, velocity: n.velocity };
    });
    const maxLeap = this.grammar.maxLeap;
    for (let i = 1;i < notes.length; i++) {
      const prev = notes[i - 1];
      const cur = notes[i];
      if (!prev || !cur)
        continue;
      const interval = cur.midi - prev.midi;
      if (Math.abs(interval) > maxLeap) {
        cur.midi = prev.midi + Math.sign(interval) * maxLeap;
      }
    }
    const chordPcs = new Set(harmonicContext);
    if (chordPcs.size > 0) {
      for (const n of notes) {
        const pc = (n.midi % 12 + 12) % 12;
        if (!chordPcs.has(pc) && rng.next() < 0.5) {
          for (let off = 1;off <= 2; off++) {
            const upPc = ((n.midi + off) % 12 + 12) % 12;
            if (chordPcs.has(upPc)) {
              n.midi += off;
              break;
            }
            const downPc = ((n.midi - off) % 12 + 12) % 12;
            if (chordPcs.has(downPc)) {
              n.midi -= off;
              break;
            }
          }
        }
      }
    }
    return notes;
  }
}
// packages/music/src/radio-context.ts
function clamp014(v) {
  if (Number.isNaN(v))
    return 0;
  return Math.max(0, Math.min(1, v));
}
function clampOccupancy(v) {
  return clamp014(v);
}
function createRadioContext(partial = {}) {
  const defaults = {
    bpm: 145,
    bpmConfidence: 0.5,
    key: 4,
    scale: "phrygian-dominant",
    keyConfidence: 0.5,
    energy: 0.5,
    density: 0.5,
    energyConfidence: 0.5,
    kickOccupancy: 0,
    bassOccupancy: 0,
    percussionOccupancy: 0,
    leadOccupancy: 0,
    harmonicOccupancy: 0,
    pitchVocabulary: [],
    rhythmicVocabulary: [],
    grooveSignature: "",
    syncopation: 0.3,
    style: "full-on",
    styleConfidence: 0.5,
    phrasePosition: 0,
    sectionLikelihood: "GROOVE",
    confidence: 0.5,
    timestamp: 0,
    available: true
  };
  const merged = { ...defaults, ...partial };
  merged.bpmConfidence = clamp014(merged.bpmConfidence);
  merged.keyConfidence = clamp014(merged.keyConfidence);
  merged.energyConfidence = clamp014(merged.energyConfidence);
  merged.energy = clamp014(merged.energy);
  merged.density = clamp014(merged.density);
  merged.kickOccupancy = clampOccupancy(merged.kickOccupancy);
  merged.bassOccupancy = clampOccupancy(merged.bassOccupancy);
  merged.percussionOccupancy = clampOccupancy(merged.percussionOccupancy);
  merged.leadOccupancy = clampOccupancy(merged.leadOccupancy);
  merged.harmonicOccupancy = clampOccupancy(merged.harmonicOccupancy);
  merged.syncopation = clamp014(merged.syncopation);
  merged.styleConfidence = clamp014(merged.styleConfidence);
  merged.phrasePosition = clamp014(merged.phrasePosition);
  merged.confidence = clamp014(merged.confidence);
  return merged;
}
var RADIO_ABSENT = createRadioContext({
  bpm: 0,
  bpmConfidence: 0,
  key: 0,
  scale: "",
  keyConfidence: 0,
  energy: 0,
  density: 0,
  energyConfidence: 0,
  kickOccupancy: 0,
  bassOccupancy: 0,
  percussionOccupancy: 0,
  leadOccupancy: 0,
  harmonicOccupancy: 0,
  pitchVocabulary: [],
  rhythmicVocabulary: [],
  grooveSignature: "",
  syncopation: 0,
  style: "",
  styleConfidence: 0,
  phrasePosition: 0,
  sectionLikelihood: "UNKNOWN",
  confidence: 0,
  timestamp: 0,
  available: false
});
function isRadioAbsent(radio) {
  return !radio.available || radio.confidence === 0;
}
// packages/music/src/opportunity-map.ts
var OCCUPIED_THRESHOLD = 0.6;
var OPEN_THRESHOLD = 0.3;
var TEXTURE_MEDIUM_ENERGY = 0.5;
function classify(occupancy) {
  if (occupancy > OCCUPIED_THRESHOLD)
    return "OCCUPIED";
  if (occupancy < OPEN_THRESHOLD)
    return "OPEN";
  return "MEDIUM";
}
function buildOpportunityMap(radio) {
  if (isRadioAbsent(radio)) {
    return {
      kick: "OPEN",
      bass: "OPEN",
      percussion: "OPEN",
      lead: "OPEN",
      harmony: "OPEN",
      counter: "OPEN",
      texture: "OPEN",
      transition: "OPEN"
    };
  }
  const texture = radio.energy > TEXTURE_MEDIUM_ENERGY ? "MEDIUM" : "OPEN";
  return {
    kick: classify(radio.kickOccupancy),
    bass: classify(radio.bassOccupancy),
    percussion: classify(radio.percussionOccupancy),
    lead: classify(radio.leadOccupancy),
    harmony: classify(radio.harmonicOccupancy),
    counter: "OPEN",
    texture,
    transition: "OPEN"
  };
}
function isDense(map) {
  const primary = ["kick", "bass", "percussion", "lead", "harmony"];
  return primary.every((k) => map[k] === "OCCUPIED");
}
// packages/music/src/composition-adaptation.ts
function clamp015(v) {
  if (Number.isNaN(v))
    return 0;
  return Math.max(0, Math.min(1, v));
}
function clamp(v, min, max) {
  if (Number.isNaN(v))
    return min;
  return Math.max(min, Math.min(max, v));
}
function lerp(a, b, t) {
  return a + (b - a) * clamp015(t);
}
function blendFromConfidence(confidence) {
  if (confidence < 0.3)
    return 0;
  if (confidence > 0.7)
    return 1;
  return 0.5;
}
function neutralIntent(baseContext, reasons) {
  return {
    groovePressure: 0.7,
    bassPressure: 0.7,
    leadPressure: 0.7,
    counterPressure: 0.5,
    texturePressure: 0.4,
    densityTarget: baseContext.density,
    tensionTarget: baseContext.tension,
    noveltyTarget: baseContext.noveltyPressure,
    registerShift: 0,
    restPressure: 0.1,
    motifPreference: "NEUTRAL",
    harmonyPreference: "NEUTRAL",
    confidence: 0,
    reasons
  };
}
function isRadioBreakdown(radio) {
  if (radio.sectionLikelihood === "BREAK")
    return true;
  return radio.energy < 0.4 && radio.density < 0.4 && radio.kickOccupancy < 0.3 && radio.bassOccupancy < 0.3 && radio.percussionOccupancy < 0.4 && radio.harmonicOccupancy > 0.3;
}
function isRadioSparse(radio, opportunities) {
  if (isRadioBreakdown(radio))
    return false;
  return opportunities.kick === "OPEN" && opportunities.bass === "OPEN" && opportunities.lead === "OPEN" && radio.energy < 0.45;
}

class CompositionAdaptation {
  roleBias = new Map;
  roleOutcomes = new Map;
  adapt(opts) {
    const { baseContext, radio, opportunities, currentBar, phraseBar } = opts;
    if (isRadioAbsent(radio)) {
      return neutralIntent(baseContext, ["radio absent — preserving base composition"]);
    }
    if (phraseBar < 4) {
      return neutralIntent(baseContext, [
        `phraseBar=${phraseBar} < 4 — deferring adaptation to next phrase boundary`
      ]);
    }
    if (radio.confidence < 0.3) {
      return neutralIntent(baseContext, [
        `radio.confidence=${radio.confidence.toFixed(2)} < 0.3 — insufficient evidence to adapt`
      ]);
    }
    const blend2 = blendFromConfidence(radio.confidence);
    const reasons = [];
    let groovePressure = 0.7;
    let bassPressure = 0.7;
    let leadPressure = 0.7;
    let counterPressure = 0.5;
    let texturePressure = 0.4;
    let restPressure = 0.1;
    if (isRadioBreakdown(radio)) {
      groovePressure = lerp(0.7, 0.3, blend2);
      bassPressure = lerp(0.7, 0.3, blend2);
      leadPressure = lerp(0.7, 0.8, blend2);
      texturePressure = lerp(0.4, 0.8, blend2);
      reasons.push("radio in breakdown — reducing kick/bass, exposing motif, increasing texture");
    } else if (isRadioSparse(radio, opportunities)) {
      groovePressure = lerp(0.7, 0.9, blend2);
      bassPressure = lerp(0.7, 0.85, blend2);
      leadPressure = lerp(0.7, 0.75, blend2);
      reasons.push("radio sparse — foundation adds groove + identity");
    } else {
      if (opportunities.bass === "OCCUPIED") {
        bassPressure = lerp(0.7, 0.2, blend2);
        reasons.push("radio bass OCCUPIED — reducing bass pressure");
      } else if (opportunities.bass === "MEDIUM") {
        bassPressure = lerp(0.7, 0.5, blend2);
        reasons.push("radio bass MEDIUM — moderating bass pressure");
      } else {
        bassPressure = lerp(0.7, 0.85, blend2);
        reasons.push("radio bass OPEN — foundation adds bass");
      }
      if (opportunities.lead === "OCCUPIED") {
        leadPressure = lerp(0.7, 0.25, blend2);
        counterPressure = lerp(0.5, 0.85, blend2);
        reasons.push("radio lead OCCUPIED — reducing lead, raising counter (response/space)");
      } else if (opportunities.lead === "MEDIUM") {
        leadPressure = lerp(0.7, 0.55, blend2);
        counterPressure = lerp(0.5, 0.65, blend2);
        reasons.push("radio lead MEDIUM — moderating lead, light counter");
      } else {
        leadPressure = lerp(0.7, 0.8, blend2);
        reasons.push("radio lead OPEN — foundation carries lead");
      }
      if (opportunities.kick === "OCCUPIED") {
        groovePressure = lerp(0.7, 0.8, blend2);
        reasons.push("radio kick OCCUPIED — locking groove to radio kick");
      } else if (opportunities.kick === "OPEN") {
        groovePressure = lerp(0.7, 0.9, blend2);
        reasons.push("radio kick OPEN — foundation adds groove");
      } else {
        groovePressure = lerp(0.7, 0.75, blend2);
        reasons.push("radio kick MEDIUM — maintaining groove");
      }
      if (opportunities.texture === "OPEN" && radio.energy < 0.5) {
        texturePressure = lerp(0.4, 0.75, blend2);
        reasons.push("texture OPEN + low radio energy — increasing texture");
      } else if (opportunities.texture === "MEDIUM") {
        texturePressure = lerp(0.4, 0.35, blend2);
        reasons.push("texture MEDIUM — moderating texture");
      }
    }
    if (!isRadioBreakdown(radio) && isDense(opportunities)) {
      restPressure = lerp(0.1, 0.65, blend2);
      bassPressure = Math.min(bassPressure, lerp(0.7, 0.25, blend2));
      leadPressure = Math.min(leadPressure, lerp(0.7, 0.3, blend2));
      reasons.push("all primary roles OCCUPIED — increasing rest pressure (intelligent abstention)");
    }
    const densityTarget = clamp015(baseContext.density * (1 - radio.density * 0.5 * blend2));
    const tensionTarget = clamp015(baseContext.tension + radio.energy * 0.2 * blend2);
    reasons.push(`densityTarget=${densityTarget.toFixed(2)} (base ${baseContext.density.toFixed(2)} × (1 − radio.density ${radio.density.toFixed(2)} × 0.5 × blend ${blend2}))`);
    reasons.push(`tensionTarget=${tensionTarget.toFixed(2)} (base ${baseContext.tension.toFixed(2)} + radio.energy ${radio.energy.toFixed(2)} × 0.2 × blend ${blend2})`);
    let motifPreference;
    if (radio.confidence > 0.7 && radio.syncopation < 0.3) {
      motifPreference = "REUSE";
      reasons.push("radio stable (high confidence, low syncopation) — REUSE motif");
    } else if (radio.confidence < 0.5 || radio.syncopation > 0.5) {
      motifPreference = "VARY";
      reasons.push("radio changing (low confidence or high syncopation) — VARY motif");
    } else {
      motifPreference = "NEUTRAL";
      reasons.push("radio middling — NEUTRAL motif preference");
    }
    if (radio.confidence > 0.7 && baseContext.noveltyPressure > 0.6) {
      motifPreference = "NEW";
      reasons.push("high confidence + high novelty — allow NEW material");
    }
    const noveltyTarget = motifPreference === "NEW" ? 0.75 : motifPreference === "VARY" ? 0.55 : motifPreference === "REUSE" ? 0.3 : baseContext.noveltyPressure;
    let harmonyPreference;
    if (radio.confidence > 0.7) {
      harmonyPreference = radio.energy > 0.6 ? "TENSION" : "STABLE";
      reasons.push(`radio high confidence — harmony ${harmonyPreference}`);
    } else {
      harmonyPreference = "NEUTRAL";
    }
    let registerShift = 0;
    if (opportunities.bass === "OCCUPIED" && opportunities.lead === "OCCUPIED" && !isRadioBreakdown(radio)) {
      registerShift = Math.round(lerp(0, 1, blend2));
      if (registerShift !== 0)
        reasons.push("bass+lead OCCUPIED — shifting register up to make room");
    } else if (opportunities.bass === "OCCUPIED" && !isRadioBreakdown(radio)) {
      registerShift = Math.round(lerp(0, 1, blend2));
      if (registerShift !== 0)
        reasons.push("bass OCCUPIED — shifting register up");
    }
    const bassBias = this.biasFor("bass");
    const leadBias = this.biasFor("lead");
    const grooveBias = this.biasFor("groove");
    const counterBias = this.biasFor("counter");
    const textureBias = this.biasFor("texture");
    if (bassBias !== 0) {
      bassPressure = clamp015(bassPressure + bassBias * 0.4);
      reasons.push(`learned bass bias ${bassBias.toFixed(2)} applied`);
    }
    if (leadBias !== 0) {
      leadPressure = clamp015(leadPressure + leadBias * 0.4);
      reasons.push(`learned lead bias ${leadBias.toFixed(2)} applied`);
    }
    if (grooveBias !== 0) {
      groovePressure = clamp015(groovePressure + grooveBias * 0.3);
      reasons.push(`learned groove bias ${grooveBias.toFixed(2)} applied`);
    }
    if (counterBias !== 0) {
      counterPressure = clamp015(counterPressure + counterBias * 0.4);
      reasons.push(`learned counter bias ${counterBias.toFixed(2)} applied`);
    }
    if (textureBias !== 0) {
      texturePressure = clamp015(texturePressure + textureBias * 0.4);
      reasons.push(`learned texture bias ${textureBias.toFixed(2)} applied`);
    }
    return {
      groovePressure,
      bassPressure,
      leadPressure,
      counterPressure,
      texturePressure,
      densityTarget,
      tensionTarget,
      noveltyTarget,
      registerShift,
      restPressure,
      motifPreference,
      harmonyPreference,
      confidence: radio.confidence,
      reasons
    };
  }
  adaptSection(opts) {
    const { baseContext, radioSequence, bars } = opts;
    const out = [];
    for (let bar = 0;bar < bars; bar++) {
      const radio = radioSequence[bar % Math.max(1, radioSequence.length)] ?? radioSequence[0];
      if (!radio) {
        out.push(neutralIntent(baseContext, ["no radio in sequence — NEUTRAL"]));
        continue;
      }
      const opportunities = buildOpportunityMap(radio);
      const phraseBar = bar % 8;
      out.push(this.adapt({
        baseContext,
        radio,
        opportunities,
        currentBar: bar,
        phraseBar
      }));
    }
    return out;
  }
  reinforce(role, success) {
    const cur = this.roleBias.get(role) ?? 0;
    const delta = success ? 0.1 : -0.2;
    this.roleBias.set(role, clamp(cur + delta, -1, 1));
    const outcomes = this.roleOutcomes.get(role) ?? { success: 0, fail: 0 };
    if (success)
      outcomes.success += 1;
    else
      outcomes.fail += 1;
    this.roleOutcomes.set(role, outcomes);
  }
  biasFor(role) {
    return this.roleBias.get(role) ?? 0;
  }
  outcomesFor(role) {
    return this.roleOutcomes.get(role) ?? { success: 0, fail: 0 };
  }
  reset() {
    this.roleBias.clear();
    this.roleOutcomes.clear();
  }
}
// packages/music/src/radio-scenarios.ts
var RADIO_SCENARIOS = {
  SPARSE: {
    name: "SPARSE",
    description: "Low energy, low density, low occupancy everywhere. Foundation adds groove + identity.",
    context: createRadioContext({
      bpm: 138,
      bpmConfidence: 0.55,
      key: 4,
      scale: "phrygian-dominant",
      keyConfidence: 0.6,
      energy: 0.25,
      density: 0.2,
      energyConfidence: 0.65,
      kickOccupancy: 0.1,
      bassOccupancy: 0.15,
      percussionOccupancy: 0.1,
      leadOccupancy: 0.1,
      harmonicOccupancy: 0.2,
      pitchVocabulary: [4, 7, 0],
      rhythmicVocabulary: [0],
      grooveSignature: "sparse-kick-only",
      syncopation: 0.15,
      style: "full-on",
      styleConfidence: 0.5,
      phrasePosition: 0.5,
      sectionLikelihood: "INTRO",
      confidence: 0.6,
      timestamp: 0,
      available: true
    })
  },
  BASS_HEAVY: {
    name: "BASS_HEAVY",
    description: "High bass occupancy, strong low-end, moderate lead. Foundation reduces bass, shifts to upper roles.",
    context: createRadioContext({
      bpm: 145,
      bpmConfidence: 0.85,
      key: 4,
      scale: "phrygian-dominant",
      keyConfidence: 0.8,
      energy: 0.7,
      density: 0.6,
      energyConfidence: 0.8,
      kickOccupancy: 0.5,
      bassOccupancy: 0.85,
      percussionOccupancy: 0.4,
      leadOccupancy: 0.45,
      harmonicOccupancy: 0.3,
      pitchVocabulary: [4, 0, 7, 3],
      rhythmicVocabulary: [0, 4, 8, 12],
      grooveSignature: "four-on-floor-bass",
      syncopation: 0.3,
      style: "full-on",
      styleConfidence: 0.75,
      phrasePosition: 0.5,
      sectionLikelihood: "GROOVE",
      confidence: 0.8,
      timestamp: 32,
      available: true
    })
  },
  MELODY_HEAVY: {
    name: "MELODY_HEAVY",
    description: "High lead occupancy, moderate bass, moderate energy. Foundation uses counter / response / space.",
    context: createRadioContext({
      bpm: 142,
      bpmConfidence: 0.8,
      key: 7,
      scale: "minor",
      keyConfidence: 0.75,
      energy: 0.6,
      density: 0.55,
      energyConfidence: 0.75,
      kickOccupancy: 0.5,
      bassOccupancy: 0.5,
      percussionOccupancy: 0.4,
      leadOccupancy: 0.85,
      harmonicOccupancy: 0.4,
      pitchVocabulary: [7, 9, 12, 5],
      rhythmicVocabulary: [0, 2, 4, 6, 8],
      grooveSignature: "melodic-fwd",
      syncopation: 0.4,
      style: "progressive",
      styleConfidence: 0.7,
      phrasePosition: 0.6,
      sectionLikelihood: "DEVELOPMENT",
      confidence: 0.78,
      timestamp: 64,
      available: true
    })
  },
  FULL_DENSE: {
    name: "FULL_DENSE",
    description: "High everything, high energy. Foundation reduces layers, may abstain.",
    context: createRadioContext({
      bpm: 148,
      bpmConfidence: 0.9,
      key: 4,
      scale: "phrygian-dominant",
      keyConfidence: 0.88,
      energy: 0.92,
      density: 0.85,
      energyConfidence: 0.88,
      kickOccupancy: 0.85,
      bassOccupancy: 0.8,
      percussionOccupancy: 0.75,
      leadOccupancy: 0.8,
      harmonicOccupancy: 0.7,
      pitchVocabulary: [4, 0, 7, 3, 8],
      rhythmicVocabulary: [0, 2, 4, 6, 8, 10, 12, 14],
      grooveSignature: "full-on-dense",
      syncopation: 0.45,
      style: "full-on",
      styleConfidence: 0.85,
      phrasePosition: 0.7,
      sectionLikelihood: "PEAK",
      confidence: 0.85,
      timestamp: 96,
      available: true
    })
  },
  BREAKDOWN: {
    name: "BREAKDOWN",
    description: "Low kick, low bass, low percussion, medium harmony, low energy. Foundation reduces kick/bass, exposes motif, increases texture.",
    context: createRadioContext({
      bpm: 140,
      bpmConfidence: 0.75,
      key: 4,
      scale: "phrygian",
      keyConfidence: 0.7,
      energy: 0.3,
      density: 0.3,
      energyConfidence: 0.75,
      kickOccupancy: 0.1,
      bassOccupancy: 0.15,
      percussionOccupancy: 0.15,
      leadOccupancy: 0.4,
      harmonicOccupancy: 0.55,
      pitchVocabulary: [4, 7, 0, 3],
      rhythmicVocabulary: [0, 8],
      grooveSignature: "breakdown-pad",
      syncopation: 0.1,
      style: "dark",
      styleConfidence: 0.65,
      phrasePosition: 0.3,
      sectionLikelihood: "BREAK",
      confidence: 0.72,
      timestamp: 128,
      available: true
    })
  },
  ABSENT: {
    name: "ABSENT",
    description: "Radio analyser unavailable. Composition continues in internal mode (NEUTRAL intent).",
    context: RADIO_ABSENT
  }
};
// packages/music/src/learned-identity.ts
function createIdentityA() {
  const learned = createEmptyLearnedContext();
  learned.bass.degreePreferences = { 0: 0.6, 4: 0.3, 2: 0.1 };
  learned.bass.register = 2;
  learned.bass.kickRelationship = "LOCKED";
  learned.bass.octaveBehavior = 0.1;
  learned.bass.approachToneProfile = 0.1;
  learned.bass.phraseEndingProfile = 0.3;
  learned.melody.contourProfile = [0.2, 0.6, 0.2];
  learned.melody.intervalProfile = { 1: 0.3, 2: 0.3, 3: 0.2, 5: 0.1, 7: 0.1 };
  learned.melody.registerProfile = 64;
  learned.melody.phraseLength = 8;
  learned.melody.restProfile = 0.4;
  learned.melody.cadenceProfile = 0.8;
  learned.melody.scaleDegreePreferences = {
    0: 0.3,
    1: 0.15,
    2: 0.2,
    3: 0.1,
    4: 0.15,
    5: 0.05,
    6: 0.05
  };
  learned.melody.motifBehavior = "REUSE";
  learned.melody.callResponseProfile = 0.2;
  learned.rhythm.subdivision = 4;
  learned.rhythm.swing = 0;
  learned.rhythm.syncopation = 0.15;
  learned.rhythm.kickGrammar = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
  learned.rhythm.hatGrammar = [0, 0, 0.3, 0, 0, 0, 0.3, 0, 0, 0, 0.3, 0, 0, 0, 0.3, 0];
  learned.rhythm.bassRhythmGrammar = [1, 0, 0, 0, 0.6, 0, 0, 0, 1, 0, 0, 0, 0.6, 0, 0, 0];
  learned.rhythm.ghostProbability = 0.05;
  learned.rhythm.accentProfile = [1, 0, 0, 0, 0.5, 0, 0, 0, 0.7, 0, 0, 0, 0.5, 0, 0, 0];
  learned.harmony.key = 4;
  learned.harmony.mode = "phrygian-dominant";
  learned.harmony.tonalCenterConfidence = 0.9;
  learned.harmony.pitchClassProfile = [
    0.3,
    0.05,
    0.1,
    0.05,
    0.25,
    0.05,
    0.1,
    0.05,
    0.2,
    0.05,
    0.1,
    0.05
  ];
  learned.harmony.harmonicRhythm = 0.125;
  learned.harmony.rootMovement = [0, 0, 7, 0];
  learned.harmony.intervalPreferences = { 3: 0.3, 5: 0.3, 7: 0.2, 2: 0.2 };
  learned.arrangement.buildBehavior = 0.2;
  learned.arrangement.dropBehavior = 0.2;
  learned.arrangement.breakdownBehavior = 0.1;
  learned.arrangement.energyCurve = [0.3, 0.4, 0.5, 0.45, 0.4, 0.35];
  learned.arrangement.densityCurve = [0.3, 0.4, 0.5, 0.45, 0.4, 0.35];
  learned.timbre.brightness = 0.3;
  learned.timbre.spectralCentroid = 1200;
  learned.timbre.harmonicity = 0.7;
  learned.timbre.noisiness = 0.1;
  learned.timbre.transientCharacter = 0.3;
  learned.timbre.attack = 0.005;
  learned.timbre.decay = 0.4;
  learned.timbre.sustain = 0.6;
  learned.timbre.roughness = 0.2;
  learned.timbre.subEnergy = 0.8;
  learned.timbre.midEnergy = 0.4;
  learned.timbre.highEnergy = 0.2;
  learned.timbre.saturation = 0.3;
  learned.timbre.confidence = 0.9;
  learned.meta.confidence = 0.9;
  learned.meta.source = "identity-A";
  learned.meta.fingerprint = "narrow-rolling-sparse-descending-stable";
  const grammar = createEmptyInteractionGrammar();
  grammar.kickBass.bassOnKickProb = [1, 0, 0, 0, 0.9, 0, 0, 0, 1, 0, 0, 0, 0.9, 0, 0, 0];
  grammar.kickBass.bassOffKickProb = [0, 0, 0.05, 0, 0, 0, 0.05, 0, 0, 0, 0.05, 0, 0, 0, 0.05, 0];
  grammar.bassTransitions.transitions = {
    0: { 0: 0.5, 4: 0.35, 2: 0.15 },
    4: { 0: 0.6, 4: 0.2, 2: 0.2 },
    2: { 0: 0.4, 4: 0.35, 2: 0.25 }
  };
  grammar.harmonyLead.intervalPreferences = {
    4: { 3: 0.35, 5: 0.25, 7: 0.15, 2: 0.15, 1: 0.1 }
  };
  grammar.energyDensity.densityByEnergy = [0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65];
  grammar.tensionRegister.registerByTension = [60, 61, 62, 63, 64, 64, 65, 65, 66, 66];
  grammar.confidence = 0.9;
  return {
    name: "source-A",
    learned,
    grammar,
    bassVocabulary: "ROLLING",
    leadVocabulary: "DESCENDING_NARROW",
    bassIntervalWidth: 5,
    leadIntervalWidth: 4,
    syncopation: 0.15,
    harmonicMobility: 0.15,
    energy: 0.5,
    tension: 0.25
  };
}
// packages/music/src/raw-score-serializer.ts
function serializeRawScore(section) {
  return {
    bars: section.bars.map(serializeBar),
    phrases: section.phrases.map(serializePhrase),
    groove: serializeGroove(section.groove),
    arrangement: serializeArrangement(section.arrangement)
  };
}
function serializeBar(bar) {
  return {
    barIndex: bar.barIndex,
    arrangementState: bar.arrangementState,
    roles: { ...bar.roles },
    kickNotes: bar.kickNotes.slice(),
    bassNotes: bar.bassNotes.map((n) => ({
      midi: n.midi,
      step: n.step,
      durationSteps: n.durationSteps,
      function: n.function
    })),
    leadNotes: bar.leadNotes.map((n) => ({
      midi: n.midi,
      step: n.step,
      durationSteps: n.durationSteps,
      velocity: n.velocity
    })),
    hatNotes: bar.hatNotes.slice(),
    harmonicContext: bar.harmonicContext.slice()
  };
}
function serializePhrase(phrase) {
  const result = {
    motifIds: phrase.motifIds.slice()
  };
  if (phrase.callbackTo !== undefined) {
    result.callbackTo = phrase.callbackTo;
  }
  if (phrase.developmentOperator !== undefined) {
    result.developmentOperator = phrase.developmentOperator;
  }
  if (phrase.phraseMaterial) {
    result.phraseMaterial = serializePhraseMaterial(phrase.phraseMaterial);
  }
  return result;
}
function serializePhraseMaterial(pm) {
  return {
    motifId: pm.motifId,
    pitchContour: pm.pitchContour.slice(),
    intervalSequence: pm.intervalSequence.slice(),
    rhythmPattern: pm.rhythmPattern.slice(),
    accentPattern: pm.accentPattern.slice(),
    noteDurations: pm.noteDurations.slice(),
    registerProfile: pm.registerProfile,
    harmonicTargets: pm.harmonicTargets.slice(),
    stepsPerBar: pm.stepsPerBar,
    transformHistory: pm.transformHistory.slice(),
    rhythmicCell: pm.rhythmicCell.slice(),
    contour: pm.contour,
    cadenceTarget: pm.cadenceTarget,
    phraseArc: {
      stages: pm.phraseArc.stages.map((s) => ({
        stage: s.stage,
        barRange: [s.barRange[0], s.barRange[1]],
        density: s.density,
        register: s.register,
        tension: s.tension
      })),
      focalBar: pm.phraseArc.focalBar,
      cadenceBar: pm.phraseArc.cadenceBar,
      tensionTrajectory: pm.phraseArc.tensionTrajectory.slice()
    }
  };
}
function serializeGroove(groove) {
  return {
    stepsPerBar: groove.stepsPerBar,
    bassKickAlignment: groove.bassKickAlignment,
    accentSteps: groove.accentSteps.slice(),
    syncopationBudget: groove.syncopationBudget,
    fillBars: groove.fillBars.slice(),
    accent: groove.accent.slice(),
    _experimental: {
      swing: groove.swing,
      microtiming: groove.microtiming.slice(),
      kickSteps: groove.kickSteps.slice(),
      hatSteps: groove.hatSteps.slice()
    }
  };
}
function serializeArrangement(arr) {
  return {
    bars: arr.bars,
    slots: arr.slots.map((s) => ({
      barIndex: s.barIndex,
      state: s.state,
      roles: { ...s.roles },
      density: s.density,
      energy: s.energy
    }))
  };
}
// packages/dsp/src/filters-zdf.ts
class ZDFSVF {
  ic1eq = 0;
  ic2eq = 0;
  smoothFc = 0;
  lastCutoff = -1;
  reset() {
    this.ic1eq = 0;
    this.ic2eq = 0;
    this.smoothFc = 0;
    this.lastCutoff = -1;
  }
  process(x, cutoff, res, sr, type = 0) {
    const smoothCoef = 1 - Math.exp(-1 / (0.01 * sr));
    if (this.smoothFc === 0) {
      this.smoothFc = cutoff;
    } else {
      this.smoothFc += (cutoff - this.smoothFc) * smoothCoef;
    }
    this.lastCutoff = cutoff;
    const fc = Math.min(0.49, this.smoothFc / sr);
    const g = Math.tan(Math.PI * fc);
    const resNorm = Math.min(1, Math.max(0, res));
    const k = Math.max(0.02, 2 - resNorm * 2);
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = x - this.ic2eq;
    const v1 = a1 * this.ic1eq + a2 * v3;
    const v2 = this.ic2eq + a2 * this.ic1eq + a3 * v3;
    this.ic1eq = 2 * v1 - this.ic1eq;
    this.ic2eq = 2 * v2 - this.ic2eq;
    if (type === 0)
      return v2;
    if (type === 1)
      return v1;
    return x - k * v1 - v2;
  }
  processAll(x, cutoff, res, sr) {
    const fc = Math.min(0.49, cutoff / sr);
    const g = Math.tan(Math.PI * fc);
    const k = Math.max(0.02, 2 - res * 2);
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = x - this.ic2eq;
    const v1 = a1 * this.ic1eq + a2 * v3;
    const v2 = this.ic2eq + a2 * this.ic1eq + a3 * v3;
    this.ic1eq = 2 * v1 - this.ic1eq;
    this.ic2eq = 2 * v2 - this.ic2eq;
    return [v2, v1, x - k * v1 - v2];
  }
}
// packages/dsp/src/master/multiband.ts
var TWO_PI = Math.PI * 2;
var BUTTERWORTH_Q = Math.SQRT1_2;

class BiquadSection {
  b0 = 0;
  b1 = 0;
  b2 = 0;
  a1 = 0;
  a2 = 0;
  z1 = 0;
  z2 = 0;
  constructor(type, freq, Q, sampleRate) {
    const w0 = TWO_PI * freq / sampleRate;
    const cosw0 = Math.cos(w0);
    const sinw0 = Math.sin(w0);
    const alpha = sinw0 / (2 * Q);
    let b0;
    let b1;
    let b2;
    if (type === "lp") {
      const c = 1 - cosw0;
      b0 = c / 2;
      b1 = c;
      b2 = c / 2;
    } else {
      const c = 1 + cosw0;
      b0 = c / 2;
      b1 = -c;
      b2 = c / 2;
    }
    const a0 = 1 + alpha;
    const a1 = -2 * cosw0;
    const a2 = 1 - alpha;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }
  process(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
  reset() {
    this.z1 = 0;
    this.z2 = 0;
  }
}

class LR4Crossover {
  lp1;
  lp2;
  hp1;
  hp2;
  constructor(crossoverFreq, sampleRate) {
    this.lp1 = new BiquadSection("lp", crossoverFreq, BUTTERWORTH_Q, sampleRate);
    this.lp2 = new BiquadSection("lp", crossoverFreq, BUTTERWORTH_Q, sampleRate);
    this.hp1 = new BiquadSection("hp", crossoverFreq, BUTTERWORTH_Q, sampleRate);
    this.hp2 = new BiquadSection("hp", crossoverFreq, BUTTERWORTH_Q, sampleRate);
  }
  process(input) {
    const lp = this.lp2.process(this.lp1.process(input));
    const hp = this.hp2.process(this.hp1.process(input));
    return [lp, hp];
  }
  reset() {
    this.lp1.reset();
    this.lp2.reset();
    this.hp1.reset();
    this.hp2.reset();
  }
}

class BandCompressor {
  threshold;
  ratio;
  makeupGain;
  attackCoeff;
  releaseCoeff;
  envFollower = 0;
  lastGainReductionLinear = 1;
  sampleRate;
  constructor(opts) {
    this.threshold = 10 ** (opts.thresholdDb / 20);
    this.ratio = Math.max(1, opts.ratio);
    this.makeupGain = 10 ** (opts.makeupDb / 20);
    this.sampleRate = opts.sampleRate;
    const attackSamples = Math.max(0.000001, opts.attackMs * 0.001 * opts.sampleRate);
    const releaseSamples = Math.max(0.000001, opts.releaseMs * 0.001 * opts.sampleRate);
    this.attackCoeff = 1 - Math.exp(-1 / attackSamples);
    this.releaseCoeff = 1 - Math.exp(-1 / releaseSamples);
  }
  process(input) {
    const rect = Math.abs(input);
    const coeff = rect > this.envFollower ? this.attackCoeff : this.releaseCoeff;
    this.envFollower += (rect - this.envFollower) * coeff;
    let gr = 1;
    const env = this.envFollower;
    if (env > this.threshold) {
      const exponent = 1 - 1 / this.ratio;
      gr = (this.threshold / env) ** exponent;
    }
    this.lastGainReductionLinear = gr;
    return input * gr * this.makeupGain;
  }
  getLastGainReductionLinear() {
    return this.lastGainReductionLinear;
  }
  reset() {
    this.envFollower = 0;
    this.lastGainReductionLinear = 1;
  }
}
var DEFAULT_LOW_SETTINGS = {
  thresholdDb: -18,
  ratio: 3,
  attackMs: 10,
  releaseMs: 100,
  makeupDb: 2
};
var DEFAULT_MID_SETTINGS = {
  thresholdDb: -22,
  ratio: 2.5,
  attackMs: 15,
  releaseMs: 120,
  makeupDb: 1
};
var DEFAULT_HIGH_SETTINGS = {
  thresholdDb: -20,
  ratio: 2,
  attackMs: 5,
  releaseMs: 80,
  makeupDb: 1
};

class MultibandCompressor {
  lowXoverL;
  midXoverL;
  lowXoverR;
  midXoverR;
  compLowL;
  compMidL;
  compHighL;
  compLowR;
  compMidR;
  compHighR;
  lowGainReductionDb = 0;
  midGainReductionDb = 0;
  highGainReductionDb = 0;
  sampleRate;
  constructor(opts) {
    const sampleRate = opts.sampleRate;
    const lowXoverHz = opts.lowCrossoverHz ?? 200;
    const midXoverHz = opts.midCrossoverHz ?? 2000;
    this.sampleRate = sampleRate;
    this.lowXoverL = new LR4Crossover(lowXoverHz, sampleRate);
    this.midXoverL = new LR4Crossover(midXoverHz, sampleRate);
    this.lowXoverR = new LR4Crossover(lowXoverHz, sampleRate);
    this.midXoverR = new LR4Crossover(midXoverHz, sampleRate);
    const lowSettings = {
      ...DEFAULT_LOW_SETTINGS,
      ...opts.lowSettings
    };
    const midSettings = {
      ...DEFAULT_MID_SETTINGS,
      ...opts.midSettings
    };
    const highSettings = {
      ...DEFAULT_HIGH_SETTINGS,
      ...opts.highSettings
    };
    const mk = (s) => new BandCompressor({ ...s, sampleRate });
    this.compLowL = mk(lowSettings);
    this.compMidL = mk(midSettings);
    this.compHighL = mk(highSettings);
    this.compLowR = mk(lowSettings);
    this.compMidR = mk(midSettings);
    this.compHighR = mk(highSettings);
  }
  processBuffer(L, R) {
    const n = Math.min(L.length, R.length);
    let minGrLow = 1;
    let minGrMid = 1;
    let minGrHigh = 1;
    for (let i = 0;i < n; i++) {
      const xL = L[i];
      const xR = R[i];
      const [lowL, restL] = this.lowXoverL.process(xL);
      const [midL, highL] = this.midXoverL.process(restL);
      const [lowR, restR] = this.lowXoverR.process(xR);
      const [midR, highR] = this.midXoverR.process(restR);
      const lowOutL = this.compLowL.process(lowL);
      const midOutL = this.compMidL.process(midL);
      const highOutL = this.compHighL.process(highL);
      const lowOutR = this.compLowR.process(lowR);
      const midOutR = this.compMidR.process(midR);
      const highOutR = this.compHighR.process(highR);
      L[i] = lowOutL + midOutL + highOutL;
      R[i] = lowOutR + midOutR + highOutR;
      const grLowL = this.compLowL.getLastGainReductionLinear();
      const grLowR = this.compLowR.getLastGainReductionLinear();
      const grMidL = this.compMidL.getLastGainReductionLinear();
      const grMidR = this.compMidR.getLastGainReductionLinear();
      const grHighL = this.compHighL.getLastGainReductionLinear();
      const grHighR = this.compHighR.getLastGainReductionLinear();
      if (grLowL < minGrLow)
        minGrLow = grLowL;
      if (grLowR < minGrLow)
        minGrLow = grLowR;
      if (grMidL < minGrMid)
        minGrMid = grMidL;
      if (grMidR < minGrMid)
        minGrMid = grMidR;
      if (grHighL < minGrHigh)
        minGrHigh = grHighL;
      if (grHighR < minGrHigh)
        minGrHigh = grHighR;
    }
    this.lowGainReductionDb = minGrLow > 0 ? -20 * Math.log10(minGrLow) : 0;
    this.midGainReductionDb = minGrMid > 0 ? -20 * Math.log10(minGrMid) : 0;
    this.highGainReductionDb = minGrHigh > 0 ? -20 * Math.log10(minGrHigh) : 0;
  }
  getLowGainReductionDb() {
    return this.lowGainReductionDb;
  }
  getMidGainReductionDb() {
    return this.midGainReductionDb;
  }
  getHighGainReductionDb() {
    return this.highGainReductionDb;
  }
  reset() {
    this.lowXoverL.reset();
    this.midXoverL.reset();
    this.lowXoverR.reset();
    this.midXoverR.reset();
    this.compLowL.reset();
    this.compMidL.reset();
    this.compHighL.reset();
    this.compLowR.reset();
    this.compMidR.reset();
    this.compHighR.reset();
    this.lowGainReductionDb = 0;
    this.midGainReductionDb = 0;
    this.highGainReductionDb = 0;
  }
}
// packages/dsp/src/master/ott.ts
class BandExpander {
  threshold;
  upwardGain;
  downwardGain;
  depth;
  env;
  attackCoef;
  releaseCoef;
  constructor(opts) {
    this.threshold = 10 ** (opts.thresholdDb / 20);
    this.upwardGain = 10 ** (opts.upwardGainDb / 20);
    this.downwardGain = 10 ** (opts.downwardGainDb / 20);
    this.depth = opts.depth;
    this.env = 0;
    const attackSec = Math.max(0.000001, opts.attackMs / 1000);
    const releaseSec = Math.max(0.000001, opts.releaseMs / 1000);
    this.attackCoef = 1 - Math.exp(-1 / (attackSec * opts.sampleRate));
    this.releaseCoef = 1 - Math.exp(-1 / (releaseSec * opts.sampleRate));
  }
  process(x) {
    const abs = Math.abs(x);
    const coef = abs > this.env ? this.attackCoef : this.releaseCoef;
    this.env += (abs - this.env) * coef;
    let gain = 1;
    if (this.env > this.threshold) {
      const over = this.env / this.threshold;
      gain = this.downwardGain ** Math.log2(over);
    } else if (this.env > 0.000001) {
      const under = this.threshold / Math.max(this.env, 0.000001);
      gain = this.upwardGain ** Math.log2(under);
    }
    gain = Math.max(0.01, Math.min(100, gain));
    const wetGain = 1 + (gain - 1) * this.depth;
    return x * wetGain;
  }
  reset() {
    this.env = 0;
  }
}

class OTT {
  lowXoverL;
  midXoverL;
  lowXoverR;
  midXoverR;
  lowExpanderL;
  midExpanderL;
  highExpanderL;
  lowExpanderR;
  midExpanderR;
  highExpanderR;
  depth;
  enabled;
  constructor(opts) {
    const sr = opts.sampleRate;
    const lowHz = opts.lowCrossoverHz ?? 200;
    const midHz = opts.midCrossoverHz ?? 2000;
    const depth = Math.max(0, Math.min(1, opts.depth ?? 1));
    const upwardDb = Math.max(0, Math.min(12, opts.upwardGainDb ?? 6));
    const downwardDb = Math.max(-12, Math.min(0, opts.downwardGainDb ?? -6));
    const thresholdDb = opts.thresholdDb ?? -18;
    const attackMs = opts.attackMs ?? 1;
    const releaseMs = opts.releaseMs ?? 100;
    this.depth = depth;
    this.enabled = depth > 0.001;
    this.lowXoverL = new LR4Crossover(lowHz, sr);
    this.midXoverL = new LR4Crossover(midHz, sr);
    this.lowXoverR = new LR4Crossover(lowHz, sr);
    this.midXoverR = new LR4Crossover(midHz, sr);
    const expanderOpts = {
      thresholdDb,
      upwardGainDb: upwardDb,
      downwardGainDb: downwardDb,
      depth,
      attackMs,
      releaseMs,
      sampleRate: sr
    };
    this.lowExpanderL = new BandExpander(expanderOpts);
    this.midExpanderL = new BandExpander({ ...expanderOpts, upwardGainDb: upwardDb * 0.8 });
    this.highExpanderL = new BandExpander({ ...expanderOpts, upwardGainDb: upwardDb * 1.2 });
    this.lowExpanderR = new BandExpander(expanderOpts);
    this.midExpanderR = new BandExpander({ ...expanderOpts, upwardGainDb: upwardDb * 0.8 });
    this.highExpanderR = new BandExpander({ ...expanderOpts, upwardGainDb: upwardDb * 1.2 });
  }
  processBuffer(L, R) {
    if (!this.enabled)
      return;
    const N = Math.min(L.length, R.length);
    for (let i = 0;i < N; i++) {
      const xL = L[i];
      const xR = R[i];
      const [lowL, restL] = this.lowXoverL.process(xL);
      const [midL, highL] = this.midXoverL.process(restL);
      const [lowR, restR] = this.lowXoverR.process(xR);
      const [midR, highR] = this.midXoverR.process(restR);
      const lowOutL = this.lowExpanderL.process(lowL);
      const midOutL = this.midExpanderL.process(midL);
      const highOutL = this.highExpanderL.process(highL);
      const lowOutR = this.lowExpanderR.process(lowR);
      const midOutR = this.midExpanderR.process(midR);
      const highOutR = this.highExpanderR.process(highR);
      L[i] = lowOutL + midOutL + highOutL;
      R[i] = lowOutR + midOutR + highOutR;
    }
  }
  reset() {
    this.lowXoverL.reset();
    this.midXoverL.reset();
    this.lowXoverR.reset();
    this.midXoverR.reset();
    this.lowExpanderL.reset();
    this.midExpanderL.reset();
    this.highExpanderL.reset();
    this.lowExpanderR.reset();
    this.midExpanderR.reset();
    this.highExpanderR.reset();
  }
}
// packages/dsp/src/master/limiter.ts
var CATMULL_ROM_PHASES = [
  [0, 1, 0, 0],
  [-0.0703125, 0.8671875, 0.2265625, -0.0234375],
  [-0.0625, 0.5625, 0.5625, -0.0625],
  [-0.0234375, 0.2265625, 0.8671875, -0.0703125]
];

class TruePeakLimiter {
  threshold;
  ceiling;
  attackCoef;
  releaseCoef;
  lookaheadSamples;
  sampleRate;
  envelope = 1;
  maxGainReductionDb = 0;
  constructor(opts) {
    const thresholdDb = opts.thresholdDb ?? -1;
    const ceilingDb = opts.ceilingDb ?? -1;
    const attackMs = opts.attackMs ?? 1;
    const releaseMs = opts.releaseMs ?? 100;
    const lookaheadMs = opts.lookaheadMs ?? 5;
    this.sampleRate = opts.sampleRate;
    this.threshold = 10 ** (thresholdDb / 20);
    this.ceiling = 10 ** (ceilingDb / 20);
    this.lookaheadSamples = Math.max(1, Math.round(lookaheadMs * this.sampleRate / 1000));
    const attackSec = Math.max(0.000001, attackMs / 1000);
    const releaseSec = Math.max(0.000001, releaseMs / 1000);
    this.attackCoef = 1 - Math.exp(-1 / (attackSec * this.sampleRate));
    this.releaseCoef = 1 - Math.exp(-1 / (releaseSec * this.sampleRate));
  }
  setThresholdDb(db) {
    this.threshold = 10 ** (db / 20);
  }
  setCeilingDb(db) {
    this.ceiling = 10 ** (db / 20);
  }
  getLookaheadSamples() {
    return this.lookaheadSamples;
  }
  processBuffer(L, R) {
    const N = Math.min(L.length, R.length);
    if (N === 0)
      return;
    const D = this.lookaheadSamples;
    const threshold = this.threshold;
    const ceiling = this.ceiling;
    const attackCoef = this.attackCoef;
    const releaseCoef = this.releaseCoef;
    const peaks = new Float32Array(N);
    for (let i = 0;i < N; i++) {
      const im1 = i > 0 ? i - 1 : 0;
      const ip1 = i < N - 1 ? i + 1 : i;
      const ip2 = i < N - 2 ? i + 2 : ip1;
      const lPrev = L[im1];
      const lCur = L[i];
      const lNext = L[ip1];
      const lNext2 = L[ip2];
      const rPrev = R[im1];
      const rCur = R[i];
      const rNext = R[ip1];
      const rNext2 = R[ip2];
      let maxPeak = 0;
      for (let phase = 0;phase < 4; phase++) {
        const c = CATMULL_ROM_PHASES[phase];
        const lVal = c[0] * lPrev + c[1] * lCur + c[2] * lNext + c[3] * lNext2;
        const rVal = c[0] * rPrev + c[1] * rCur + c[2] * rNext + c[3] * rNext2;
        const al = Math.abs(lVal);
        const ar = Math.abs(rVal);
        if (al > maxPeak)
          maxPeak = al;
        if (ar > maxPeak)
          maxPeak = ar;
      }
      peaks[i] = maxPeak;
    }
    const windowMax = new Float32Array(N);
    {
      const dq = [];
      for (let i = N - 1;i >= 0; i--) {
        while (dq.length > 0 && dq[dq.length - 1] > i + D - 1)
          dq.pop();
        while (dq.length > 0 && peaks[dq[dq.length - 1]] <= peaks[i])
          dq.pop();
        dq.push(i);
        windowMax[i] = peaks[dq[0]];
      }
    }
    let envelope = this.envelope;
    let maxGr = this.maxGainReductionDb;
    for (let i = 0;i < N; i++) {
      let target = 1;
      if (windowMax[i] > threshold) {
        target = threshold / windowMax[i];
      }
      const coef = target < envelope ? attackCoef : releaseCoef;
      envelope += (target - envelope) * coef;
      if (envelope > 0.000000000001) {
        const grDb = 20 * Math.log10(envelope);
        if (grDb < maxGr)
          maxGr = grDb;
      }
      L[i] = L[i] * envelope;
      R[i] = R[i] * envelope;
    }
    for (let i = 0;i < N; i++) {
      let sL = L[i];
      let sR = R[i];
      if (sL > ceiling)
        sL = ceiling;
      else if (sL < -ceiling)
        sL = -ceiling;
      if (sR > ceiling)
        sR = ceiling;
      else if (sR < -ceiling)
        sR = -ceiling;
      L[i] = sL;
      R[i] = sR;
    }
    this.envelope = envelope;
    this.maxGainReductionDb = maxGr;
  }
  getMaxGainReductionDb() {
    return this.maxGainReductionDb;
  }
  getEnvelope() {
    return this.envelope;
  }
  reset() {
    this.envelope = 1;
    this.maxGainReductionDb = 0;
  }
}
// packages/dsp/src/master/loudness.ts
class KWeightFilter {
  s1_b0;
  s1_b1;
  s1_b2;
  s1_a1;
  s1_a2;
  s1_z1 = 0;
  s1_z2 = 0;
  s2_b0;
  s2_b1;
  s2_b2;
  s2_a1;
  s2_a2;
  s2_z1 = 0;
  s2_z2 = 0;
  constructor(sampleRate) {
    const f0a = 1681.974450955533;
    const Ga = 3.999843853973347;
    const Qa = 0.7071752369554196;
    const Aa = 10 ** (Ga / 40);
    const w0a = 2 * Math.PI * f0a / sampleRate;
    const cosA = Math.cos(w0a);
    const sinA = Math.sin(w0a);
    const alphaA = sinA / (2 * Qa);
    const sqrtAa = Math.sqrt(Aa);
    const a0a = Aa + 1 - (Aa - 1) * cosA + 2 * sqrtAa * alphaA;
    this.s1_b0 = Aa * (Aa + 1 + (Aa - 1) * cosA + 2 * sqrtAa * alphaA) / a0a;
    this.s1_b1 = -2 * Aa * (Aa - 1 + (Aa + 1) * cosA) / a0a;
    this.s1_b2 = Aa * (Aa + 1 + (Aa - 1) * cosA - 2 * sqrtAa * alphaA) / a0a;
    this.s1_a1 = 2 * (Aa - 1 - (Aa + 1) * cosA) / a0a;
    this.s1_a2 = (Aa + 1 - (Aa - 1) * cosA - 2 * sqrtAa * alphaA) / a0a;
    const f0b = 38.13547087602444;
    const Qb = 0.5003270373238773;
    const w0b = 2 * Math.PI * f0b / sampleRate;
    const cosB = Math.cos(w0b);
    const sinB = Math.sin(w0b);
    const alphaB = sinB / (2 * Qb);
    const a0b = 1 + alphaB;
    this.s2_b0 = (1 + cosB) / 2 / a0b;
    this.s2_b1 = -(1 + cosB) / a0b;
    this.s2_b2 = (1 + cosB) / 2 / a0b;
    this.s2_a1 = -2 * cosB / a0b;
    this.s2_a2 = (1 - alphaB) / a0b;
  }
  process(x) {
    const y1 = this.s1_b0 * x + this.s1_z1;
    this.s1_z1 = this.s1_b1 * x - this.s1_a1 * y1 + this.s1_z2;
    this.s1_z2 = this.s1_b2 * x - this.s1_a2 * y1;
    const y2 = this.s2_b0 * y1 + this.s2_z1;
    this.s2_z1 = this.s2_b1 * y1 - this.s2_a1 * y2 + this.s2_z2;
    this.s2_z2 = this.s2_b2 * y1 - this.s2_a2 * y2;
    return y2;
  }
  reset() {
    this.s1_z1 = 0;
    this.s1_z2 = 0;
    this.s2_z1 = 0;
    this.s2_z2 = 0;
  }
}
var SILENCE_LUFS = -70;
var RELATIVE_GATE_OFFSET_LU = -10;
var ABSOLUTE_GATE_LUFS = -70;
function meanSquareToLUFS(z) {
  if (z < 0.000000000001)
    return SILENCE_LUFS;
  return -0.691 + 10 * Math.log10(z);
}
function computeBlocks(wL, wR, N, blockSize, hopSize) {
  const out = [];
  if (blockSize <= 0 || hopSize <= 0)
    return out;
  for (let start = 0;start + blockSize <= N; start += hopSize) {
    let sumSq = 0;
    for (let i = 0;i < blockSize; i++) {
      const idx = start + i;
      const l = wL[idx];
      const r = wR[idx];
      sumSq += l * l + r * r;
    }
    const z = sumSq / blockSize;
    out.push({ z, lufs: meanSquareToLUFS(z) });
  }
  return out;
}
function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0)
    return SILENCE_LUFS;
  if (sortedAsc.length === 1)
    return sortedAsc[0];
  const idx = p / 100 * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi)
    return sortedAsc[lo];
  const frac = idx - lo;
  return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac;
}
function measureLUFS(L, R, sampleRate) {
  const N = Math.min(L.length, R.length);
  if (N === 0) {
    return {
      integratedLUFS: SILENCE_LUFS,
      momentaryLUFS: SILENCE_LUFS,
      shortTermLUFS: SILENCE_LUFS,
      truePeakDb: SILENCE_LUFS,
      samplePeakDb: SILENCE_LUFS,
      rangeLU: 0
    };
  }
  const filterL = new KWeightFilter(sampleRate);
  const filterR = new KWeightFilter(sampleRate);
  const wL = new Float32Array(N);
  const wR = new Float32Array(N);
  let maxAbs = 0;
  for (let i = 0;i < N; i++) {
    const l = L[i];
    const r = R[i];
    wL[i] = filterL.process(l);
    wR[i] = filterR.process(r);
    const al = Math.abs(l);
    const ar = Math.abs(r);
    if (al > maxAbs)
      maxAbs = al;
    if (ar > maxAbs)
      maxAbs = ar;
  }
  let truePeakMax = maxAbs;
  for (let i = 0;i < N; i++) {
    const im1 = i > 0 ? i - 1 : 0;
    const ip1 = i < N - 1 ? i + 1 : i;
    const ip2 = i < N - 2 ? i + 2 : ip1;
    const lP = L[im1];
    const lC = L[i];
    const lN = L[ip1];
    const lN2 = L[ip2];
    const rP = R[im1];
    const rC = R[i];
    const rN = R[ip1];
    const rN2 = R[ip2];
    let v = -0.0703125 * lP + 0.8671875 * lC + 0.2265625 * lN - 0.0234375 * lN2;
    if (v > truePeakMax)
      truePeakMax = v;
    else if (-v > truePeakMax)
      truePeakMax = -v;
    v = -0.0625 * lP + 0.5625 * lC + 0.5625 * lN - 0.0625 * lN2;
    if (v > truePeakMax)
      truePeakMax = v;
    else if (-v > truePeakMax)
      truePeakMax = -v;
    v = -0.0234375 * lP + 0.2265625 * lC + 0.8671875 * lN - 0.0703125 * lN2;
    if (v > truePeakMax)
      truePeakMax = v;
    else if (-v > truePeakMax)
      truePeakMax = -v;
    v = -0.0703125 * rP + 0.8671875 * rC + 0.2265625 * rN - 0.0234375 * rN2;
    if (v > truePeakMax)
      truePeakMax = v;
    else if (-v > truePeakMax)
      truePeakMax = -v;
    v = -0.0625 * rP + 0.5625 * rC + 0.5625 * rN - 0.0625 * rN2;
    if (v > truePeakMax)
      truePeakMax = v;
    else if (-v > truePeakMax)
      truePeakMax = -v;
    v = -0.0234375 * rP + 0.2265625 * rC + 0.8671875 * rN - 0.0703125 * rN2;
    if (v > truePeakMax)
      truePeakMax = v;
    else if (-v > truePeakMax)
      truePeakMax = -v;
  }
  const truePeakDb = truePeakMax > 0 ? 20 * Math.log10(truePeakMax) : SILENCE_LUFS;
  const samplePeakDb = maxAbs > 0 ? 20 * Math.log10(maxAbs) : SILENCE_LUFS;
  const momentaryBlockSize = Math.floor(0.4 * sampleRate);
  const shortTermBlockSize = Math.floor(3 * sampleRate);
  const hopSize = Math.floor(0.1 * sampleRate);
  const mBlocks = computeBlocks(wL, wR, N, momentaryBlockSize, Math.max(1, hopSize));
  const sBlocks = computeBlocks(wL, wR, N, shortTermBlockSize, Math.max(1, hopSize));
  let momentaryLUFS = SILENCE_LUFS;
  for (const b of mBlocks) {
    if (b.lufs > momentaryLUFS)
      momentaryLUFS = b.lufs;
  }
  let shortTermLUFS = SILENCE_LUFS;
  for (const b of sBlocks) {
    if (b.lufs > shortTermLUFS)
      shortTermLUFS = b.lufs;
  }
  let integratedLUFS = SILENCE_LUFS;
  if (mBlocks.length > 0) {
    const absGated = mBlocks.filter((b) => b.lufs > ABSOLUTE_GATE_LUFS);
    if (absGated.length > 0) {
      let zSum = 0;
      for (const b of absGated)
        zSum += b.z;
      const zMeanA = zSum / absGated.length;
      const meanLUFS = meanSquareToLUFS(zMeanA);
      const relGateLUFS = Math.max(ABSOLUTE_GATE_LUFS, meanLUFS + RELATIVE_GATE_OFFSET_LU);
      const relGated = absGated.filter((b) => b.lufs > relGateLUFS);
      if (relGated.length > 0) {
        let zSum2 = 0;
        for (const b of relGated)
          zSum2 += b.z;
        const zMeanB = zSum2 / relGated.length;
        integratedLUFS = meanSquareToLUFS(zMeanB);
      } else {
        integratedLUFS = meanLUFS;
      }
    }
  }
  let rangeLU = 0;
  if (sBlocks.length > 0) {
    const lufsValues = sBlocks.filter((b) => b.lufs > ABSOLUTE_GATE_LUFS).map((b) => b.lufs).sort((a, b) => a - b);
    if (lufsValues.length >= 2) {
      const p95 = percentile(lufsValues, 95);
      const p10 = percentile(lufsValues, 10);
      rangeLU = p95 - p10;
      if (rangeLU < 0)
        rangeLU = 0;
    }
  }
  return {
    integratedLUFS,
    momentaryLUFS,
    shortTermLUFS,
    truePeakDb,
    samplePeakDb,
    rangeLU
  };
}
function lufsToGainOffset(currentLUFS, targetLUFS) {
  return 10 ** ((targetLUFS - currentLUFS) / 20);
}
// apps/web/src/lib/psy4/channel-fx.ts
class BiquadShelf {
  b0 = 1;
  b1 = 0;
  b2 = 0;
  a1 = 0;
  a2 = 0;
  z1 = 0;
  z2 = 0;
  constructor(kind, freqHz, gainDb, sampleRate, slope = 1) {
    this.setCoeffs(kind, freqHz, gainDb, sampleRate, slope);
  }
  setCoeffs(kind, freqHz, gainDb, sampleRate, slope = 1) {
    const A = 10 ** (gainDb / 40);
    const w0 = 2 * Math.PI * freqHz / sampleRate;
    const cosw0 = Math.cos(w0);
    const sinw0 = Math.sin(w0);
    let b0;
    let b1;
    let b2;
    let a0;
    let a1;
    let a2;
    if (kind === "peak") {
      const Q = slope;
      const peakAlpha = sinw0 / (2 * Q);
      b0 = 1 + peakAlpha * A;
      b1 = -2 * cosw0;
      b2 = 1 - peakAlpha * A;
      a0 = 1 + peakAlpha / A;
      a1 = -2 * cosw0;
      a2 = 1 - peakAlpha / A;
    } else {
      const alpha = sinw0 / 2 * Math.sqrt((A + 1 / A) * (1 / slope - 1) + 2);
      if (kind === "low") {
        b0 = A * (A + 1 - (A - 1) * cosw0 + 2 * Math.sqrt(A) * alpha);
        b1 = 2 * A * (A - 1 - (A + 1) * cosw0);
        b2 = A * (A + 1 - (A - 1) * cosw0 - 2 * Math.sqrt(A) * alpha);
        a0 = A + 1 + (A - 1) * cosw0 + 2 * Math.sqrt(A) * alpha;
        a1 = -2 * (A - 1 + (A + 1) * cosw0);
        a2 = A + 1 + (A - 1) * cosw0 - 2 * Math.sqrt(A) * alpha;
      } else {
        b0 = A * (A + 1 + (A - 1) * cosw0 + 2 * Math.sqrt(A) * alpha);
        b1 = -2 * A * (A - 1 + (A + 1) * cosw0);
        b2 = A * (A + 1 + (A - 1) * cosw0 - 2 * Math.sqrt(A) * alpha);
        a0 = A + 1 - (A - 1) * cosw0 + 2 * Math.sqrt(A) * alpha;
        a1 = 2 * (A - 1 - (A + 1) * cosw0);
        a2 = A + 1 - (A - 1) * cosw0 - 2 * Math.sqrt(A) * alpha;
      }
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }
  process(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
  reset() {
    this.z1 = 0;
    this.z2 = 0;
  }
}

class CompactReverb {
  static COMB_BASE = [1116, 1188, 1277, 1356];
  static ALLPASS_L = [556, 341];
  static ALLPASS_R = [573, 311];
  combBufs;
  combIdx;
  combLP;
  combFeedback;
  combDamping;
  apBufsL;
  apIdxL;
  apBufsR;
  apIdxR;
  apFeedback = 0.5;
  inputGain = 0.018;
  constructor(roomSize, decaySec, damping, sampleRate) {
    const roomScale = 0.5 + Math.max(0, Math.min(1, roomSize)) * 1.5;
    this.combBufs = [];
    this.combIdx = new Int32Array(4);
    this.combLP = new Float32Array(4);
    let longestDelaySec = 0;
    for (let i = 0;i < 4; i++) {
      const len = Math.max(8, Math.floor(CompactReverb.COMB_BASE[i] * roomScale));
      this.combBufs.push(new Float32Array(len));
      longestDelaySec = Math.max(longestDelaySec, len / sampleRate);
    }
    const safeDecay = Math.max(0.05, decaySec);
    let g = 10 ** (-3 * longestDelaySec / safeDecay);
    g = Math.max(0.2, Math.min(0.99, g));
    this.combFeedback = g;
    this.combDamping = Math.max(0, Math.min(0.95, damping * 0.95));
    this.apBufsL = [];
    this.apIdxL = new Int32Array(2);
    this.apBufsR = [];
    this.apIdxR = new Int32Array(2);
    for (let i = 0;i < 2; i++) {
      this.apBufsL.push(new Float32Array(CompactReverb.ALLPASS_L[i]));
      this.apBufsR.push(new Float32Array(CompactReverb.ALLPASS_R[i]));
    }
  }
  process(input) {
    if (!Number.isFinite(input))
      return [0, 0];
    const inSample = input * this.inputGain;
    let combSum = 0;
    for (let i = 0;i < 4; i++) {
      const buf = this.combBufs[i];
      const idx = this.combIdx[i];
      const delayed = buf[idx];
      const lp = this.combLP[i];
      const damped = delayed + this.combDamping * (lp - delayed);
      this.combLP[i] = damped;
      const out = inSample + damped * this.combFeedback;
      buf[idx] = out;
      this.combIdx[i] = (idx + 1) % buf.length;
      combSum += out;
    }
    combSum *= 0.25;
    let apL = combSum;
    for (let i = 0;i < 2; i++) {
      const buf = this.apBufsL[i];
      const idx = this.apIdxL[i];
      const delayed = buf[idx];
      const out = -apL * this.apFeedback + delayed;
      buf[idx] = apL + delayed * this.apFeedback;
      this.apIdxL[i] = (idx + 1) % buf.length;
      apL = out;
    }
    let apR = combSum;
    for (let i = 0;i < 2; i++) {
      const buf = this.apBufsR[i];
      const idx = this.apIdxR[i];
      const delayed = buf[idx];
      const out = -apR * this.apFeedback + delayed;
      buf[idx] = apR + delayed * this.apFeedback;
      this.apIdxR[i] = (idx + 1) % buf.length;
      apR = out;
    }
    return [apL, apR];
  }
  reset() {
    for (const b of this.combBufs)
      b.fill(0);
    this.combIdx.fill(0);
    this.combLP.fill(0);
    for (const b of this.apBufsL)
      b.fill(0);
    for (const b of this.apBufsR)
      b.fill(0);
    this.apIdxL.fill(0);
    this.apIdxR.fill(0);
  }
}

class ChannelFX {
  sampleRate;
  lowShelf;
  highShelf;
  midPeak;
  delayBufSize;
  delayBufL;
  delayBufR;
  delayWriteIdx = 0;
  delaySamplesL;
  delaySamplesR;
  delayFeedback;
  delayMix;
  delayEnabled;
  reverb;
  reverbMix;
  panGainL;
  panGainR;
  widthDelaySamples;
  widthSideGain;
  widthBuf;
  widthIdx = 0;
  constructor(config, sampleRate = 44100) {
    this.sampleRate = sampleRate;
    this.lowShelf = new BiquadShelf("low", config.eq.lowFreqHz, config.eq.lowGainDb, sampleRate);
    this.highShelf = new BiquadShelf("high", config.eq.highFreqHz, config.eq.highGainDb, sampleRate);
    if (config.eq.midGainDb && config.eq.midGainDb !== 0 && config.eq.midFreqHz) {
      this.midPeak = new BiquadShelf("peak", config.eq.midFreqHz, config.eq.midGainDb, sampleRate, 1.5);
    } else {
      this.midPeak = null;
    }
    this.delayBufSize = Math.floor(sampleRate * 2);
    this.delayBufL = new Float32Array(this.delayBufSize);
    this.delayBufR = new Float32Array(this.delayBufSize);
    this.delayFeedback = Math.max(0, Math.min(0.95, config.delay.feedback));
    this.delayMix = Math.max(0, Math.min(1, config.delay.mix));
    this.delayEnabled = config.delay.timeMs > 0 && this.delayMix > 0;
    this.delaySamplesL = Math.max(1, Math.floor(config.delay.timeMs / 1000 * sampleRate));
    this.delaySamplesR = Math.max(1, Math.floor((config.delay.timeMs + config.delay.stereoOffsetMs) / 1000 * sampleRate));
    this.reverb = new CompactReverb(config.reverb.roomSize, config.reverb.decaySec, config.reverb.damping, sampleRate);
    this.reverbMix = Math.max(0, Math.min(1, config.reverb.mix));
    const panClamped = Math.max(-1, Math.min(1, config.pan));
    const panAngle = (panClamped + 1) * Math.PI / 4;
    this.panGainL = Math.cos(panAngle);
    this.panGainR = Math.sin(panAngle);
    const w = Math.max(0, Math.min(1, config.width));
    this.widthDelaySamples = Math.floor(w * 662);
    this.widthSideGain = w * 1.3;
    this.widthBuf = new Float32Array(Math.max(1, this.widthDelaySamples));
  }
  process(monoIn) {
    const input = Number.isFinite(monoIn) ? monoIn : 0;
    let sig = this.lowShelf.process(input);
    if (this.midPeak)
      sig = this.midPeak.process(sig);
    sig = this.highShelf.process(sig);
    let dryL = sig;
    let dryR = sig;
    if (this.delayEnabled) {
      const readL = this.delayBufL[(this.delayWriteIdx - this.delaySamplesL + this.delayBufSize) % this.delayBufSize];
      const readR = this.delayBufR[(this.delayWriteIdx - this.delaySamplesR + this.delayBufSize) % this.delayBufSize];
      const writeL = sig + readR * this.delayFeedback;
      const writeR = sig + readL * this.delayFeedback;
      this.delayBufL[this.delayWriteIdx] = writeL;
      this.delayBufR[this.delayWriteIdx] = writeR;
      this.delayWriteIdx = (this.delayWriteIdx + 1) % this.delayBufSize;
      dryL = sig * (1 - this.delayMix) + readL * this.delayMix;
      dryR = sig * (1 - this.delayMix) + readR * this.delayMix;
    }
    if (this.reverbMix > 0) {
      const reverbIn = (dryL + dryR) * 0.5;
      const [wL, wR] = this.reverb.process(reverbIn);
      const wet = this.reverbMix;
      const dry = 1 - wet;
      dryL = dryL * dry + wL * wet;
      dryR = dryR * dry + wR * wet;
    }
    let L = dryL * this.panGainL;
    let R = dryR * this.panGainR;
    if (this.widthDelaySamples > 0) {
      const wDelayed = this.widthBuf[this.widthIdx];
      this.widthBuf[this.widthIdx] = R;
      this.widthIdx = (this.widthIdx + 1) % this.widthBuf.length;
      R = wDelayed;
    }
    const mid = (L + R) * 0.5;
    const side = (L - R) * 0.5 * this.widthSideGain;
    L = mid + side;
    R = mid - side;
    return [L, R];
  }
  reset() {
    this.lowShelf.reset();
    this.highShelf.reset();
    if (this.midPeak)
      this.midPeak.reset();
    this.delayBufL.fill(0);
    this.delayBufR.fill(0);
    this.delayWriteIdx = 0;
    this.reverb.reset();
    this.widthBuf.fill(0);
    this.widthIdx = 0;
  }
}

// apps/web/src/lib/psy4/channel-presets.ts
var CHANNEL_PRESETS = {
  kick: {
    eq: { lowGainDb: 2, lowFreqHz: 60, highGainDb: -1, highFreqHz: 8000 },
    delay: { timeMs: 0, feedback: 0, mix: 0, stereoOffsetMs: 0 },
    reverb: { roomSize: 0.3, decaySec: 0.8, damping: 0.8, mix: 0.03 },
    pan: 0,
    width: 0
  },
  bass: {
    eq: {
      lowGainDb: 3,
      lowFreqHz: 80,
      highGainDb: -2,
      highFreqHz: 5000,
      midGainDb: 2,
      midFreqHz: 150
    },
    delay: { timeMs: 0, feedback: 0, mix: 0, stereoOffsetMs: 0 },
    reverb: { roomSize: 0.2, decaySec: 0.4, damping: 0.9, mix: 0 },
    pan: 0,
    width: 0
  },
  subbass: {
    eq: { lowGainDb: 2, lowFreqHz: 40, highGainDb: -6, highFreqHz: 120 },
    delay: { timeMs: 0, feedback: 0, mix: 0, stereoOffsetMs: 0 },
    reverb: { roomSize: 0, decaySec: 0.3, damping: 1, mix: 0 },
    pan: 0,
    width: 0
  },
  lead: {
    eq: {
      lowGainDb: -4,
      lowFreqHz: 300,
      highGainDb: 3,
      highFreqHz: 6000,
      midGainDb: -2,
      midFreqHz: 3000
    },
    delay: { timeMs: 375, feedback: 0.35, mix: 0.22, stereoOffsetMs: 15 },
    reverb: { roomSize: 0.4, decaySec: 1.8, damping: 0.7, mix: 0.25 },
    pan: 0,
    width: 0.9
  },
  counter: {
    eq: {
      lowGainDb: -5,
      lowFreqHz: 400,
      highGainDb: 3,
      highFreqHz: 8000,
      midGainDb: -3,
      midFreqHz: 3500
    },
    delay: { timeMs: 500, feedback: 0.4, mix: 0.28, stereoOffsetMs: 22 },
    reverb: { roomSize: 0.5, decaySec: 2.2, damping: 0.6, mix: 0.32 },
    pan: 0,
    width: 1
  },
  hat: {
    eq: { lowGainDb: -6, lowFreqHz: 500, highGainDb: 4, highFreqHz: 1e4 },
    delay: { timeMs: 187.5, feedback: 0.15, mix: 0.08, stereoOffsetMs: 8 },
    reverb: { roomSize: 0.3, decaySec: 0.8, damping: 0.9, mix: 0.05 },
    pan: 0.3,
    width: 0.4
  },
  openhat: {
    eq: { lowGainDb: -6, lowFreqHz: 500, highGainDb: 3, highFreqHz: 1e4 },
    delay: { timeMs: 375, feedback: 0.2, mix: 0.1, stereoOffsetMs: 10 },
    reverb: { roomSize: 0.3, decaySec: 0.9, damping: 0.85, mix: 0.06 },
    pan: -0.3,
    width: 0.5
  },
  snare: {
    eq: { lowGainDb: -4, lowFreqHz: 150, highGainDb: 1, highFreqHz: 2000 },
    delay: { timeMs: 250, feedback: 0.2, mix: 0.12, stereoOffsetMs: 10 },
    reverb: { roomSize: 0.5, decaySec: 2, damping: 0.6, mix: 0.18 },
    pan: 0,
    width: 0.5
  },
  shaker: {
    eq: { lowGainDb: -8, lowFreqHz: 1000, highGainDb: 3, highFreqHz: 12000 },
    delay: { timeMs: 0, feedback: 0, mix: 0, stereoOffsetMs: 0 },
    reverb: { roomSize: 0.2, decaySec: 0.6, damping: 0.95, mix: 0.03 },
    pan: 0.4,
    width: 0.3
  },
  pad: {
    eq: {
      lowGainDb: -6,
      lowFreqHz: 250,
      highGainDb: 2,
      highFreqHz: 5000,
      midGainDb: -1,
      midFreqHz: 400
    },
    delay: { timeMs: 500, feedback: 0.4, mix: 0.25, stereoOffsetMs: 20 },
    reverb: { roomSize: 0.7, decaySec: 3, damping: 0.5, mix: 0.35 },
    pan: 0,
    width: 1
  },
  riser: {
    eq: { lowGainDb: -3, lowFreqHz: 300, highGainDb: 2, highFreqHz: 1e4 },
    delay: { timeMs: 375, feedback: 0.3, mix: 0.2, stereoOffsetMs: 15 },
    reverb: { roomSize: 0.8, decaySec: 4, damping: 0.4, mix: 0.4 },
    pan: 0,
    width: 1
  },
  impact: {
    eq: { lowGainDb: 2, lowFreqHz: 60, highGainDb: 0, highFreqHz: 5000 },
    delay: { timeMs: 0, feedback: 0, mix: 0, stereoOffsetMs: 0 },
    reverb: { roomSize: 0.6, decaySec: 2.5, damping: 0.5, mix: 0.3 },
    pan: 0,
    width: 0.7
  },
  clap: {
    eq: { lowGainDb: -3, lowFreqHz: 200, highGainDb: 2, highFreqHz: 6000 },
    delay: { timeMs: 125, feedback: 0.1, mix: 0.06, stereoOffsetMs: 6 },
    reverb: { roomSize: 0.4, decaySec: 1.2, damping: 0.7, mix: 0.12 },
    pan: 0,
    width: 0.6
  },
  perc: {
    eq: { lowGainDb: -2, lowFreqHz: 300, highGainDb: 1, highFreqHz: 8000 },
    delay: { timeMs: 187.5, feedback: 0.15, mix: 0.07, stereoOffsetMs: 7 },
    reverb: { roomSize: 0.3, decaySec: 0.9, damping: 0.8, mix: 0.08 },
    pan: -0.25,
    width: 0.4
  }
};

// apps/web/src/lib/psy4/forensic/dsp.ts
var TANH_TABLE_SIZE = 4096;
var TANH_RANGE = 4;
var tanhTable = new Float32Array(TANH_TABLE_SIZE + 1);
for (let i = 0;i <= TANH_TABLE_SIZE; i++) {
  const x = i / TANH_TABLE_SIZE * 2 * TANH_RANGE - TANH_RANGE;
  tanhTable[i] = Math.tanh(x);
}
function fastTanh(x) {
  if (x >= TANH_RANGE)
    return 1;
  if (x <= -TANH_RANGE)
    return -1;
  const idx = (x + TANH_RANGE) / (2 * TANH_RANGE) * TANH_TABLE_SIZE;
  const i0 = idx | 0;
  const f = idx - i0;
  return tanhTable[i0] * (1 - f) + tanhTable[i0 + 1] * f;
}
function polyBlep(phase, inc) {
  const safeInc = Math.min(inc, 0.5);
  if (phase < safeInc) {
    const t = phase / safeInc;
    return 2 * t - t * t - 1;
  }
  if (phase > 1 - safeInc) {
    const t = (phase - 1) / safeInc;
    return t * t + 2 * t + 1;
  }
  return 0;
}
class OnePoleHP2 {
  v = 0;
  reset() {
    this.v = 0;
  }
  process(x, cutoff, sr) {
    const a = 1 / sr * 2 * Math.PI * cutoff;
    this.v += a * (x - this.v) / (1 + a);
    return x - this.v;
  }
}

class LR4Highpass {
  s1_1 = 0;
  s2_1 = 0;
  s1_2 = 0;
  s2_2 = 0;
  b0 = 0;
  b1 = 0;
  b2 = 0;
  a1 = 0;
  a2 = 0;
  lastCutoff = -1;
  reset() {
    this.s1_1 = 0;
    this.s2_1 = 0;
    this.s1_2 = 0;
    this.s2_2 = 0;
  }
  setCoeffs(cutoff, sr) {
    const omega = 2 * Math.PI * cutoff / sr;
    const cosOmega = Math.cos(omega);
    const sinOmega = Math.sin(omega);
    const q = Math.SQRT1_2;
    const alpha = sinOmega / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = (1 + cosOmega) / 2 / a0;
    this.b1 = -(1 + cosOmega) / a0;
    this.b2 = (1 + cosOmega) / 2 / a0;
    this.a1 = -2 * cosOmega / a0;
    this.a2 = (1 - alpha) / a0;
    this.lastCutoff = cutoff;
  }
  process(x, cutoff, sr) {
    if (Math.abs(cutoff - this.lastCutoff) > 0.5) {
      this.setCoeffs(cutoff, sr);
    }
    const y1 = this.b0 * x + this.s1_1;
    this.s1_1 = this.b1 * x - this.a1 * y1 + this.s2_1;
    this.s2_1 = this.b2 * x - this.a2 * y1;
    const y2 = this.b0 * y1 + this.s1_2;
    this.s1_2 = this.b1 * y1 - this.a1 * y2 + this.s2_2;
    this.s2_2 = this.b2 * y1 - this.a2 * y2;
    return y2;
  }
}

class PinkNoise {
  b = new Float32Array(7);
  rng;
  constructor(rng) {
    this.rng = rng;
  }
  reset() {
    this.b.fill(0);
  }
  next() {
    const w = this.rng.range(-1, 1);
    this.b[0] = 0.99886 * this.b[0] + w * 0.0555179;
    this.b[1] = 0.99332 * this.b[1] + w * 0.0750759;
    this.b[2] = 0.969 * this.b[2] + w * 0.153852;
    this.b[3] = 0.8665 * this.b[3] + w * 0.3104856;
    this.b[4] = 0.55 * this.b[4] + w * 0.5329522;
    this.b[5] = -0.7616 * this.b[5] - w * 0.016898;
    const p = this.b[0] + this.b[1] + this.b[2] + this.b[3] + this.b[4] + this.b[5] + this.b[6] + w * 0.5362;
    this.b[6] = w * 0.115926;
    return p * 0.11;
  }
  process() {
    return this.next();
  }
}
class BLSaw {
  phase = 0;
  freq = 220;
  setFreq(f) {
    this.freq = f;
  }
  process(inc) {
    const val = 2 * this.phase - 1;
    const corrected = val - polyBlep(this.phase, inc);
    this.phase += inc;
    if (this.phase >= 1)
      this.phase -= 1;
    return corrected;
  }
  reset() {
    this.phase = 0;
  }
}

class BLSquare {
  phase = 0;
  freq = 220;
  setFreq(f) {
    this.freq = f;
  }
  process(inc) {
    let val = this.phase < 0.5 ? 1 : -1;
    val += polyBlep(this.phase, inc);
    let p2 = this.phase + 0.5;
    if (p2 >= 1)
      p2 -= 1;
    val -= polyBlep(p2, inc);
    this.phase += inc;
    if (this.phase >= 1)
      this.phase -= 1;
    return val;
  }
  reset() {
    this.phase = 0;
  }
}

class BLTriangle {
  phase = 0;
  freq = 220;
  setFreq(f) {
    this.freq = f;
  }
  process(inc) {
    let val = 2 * Math.abs(2 * (this.phase - 0.5)) - 1;
    const inc2 = inc * 2;
    if (this.phase < inc2) {
      const t = this.phase / inc2;
      val += (2 * t - t * t - 1) * 0.5 * inc;
    } else if (this.phase > 1 - inc2) {
      const t = (this.phase - 1) / inc2;
      val += (t * t + 2 * t + 1) * 0.5 * inc;
    }
    this.phase += inc;
    if (this.phase >= 1)
      this.phase -= 1;
    return val;
  }
  reset() {
    this.phase = 0;
  }
}
class OversampledSaturation {
  x2 = 0;
  x1 = 0;
  process(x, drive) {
    const mid = -0.0625 * this.x2 + 0.5625 * this.x1 + 0.5 * x;
    const s1 = fastTanh(mid * drive);
    const s2 = fastTanh(x * drive);
    this.x2 = this.x1;
    this.x1 = x;
    return (s1 + s2) * 0.5;
  }
  reset() {
    this.x2 = 0;
    this.x1 = 0;
  }
}

// apps/web/src/lib/psy4/constants.ts
var DEFAULT_SR = 44100;

// apps/web/src/lib/psy4/forensic/mixing.ts
class BusProcessor {
  config;
  compEnv = 0;
  hpState = 0;
  drive;
  gain;
  constructor(config = {}) {
    this.config = {
      hpFreq: 0,
      compThr: 0,
      compRatio: 2,
      compAtt: 0.003,
      compRel: 0.1,
      compMakeup: 1.2,
      drive: 1,
      gain: 1,
      ...config
    };
    this.drive = this.config.drive;
    this.gain = this.config.gain;
  }
  process(sample, sr) {
    if (!Number.isFinite(sample))
      return 0;
    const dt = 1 / sr;
    let s = sample;
    if (this.config.hpFreq > 0) {
      const hpA = 1 / sr * 2 * Math.PI * this.config.hpFreq;
      this.hpState += hpA * (s - this.hpState) / (1 + hpA);
      s = s - this.hpState;
    }
    if (this.config.compThr > 0) {
      const abs = Math.abs(s);
      if (abs > this.compEnv) {
        this.compEnv += (abs - this.compEnv) * (dt / this.config.compAtt);
      } else {
        this.compEnv += (abs - this.compEnv) * (dt / this.config.compRel);
      }
      if (this.compEnv > this.config.compThr) {
        const over = this.compEnv - this.config.compThr;
        const reduction = over * (1 - 1 / this.config.compRatio);
        const compGain = (this.compEnv - reduction) / this.compEnv;
        s *= compGain;
      }
      s *= this.config.compMakeup;
    }
    if (this.drive > 1) {
      s = fastTanh(s * this.drive);
    }
    return s * this.gain;
  }
}

class MasterChain {
  gain = 1;
  ceiling = 0.9;
  env = 0;
  attack = 0.0003;
  release = 0.06;
  glueEnv = 0;
  glueThr = 0.6;
  glueRatio = 2.5;
  glueAttack = 0.004;
  glueRelease = 0.12;
  makeup = 1;
  process(sample, sr) {
    if (!Number.isFinite(sample))
      return 0;
    const dt = 1 / sr;
    const abs = Math.abs(sample);
    if (abs > this.glueEnv) {
      this.glueEnv += (abs - this.glueEnv) * (dt / this.glueAttack);
    } else {
      this.glueEnv += (abs - this.glueEnv) * (dt / this.glueRelease);
    }
    let glueGain = 1;
    if (this.glueEnv > this.glueThr) {
      const over = this.glueEnv - this.glueThr;
      const reduction = over * (1 - 1 / this.glueRatio);
      glueGain = (this.glueEnv - reduction) / this.glueEnv;
    }
    let s = sample * glueGain * this.makeup;
    s = fastTanh(s * 1.2) * 0.7 + s * 0.3;
    const absS = Math.abs(s);
    if (absS > this.env) {
      this.env += (absS - this.env) * (dt / this.attack);
    } else {
      this.env += (absS - this.env) * (dt / this.release);
    }
    let limGain = 1;
    if (this.env > this.ceiling) {
      limGain = this.ceiling / this.env;
    }
    s *= limGain * this.gain;
    return s;
  }
}
class StereoDelay {
  bufferSize = DEFAULT_SR * 2;
  leftBuf;
  rightBuf;
  leftIdx = 0;
  rightIdx = 0;
  leftDelay = 0.375;
  rightDelay = 0.281;
  feedback = 0.35;
  wet = 0.35;
  inputGain = 0.2;
  fbLP = [0, 0];
  constructor() {
    this.leftBuf = new Float32Array(this.bufferSize);
    this.rightBuf = new Float32Array(this.bufferSize);
  }
  setFeedback(fb) {
    this.feedback = fb;
  }
  setWet(wet) {
    this.wet = wet;
  }
  setInputGain(g) {
    this.inputGain = g;
  }
  process(leftIn, rightIn, sr) {
    const l = Number.isFinite(leftIn) ? leftIn : 0;
    const r = Number.isFinite(rightIn) ? rightIn : 0;
    const leftDelaySamples = Math.floor(this.leftDelay * sr);
    const rightDelaySamples = Math.floor(this.rightDelay * sr);
    const leftReadIdx = (this.leftIdx - leftDelaySamples + this.bufferSize) % this.bufferSize;
    const rightReadIdx = (this.rightIdx - rightDelaySamples + this.bufferSize) % this.bufferSize;
    const leftDelayed = this.leftBuf[leftReadIdx];
    const rightDelayed = this.rightBuf[rightReadIdx];
    const fbCutoff = 0.3;
    this.fbLP[0] = this.fbLP[0] + fbCutoff * (leftDelayed - this.fbLP[0]);
    this.fbLP[1] = this.fbLP[1] + fbCutoff * (rightDelayed - this.fbLP[1]);
    const leftWrite = l * this.inputGain + this.fbLP[1] * this.feedback;
    const rightWrite = r * this.inputGain + this.fbLP[0] * this.feedback;
    this.leftBuf[this.leftIdx] = leftWrite;
    this.rightBuf[this.rightIdx] = rightWrite;
    this.leftIdx = (this.leftIdx + 1) % this.bufferSize;
    this.rightIdx = (this.rightIdx + 1) % this.bufferSize;
    return [leftDelayed * this.wet, rightDelayed * this.wet];
  }
  reset() {
    this.leftBuf.fill(0);
    this.rightBuf.fill(0);
    this.fbLP.fill(0);
  }
}

// apps/web/src/lib/psy4/forensic/prng.ts
class Rng2 {
  state;
  constructor(seed) {
    this.state = seed >>> 0 || 1;
  }
  next() {
    this.state = this.state + 1831565813 >>> 0;
    let t = this.state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  range(min, max) {
    return min + this.next() * (max - min);
  }
  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }
  pick(arr) {
    return arr[this.int(0, arr.length - 1)];
  }
  chance(p) {
    return this.next() < p;
  }
}

// apps/web/src/lib/psy4/harmony.ts
var SCALE_INTERVALS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  naturalMinor: [0, 2, 3, 5, 7, 8, 10],
  pentatonicMajor: [0, 2, 4, 7, 9],
  pentatonicMinor: [0, 3, 5, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  phrygianDominant: [0, 1, 4, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10]
};
var CHORD_INTERVALS = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
  sus4: [0, 5, 7],
  power: [0, 7]
};
var NOTE_NAMES2 = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function midiToNoteName(midi) {
  const clamped = Math.max(0, Math.min(127, Math.floor(midi)));
  return NOTE_NAMES2[clamped % 12];
}
function buildScale(rootMidi, scaleType) {
  const intervals = SCALE_INTERVALS[scaleType];
  return intervals.map((i) => rootMidi + i);
}
function buildChord(rootMidi, chordType) {
  return CHORD_INTERVALS[chordType].map((i) => rootMidi + i);
}
function buildChordNamed(rootMidi, chordType) {
  const notes = buildChord(rootMidi, chordType);
  const rootName = midiToNoteName(rootMidi);
  const typeSuffix = {
    maj: "",
    min: "m",
    dim: "dim",
    aug: "aug",
    maj7: "maj7",
    min7: "m7",
    dom7: "7",
    sus4: "sus4",
    power: "5"
  };
  return { root: rootMidi, type: chordType, notes, name: rootName + typeSuffix[chordType] };
}
function diatonicChord(rootMidi, scaleType, degree) {
  const scale = buildScale(rootMidi, scaleType);
  const deg = degree % scale.length;
  const chordRoot = scale[deg];
  const third = scale[(deg + 2) % scale.length] - chordRoot;
  const fifth = scale[(deg + 4) % scale.length] - chordRoot;
  const seventh = scale[(deg + 6) % scale.length] - chordRoot;
  const normThird = (third % 12 + 12) % 12;
  const normFifth = (fifth % 12 + 12) % 12;
  const normSeventh = (seventh % 12 + 12) % 12;
  let type;
  if (normThird === 4 && normFifth === 7 && normSeventh === 11)
    type = "maj7";
  else if (normThird === 3 && normFifth === 7 && normSeventh === 10)
    type = "min7";
  else if (normThird === 3 && normFifth === 6)
    type = "dim";
  else if (normThird === 3 && normFifth === 7)
    type = "min";
  else
    type = "maj";
  return buildChordNamed(chordRoot, type);
}
function buildProgression(rootMidi, scaleType, degrees) {
  return degrees.map((deg) => diatonicChord(rootMidi, scaleType, deg));
}
var PSYTRANCE_PROGRESSIONS2 = {
  hypnotic: [0, 0, 0, 0],
  dark: [0, 1, 0, 1],
  uplifting: [0, 5, 3, 4],
  epic: [0, 3, 5, 4],
  classic: [0, 4, 5, 3],
  minor: [0, 5, 3, 4],
  "psy-dominant": [0, 1, 0, 6]
};

// apps/web/src/lib/psy4/humanizer.ts
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = state + 1831565813 >>> 0;
    let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function jitterVelocity(velocity, amount, random) {
  const clampedAmount = Math.max(0, Math.min(1, amount));
  const jitter = (random() * 2 - 1) * clampedAmount * 0.18;
  return Math.max(0.2, Math.min(1.6, velocity * (1 + jitter)));
}
function driftTime(amount, random) {
  const clampedAmount = Math.max(0, Math.min(1, amount));
  return (random() * 2 - 1) * clampedAmount * 0.018;
}

// apps/web/src/lib/psy4/modulation-matrix.ts
class ModulationMatrix {
  routes = [];
  lfoPhasesArr = new Float64Array(6);
  lfoRatesArr = Float64Array.from([0.3, 2, 5.5, 0.15, 0.1, 0.05]);
  lfoPhases = {
    lfo1: 0,
    lfo2: 0,
    lfo3: 0,
    lfo4: 0,
    lfo5: 0,
    lfo6: 0
  };
  lfoRates = {
    lfo1: 0.3,
    lfo2: 2,
    lfo3: 5.5,
    lfo4: 0.15,
    lfo5: 0.1,
    lfo6: 0.05
  };
  envValue = 0;
  velocity = 0.5;
  macros = {
    macro1: 0.5,
    macro2: 0.5,
    macro3: 0.5
  };
  addRoute(route) {
    this.routes.push(route);
  }
  setMacro(name, value) {
    this.macros[name] = Math.max(0, Math.min(1, value));
  }
  setVelocity(vel) {
    this.velocity = Math.max(0, Math.min(1, vel));
  }
  setEnvValue(value) {
    this.envValue = value;
  }
  tick(sampleRate) {
    const inv = 1 / sampleRate;
    for (let i = 0;i < 6; i++) {
      const next = this.lfoPhasesArr[i] + this.lfoRatesArr[i] * inv;
      this.lfoPhasesArr[i] = next >= 1 ? next - 1 : next;
    }
  }
  getSourceValue(source) {
    if (source === "lfo1" || source === "lfo2" || source === "lfo3" || source === "lfo4" || source === "lfo5" || source === "lfo6") {
      const idx = source.charCodeAt(3) - 49;
      const phase = this.lfoPhasesArr[idx] ?? 0;
      return Math.sin(2 * Math.PI * phase);
    }
    if (source === "env")
      return this.envValue;
    if (source === "velocity")
      return this.velocity;
    if (source === "macro1")
      return this.macros.macro1 * 2 - 1;
    if (source === "macro2")
      return this.macros.macro2 * 2 - 1;
    if (source === "macro3")
      return this.macros.macro3 * 2 - 1;
    return 0;
  }
  apply(params) {
    for (const route of this.routes) {
      const sourceValue = this.getSourceValue(route.source);
      const amount = route.amount;
      switch (route.destination) {
        case "pitch":
          if (params.pitch !== undefined)
            params.pitch *= 2 ** (sourceValue * amount * 0.1 / 12);
          break;
        case "cutoff":
          if (params.cutoff !== undefined)
            params.cutoff *= 1 + sourceValue * amount * 0.5;
          break;
        case "resonance":
          if (params.resonance !== undefined)
            params.resonance = Math.max(0, Math.min(1, params.resonance + sourceValue * amount * 0.3));
          break;
        case "fmIndex":
          if (params.fmIndex !== undefined)
            params.fmIndex *= 1 + sourceValue * amount * 0.5;
          break;
        case "amp":
          if (params.amp !== undefined)
            params.amp *= 1 + sourceValue * amount * 0.3;
          break;
        case "pan":
          if (params.pan !== undefined)
            params.pan += sourceValue * amount * 0.5;
          break;
        case "drive":
          if (params.drive !== undefined)
            params.drive *= 1 + sourceValue * amount * 0.5;
          break;
        case "delaySend":
          if (params.delaySend !== undefined)
            params.delaySend = Math.max(0, Math.min(1, params.delaySend + sourceValue * amount * 0.3));
          break;
        case "wavetablePos":
          if (params.wavetablePos !== undefined)
            params.wavetablePos = Math.max(0, Math.min(1, params.wavetablePos + sourceValue * amount * 0.5));
          break;
      }
    }
  }
  static createDefault() {
    const matrix = new ModulationMatrix;
    matrix.addRoute({ source: "lfo1", destination: "cutoff", amount: 0.5 });
    matrix.addRoute({ source: "lfo2", destination: "cutoff", amount: 0.7 });
    matrix.addRoute({ source: "lfo3", destination: "fmIndex", amount: 0.3 });
    matrix.addRoute({ source: "lfo4", destination: "cutoff", amount: 0.4 });
    matrix.addRoute({ source: "velocity", destination: "cutoff", amount: 0.5 });
    matrix.addRoute({ source: "macro1", destination: "delaySend", amount: 0.5 });
    matrix.addRoute({ source: "macro2", destination: "drive", amount: 0.5 });
    matrix.addRoute({ source: "macro3", destination: "resonance", amount: 0.3 });
    return matrix;
  }
}

// apps/web/src/lib/psy4/ms-processor.ts
class StereoWidener {
  width;
  monoSumEnergy = 0;
  stereoSumEnergy = 0;
  constructor(width = 1.3) {
    this.width = width;
  }
  setWidth(w) {
    this.width = w;
  }
  getWidth() {
    return this.width;
  }
  processBuffer(L, R) {
    const n = Math.min(L.length, R.length);
    const w = this.width;
    const monoFreq = 120;
    const a = 1 / DEFAULT_SR * 2 * Math.PI * monoFreq;
    const lpCoef = a / (1 + a);
    let lpStateL = 0;
    let lpStateR = 0;
    for (let i = 0;i < n; i++) {
      const l = L[i];
      const r = R[i];
      const sum = l + r;
      const diff = l - r;
      this.monoSumEnergy += sum * sum;
      this.stereoSumEnergy += diff * diff;
      const mid = sum * 0.5;
      const side = diff * 0.5;
      let outL = mid + w * side;
      let outR = mid - w * side;
      lpStateL += lpCoef * (outL - lpStateL);
      lpStateR += lpCoef * (outR - lpStateR);
      const monoLow = (lpStateL + lpStateR) * 0.5;
      outL = monoLow + (outL - lpStateL);
      outR = monoLow + (outR - lpStateR);
      L[i] = outL;
      R[i] = outR;
    }
  }
  getMonoCompatibility() {
    const total = this.monoSumEnergy + this.stereoSumEnergy;
    if (total < 0.000000000001)
      return 1;
    return this.monoSumEnergy / total;
  }
  static measureWidth(L, R) {
    const n = Math.min(L.length, R.length);
    if (n === 0)
      return 0;
    let sumDiff = 0;
    let sumSum = 0;
    for (let i = 0;i < n; i++) {
      sumDiff += Math.abs(L[i] - R[i]);
      sumSum += Math.abs(L[i] + R[i]);
    }
    if (sumSum < 0.000000000001)
      return 2;
    const ratio = sumDiff / sumSum;
    return Math.min(ratio, 2);
  }
  reset() {
    this.monoSumEnergy = 0;
    this.stereoSumEnergy = 0;
  }
}

// apps/web/src/lib/psy4/physical/waveguide-string.ts
class WaveguideString {
  delayLine;
  writePos = 0;
  delayLength = 0;
  damping = 0.5;
  active = false;
  amp = 0;
  SR = DEFAULT_SR;
  constructor() {
    this.delayLine = new Float32Array(4410);
  }
  trigger(freq, amp, damping = 0.5) {
    this.delayLength = Math.max(2, Math.floor(this.SR / freq));
    if (this.delayLength > this.delayLine.length) {
      this.delayLine = new Float32Array(this.delayLength + 10);
    }
    for (let i = 0;i < this.delayLength; i++) {
      this.delayLine[i] = (Math.random() - 0.5) * 2;
    }
    this.writePos = 0;
    this.damping = damping;
    this.amp = amp;
    this.active = true;
  }
  triggerDeterministic(freq, amp, damping, rng) {
    this.delayLength = Math.max(2, Math.floor(this.SR / freq));
    if (this.delayLength > this.delayLine.length) {
      this.delayLine = new Float32Array(this.delayLength + 10);
    }
    for (let i = 0;i < this.delayLength; i++) {
      this.delayLine[i] = (rng.next() - 0.5) * 2;
    }
    this.writePos = 0;
    this.damping = damping;
    this.amp = amp;
    this.active = true;
  }
  render() {
    if (!this.active)
      return 0;
    const readPos = this.writePos;
    const current = this.delayLine[readPos] ?? 0;
    const nextIdx = (readPos + 1) % this.delayLength;
    const next = this.delayLine[nextIdx] ?? 0;
    const damped = current * (1 - this.damping * 0.5) + next * (this.damping * 0.5);
    this.delayLine[this.writePos] = damped;
    this.writePos = nextIdx;
    this.amp *= 0.9996;
    if (this.amp < 0.001)
      this.active = false;
    return current * this.amp;
  }
  noteOff() {
    this.amp *= 0.5;
  }
  reset() {
    this.active = false;
    this.amp = 0;
  }
}

// apps/web/src/lib/psy4/granular.ts
class GrainCloud {
  grains = [];
  buffer;
  density = 50;
  grainDurMs = 50;
  pitchVar = 0.1;
  posVar = 0.5;
  rng;
  sampleCount = 0;
  samplesPerGrain;
  constructor(buffer, rng) {
    this.buffer = buffer;
    this.rng = rng;
    this.samplesPerGrain = Math.floor(DEFAULT_SR / this.density);
  }
  setDensity(d) {
    this.density = d;
    this.samplesPerGrain = Math.floor(DEFAULT_SR / d);
  }
  setGrainDuration(ms) {
    this.grainDurMs = ms;
  }
  setPitchVar(v) {
    this.pitchVar = v;
  }
  setPosVar(v) {
    this.posVar = v;
  }
  setAmp(a) {
    this.amp = a;
  }
  setBuffer(buf) {
    this.buffer = buf;
    this.reset();
  }
  amp = 1;
  spawnGrain() {
    const grainDur = Math.floor(DEFAULT_SR * this.grainDurMs / 1000);
    const posRange = this.buffer.length - grainDur - 1;
    const basePos = this.rng.range(0, Math.max(1, posRange));
    this.grains.push({
      pos: basePos,
      pitch: 1 + this.rng.range(-this.pitchVar, this.pitchVar),
      pan: this.rng.range(-1, 1),
      dur: grainDur,
      age: 0
    });
  }
  process() {
    this.sampleCount++;
    if (this.sampleCount >= this.samplesPerGrain) {
      this.spawnGrain();
      this.sampleCount = 0;
    }
    let outL = 0;
    let outR = 0;
    for (let i = this.grains.length - 1;i >= 0; i--) {
      const g = this.grains[i];
      if (g.age >= g.dur) {
        this.grains.splice(i, 1);
        continue;
      }
      const samplePos = Math.floor(g.pos + g.age * g.pitch);
      const sample = this.buffer[samplePos % this.buffer.length] ?? 0;
      const env = 0.5 * (1 - Math.cos(2 * Math.PI * g.age / g.dur));
      const panAngle = (g.pan + 1) * 0.25 * Math.PI;
      const panL = Math.cos(panAngle);
      const panR = Math.sin(panAngle);
      outL += sample * env * panL * this.amp;
      outR += sample * env * panR * this.amp;
      g.age++;
    }
    return [outL, outR];
  }
  reset() {
    this.grains = [];
    this.sampleCount = 0;
  }
  get activeGrains() {
    return this.grains.length;
  }
  static generateNoiseBuffer(rng, durationSec) {
    const len = Math.floor(DEFAULT_SR * durationSec);
    const buf = new Float32Array(len);
    let last = 0;
    for (let i = 0;i < len; i++) {
      const white = rng.range(-1, 1);
      last = last * 0.95 + white * 0.05;
      buf[i] = last * 10;
    }
    return buf;
  }
  static generateSawBuffer(freq, durationSec) {
    const len = Math.floor(DEFAULT_SR * durationSec);
    const buf = new Float32Array(len);
    const period = DEFAULT_SR / freq;
    for (let i = 0;i < len; i++) {
      const phase = i % period / period;
      buf[i] = 2 * phase - 1;
    }
    return buf;
  }
  static generateMixedBuffer(rng, freq, durationSec, noiseLevel = 0.5) {
    const len = Math.floor(DEFAULT_SR * durationSec);
    const buf = new Float32Array(len);
    const period = DEFAULT_SR / freq;
    let noiseState = 0;
    for (let i = 0;i < len; i++) {
      const phase = i % period / period;
      const saw = 2 * phase - 1;
      const white = rng.range(-1, 1);
      noiseState = noiseState * 0.95 + white * 0.05;
      buf[i] = saw * (1 - noiseLevel) + noiseState * 3 * noiseLevel;
    }
    return buf;
  }
}

// apps/web/src/lib/psy4/voice-specs.ts
var KICK_SPEC = {
  fundamental: 50,
  subDecay: 0.65,
  subLevel: 1,
  midDecay: 0.05,
  midLevel: 0.5,
  midFreq: 150,
  clickDecay: 0.002,
  clickLevel: 0.35,
  pitchStart: 200,
  pitchDecay: 0.012,
  saturation: 1.8,
  hpFreq: 30
};
var BASS_SPEC = {
  mode: "pluck",
  subLevel: 0.3,
  bodyLevel: 0.7,
  characterLevel: 0.2,
  cutoffStart: 1200,
  cutoffEnd: 150,
  res: 0.3,
  pluckDecay: 0.12,
  sustainLevel: 0.6,
  sustainRelease: 0.004,
  hpFreq: 40,
  saturation: 2,
  sidechainDepth: 0.75
};
var LEAD_SPEC = {
  oscCount: 2,
  detune: 12,
  octaveLevel: 0.6,
  octaveDetune: 7,
  airLevel: 0.18,
  airDecay: 0.15,
  fmLevel: 0.35,
  fmRatio: 2,
  fmIndex: 180,
  cutoff: 9000,
  res: 0.7,
  filterEnvAmount: 5,
  filterEnvDecay: 0.25,
  lfoRate: 2,
  lfoDepth: 1,
  saturation: 2,
  delaySend: 0.25,
  reverbSend: 0.25,
  hpFreq: 80,
  gain: 0.6
};
var PAD_SPEC = {
  oscCount: 3,
  detune: 7,
  octaveOsc: true,
  chorusDepth: 0.7,
  chorusRate: 0.3,
  shimmerLevel: 0.4,
  cutoff: 600,
  res: 0.3,
  filterLfoRate: 0.15,
  filterLfoDepth: 0.6,
  saturation: 1,
  reverbSend: 0.4,
  hpFreq: 80,
  attack: 0.3,
  release: 0.4,
  gain: 0.4
};
var ACID_SPEC = {
  waveType: "square",
  cutoff: 800,
  res: 0.85,
  lfoRate: 2,
  lfoDepth: 0.7,
  envAmount: 2,
  envDecay: 0.12,
  distortion: 3,
  hpFreq: 100,
  gain: 0.3
};
var HAT_SPEC = {
  metallicFreqs: [540, 800, 1080, 1360, 1700, 2400],
  bpFreq: 12000,
  bpRes: 0.5,
  hpFreq: 6000,
  closedDecay: 0.04,
  openDecay: 0.18,
  pitchVar: 0.02,
  panVar: 0.1,
  gain: 1.2
};
var SNARE_SPEC = {
  tone1Freq: 180,
  tone2Freq: 330,
  toneDecay: 0.05,
  noiseBpFreq: 1800,
  noiseBpRes: 0.7,
  noiseHpFreq: 1000,
  noiseDecay: 0.08,
  gain: 0.4
};
var BUS_GAINS = {
  drum: 0.8,
  bass: 0.35,
  music: 1.2,
  fx: 1
};
var MASTER_SPEC = {
  hpFreq: 25,
  mbLowXover: 180,
  mbHighXover: 3500,
  mbLowThr: 0.3,
  mbMidThr: 0.2,
  mbHighThr: 0.25,
  glueThr: 0.8,
  glueRatio: 1.5,
  glueAttack: 0.01,
  glueRelease: 0.2,
  glueMakeup: 1,
  satDrive: 1,
  satMix: 0.1,
  stereoWidth: 1.3,
  monoBelowHz: 120,
  ceiling: 0.95,
  targetLufs: -9
};

// apps/web/src/lib/psy4/psy-voices.ts
class PsyKick {
  active = false;
  t = 0;
  phase = 0;
  subPhase = 0;
  midPhase = 0;
  clickHPState = 0;
  sat = new OversampledSaturation;
  noise;
  amp = 1;
  fund = KICK_SPEC.fundamental;
  decay = KICK_SPEC.subDecay;
  constructor(rng) {
    this.noise = new PinkNoise(rng);
  }
  trigger(amp, fund, decay) {
    this.active = true;
    this.t = 0;
    this.phase = 0;
    this.subPhase = 0;
    this.midPhase = 0;
    this.clickHPState = 0;
    this.noise.reset();
    this.sat.reset();
    this.amp = amp;
    this.fund = fund || KICK_SPEC.fundamental;
    this.decay = decay || KICK_SPEC.subDecay;
  }
  render() {
    if (!this.active)
      return [0, true];
    this.t += 1 / DEFAULT_SR;
    const decayTotal = KICK_SPEC.subDecay + 0.05;
    if (this.t > decayTotal) {
      this.active = false;
      return [0, true];
    }
    const t = this.t;
    const f0 = this.fund;
    this.subPhase += 2 * Math.PI * f0 / DEFAULT_SR;
    const subEnv = Math.exp(-t / KICK_SPEC.subDecay);
    const sub = Math.sin(this.subPhase + Math.PI / 2) * subEnv * KICK_SPEC.subLevel;
    const pitchStart = KICK_SPEC.pitchStart;
    const pitchEnd = f0;
    const currentFreq = (pitchStart - pitchEnd) * Math.exp(-t / KICK_SPEC.pitchDecay) + pitchEnd;
    this.midPhase += 2 * Math.PI * currentFreq / DEFAULT_SR;
    const midEnv = Math.exp(-t / KICK_SPEC.midDecay);
    const midTri = 2 * Math.abs(2 * (this.midPhase % 1) - 1) - 1;
    const mid = midTri * midEnv * KICK_SPEC.midLevel;
    const n = this.noise.next();
    const clickEnv = Math.exp(-t / KICK_SPEC.clickDecay);
    const hpOut = n - this.clickHPState;
    this.clickHPState = this.clickHPState + 0.95 * (n - this.clickHPState);
    const velToTimbre = 0.5 + this.amp * 1;
    const click = hpOut * clickEnv * KICK_SPEC.clickLevel * velToTimbre;
    let sample = this.sat.process(sub + mid, KICK_SPEC.saturation);
    sample += click;
    sample *= this.amp;
    return [sample, false];
  }
}

class PsyBass {
  active = false;
  t = 0;
  freq = 80;
  amp = 0.5;
  releasing = false;
  releaseT = 0;
  noteOffTime = 0;
  mode = BASS_SPEC.mode;
  waveguide = null;
  waveguideLevel = 0.3;
  waveguideDamping = 0.5;
  _rng;
  subPhase = 0;
  saw1 = new BLSaw;
  saw2 = new BLSaw;
  filter = new ZDFSVF;
  charSquare = new BLSquare;
  charFilter = new ZDFSVF;
  sat = new OversampledSaturation;
  hp = new LR4Highpass;
  midScoop = new ZDFSVF;
  constructor(rng) {
    this._rng = rng ?? new Rng2(1);
  }
  trigger(freq, dur, amp) {
    this.active = true;
    this.t = 0;
    this.freq = freq;
    this.amp = amp;
    this.releasing = false;
    this.releaseT = 0;
    this.noteOffTime = dur;
    this.subPhase = 0;
    this.saw1.reset();
    this.saw1.setFreq(freq);
    this.saw2.reset();
    this.saw2.setFreq(freq * 2 ** (5 / 1200));
    this.charSquare.reset();
    this.charSquare.setFreq(freq * 2);
    this.filter.reset();
    this.charFilter.reset();
    this.midScoop.reset();
    this.hp.reset();
    this.sat.reset();
    if (this.waveguide) {
      this.waveguide.triggerDeterministic(freq, 1, this.waveguideDamping, this._rng);
    }
  }
  setWaveguide(wg) {
    this.waveguide = wg;
  }
  setWaveguideLevel(level) {
    this.waveguideLevel = Math.max(0, Math.min(1, level));
  }
  setWaveguideDamping(damping) {
    this.waveguideDamping = Math.max(0, Math.min(1, damping));
  }
  setMode(mode) {
    this.mode = mode;
  }
  noteOff() {
    this.releasing = true;
    this.releaseT = 0;
    if (this.waveguide)
      this.waveguide.noteOff();
  }
  render() {
    if (!this.active)
      return [0, true];
    this.t += 1 / DEFAULT_SR;
    if (this.releasing) {
      this.releaseT += 1 / DEFAULT_SR;
      if (this.releaseT > BASS_SPEC.sustainRelease) {
        this.active = false;
        return [0, true];
      }
    }
    this.subPhase += 2 * Math.PI * this.freq * 0.5 / DEFAULT_SR;
    const sub = Math.sin(this.subPhase) * BASS_SPEC.subLevel;
    const inc = this.freq / DEFAULT_SR;
    const sawOut1 = this.saw1.process(inc);
    const sawOut2 = this.saw2.process(this.freq * 2 ** (5 / 1200) / DEFAULT_SR);
    const sawOut = (sawOut1 + sawOut2) * 0.5;
    const cutoffEnv = (BASS_SPEC.cutoffStart - BASS_SPEC.cutoffEnd) * Math.exp(-this.t / 0.03) + BASS_SPEC.cutoffEnd;
    const filtered = this.filter.process(sawOut, cutoffEnv, BASS_SPEC.res, DEFAULT_SR, 0);
    const charOut = this.charSquare.process(this.freq * 2 / DEFAULT_SR);
    const charFiltered = this.charFilter.process(charOut, 400, 0.7, DEFAULT_SR, 1) * BASS_SPEC.characterLevel;
    let mixed = sub + filtered * BASS_SPEC.bodyLevel + charFiltered;
    if (this.waveguide && this.waveguideLevel > 0) {
      const wgSig = this.waveguide.render() * this.waveguideLevel;
      mixed += wgSig;
    }
    const scoopSig = this.midScoop.process(mixed, 300, 0.6, DEFAULT_SR, 1);
    mixed = mixed - scoopSig * 0.5;
    mixed = this.sat.process(mixed, BASS_SPEC.saturation);
    mixed = this.hp.process(mixed, BASS_SPEC.hpFreq, DEFAULT_SR);
    const attackEnv = Math.min(1, this.t / 0.0005);
    let ampEnv;
    if (this.mode === "pluck") {
      ampEnv = attackEnv * Math.exp(-this.t / BASS_SPEC.pluckDecay);
    } else {
      const decayEnv = Math.exp(-this.t / 0.05);
      ampEnv = attackEnv * (BASS_SPEC.sustainLevel + (1 - BASS_SPEC.sustainLevel) * decayEnv);
    }
    if (this.releasing) {
      ampEnv *= Math.exp(-this.releaseT / 0.003);
    }
    return [mixed * ampEnv * this.amp, false];
  }
}

class PsyLead {
  active = false;
  t = 0;
  freq = 440;
  amp = 0.5;
  dur = 0.3;
  releasing = false;
  releaseT = 0;
  noteOffTime = 0;
  matrix = null;
  _modParams = {};
  wavetable = null;
  wavetablePos = 0.5;
  ddsp = null;
  pCutoff = LEAD_SPEC.cutoff;
  pDetune = LEAD_SPEC.detune;
  pRes = LEAD_SPEC.res;
  pLfoRate = LEAD_SPEC.lfoRate;
  pLfoDepth = LEAD_SPEC.lfoDepth;
  saw1 = new BLSaw;
  saw2 = new BLSaw;
  octSaw1 = new BLSaw;
  octSaw2 = new BLSaw;
  noise;
  airHP = new OnePoleHP2;
  carPhase = 0;
  modPhase = 0;
  harmSaw = new BLSaw;
  harmFilter = new ZDFSVF;
  filter = new ZDFSVF;
  sat = new OversampledSaturation;
  constructor(rng) {
    this.noise = new PinkNoise(rng);
  }
  setModulationMatrix(m) {
    this.matrix = m;
  }
  setWavetable(wt) {
    this.wavetable = wt;
  }
  setWavetablePosition(pos) {
    this.wavetablePos = Math.max(0, Math.min(1, pos));
  }
  setDDSP(synth) {
    this.ddsp = synth;
    if (synth) {
      synth.setPreset("psyLead");
    }
  }
  trigger(freq, dur, amp, params) {
    this.active = true;
    this.t = 0;
    this.freq = freq;
    this.dur = dur;
    this.amp = amp * LEAD_SPEC.gain;
    this.releasing = false;
    this.releaseT = 0;
    this.noteOffTime = dur;
    this.carPhase = 0;
    this.modPhase = 0;
    this.pCutoff = params?.cutoff ?? LEAD_SPEC.cutoff;
    this.pDetune = params?.detune ?? LEAD_SPEC.detune;
    this.pRes = params?.res ?? LEAD_SPEC.res;
    this.pLfoRate = params?.lfoRate ?? LEAD_SPEC.lfoRate;
    this.pLfoDepth = params?.lfoDepth ?? LEAD_SPEC.lfoDepth;
    this.saw1.reset();
    this.saw1.setFreq(freq * 2 ** (-this.pDetune / 1200));
    this.saw2.reset();
    this.saw2.setFreq(freq * 2 ** (this.pDetune / 1200));
    this.octSaw1.reset();
    this.octSaw1.setFreq(freq * 2 * 2 ** (-LEAD_SPEC.octaveDetune / 1200));
    this.octSaw2.reset();
    this.octSaw2.setFreq(freq * 2 * 2 ** (LEAD_SPEC.octaveDetune / 1200));
    this.harmSaw.reset();
    this.harmSaw.setFreq(freq * 4);
    this.noise.reset();
    this.airHP.reset();
    this.harmFilter.reset();
    this.filter.reset();
    this.sat.reset();
    if (this.wavetable) {
      this.wavetable.reset();
      this.wavetable.setFreq(freq);
    }
  }
  noteOff() {
    this.releasing = true;
    this.releaseT = 0;
  }
  render() {
    if (!this.active)
      return [0, true];
    this.t += 1 / DEFAULT_SR;
    if (this.releasing) {
      this.releaseT += 1 / DEFAULT_SR;
      if (this.releaseT > 0.05) {
        this.active = false;
        return [0, true];
      }
    }
    const attackEnv = Math.min(1, this.t / 0.001);
    let fundSig;
    if (this.ddsp) {
      this.ddsp.setFreq(this.freq);
      this.ddsp.setAmplitude(this.amp);
      fundSig = this.ddsp.process();
    } else if (this.wavetable) {
      const inc = this.freq / DEFAULT_SR;
      fundSig = this.wavetable.process(inc);
    } else {
      fundSig = (this.saw1.process(this.freq * 2 ** (-this.pDetune / 1200) / DEFAULT_SR) + this.saw2.process(this.freq * 2 ** (this.pDetune / 1200) / DEFAULT_SR)) * 0.5;
    }
    const octSig = (this.octSaw1.process(this.freq * 2 * 2 ** (-LEAD_SPEC.octaveDetune / 1200) / DEFAULT_SR) + this.octSaw2.process(this.freq * 2 * 2 ** (LEAD_SPEC.octaveDetune / 1200) / DEFAULT_SR)) * 0.5 * LEAD_SPEC.octaveLevel;
    const n = this.noise.next();
    const airSig = this.airHP.process(n, 8000, DEFAULT_SR) * LEAD_SPEC.airLevel * Math.exp(-this.t / LEAD_SPEC.airDecay);
    const modEnv = Math.exp(-this.t / 0.08);
    let currentModIndex = LEAD_SPEC.fmIndex * (0.3 + 0.7 * modEnv);
    this.modPhase += this.freq * LEAD_SPEC.fmRatio / DEFAULT_SR;
    if (this.modPhase >= 1)
      this.modPhase -= 1;
    let signal = fundSig + octSig + airSig;
    const filterEnv = Math.exp(-this.t / LEAD_SPEC.filterEnvDecay) * LEAD_SPEC.filterEnvAmount;
    let cutoff;
    let drive = LEAD_SPEC.saturation;
    if (this.matrix) {
      this.matrix.setEnvValue(modEnv);
      this.matrix.setVelocity(this.amp);
      this._modParams.cutoff = this.pCutoff * (1 + filterEnv);
      this._modParams.fmIndex = currentModIndex;
      this._modParams.amp = 1;
      this._modParams.drive = drive;
      this._modParams.delaySend = 0;
      this._modParams.wavetablePos = this.wavetablePos;
      this.matrix.apply(this._modParams);
      cutoff = Math.max(200, this._modParams.cutoff ?? this.pCutoff);
      currentModIndex = this._modParams.fmIndex ?? currentModIndex;
      drive = this._modParams.drive ?? drive;
      if (this.wavetable && this._modParams.wavetablePos !== undefined) {
        this.wavetable.setPosition(this._modParams.wavetablePos);
      }
    } else {
      const lfo1 = Math.sin(2 * Math.PI * this.pLfoRate * this.t) * this.pLfoDepth;
      const lfo2 = Math.sin(2 * Math.PI * 5.5 * this.t) * 0.15;
      cutoff = Math.max(200, this.pCutoff * (1 + filterEnv + lfo1 + lfo2));
      if (this.wavetable)
        this.wavetable.setPosition(this.wavetablePos);
    }
    const modSig = Math.sin(2 * Math.PI * this.modPhase) * currentModIndex;
    this.carPhase += (this.freq + modSig) / DEFAULT_SR;
    if (this.carPhase >= 1)
      this.carPhase -= 1;
    const fmSig = Math.sin(2 * Math.PI * this.carPhase) * LEAD_SPEC.fmLevel;
    signal = signal + fmSig;
    const filtered = this.filter.process(signal, cutoff, this.pRes, DEFAULT_SR, 0);
    let out = this.sat.process(filtered, drive);
    const harmRaw = this.harmSaw.process(this.freq * 4 / DEFAULT_SR);
    const harmBP = this.harmFilter.process(harmRaw, 8000, 0.7, DEFAULT_SR, 1);
    const harmSig = harmBP * 1 * attackEnv;
    out += harmSig;
    let ampEnv = attackEnv;
    if (this.releasing) {
      ampEnv = attackEnv * Math.exp(-this.releaseT / 0.02);
    }
    return [out * ampEnv * this.amp, false];
  }
}

class PsyHat {
  active = false;
  t = 0;
  amp = 0.5;
  open = false;
  decay = 0.03;
  phases = new Float64Array(6);
  freqs = [540, 800, 1080, 1360, 1700, 2400];
  bp = new ZDFSVF;
  hp = new OnePoleHP2;
  sparkleNoise;
  sparkleHP = new OnePoleHP2;
  rng;
  pitchMul = 1;
  decayMul = 1;
  constructor(rng) {
    this.rng = rng;
    this.sparkleNoise = new PinkNoise(rng);
  }
  trigger(amp, open = false) {
    this.active = true;
    this.t = 0;
    this.amp = amp;
    this.open = open;
    this.pitchMul = 1 + this.rng.range(-1, 1) * HAT_SPEC.pitchVar;
    this.decayMul = 1 + this.rng.range(-1, 1) * 0.1;
    this.decay = (open ? 0.18 : 0.04) * this.decayMul;
    this.phases.fill(0);
    this.bp.reset();
    this.hp.reset();
    this.sparkleNoise.reset();
    this.sparkleHP.reset();
  }
  render() {
    if (!this.active)
      return [0, true];
    this.t += 1 / DEFAULT_SR;
    if (this.t > this.decay * 2) {
      this.active = false;
      return [0, true];
    }
    let metallic = 0;
    for (let i = 0;i < 6; i++) {
      this.phases[i] = (this.phases[i] + this.freqs[i] * this.pitchMul / DEFAULT_SR) % 1;
      metallic += this.phases[i] < 0.5 ? 1 : -1;
    }
    metallic /= 6;
    const bpOut = this.bp.process(metallic, 12000, 0.5, DEFAULT_SR, 1);
    const hpOut = this.hp.process(bpOut, 6000, DEFAULT_SR);
    const sparkleN = this.sparkleNoise.next();
    const sparkleSig = this.sparkleHP.process(sparkleN, 12000, DEFAULT_SR) * 1;
    const env = Math.exp(-this.t / this.decay);
    return [(hpOut + sparkleSig) * env * this.amp * 1.5, false];
  }
}

class PsySample {
  active = false;
  pos = 0;
  data = null;
  sampleRate = DEFAULT_SR;
  amp = 1;
  playbackRate = 1;
  setData(data, sampleRate) {
    this.data = data;
    this.sampleRate = sampleRate;
  }
  trigger(amp) {
    this.active = true;
    this.pos = 0;
    this.amp = amp;
    this.playbackRate = this.sampleRate / DEFAULT_SR;
  }
  render() {
    if (!this.active || !this.data)
      return [0, true];
    const idx = Math.floor(this.pos);
    if (idx >= this.data.length) {
      this.active = false;
      return [0, true];
    }
    const sample = (this.data[idx] ?? 0) * this.amp;
    this.pos += this.playbackRate;
    return [sample, false];
  }
}

class PsySnare {
  active = false;
  t = 0;
  amp = 0.5;
  noise;
  tone1Phase = 0;
  tone2Phase = 0;
  freq1 = SNARE_SPEC.tone1Freq;
  freq2 = SNARE_SPEC.tone2Freq;
  noiseBP = new ZDFSVF;
  noiseHP = new OnePoleHP2;
  rng;
  toneVar = 1;
  constructor(rng) {
    this.noise = new PinkNoise(rng);
    this.rng = rng;
  }
  trigger(amp) {
    this.active = true;
    this.t = 0;
    this.amp = amp;
    this.toneVar = 1 + this.rng.range(-1, 1) * 0.05;
    this.tone1Phase = 0;
    this.tone2Phase = 0;
    this.noise.reset();
    this.noiseBP.reset();
    this.noiseHP.reset();
  }
  render() {
    if (!this.active)
      return [0, true];
    this.t += 1 / DEFAULT_SR;
    if (this.t > 0.2) {
      this.active = false;
      return [0, true];
    }
    const n = this.noise.next();
    const bpOut = this.noiseBP.process(n, 1800, 0.7, DEFAULT_SR, 1);
    const hpOut = this.noiseHP.process(bpOut, 1000, DEFAULT_SR);
    const noiseEnv = Math.exp(-this.t / 0.08);
    const noiseOut = hpOut * noiseEnv * 0.7;
    this.tone1Phase += 2 * Math.PI * this.freq1 * this.toneVar / DEFAULT_SR;
    this.tone2Phase += 2 * Math.PI * this.freq2 * this.toneVar / DEFAULT_SR;
    const toneEnv = Math.exp(-this.t / 0.05);
    const toneOut = (Math.sin(this.tone1Phase) * 0.5 + Math.sin(this.tone2Phase) * 0.4) * toneEnv * 0.4;
    return [(noiseOut + toneOut) * this.amp, false];
  }
}

class PsySubBass {
  active = false;
  t = 0;
  phase = 0;
  freq = 50;
  amp = 0.3;
  releasing = false;
  releaseT = 0;
  trigger(freq, _dur, amp) {
    this.active = true;
    this.t = 0;
    this.phase = 0;
    this.freq = freq;
    this.amp = amp;
    this.releasing = false;
    this.releaseT = 0;
  }
  noteOff() {
    this.releasing = true;
    this.releaseT = 0;
  }
  render() {
    if (!this.active)
      return [0, true];
    this.t += 1 / DEFAULT_SR;
    if (this.releasing) {
      this.releaseT += 1 / DEFAULT_SR;
      if (this.releaseT > 0.1) {
        this.active = false;
        return [0, true];
      }
    }
    this.phase += 2 * Math.PI * this.freq / DEFAULT_SR;
    const attackEnv = Math.min(1, this.t / 0.02);
    let ampEnv = attackEnv;
    if (this.releasing)
      ampEnv = attackEnv * Math.exp(-this.releaseT / 0.05);
    return [Math.sin(this.phase) * ampEnv * this.amp, false];
  }
}

class PsyPad {
  active = false;
  t = 0;
  amp = PAD_SPEC.gain;
  releasing = false;
  releaseT = 0;
  saws;
  triOct;
  chorusBuf;
  chorusPos = 0;
  chorusDelay = 882;
  shimmerPhase = 0;
  filter = new ZDFSVF;
  sat = new OversampledSaturation;
  constructor(_rng) {
    this.saws = [new BLSaw, new BLSaw];
    this.triOct = new BLTriangle;
    this.chorusBuf = new Float32Array(this.chorusDelay);
  }
  trigger(freqs, _dur, amp) {
    this.active = true;
    this.t = 0;
    this.amp = amp * PAD_SPEC.gain;
    this.releasing = false;
    this.releaseT = 0;
    this.saws[0].reset();
    this.saws[0].setFreq(freqs[0] * 2 ** (-PAD_SPEC.detune / 1200));
    this.saws[1].reset();
    this.saws[1].setFreq(freqs[1] ?? freqs[0] * 2 ** (PAD_SPEC.detune / 1200));
    this.triOct.reset();
    this.triOct.setFreq((freqs[2] ?? freqs[0]) * 2);
    this.chorusBuf.fill(0);
    this.chorusPos = 0;
    this.shimmerPhase = 0;
    this.filter.reset();
    this.sat.reset();
  }
  noteOff() {
    this.releasing = true;
    this.releaseT = 0;
  }
  render() {
    if (!this.active)
      return [0, true];
    this.t += 1 / DEFAULT_SR;
    if (this.releasing) {
      this.releaseT += 1 / DEFAULT_SR;
      if (this.releaseT > PAD_SPEC.release) {
        this.active = false;
        return [0, true];
      }
    }
    const saw1 = this.saws[0].process(this.saws[0].freq / DEFAULT_SR);
    const saw2 = this.saws[1].process(this.saws[1].freq / DEFAULT_SR);
    const sawSig = (saw1 + saw2) * 0.35;
    const triSig = this.triOct.process(this.triOct.freq / DEFAULT_SR) * 0.2;
    const inputSig = sawSig + triSig;
    const chorusLfo = Math.sin(2 * Math.PI * PAD_SPEC.chorusRate * this.t) * PAD_SPEC.chorusDepth;
    const chorusReadPos = (this.chorusPos - Math.floor(this.chorusDelay * (1 + chorusLfo * 0.1)) + this.chorusDelay) % this.chorusDelay;
    const chorusSig = this.chorusBuf[chorusReadPos] * 0.3;
    this.chorusBuf[this.chorusPos] = inputSig;
    this.chorusPos = (this.chorusPos + 1) % this.chorusDelay;
    this.shimmerPhase += this.triOct.freq * 2 / DEFAULT_SR;
    if (this.shimmerPhase >= 1)
      this.shimmerPhase -= 1;
    const shimmerSig = (2 * Math.abs(2 * this.shimmerPhase - 1) - 1) * PAD_SPEC.shimmerLevel * 0.3;
    const signal = inputSig + chorusSig + shimmerSig;
    const lfo1 = Math.sin(2 * Math.PI * PAD_SPEC.filterLfoRate * this.t) * PAD_SPEC.filterLfoDepth;
    const lfo2 = Math.sin(2 * Math.PI * 0.23 * this.t) * 0.2;
    const cutoff = Math.max(200, PAD_SPEC.cutoff * (1 + lfo1 + lfo2));
    const filtered = this.filter.process(signal, cutoff, PAD_SPEC.res, DEFAULT_SR, 0);
    const out = this.sat.process(filtered, PAD_SPEC.saturation);
    const attackEnv = Math.min(1, this.t / PAD_SPEC.attack);
    let ampEnv = attackEnv;
    if (this.releasing)
      ampEnv = attackEnv * Math.exp(-this.releaseT / 0.15);
    return [out * ampEnv * this.amp, false];
  }
}

class PsyShaker {
  active = false;
  t = 0;
  amp = 0.25;
  noise;
  bp = new ZDFSVF;
  hp = new OnePoleHP2;
  rng;
  bpFreqVar = 7000;
  constructor(rng) {
    this.noise = new PinkNoise(rng);
    this.rng = rng;
  }
  trigger(amp) {
    this.active = true;
    this.t = 0;
    this.amp = amp;
    this.bpFreqVar = 7000 + this.rng.range(-1, 1) * 200;
    this.noise.reset();
    this.bp.reset();
    this.hp.reset();
  }
  render() {
    if (!this.active)
      return [0, true];
    this.t += 1 / DEFAULT_SR;
    if (this.t > 0.06) {
      this.active = false;
      return [0, true];
    }
    const n = this.noise.next();
    const bpOut = this.bp.process(n, this.bpFreqVar, 0.4, DEFAULT_SR, 1);
    const hpOut = this.hp.process(bpOut, 4000, DEFAULT_SR);
    const bodyEnv = Math.exp(-this.t / 0.008);
    const tailEnv = Math.exp(-this.t / 0.03);
    const env = bodyEnv * 0.7 + tailEnv * 0.3;
    return [hpOut * env * this.amp * 2, false];
  }
}

class PsyAcid {
  active = false;
  t = 0;
  freq = 220;
  amp = ACID_SPEC.gain;
  releasing = false;
  releaseT = 0;
  matrix = null;
  _modParams = {};
  square = new BLSquare;
  filter = new ZDFSVF;
  sat = new OversampledSaturation;
  hp = new OnePoleHP2;
  setModulationMatrix(m) {
    this.matrix = m;
  }
  trigger(freq, _dur, amp) {
    this.active = true;
    this.t = 0;
    this.freq = freq;
    this.amp = amp * ACID_SPEC.gain;
    this.releasing = false;
    this.releaseT = 0;
    this.square.reset();
    this.square.setFreq(freq);
    this.filter.reset();
    this.sat.reset();
    this.hp.reset();
  }
  noteOff() {
    this.releasing = true;
    this.releaseT = 0;
  }
  render() {
    if (!this.active)
      return [0, true];
    this.t += 1 / DEFAULT_SR;
    if (this.releasing) {
      this.releaseT += 1 / DEFAULT_SR;
      if (this.releaseT > 0.1) {
        this.active = false;
        return [0, true];
      }
    }
    const osc = this.square.process(this.freq / DEFAULT_SR);
    const env = Math.exp(-this.t / ACID_SPEC.envDecay) * ACID_SPEC.envAmount;
    let cutoff;
    let res = ACID_SPEC.res;
    let drive = ACID_SPEC.distortion;
    if (this.matrix) {
      this.matrix.setEnvValue(env);
      this.matrix.setVelocity(this.amp);
      this._modParams.cutoff = ACID_SPEC.cutoff * (1 + env);
      this._modParams.resonance = res;
      this._modParams.drive = drive;
      this._modParams.amp = 1;
      this.matrix.apply(this._modParams);
      cutoff = Math.max(200, this._modParams.cutoff ?? ACID_SPEC.cutoff);
      res = this._modParams.resonance ?? res;
      drive = this._modParams.drive ?? drive;
    } else {
      const lfo = Math.sin(2 * Math.PI * ACID_SPEC.lfoRate * this.t) * ACID_SPEC.lfoDepth;
      cutoff = Math.max(200, ACID_SPEC.cutoff * (1 + lfo + env));
    }
    const filtered = this.filter.process(osc, cutoff, res, DEFAULT_SR, 0);
    let out = this.sat.process(filtered, drive);
    out = this.hp.process(out, ACID_SPEC.hpFreq, DEFAULT_SR);
    const attackEnv = Math.min(1, this.t / 0.002);
    let ampEnv = attackEnv;
    if (this.releasing)
      ampEnv = attackEnv * Math.exp(-this.releaseT / 0.05);
    return [out * ampEnv * this.amp, false];
  }
}

class PsyTexture {
  active = false;
  t = 0;
  amp = 0.15;
  releasing = false;
  releaseT = 0;
  cloud;
  cloudAmp = 0.6;
  noise;
  noiseBP = new ZDFSVF;
  filter = new ZDFSVF;
  sat = new OversampledSaturation;
  sourceBuffer = null;
  sourceFreq = 220;
  rng;
  constructor(rng) {
    this.rng = rng;
    this.sourceBuffer = GrainCloud.generateMixedBuffer(rng, 220, 2, 0.5);
    this.cloud = new GrainCloud(this.sourceBuffer, rng);
    this.cloud.setDensity(60);
    this.cloud.setGrainDuration(40);
    this.cloud.setPitchVar(0.15);
    this.cloud.setPosVar(0.4);
    this.cloud.setAmp(0.5);
    this.noise = new PinkNoise(rng);
  }
  trigger(freqs, _dur, amp) {
    this.active = true;
    this.t = 0;
    this.amp = amp * 0.15;
    this.releasing = false;
    this.releaseT = 0;
    const root = freqs[0] ?? 220;
    if (Math.abs(root - this.sourceFreq) > 0.5 || !this.sourceBuffer) {
      this.sourceFreq = root;
      this.sourceBuffer = GrainCloud.generateMixedBuffer(this.rng, root, 2, 0.5);
      this.cloud.setBuffer(this.sourceBuffer);
    } else {
      this.cloud.reset();
    }
    this.noise.reset();
    this.noiseBP.reset();
    this.filter.reset();
    this.sat.reset();
  }
  noteOff() {
    this.releasing = true;
    this.releaseT = 0;
  }
  render() {
    if (!this.active)
      return [0, true];
    this.t += 1 / DEFAULT_SR;
    if (this.releasing) {
      this.releaseT += 1 / DEFAULT_SR;
      if (this.releaseT > 0.5) {
        this.active = false;
        return [0, true];
      }
    }
    const [gL, gR] = this.cloud.process();
    const grainSig = (gL + gR) * 0.5 * this.cloudAmp;
    const n = this.noise.next();
    const noiseSweep = 400 + Math.sin(2 * Math.PI * 0.1 * this.t) * 300;
    const noiseSig = this.noiseBP.process(n, noiseSweep, 0.5, DEFAULT_SR, 1) * 0.3;
    const signal = grainSig + noiseSig * 0.4;
    const morphLfo = Math.sin(2 * Math.PI * 0.05 * this.t) * 0.5;
    const cutoff = Math.max(200, 800 * (1 + morphLfo));
    const filtered = this.filter.process(signal, cutoff, 0.3, DEFAULT_SR, 0);
    const out = this.sat.process(filtered, 1.2);
    const attackEnv = Math.min(1, this.t / 0.5);
    let ampEnv = attackEnv;
    if (this.releasing)
      ampEnv = attackEnv * Math.exp(-this.releaseT / 0.3);
    return [out * ampEnv * this.amp, false];
  }
}

class PsyRiser {
  active = false;
  t = 0;
  dur = 2;
  amp = 0.25;
  noise;
  filter = new ZDFSVF;
  saw = new BLSaw;
  sawPhase = 0;
  constructor(rng) {
    this.noise = new PinkNoise(rng);
  }
  trigger(dur, amp) {
    this.active = true;
    this.t = 0;
    this.dur = dur;
    this.amp = amp;
    this.noise.reset();
    this.filter.reset();
    this.saw.reset();
    this.sawPhase = 0;
  }
  render() {
    if (!this.active)
      return [0, true];
    this.t += 1 / DEFAULT_SR;
    if (this.t > this.dur) {
      this.active = false;
      return [0, true];
    }
    const progress = this.t / this.dur;
    const n = this.noise.next();
    const cutoff = 200 + progress ** 1.5 * 9800;
    const filtered = this.filter.process(n, cutoff, 0.5, DEFAULT_SR, 0);
    const sawFreq = 100 * 8 ** progress;
    this.sawPhase += sawFreq / DEFAULT_SR;
    if (this.sawPhase >= 1)
      this.sawPhase -= 1;
    const sawSig = (2 * this.sawPhase - 1) * 0.3;
    const mixed = filtered * 0.6 + sawSig * 0.4;
    const env = progress ** 2 * this.amp;
    return [mixed * env, false];
  }
}

class PsyImpact {
  active = false;
  t = 0;
  phase = 0;
  amp = 0.4;
  noise;
  constructor(rng) {
    this.noise = new PinkNoise(rng);
  }
  trigger(amp) {
    this.active = true;
    this.t = 0;
    this.phase = 0;
    this.amp = amp;
    this.noise.reset();
  }
  render() {
    if (!this.active)
      return [0, true];
    this.t += 1 / DEFAULT_SR;
    if (this.t > 0.5) {
      this.active = false;
      return [0, true];
    }
    const freq = (120 - 35) * Math.exp(-this.t / 0.1) + 35;
    this.phase += 2 * Math.PI * freq / DEFAULT_SR;
    const sub = Math.sin(this.phase) * Math.exp(-this.t / 0.3) * 0.7;
    const crack = this.noise.next() * Math.exp(-this.t / 0.02) * 0.3;
    return [(sub + crack) * this.amp, false];
  }
}

// apps/web/src/lib/psy4/wavetable.ts
class Wavetable {
  tables;
  position = 0;
  phase = 0;
  TABLE_SIZE = 2048;
  constructor(tables) {
    this.tables = tables;
  }
  getTables() {
    return this.tables;
  }
  setPosition(pos) {
    this.position = Math.max(0, Math.min(1, pos));
  }
  getPosition() {
    return this.position;
  }
  setFreq(_freq) {}
  reset() {
    this.phase = 0;
  }
  process(inc) {
    this.phase += inc;
    if (this.phase >= 1)
      this.phase -= 1;
    if (this.phase < 0)
      this.phase += 1;
    const tablePos = this.position * (this.tables.length - 1);
    const idx0 = Math.floor(tablePos);
    const idx1 = Math.min(idx0 + 1, this.tables.length - 1);
    const frac = tablePos - idx0;
    const samplePos = this.phase * this.TABLE_SIZE;
    const sIdx0 = Math.floor(samplePos);
    const sIdx1 = (sIdx0 + 1) % this.TABLE_SIZE;
    const sFrac = samplePos - sIdx0;
    const table0 = this.tables[idx0];
    const table1 = this.tables[idx1];
    const s0 = table0[sIdx0 % table0.length] * (1 - sFrac) + table0[sIdx1 % table0.length] * sFrac;
    const s1 = table1[sIdx0 % table1.length] * (1 - sFrac) + table1[sIdx1 % table1.length] * sFrac;
    return s0 * (1 - frac) + s1 * frac;
  }
  static createSaw() {
    const t = new Float32Array(2048);
    for (let i = 0;i < 2048; i++)
      t[i] = 2 * i / 2048 - 1;
    return new Wavetable([t]);
  }
  static createSquare() {
    const t = new Float32Array(2048);
    for (let i = 0;i < 2048; i++)
      t[i] = i < 1024 ? 1 : -1;
    return new Wavetable([t]);
  }
  static createTriangle() {
    const t = new Float32Array(2048);
    for (let i = 0;i < 2048; i++)
      t[i] = 2 * Math.abs(2 * (i / 2048 - Math.floor(i / 2048 + 0.5))) - 1;
    return new Wavetable([t]);
  }
  static createPsyLead() {
    const t = new Float32Array(2048);
    for (let i = 0;i < 2048; i++) {
      const phase = i / 2048 * 2 * Math.PI;
      t[i] = (Math.sin(phase) * 1 + Math.sin(2 * phase) * 0.5 + Math.sin(3 * phase) * 0.33 + Math.sin(5 * phase) * 0.2) / 2.03;
    }
    return new Wavetable([t]);
  }
  static createAcidSquelch() {
    const t = new Float32Array(2048);
    for (let i = 0;i < 2048; i++) {
      const phase = i / 2048;
      const sq = phase < 0.5 ? 1 : -1;
      const resPeak = Math.exp(-(((phase - 0.5) * 20) ** 2)) * 0.3;
      t[i] = Math.max(-1, Math.min(1, sq + resPeak));
    }
    return new Wavetable([t]);
  }
  static createVocalFormant() {
    const t = new Float32Array(2048);
    for (let i = 0;i < 2048; i++) {
      const phase = i / 2048 * 2 * Math.PI;
      const saw = 2 * i / 2048 - 1;
      const f1 = Math.sin(phase * 800 / 440) * 0.3;
      const f2 = Math.sin(phase * 1200 / 440) * 0.25;
      const f3 = Math.sin(phase * 2800 / 440) * 0.2;
      t[i] = Math.max(-1, Math.min(1, saw * 0.5 + f1 + f2 + f3));
    }
    return new Wavetable([t]);
  }
  static createMulti() {
    const saw = Wavetable.createSaw().getTables()[0];
    const sq = Wavetable.createSquare().getTables()[0];
    const tri = Wavetable.createTriangle().getTables()[0];
    const psy = Wavetable.createPsyLead().getTables()[0];
    const acid = Wavetable.createAcidSquelch().getTables()[0];
    const vocal = Wavetable.createVocalFormant().getTables()[0];
    return new Wavetable([saw, sq, tri, psy, acid, vocal]);
  }
  static fromAudio(buffer, numTables = 8) {
    const tables = [];
    const cycleLength = Math.floor(buffer.length / numTables);
    for (let t = 0;t < numTables; t++) {
      const start = t * cycleLength;
      const table = new Float32Array(2048);
      for (let i = 0;i < 2048; i++) {
        const srcIdx = start + Math.floor(i / 2048 * cycleLength);
        table[i] = buffer[srcIdx] ?? 0;
      }
      tables.push(table);
    }
    return new Wavetable(tables);
  }
}

// apps/web/src/lib/psy4/forensic-bridge.ts
function decodeWav(buffer) {
  const view = new DataView(buffer);
  if (view.getUint32(0, false) !== 1380533830)
    throw new Error("Not WAV (missing RIFF magic)");
  if (view.getUint32(8, false) !== 1463899717)
    throw new Error("Not WAV (missing WAVE magic)");
  let fmtOffset = -1;
  let fmtSize = 0;
  let dataOffset = -1;
  let dataSize = 0;
  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const chunkId = view.getUint32(offset, false);
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkId === 1718449184) {
      fmtOffset = offset + 8;
      fmtSize = chunkSize;
      if (fmtSize < 16)
        throw new Error(`Invalid fmt chunk size: ${fmtSize}`);
    } else if (chunkId === 1684108385) {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break;
    }
    offset += 8 + chunkSize + chunkSize % 2;
  }
  if (fmtOffset === -1)
    throw new Error("No fmt chunk");
  if (dataOffset === -1 || dataSize === 0)
    throw new Error("No data chunk");
  const audioFormat = view.getUint16(fmtOffset, true);
  const numChannels = view.getUint16(fmtOffset + 2, true);
  const sampleRate = view.getUint32(fmtOffset + 4, true);
  const bitsPerSample = view.getUint16(fmtOffset + 14, true);
  const bytesPerSample = bitsPerSample / 8;
  if (audioFormat !== 1 && audioFormat !== 3) {
    throw new Error(`Unsupported WAV audioFormat: ${audioFormat} (only PCM=1 and float=3 supported)`);
  }
  if (audioFormat === 3 && bitsPerSample !== 32) {
    throw new Error(`IEEE-float WAV supports only 32-bit, got ${bitsPerSample}-bit`);
  }
  if (numChannels === 0)
    throw new Error("numChannels === 0");
  if (bytesPerSample === 0)
    throw new Error("bitsPerSample must be 8/16/24/32");
  if (sampleRate === 0)
    throw new Error("sampleRate === 0");
  const supportedBits = [8, 16, 24, 32];
  if (!supportedBits.includes(bitsPerSample)) {
    throw new Error(`Unsupported bitsPerSample: ${bitsPerSample}`);
  }
  const bytesAvailable = Math.min(dataSize, buffer.byteLength - dataOffset);
  const framesAvailable = Math.floor(bytesAvailable / (bytesPerSample * numChannels));
  const output = new Float32Array(framesAvailable);
  for (let i = 0;i < framesAvailable; i++) {
    let sum = 0;
    let chRead = 0;
    for (let ch = 0;ch < numChannels; ch++) {
      const so = dataOffset + (i * numChannels + ch) * bytesPerSample;
      if (so + bytesPerSample > buffer.byteLength)
        break;
      chRead++;
      if (audioFormat === 1) {
        if (bitsPerSample === 8) {
          sum += (view.getUint8(so) - 128) / 128;
        } else if (bitsPerSample === 16) {
          sum += view.getInt16(so, true) / 32768;
        } else if (bitsPerSample === 24) {
          const b0 = view.getUint8(so) ?? 0;
          const b1 = view.getUint8(so + 1) ?? 0;
          const b2 = view.getUint8(so + 2) ?? 0;
          let val = b2 << 16 | b1 << 8 | b0;
          if (val & 8388608)
            val |= 4278190080;
          sum += val / 8388608;
        } else if (bitsPerSample === 32) {
          sum += view.getInt32(so, true) / 2147483648;
        }
      } else {
        sum += view.getFloat32(so, true);
      }
    }
    output[i] = chRead > 0 ? sum / chRead : 0;
  }
  return { data: output, sampleRate };
}
var DEFAULT_RENDER_CONFIG = {
  kickFundamental: KICK_SPEC.fundamental,
  kickDecay: KICK_SPEC.subDecay,
  bassDecay: BASS_SPEC.pluckDecay,
  bassGain: BASS_SPEC.bodyLevel,
  leadCutoff: LEAD_SPEC.cutoff,
  leadGain: LEAD_SPEC.gain,
  leadResonance: LEAD_SPEC.res,
  hatGain: HAT_SPEC.gain,
  openHatGain: HAT_SPEC.gain * 0.8,
  snareGain: SNARE_SPEC.gain,
  shakerGain: 1,
  subBassGain: 1,
  padGain: PAD_SPEC.gain,
  duckAmount: BASS_SPEC.sidechainDepth,
  targetLufs: MASTER_SPEC.targetLufs,
  stereoWidth: MASTER_SPEC.stereoWidth
};
async function renderFoundationSection(section, options = {}) {
  const cfg = { ...DEFAULT_RENDER_CONFIG, ...options.config };
  const automation = options.automation ?? null;
  const rawScore = serializeRawScore(section);
  const bpm = options.bpm ?? 145;
  const targetLufs = cfg.targetLufs;
  const secondsPerStep = 60 / bpm / (rawScore.groove.stepsPerBar / 4);
  const samplesPerStep = Math.ceil(secondsPerStep * DEFAULT_SR);
  const samplesPerBar = samplesPerStep * rawScore.groove.stepsPerBar;
  const renderBars = rawScore.bars;
  const barRemap = new Map;
  renderBars.forEach((b, i) => barRemap.set(b.barIndex, i));
  const totalSamples = samplesPerBar * renderBars.length;
  const samplesL = new Float32Array(totalSamples);
  const samplesR = new Float32Array(totalSamples);
  const stemsEnabled = options.stems ?? false;
  const stemsDrumL = stemsEnabled ? new Float32Array(totalSamples) : null;
  const stemsDrumR = stemsEnabled ? new Float32Array(totalSamples) : null;
  const stemsBassL = stemsEnabled ? new Float32Array(totalSamples) : null;
  const stemsBassR = stemsEnabled ? new Float32Array(totalSamples) : null;
  const stemsMusicL = stemsEnabled ? new Float32Array(totalSamples) : null;
  const stemsMusicR = stemsEnabled ? new Float32Array(totalSamples) : null;
  const renderSeed = section.seed ?? 42;
  const rng = new Rng2(renderSeed);
  const kicks = [new PsyKick(rng), new PsyKick(rng), new PsyKick(rng), new PsyKick(rng)];
  const basses = [new PsyBass(rng), new PsyBass(rng)];
  const leads = [new PsyLead(rng), new PsyLead(rng), new PsyLead(rng), new PsyLead(rng)];
  const hats = [new PsyHat(rng), new PsyHat(rng), new PsyHat(rng), new PsyHat(rng)];
  const snares = [new PsySnare(rng), new PsySnare(rng)];
  const subBasses = [new PsySubBass, new PsySubBass];
  const pads = [new PsyPad(rng), new PsyPad(rng)];
  const shakers = [new PsyShaker(rng), new PsyShaker(rng)];
  const risers = [new PsyRiser(rng)];
  const impacts = [new PsyImpact(rng)];
  const acids = [new PsyAcid, new PsyAcid];
  const textures = [new PsyTexture(rng)];
  const leadWavetable = Wavetable.createMulti();
  leadWavetable.setPosition(0.4);
  for (const lead of leads)
    lead.setWavetable(leadWavetable);
  const bassWaveguide = new WaveguideString;
  for (const bass of basses)
    bass.setWaveguide(bassWaveguide);
  const modMatrix = ModulationMatrix.createDefault();
  for (const lead of leads)
    lead.setModulationMatrix(modMatrix);
  for (const acid of acids)
    acid.setModulationMatrix(modMatrix);
  const fxKick = new ChannelFX(CHANNEL_PRESETS.kick, DEFAULT_SR);
  const fxBass = new ChannelFX(CHANNEL_PRESETS.bass, DEFAULT_SR);
  const fxSubBass = new ChannelFX(CHANNEL_PRESETS.subbass, DEFAULT_SR);
  const fxLead = new ChannelFX(CHANNEL_PRESETS.lead, DEFAULT_SR);
  const fxCounter = new ChannelFX(CHANNEL_PRESETS.counter, DEFAULT_SR);
  const fxHat = new ChannelFX(CHANNEL_PRESETS.hat, DEFAULT_SR);
  const fxOpenHat = new ChannelFX(CHANNEL_PRESETS.openhat, DEFAULT_SR);
  const fxSnare = new ChannelFX(CHANNEL_PRESETS.snare, DEFAULT_SR);
  const fxShaker = new ChannelFX(CHANNEL_PRESETS.shaker, DEFAULT_SR);
  const fxPad = new ChannelFX(CHANNEL_PRESETS.pad, DEFAULT_SR);
  const fxRiser = new ChannelFX(CHANNEL_PRESETS.riser, DEFAULT_SR);
  const fxImpact = new ChannelFX(CHANNEL_PRESETS.impact, DEFAULT_SR);
  const fxClap = new ChannelFX(CHANNEL_PRESETS.clap, DEFAULT_SR);
  const fxPerc = new ChannelFX(CHANNEL_PRESETS.perc, DEFAULT_SR);
  let kickSample = null;
  let hatSample = null;
  let clapSample = null;
  let percSample = null;
  if (options.useSamples) {
    try {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const dir = path.join(process.cwd(), "public", "samples");
      const loadSample = async (name) => {
        const buf = await fs.readFile(path.join(dir, name));
        const decoded = decodeWav(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
        const s = new PsySample;
        s.setData(decoded.data, decoded.sampleRate);
        return s;
      };
      kickSample = await loadSample("kick.wav");
      hatSample = await loadSample("hat_closed.wav");
      clapSample = await loadSample("clap.wav");
      percSample = await loadSample("hat_open.wav");
    } catch (e) {
      console.warn("Samples not available:", e.message);
    }
  }
  const drumBusL = new BusProcessor({
    hpFreq: 0,
    compThr: 0.5,
    compRatio: 3,
    compAtt: 0.002,
    compRel: 0.08,
    compMakeup: 1.3,
    drive: 1.2,
    gain: BUS_GAINS.drum
  });
  const drumBusR = new BusProcessor({
    hpFreq: 0,
    compThr: 0.5,
    compRatio: 3,
    compAtt: 0.002,
    compRel: 0.08,
    compMakeup: 1.3,
    drive: 1.2,
    gain: BUS_GAINS.drum
  });
  const bassBusL = new BusProcessor({
    hpFreq: BASS_SPEC.hpFreq + 80,
    compThr: 0.4,
    compRatio: 2,
    compAtt: 0.005,
    compRel: 0.1,
    compMakeup: 1,
    drive: 1,
    gain: BUS_GAINS.bass
  });
  const bassBusR = new BusProcessor({
    hpFreq: BASS_SPEC.hpFreq + 80,
    compThr: 0.4,
    compRatio: 2,
    compAtt: 0.005,
    compRel: 0.1,
    compMakeup: 1,
    drive: 1,
    gain: BUS_GAINS.bass
  });
  const musicBusL = new BusProcessor({
    hpFreq: 180,
    compThr: 0.4,
    compRatio: 2,
    compAtt: 0.01,
    compRel: 0.15,
    compMakeup: 1.3,
    drive: 1.2,
    gain: BUS_GAINS.music
  });
  const musicBusR = new BusProcessor({
    hpFreq: 180,
    compThr: 0.4,
    compRatio: 2,
    compAtt: 0.01,
    compRel: 0.15,
    compMakeup: 1.3,
    drive: 1.2,
    gain: BUS_GAINS.music
  });
  const masterGlueL = new MasterChain;
  const masterGlueR = new MasterChain;
  const bassXover = new LR4Crossover(120, DEFAULT_SR);
  const events = [];
  for (const bar of renderBars) {
    const barStart = (barRemap.get(bar.barIndex) ?? 0) * samplesPerBar;
    const accent = rawScore.groove.accent;
    const barIdx = barRemap.get(bar.barIndex) ?? 0;
    const phase = barIdx % 8;
    const _playKick = true;
    const _playBass = true;
    const playHats = true;
    const playLead = phase >= 2;
    const _playCounter = phase >= 3;
    const playPad = phase !== 6;
    const playSnare = phase >= 2;
    const playShaker = true;
    const playFX = phase === 6 || phase === 7;
    const isBreak = phase === 6;
    const kickPhraseBar = barIdx % 8;
    const kickVelBase = kickPhraseBar < 2 ? 0.85 : kickPhraseBar < 4 ? 0.8 : kickPhraseBar < 6 ? 0.9 : 0.7;
    const kickDropBar = barIdx % 4 === 3;
    const kickSteps = kickDropBar ? [0, 4, 8] : [0, 4, 8, 12];
    const step8VelMod = barIdx % 2 === 0 ? 1 : 0.75;
    for (const step of kickSteps) {
      const a = accent[step % accent.length] ?? 1;
      const velMod = step === 0 ? 1 : step === 8 ? step8VelMod : step === 12 ? 0.9 : 0.95;
      events.push({
        pos: barStart + step * samplesPerStep,
        type: "kick",
        vel: kickVelBase * velMod + a * 0.1,
        dur: samplesPerStep
      });
    }
    if (kickDropBar) {
      events.push({
        pos: barStart + 14 * samplesPerStep,
        type: "snare",
        vel: 0.35,
        dur: samplesPerStep
      });
      events.push({
        pos: barStart + 15 * samplesPerStep,
        type: "snare",
        vel: 0.45,
        dur: samplesPerStep
      });
    }
    if (kickPhraseBar >= 2 && kickPhraseBar < 6 && barIdx % 2 === 1) {
      events.push({
        pos: barStart + 7 * samplesPerStep,
        type: "kick",
        vel: 0.3,
        dur: samplesPerStep
      });
    }
    if (playSnare && barIdx % 2 === 1 && phase !== 7) {
      events.push({
        pos: barStart + 6 * samplesPerStep,
        type: "snare",
        vel: 0.25,
        dur: samplesPerStep
      });
    }
    const rootMidi = bar.bassNotes[0]?.midi ?? 40;
    const fifthMidi = bar.bassNotes[2]?.midi ?? rootMidi;
    const thirdMidi = bar.bassNotes[4]?.midi ?? rootMidi;
    const phraseBar = barIdx % 8;
    const swingAmount = Math.floor(samplesPerStep * 0.15);
    for (let step = 0;step < 16; step++) {
      const a = accent[step % accent.length] ?? 0.5;
      let midi = rootMidi;
      let vel;
      let dur;
      if (phraseBar < 2) {
        midi = step % 4 === 0 ? rootMidi : step % 4 === 2 ? fifthMidi : rootMidi;
        vel = step % 4 === 0 ? 0.7 + a * 0.2 : 0.35 + a * 0.15;
        dur = step % 2 === 1 ? 0.6 : 0.85;
      } else if (phraseBar < 4) {
        midi = step % 4 === 0 ? rootMidi : step % 4 === 1 ? thirdMidi : step % 4 === 2 ? fifthMidi : rootMidi;
        vel = step % 4 === 0 ? 0.7 + a * 0.2 : step % 2 === 1 ? 0.25 + a * 0.15 : 0.45 + a * 0.2;
        dur = step % 2 === 1 ? 0.6 : 0.85;
      } else if (phraseBar < 6) {
        midi = step % 4 === 0 ? rootMidi : step % 4 === 2 ? fifthMidi : step % 4 === 3 ? rootMidi + 12 : rootMidi;
        vel = step % 4 === 0 ? 0.75 + a * 0.2 : step % 2 === 1 ? 0.3 + a * 0.15 : 0.5 + a * 0.2;
        dur = step % 2 === 1 ? 0.65 : 0.85;
      } else {
        if (step % 4 === 0 || step % 4 === 2) {
          midi = step % 4 === 0 ? rootMidi : fifthMidi;
          vel = 0.6 + a * 0.2;
          dur = 0.9;
        } else {
          continue;
        }
      }
      const swingOffset = step % 2 === 1 ? swingAmount : 0;
      events.push({
        pos: barStart + step * samplesPerStep + swingOffset,
        type: "bass",
        midi,
        vel,
        dur: Math.floor(samplesPerStep * dur)
      });
    }
    if (playLead && !isBreak && bar.leadNotes.length > 0) {
      for (const n of bar.leadNotes) {
        events.push({
          pos: barStart + n.step * samplesPerStep,
          type: "lead",
          midi: n.midi,
          vel: n.velocity,
          dur: n.durationSteps * samplesPerStep
        });
      }
      const leadSteps = new Set(bar.leadNotes.map((n) => n.step));
      const fillSteps = [3, 7, 11, 15];
      for (const fs of fillSteps) {
        if (!leadSteps.has(fs)) {
          const lastLead = bar.leadNotes[bar.leadNotes.length - 1];
          if (lastLead) {
            events.push({
              pos: barStart + fs * samplesPerStep,
              type: "lead",
              midi: lastLead.midi + 4,
              vel: 0.4,
              dur: samplesPerStep
            });
          }
        }
      }
    } else {
      const phrasePos = barIdx % 4;
      const motifA = [64, 67, 71, 67];
      const motifB = [76, 74, 71, 69];
      const motifAp = [64, 67, 71, 72];
      const motif = phrasePos === 2 ? motifB : phrasePos === 3 ? motifAp : motifA;
      for (let i = 0;i < motif.length; i++) {
        const step = i * 2;
        events.push({
          pos: barStart + step * samplesPerStep,
          type: "lead",
          midi: motif[i],
          vel: 0.5,
          dur: samplesPerStep
        });
      }
    }
    if (bar.leadNotes.length > 0) {
      for (const n of bar.leadNotes) {
        const counterStep = n.step + 3;
        if (counterStep < 16) {
          const harmonyMidi = n.midi + (counterStep % 2 === 0 ? 4 : 7);
          events.push({
            pos: barStart + counterStep * samplesPerStep,
            type: "counter",
            midi: harmonyMidi,
            vel: n.velocity * 0.6,
            dur: samplesPerStep
          });
        }
      }
    }
    if (playHats) {
      const phraseBar2 = barIdx % 4;
      const phraseBoost = phraseBar2 === 0 ? 1.15 : phraseBar2 === 3 ? 0.85 : 1;
      const oddBar = barIdx % 2 === 1;
      const stepVel = oddBar ? [0.3, 0.5, 0.4, 0.45, 0.35, 0.55, 0.4, 0.5].map((v) => v * phraseBoost) : [0.35, 0.55, 0.4, 0.5, 0.35, 0.6, 0.4, 0.55].map((v) => v * phraseBoost);
      for (let eighth = 0;eighth < 8; eighth++) {
        const step = eighth * 2;
        const vel = stepVel[eighth];
        events.push({
          pos: barStart + step * samplesPerStep,
          type: "hat",
          vel,
          dur: samplesPerStep
        });
      }
      const ghostMap = {
        0: [3, 7, 11, 15],
        1: [3, 7, 15],
        2: [3, 11, 15],
        3: [5, 7, 11, 15]
      };
      const ghostSteps = ghostMap[phraseBar2] ?? [3, 7, 11, 15];
      const ghostVel = phraseBar2 === 3 ? 0.22 : 0.18;
      for (const gs of ghostSteps) {
        events.push({
          pos: barStart + gs * samplesPerStep,
          type: "hat",
          vel: ghostVel,
          dur: samplesPerStep
        });
      }
    }
    if (playHats && barIdx % 2 === 0) {
      events.push({
        pos: barStart + 6 * samplesPerStep,
        type: "openhat",
        vel: 0.4,
        dur: samplesPerStep
      });
      events.push({
        pos: barStart + 14 * samplesPerStep,
        type: "openhat",
        vel: 0.4,
        dur: samplesPerStep
      });
    }
    events.push({
      pos: barStart + 4 * samplesPerStep,
      type: "clap",
      vel: 0.45,
      dur: samplesPerStep
    });
    events.push({
      pos: barStart + 12 * samplesPerStep,
      type: "clap",
      vel: 0.45,
      dur: samplesPerStep
    });
    if (playSnare) {
      events.push({
        pos: barStart + 4 * samplesPerStep,
        type: "snare",
        vel: 0.5,
        dur: samplesPerStep
      });
      events.push({
        pos: barStart + 12 * samplesPerStep,
        type: "snare",
        vel: 0.5,
        dur: samplesPerStep
      });
    }
    if (barIdx % 4 === 3) {
      events.push({
        pos: barStart + 13 * samplesPerStep,
        type: "snare",
        vel: 0.3,
        dur: samplesPerStep
      });
      events.push({
        pos: barStart + 14 * samplesPerStep,
        type: "snare",
        vel: 0.4,
        dur: samplesPerStep
      });
      events.push({
        pos: barStart + 15 * samplesPerStep,
        type: "snare",
        vel: 0.5,
        dur: samplesPerStep
      });
      events.push({
        pos: barStart + 15 * samplesPerStep + Math.floor(samplesPerStep / 2),
        type: "snare",
        vel: 0.7,
        dur: samplesPerStep
      });
    }
    events.push({ pos: barStart, type: "subbass", midi: rootMidi, vel: 0.25, dur: samplesPerBar });
    if (playPad && barIdx % 2 === 0) {
      const progDegrees = PSYTRANCE_PROGRESSIONS2["psy-dominant"];
      const chordIdx = Math.floor(barIdx / 2) % progDegrees.length;
      const chordRoot = rootMidi - 24;
      const progression = buildProgression(chordRoot, "phrygianDominant", progDegrees);
      const chord = progression[chordIdx];
      const freqs = chord.notes.map((midi) => 440 * 2 ** ((midi - 69) / 12));
      events.push({ pos: barStart, type: "pad", vel: 0.12, dur: samplesPerBar * 2, freqs });
    }
    if (playShaker) {
      const shakerPhraseBar = barIdx % 8;
      const shakerVelBase = shakerPhraseBar < 2 ? 0.25 : shakerPhraseBar < 4 ? 0.3 : shakerPhraseBar < 6 ? 0.35 : 0.2;
      const restPhrase = barIdx % 4;
      const restSteps = new Set(restPhrase === 1 ? [6] : restPhrase === 2 ? [11] : restPhrase === 3 ? [6, 14] : []);
      for (let step = 0;step < 16; step++) {
        if (restSteps.has(step))
          continue;
        const isStrong = step % 4 === 0;
        if (shakerPhraseBar >= 4 && step === 7 && barIdx % 2 === 1)
          continue;
        const vel = isStrong ? shakerVelBase : shakerVelBase * 0.5;
        events.push({
          pos: barStart + step * samplesPerStep,
          type: "shaker",
          vel,
          dur: samplesPerStep
        });
      }
    }
    if (playFX) {
      events.push({ pos: barStart, type: "riser", vel: 0.2, dur: samplesPerBar });
      events.push({ pos: barStart + samplesPerBar, type: "impact", vel: 0.4, dur: samplesPerStep });
    }
    if (phase >= 5 && !isBreak) {
      const acidRootMidi = rootMidi + 24;
      for (let step = 0;step < 16; step++) {
        if (step % 4 === 0 || step % 4 === 2) {
          const acidMidi = acidRootMidi + (step % 8 === 0 ? 7 : step % 4 === 2 ? 5 : 0);
          events.push({
            pos: barStart + step * samplesPerStep,
            type: "acid",
            midi: acidMidi,
            vel: 0.4,
            dur: samplesPerStep
          });
        }
      }
    }
    if (isBreak || phase === 0) {
      const rootFreq = 440 * 2 ** ((rootMidi - 69) / 12);
      const thirdFreq = 440 * 2 ** ((rootMidi + 4 - 69) / 12);
      const fifthFreq = 440 * 2 ** ((rootMidi + 7 - 69) / 12);
      events.push({
        pos: barStart,
        type: "texture",
        vel: 0.2,
        dur: samplesPerBar,
        freqs: [rootFreq, thirdFreq, fifthFreq]
      });
    }
    const percSteps = phraseBar === 0 ? [7, 15] : phraseBar === 1 ? [5, 13] : phraseBar === 2 ? [3, 11] : [7, 11, 15];
    for (const ps of percSteps) {
      events.push({
        pos: barStart + ps * samplesPerStep,
        type: "perc",
        vel: 0.2,
        dur: samplesPerStep
      });
    }
  }
  events.sort((a, b) => a.pos - b.pos);
  const humanRng = mulberry32(renderSeed);
  const humanAmount = 0.3;
  for (const ev of events) {
    if (ev.type !== "kick" && ev.vel > 0) {
      ev.vel = jitterVelocity(ev.vel, humanAmount, humanRng);
    }
    const driftSamples = Math.floor(driftTime(humanAmount, humanRng) * DEFAULT_SR);
    ev.pos = Math.max(0, ev.pos + driftSamples);
  }
  events.sort((a, b) => a.pos - b.pos);
  let duckEnv = 1;
  let activeBass = null;
  let bassNoteOffPos = 0;
  let activeSubBass = null;
  let subBassNoteOffPos = 0;
  let activePad = null;
  let padNoteOffPos = 0;
  let kickIdx = 0;
  let bassIdx = 0;
  let leadIdx = 0;
  let hatIdx = 0;
  let evIdx = 0;
  const _hatPanFlip = false;
  const _openHatPanFlip = false;
  function barEnergy(barIdx) {
    const phase = barIdx % 8;
    if (phase === 0)
      return 0.6;
    if (phase === 1)
      return 0.85;
    if (phase === 2)
      return 1;
    if (phase === 3)
      return 1.1;
    if (phase === 4)
      return 0.2;
    if (phase === 5)
      return 0.5;
    if (phase === 6)
      return 0.95;
    if (phase === 7)
      return 1.3;
    return 1;
  }
  for (let i = 0;i < totalSamples; i++) {
    const currentBar = Math.floor(i / samplesPerBar);
    const energyMul = barEnergy(currentBar);
    const currentTime = i / DEFAULT_SR;
    if (automation) {
      if (automation.isAutomated("leadCutoff"))
        cfg.leadCutoff = automation.getValue("leadCutoff", currentTime);
      if (automation.isAutomated("leadGain"))
        cfg.leadGain = automation.getValue("leadGain", currentTime);
      if (automation.isAutomated("stereoWidth"))
        cfg.stereoWidth = automation.getValue("stereoWidth", currentTime);
      if (automation.isAutomated("targetLufs"))
        cfg.targetLufs = automation.getValue("targetLufs", currentTime);
    }
    modMatrix.tick(DEFAULT_SR);
    if (i % samplesPerBar === 0) {
      const barPos = currentBar % 8;
      const space = 0.2 + barPos / 7 * 0.7;
      const energy = barPos === 4 ? 0.3 : 0.5 + barPos / 7 * 0.4;
      const tension = 0.3 + barPos / 7 * 0.7;
      modMatrix.setMacro("macro1", space);
      modMatrix.setMacro("macro2", energy);
      modMatrix.setMacro("macro3", tension);
    }
    while (evIdx < events.length && events[evIdx].pos <= i) {
      const ev = events[evIdx];
      if (ev.type === "kick") {
        duckEnv = Math.max(1 - cfg.duckAmount, duckEnv * 0.85);
        if (kickSample)
          kickSample.trigger(ev.vel);
        else {
          kicks[kickIdx % 4].trigger(ev.vel, cfg.kickFundamental, cfg.kickDecay);
          kickIdx++;
        }
      } else if (ev.type === "bass" && ev.midi !== undefined) {
        if (activeBass)
          activeBass.noteOff();
        const freq = 440 * 2 ** ((ev.midi - 69) / 12);
        basses[bassIdx % 2].trigger(freq, cfg.bassDecay, ev.vel);
        activeBass = basses[bassIdx % 2];
        bassNoteOffPos = i + ev.dur;
        bassIdx++;
      } else if (ev.type === "lead" && ev.midi !== undefined) {
        const freq = 440 * 2 ** ((ev.midi - 69) / 12);
        leads[leadIdx % 4].trigger(freq, ev.dur / DEFAULT_SR, ev.vel, {
          cutoff: cfg.leadCutoff,
          detune: 10,
          res: cfg.leadResonance,
          lfoRate: 1.2,
          lfoDepth: 0.5
        });
        leadIdx++;
      } else if (ev.type === "hat") {
        if (hatSample)
          hatSample.trigger(ev.vel);
        else {
          hats[hatIdx % 4].trigger(ev.vel, false);
          hatIdx++;
        }
      } else if (ev.type === "openhat") {
        for (const h of hats) {
          if (h.active && !h.open)
            h.active = false;
        }
        hats[(hatIdx + 2) % 4].trigger(ev.vel, true);
      } else if (ev.type === "clap" && clapSample) {
        clapSample.trigger(ev.vel);
      } else if (ev.type === "perc" && percSample) {
        percSample.trigger(ev.vel);
      } else if (ev.type === "snare") {
        snares[0].trigger(ev.vel);
      } else if (ev.type === "subbass" && ev.midi !== undefined) {
        const freq = 440 * 2 ** ((ev.midi - 69) / 12);
        if (activeSubBass)
          activeSubBass.noteOff();
        subBasses[0].trigger(freq, ev.dur / DEFAULT_SR, ev.vel);
        activeSubBass = subBasses[0];
        subBassNoteOffPos = i + ev.dur;
      } else if (ev.type === "pad" && ev.freqs) {
        if (activePad)
          activePad.noteOff();
        pads[0].trigger(ev.freqs, ev.dur / DEFAULT_SR, ev.vel);
        activePad = pads[0];
        padNoteOffPos = i + ev.dur;
      } else if (ev.type === "shaker") {
        shakers[0].trigger(ev.vel);
      } else if (ev.type === "riser") {
        risers[0].trigger(ev.dur / DEFAULT_SR, ev.vel);
      } else if (ev.type === "impact") {
        impacts[0].trigger(ev.vel);
      } else if (ev.type === "acid" && ev.midi !== undefined) {
        const freq = 440 * 2 ** ((ev.midi - 69) / 12);
        acids[0].trigger(freq, ev.dur / DEFAULT_SR, ev.vel);
      } else if (ev.type === "texture" && ev.freqs) {
        textures[0].trigger(ev.freqs, ev.dur / DEFAULT_SR, ev.vel);
      } else if (ev.type === "counter" && ev.midi !== undefined) {
        const freq = 440 * 2 ** ((ev.midi - 69) / 12);
        leads[(leadIdx + 2) % 4].trigger(freq, ev.dur / DEFAULT_SR, ev.vel, {
          cutoff: Math.floor(cfg.leadCutoff * 0.5),
          detune: 6,
          res: 0.3,
          lfoRate: 0.6,
          lfoDepth: 0.2
        });
        leadIdx++;
      }
      evIdx++;
    }
    if (activeBass && i >= bassNoteOffPos) {
      activeBass.noteOff();
      activeBass = null;
    }
    if (activeSubBass && i >= subBassNoteOffPos) {
      activeSubBass.noteOff();
      activeSubBass = null;
    }
    if (activePad && i >= padNoteOffPos) {
      activePad.noteOff();
      activePad = null;
    }
    let drumL = 0;
    let drumR = 0;
    let bassL = 0;
    let bassR = 0;
    let musicL = 0;
    let musicR = 0;
    let kickMono = 0;
    if (kickSample?.active)
      kickMono += kickSample.render()[0];
    for (const v of kicks)
      if (v.active)
        kickMono += v.render()[0];
    if (kickMono !== 0) {
      const [kl, kr] = fxKick.process(kickMono);
      drumL += kl;
      drumR += kr;
    }
    let bassMono = 0;
    if (activeBass?.active)
      bassMono += activeBass.render()[0];
    if (bassMono !== 0) {
      const [bassLow, bassHigh] = bassXover.process(bassMono);
      const bassDucked = bassLow * duckEnv + bassHigh;
      const [bl, br] = fxBass.process(bassDucked * cfg.bassGain);
      bassL += bl;
      bassR += br;
    }
    let subMono = 0;
    if (activeSubBass?.active)
      subMono += activeSubBass.render()[0];
    if (subMono !== 0) {
      const [sl, sr] = fxSubBass.process(subMono * cfg.subBassGain);
      bassL += sl;
      bassR += sr;
    }
    let leadMono = 0;
    for (const v of leads)
      if (v.active)
        leadMono += v.render()[0];
    if (leadMono !== 0) {
      const [ll, lr] = fxLead.process(leadMono * cfg.leadGain);
      musicL += ll;
      musicR += lr;
    }
    if (leadMono !== 0) {
      const [cl, cr] = fxCounter.process(leadMono * 0.3 * cfg.leadGain);
      musicL += cl;
      musicR += cr;
    }
    let hatMono = 0;
    if (hatSample?.active)
      hatMono += hatSample.render()[0];
    for (const v of hats)
      if (v.active && !v.open)
        hatMono += v.render()[0];
    if (hatMono !== 0) {
      const [hl, hr] = fxHat.process(hatMono * cfg.hatGain);
      drumL += hl;
      drumR += hr;
    }
    let openHatMono = 0;
    for (const v of hats)
      if (v.active && v.open)
        openHatMono += v.render()[0];
    if (openHatMono !== 0) {
      const [ohl, ohr] = fxOpenHat.process(openHatMono * cfg.openHatGain);
      drumL += ohl;
      drumR += ohr;
    }
    let clapMono = 0;
    if (clapSample?.active)
      clapMono += clapSample.render()[0];
    if (clapMono !== 0) {
      const [cl, cr] = fxClap.process(clapMono);
      drumL += cl;
      drumR += cr;
    }
    let percMono = 0;
    if (percSample?.active)
      percMono += percSample.render()[0];
    if (percMono !== 0) {
      const [pl, pr] = fxPerc.process(percMono);
      drumL += pl;
      drumR += pr;
    }
    let snareMono = 0;
    for (const v of snares)
      if (v.active)
        snareMono += v.render()[0];
    if (snareMono !== 0) {
      const [sl, sr] = fxSnare.process(snareMono * cfg.snareGain);
      drumL += sl;
      drumR += sr;
    }
    let shakerMono = 0;
    for (const v of shakers)
      if (v.active)
        shakerMono += v.render()[0];
    if (shakerMono !== 0) {
      const [sl, sr] = fxShaker.process(shakerMono * cfg.shakerGain);
      drumL += sl;
      drumR += sr;
    }
    let padMono = 0;
    if (activePad?.active)
      padMono += activePad.render()[0];
    if (padMono !== 0) {
      const [pl, pr] = fxPad.process(padMono * cfg.padGain);
      musicL += pl;
      musicR += pr;
    }
    let riserMono = 0;
    for (const v of risers)
      if (v.active)
        riserMono += v.render()[0];
    if (riserMono !== 0) {
      const [rl, rr] = fxRiser.process(riserMono);
      musicL += rl;
      musicR += rr;
    }
    let impactMono = 0;
    for (const v of impacts)
      if (v.active)
        impactMono += v.render()[0];
    if (impactMono !== 0) {
      const [il, ir] = fxImpact.process(impactMono);
      bassL += il;
      bassR += ir;
    }
    let acidMono = 0;
    for (const v of acids)
      if (v.active)
        acidMono += v.render()[0];
    if (acidMono !== 0) {
      const [al, ar] = fxLead.process(acidMono);
      musicL += al;
      musicR += ar;
    }
    let textureMono = 0;
    for (const v of textures)
      if (v.active)
        textureMono += v.render()[0];
    if (textureMono !== 0) {
      const [tl, tr] = fxPad.process(textureMono);
      musicL += tl;
      musicR += tr;
    }
    drumL = drumBusL.process(drumL, DEFAULT_SR);
    drumR = drumBusR.process(drumR, DEFAULT_SR);
    bassL = bassBusL.process(bassL, DEFAULT_SR);
    bassR = bassBusR.process(bassR, DEFAULT_SR);
    musicL = musicBusL.process(musicL, DEFAULT_SR);
    musicR = musicBusR.process(musicR, DEFAULT_SR);
    if (stemsEnabled && stemsDrumL && stemsDrumR && stemsBassL && stemsBassR && stemsMusicL && stemsMusicR) {
      stemsDrumL[i] = drumL * energyMul;
      stemsDrumR[i] = drumR * energyMul;
      stemsBassL[i] = bassL * energyMul;
      stemsBassR[i] = bassR * energyMul;
      stemsMusicL[i] = musicL * energyMul;
      stemsMusicR[i] = musicR * energyMul;
    }
    let mixL = (drumL + bassL * duckEnv + musicL * duckEnv) * energyMul;
    let mixR = (drumR + bassR * duckEnv + musicR * duckEnv) * energyMul;
    mixL = masterGlueL.process(mixL, DEFAULT_SR);
    mixR = masterGlueR.process(mixR, DEFAULT_SR);
    samplesL[i] = Number.isFinite(mixL) ? Math.max(-1.5, Math.min(1.5, mixL)) : 0;
    samplesR[i] = Number.isFinite(mixR) ? Math.max(-1.5, Math.min(1.5, mixR)) : 0;
    duckEnv += (1 - duckEnv) * (1 / (0.15 * DEFAULT_SR));
  }
  const hpState = [0, 0];
  const hpA = 1 / DEFAULT_SR * 2 * Math.PI * MASTER_SPEC.hpFreq;
  for (let i = 0;i < totalSamples; i++) {
    hpState[0] += hpA * (samplesL[i] - hpState[0]) / (1 + hpA);
    hpState[1] += hpA * (samplesR[i] - hpState[1]) / (1 + hpA);
    samplesL[i] = samplesL[i] - hpState[0];
    samplesR[i] = samplesR[i] - hpState[1];
  }
  const msMonoFreq = 120;
  const msHighFreq = 3000;
  const msWiden = 1.5;
  const msA = 1 / DEFAULT_SR * 2 * Math.PI * msMonoFreq;
  const msMonoLpCoef = msA / (1 + msA);
  const msB = 1 / DEFAULT_SR * 2 * Math.PI * msHighFreq;
  const msHighLpCoef = msB / (1 + msB);
  let msLowState = 0;
  let msHighState = 0;
  for (let i = 0;i < totalSamples; i++) {
    const l = samplesL[i];
    const r = samplesR[i];
    const mid = (l + r) * 0.5;
    let side = (l - r) * 0.5;
    msLowState += msMonoLpCoef * (side - msLowState);
    side -= msLowState;
    msHighState += msHighLpCoef * (side - msHighState);
    const sideHigh = side - msHighState;
    side += (msWiden - 1) * sideHigh;
    samplesL[i] = mid + side;
    samplesR[i] = mid - side;
  }
  const multiband = new MultibandCompressor({ sampleRate: DEFAULT_SR });
  multiband.processBuffer(samplesL, samplesR);
  const ott = new OTT({
    sampleRate: DEFAULT_SR,
    depth: 0.3,
    upwardGainDb: 2,
    downwardGainDb: -2,
    thresholdDb: -24,
    attackMs: 2,
    releaseMs: 100
  });
  ott.processBuffer(samplesL, samplesR);
  let glueEnv = 0;
  const glueA = 1 - Math.exp(-1 / (MASTER_SPEC.glueAttack * DEFAULT_SR));
  const glueR = 1 - Math.exp(-1 / (MASTER_SPEC.glueRelease * DEFAULT_SR));
  for (let i = 0;i < totalSamples; i++) {
    const abs = Math.max(Math.abs(samplesL[i]), Math.abs(samplesR[i]));
    const coef = abs > glueEnv ? glueA : glueR;
    glueEnv += (abs - glueEnv) * coef;
    let glueGain = 1;
    if (glueEnv > MASTER_SPEC.glueThr) {
      const over = glueEnv - MASTER_SPEC.glueThr;
      const reduction = over * (1 - 1 / MASTER_SPEC.glueRatio);
      glueGain = (glueEnv - reduction) / glueEnv;
    }
    samplesL[i] = samplesL[i] * glueGain * MASTER_SPEC.glueMakeup;
    samplesR[i] = samplesR[i] * glueGain * MASTER_SPEC.glueMakeup;
  }
  for (let i = 0;i < totalSamples; i++) {
    const satL = fastTanh(samplesL[i] * MASTER_SPEC.satDrive);
    const satR = fastTanh(samplesR[i] * MASTER_SPEC.satDrive);
    samplesL[i] = samplesL[i] * (1 - MASTER_SPEC.satMix) + satL * MASTER_SPEC.satMix;
    samplesR[i] = samplesR[i] * (1 - MASTER_SPEC.satMix) + satR * MASTER_SPEC.satMix;
  }
  const widener = new StereoWidener(cfg.stereoWidth);
  widener.processBuffer(samplesL, samplesR);
  const monoCompat = widener.getMonoCompatibility();
  const lufsResult = measureLUFS(samplesL, samplesR, DEFAULT_SR);
  const gainOffset = lufsToGainOffset(lufsResult.integratedLUFS, targetLufs);
  const fullGain = Math.max(0.1, Math.min(8, gainOffset));
  for (let i = 0;i < totalSamples; i++) {
    samplesL[i] = (samplesL[i] ?? 0) * fullGain;
    samplesR[i] = (samplesR[i] ?? 0) * fullGain;
  }
  const limiter = new TruePeakLimiter({ thresholdDb: -1.5, ceilingDb: -1.5, sampleRate: DEFAULT_SR });
  limiter.processBuffer(samplesL, samplesR);
  const firstPassLufs = measureLUFS(samplesL, samplesR, DEFAULT_SR);
  const deficitDb = targetLufs - firstPassLufs.integratedLUFS;
  if (deficitDb > 0.1) {
    const extraGain = Math.min(10 ** (deficitDb / 20), 4);
    for (let i = 0;i < totalSamples; i++) {
      samplesL[i] = (samplesL[i] ?? 0) * extraGain;
      samplesR[i] = (samplesR[i] ?? 0) * extraGain;
    }
    const limiter2 = new TruePeakLimiter({ thresholdDb: -1.5, ceilingDb: -1.5, sampleRate: DEFAULT_SR });
    limiter2.processBuffer(samplesL, samplesR);
  }
  for (let i = 0;i < totalSamples; i++) {
    let l = samplesL[i] ?? 0;
    let r = samplesR[i] ?? 0;
    if (l > 1)
      l = 1;
    else if (l < -1)
      l = -1;
    if (r > 1)
      r = 1;
    else if (r < -1)
      r = -1;
    samplesL[i] = l;
    samplesR[i] = r;
  }
  const finalLufs = measureLUFS(samplesL, samplesR, DEFAULT_SR);
  const stereoWidth = StereoWidener.measureWidth(samplesL, samplesR);
  return {
    samplesL,
    samplesR,
    sampleRate: DEFAULT_SR,
    durationSec: totalSamples / DEFAULT_SR,
    bars: renderBars.length,
    events: events.length,
    lufs: finalLufs.integratedLUFS,
    truePeakDb: finalLufs.truePeakDb,
    samplePeakDb: finalLufs.samplePeakDb,
    stereoWidth,
    monoCompatibility: monoCompat,
    gainReductionDb: limiter.getMaxGainReductionDb(),
    stems: stemsEnabled && stemsDrumL && stemsDrumR && stemsBassL && stemsBassR && stemsMusicL && stemsMusicR ? {
      drumL: stemsDrumL,
      drumR: stemsDrumR,
      bassL: stemsBassL,
      bassR: stemsBassR,
      musicL: stemsMusicL,
      musicR: stemsMusicR
    } : undefined
  };
}

// apps/web/src/workers/render-worker.ts
var port = parentPort;
function send(reply) {
  if (port)
    port.postMessage(reply);
  else
    process.send(reply);
}
if (!port && typeof process.send !== "function") {
  throw new Error("render-worker must run under worker_threads parentPort or child_process IPC");
}
var onMessage = async (raw) => {
  const job = raw;
  try {
    const engine = new CompositionEngine({
      seed: job.seed,
      context: job.ctx,
      identity: createIdentityA()
    });
    const section = engine.composeSection({ bars: job.bars });
    const result = await renderFoundationSection(section, {
      useSamples: job.useSamples,
      bpm: job.bpm,
      config: job.config,
      stems: job.wantStems
    });
    const reply = {
      id: job.id,
      ok: true,
      samplesL: result.samplesL,
      samplesR: result.samplesR,
      sampleRate: result.sampleRate,
      durationSec: result.durationSec,
      bars: result.bars,
      events: result.events,
      lufs: result.lufs,
      truePeakDb: result.truePeakDb,
      samplePeakDb: result.samplePeakDb,
      stereoWidth: result.stereoWidth,
      monoCompatibility: result.monoCompatibility,
      gainReductionDb: result.gainReductionDb,
      stems: result.stems ? {
        drumL: result.stems.drumL,
        drumR: result.stems.drumR,
        bassL: result.stems.bassL,
        bassR: result.stems.bassR,
        musicL: result.stems.musicL,
        musicR: result.stems.musicR
      } : null
    };
    send(reply);
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    send({ id: job.id, ok: false, error: message });
  }
};
if (port) {
  port.on("message", (raw) => {
    onMessage(raw);
  });
} else {
  process.on("message", (raw) => {
    onMessage(raw);
  });
}

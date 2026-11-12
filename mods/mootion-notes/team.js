// Teammates: every agent gets its own color and face, kept in shared("notion.agentColors")
// and shared("notion.agentFaces") ({ [address]: color | face index }) so the sidebar, toast,
// inbox and page header agree. The sidebar assigns them; the others only read them.
// Faces never repeat among running agents until there are more agents than faces.
// Names: each agent gets a person's name (unique among running agents), editable with the
// mootion-rename dialog; custom names live in shared("notion.agentNames") too.
// Customization (the mootion-customize page) lives in shared("notion.custom"):
//   { title, me, faces: [paths], names: [names], notesFace, extraFace }  — all optional, defaults below.
// Once every face is taken by a running agent, new agents get the extra face (index -1) instead
// of repeating one.
// The Notes agent (shared("notion.notes").agent) always shows as "Notes" with its own face
// and is left out of face and name assignment.
// This file is copied into every mootion-* mod that draws agents.

import { div, image, svg } from "gpui-kit";
import { shared, setShared } from "herdr";

// Notion's tag colors: orange, green, blue, purple, pink, red, yellow, teal, brown, gray.
export const COLORS = ["#d9730d", "#448361", "#337ea9", "#9065b0", "#c14c8a", "#d44c47", "#cb912f", "#2b8a8a", "#8a5a44", "#6f6e69"];

function hash(text) {
  let h = 0;
  for (const ch of text ?? "") h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h;
}

export const DEFAULT_FACES = [1, 2, 3, 4].map(n => `mods/mootion-sidebar/avatars/face-${n}.png`);
const DEFAULT_ME = "mods/mootion-sidebar/avatars/me.png";
const DEFAULT_NOTES_FACE = "mods/mootion-sidebar/avatars/notes.png";
const DEFAULT_EXTRA_FACE = "mods/mootion-sidebar/avatars/extra.png";
export const DEFAULT_TITLE = "Hey, yo!";

export const custom = () => shared("notion.custom") ?? {};
const faces = () => (custom().faces?.length ? custom().faces : DEFAULT_FACES);
export const mePicture = () => custom().me || DEFAULT_ME;
export const title = () => custom().title || DEFAULT_TITLE;
export const notes = () => shared("notion.notes") ?? {};
export const isNotes = (address) => Boolean(address) && notes().agent === address;
export const notesFace = () => custom().notesFace || DEFAULT_NOTES_FACE;
export const extraFace = () => custom().extraFace || DEFAULT_EXTRA_FACE;
// Kept for callers written before customization.
export const ME = DEFAULT_ME;

export function agentFace(address) {
  if (isNotes(address)) return notesFace();
  const list = faces();
  const index = shared("notion.agentFaces")?.[address];
  if (index === -1) return extraFace();
  return list[(index ?? hash(address)) % list.length];
}

// The agent's color mixed toward white: light enough for the black line-art faces in both themes.
function pastel(hex, amount = 0.7) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(c + (255 - c) * amount).toString(16).padStart(2, "0");
  return `#${mix(n >> 16)}${mix((n >> 8) & 255)}${mix(n & 255)}`;
}

export function agentColor(address) {
  return shared("notion.agentColors")?.[address] ?? COLORS[hash(address) % COLORS.length];
}

// Gives each running agent a face no other running agent has (least used once all are taken).
function assignFaces(addresses, keep) {
  const FACES = faces();
  const old = shared("notion.agentFaces") ?? {};
  const next = Object.fromEntries(Object.entries(old).filter(([a]) => keep.has(a)));
  let changed = Object.keys(next).length !== Object.keys(old).length;
  const running = new Set(addresses);
  // Two running agents can share a face from earlier assignments: free the newer one.
  const seen = new Set();
  for (const address of addresses) {
    if (next[address] === undefined || next[address] === -1) continue;
    if (next[address] >= FACES.length || (seen.has(next[address]) && seen.size < FACES.length)) { delete next[address]; changed = true; }
    else seen.add(next[address]);
  }
  for (const address of addresses) {
    if (next[address] !== undefined) continue;
    const used = FACES.map((_, i) => Object.entries(next).filter(([a, f]) => f === i && running.has(a)).length);
    const free = used.indexOf(0);
    next[address] = free >= 0 ? free : -1;
    changed = true;
  }
  if (changed) setShared("notion.agentFaces", next);
}

// Gives new agents a color and a face, and forgets agents that are gone (keeping ones the inbox remembers).
export function assignTeam(all) {
  const addresses = all.filter(a => !isNotes(a));
  const keep = new Set([...addresses, ...Object.keys(shared("notion.inbox") ?? {})]);
  assignFaces(addresses, keep);
  assignNames(addresses, keep);
  assignColors(addresses, keep);
}

function assignColors(addresses, keep) {
  const old = shared("notion.agentColors") ?? {};
  const next = Object.fromEntries(Object.entries(old).filter(([a]) => keep.has(a)));
  let changed = Object.keys(next).length !== Object.keys(old).length;
  for (const address of addresses) {
    if (next[address]) continue;
    const used = COLORS.map(c => Object.values(next).filter(v => v === c).length);
    next[address] = COLORS[used.indexOf(Math.min(...used))];
    changed = true;
  }
  if (changed) setShared("notion.agentColors", next);
}

// Gender-neutral names, picked at random among the ones no running agent has.
export const DEFAULT_NAMES = ["Alex", "Sam", "Robin", "Jordan", "Taylor", "Casey", "Riley", "Morgan", "Jamie", "Avery",
  "Quinn", "Rowan", "Sage", "River", "Charlie", "Kai", "Noa", "Eden", "Ari", "Remy", "Skyler", "Emery", "Finley", "Reese"];
// Names the first version handed out; agents that still have one get a new name once.
const OLD_DEFAULTS = new Set(["Ada", "Grace", "Alan", "Linus", "Margaret", "Dennis", "Hedy", "Ken", "Radia", "Guido",
  "Barbara", "Tim", "Frances", "Edsger", "Katherine", "Donald", "Joan", "Bjarne", "Lynn", "Brian"]);

// The agent's name: a custom one, else the person's name it was given, else its program.
const names = () => (custom().names?.length ? custom().names : DEFAULT_NAMES);

export function agentName(a) {
  if (isNotes(a.address)) return "Notes";
  return shared("notion.agentNames")?.[a.address] ?? (a.program?.name ?? a.app ?? "Agent").replace(/ Code$/, "");
}
// Kept for callers written before names: the name people see.
export const firstName = agentName;
// The harness running it ("Claude Code", "Codex", …).
export const harness = (a) => a.program?.name ?? a.app ?? "Agent";

function assignNames(addresses, keep) {
  const NAMES = names();
  const old = shared("notion.agentNames") ?? {};
  const next = Object.fromEntries(Object.entries(old).filter(([a]) => keep.has(a)));
  let changed = Object.keys(next).length !== Object.keys(old).length;
  if (!shared("notion.namesV2")) {
    for (const [address, name] of Object.entries(next)) if (OLD_DEFAULTS.has(name)) delete next[address];
    setShared("notion.namesV2", true);
    changed = true;
  }
  for (const address of addresses) {
    if (next[address]) continue;
    const taken = new Set(addresses.map(a => next[a]).filter(Boolean));
    const free = NAMES.filter(n => !taken.has(n));
    next[address] = free.length ? free[Math.floor(Math.random() * free.length)]
      : `${NAMES[Math.floor(Math.random() * NAMES.length)]} ${Math.floor(taken.size / NAMES.length) + 1}`;
    changed = true;
  }
  if (changed) setShared("notion.agentNames", next);
}

export function setAgentName(address, name) {
  const names = { ...(shared("notion.agentNames") ?? {}) };
  if (name?.trim()) names[address] = name.trim();
  setShared("notion.agentNames", names);
}

// A teammate's avatar: their face on a circle of their color (pastel), and optionally a presence
// dot (`ring` is the color behind the avatar) and a bubble with the harness's own icon, whose
// tooltip names it ("Claude Code"). The bubble sits on the top-right, out of the face's way.
export function avatar(t, a, size, ring, badge = false) {
  let el = div().relative().flex_none().size(size).rounded_full().bg(pastel(agentColor(a.address)))
    .flex().items_center().justify_center()
    .child(image(agentFace(a.address)).size(size).rounded_full());
  if (badge && a.program?.icon) {
    const b = Math.max(11, Math.round(size * 0.46));
    const icon = a.program.tint ? svg(a.program.icon).size(b - 4).text_color(t.foreground) : image(a.program.icon).size(b - 4);
    el = el.child(div().id(`badge-${a.address}-${size}`).absolute().top(-3).right(-4).size(b).rounded_full().bg(t.popover)
      .border(1).border_color(ring ?? t.border).flex().items_center().justify_center()
      .tooltip(harness(a)).child(icon));
  }
  if (!ring) return el;
  const dot = a.status === "idle" ? t.idle : t[a.status];
  return el.child(div().absolute().right(-2).bottom(-2).size(Math.max(9, size * 0.36)).rounded_full().bg(dot)
    .border(2).border_color(ring)
    .when(a.status === "working", d => d.loop("opacity", { from: 0.35, to: 1, period: 1400 })));
}

// The person's own avatar ("You").
export function me(size) {
  return div().flex_none().size(size).rounded_full().bg("#f1f1ef").child(image(mePicture()).size(size).rounded_full());
}

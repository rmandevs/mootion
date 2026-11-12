// The sidebar's sections, in order, in shared("notion.sidebar") = { sections: [...] }.
// Built-in kinds appear once each: "notes", "spaces" (every space no group claims) and "team".
// "group" sections are the person's own: a title and the spaces in it ({ spaces: [ids] }); a
// space belongs to one group at most. Any section can be renamed, moved and hidden; groups can
// also be deleted (their spaces go back to Spaces). This file is copied into every mootion-* mod
// that edits sections.

import { shared, setShared } from "herdr";

export const BUILT_IN = [
  { id: "notes", kind: "notes", title: "Notes" },
  { id: "spaces", kind: "spaces", title: "Spaces" },
  { id: "team", kind: "team", title: "Team" },
];

// Every section, built-ins included (one added later, or missing from an old save, shows at the end).
export function sections() {
  const saved = shared("notion.sidebar")?.sections ?? BUILT_IN;
  const out = saved.filter(s => s.kind === "group" || BUILT_IN.some(b => b.id === s.id));
  for (const b of BUILT_IN) if (!out.some(s => s.id === b.id)) out.push({ ...b });
  return out;
}

const save = (list) => setShared("notion.sidebar", { sections: list });
const update = (id, patch) => save(sections().map(s => (s.id === id ? { ...s, ...patch } : s)));

export function addSection(title, icon) {
  const id = `g${Date.now().toString(36)}`;
  save([...sections(), { id, kind: "group", title: title.trim() || "Untitled", icon: icon ?? null, spaces: [] }]);
  return id;
}

export const renameSection = (id, title) => update(id, { title: title.trim() || "Untitled" });
export const setHidden = (id, hidden) => update(id, { hidden });
export const removeSection = (id) => save(sections().filter(s => !(s.id === id && s.kind === "group")));

export function moveSection(id, delta) {
  const list = sections();
  const i = list.findIndex(s => s.id === id), j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  save(list);
}

// Puts a space in a group (out of any other), or takes it out when `inGroup` is false.
export function setSpaceGroup(spaceId, groupId, inGroup) {
  save(sections().map(s => {
    if (s.kind !== "group") return s;
    const rest = (s.spaces ?? []).filter(id => id !== spaceId);
    return { ...s, spaces: s.id === groupId && inGroup ? [...rest, spaceId] : rest };
  }));
}

// The group a space is in, if any.
export const groupOf = (spaceId) => sections().find(s => s.kind === "group" && (s.spaces ?? []).includes(spaceId)) ?? null;

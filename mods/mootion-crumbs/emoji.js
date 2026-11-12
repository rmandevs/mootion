// Page icons: one emoji or icon per space, tab or Notes. Picked automatically from its name,
// changeable from the mootion-emoji picker. Overrides live in shared("notion.icons"), keyed by
// space or tab id ("notes" for the Notes section). A value is an emoji, or "icon:<name>" for one
// of the lucide icons in mods/mootion-sidebar/icons/. Draw any of them with renderIcon().
// This file is copied into every mootion-* mod that shows icons.

import { div, svg } from "gpui-kit";
import { shared, setShared } from "herdr";

export const ICON_DIR = "mods/mootion-sidebar/icons";
// The icons the picker offers (files in ICON_DIR).
export const ICONS = ["file-text", "file", "folder", "folder-open", "notebook-pen", "pencil", "book-open", "library", "house",
  "star", "heart", "bookmark", "flag", "tag", "hash", "at-sign", "inbox", "mail", "message-circle", "bell", "calendar", "clock",
  "alarm-clock", "list-todo", "square-check-big", "circle-check", "lightbulb", "sparkles", "zap", "flame", "rocket", "target",
  "trophy", "gem", "crown", "code", "terminal", "git-branch", "git-pull-request", "bug", "wrench", "hammer", "cog", "settings",
  "database", "server", "cloud", "globe", "link", "lock", "key", "shield", "package", "box", "layers", "layout-grid",
  "chart-column", "chart-line", "chart-pie", "briefcase", "building", "users", "user", "bot", "brain", "cpu", "monitor",
  "smartphone", "palette", "brush", "image", "camera", "music", "film", "gamepad-2", "coffee", "leaf", "sun", "moon",
  "snowflake", "map", "compass", "plane", "car", "shopping-cart", "wallet", "dollar-sign", "graduation-cap", "flask-conical",
  "microscope", "puzzle"];

// An emoji or an "icon:<name>" value, drawn at `size` (icons take `color`, emoji ignore it).
export function renderIcon(value, size, color) {
  if (typeof value === "string" && value.startsWith("icon:"))
    return div().size(size + 2).flex_none().flex().items_center().justify_center()
      .child(svg(`${ICON_DIR}/${value.slice(5)}.svg`).size(size).text_color(color));
  return div().flex_none().text_size(size).child(value ?? "");
}

export function notesIcon() {
  return shared("notion.icons")?.notes ?? "✏️";
}

const KEYWORDS = [
  [/^~$|home/i, "🏠"], [/test|spec|qa/i, "🧪"], [/doc|slide|deck|readme|wiki/i, "📊"],
  [/mcp|plugin|integration|api/i, "🔌"], [/snow|servicenow|ticket|incident/i, "❄️"],
  [/mail|outlook|inbox/i, "📬"], [/triage|alert|oncall|health/i, "🩺"],
  [/infra|terraform|k8s|kube|cloud|azure|aws/i, "🏗️"], [/ui|design|css|front/i, "🎨"],
  [/bug|fix|hotfix/i, "🐛"], [/data|sql|db|query/i, "🗄️"], [/sec|auth|vault|key/i, "🔐"],
  [/bot|agent|claude|ai|llm/i, "🤖"], [/web|site|blog/i, "🌐"], [/script|cli|tool/i, "🧰"],
];
const POOL = ["📁", "🧩", "🛠️", "🚀", "📦", "🌱", "🔭", "🧭", "⚙️", "🪴", "📐", "🗂️", "🧱", "🛰️", "🔬", "🌊"];

function hash(text) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h;
}

export function autoIcon(name, id) {
  for (const [re, emoji] of KEYWORDS) if (re.test(name ?? "")) return emoji;
  return POOL[hash(id ?? name ?? "") % POOL.length];
}

export function spaceIcon(space) {
  return shared("notion.icons")?.[space.id] ?? autoIcon(space.name, space.id);
}

export function tabIcon(tab) {
  return shared("notion.icons")?.[tab.id] ?? (tab.status ? "💬" : "📄");
}

export function setIcon(id, emoji) {
  const icons = { ...(shared("notion.icons") ?? {}) };
  if (emoji) icons[id] = emoji;
  else delete icons[id];
  setShared("notion.icons", icons);
}

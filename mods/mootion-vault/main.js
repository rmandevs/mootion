// Vault: browse and read a local notes folder (an Obsidian vault) as Notion-style pages.
// A pane mod, opened as a tab of the Notes space: tab.new { space, mod: "mootion-vault", props: { folder } }.
// Left: every Markdown note in a folder tree, with search. Right: the note, with its frontmatter
// as properties and [[wikilinks]] you can click. Read-only; "Open in Obsidian" to edit.
// Only works on a folder on this computer: Notion, Craft and other cloud notes have no files here.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextView } from "gpui-base";
import { props, exec, readTextFile, watchFolder, theme, home } from "herdr";

const MAX_NOTES = 5000;
// Lucide icons shipped with mootion-sidebar (the vault draws icons, not emoji).
const ICON = (name) => `mods/mootion-sidebar/icons/${name}.svg`;
const SKIP = ["/.obsidian/", "/.trash/", "/.git/", "/node_modules/"];

function pretty(path) {
  const h = home();
  return path?.startsWith(h + "/") ? "~" + path.slice(h.length) : path;
}

// Splits "---\nkey: value\n---\nbody" into simple properties and the body.
function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { props: [], body: text };
  const props = [];
  let last = null;
  for (const line of m[1].split("\n")) {
    const kv = /^([A-Za-z0-9_ -]+):\s*(.*)$/.exec(line);
    if (kv) { last = [kv[1].trim(), kv[2].trim()]; props.push(last); }
    else if (last && /^\s*-\s+/.test(line)) last[1] = [last[1], line.replace(/^\s*-\s+/, "")].filter(Boolean).join(", ");
  }
  return { props: props.filter(([, v]) => v), body: text.slice(m[0].length) };
}

// [[Note]] and [[Note|label]] become links the view resolves to notes in this vault.
const wikilinks = (body) => body.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g,
  (_m, target, label) => `[${label ?? target}](vault:${encodeURIComponent(target.trim())})`);

export default class Vault extends View {
  init(_props, cx) {
    this.folder = props()?.folder ?? null;
    this.notes = [];
    this.open = new Set();
    this.query = "";
    this.search = InputState.new({ placeholder: "Search notes" });
    this.search.on("change", (_e, cx) => { this.query = this.search.value().trim().toLowerCase(); cx.notify(); });
    if (this.folder) {
      this.load(cx);
      cx.spawn(async (cx) => {
        try { for (;;) { await watchFolder(this.folder); this.load(cx); if (this.file) this.show(this.file, cx); } }
        catch { /* the timer below still refreshes */ }
      });
      cx.timer.every(30000, (cx) => this.load(cx));
    }
  }

  load(cx) {
    cx.spawn(async (cx) => {
      const r = await exec("find", [this.folder, "-type", "f", "-name", "*.md"], { timeout: 20000 }).catch(e => ({ code: 1, stderr: String(e) }));
      if (r.code !== 0 && !r.stdout) { this.error = (r.stderr || "Cannot read this folder").trim(); cx.notify(); return; }
      this.notes = r.stdout.split("\n").filter(p => p && !SKIP.some(s => p.includes(s)))
        .map(p => p.slice(this.folder.length + 1)).sort((a, b) => a.localeCompare(b)).slice(0, MAX_NOTES);
      this.error = null;
      if (!this.file) {
        const start = this.notes.find(n => /^(readme|index|home|welcome)\.md$/i.test(n.split("/").pop())) ?? this.notes[0];
        if (start) this.show(start, cx);
      }
      cx.notify();
    });
  }

  show(rel, cx) {
    this.file = rel;
    for (let i = rel.indexOf("/"); i > 0; i = rel.indexOf("/", i + 1)) this.open.add(rel.slice(0, i));
    cx.spawn(async (cx) => {
      const text = await readTextFile(`${this.folder}/${rel}`).catch(() => null);
      if (this.file !== rel) return;
      this.page = text === null ? null : frontmatter(text);
      this.pageError = text === null ? "This note can't be read (it may be too large, over 1 MB)." : null;
      cx.notify();
    });
    cx.notify();
  }

  follow(url, cx) {
    if (url.startsWith("vault:")) {
      const target = decodeURIComponent(url.slice(6)).toLowerCase();
      const hit = this.notes.find(n => n.toLowerCase() === `${target}.md` || n.toLowerCase().endsWith(`/${target}.md`))
        ?? this.notes.find(n => n.toLowerCase() === target);
      if (hit) this.show(hit, cx);
      else { this.pageError = `No note called "${decodeURIComponent(url.slice(6))}" in this vault yet.`; cx.notify(); }
    } else exec("open", [url]);
  }

  tree(t) {
    if (this.query) {
      return this.notes.filter(n => n.toLowerCase().includes(this.query)).slice(0, 300)
        .map(n => this.noteRow(t, n, 0, true));
    }
    const rows = [];
    const walk = (prefix, depth) => {
      const here = this.notes.filter(n => n.startsWith(prefix) && n !== prefix);
      const folders = [...new Set(here.map(n => n.slice(prefix.length)).filter(n => n.includes("/")).map(n => n.split("/")[0]))];
      for (const f of folders) {
        const path = prefix + f, open = this.open.has(path);
        rows.push(h_flex().id(`dir-${path}`).h(28).flex_none().pl(6 + depth * 18).pr(8).gap(6).items_center().rounded(5)
          .cursor_pointer().text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => { open ? this.open.delete(path) : this.open.add(path); cx.notify(); })
          .child(svg(`mods/mootion-vault/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none().text_color(t.dim))
          .child(div().w(18).flex_none().child(svg(ICON(open ? "folder-open" : "folder")).size(14).text_color(t.muted)))
          .child(div().flex_1().min_w(0).truncate().child(f)));
        if (open) walk(path + "/", depth + 1);
      }
      for (const n of here.filter(n => !n.slice(prefix.length).includes("/"))) rows.push(this.noteRow(t, n, depth, false));
    };
    walk("", 0);
    return rows;
  }

  noteRow(t, rel, depth, showPath) {
    const name = rel.split("/").pop().replace(/\.md$/i, "");
    const on = this.file === rel;
    return h_flex().id(`note-${rel}`).h(28).flex_none().pl(23 + depth * 18).pr(8).gap(6).items_center().rounded(5).cursor_pointer()
      .bg(on ? t.hover : t.background).text_color(on ? t.foreground : t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => this.show(rel, cx))
      .child(div().w(18).flex_none().child(svg(ICON("file-text")).size(14).text_color(on ? t.foreground : t.dim)))
      .child(div().flex_1().min_w(0).truncate().child(name))
      .when(showPath && rel.includes("/"), e => e.child(div().max_w(110).truncate().text_size(11.5).text_color(t.dim).child(rel.split("/").slice(0, -1).join("/"))));
  }

  render() {
    const t = theme();
    if (!this.folder) {
      return v_flex().size_full().p(32).gap(8).bg(t.background).text_color(t.muted).text_size(14)
        .child(svg(ICON("library")).size(32).text_color(t.muted))
        .child(div().text_size(18).font_semibold().text_color(t.foreground).child("Vault view needs a local folder"))
        .child(div().child("It reads Markdown notes from a folder on this computer, like an Obsidian vault."))
        .child(div().child("Notion, Craft and other cloud notes have no files here: ask the Notes agent about them instead."));
    }
    const name = this.file?.split("/").pop().replace(/\.md$/i, "");
    return h_flex().size_full().bg(t.background).text_color(t.foreground).text_size(14)
      .child(v_flex().w(280).flex_none().h_full().border_r(1).border_color(t.border)
        .child(v_flex().flex_none().px(12).pt(12).pb(8).gap(8)
          .child(div().text_size(12).text_color(t.dim).child(`${this.notes.length} notes in ${pretty(this.folder)}`))
          .child(h_flex().id("vault-search").h(30).px(8).items_center().rounded(5).border(1).border_color(t.input)
            .child(Input.new(this.search).flex_1().text_size(13).text_color(t.foreground))))
        .child(v_flex().id("vault-tree").flex_1().min_h(0).px(6).pb(10).overflow_y_scrollbar()
          .children(this.tree(t))
          .when(Boolean(this.error), e => e.child(div().p(8).text_size(12.5).text_color(t.blocked).child(this.error)))
          .when(!this.error && !this.notes.length, e => e.child(div().p(8).text_size(12.5).text_color(t.dim).child("No Markdown notes in this folder.")))))
      .child(v_flex().id("vault-page").flex_1().min_w(0).h_full().overflow_y_scrollbar()
        .when(Boolean(this.file), el => el.child(v_flex().px(56).pt(20).pb(40).gap(6).max_w(860)
          .child(svg(ICON("file-text")).size(34).text_color(t.muted))
          .child(div().text_size(28).font_bold().child(name))
          .child(h_flex().gap(12).items_center().text_size(12.5).text_color(t.dim)
            .child(div().min_w(0).truncate().child(pretty(`${this.folder}/${this.file}`)))
            .child(div().id("open-obsidian").flex_none().px(8).h(24).flex().items_center().rounded(5).border(1).border_color(t.border)
              .text_color(t.foreground).cursor_pointer().hover(s => s.bg(t.hover))
              .on_click(() => exec("open", [`obsidian://open?path=${encodeURIComponent(`${this.folder}/${this.file}`)}`]))
              .child("Open in Obsidian")))
          .when(Boolean(this.page?.props.length), e => e.child(v_flex().py(6).gap(4).border_b(1).border_color(t.border)
            .children(this.page.props.map(([k, v], i) => h_flex().id(`prop-${i}`).gap(12).text_size(13)
              .child(div().w(120).flex_none().text_color(t.dim).child(k))
              .child(div().flex_1().min_w(0).child(v))))))
          .when(Boolean(this.pageError), e => e.child(div().text_size(13).text_color(t.blocked).child(this.pageError)))
          .when(Boolean(this.page), e => e.child(div().pt(8).text_size(15)
            .child(TextView.markdown(`md-${this.file}`, wikilinks(this.page.body)).selectable(true)
              .on_link_click((url, cx) => this.follow(url, cx)))))))
        .when(!this.file, el => el.child(div().p(32).text_color(t.dim).child(this.notes.length ? "Pick a note." : "Loading notes…"))));
  }
}

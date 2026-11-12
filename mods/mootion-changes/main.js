// Changes for layouts/mootion.json, read like a Notion doc: one toggle per changed file,
// and under the open one a code block (language, +/− counts, Copy) with the diff.
// Cloned from the shipped `changes` mod; git reads and commit are unchanged.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, run } from "herdr";

const LANGS = { js: "JavaScript", mjs: "JavaScript", cjs: "JavaScript", jsx: "JavaScript", ts: "TypeScript", tsx: "TypeScript",
  py: "Python", rs: "Rust", go: "Go", java: "Java", rb: "Ruby", sh: "Shell", zsh: "Shell", json: "JSON", yml: "YAML",
  yaml: "YAML", toml: "TOML", md: "Markdown", html: "HTML", css: "CSS", sql: "SQL", tf: "Terraform", svg: "SVG" };
const language = (path) => LANGS[path.split(".").pop().toLowerCase()] ?? "Plain text";
// Rows drawn per code block; the rest is a "Show more" away.
const PAGE = 400;

function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
const key = () => JSON.stringify(location());
// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const countLines = (text) => text ? text.split("\n").length - Number(text.endsWith("\n")) : 0;

// Text draws a tab as nothing: pad each to the next 4-column stop.
const untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));

// Numbers each diff line once, so a frame only draws the rows on screen.
function diffRows(lines) {
  let old = 0, next = 0;
  return lines.map((line) => {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) { old = +match[1]; next = +match[2]; return { kind: "@", text: line }; }
    const kind = line[0];
    if (kind === "-") return { kind, number: old++, text: untab(line.slice(1)) || " " };
    if (kind === "+") return { kind, number: next++, text: untab(line.slice(1)) || " " };
    if (kind === " ") { old++; return { kind, number: next++, text: untab(line.slice(1)) || " " }; }
    return { kind: "", text: line };
  });
}

export default class Changes extends View {
  init(_props, cx) {
    this.files = []; this.rows = []; this.diffWidth = 0; this.message = ""; this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Commit message" });
    this.input.on("change", (_e, cx) => {
      const hadMessage = Boolean(this.message.trim());
      this.message = this.input.value();
      if (hadMessage !== Boolean(this.message.trim())) cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.commit(cx));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.refresh(cx);
    cx.timer.every(10000, (cx) => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          if (this.watched === root) this.refresh(cx);
        }
      } catch { this.watched = null; }
    });
  }

  refresh(cx) {
    if (this.loading || this.busy) return;
    const { cwd, on } = location(), context = key();
    if (context !== this.context) {
      this.context = context; this.root = null; this.files = []; this.open = null;
      this.setLines([]); this.message = ""; this.input.set_value(""); this.error = null; this.note = null; this.watched = null; this.closed = false; this.limited = false;
    }
    if (!cwd) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        if (key() !== context) return;
        if (top.code !== 0) { this.root = null; this.files = []; this.setLines([]); this.open = null; this.error = "Not a git repository"; return; }
        const root = top.stdout.trim(), git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
        const status = await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]);
        if (status.code !== 0) throw new Error(status.stderr);
        const head = await git(["rev-parse", "--verify", "HEAD"]);
        const stats = {};
        const results = head.code === 0 ? [await git(["diff", "HEAD", "--numstat", "-z", "--no-renames"])] : [await git(["diff", "--cached", "--numstat", "-z", "--no-renames"]), await git(["diff", "--numstat", "-z", "--no-renames"])];
        for (const result of results) {
          if (result.code !== 0) throw new Error(result.stderr);
          for (const entry of result.stdout.split("\0")) {
            const [a, d, ...parts] = entry.split("\t");
            if (!parts.length) continue;
            const path = parts.join("\t"), old = stats[path] ?? { add: 0, del: 0 };
            stats[path] = { add: old.add + (Number(a) || 0), del: old.del + (Number(d) || 0), binary: a === "-" };
          }
        }
        const files = [];
        const entries = status.stdout.split("\0").filter(Boolean);
        for (const entry of entries.slice(0, 1000)) {
          const xy = entry.slice(0, 2), path = entry.slice(3), fresh = xy === "??";
          const conflict = xy.includes("U") || xy === "AA" || xy === "DD";
          const s = conflict ? "U" : xy.includes("D") ? "D" : fresh || xy.includes("A") ? "A" : "M";
          const stat = stats[path] ?? { add: 0, del: 0 };
          files.push({ path, status: s, fresh, ...stat });
        }
        if (key() !== context) return;
        this.root = root; this.on = on; this.hasHead = head.code === 0; this.files = files; this.limited = entries.length > 1000; this.error = null;
        this.watch(root, cx);
        if (this.open && !files.some((f) => f.path === this.open)) { this.open = null; this.setLines([]); }
        // The first file's diff shows until you pick another.
        if (!this.open && !this.closed && files.length) this.open = files[0].path;
        if (this.open) {
          try { await this.load(this.open, context); }
          catch { if (key() === context) this.setLines(["Cannot preview this diff (too large or unreadable)"]); }
        }
      } catch (e) { if (key() === context) this.error = String(e); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  async load(path, context) {
    const file = this.files.find((f) => f.path === path), root = this.root, on = this.on;
    if (!file) return;
    let lines;
    if (file.fresh || (!this.hasHead && file.status === "A")) {
      const text = await readTextFile(`${root}/${path}`, { on }).catch(() => null);
      if (text === null) lines = ["Cannot preview this file (binary, too large, or unreadable)"];
      else if (text.includes("\0")) lines = ["Binary file · no text diff"];
      else {
        file.add = countLines(text);
        lines = [`@@ -0,0 +1,${file.add} @@`, ...text.slice(0, 400000).replace(/\n$/, "").split("\n").slice(0, 1500).map(l => `+${l}`)];
      }
    } else {
      const r = await exec("git", [...READ, "diff", ...(this.hasHead ? ["HEAD"] : []), "--no-ext-diff", "--no-textconv", "--no-color", "--", path], { cwd: root, on });
      if (r.code !== 0) throw new Error(r.stderr);
      const all = r.stdout.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
      lines = first < 0 ? [file.binary ? "Binary file changed" : "No text diff available"] : all.slice(first);
    }
    if (key() === context && this.open === path) this.setLines(lines.slice(0, 1500).map(line => line.length > 4000 ? line.slice(0, 4000) + "… (line truncated)" : line));
  }

  setLines(lines) {
    this.rows = diffRows(lines);
    this.diffWidth = Math.max(300, ...this.rows.map(row => (row.text.length + 1) * 7 + 50));
  }

  pick(path, cx) {
    this.open = this.open === path ? null : path; this.setLines([]); this.note = null; this.limit = PAGE; this.copied = null;
    this.closed = !this.open;
    const context = this.context;
    if (this.open) cx.spawn(async (cx) => {
      try { await this.load(path, context); }
      catch (e) { if (key() === context && this.open === path) this.note = `Cannot preview this diff (too large or unreadable): ${e}`; }
      cx.notify();
    });
    cx.notify();
  }

  commit(cx) {
    if (!this.message.trim() || !this.root || this.busy || this.loading || this.context !== key()) return;
    const root = this.root, on = this.on, context = this.context, message = this.message.trim();
    this.busy = true; this.note = null;
    cx.spawn(async (cx) => {
      try {
        for (const args of [["add", "-A"], ["commit", "-m", message]]) {
          const r = await exec("git", args, { cwd: root, on });
          if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        }
        if (key() === context) { this.message = ""; this.input.set_value(""); }
      } catch (e) { if (key() === context) this.note = `Commit failed: ${e}`; }
      finally { this.busy = false; this.refresh(cx); cx.notify(); }
    });
    cx.notify();
  }

  diffRow({ kind, number, text }, t, i) {
    if (kind === "@") return div().id(`hunk-${i}`).w_full().pl(46).pr(12).h(22).flex().items_center().flex_none().truncate().italic().text_color(t.dim).child(text);
    const color = kind === "+" ? t.done : kind === "-" ? t.blocked : t.foreground;
    return h_flex().id(`line-${i}`).w_full().h(20).flex_none().text_color(color)
      .when(kind === "+", (e) => e.bg(t.done + "1f")).when(kind === "-", (e) => e.bg(t.blocked + "1f"))
      .child(div().w(34).pr(6).flex_none().text_right().text_color(t.dim).child(number === undefined ? "" : String(number)))
      .child(div().w(14).flex_none().child(kind === "+" || kind === "-" ? kind.replace("-", "−") : ""))
      .child(div().flex_1().pr(12).child(text));
  }

  codeBlock(f, t) {
    const shown = this.rows.slice(0, this.limit ?? PAGE);
    const stop = (_e, cx) => cx.stop_propagation();
    return v_flex().id(`cb-${f.path}`).mx(4).mb(10).rounded(6).overflow_hidden().bg(t.raised).on_mouse_down("left", stop)
      .child(h_flex().h(30).px(12).items_center().justify_between().text_size(12).text_color(t.muted)
        .child(div().child(language(f.path)))
        .child(h_flex().gap(10).items_center()
          .when(f.add > 0, (e) => e.child(div().text_color(t.done).child(`+${f.add}`)))
          .when(f.del > 0, (e) => e.child(div().text_color(t.blocked).child(`−${f.del}`)))
          .child(div().id(`copy-${f.path}`).px(6).py(1).rounded(4).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => {
              cx.write_to_clipboard(this.rows.map((r) => r.kind === "@" ? r.text : `${r.kind === " " ? " " : r.kind}${r.text}`).join("\n"));
              this.copied = f.path; cx.notify();
            })
            .child(this.copied === f.path ? "Copied" : "Copy"))))
      .child(div().id(`cbx-${f.path}`).w_full().overflow_x_scrollbar().pb(8)
        .child(v_flex().min_w(this.diffWidth).font_family(settings().font_family ?? "JetBrains Mono").text_size(11.5)
          .children(shown.map((row, i) => this.diffRow(row, t, i)))
          .when(!this.rows.length, (e) => e.child(div().px(12).py(4).text_color(t.dim).child("Loading diff…")))))
      .when(this.rows.length > shown.length, (e) => e.child(div().id(`more-${f.path}`).px(12).pb(8).text_size(12).text_color(t.accent).cursor_pointer()
        .on_click((_e, cx) => { this.limit = (this.limit ?? PAGE) + PAGE; cx.notify(); }).child(`Show ${Math.min(PAGE, this.rows.length - shown.length)} more lines`)));
  }

  render(cx) {
    if (key() !== this.context) this.refresh(cx);
    const t = theme(), add = this.files.reduce((n, f) => n + f.add, 0), del = this.files.reduce((n, f) => n + f.del, 0);
    const enabled = Boolean(this.message.trim() && this.root && !this.busy && !this.loading);
    return v_flex().id("changes").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(14).track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && this.typing) { this.typing = false; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
      })
      .child(h_flex().h(44).flex_none().px(14).gap(8).items_center()
        .child(div().font_semibold().child("Changes"))
        .child(div().text_size(12).text_color(t.dim).child(`${this.files.length} ${this.files.length === 1 ? "file" : "files"}`))
        .child(div().flex_1())
        .when(add > 0, (e) => e.child(div().text_size(12).text_color(t.done).child(`+${add}`)))
        .when(del > 0, (e) => e.child(div().text_size(12).text_color(t.blocked).child(`−${del}`)))
        .child(div().id("changes-close").size(22).flex().items_center().justify_center().rounded(4).text_color(t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => run("layout.hide", { id: "panel" })).child("×")))
      .child(v_flex().id("changes-doc").flex_1().min_h(0).overflow_y_scrollbar().px(8).pb(10)
        .children(this.files.flatMap((f) => {
          const parts = f.path.split("/"), name = parts.pop(), open = this.open === f.path;
          const mark = { A: "New", D: "Deleted", U: "Conflict", M: "" }[f.status];
          const toggle = h_flex().id(`change-${f.path}`).h(30).flex_none().px(6).gap(6).items_center().rounded(5).cursor_pointer()
            .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.pick(f.path, cx))
            .child(div().w(12).flex_none().text_size(10).text_color(t.muted).child(open ? "▼" : "▶"))
            .child(h_flex().flex_1().min_w(0).child(div().font_medium().truncate().child(name))
              .child(div().pl(6).min_w(0).truncate().text_size(12).text_color(t.dim).child(parts.join("/"))))
            .when(Boolean(mark), (e) => e.child(div().px(5).rounded(3).text_size(11)
              .bg((f.status === "A" ? t.done : t.blocked) + "22").text_color(f.status === "A" ? t.done : t.blocked).child(mark)))
            .when(!open && f.add > 0, (e) => e.child(div().text_size(11.5).text_color(t.done).child(`+${f.add}`)))
            .when(!open && f.del > 0, (e) => e.child(div().text_size(11.5).text_color(t.blocked).child(`−${f.del}`)));
          return open ? [toggle, this.codeBlock(f, t)] : [toggle];
        }))
        .when(!this.files.length, (e) => e.child(div().p(8).text_color(t.dim).child(this.error || (this.loading ? "Loading changes…" : this.root ? "No uncommitted changes" : "No folder"))))
        .when(this.limited, (e) => e.child(div().px(8).py(4).text_size(12).text_color(t.dim).child("Showing the first 1,000 changed files"))))
      .when(Boolean(this.note), (e) => e.child(div().px(14).pb(8).text_size(12).text_color(t.blocked).child(this.note)))
      .child(h_flex().flex_none().p(10).gap(8).border_t(1).border_color(t.border)
        .child(div().id("commit-message").flex_1().min_w(0).h(32).px(10).flex().items_center().rounded(6).border_1().border_color(this.typing ? t.accent : t.border).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).h_full().text_size(13).text_color(t.foreground)))
        .child(div().id("commit").h(32).px(14).flex().items_center().rounded(6).bg(enabled ? t.accent : t.raised).text_color(enabled ? t.accent_foreground : t.dim).text_size(13).font_medium().when(enabled, (e) => e.cursor_pointer()).on_click((_e, cx) => this.commit(cx)).child(this.busy ? "Committing…" : "Commit")));
  }
}

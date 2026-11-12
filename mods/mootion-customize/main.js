// The Customize page of layouts/mootion.json (the "customize" child of the "center" stack).
// Changes what mootion-* mods show, saved in shared("notion.custom") (read through team.js):
// your picture and greeting, the faces teammates (agents) get (plus the extra face for agents
// beyond them), the Notes icon and agent face, and the names
// handed to new agents. Pictures are dropped onto their boxes; ink.py turns each into a 256px
// "ink on transparent" avatar under mods/mootion-sidebar/avatars/custom/ (a plain resize if
// Pillow isn't installed). Notion-style faces: https://faces.notion.com/

import { View, div, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, shared, setShared, exec, appHome, openOverlay, run } from "herdr";
import { custom, mePicture, title, notesFace, extraFace, notes, DEFAULT_TITLE, DEFAULT_NAMES, DEFAULT_FACES } from "./team.js";
import { notesIcon, renderIcon } from "./emoji.js";
import { sections, addSection, moveSection, setHidden, removeSection } from "./sections.js";

const KIND = { notes: "Built-in · your notes", spaces: "Built-in · spaces in no other section", team: "Built-in · your agents", group: "Your section" };

const MARGIN = 56;
const CUSTOM_DIR = "mods/mootion-sidebar/avatars/custom";
const IMAGE = /\.(png|jpe?g|webp|gif|heic|tiff?)$/i;

function save(patch) {
  const next = { ...custom(), ...patch };
  for (const [k, v] of Object.entries(next)) if (v === null || (Array.isArray(v) && !v.length)) delete next[k];
  setShared("notion.custom", next);
}

// Imports one picture; resolves with its path relative to the app's home (what image() takes).
async function importPicture(src, kind) {
  const name = `${kind}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`;
  const dest = `${appHome()}/${CUSTOM_DIR}/${name}`;
  const ink = await exec("python3", ["-I", `${appHome()}/mods/mootion-customize/ink.py`, src, dest]).catch(() => ({ code: 1 }));
  if (ink.code !== 0) {
    const plain = await exec("sips", ["-s", "format", "png", "-Z", "256", src, "--out", dest]).catch(e => ({ code: 1, stderr: String(e) }));
    if (plain.code !== 0) throw new Error((plain.stderr || "Could not read that picture").trim());
  }
  return `${CUSTOM_DIR}/${name}`;
}

// The system's file chooser (macOS), for pictures. Resolves with absolute paths ([] when cancelled).
async function choosePictures(prompt, multiple) {
  const script = [
    `set picked to choose file of type {"public.image"} with prompt "${prompt}"${multiple ? " with multiple selections allowed" : ""}`,
    'if class of picked is not list then set picked to {picked}',
    'set out to {}',
    'repeat with f in picked', 'set end of out to POSIX path of f', 'end repeat',
    'set AppleScript\'s text item delimiters to linefeed',
    'return out as text',
  ];
  const r = await exec("osascript", script.flatMap(line => ["-e", line])).catch(() => ({ code: 1 }));
  return r.code === 0 ? r.stdout.split("\n").map(l => l.trim()).filter(Boolean) : [];
}

export default class Customize extends View {
  init() {
    this.titleInput = InputState.new({ value: custom().title ?? "", placeholder: DEFAULT_TITLE });
    this.titleInput.on("change", (_e, cx) => { save({ title: this.titleInput.value().trim() || null }); cx.notify(); });
    this.sectionInput = InputState.new({ placeholder: "New section name, then Enter" });
    this.sectionInput.on("submit", (_e, cx) => {
      if (this.sectionInput.value().trim()) addSection(this.sectionInput.value());
      this.sectionInput.set_value("");
      cx.notify();
    });
    this.nameInput = InputState.new({ placeholder: "Add a name and press Enter" });
    this.nameInput.on("submit", (_e, cx) => {
      const name = this.nameInput.value().trim();
      if (name && !this.names().includes(name)) save({ names: [...this.names(), name] });
      this.nameInput.set_value("");
      cx.notify();
    });
  }

  names() { return custom().names?.length ? custom().names : DEFAULT_NAMES; }

  // Pictures from the file chooser go through the same import as dropped ones.
  choose(cx, kind, multiple, apply) {
    cx.spawn(async (cx) => {
      const paths = await choosePictures(multiple ? "Choose pictures" : "Choose a picture", multiple);
      if (paths.length) this.drop({ paths }, cx, kind, apply);
    });
  }

  drop(event, cx, kind, apply) {
    const paths = (event.paths ?? []).filter(p => IMAGE.test(p));
    if (!paths.length) { this.error = "Drop PNG, JPG or WebP pictures."; cx.notify(); return; }
    this.error = null; this.busy = kind; cx.notify();
    cx.spawn(async (cx) => {
      try { apply(await Promise.all(paths.map(p => importPicture(p, kind)))); }
      catch (e) { this.error = String(e.message ?? e); }
      finally { this.busy = null; cx.notify(); }
    });
  }

  // A box that takes dropped pictures, or opens the file chooser when clicked.
  dropZone(t, id, text, kind, apply, multiple = false) {
    return v_flex().id(id).h(72).flex_1().items_center().justify_center().gap(2).rounded(8).border(1)
      .border_color(t.input).bg(t.raised).text_size(12.5).text_color(t.muted).cursor_pointer().hover(s => s.bg(t.hover))
      .on_drop((e, cx) => this.drop(e, cx, kind, apply))
      .on_click((_e, cx) => this.choose(cx, kind, multiple, apply))
      .child(div().text_color(t.foreground).child(this.busy === kind ? "Importing…" : text))
      .when(this.busy !== kind, e => e.child(div().text_size(11.5).text_color(t.dim).child("Click to choose, or drop files here")));
  }

  section(t, heading, about, ...children) {
    return v_flex().gap(10).py(18).border_b(1).border_color(t.border)
      .child(v_flex().gap(2)
        .child(div().text_size(16).font_semibold().text_color(t.foreground).child(heading))
        .child(div().text_size(13).text_color(t.muted).child(about)))
      .children(children);
  }

  link(t, id, label, action) {
    return div().id(id).text_size(12.5).text_color(t.accent).cursor_pointer().hover(e => e.underline()).on_click(action).child(label);
  }

  face(t, path, size, onRemove) {
    return div().relative().size(size).flex_none()
      .child(div().size(size).rounded_full().bg("#efe9e1").child(image(path).size(size).rounded_full()))
      .when(Boolean(onRemove), el => el.child(div().id(`rm-${path}`).absolute().top(-4).right(-4).size(18).rounded_full()
        .bg(t.popover).border(1).border_color(t.border).flex().items_center().justify_center().text_size(11)
        .text_color(t.muted).cursor_pointer().hover(e => e.text_color(t.blocked)).tooltip("Remove").on_click(onRemove).child("×")));
  }

  render() {
    const t = theme();
    const c = custom();
    const faces = c.faces?.length ? c.faces : DEFAULT_FACES;
    const n = notes();
    const field = (state, id) => h_flex().id(id).h(36).px(10).items_center().rounded(6).border(1).border_color(t.input)
      .bg(t.background).child(Input.new(state).flex_1().text_size(13.5).text_color(t.foreground));

    return v_flex().id("customize").size_full().bg(t.background).text_size(14).text_color(t.foreground).overflow_y_scrollbar()
      .child(v_flex().px(MARGIN).pt(14).pb(40).max_w(820)
        .child(div().h(42).flex().items_center().text_size(36).child("🎨"))
        .child(div().h(40).flex().items_center().text_size(28).font_bold().child("Customize"))
        .child(h_flex().gap(4).text_size(13).text_color(t.muted)
          .child("Want Notion-style faces? Make them at")
          .child(this.link(t, "faces-link", "faces.notion.com", () => exec("open", ["https://faces.notion.com/"])))
          .child("and drop the PNGs below."))
        .when(Boolean(this.error), e => e.child(div().pt(10).text_size(12.5).text_color(t.blocked).child(this.error)))

        .child(this.section(t, "You", "Your picture and the greeting at the top of the sidebar.",
          h_flex().gap(14).items_center()
            .child(this.face(t, mePicture(), 56))
            .child(this.dropZone(t, "drop-me", "Change your picture", "me", ([p]) => save({ me: p })))
            .when(Boolean(c.me), e => e.child(this.link(t, "reset-me", "Reset", () => save({ me: null })))),
          v_flex().gap(4)
            .child(div().text_size(12).text_color(t.dim).child("Greeting"))
            .child(field(this.titleInput, "title-field"))
            .child(div().text_size(12).text_color(t.dim).child(`Shows as "${title()}"`))))

        .child(this.section(t, "Sidebar", "Its sections, top to bottom. Rename, reorder or hide any of them, and make your own groups of spaces. You can also right-click a heading in the sidebar.",
          v_flex().gap(4).children(sections().map((x, i, list) => {
            const btn = (id, label, action, enabled = true, danger = false) => div().id(id).px(8).h(26).flex().items_center().rounded(5)
              .text_size(12.5).text_color(!enabled ? t.border : danger ? t.blocked : t.muted)
              .when(enabled, e => e.cursor_pointer().hover(s => s.bg(t.hover).text_color(danger ? t.blocked : t.foreground)).on_click(action))
              .child(label);
            return h_flex().id(`sec-row-${x.id}`).h(44).px(10).gap(8).items_center().rounded(6).bg(t.raised)
              .child(v_flex().flex_1().min_w(0)
                .child(div().truncate().text_size(13.5).font_medium().text_color(x.hidden ? t.dim : t.foreground)
                  .child(x.hidden ? `${x.title} (hidden)` : x.title))
                .child(div().truncate().text_size(11.5).text_color(t.dim)
                  .child(x.kind === "group" ? `${KIND.group} · ${(x.spaces ?? []).length} spaces` : KIND[x.kind])))
              .child(btn(`up-${x.id}`, "↑", () => moveSection(x.id, -1), i > 0))
              .child(btn(`down-${x.id}`, "↓", () => moveSection(x.id, 1), i < list.length - 1))
              .child(btn(`rename-${x.id}`, "Rename", () => openOverlay({ mod: "mootion-section", kind: "dialog", width: 380, props: { id: x.id } })))
              .when(x.kind === "group", e => e.child(btn(`spaces-${x.id}`, "Spaces", () =>
                openOverlay({ mod: "mootion-section-spaces", kind: "popup", width: 300, height: 340, props: { id: x.id } }))))
              .child(btn(`hide-${x.id}`, x.hidden ? "Show" : "Hide", () => setHidden(x.id, !x.hidden)))
              .when(x.kind === "group", e => e.child(btn(`del-${x.id}`, "Delete", () => removeSection(x.id), true, true)));
          })),
          field(this.sectionInput, "add-section")))

        .child(this.section(t, "Teammate faces", "Each running agent gets a different face, until there are more agents than faces.",
          h_flex().gap(14).flex_wrap().pt(4).items_center()
            .children(faces.map(p => this.face(t, p, 48, faces.length > 1 ? () => save({ faces: faces.filter(x => x !== p) }) : null)))
            .child(div().id("add-face").size(48).flex_none().rounded_full().border(1).border_color(t.input).bg(t.raised)
              .flex().items_center().justify_center().text_size(22).text_color(t.muted).cursor_pointer()
              .hover(s => s.bg(t.hover).text_color(t.foreground)).tooltip("Add faces")
              .on_click((_e, cx) => this.choose(cx, "face", true, (paths) => save({ faces: [...faces, ...paths] })))
              .on_drop((e, cx) => this.drop(e, cx, "face", (paths) => save({ faces: [...faces, ...paths] })))
              .child(this.busy === "face" ? "…" : "+")),
          v_flex().gap(4).px(12).py(10).rounded(6).bg(t.raised).text_size(12.5).text_color(t.muted)
            .child(h_flex().gap(4).child(div().text_color(t.foreground).font_medium().child("Make faces like these:"))
              .child("open").child(this.link(t, "faces-link-2", "faces.notion.com", () => exec("open", ["https://faces.notion.com/"]))))
            .child("Build a face, download it as PNG, then click + above (or drop the files on it). Black-and-white faces look best."),
          h_flex().when(Boolean(c.faces), e => e.child(this.link(t, "reset-faces", "Reset to the default faces", () => save({ faces: null })))),
          h_flex().gap(14).items_center().pt(6)
            .child(this.face(t, extraFace(), 48))
            .child(v_flex().flex_1().gap(2)
              .child(div().text_size(13.5).font_medium().text_color(t.foreground).child("Extra agents"))
              .child(div().text_size(12.5).text_color(t.muted).child("When every face above is taken, new agents get this one.")))
            .child(this.dropZone(t, "drop-extra", "Change", "extra", ([p]) => save({ extraFace: p })).max_w(200))
            .when(Boolean(c.extraFace), e => e.child(this.link(t, "reset-extra", "Reset", () => save({ extraFace: null }))))))

        .child(this.section(t, "Teammate names", "New agents get one of these at random, never one a running agent already has. Rename any agent by double-clicking it in Team.",
          h_flex().gap(6).flex_wrap()
            .children(this.names().map(name => h_flex().id(`name-${name}`).h(26).pl(9).pr(4).gap(4).items_center().rounded(13)
              .bg(t.raised).text_size(12.5).text_color(t.foreground)
              .child(name)
              .when(this.names().length > 1, e => e.child(div().id(`rm-name-${name}`).size(18).rounded_full().flex().items_center()
                .justify_center().text_size(11).text_color(t.dim).cursor_pointer().hover(s => s.bg(t.hover).text_color(t.blocked))
                .tooltip("Remove").on_click((_e, cx) => { save({ names: this.names().filter(n => n !== name) }); cx.notify(); }).child("×"))))),
          field(this.nameInput, "add-name"),
          h_flex().when(Boolean(c.names), e => e.child(this.link(t, "reset-names", "Reset to the default names", () => save({ names: null }))))))

        .child(this.section(t, "Notes", n.space ? `Notes is running${n.folder ? ` in ${n.folder}` : ""}.` : "Notes isn't set up yet.",
          h_flex().gap(14).items_center()
            .child(div().id("notes-icon").size(56).flex_none().flex().items_center().justify_center().rounded(8).bg(t.raised)
              .cursor_pointer().hover(s => s.bg(t.hover))
              .on_click(() => openOverlay({ mod: "mootion-emoji", kind: "popup", width: 360, height: 320, props: { id: "notes", name: "Notes" } }))
              .child(renderIcon(notesIcon(), 28, t.foreground)))
            .child(v_flex().flex_1().gap(2)
              .child(div().text_size(13.5).font_medium().text_color(t.foreground).child("Notes icon"))
              .child(div().text_size(12.5).text_color(t.muted).child("Click it to pick an emoji or an icon. Shows in the sidebar."))),
          div().text_size(13.5).font_medium().text_color(t.foreground).pt(4).child("Notes agent picture"),
          h_flex().gap(14).items_center()
            .child(this.face(t, notesFace(), 56))
            .child(this.dropZone(t, "drop-notes", "Change the Notes picture", "notes", ([p]) => save({ notesFace: p })))
            .when(Boolean(c.notesFace), e => e.child(this.link(t, "reset-notes", "Reset", () => save({ notesFace: null })))),
          h_flex().gap(14)
            .when(!n.space, e => e.child(this.link(t, "notes-setup", "Set up Notes", () => openOverlay({ mod: "mootion-notes", kind: "dialog", width: 460 }))))
            .when(Boolean(n.space), e => e.child(this.link(t, "notes-open", "Open Notes", () => { run("layout.select", { stack: "center", child: "main" }); run("space.select", { id: n.space }); })))))

        .child(this.section(t, "Herdr", "Fonts, sounds, machines and updates live in Herdr's own settings.",
          this.link(t, "herdr-settings", "Open Herdr settings", () => run("app.settings")))));
  }
}

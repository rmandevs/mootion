// Sets up Notes: a space with one agent dedicated to the person's notes. Open as a dialog.
// Pick where the notes live (Obsidian vault, Notion, Craft, or another app), a folder, and the agent.
// Creating it runs space.new { name: "Notes", folder, argv, task } with a brief for the agent, and
// records the choice in shared("notion.notes"); mootion-sidebar then finds the new space and agent.

import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, theme, run, spaces, shared, setShared, knownAgents, pickFolder, home } from "herdr";
import { notesFace } from "./team.js";

const APPS = [
  { key: "obsidian", label: "Obsidian", hint: "Your vault folder: the agent works on its Markdown files, and you get a Vault view to browse and read them in Herdr." },
  { key: "notion", label: "Notion", hint: "Uses the Notion MCP server or plugin connected to the agent. No Vault view: the notes live in the cloud, not in a folder here." },
  { key: "craft", label: "Craft", hint: "Uses the Craft MCP server or CLI connected to the agent. No Vault view: the notes live in the cloud, not in a folder here." },
  { key: "other", label: "Other", hint: "Any notes app the agent can reach (MCP server, plugin or CLI). Choose a folder too if the notes are local Markdown files, to get the Vault view." },
];

function brief(app, folder) {
  const where = app.key === "obsidian"
    ? `Their notes are an Obsidian vault in this folder (${folder}). Work directly with its Markdown files, and use the obsidian CLI if it's installed.`
    : `Their notes live in ${app.label === "Other" ? "their notes app" : app.label}. Use its MCP server, plugin or CLI to reach them; if none is connected, tell the person how to connect one.`;
  return [
    "You are Notes, the person's notes assistant inside Herdr.",
    where,
    "Your job: find, read, summarize, create and organize notes when they ask, following the conventions the notes already use (folders, links, tags, daily notes).",
    "Don't change or delete notes unless they ask.",
    "Start by taking a short look at how the notes are organized, then say hi in one line and wait.",
  ].join(" ");
}

export default class NotesSetup extends View {
  init(_props, cx) {
    const saved = shared("notion.notes") ?? {};
    this.app = APPS.find(a => a.key === saved.app) ?? APPS[0];
    this.folder = saved.folder ?? null;
    this.agents = [];
    this.agent = null;
    cx.spawn(async (cx) => {
      try {
        this.agents = (await knownAgents()).filter(a => a.installed);
        this.agent = this.agents.find(a => a.key === saved.agent) ?? this.agents.find(a => a.key === "claude") ?? this.agents[0] ?? null;
      } catch (e) { this.error = `Could not list agents: ${e}`; }
      cx.notify();
    });
  }

  choose(cx) {
    cx.spawn(async (cx) => {
      const folder = await pickFolder({ prompt: "Use for Notes" });
      if (folder) this.folder = folder;
      cx.notify();
    });
  }

  create() {
    const p = props();
    const folder = this.folder ?? home();
    setShared("notion.notes", {
      app: this.app.key, folder: this.folder, agent: null, space: null, agentKey: this.agent?.key ?? null,
      pending: { before: spaces().map(s => s.id), at: Date.now() },
    });
    run("space.new", { name: "Notes", folder, ...(this.agent ? { argv: this.agent.run, task: brief(this.app, folder) } : {}) });
    closeOverlay(p.overlay);
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const needsFolder = this.app.key === "obsidian";
    const ready = Boolean(this.agent) && (!needsFolder || Boolean(this.folder));
    const chip = (id, label, on, action) => div().id(id).px(10).h(28).flex().items_center().rounded(5).text_size(13)
      .border(1).border_color(on ? t.accent : t.border).bg(on ? t.accent + "1f" : t.popover)
      .text_color(on ? t.foreground : t.muted).cursor_pointer().hover(s => s.bg(t.hover)).on_click(action).child(label);
    const label = (text) => div().pt(6).text_size(12).font_medium().text_color(t.dim).child(text);
    const button = (id, text, primary, enabled, action) => h_flex().id(id).h(32).px(14).items_center().rounded(6)
      .border_1().border_color(primary ? t.accent : t.input).bg(primary ? (enabled ? t.accent : t.raised) : t.raised)
      .text_color(primary ? (enabled ? t.accent_foreground : t.dim) : t.foreground).text_size(13).font_medium()
      .when(enabled, e => e.cursor_pointer().on_click(action)).child(text);

    return v_flex().w_full().p(18).gap(8).bg(t.popover).text_color(t.foreground).text_size(13)
      .child(h_flex().gap(10).items_center()
        .child(div().size(40).rounded_full().bg("#f1e8da").child(image(notesFace()).size(40).rounded_full()))
        .child(v_flex()
          .child(div().text_size(15).font_semibold().child("Set up Notes"))
          .child(div().text_size(12).text_color(t.dim).child("A space with an agent that looks after your notes"))))
      .child(label("Where your notes live"))
      .child(h_flex().gap(6).children(APPS.map(a => chip(`app-${a.key}`, a.label, this.app.key === a.key, (_e, cx) => { this.app = a; cx.notify(); }))))
      .child(div().text_size(12).text_color(t.muted).child(this.app.hint))
      .child(label(needsFolder ? "Vault folder" : "Folder (optional)"))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_color(this.folder ? t.foreground : t.dim).child(this.folder ?? (needsFolder ? "No folder chosen" : "Your home folder")))
        .child(chip("pick-folder", "Choose…", false, (_e, cx) => this.choose(cx))))
      .child(label("Agent"))
      .child(h_flex().gap(6).flex_wrap()
        .children(this.agents.map(a => chip(`agent-${a.key}`, a.name, this.agent?.key === a.key, (_e, cx) => { this.agent = a; cx.notify(); })))
        .when(!this.agents.length, e => e.child(div().text_size(12).text_color(t.dim).child(this.error ?? "Looking for installed agents…"))))
      .child(div().text_size(12).text_color(t.dim).child("You can open plain terminals in the Notes space too."))
      .child(h_flex().pt(8).gap(8).justify_end()
        .child(button("notes-cancel", "Cancel", false, true, () => closeOverlay(p.overlay)))
        .child(button("notes-create", "Create Notes", true, ready, () => this.create())));
  }
}

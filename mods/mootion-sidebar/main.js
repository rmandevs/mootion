// The whole left sidebar of layouts/mootion.json, Notion + Slack style:
//   workspace header · Search · Inbox
//   Spaces: a page tree (space → its tabs), emoji icons (click to change)
//   Team: every agent as a teammate with its own color, presence dot and unread badge
// Inbox opens as a page in the center (the "center" stack of the layout).
// Notes (above Spaces): one space with an agent dedicated to the person's notes, set up with the
// mootion-notes dialog and tracked in shared("notion.notes"); it's left out of Spaces and Team.
// Sections (Notes, Spaces, Team and the person's own groups of spaces) come in the order and with
// the names in shared("notion.sidebar") (sections.js). Right-click a heading for its menu;
// "Add section" at the end creates a new one.
//   Click your picture or "Hey, yo!" to open Herdr's settings.
// Narrower than 160px it draws a rail of icons and avatars.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  props, spaces, agents, machines, panes, run, theme, layout, window, shared, setShared, openOverlay, focused,
  setAgentOrder, updates, exec,
} from "herdr";
import { spaceIcon, tabIcon, renderIcon, notesIcon } from "./emoji.js";
import { sections } from "./sections.js";
import { avatar, assignTeam, agentName, me, notes, isNotes, notesFace, title } from "./team.js";

const EMOJI_POPUP = { mod: "mootion-emoji", kind: "popup", width: 360, height: 320 };

const ICONS = "mods/mootion-sidebar";
const RANK = { blocked: 0, done: 1, working: 2, idle: 3 };
const PRESENCE = { blocked: "Needs you", done: "Done", working: "typing…", idle: "" };

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const rename = (a) => openOverlay({ mod: "mootion-rename", kind: "dialog", width: 360, props: { address: a.address } });

const inboxShown = () => find(layout(), "center")?.active === "inbox";
const showInbox = () => run("layout.select", { stack: "center", child: "inbox" });
const pageShown = () => find(layout(), "center")?.active ?? "main";
const showWork = () => { if (pageShown() !== "main") run("layout.select", { stack: "center", child: "main" }); };
const toggleCustomize = () => run("layout.select", { stack: "center", child: pageShown() === "customize" ? "main" : "customize" });

const sidebarWidth = () => find(layout(), "sidebar")?.size?.px ?? 256;
const narrow = () => sidebarWidth() < 160;

function toggleSidebar() {
  if (!narrow()) setShared("sidebar.width", sidebarWidth());
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 256) : window()?.platform === "macos" ? 76 : 44 });
}

function ago(ms) {
  if (!ms) return "";
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}


// Inbox history: the sidebar body records every agent status change into
// shared("notion.inbox") = { [address]: [{ status, at, task, lines? }] }, newest last.
// The mootion-inbox window reads it. Only changes are written (setShared redraws every mod).
const KEEP = 30;
const CHROME = /^[\s─━│┃╭╮╰╯┌┐└┘├┤┬┴┼═║▔▁▏▕·•…]*$|esc to interrupt|shift\+tab|auto mode|\? for shortcuts|bypass permissions|ctrl\+[a-z] to|^\s*\[hc\]|new task\?|\/clear to|^\s*tip:|^\s*(ran|read|wrote|edited|searched for) \d+ |^\s*[✻✶*·⏺●]?\s*\S+ for \d+(m|s)\b|tokens?\)?\s*$/i;

// The last few meaningful lines of a terminal's screen: what was printed above the
// program's last prompt (❯ / >), without its box, hints and timing lines.
export function lastLines(text, count = 4) {
  let lines = text.split("\n").map(l => l.replace(/\s+$/, ""));
  const prompt = lines.findLastIndex(l => /^[\s│┃]*[❯>](\s|$)/.test(l));
  if (prompt > 0) lines = lines.slice(0, prompt);
  return lines.filter(l => l && !CHROME.test(l))
    .map(l => l.replace(/^[\s│┃]+|[\s│┃]+$/g, "").replace(/^[●⏺•✻✶*⎿]\s*/, "").replace(/\s{2,}/g, " "))
    .filter(l => l.length > 1)
    .slice(-count);
}

export default class NotionSidebar extends View {
  init() {
    this.seen = null; // address → last status, for the inbox recorder
    // Spaces whose tab list is folded or unfolded by hand; the active one unfolds by default.
    this.open = JSON.parse(localStorage.getItem("open") ?? "{}");
  }

  record(list, cx) {
    const now = Object.fromEntries(list.map(a => [a.address, a.status]));
    if (!this.seen) { this.seen = now; return; } // what was already true at start isn't news
    const changed = list.filter(a => this.seen[a.address] !== a.status && !(this.seen[a.address] === "done" && a.status === "idle"));
    this.seen = now;
    if (!changed.length) return;
    const inbox = { ...(shared("notion.inbox") ?? {}) };
    for (const a of changed) {
      const task = a.title && a.title !== a.program?.name ? a.title : a.tab_name;
      inbox[a.address] = [...(inbox[a.address] ?? []), { status: a.status, at: Date.now(), task }].slice(-KEEP);
      if (a.status === "done" || a.status === "blocked") {
        cx.spawn(async () => {
          const r = await exec("hc", ["read", a.address, "--lines", "30"]).catch(() => null);
          if (!r || r.code !== 0) return;
          const box = { ...(shared("notion.inbox") ?? {}) };
          const events = [...(box[a.address] ?? [])];
          const last = events[events.length - 1];
          if (!last || last.status !== a.status) return;
          events[events.length - 1] = { ...last, lines: lastLines(r.stdout) };
          box[a.address] = events;
          setShared("notion.inbox", box);
        });
      }
    }
    setShared("notion.inbox", inbox);
  }

  // Finds the Notes space after setup, follows its agent, and forgets a space that was closed.
  trackNotes(all, team) {
    const n = notes();
    if (!n.app) return;
    let next = { ...n };
    if (n.pending && !n.space) {
      const made = all.find(s => s.name === "Notes" && !n.pending.before.includes(s.id));
      if (made) { next.space = made.id; next.pending = null; }
      else if (Date.now() - n.pending.at > 60000) next.pending = null;
    }
    // Only forget a closed Notes space once spaces have loaded and it has stayed missing for a while:
    // at start (machines still loading) the list can be briefly empty or partial.
    const loaded = all.length > 0 && machines().every(mc => mc.layout !== "loading");
    if (next.space && !all.some(s => s.id === next.space)) {
      this.notesMissing ??= Date.now();
      if (loaded && Date.now() - this.notesMissing > 5000) { next.space = null; next.agent = null; this.notesMissing = null; }
    } else this.notesMissing = null;
    if (next.space && !team.some(a => a.address === next.agent)) next.agent = team.find(a => a.space === next.space)?.address ?? null;
    if (JSON.stringify(next) !== JSON.stringify(n)) setShared("notion.notes", next);
  }

  setOpen(id, value, cx) {
    this.open[id] = value;
    localStorage.setItem("open", JSON.stringify(this.open));
    cx.notify();
  }

  row(t, id, { on = false, indent = 0 } = {}) {
    return h_flex().id(id).h(28).pl(8 + indent).pr(6).gap(7).items_center().rounded(5).min_w(0)
      .text_color(on ? t.foreground : t.muted).bg(on ? t.hover : t.chrome)
      .when(on, el => el.font_medium())
      .hover(s => s.bg(t.hover)).cursor_pointer();
  }

  section(t, id, label, action, sectionId) {
    return h_flex().id(id).h(26).mt(14).px(8).items_center().justify_between().rounded(4).text_size(12).text_color(t.dim)
      .when(Boolean(sectionId), el => el.hover(s => s.bg(t.hover))
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "mootion-section-menu", kind: "popup", width: 210, height: 220, props: { id: sectionId } }); }))
      .child(div().font_medium().child(label))
      .when(Boolean(action), el => el.child(div().id(`${id}-add`).size(20).flex().items_center().justify_center().rounded(4)
        .hover(s => s.bg(t.hover).text_color(t.foreground)).on_click(action).child(svg(`${ICONS}/plus.svg`).size(13))));
  }

  badge(t, n, color) {
    return div().flex_none().px(6).h(17).flex().items_center().rounded(9).bg(color).text_size(11).font_semibold()
      .text_color("#ffffff").child(String(n));
  }

  header(t, collapsed) {
    const w = window();
    const stop = (_e, cx) => cx.stop_propagation();
    const iconButton = (id, icon, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(5)
      .text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", stop).on_click(action)
      .child(svg(`${ICONS}/${icon}.svg`).size(15));
    return h_flex().id("ws-header").size_full()
      .h(46).flex_none().pr(8).gap(6).items_center()
      .pl(w?.platform === "macos" && !w?.fullscreen ? 78 : 12)
      .when(collapsed, el => el.pl(6).justify_center())
      .when(!collapsed, el => el
        .child(h_flex().flex_1().min_w(0).items_center()
          // Stopping the press keeps this block's window drag from taking the click.
          .child(h_flex().id("ws-me").min_w(0).h(32).pl(4).pr(8).gap(8).items_center().rounded(6).cursor_pointer()
            .hover(s => s.bg(t.hover)).tooltip("See Herdr settings")
            .on_mouse_down("left", stop).on_click(() => run("app.settings"))
            .child(div().relative().child(me(24))
              .when(Boolean(updates().app.ready), e => e.child(div().absolute().top(-1).right(-1).size(8).rounded_full()
                .bg(t.accent).border(2).border_color(t.chrome))))
            .child(div().min_w(0).text_size(13.5).font_semibold().text_color(t.foreground).truncate().child(title())))))
      .when(!collapsed, el => el.child(iconButton("ws-customize", "palette", toggleCustomize).tooltip("Customize")))
      .when(!(collapsed && w?.platform === "macos"), el => el.child(iconButton("ws-toggle", "sidebar", toggleSidebar)));
  }

  render(cx) {
    const t = theme();
    const collapsed = narrow();
    const all = spaces();
    const team = [...agents()].sort((a, b) =>
      (b.pinned - a.pinned) || (RANK[a.status] - RANK[b.status]) || (b.seq - a.seq));
    setAgentOrder(team.map(a => a.address));
    const unread = team.filter(a => a.status === "done" || a.status === "blocked");
    const changedAt = (a) => all.find(s => s.id === a.space)?.tabs.find(c => c.id === a.tab)?.changed_at;
    const inboxAction = () => (inboxShown() ? showWork() : showInbox());

    if (props()?.part === "header") return div().size_full().bg(t.chrome).child(this.header(t, collapsed));
    this.record(team, cx);
    this.trackNotes(all, team);
    assignTeam(team.map(a => a.address));
    // Switching tabs by keyboard while the Inbox page shows goes back to the work.
    const tab = focused()?.tab;
    if (tab !== this.lastTab) { if (this.lastTab !== undefined) showWork(); this.lastTab = tab; }

    const n = notes();
    const notesSpace = all.find(s => s.id === n.space) ?? null;
    const notesAgent = team.find(a => isNotes(a.address)) ?? null;
    const listed = all.filter(s => s.id !== n.space);
    const people = team.filter(a => !isNotes(a.address));
    // What the sections show, in their order: the rail follows it too.
    const order = sections();
    const grouped = new Set(order.filter(x => x.kind === "group").flatMap(x => x.spaces ?? []));
    const shown = (kind) => order.some(x => x.kind === kind && !x.hidden);
    const railSpaces = order.filter(x => !x.hidden).flatMap(x =>
      x.kind === "spaces" ? listed.filter(sp => !grouped.has(sp.id))
      : x.kind === "group" ? (x.spaces ?? []).map(id => listed.find(sp => sp.id === id)).filter(Boolean) : []);

    if (collapsed) {
      return v_flex().size_full().bg(t.chrome).items_center().gap(4).pt(4).pb(10)
        .child(div().id("rail-expand").size(32).flex().items_center().justify_center().rounded(6).text_color(t.muted)
          .hover(e => e.bg(t.hover).text_color(t.foreground)).tooltip("Expand sidebar").on_click(toggleSidebar)
          .child(svg(`${ICONS}/sidebar.svg`).size(16)))
        .child(div().id("rail-inbox").relative().size(32).flex().items_center().justify_center().rounded(6)
          .text_color(t.muted).bg(inboxShown() ? t.hover : t.chrome).hover(s => s.bg(t.hover)).on_click(inboxAction)
          .child(svg(`${ICONS}/inbox.svg`).size(16))
          .when(unread.length > 0, el => el.child(div().absolute().top(2).right(2).size(8).rounded_full().bg(t.blocked))))
        .child(div().h(1).w(24).my(4).bg(t.border))
        .when(Boolean(notesSpace) && shown("notes"), el => el.child(div().id("rail-notes").p(4).rounded(6).hover(e => e.bg(t.hover))
          .on_click(() => { showWork(); run("space.select", { id: notesSpace.id }); })
          .child(renderIcon(notesIcon(), 17, t.muted))))
        .children(railSpaces.map(s => div().id(`rail-${s.id}`).size(32).flex().items_center().justify_center().rounded(6)
          .text_size(17).bg(s.active ? t.hover : t.chrome).hover(e => e.bg(t.hover))
          .on_click(() => { showWork(); run("space.select", { id: s.id }); }).child(renderIcon(spaceIcon(s), 17, t.muted))))
        .child(div().h(1).w(24).my(4).bg(t.border))
        .children((shown("team") ? people : []).map(a => div().id(`rail-a-${a.address}`).p(4).rounded(6).hover(e => e.bg(t.hover))
          .on_click(() => { showWork(); run("agent.focus", { terminal: a.address }); }).child(avatar(t, a, 22, t.chrome))))
        .child(div().flex_1())
        .child(div().id("rail-settings").size(32).flex().items_center().justify_center().rounded(6).text_color(t.muted)
          .hover(e => e.bg(t.hover)).on_click(() => run("app.settings")).child(svg(`${ICONS}/settings.svg`).size(15)));
    }

    const spaceTree = (s) => {
      const isOpen = this.open[s.id] ?? s.active;
      const multiMachine = all.some(x => x.machine);
      const rows = [
        this.row(t, `sp-${s.id}`, { on: s.active && !isOpen })
          .on_click(() => { showWork(); run("space.select", { id: s.id }); })
          .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "space", target: { id: s.id } } }); })
          .child(div().id(`chev-${s.id}`).size(16).flex_none().flex().items_center().justify_center().rounded(3).text_color(t.dim)
            .hover(e => e.bg(t.selected).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); this.setOpen(s.id, !isOpen, cx); })
            .child(svg(`${ICONS}/${isOpen ? "chevron-down" : "chevron-right"}.svg`).size(12)))
          .child(div().id(`ico-${s.id}`).w(20).flex_none().text_size(15).rounded(3).hover(e => e.bg(t.selected))
            .on_click((_e, cx) => { cx.stop_propagation(); openOverlay({ ...EMOJI_POPUP, props: { id: s.id, name: s.name } }); })
            .child(renderIcon(spaceIcon(s), 15, s.active ? t.foreground : t.muted)))
          .child(div().flex_1().min_w(0).truncate().text_color(s.active ? t.foreground : t.muted).child(s.name))
          .when(multiMachine && Boolean(s.machine), el => el.child(div().text_size(11).text_color(t.dim).child(s.machine)))
          .when(s.status === "working", el => el.child(svg(`${ICONS}/spinner.svg`).size(11).flex_none().text_color(t.working).spin(900)))
          .when(s.status === "blocked" || s.status === "done", el => el.child(div().size(6).flex_none().rounded_full().bg(t[s.status]))),
      ];
      if (isOpen) {
        for (const c of s.tabs) {
          const agent = panes().find(p => p.tab === c.id && p.program?.agent);
          const name = c.named ? c.name : agent ? (agent.title && agent.title !== agent.program.name ? agent.title : agent.program.name) : "Untitled";
          rows.push(this.row(t, `tb-${c.id}`, { on: s.active && c.active, indent: 22 })
            .on_click(() => { showWork(); run("space.select", { id: s.id }); run("tab.select", { id: c.id }); })
            .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: s.id } } }); })
            .child(div().w(18).flex_none().child(renderIcon(tabIcon(c), 13, s.active && c.active ? t.foreground : t.muted)))
            .child(div().flex_1().min_w(0).truncate().child(name))
            .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).flex_none().rounded_full().bg(t[c.status]))));
        }
        rows.push(this.row(t, `tb-new-${s.id}`, { indent: 22 }).text_color(t.dim)
          .on_click(() => run("tab.new", { space: s.id }))
          .child(div().w(18).flex_none().child(svg(`${ICONS}/plus.svg`).size(12))).child("New page"));
      }
      return rows;
    };

    const notesRows = [];
    if (!notesSpace) {
      notesRows.push(this.row(t, "notes-setup").on_click(() => openOverlay({ mod: "mootion-notes", kind: "dialog", width: 460 }))
        .child(div().w(20).flex_none().child(renderIcon(notesIcon(), 15, t.muted)))
        .child(div().flex_1().child(n.pending ? "Starting Notes…" : "Set up Notes")));
    } else {
      const isOpen = this.open[notesSpace.id] ?? notesSpace.active;
      notesRows.push(this.row(t, "notes-row", { on: notesSpace.active && !isOpen })
        .on_click(() => { showWork(); run("space.select", { id: notesSpace.id }); })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "space", target: { id: notesSpace.id } } }); })
        .child(div().id("chev-notes").size(16).flex_none().flex().items_center().justify_center().rounded(3).text_color(t.dim)
          .hover(e => e.bg(t.selected).text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.setOpen(notesSpace.id, !isOpen, cx); })
          .child(svg(`${ICONS}/${isOpen ? "chevron-down" : "chevron-right"}.svg`).size(12)))
        .child(div().id("ico-notes").w(20).flex_none().rounded(3).hover(e => e.bg(t.selected))
          .on_click((_e, cx) => { cx.stop_propagation(); openOverlay({ ...EMOJI_POPUP, props: { id: "notes", name: "Notes" } }); })
          .child(renderIcon(notesIcon(), 15, notesSpace.active ? t.foreground : t.muted)))
        .child(div().flex_1().min_w(0).truncate().text_color(notesSpace.active ? t.foreground : t.muted).child("Notes"))
        .when(notesSpace.status === "working", el => el.child(svg(`${ICONS}/spinner.svg`).size(11).flex_none().text_color(t.working).spin(900)))
        .when(notesSpace.status === "blocked" || notesSpace.status === "done", el => el.child(div().size(6).flex_none().rounded_full().bg(t[notesSpace.status]))));
      if (isOpen) {
        for (const c of notesSpace.tabs) {
          const agentPane = panes().find(p => p.tab === c.id && p.program?.agent);
          const vault = panes().some(p => p.tab === c.id && p.mod === "mootion-vault");
          const name = c.named ? c.name : agentPane ? "Notes agent" : vault ? "Vault" : "Terminal";
          notesRows.push(this.row(t, `ntb-${c.id}`, { on: notesSpace.active && c.active, indent: 22 })
            .on_click(() => { showWork(); run("space.select", { id: notesSpace.id }); run("tab.select", { id: c.id }); })
            .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: notesSpace.id } } }); })
            .child(div().w(18).flex_none().child(agentPane && notesAgent ? avatar(t, notesAgent, 16, t.chrome)
              : renderIcon(vault ? "icon:library" : "icon:terminal", 13, t.muted)))
            .child(div().flex_1().min_w(0).truncate().child(name)));
        }
        // The Vault view reads files, so it's only offered for a local notes folder.
        if (n.folder) {
          const vaultPane = panes().find(p => p.mod === "mootion-vault" && notesSpace.tabs.some(c => c.id === p.tab));
          if (!vaultPane) notesRows.push(this.row(t, "notes-vault", { indent: 22 })
            .on_click(() => { showWork(); run("tab.new", { space: notesSpace.id, name: "Vault", mod: "mootion-vault", props: { folder: n.folder } }); })
            .child(div().w(18).flex_none().child(renderIcon("icon:library", 13, t.muted))).child(div().flex_1().child("Vault")));
        }
        notesRows.push(this.row(t, "notes-terminal", { indent: 22 }).text_color(t.dim)
          .on_click(() => { showWork(); run("tab.new", { space: notesSpace.id, ...(n.folder ? { folder: n.folder } : {}) }); })
          .child(div().w(18).flex_none().child(svg(`${ICONS}/plus.svg`).size(12))).child("New terminal"));
      }
    }

    const teamRows = people.map(a => {
      const who = { first: agentName(a), where: a.space_name };
      const isUnread = a.status === "done" || a.status === "blocked";
      return this.row(t, `ag-${a.address}`, { on: a.focused })
        .on_click(() => { showWork(); run("agent.focus", { terminal: a.address }); })
        .on_mouse_down("left", (e) => { if (e.click_count === 2) rename(a); })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); rename(a); })
        .child(avatar(t, a, 22, t.chrome, true))
        .child(h_flex().flex_1().min_w(0).gap(5).items_baseline()
          .child(div().flex_none().text_color(isUnread || a.focused ? t.foreground : t.muted).when(isUnread, e => e.font_semibold()).child(who.first))
          .child(div().min_w(0).truncate().text_size(12.5).text_color(t.dim).child(`· ${who.where}`)))
        .when(a.status === "working", el => el.child(div().flex_none().text_size(11.5).text_color(t.dim).italic().child(PRESENCE.working)))
        .when(isUnread, el => el.child(this.badge(t, 1, a.status === "blocked" ? t.blocked : t.accent)))
        .when(a.status === "idle", el => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child(ago(changedAt(a)))))
        // Pinned agents stay at the top of Team (terminal.pin, kept on the terminal).
        .child(div().id(`pin-${a.address}`).size(18).flex_none().flex().items_center().justify_center().rounded(4)
          .text_color(a.pinned ? t.accent : t.dim).hover(e => e.bg(t.selected).text_color(a.pinned ? t.accent : t.foreground))
          .tooltip(a.pinned ? "Unpin" : "Pin to top")
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { cx.stop_propagation(); run("terminal.pin", { terminal: a.address, pinned: !a.pinned }); })
          .child(svg(`${ICONS}/pin.svg`).size(12)));
    });

    return v_flex().id("mootion-sidebar").size_full().bg(t.chrome).text_size(14)
      .child(v_flex().id("sidebar-scroll").flex_1().min_h(0).px(6).pb(10).gap(1).overflow_y_scrollbar()
        .child(this.row(t, "search-row").on_click(() => run("mod.open", { name: "picker" }))
          .child(svg(`${ICONS}/search.svg`).size(14)).child(div().flex_1().child("Search")).child(div().text_size(11.5).text_color(t.dim).child("⌘K")))
        .child(this.row(t, "inbox-row", { on: inboxShown() }).on_click(inboxAction)
          .child(svg(`${ICONS}/inbox.svg`).size(14)).child(div().flex_1().child("Inbox"))
          .when(unread.length > 0, el => el.child(this.badge(t, unread.length, t.blocked))))
        .children(order.filter(x => !x.hidden).flatMap(x => {
          const hint = (text) => div().px(8).py(4).text_size(12.5).text_color(t.dim).child(text);
          if (x.kind === "notes") return [this.section(t, "sec-notes", x.title, null, x.id), ...notesRows];
          if (x.kind === "team") return [this.section(t, "sec-team", people.length ? `${x.title} · ${people.length}` : x.title, null, x.id),
            ...(people.length ? teamRows : [hint("Start an agent with + in the top bar.")])];
          if (x.kind === "spaces") {
            const rest = listed.filter(sp => !grouped.has(sp.id));
            return [this.section(t, "sec-spaces", x.title, () => run("space.new", {}), x.id),
              ...(rest.length ? rest.flatMap(spaceTree) : [hint("Every space is in a section.")])];
          }
          const mine = (x.spaces ?? []).map(id => listed.find(sp => sp.id === id)).filter(Boolean);
          const choose = () => openOverlay({ mod: "mootion-section-spaces", kind: "popup", width: 300, height: 340, props: { id: x.id } });
          return [this.section(t, `sec-${x.id}`, x.title, choose, x.id),
            ...(mine.length ? mine.flatMap(spaceTree) : [this.row(t, `empty-${x.id}`).text_color(t.dim).text_size(13).on_click(choose)
              .child(div().w(20).flex_none().child(svg(`${ICONS}/plus.svg`).size(12))).child("Add spaces")])];
        }))
        .child(this.row(t, "add-section").mt(14).text_color(t.dim).text_size(13)
          .on_click(() => openOverlay({ mod: "mootion-section", kind: "dialog", width: 380 }))
          .child(div().w(20).flex_none().child(svg(`${ICONS}/plus.svg`).size(12))).child("Add section")));
  }
}

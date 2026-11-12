// A pane's header drawn as the top of a Notion page: icon, title and a property row
// (agent, folder, branch, status). The terminal below is the page body.
// Used as the pane frame header of layouts/mootion.json. Props: { pane, terminal }.
// Click the icon to change it, the title to rename the tab.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { panes, spaces, props, run, theme, home, openOverlay, shared } from "herdr";
import { tabIcon, renderIcon } from "./emoji.js";
import { avatar, agentName, harness } from "./team.js";

// Must match terminal_padding's horizontal value in layouts/mootion.json.
const MARGIN = 56;
const STATUS = { working: "Working", blocked: "Needs you", done: "Done", idle: "Idle" };

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

function programIcon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class PageHeader extends View {
  init() { this.hovered = false; }

  button(t, id, icon, command, args) {
    return div().id(id).p(4).rounded(4).text_color(t.dim)
      .hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); run(command, args); })
      .child(svg(`mods/mootion-page/${icon}.svg`).size(14));
  }

  property(t, label, value, icon) {
    return h_flex().gap(6).items_center().min_w(0)
      .child(div().text_color(t.dim).child(label))
      .when(Boolean(icon), el => el.child(icon))
      .child(div().truncate().text_color(t.foreground).child(value));
  }

  render() {
    const t = theme();
    const p = panes().find(x => x.pane === props()?.pane);
    if (!p) return div();
    const space = spaces().find(s => s.tabs.some(c => c.id === p.tab));
    const tab = space?.tabs.find(c => c.id === p.tab);
    const agent = p.program?.agent ? p.program : null;
    const teammate = agent && p.terminal ? { address: p.terminal, program: p.program, status: p.status } : null;
    const fallback = agent ? (p.title && p.title !== agent.name ? p.title : agent.name) : "Untitled";
    const title = tab?.named ? tab.name : p.mod ? (p.title || "Untitled") : fallback;
    const icon = tab && shared("notion.icons")?.[tab.id] ? tabIcon(tab) : p.mod === "mootion-vault" ? "icon:library" : tab ? tabIcon(tab) : "📄";
    const pane = p.pane;
    const st = p.status;
    const statusColor = st ? t[st] : t.dim;

    return v_flex().id(`page-${pane}`).size_full().px(MARGIN).pt(14).pb(8).gap(4).bg(t.background)
      .relative().text_size(13)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .child(div().id(`icon-${pane}`).w(48).h(42).flex().items_center().rounded(6).text_size(36)
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          if (tab) openOverlay({ mod: "mootion-emoji", kind: "popup", width: 360, height: 320, props: { id: tab.id, name: title } });
        })
        .child(renderIcon(icon, 36, t.foreground)))
      .child(div().id(`title-${pane}`).h(40).flex().items_center().text_size(28).font_bold().text_color(t.foreground).truncate()
        .cursor_text()
        .on_click((_e, cx) => { cx.stop_propagation(); if (tab) run("tab.rename", { id: tab.id }); })
        .child(title))
      .child(h_flex().h(22).gap(20).items_center().min_w(0).overflow_hidden()
        .when(Boolean(teammate), el => el.child(this.property(t, "Agent", `${agentName(teammate)} (${harness(teammate)})`, avatar(t, teammate, 18))
          .id(`agent-${pane}`).px(4).mx(-4).rounded(4).cursor_pointer().hover(s => s.bg(t.hover)).tooltip("Rename")
          .on_click((_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "mootion-rename", kind: "dialog", width: 360, props: { address: teammate.address } }); })))
        .when(!teammate && !p.mod, el => el.child(this.property(t, "Program",
          (p.program?.shell ? "Shell" : p.program?.name) ?? "Terminal", programIcon(p.program, 13, t.muted))))
        .when(Boolean(p.cwd), el => el.child(this.property(t, "Folder", folder(p.cwd))))
        .when(Boolean(p.branch), el => el.child(this.property(t, "Branch", p.branch)))
        .when(Boolean(st), el => el.child(h_flex().gap(6).items_center()
          .child(div().text_color(t.dim).child("Status"))
          .child(h_flex().px(7).h(20).gap(5).items_center().rounded(4).bg(statusColor + "22").text_color(statusColor)
            .when(st === "working", e => e.child(svg("mods/mootion-page/spinner.svg").size(11).spin(900)))
            .when(st !== "working", e => e.child(div().size(6).rounded_full().bg(statusColor)))
            .child(STATUS[st])))))
      .when(this.hovered, el => el.child(h_flex().absolute().top(10).right(14).gap(2)
        .child(this.button(t, `pr-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(this.button(t, `pd-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .child(this.button(t, `pz-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .child(this.button(t, `px-${pane}`, "close", "pane.close", { pane }))));
  }
}

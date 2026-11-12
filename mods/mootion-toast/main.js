// Notifications for layouts/mootion.json, drawn as Slack-style messages.
// When a notification points at an agent (its action is agent.focus / pane.focus with
// a terminal), it reads as a message from that teammate: avatar, name, time, text and
// actions. Anything else (app notices, mods' notify()) is a plain message from Herdr.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, run, theme, agents } from "herdr";
import { avatar as teamAvatar, firstName } from "./team.js";

const DOT = { error: "blocked", warning: "working", success: "done", info: "accent" };

function agentFor(p) {
  const terminal = p.action?.args?.terminal;
  return terminal ? agents().find(a => a.address === terminal) : null;
}

function message(p, a) {
  if (!a) return p.body ?? "";
  const task = a.title && a.title !== a.program?.name ? a.title : a.tab_name;
  // Herdr's own notices say what happened ("… finished", "… needs you"); the status may have moved on.
  if (a.status === "blocked" || /needs you|blocked/i.test(p.title ?? "")) return `I need you on "${task}".`;
  if (a.status === "done" || a.status === "idle" || /finished|done/i.test(p.title ?? "")) return `Done with "${task}".`;
  return p.body ?? p.title ?? "";
}

export default class NotionToast extends View {
  open() {
    const p = props() ?? {};
    if (agentFor(p)) run("layout.select", { stack: "center", child: "main" });
    if (p.action?.name) run(p.action.name, p.action.args ?? {});
    closeOverlay(p.overlay);
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const a = agentFor(p);
    const program = a?.program;
    const tile = program?.tile ?? (a ? t.raised : t.solid);
    const avatar = a ? teamAvatar(t, a, 32) : div().size(32).flex_none().rounded(7).bg(tile).flex().items_center().justify_center()
      .child(program?.icon
        ? (program.tint ? svg(program.icon).size(22).text_color(program.color ?? "#ffffff") : image(program.icon).size(22))
        : p.icon ? image(p.icon).size(20)
        : div().text_size(16).font_bold().text_color(a ? t.foreground : t.solid_foreground).child((program?.name ?? "Herdr")[0]));
    const who = a ? `${firstName(a)} · ${a.space_name}` : (p.title ?? "Herdr");
    const status = a?.status === "blocked" ? t.blocked : a ? t.done : t[DOT[p.level] ?? "accent"];

    return h_flex().id("toast").size_full().px(12).py(10).gap(10).items_center().bg(t.popover).cursor_pointer()
      .on_click(() => this.open())
      .child(avatar)
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(h_flex().gap(6).items_center()
          .child(div().truncate().font_semibold().text_size(13.5).text_color(t.foreground).child(who))
          .child(div().size(6).flex_none().rounded_full().bg(status))
          .child(div().flex_none().text_size(11.5).text_color(t.dim).child("now")))
        .child(div().truncate().text_size(13).text_color(a ? t.foreground : t.muted).child(message(p, a)))
      )
      .child(div().id("toast-dismiss").size(20).flex_none().flex().items_center().justify_center().rounded(4)
        .text_color(t.dim).hover(e => e.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); closeOverlay(p.overlay); }).child("×"));
  }
}

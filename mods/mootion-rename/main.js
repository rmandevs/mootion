// Renames a teammate (an agent). Open as a dialog with props { address }.
// Enter saves, Esc cancels; the name goes to shared("notion.agentNames") via team.js.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, theme, agents } from "herdr";
import { avatar, agentName, harness, setAgentName } from "./team.js";

export default class Rename extends View {
  init(_props, cx) {
    const a = agents().find(x => x.address === props()?.address);
    const value = a ? agentName(a) : "";
    this.input = InputState.new({ value });
    if (value) this.input.set_selected_range({ start: 0, end: value.length });
    this.input.on("submit", () => this.save());
    this.input.focus();
    // The dialog takes a moment to get the keyboard; ask again once it has.
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  save() {
    const p = props();
    setAgentName(p.address, this.input.value());
    closeOverlay(p.overlay);
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const a = agents().find(x => x.address === p.address);
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(6)
      .border_1().border_color(primary ? t.accent : t.input).bg(primary ? t.accent : t.raised)
      .text_color(primary ? t.accent_foreground : t.foreground).text_size(13).font_medium().cursor_pointer()
      .on_click(action).child(text);
    return v_flex().id("rename").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .w_full().p(18).gap(12).bg(t.popover).text_color(t.foreground)
      .child(h_flex().gap(10).items_center()
        .when(Boolean(a), el => el.child(avatar(t, a, 36, null, true)))
        .child(v_flex()
          .child(div().text_size(15).font_semibold().child("Rename teammate"))
          .child(div().text_size(12).text_color(t.dim).child(a ? `${harness(a)} · ${a.space_name}` : "This agent is no longer running"))))
      .child(Input.new(this.input).h(36).px(10).rounded(6).border_1().border_color(t.accent).bg(t.background)
        .text_size(13.5).text_color(t.foreground))
      .child(h_flex().gap(8).justify_end()
        .child(button("rn-cancel", "Cancel", false, () => closeOverlay(p.overlay)))
        .child(button("rn-save", "Save", true, () => this.save())));
  }
}

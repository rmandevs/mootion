// Names a sidebar section. Open as a dialog with props { id? }: without an id it creates a new
// section (a group of spaces), with one it renames that section. Enter saves, Esc cancels.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, theme } from "herdr";
import { sections, addSection, renameSection } from "./sections.js";

export default class SectionName extends View {
  init(_props, cx) {
    const current = sections().find(s => s.id === props()?.id);
    const value = current?.title ?? "";
    this.input = InputState.new({ value, placeholder: "Section name, e.g. Clients, Side projects" });
    if (value) this.input.set_selected_range({ start: 0, end: value.length });
    this.input.on("submit", () => this.save());
    this.input.focus();
    // The dialog takes a moment to get the keyboard; ask again once it has.
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  save() {
    const p = props();
    const title = this.input.value();
    if (p.id) renameSection(p.id, title);
    else if (title.trim()) addSection(title);
    closeOverlay(p.overlay);
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(6)
      .border_1().border_color(primary ? t.accent : t.input).bg(primary ? t.accent : t.raised)
      .text_color(primary ? t.accent_foreground : t.foreground).text_size(13).font_medium().cursor_pointer()
      .on_click(action).child(text);
    return v_flex().id("section-name").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .w_full().p(18).gap(12).bg(t.popover).text_color(t.foreground)
      .child(v_flex()
        .child(div().text_size(15).font_semibold().child(p.id ? "Rename section" : "New section"))
        .child(div().text_size(12).text_color(t.dim).child(p.id ? "Shown as the heading in the sidebar." : "Then add spaces to it from its menu (right-click the heading).")))
      .child(Input.new(this.input).h(36).px(10).rounded(6).border_1().border_color(t.accent).bg(t.background)
        .text_size(13.5).text_color(t.foreground))
      .child(h_flex().gap(8).justify_end()
        .child(button("sn-cancel", "Cancel", false, () => closeOverlay(p.overlay)))
        .child(button("sn-save", p.id ? "Save" : "Create", true, () => this.save())));
  }
}

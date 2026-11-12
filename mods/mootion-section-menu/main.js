// The menu of a sidebar section (right-click its heading). Popup with props { id }.
// Rename, add spaces (own sections), move up or down, hide (built-ins) or delete (own sections).

import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { props, closeOverlay, openOverlay, theme } from "herdr";
import { sections, moveSection, setHidden, removeSection } from "./sections.js";

export default class SectionMenu extends View {
  render() {
    const t = theme();
    const p = props() ?? {};
    const list = sections();
    const i = list.findIndex(s => s.id === p.id);
    const s = list[i];
    if (!s) return div();
    const close = () => closeOverlay(p.overlay);
    const item = (id, label, action, danger = false) => div().id(id).h(30).px(10).flex().items_center().rounded(5)
      .text_size(13).text_color(danger ? t.blocked : t.foreground).cursor_pointer().hover(e => e.bg(t.hover))
      .on_click(() => { close(); action(); }).child(label);
    return v_flex().size_full().p(5).gap(1).bg(t.popover)
      .child(div().px(10).pt(4).pb(6).text_size(11.5).font_medium().text_color(t.dim).truncate().child(s.title))
      .child(item("sm-rename", "Rename", () => openOverlay({ mod: "mootion-section", kind: "dialog", width: 380, props: { id: s.id } })))
      .when(s.kind === "group", el => el.child(item("sm-spaces", "Choose spaces…", () =>
        openOverlay({ mod: "mootion-section-spaces", kind: "popup", width: 300, height: 340, props: { id: s.id } }))))
      .when(i > 0, el => el.child(item("sm-up", "Move up", () => moveSection(s.id, -1))))
      .when(i < list.length - 1, el => el.child(item("sm-down", "Move down", () => moveSection(s.id, 1))))
      .child(s.kind === "group"
        ? item("sm-delete", "Delete section", () => removeSection(s.id), true)
        : item("sm-hide", "Hide section", () => setHidden(s.id, true)));
  }
}

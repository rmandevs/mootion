// Chooses which spaces an own sidebar section holds. Popup with props { id }.
// Click a space to put it in this section (it leaves Spaces or any other section) or take it out.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, theme, spaces, shared } from "herdr";
import { sections, setSpaceGroup, groupOf } from "./sections.js";
import { spaceIcon, renderIcon } from "./emoji.js";

export default class SectionSpaces extends View {
  render() {
    const t = theme();
    const p = props() ?? {};
    const section = sections().find(s => s.id === p.id);
    if (!section) return div();
    const notesSpace = shared("notion.notes")?.space;
    const list = spaces().filter(s => s.id !== notesSpace);
    return v_flex().size_full().p(8).gap(4).bg(t.popover).text_size(13)
      .child(h_flex().px(6).pt(2).pb(4).justify_between().items_center()
        .child(div().font_semibold().text_color(t.foreground).truncate().child(`Spaces in ${section.title}`))
        .child(div().id("ss-done").px(8).h(24).flex().items_center().rounded(5).text_size(12).text_color(t.accent)
          .cursor_pointer().hover(e => e.bg(t.hover)).on_click(() => closeOverlay(p.overlay)).child("Done")))
      .child(v_flex().id("ss-list").flex_1().min_h(0).overflow_y_scrollbar().gap(1)
        .children(list.map(s => {
          const owner = groupOf(s.id);
          const inHere = owner?.id === section.id;
          return h_flex().id(`ss-${s.id}`).h(32).flex_none().px(8).gap(8).items_center().rounded(5).cursor_pointer()
            .hover(e => e.bg(t.hover)).on_click((_e, cx) => { setSpaceGroup(s.id, section.id, !inHere); cx.notify(); })
            .child(div().size(16).flex_none().rounded(4).border(1).border_color(inHere ? t.accent : t.input)
              .bg(inHere ? t.accent : t.popover).flex().items_center().justify_center()
              .text_size(11).text_color(t.accent_foreground).child(inHere ? "✓" : ""))
            .child(renderIcon(spaceIcon(s), 14, t.muted))
            .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(s.name))
            .when(Boolean(owner) && !inHere, e => e.child(div().max_w(90).truncate().text_size(11.5).text_color(t.dim).child(owner.title)));
        }))
        .when(!list.length, e => e.child(div().p(8).text_color(t.dim).child("No spaces yet."))));
  }
}

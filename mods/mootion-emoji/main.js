// Icon picker for a space, a tab or Notes: an emoji (the system's own picker) or an icon.
// Open as a popup with props { id, name }. The field below has the keyboard: open the system
// picker (⌃⌘Space or 🌐 E on macOS, Win+. on Windows) and the first emoji that lands in the
// field becomes the icon. "Open emoji viewer" asks macOS to open it for you (System Events;
// the first time macOS may ask to allow Accessibility). Recent picks and Reset are one click.
// The Icons tab offers the lucide icons in mods/mootion-sidebar/icons/, saved as "icon:<name>".

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, theme, shared, setShared, window, exec } from "herdr";
import { setIcon, autoIcon, ICONS, ICON_DIR, renderIcon } from "./emoji.js";

const PER_ROW = 9;

// One emoji: a pictographic sequence (with variation selectors, skin tones and ZWJ joins), a flag,
// or a keycap.
const EMOJI = /(?:\p{Extended_Pictographic}(?:️|︎)?(?:[\u{1F3FB}-\u{1F3FF}])?(?:‍\p{Extended_Pictographic}(?:️)?(?:[\u{1F3FB}-\u{1F3FF}])?)*|[\u{1F1E6}-\u{1F1FF}]{2}|[0-9#*]️?⃣)/u;

const HINT = {
  macos: "Press ⌃⌘Space (or 🌐 E) to open the emoji picker",
  windows: "Press Win + . to open the emoji picker",
  linux: "Paste an emoji, or use your desktop's emoji picker",
};

export default class EmojiPicker extends View {
  init(_props, cx) {
    this.mode = "emoji";
    this.input = InputState.new({ placeholder: "Emoji goes here" });
    this.input.on("change", (_e, cx) => {
      const found = EMOJI.exec(this.input.value());
      if (found) this.pick(found[0]);
      else { this.note = this.input.value().trim() ? "That's not an emoji. Use the system picker." : null; cx.notify(); }
    });
    this.input.focus();
    // The popup takes a moment to get the keyboard; ask again once it has.
    cx.timer.after(400, () => this.input.focus());
  }

  pick(emoji) {
    const p = props();
    setIcon(p.id, emoji);
    if (emoji && !emoji.startsWith("icon:")) setShared("notion.recentEmoji", [emoji, ...(shared("notion.recentEmoji") ?? []).filter(e => e !== emoji)].slice(0, 9));
    closeOverlay(p.overlay);
  }

  openViewer(cx) {
    this.input.focus();
    cx.spawn(async (cx) => {
      const r = await exec("osascript", ["-e", 'tell application "System Events" to key code 49 using {control down, command down}'])
        .catch(e => ({ code: 1, stderr: String(e) }));
      if (r.code !== 0) {
        this.note = "macOS didn't let Herdr open it. Press ⌃⌘Space, or allow Herdr in Privacy & Security → Accessibility.";
        cx.notify();
      }
    });
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const platform = window()?.platform ?? "macos";
    const recent = shared("notion.recentEmoji") ?? [];
    const button = (id, label, action) => div().id(id).px(10).h(28).flex().items_center().rounded(5).text_size(12.5)
      .border(1).border_color(t.border).text_color(t.foreground).cursor_pointer().hover(s => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); action(cx); }).child(label);

    const tab = (id, label, mode) => div().id(id).px(10).h(26).flex().items_center().rounded(5).text_size(12.5)
      .bg(this.mode === mode ? t.hover : t.popover).text_color(this.mode === mode ? t.foreground : t.muted).cursor_pointer()
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.mode = mode; if (mode === "emoji") this.input.focus(); cx.notify(); })
      .child(label);
    const header = h_flex().gap(4).items_center()
      .child(div().flex_1().min_w(0).truncate().font_semibold().text_color(t.foreground).child(`Icon for ${p.name ?? "this page"}`))
      .child(tab("mode-emoji", "Emoji", "emoji"))
      .child(tab("mode-icons", "Icons", "icons"));

    if (this.mode === "icons") {
      const rows = [];
      for (let i = 0; i < ICONS.length; i += PER_ROW)
        rows.push(h_flex().id(`icon-row-${i}`).flex_none().children(ICONS.slice(i, i + PER_ROW).map(name =>
          div().id(`icon-${name}`).size(34).flex_none().flex().items_center().justify_center().rounded(5).text_color(t.foreground)
            .cursor_pointer().hover(s => s.bg(t.hover))
            .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.pick(`icon:${name}`); })
            .child(svg(`${ICON_DIR}/${name}.svg`).size(17)))));
      return v_flex().size_full().bg(t.popover).p(14).gap(10).text_size(13).text_color(t.muted)
        .child(header)
        .child(v_flex().id("icon-grid").flex_1().min_h(0).overflow_y_scrollbar().children(rows))
        .child(h_flex().gap(6).child(button("icon-reset", "Reset", () => this.pick(null))));
    }

    return v_flex().size_full().bg(t.popover).p(14).gap(10).text_size(13).text_color(t.muted)
      .child(header)
      .child(h_flex().id("emoji-field").h(40).px(10).items_center().rounded(6).border(1).border_color(t.accent)
        .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.input.focus(); })
        .child(Input.new(this.input).flex_1().text_size(18).text_color(t.foreground)))
      .child(div().text_size(12).text_color(this.note ? t.blocked : t.dim).child(this.note ?? HINT[platform] ?? HINT.linux))
      .child(h_flex().gap(6).items_center()
        .when(platform === "macos", el => el.child(button("emoji-open", "Open emoji viewer", (cx) => this.openViewer(cx))))
        .child(button("emoji-reset", `Reset to ${autoIcon(p.name ?? "", p.id)}`, () => this.pick(null)))
        .child(div().flex_1())
        .children(recent.slice(0, 5).map((e, i) => div().id(`recent-${i}`).size(28).flex().items_center().justify_center()
          .rounded(5).text_size(18).cursor_pointer().hover(s => s.bg(t.hover))
          .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.pick(e); }).child(e))));
  }
}

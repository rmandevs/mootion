// The top bar of layouts/mootion.json, drawn as Notion breadcrumbs:
//   🧪 space / 📄 tab   📄 other tab   …            +  Files  Changes  ···
// Tabs are pages of the space: click selects, double-click renames, drag reorders,
// right-click opens the tab menu. Files and Changes toggle the right panel; the
// choice is remembered per space (same logic as the shipped `tabs` mod).
// While the Inbox page shows (the "center" stack), the bar reads "📥 Inbox" instead.

import { View, div, svg } from "gpui-kit";
import { h_flex, ScrollHandle } from "gpui-base";
import { spaces, panes, run, openOverlay, theme, window, shared, layout, settings } from "herdr";
import { spaceIcon, tabIcon, renderIcon } from "./emoji.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Crumbs extends View {
  init() {
    this.pressed = null;
    this.scroll = ScrollHandle.new();
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  tabName(c) {
    if (c.named) return c.name;
    const agent = panes().find(p => p.tab === c.id && p.program?.agent);
    if (agent) return agent.title && agent.title !== agent.program.name ? agent.title : agent.program.name;
    return "Untitled";
  }

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const active = shown.findIndex(tab => tab.active);
    if (shown[active]?.id !== this.selected) {
      this.selected = shown[active]?.id;
      if (active >= 0) this.scroll.scroll_to_item(active);
    }
    const stop = (_e, cx) => cx.stop_propagation();
    const textButton = (id, label, on, action) => h_flex().id(id).h(26).px(8).gap(5).flex_none().items_center().rounded(5)
      .text_size(13).bg(on ? t.hover : t.background).text_color(on ? t.foreground : t.muted)
      .hover(s => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", stop).on_click(action).child(label);

    const item = (c, i) => h_flex().id(`tab-${c.id}`).h(26).px(6).gap(6).rounded(5).items_center().flex_none()
      .bg(c.active ? t.hover : t.background).text_color(c.active ? t.foreground : t.muted)
      .when(c.active, el => el.font_medium())
      .hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
      .on_mouse_up("left", () => {
        const from = this.pressed; this.pressed = null;
        if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
        else run("tab.select", { id: c.id });
      })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
      .child(renderIcon(tabIcon(c), 14, c.active ? t.foreground : t.muted))
      .child(div().max_w(220).truncate().child(c.zoomed ? `${this.tabName(c)} (zoomed)` : this.tabName(c)))
      .when(c.status === "working", el => el.child(svg("mods/mootion-crumbs/spinner.svg").size(11).flex_none().text_color(t.working).spin(900)))
      .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded_full().bg(t[c.status])));

    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(12, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 12;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = shared("workspace.panels") ?? ["files", "changes"];
    this.syncPanel(space, panel, body, enabled);
    const panelButton = (id, label) => {
      const on = panel && !panel.hidden && body?.active === id;
      return textButton(`panel-${id}`, label, on, () => {
        if (on) run("layout.hide", { id: "panel" });
        else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
      });
    };
    const activeTab = shown[active];

    const PAGES = { inbox: ["📥", "Inbox"], customize: ["🎨", "Customize"] };
    const page = PAGES[find(root, "center")?.active];
    if (page) {
      return h_flex().size_full().min_w(0).pr(10).pl(lightsPadding).gap(2).items_center().bg(t.background).text_size(13.5)
        .when(Boolean(space), el => el.child(h_flex().id("crumb-back").h(26).px(6).gap(6).items_center().flex_none().rounded(5)
          .text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", stop)
          .on_click(() => run("layout.select", { stack: "center", child: "main" }))
          .child(renderIcon(spaceIcon(space), 14, t.muted)).child(div().max_w(180).truncate().child(space.name))))
        .child(div().px(2).text_color(t.dim).child("/"))
        .child(h_flex().h(26).px(6).gap(6).items_center().rounded(5).bg(t.hover).font_medium().text_color(t.foreground)
          .child(div().text_size(14).child(page[0])).child(page[1]))
        .child(div().flex_1());
    }

    return h_flex().size_full().min_w(0).pr(10).pl(lightsPadding).gap(2).items_center().bg(t.background).text_size(13.5)
      .on_mouse_up("left", () => { this.pressed = null; })
      .when(Boolean(space), el => el
        .child(h_flex().id("crumb-space").h(26).px(6).gap(6).items_center().flex_none().rounded(5).text_color(t.muted)
          .hover(s => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", stop)
          .on_click(() => openOverlay({ mod: "mootion-emoji", kind: "popup", width: 360, height: 320, props: { id: space.id, name: space.name } }))
          .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "space", target: { id: space.id } } }); })
          .child(renderIcon(spaceIcon(space), 14, t.muted)).child(div().max_w(180).truncate().child(space.name)))
        .child(div().px(2).text_color(t.dim).child("/")))
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(2).overflow_x_scrollbar().track_scroll(this.scroll)
        .children(shown.map(item))
        .child(div().id("tab-new-inline").size(24).flex_none().flex().items_center().justify_center().rounded(5).text_color(t.dim)
          .hover(s => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", stop)
          .on_click(() => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })).child("+")))
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes")))
      .when(Boolean(activeTab), el => el.child(textButton("tab-more", "···", false, (_e, cx) => openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: activeTab.id, space: space.id } } }))))
      .when(w?.buttons, el => el.child(textButton("minimize", "−", false, () => run("window.minimize")))
        .child(textButton("maximize", "□", false, () => run("window.maximize")))
        .child(textButton("close-window", "×", false, () => run("window.close"))));
  }
}

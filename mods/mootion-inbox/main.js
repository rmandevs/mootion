// The Inbox page of layouts/mootion.json (the "inbox" child of the "center" stack), Slack style:
// teammates (agents) on the left with their last message, the selected one's thread on the right.
// Messages come from the history mootion-sidebar records in shared("notion.inbox") on every status
// change. Each thread starts with a Summary: on request, the agent's recent terminal output goes
// through `claude -p` (haiku) and the result is kept in shared("notion.summaries").
// Replying types into the agent's terminal with `hc send`.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { agents, shared, setShared, run, theme, exec, settings, openOverlay } from "herdr";
import { avatar, firstName, me, harness } from "./team.js";

// Must match terminal_padding's horizontal value in layouts/mootion.json, like mootion-page.
const MARGIN = 56;
const RANK = { blocked: 0, done: 1, working: 2, idle: 3 };
const LABEL = { blocked: "Needs you", done: "Done", working: "Working", idle: "Idle" };
const SUMMARY_PROMPT = "Below is the recent terminal output of a coding agent session. Write a short summary "
  + "for a teammate's inbox: 2 to 4 bullet points, each starting with \"• \", covering what it worked on, what it "
  + "finished, and anything pending or waiting on the person. Under 80 words, plain text, no headings, no preamble. "
  + "Write in the language the person used in the session.";

function clock(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function day(ms) {
  const d = new Date(ms), today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString();
}

function text(e) {
  if (e.status === "you") return e.text;
  if (e.status === "working") return `Started on "${e.task}".`;
  if (e.status === "blocked") return `I need you on "${e.task}".`;
  if (e.status === "done") return `Done with "${e.task}".`;
  return "Back to idle.";
}

const task = (a) => (a.title && a.title !== a.program?.name ? a.title : a.tab_name);
const showWork = () => run("layout.select", { stack: "center", child: "main" });

export default class InboxPage extends View {
  init() {
    this.selected = null;
    this.summarizing = new Set();
    this.scroll = ScrollHandle.new();
    this.input = InputState.new({ placeholder: "Message…" });
    this.input.on("submit", (_e, cx) => this.reply(cx));
  }

  reply(cx) {
    const message = this.input.value().trim();
    const a = agents().find(x => x.address === this.selected);
    if (!message || !a) return;
    this.input.set_value("");
    const box = { ...(shared("notion.inbox") ?? {}) };
    box[a.address] = [...(box[a.address] ?? []), { status: "you", at: Date.now(), text: message }].slice(-30);
    setShared("notion.inbox", box);
    cx.spawn(async (cx) => {
      // A blocked agent is waiting on a dialog: the reply is meant to answer it.
      const args = ["send", ...(a.status === "blocked" ? ["--force"] : []), a.address, message];
      const r = await exec("hc", args).catch(e => ({ code: 1, stderr: String(e) }));
      this.error = r.code === 0 ? null : (r.stderr || "Could not send the message").trim();
      cx.notify();
    });
  }

  summarize(a, cx) {
    if (this.summarizing.has(a.address)) return;
    this.summarizing.add(a.address);
    this.summaryError = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        // The screen goes to a file first: `claude -p` stops waiting for stdin after 3 s, and
        // `hc read` can take longer. No MCP servers: they only slow the start down.
        const script = 'f=$(mktemp); hc read "$1" --lines 400 > "$f"; claude -p "$2" --model haiku --strict-mcp-config --mcp-config \'{"mcpServers":{}}\' < "$f"; rc=$?; rm -f "$f"; exit $rc';
        const r = await exec("sh", ["-c", script, "summary", a.address, SUMMARY_PROMPT], { timeout: 180000 });
        if (r.code !== 0 || !r.stdout.trim()) throw new Error((r.stderr || "claude returned nothing").trim().split("\n").pop());
        setShared("notion.summaries", { ...(shared("notion.summaries") ?? {}), [a.address]: { text: r.stdout.trim(), at: Date.now() } });
      } catch (e) {
        this.summaryError = `Could not summarize: ${String(e.message ?? e)}`;
      } finally {
        this.summarizing.delete(a.address);
        cx.notify();
      }
    });
  }

  you(_t, size) { return me(size); }

  listRow(t, a, events) {
    const unread = a.status === "done" || a.status === "blocked";
    const on = a.address === this.selected;
    const last = events.at(-1);
    return h_flex().id(`in-${a.address}`).h(52).flex_none().px(8).gap(10).items_center().rounded(6).cursor_pointer()
      .bg(on ? t.hover : t.background).hover(s => s.bg(t.hover))
      .on_click((_e, cx) => { this.selected = a.address; this.error = null; this.summaryError = null; cx.notify(); })
      .child(avatar(t, a, 30, on ? t.hover : t.background, true))
      .child(v_flex().flex_1().min_w(0)
        .child(h_flex().gap(6).items_center()
          .child(div().flex_none().text_size(13.5).text_color(t.foreground).when(unread, e => e.font_semibold()).child(firstName(a)))
          .child(div().min_w(0).truncate().text_size(12).text_color(t.dim).child(a.space_name))
          .child(div().flex_1())
          .when(Boolean(last), e => e.child(div().flex_none().text_size(11).text_color(t.dim).child(clock(last.at)))))
        .child(div().truncate().text_size(12.5).text_color(unread ? t.foreground : t.muted)
          .child(last ? (last.status === "you" ? `You: ${last.text}` : text(last)) : LABEL[a.status])))
      .when(unread, el => el.child(div().size(8).flex_none().rounded_full().bg(a.status === "blocked" ? t.blocked : t.accent)));
  }

  summary(t, a) {
    const s = shared("notion.summaries")?.[a.address];
    const busy = this.summarizing.has(a.address);
    const link = (id, label) => div().id(id).text_size(12.5).text_color(t.accent).cursor_pointer()
      .hover(e => e.underline()).on_click((_e, cx) => this.summarize(a, cx)).child(label);
    return h_flex().id("summary").gap(10).items_start().px(14).py(12).rounded(6).bg(t.raised)
      .child(div().text_size(17).child("💡"))
      .child(v_flex().flex_1().min_w(0).gap(4)
        .child(h_flex().gap(8).items_center()
          .child(div().font_semibold().text_size(13.5).child("Summary"))
          .when(Boolean(s) && !busy, e => e.child(div().text_size(11.5).text_color(t.dim).child(`Updated ${day(s.at).toLowerCase()} ${clock(s.at)}`)))
          .child(div().flex_1())
          .when(Boolean(s) && !busy, e => e.child(link("summary-refresh", "Refresh"))))
        .when(busy, e => e.child(h_flex().gap(6).items_center().text_size(13).text_color(t.muted)
          .child(svg("mods/mootion-inbox/spinner.svg").size(12).text_color(t.muted).spin(900))
          .child(`Reading ${firstName(a)}'s terminal…`)))
        .when(!busy && Boolean(s), e => e.children(s.text.split("\n").filter(Boolean)
          .map((line, i) => div().id(`sum-${i}`).text_size(13.5).text_color(t.foreground).child(line))))
        .when(!busy && !s, e => e.child(div().text_size(13).text_color(t.muted)
          .child(`What has ${firstName(a)} been doing? A short summary of its recent terminal output.`))
          .child(div().pt(2).child(link("summary-make", "Summarize"))))
        .when(Boolean(this.summaryError), e => e.child(div().text_size(12).text_color(t.blocked).child(this.summaryError))));
  }

  message(t, a, e, i, latest) {
    const mine = e.status === "you";
    return h_flex().id(`msg-${i}`).gap(10).items_start()
      .child(mine ? this.you(t, 34) : avatar(t, a, 34))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(h_flex().gap(6).items_center()
          .child(div().font_semibold().text_color(t.foreground).child(mine ? "You" : firstName(a)))
          .child(div().text_size(11.5).text_color(t.dim).child(clock(e.at))))
        .child(div().text_color(t.foreground).child(text(e)))
        .when(Boolean(e.lines?.length), el => el.child(v_flex().mt(4).px(10).py(8).rounded(6).border(1).border_color(t.border)
          .gap(1).font_family(settings().font_family ?? "JetBrains Mono").text_size(11.5).text_color(t.muted)
          .children(e.lines.map((line, j) => div().id(`ln-${i}-${j}`).truncate().child(line)))))
        .when(latest && (e.status === "blocked" || e.status === "done"), el => el.child(h_flex().pt(6)
          .child(div().id(`open-${i}`).px(10).h(26).flex().items_center().rounded(5).bg(t.accent).text_size(12.5)
            .text_color(t.accent_foreground).cursor_pointer()
            .on_click(() => { showWork(); run("agent.focus", { terminal: a.address }); })
            .child("Open terminal")))));
  }

  render() {
    const t = theme();
    const box = shared("notion.inbox") ?? {};
    const team = [...agents()].sort((x, y) => (RANK[x.status] - RANK[y.status]) || (y.seq - x.seq));
    if (!team.some(a => a.address === this.selected)) {
      // Open on whoever needs you, else whoever posted last.
      const latest = (x) => box[x.address]?.at(-1)?.at ?? 0;
      const pick = team.find(x => x.status === "blocked" || x.status === "done") ?? [...team].sort((x, y) => latest(y) - latest(x))[0];
      this.selected = pick?.address ?? null;
    }
    const a = team.find(x => x.address === this.selected);
    const events = (a && box[a.address]) ?? [];
    const unread = team.filter(x => x.status === "done" || x.status === "blocked");
    const rest = team.filter(x => !(x.status === "done" || x.status === "blocked"));
    if (events.length !== this.count || a?.address !== this.countFor) {
      this.count = events.length; this.countFor = a?.address;
      this.scroll.scroll_to_item(events.length * 2 + 1);
    }

    const thread = [];
    if (a) thread.push(this.summary(t, a));
    let lastDay = null;
    events.forEach((e, i) => {
      const d = day(e.at);
      if (d !== lastDay) {
        lastDay = d;
        thread.push(h_flex().id(`day-${i}`).gap(10).items_center().text_size(11.5).text_color(t.dim)
          .child(div().flex_1().h(1).bg(t.border)).child(d).child(div().flex_1().h(1).bg(t.border)));
      }
      thread.push(this.message(t, a, e, i, i === events.length - 1));
    });
    if (a && !events.length) thread.push(div().text_size(13).text_color(t.dim)
      .child(`No messages yet. ${firstName(a)} posts here when it starts, finishes or needs you.`));

    const section = (label) => div().px(8).pt(10).pb(4).text_size(12).font_medium().text_color(t.dim).child(label);
    const prop = (label, value) => h_flex().gap(6).child(div().text_color(t.dim).child(label)).child(div().text_color(t.foreground).child(value));

    return v_flex().size_full().bg(t.background).text_size(14).text_color(t.foreground)
      // The page's own header, laid out like mootion-page's.
      .child(v_flex().flex_none().px(MARGIN).pt(14).pb(12).gap(4).border_b(1).border_color(t.border)
        .child(div().h(42).flex().items_center().text_size(36).child("📥"))
        .child(div().h(40).flex().items_center().text_size(28).font_bold().child("Inbox"))
        .child(h_flex().h(22).gap(20).items_center().text_size(13)
          .child(prop("Unread", unread.length ? String(unread.length) : "None"))
          .child(prop("Team", String(team.length)))
          .child(prop("Messages", "status changes of every agent"))))
      .child(h_flex().flex_1().min_h(0)
        .child(v_flex().id("inbox-list").w(300).flex_none().h_full().pl(MARGIN - 14).pr(8).pb(10).overflow_y_scrollbar()
          .border_r(1).border_color(t.border)
          .when(unread.length > 0, el => el.child(section("Unread")).children(unread.map(x => this.listRow(t, x, box[x.address] ?? []))))
          .when(rest.length > 0, el => el.child(section(unread.length ? "Earlier" : "Team")).children(rest.map(x => this.listRow(t, x, box[x.address] ?? []))))
          .when(!team.length, el => el.child(div().p(8).text_size(13).text_color(t.dim).child("No agents running. Start one with + in the top bar."))))
        .child(v_flex().flex_1().min_w(0).h_full()
          .when(Boolean(a), el => el
            .child(h_flex().h(60).flex_none().px(24).gap(10).items_center().border_b(1).border_color(t.border)
              .child(avatar(t, a, 34, null, true))
              .child(v_flex().min_w(0)
                .child(h_flex().gap(8).items_center()
                  .child(div().id("thread-name").font_semibold().px(4).mx(-4).rounded(4).cursor_pointer().hover(s => s.bg(t.hover))
                    .tooltip("Rename").on_click(() => openOverlay({ mod: "mootion-rename", kind: "dialog", width: 360, props: { address: a.address } }))
                    .child(firstName(a)))
                  .child(div().text_size(12).text_color(t.dim).child(harness(a)))
                  .child(h_flex().px(7).h(20).gap(5).items_center().rounded(10).border(1).border_color(t.border).text_size(11.5).text_color(t.muted)
                    .child(a.status === "working"
                      ? svg("mods/mootion-inbox/spinner.svg").size(10).text_color(t.working).spin(900)
                      : div().size(7).rounded_full().bg(a.status === "idle" ? t.idle : t[a.status]))
                    .child(LABEL[a.status])))
                .child(div().truncate().text_size(12).text_color(t.dim).child(`${a.space_name} · ${task(a)}`)))
              .child(div().flex_1())
              .child(div().id("thread-open").px(10).h(28).flex().items_center().rounded(5).border(1).border_color(t.border)
                .text_size(12.5).cursor_pointer().hover(s => s.bg(t.hover))
                .on_click(() => { showWork(); run("agent.focus", { terminal: a.address }); }).child("Open terminal")))
            .child(v_flex().id("thread").flex_1().min_h(0).px(24).py(16).gap(16).overflow_y_scrollbar().track_scroll(this.scroll)
              .children(thread))
            .child(v_flex().flex_none().px(24).pb(16).gap(4)
              .when(Boolean(this.error), e => e.child(div().text_size(12).text_color(t.blocked).child(this.error)))
              .child(h_flex().id("reply").h(40).px(12).items_center().rounded(8).border(1).border_color(t.input).cursor_text()
                .child(Input.new(this.input).flex_1().text_size(13.5).text_color(t.foreground))
                .child(div().text_size(11.5).text_color(t.dim).child(`↵ sends to ${firstName(a)}'s terminal`)))))
          .when(!a, el => el.child(div().p(24).text_color(t.dim).child("Start an agent to see its messages here.")))));
  }
}

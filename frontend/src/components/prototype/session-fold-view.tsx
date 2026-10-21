/**
 * prototype-as-code 演示视图 —— 会话页「过程呈现」改造后的真实屏（三栏整屏）。
 *
 * 与 session-portal-view.tsx 同款真实骨架：左会话树 / 中会话流 / 右文件栏，外加会话头配置条、
 * 轮次窄轨、ctx 用量与输入区。差别只在**中栏消息流**：过程项从「靠切视图看」改为「同屏可伸缩」。
 *
 * 依据：.sillyspec/changes/2026-10-20-session-page-dsh-alignment/decisions.md
 *   D-004 原型先行 / D-005 双形态对比 / D-009 A/C 差异只在「旧进度视图是否保留」
 * 规约：.sillyspec/docs/SillyHub/scan/PROTOTYPE.md（real-code：真实 primer + Tailwind + token）
 *
 * 交互：用 prototype-build 内嵌的 data-state-btn / data-state-panel 机制切换四态
 *   （标准档 / 展开一轮 / 详细档 / C 形态），初始态名必须是 active（脚本默认 setState("active")）。
 */
import * as React from "react";

import { MetaPanel, MetaPanelSection, StateIcon, StateLabel } from "../primer";
import { DemoBar } from "./demo-chrome";

/* ───────────── token（禁字面色；三主题由 data-theme 切换） ───────────── */
const BRAND_SOFT = "var(--color-brand-50)";
const BRAND_LINE = "var(--color-brand-200)";
const BRAND = "var(--color-brand-600)";
const BRAND_STRONG = "var(--color-brand-700)";
const SUCCESS = "var(--color-success)";
const ERROR = "var(--color-error)";
const BORDER = "hsl(var(--border))";
const MUTED = "hsl(var(--muted))";
const MUTED_FG = "hsl(var(--muted-foreground))";

/* ───────────── 左栏：会话树 ───────────── */

type Entry = {
  id: string;
  title: string;
  time: string;
  state: "open" | "attention" | "merged";
  stateText: string;
  chips: string[];
  selected?: boolean;
};

const GROUP_MP: Entry[] = [
  {
    id: "s1",
    title: "会话页过程呈现 · 改造",
    time: "刚刚",
    state: "open",
    stateText: "运行中",
    chips: ["Claude Code", "claude-opus", "主控"],
    selected: true,
  },
  {
    id: "s2",
    title: "会话状态实时同步 · 左栏状态点",
    time: "12 分钟前",
    state: "attention",
    stateText: "等待",
    chips: ["Codex", "gpt-5", "—"],
  },
  {
    id: "s3",
    title: "预设引擎端点 · 供应商联动",
    time: "1 小时前",
    state: "merged",
    stateText: "完成",
    chips: ["Claude Code", "claude-opus", "代码评审"],
  },
];

const GROUP_DSH: Entry[] = [
  {
    id: "s4",
    title: "worktree 抢占 · 幽灵绑定清理",
    time: "昨天",
    state: "merged",
    stateText: "完成",
    chips: ["Codex", "gpt-5", "—"],
  },
];

function SessionRow({ s }: { s: Entry }) {
  return (
    <div
      className={`flex cursor-pointer flex-col gap-1 border-l-2 px-3 py-2 ${
        s.selected ? "" : "hover:bg-muted/60"
      }`}
      style={{
        backgroundColor: s.selected ? BRAND_SOFT : undefined,
        borderColor: s.selected ? BRAND : "transparent",
      }}
    >
      <div className="flex items-center gap-1.5">
        <StateIcon name={s.state === "merged" ? "mergedCheck" : s.state === "attention" ? "clock" : "openCircle"} size={12} />
        <span className={`min-w-0 flex-1 truncate text-[13px] ${s.selected ? "font-semibold" : "font-medium"}`}>
          {s.title}
        </span>
        <span className="flex-shrink-0 font-mono text-[10.5px] text-muted-foreground">{s.time}</span>
      </div>
      <div className="flex items-center gap-1.5 pl-[18px]">
        <StateLabel variant={s.state} withIcon={false}>
          {s.stateText}
        </StateLabel>
        {s.chips.map((c) => (
          <span
            key={c}
            className="truncate rounded border px-1 py-px font-mono text-[10px] text-muted-foreground"
            style={{ borderColor: BORDER }}
          >
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}

function LeftPanel() {
  return (
    <aside
      className="flex w-[268px] flex-shrink-0 flex-col overflow-hidden border-r"
      style={{ borderColor: BORDER }}
    >
      <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: BORDER }}>
        <span className="text-[12px] font-semibold text-muted-foreground">会话</span>
        <span className="flex items-center gap-1 font-mono text-[10.5px] text-muted-foreground">
          <span title="新建会话" className="rounded border px-1" style={{ borderColor: BORDER }}>
            ＋
          </span>
          共 500 条
        </span>
      </div>
      <div className="flex items-center gap-1.5 border-b px-3 py-1.5" style={{ borderColor: BORDER }}>
        {["全部", "Claude Code", "Codex"].map((t, i) => (
          <span
            key={t}
            className="rounded-full border px-1.5 py-px text-[10.5px]"
            style={
              i === 0
                ? { borderColor: BRAND_LINE, color: BRAND_STRONG, backgroundColor: BRAND_SOFT }
                : { borderColor: BORDER, color: MUTED_FG }
            }
          >
            {t}
          </span>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="flex items-center gap-1.5 px-3 pb-1 pt-2.5 text-[11.5px] font-semibold">
          <span className="text-muted-foreground">▾</span>
          <span>📂 multi-agent-platform</span>
          <span className="font-mono text-[10px] text-muted-foreground">3</span>
          <span
            className="ml-auto rounded border px-1 font-mono text-[10px] text-muted-foreground"
            style={{ borderColor: BORDER }}
          >
            ＋
          </span>
        </div>
        <div className="flex items-center gap-1.5 px-5 pb-1 pt-1 text-[10.5px] text-muted-foreground">
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: SUCCESS }} />
          DESKTOP-HJ0AM09
        </div>
        {GROUP_MP.map((s) => (
          <SessionRow key={s.id} s={s} />
        ))}
        <div className="flex items-center gap-1.5 px-3 pb-1 pt-3 text-[11.5px] font-semibold">
          <span className="text-muted-foreground">▸</span>
          <span>📂 deepseek-harness</span>
          <span className="font-mono text-[10px] text-muted-foreground">1</span>
        </div>
        <div className="px-3 pb-2 pt-1 text-[10.5px] text-muted-foreground">组内还有 1 条 · 展开查看</div>
      </div>
    </aside>
  );
}

/* ───────────── 中栏：消息流块 ───────────── */

function UserBubble({ text, time, att }: { text: string; time: string; att?: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[76%]">
        {att ? (
          <div className="mb-1 flex justify-end gap-1">
            <span
              className="rounded border px-1.5 py-px font-mono text-[10.5px]"
              style={{ borderColor: BRAND_LINE, color: BRAND_STRONG, backgroundColor: BRAND_SOFT }}
            >
              📎 {att}
            </span>
          </div>
        ) : null}
        <div
          className="rounded-xl rounded-br-sm px-3.5 py-2 text-[13.5px] leading-6"
          style={{ backgroundColor: BRAND_SOFT }}
        >
          {text}
        </div>
        <div className="mt-0.5 text-right font-mono text-[10.5px] text-muted-foreground">{time}</div>
      </div>
    </div>
  );
}

function AssistantHead({ time, engine, model }: { time: string; engine: string; model: string }) {
  return (
    <div className="mb-1 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
      <span
        className="flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
        style={{ backgroundColor: BRAND_SOFT, color: BRAND_STRONG }}
      >
        Q
      </span>
      <span className="font-medium text-foreground">qinyi · 主控</span>
      <span className="rounded-full border px-1.5 font-mono text-[10px]" style={{ borderColor: BORDER }}>
        {engine}
      </span>
      <span className="font-mono text-[10px]">{model}</span>
      <span className="font-mono text-[10px]">{time}</span>
    </div>
  );
}

/** 过程分组标题：折叠态下是过程内容唯一的可见代表。 */
function GroupHeader({ title, meta, open }: { title: string; meta: string; open?: boolean }) {
  return (
    <div
      className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12.5px]"
      style={{
        borderColor: open ? BRAND_LINE : BORDER,
        backgroundColor: open ? BRAND_SOFT : "transparent",
      }}
    >
      <span className="font-mono text-[10.5px]" style={{ color: open ? BRAND_STRONG : MUTED_FG }}>
        {open ? "▾" : "▸"}
      </span>
      <span className="font-medium" style={{ color: open ? BRAND_STRONG : MUTED_FG }}>
        {title}
      </span>
      <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">{meta}</span>
    </div>
  );
}

function Disclosure({
  kind,
  title,
  meta,
  state,
  open,
  mono,
  children,
}: {
  kind: "think" | "tool" | "bash" | "read";
  title: string;
  meta?: string;
  state?: "ok" | "run" | "fail";
  open?: boolean;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  const icon = kind === "think" ? "💭" : kind === "bash" ? "⌘" : kind === "read" ? "📄" : "🔧";
  const dot = state === "run" ? BRAND : state === "fail" ? ERROR : SUCCESS;
  return (
    <div>
      <div className="flex items-center gap-1.5 py-[3px] text-[12px]">
        <span className="w-3.5 flex-shrink-0 text-center text-[10.5px]">{icon}</span>
        <span
          className={`truncate ${mono ? "font-mono text-[11px]" : ""}`}
          style={{ color: open ? "hsl(var(--foreground))" : MUTED_FG }}
        >
          {title}
        </span>
        {meta ? (
          <span className="flex-shrink-0 font-mono text-[10.5px] text-muted-foreground">{meta}</span>
        ) : null}
        <span className="ml-auto flex flex-shrink-0 items-center gap-1 font-mono text-[10px] text-muted-foreground">
          <span className="inline-block h-1 w-1 rounded-full" style={{ backgroundColor: dot }} />
          {state === "run" ? "运行中" : state === "fail" ? "失败" : "完成"}
        </span>
      </div>
      {open && children ? (
        <div
          className="ml-5 mb-1 rounded border px-2 py-1.5 text-[11.5px] leading-5"
          style={{ borderColor: BORDER, backgroundColor: MUTED }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function DiffCard() {
  const rows: { t: "add" | "del" | "ctx"; v: string }[] = [
    { t: "ctx", v: "  const [viewMode, setViewMode] = useState<SessionViewMode>(" },
    { t: "del", v: '-    "conversation",' },
    { t: "add", v: '+    detail: "standard",' },
    { t: "add", v: "+  const foldable = isTurnFoldable(turn, { running });" },
    { t: "ctx", v: "  return <SegmentedTurnBody … />;" },
  ];
  return (
    <div className="overflow-hidden rounded border" style={{ borderColor: BORDER }}>
      <div
        className="flex items-center justify-between border-b px-1.5 py-0.5 font-mono text-[10px]"
        style={{ borderColor: BORDER, backgroundColor: "hsl(var(--card))" }}
      >
        <span>turn-timeline.tsx</span>
        <span>
          <span style={{ color: SUCCESS }}>+2</span> <span style={{ color: ERROR }}>−1</span>
        </span>
      </div>
      {rows.map((r, i) => (
        <div
          key={i}
          className="flex gap-1.5 px-1.5 font-mono text-[10.5px] leading-[18px]"
          style={{
            borderLeft: `2px solid ${r.t === "add" ? SUCCESS : r.t === "del" ? ERROR : "transparent"}`,
            color: r.t === "ctx" ? MUTED_FG : "hsl(var(--foreground))",
          }}
        >
          <span className="w-2.5 flex-shrink-0 opacity-50">
            {r.t === "add" ? "+" : r.t === "del" ? "−" : " "}
          </span>
          <span className="truncate whitespace-pre">{r.v}</span>
        </div>
      ))}
    </div>
  );
}

function FailCard() {
  return (
    <div className="rounded-lg border px-2.5 py-1.5" style={{ borderColor: ERROR }}>
      <div className="flex items-center gap-1.5 text-[12.5px] font-medium" style={{ color: ERROR }}>
        <span className="inline-block h-1 w-1 rounded-full" style={{ backgroundColor: ERROR }} />
        运行失败
      </div>
      <div className="mt-0.5 font-mono text-[10.5px] leading-4 text-muted-foreground">
        429 rate_limit_exceeded · provider=anthropic · retry-after 60s
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="rounded border px-1.5 py-px text-[10.5px]" style={{ borderColor: BORDER }}>
          重试本轮
        </span>
        <span className="text-[10.5px] text-muted-foreground">额度耗尽，将于 18:40 自动继续</span>
      </div>
    </div>
  );
}

function RunningTail({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5 py-1 text-[12px] text-muted-foreground">
      <span
        className="inline-flex h-4 w-4 animate-pulse items-center justify-center rounded-full text-[9px]"
        style={{ backgroundColor: BRAND_SOFT, color: BRAND_STRONG }}
      >
        ◗
      </span>
      <span className="animate-pulse" style={{ color: BRAND_STRONG }}>
        {label}
      </span>
      <span className="ml-auto rounded border px-1.5 text-[10.5px]" style={{ borderColor: BORDER }}>
        停止
      </span>
    </div>
  );
}

function SkeletonRow({ time, engine }: { time: string; engine: string }) {
  return (
    <div
      className="flex items-center gap-1.5 rounded border border-dashed px-2 py-1 text-[11px]"
      style={{ borderColor: BORDER }}
    >
      <span className="text-muted-foreground">◌</span>
      <span className="font-mono text-[10.5px] text-muted-foreground">{time}</span>
      <span className="h-1.5 w-20 animate-pulse rounded" style={{ backgroundColor: MUTED }} />
      <span className="ml-auto font-mono text-[10px] text-muted-foreground">{engine}</span>
    </div>
  );
}

function Reply({ children }: { children: React.ReactNode }) {
  return <div className="text-[13.5px] leading-6">{children}</div>;
}

/* ───────────── 一轮 = 用户消息 + 助手块 ───────────── */

function Turn({ children, divider = true }: { children: React.ReactNode; divider?: boolean }) {
  return (
    <div
      className={`flex flex-col gap-1.5 py-3 ${divider ? "border-b" : ""}`}
      style={{ borderColor: divider ? BORDER : "transparent" }}
    >
      {children}
    </div>
  );
}

/* ───────────── 轮次窄轨（44px + 悬停浮层） ───────────── */

function Rail() {
  const marks = [6, 7, 8, 9, 10, 11, 12];
  return (
    <div className="relative hidden w-[44px] flex-shrink-0 lg:block">
      <div className="flex flex-col items-center gap-2 py-3">
        <span
          className="rounded px-1 py-px font-mono text-[10px]"
          style={{ backgroundColor: BRAND_SOFT, color: BRAND_STRONG }}
        >
          12
        </span>
        {marks.map((m) => (
          <span
            key={m}
            className="h-1 w-3 rounded-sm"
            style={{ backgroundColor: m === 12 ? BRAND : "hsl(var(--border))" }}
          />
        ))}
      </div>
      <div
        className="absolute right-11 top-6 z-10 w-[210px] rounded-lg border bg-card p-1.5 shadow-lg"
        style={{ borderColor: BORDER }}
      >
        <div className="px-1 pb-1 font-mono text-[10px] text-muted-foreground">悬停浮层 · 大纲摘要</div>
        {[
          ["11", "失败", "回归 429，等自动续跑"],
          ["12", "运行中", "把过程改成可伸缩"],
        ].map(([n, st, t]) => (
          <div
            key={n}
            className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px]"
            style={{ backgroundColor: n === "12" ? BRAND_SOFT : undefined }}
          >
            <span className="font-mono text-[10px]" style={{ color: n === "12" ? BRAND_STRONG : MUTED_FG }}>
              {n}
            </span>
            <span className="font-mono text-[10px]" style={{ color: n === "12" ? BRAND_STRONG : MUTED_FG }}>
              {st}
            </span>
            <span className="truncate text-muted-foreground">{t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────── 中栏四个状态面板 ───────────── */

function TranscriptStandard({ cform }: { cform?: boolean }) {
  return (
    <>
      <div className="flex flex-col gap-1.5 pb-2">
        <button
          className="mx-auto rounded-full border px-2.5 py-0.5 text-[11px] text-muted-foreground"
          style={{ borderColor: BORDER }}
        >
          ↑ 加载更早的 10 轮
        </button>
        <SkeletonRow time="15:41" engine="Codex" />
        <SkeletonRow time="15:38" engine="Codex" />
      </div>

      <Turn>
        <UserBubble
          text="把会话页的过程呈现改成可伸缩的：默认只看到答复正文和过程摘要，想深挖再展开。"
          time="16:02"
          att="turn-timeline.tsx"
        />
        <div className="pl-6">
          <AssistantHead time="16:02" engine="Claude Code" model="claude-opus" />
          <div className="flex flex-col gap-2">
            <GroupHeader title="思考与工具 · 6 步" meta="12.3s" />
            <Reply>
              <p>收成单视图可伸缩，分三步：</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                <li>折叠判定抽纯函数，不依赖 React 与运行态</li>
                <li>整轮折叠头显示时长与步数，分组标题带活动摘要</li>
                <li>三档细节只改默认开合，不影响已手动展开的条目</li>
              </ul>
            </Reply>
          </div>
        </div>
      </Turn>

      <Turn>
        <UserBubble text="展开给我看具体改哪些文件。" time="16:04" />
        <div className="pl-6">
          <AssistantHead time="16:05" engine="Claude Code" model="claude-opus" />
          <div className="flex flex-col gap-2">
            <GroupHeader title="思考与工具 · 4 步" meta="8.7s" />
            <Reply>
              改四处：视图分支、分组容器、折叠判定纯函数、默认档注入；旧 viewMode 键做一次性迁移。
            </Reply>
          </div>
        </div>
      </Turn>

      <Turn>
        <UserBubble text="跑一下回归。" time="16:07" />
        <div className="pl-6">
          <AssistantHead time="16:07" engine="Claude Code" model="claude-opus" />
          <div className="flex flex-col gap-2">
            <FailCard />
            <GroupHeader title="思考与工具 · 2 步 · 失败轮不可折" meta="—" />
          </div>
        </div>
      </Turn>

      <Turn divider={false}>
        <UserBubble text="那就等自动续跑，先把详细档也做出来。" time="16:09" />
        <div className="pl-6">
          <AssistantHead time="16:09" engine="Claude Code" model="claude-opus" />
          <div className="flex flex-col gap-2">
            <Reply>
              {cform
                ? "详细档实现排在回归之后；当前先按标准档收口，进度视图仍可从顶部切到。"
                : "详细档实现排在回归之后；当前先按标准档收口。"}
            </Reply>
            <RunningTail label="正在生成详细档改动 · 12s" />
          </div>
        </div>
      </Turn>
    </>
  );
}

function TranscriptExpand() {
  return (
    <>
      <Turn>
        <UserBubble text="展开给我看具体改哪些文件。" time="16:04" />
        <div className="pl-6">
          <AssistantHead time="16:05" engine="Claude Code" model="claude-opus" />
          <div className="flex flex-col gap-2">
            <GroupHeader title="思考与工具 · 4 步" meta="8.7s" open />
            <div
              className="rounded-lg border px-2 py-1"
              style={{ borderColor: BRAND_LINE, backgroundColor: "hsl(var(--card))" }}
            >
              <Disclosure
                kind="think"
                title="先确认二态视图的耦合点，再定折叠锚点"
                state="ok"
                open
              >
                视图状态在 <span className="font-mono">SessionViewMode</span>，对话/进度分支散在三处；
                折叠判定必须与运行态解耦，否则会把正在跑的轮折起来。
              </Disclosure>
              <Disclosure kind="tool" title="Grep  viewMode|SessionViewMode" meta="3 处" state="ok" mono />
              <Disclosure kind="read" title="Read  turn-timeline.tsx  L373-379" meta="1.2KB" state="ok" mono />
              <Disclosure kind="tool" title="Edit  turn-timeline.tsx" meta="+2 −1" state="ok" open mono>
                <DiffCard />
              </Disclosure>
              <Disclosure kind="bash" title="vitest run src/components/daemon" meta="36 passed" state="ok" mono />
            </div>
            <Reply>
              改四处：视图分支、分组容器、折叠判定纯函数、默认档注入；旧 viewMode 键做一次性迁移。
            </Reply>
            <div className="flex items-center gap-2 font-mono text-[10.5px] text-muted-foreground">
              <span>已完成 · 8.7s</span>
              <span>1.2k / 3.4k tokens</span>
              <span>缓存命中 62%</span>
            </div>
          </div>
        </div>
      </Turn>
    </>
  );
}

function TranscriptDetail() {
  return (
    <>
      <Turn>
        <UserBubble text="展开给我看具体改哪些文件。" time="16:04" />
        <div className="pl-6">
          <AssistantHead time="16:05" engine="Claude Code" model="claude-opus" />
          <div className="flex flex-col gap-1.5">
            <div className="font-mono text-[10.5px] text-muted-foreground">
              详细档 · 运行中铺开过程行，历史轮仍收标题
            </div>
            <Disclosure kind="think" title="先确认二态视图的耦合点，再定折叠锚点" state="ok" open>
              视图状态在 <span className="font-mono">SessionViewMode</span>；折叠判定与运行态解耦。
            </Disclosure>
            <Disclosure kind="tool" title="Grep  viewMode|SessionViewMode" meta="3 处" state="ok" mono />
            <Disclosure kind="read" title="Read  turn-timeline.tsx  L373-379" meta="1.2KB" state="ok" mono />
            <Disclosure kind="tool" title="Edit  turn-timeline.tsx" meta="+2 −1" state="ok" open mono>
              <DiffCard />
            </Disclosure>
            <Disclosure kind="bash" title="vitest run src/components/daemon" meta="36 passed" state="ok" mono />
            <Reply>
              改四处：视图分支、分组容器、折叠判定纯函数、默认档注入；旧 viewMode 键做一次性迁移。
            </Reply>
          </div>
        </div>
      </Turn>
    </>
  );
}

/* ───────────── 右栏：文件 / 子代理 ───────────── */

function RightPanel() {
  return (
    <aside
      className="flex w-[272px] flex-shrink-0 flex-col overflow-hidden border-l"
      style={{ borderColor: BORDER }}
    >
      <div className="flex items-center gap-3 border-b px-3 py-2 text-[12px]" style={{ borderColor: BORDER }}>
        <span className="font-semibold" style={{ color: BRAND_STRONG, borderBottom: `2px solid ${BRAND}` }}>
          文件
        </span>
        <span className="text-muted-foreground">子代理</span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">变更文件 4</span>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <MetaPanel>
          <MetaPanelSection title="本次改动">
            <div className="flex flex-col gap-1 font-mono text-[11px]">
              <div className="flex justify-between">
                <span className="truncate">turn-timeline.tsx</span>
                <span style={{ color: SUCCESS }}>+42</span>
              </div>
              <div className="flex justify-between">
                <span className="truncate">turn-segment-views.tsx</span>
                <span style={{ color: SUCCESS }}>+186</span>
              </div>
              <div className="flex justify-between">
                <span className="truncate">turn-fold.ts</span>
                <span className="text-muted-foreground">新建</span>
              </div>
              <div className="flex justify-between">
                <span className="truncate">page-helpers.tsx</span>
                <span style={{ color: SUCCESS }}>+18</span>
              </div>
            </div>
          </MetaPanelSection>
          <MetaPanelSection title="会话信息">
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">会话</span>
              <span className="font-mono">sess-7c41a2</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">轮次</span>
              <span className="font-mono">12 轮 · 已加载 4</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">上下文</span>
              <span className="font-mono">34% · 68K / 200K</span>
            </div>
          </MetaPanelSection>
        </MetaPanel>
      </div>
    </aside>
  );
}

/* ───────────── 主视图 ───────────── */

export function SessionFoldView() {
  const states: [string, string][] = [
    ["active", "标准档（默认）"],
    ["expand", "展开一轮"],
    ["detail", "详细档"],
    ["cform", "C 形态 · 保留进度 tab"],
  ];
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <DemoBar />

      {/* 原型态切换（真实页面无此条；用于对比四态） */}
      <div
        className="flex flex-wrap items-center gap-2 border-b px-4 py-1.5 text-[11px]"
        style={{ borderColor: BORDER, backgroundColor: MUTED }}
      >
        <span className="text-muted-foreground">原型演示 · 切换态：</span>
        {states.map(([k, label]) => (
          <button
            key={k}
            type="button"
            data-state-btn={k}
            className="rounded-md border px-2 py-0.5"
            style={{ borderColor: BORDER }}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          A/C 差异只在顶部有无「进度」tab
        </span>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <LeftPanel />

        <main className="flex min-w-0 flex-1 flex-col">
          {/* 会话头 + 配置条 */}
          <div className="border-b px-4 py-1.5" style={{ borderColor: BORDER }}>
            <div className="flex items-center gap-2">
              <span className="truncate text-[13px] font-semibold">会话页过程呈现 · 改造</span>
              <StateLabel variant="open" withIcon={false}>
                运行中
              </StateLabel>
              <span className="font-mono text-[10px] text-muted-foreground">sess-7c41a2</span>
              <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                对话 / 进度
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10.5px]">
              {["DESKTOP-HJ0AM09", "Claude Code · 主控", "claude-opus", "代码评审"].map((c) => (
                <span
                  key={c}
                  className="rounded border px-1.5 py-px text-muted-foreground"
                  style={{ borderColor: BORDER }}
                >
                  {c}
                </span>
              ))}
              <span style={{ color: BRAND_STRONG }}>🔒 本轮完成后解锁切换</span>
            </div>

            {/* C 形态专有：旧「进度」视图入口（A 形态下此条不渲染） */}
            <div data-state-panel="cform" style={{ display: "none" }}>
              <div
                className="mt-1.5 flex items-end gap-4 border-b text-[12px]"
                style={{ borderColor: BORDER }}
              >
                <span className="pb-1 font-semibold" style={{ color: BRAND_STRONG, borderBottom: `2px solid ${BRAND}` }}>
                  对话
                </span>
                <span className="pb-1 text-muted-foreground">进度</span>
                <span className="ml-auto pb-1 font-mono text-[10px] text-muted-foreground">
                  C 形态：旧视图保留为可切回入口
                </span>
              </div>
            </div>
          </div>

          {/* 消息流 + 轮次窄轨 */}
          <div className="flex min-h-0 flex-1">
            <div className="min-w-0 flex-1 overflow-y-auto px-4">
              <div data-state-panel="active">
                <TranscriptStandard />
              </div>
              <div data-state-panel="expand" style={{ display: "none" }}>
                <TranscriptExpand />
              </div>
              <div data-state-panel="detail" style={{ display: "none" }}>
                <TranscriptDetail />
              </div>
              <div data-state-panel="cform" style={{ display: "none" }}>
                <TranscriptStandard cform />
              </div>
            </div>
            <Rail />
          </div>

          {/* 输入区 */}
          <div className="border-t px-4 py-2" style={{ borderColor: BORDER }}>
            <div className="mb-1 flex items-center gap-2 text-[10.5px] text-muted-foreground">
              <span className="rounded border px-1.5 py-px font-mono" style={{ borderColor: BORDER }}>
                上下文 34%
              </span>
              <span className="rounded border px-1.5 py-px" style={{ borderColor: BORDER }}>
                额度 · 剩余 62%
              </span>
              <span>排队 1 条 · 「那就等自动续跑」</span>
              <span className="ml-auto">标准档 · 紧凑</span>
            </div>
            <div
              className="flex items-center gap-2 rounded-xl border px-3 py-1.5 text-[13px] text-muted-foreground"
              style={{ borderColor: BORDER }}
            >
              <span className="rounded border px-1 font-mono text-[11px]" style={{ borderColor: BORDER }}>
                ＋
              </span>
              <span className="flex-1">向智能体提问，Enter 发送 / Shift+Enter 换行</span>
              <span
                className="flex h-6 w-6 items-center justify-center rounded-full text-[11px]"
                style={{ backgroundColor: BRAND, color: "hsl(var(--card))" }}
              >
                ↑
              </span>
            </div>
          </div>
        </main>

        <RightPanel />
      </div>
    </div>
  );
}

/**
 * prototype-as-code 演示视图 —— 轨迹面板重设计（2026-10-22-trajectory-view-redesign）。
 *
 * 对齐 dsh（deepseek-harness/packages/client/ui-trajectory）的轨迹视图：
 *   - 顶部固定：会话三态 tab → 工具栏（时长 / 轮次 / 调用 + 搜索）→ 三泳道时间线；
 *   - 唯一滚动区：账本（无表头两列：事件列 + 内容列，行高 30px）；
 *   - 右侧详情：工具行四标签（概述 / 参数 / 结果 / 计时），宽度可拖拽（原型静态）；
 *   - 入口保留本项目三态（对话 / 进度 / 轨迹），轨迹为选中态。
 *
 * 真实页面无 DemoBar；数据为 fixture，样式全部走 Tailwind 语义类 + themes.ts token。
 */
import * as React from "react";

import { DemoBar } from "./demo-chrome";

type Kind = "user" | "context" | "assistant" | "tool" | "subtool" | "system";

interface Row {
  id: string;
  turn: number;
  turnStart?: boolean;
  kind: Kind;
  summary: string;
  result?: string;
  selected?: boolean;
  indent?: boolean;
}

const KIND_LABEL: Record<Kind, string> = {
  user: "用户",
  context: "上下文",
  assistant: "助手",
  tool: "工具",
  subtool: "子工具",
  system: "系统",
};

const KIND_CLASS: Record<Kind, string> = {
  user: "text-brand-700 bg-brand-50 border-brand-200",
  context: "text-success bg-success/10 border-success/30",
  assistant: "text-foreground bg-muted border-border",
  tool: "text-warning bg-warning/10 border-warning/30",
  subtool: "text-warning bg-warning/5 border-warning/20",
  system: "text-muted-foreground bg-muted border-border",
};

const ROWS: Row[] = [
  { id: "r0", turn: 7, turnStart: true, kind: "system", summary: "系统提示词已更新（档案 systemPrompt 配置段变更）" },
  { id: "r0b", turn: 7, kind: "system", summary: "工具已更新（新增 2 个：mcp__sillyhub-daemon__dispatch_worker、mcp__sillyhub-daemon__get_worker_result）" },
  { id: "r0c", turn: 7, kind: "context", summary: "团队派发 · 你是多 Agent 团队的主 agent（项目经理，role=orchestrator）…" },
  { id: "r1", turn: 7, kind: "user", summary: "继续收口，按评审意见修正后再跑 flow done" },
  { id: "r2", turn: 7, kind: "assistant", summary: "（仅工具调用）" },
  {
    id: "r3",
    turn: 7,
    kind: "tool",
    summary: 'pwsh {"command":"cd C:\\Users\\qinyi\\IdeaProjects\\...\\multi-agent-platform && ..."}',
    result: "Name Length LastWriteTime change-patch.json 13921 2026/10/22 9:31:20",
    selected: true,
  },
  { id: "r4", turn: 7, kind: "tool", summary: 'pwsh {"command":"Start-Sleep -Seconds 200; ..."}', result: "waited / verdict=PASS findings=0" },
  { id: "r5", turn: 7, kind: "assistant", summary: "Re-review: PASS, 0 findings. Now run flow done again → review substep should accept." },
  { id: "r6", turn: 7, kind: "tool", summary: 'pwsh {"command":"cd C:\\Users\\qinyi\\IdeaProjects\\..."; exit=0"}', result: "exit=0" },
  {
    id: "r7",
    turn: 7,
    kind: "tool",
    summary: 'pwsh {"command":"cd C:\\Users\\qinyi\\IdeaProjects\\..."; ..."}',
    result: "=== staged (full) === .sillyspec/changes/archive/2026-10-22-daemon..." },
  { id: "r8", turn: 7, kind: "system", summary: "时间线烤制跳过：无事件流（watcher-events-2026-10-22-...jsonl）" },
  { id: "r9", turn: 7, kind: "subtool", summary: "Read .sillyspec/changes/.../change.patch" },
  { id: "r10", turn: 7, kind: "assistant", summary: "爸爸~爸爸~[2026-10-22 09:40:53]：两件事都做完了，change 已归档……" },
  { id: "r11", turn: 8, turnStart: true, kind: "context", summary: "Agent 26102acd-7f50-44df-a1a4-10b595caf606 sent a message:" },
  { id: "r12", turn: 8, kind: "assistant", summary: "The reviewer confirmed PASS 0 findings and noted a residual observation (not a finding)." },
  { id: "r13", turn: 8, kind: "tool", summary: 'pwsh {"command":"cd C:\\Users\\qinyi\\IdeaProjects\\..."; ..."}', result: "归档件在场 === True === HEAD === 01eccf0a5" },
  { id: "r14", turn: 8, kind: "context", summary: "Background subagent finished and will do no further work unless you send it more." },
  { id: "r15", turn: 8, kind: "assistant", summary: "复查结论已到位，这单收尾完成。复盘 PASS、findings 0、五项上传发现逐条验到。" },
];

/** 三泳道条块（百分比定位；fixture）。 */
const LANES: Array<{ key: string; label: string; tone: string; spans: Array<[number, number]> }> = [
  { key: "input", label: "输入", tone: "var(--color-brand-500)", spans: [[2, 2], [31, 3], [62, 2], [83, 2], [93, 2]] },
  { key: "model", label: "模型", tone: "var(--color-brand-400)", spans: [[6, 18], [35, 22], [65, 12], [85, 6], [95, 3]] },
  { key: "tool", label: "工具", tone: "var(--color-warning)", spans: [[24, 10], [57, 14], [78, 8], [90, 4]] },
];

function TypeBadge({ kind }: { kind: Kind }) {
  return (
    <span
      className={`inline-flex h-[19px] shrink-0 items-center rounded border px-1.5 text-[10px] font-semibold tracking-wide ${KIND_CLASS[kind]}`}
    >
      {KIND_LABEL[kind]}
    </span>
  );
}

function LedgerRow({ row }: { row: Row }) {
  return (
    <div
      className={`flex h-[30px] items-center border-b border-border/60 text-[12px] ${
        row.selected ? "bg-brand-50" : "hover:bg-muted/60"
      }`}
      data-cat={row.kind}
    >
      {/* 事件列：turn 标签 / 竖线 / 请求边界点 */}
      <div className="relative flex h-full w-[84px] shrink-0 items-center gap-1.5 pl-3">
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-border" />
        {row.turnStart ? (
          <span className="rounded bg-muted px-1 py-px font-mono text-[9.5px] font-semibold text-muted-foreground">
            第 {row.turn} 轮
          </span>
        ) : (
          <span aria-hidden className="ml-[3px] h-full w-[2px] bg-brand-200" />
        )}
      </div>
      {/* 内容列：类型标签 + 摘要 + 结果摘要 */}
      <div
        className="flex min-w-0 flex-1 items-center gap-2 pr-3"
        style={row.kind === "subtool" ? { paddingLeft: 26 } : undefined}
      >
        <TypeBadge kind={row.kind} />
        <span className="min-w-0 flex-1 truncate text-foreground/90">{row.summary}</span>
        {row.result ? (
          <span className="max-w-[38%] shrink-0 truncate text-[11px] text-muted-foreground">→ {row.result}</span>
        ) : null}
      </div>
    </div>
  );
}

function CollapsedRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[20px] items-center gap-2 border-b border-border/40 pl-[96px] pr-3 text-[11px] text-muted-foreground">
      <span aria-hidden>…</span>
      <span className="truncate">{children}</span>
    </div>
  );
}

function Toolbar() {
  const btn =
    "inline-flex h-6 items-center gap-1 rounded border border-border bg-card px-2 text-[11px] text-foreground hover:bg-muted";
  return (
    <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border bg-card px-3">
      <button type="button" className={btn} aria-pressed="true">
        时长 <span aria-hidden className="text-[9px] text-muted-foreground">▾</span>
      </button>
      <button type="button" className={btn}>
        轮次 <span aria-hidden className="text-[9px] text-muted-foreground">▾</span>
      </button>
      <button type="button" className={btn}>
        调用 <span aria-hidden className="text-[9px] text-muted-foreground">▾</span>
      </button>
      <div className="ml-auto flex h-6 w-[220px] items-center gap-1.5 rounded border border-border bg-background px-2 text-[11px] text-muted-foreground">
        <span aria-hidden>⌕</span>
        搜索轨迹
      </div>
    </div>
  );
}

function Timeline() {
  return (
    <div className="relative h-[50px] shrink-0 border-b border-border bg-card px-3 py-1.5">
      <div className="flex h-full items-stretch gap-2">
        <div className="flex w-[44px] shrink-0 flex-col justify-around text-[10px] text-muted-foreground">
          {LANES.map((lane) => (
            <span key={lane.key} className="leading-none">{lane.label}</span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          {LANES.map((lane, i) => (
            <div key={lane.key} className="relative h-[13px]" style={{ marginTop: i === 0 ? 0 : 2 }}>
              {lane.spans.map(([left, width], j) => (
                <span
                  key={`${lane.key}-${j}`}
                  className="absolute top-1/2 h-[7px] -translate-y-1/2 rounded-[1px]"
                  style={{ left: `${left}%`, width: `${width}%`, backgroundColor: lane.tone, opacity: 0.85 }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DetailPanel() {
  const tabs = ["概述", "参数", "结果", "计时"];
  return (
    <aside className="hidden min-h-0 w-[340px] shrink-0 flex-col border-l border-border bg-card md:flex">
      <div className="flex h-[42px] shrink-0 items-center gap-2 border-b border-border px-3">
        <TypeBadge kind="tool" />
        <span className="text-[12px] font-medium">工具</span>
        <span className="font-mono text-[10.5px] text-muted-foreground">第 7 轮 · 第 3 步</span>
        <span className="ml-auto text-[13px] text-muted-foreground" aria-label="关闭详情">×</span>
      </div>
      <div role="tablist" className="flex h-[34px] shrink-0 items-stretch gap-3 border-b border-border px-3">
        {tabs.map((tab) => (
          <span
            key={tab}
            role="tab"
            aria-selected={tab === "参数"}
            className={`inline-flex items-center border-b-2 text-[11.5px] ${
              tab === "参数"
                ? "border-brand-600 font-medium text-brand-700"
                : "border-transparent text-muted-foreground"
            }`}
          >
            {tab}
          </span>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {tabs.map((tab) => (
          <div key={tab} className={tab === "参数" ? "" : "hidden"}>
            <div className="mb-1 flex items-center gap-2 text-[10.5px] text-muted-foreground">
              <span className="font-medium text-foreground">参数</span>
              <button type="button" className="rounded border border-border px-1 font-mono text-[10px] hover:bg-muted">{"{}"}</button>
              <button type="button" className="ml-auto rounded border border-border px-1 text-[10px] hover:bg-muted">复制</button>
            </div>
            <pre className="max-h-[42vh] overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-muted/40 p-2 font-mono text-[10.5px] leading-[1.55]">
{`{
  "command": "cd C:\\\\Users\\\\qinyi\\\\IdeaProjects\\\\...\\\\multi-agent-platform && \\\\
    git add -- .sillyspec/changes/... && git commit -m \\"chore(sillyspec): ...\\"",
  "description": "Check re-review output again",
  "timeout": 200000
}`}
            </pre>
            <dl className="mt-3 grid grid-cols-[64px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[11px]">
              <dt className="text-muted-foreground">层级</dt>
              <dd>助手消息 · 工具调用</dd>
              <dt className="text-muted-foreground">状态</dt>
              <dd className="text-success">已完成</dd>
              <dt className="text-muted-foreground">call</dt>
              <dd className="break-all font-mono text-[10.5px]">toolu_01Y3hXb2k9w</dd>
            </dl>
          </div>
        ))}
      </div>
    </aside>
  );
}

export function TrajectoryRedesignView() {
  let lastTurn = 0;
  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <DemoBar />
      {/* 会话面板头部（模拟）：视图三态 + 会话标题 */}
      <header className="flex h-[46px] shrink-0 items-center gap-3 border-b border-border bg-card px-4">
        <span className="truncate text-[13px] font-medium">会话 · 快照上报收口日志</span>
        <div role="tablist" aria-label="消息显示范围" className="inline-flex items-center rounded-full border border-border bg-muted/50 p-0.5">
          {["对话", "进度", "轨迹"].map((label) => (
            <span
              key={label}
              role="tab"
              aria-selected={label === "轨迹"}
              className={`rounded-full px-2.5 py-1 text-[11px] leading-none ${
                label === "轨迹" ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              {label}
            </span>
          ))}
        </div>
        <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">1271 logs · 21 runs</span>
      </header>

      {/* 轨迹视图：固定工具栏 + 固定时间线 + 账本/详情 */}
      <div className="flex min-h-0 flex-1 flex-col">
        <Toolbar />
        <Timeline />
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-y-auto">
            {ROWS.map((row) => {
              const start = row.turn !== lastTurn;
              lastTurn = row.turn;
              return (
                <React.Fragment key={row.id}>
                  <LedgerRow row={{ ...row, turnStart: start }} />
                  {row.kind === "subtool" ? null : null}
                </React.Fragment>
              );
            })}
            <CollapsedRow>4 个工具调用 · Bash · Read · Edit · Grep</CollapsedRow>
            <div className="px-3 py-2 text-[11px] text-muted-foreground">第 9 轮 · 进行中…</div>
          </div>
          <DetailPanel />
        </div>
      </div>
    </div>
  );
}

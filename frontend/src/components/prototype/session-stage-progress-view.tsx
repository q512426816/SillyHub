/**
 * prototype-as-code 演示视图 —— 会话阶段化进度（change 2026-10-26-session-stage-progress）。
 *
 * 本次改动涉及的状态条形态，供评审定稿：
 *   ① 现状对照：发消息后卡顿期间只有「执行中 + 思考中」，零阶段信息
 *   ② 新会话首轮（冷启动）：派发段（backend 发布）+ 启动准备段（daemon 上报）全序列
 *   ③ 追问轮（复用会话）：无冷启动，仅派发段 + 注入段
 *   ④ 超时警示态：阶段停留超阈值（默认 30s）→ 整条切警示样式 + 已等待秒数
 *   ⑤ 轮内既有能力（本次不动）：思考 / 工具执行 / 等待模型响应，活动摘要照旧
 *
 * 真码方言：Tailwind + themes.ts token（零硬编码色，警示态用生产 warning token）；
 * 状态条 DOM 结构对齐生产 turn-status-bar.tsx（rounded-md / border-primary/[0.18] /
 * bg-primary/[0.06] / px-3 py-1.5 / text-xs / spinner / .sh-typing-dots 三点脉冲）；
 * fixture 假数据；scripts/prototype-build.mjs 编译为独立 HTML。
 */
import * as React from "react";

import { DemoBar } from "./demo-chrome";

/* ───────────── 阶段词表（design 定稿候选：backend/daemon 发布值 → 状态条文案） ───────────── */

type Phase =
  | "dispatched"
  | "delivered"
  | "skills_sync"
  | "spec_sync"
  | "mcp_prefetch"
  | "spawning"
  | "ready"
  | "inject_received"
  | "first_event";

const PHASE_LABEL: Record<Phase, string> = {
  dispatched: "已发送 · 等待执行器领取",
  delivered: "执行器已接收",
  skills_sync: "正在准备技能环境",
  spec_sync: "正在同步规范文件",
  mcp_prefetch: "正在加载工具配置",
  spawning: "正在启动 AI 进程",
  ready: "已就绪 · 等待 AI 响应",
  inject_received: "消息已送达 AI",
  first_event: "AI 开始响应",
};

/** 阶段分组（原型分区展示用，同时是 design 阶段生命周期的可视化）。 */
const COLD_START_SEQUENCE: Phase[] = [
  "dispatched",
  "delivered",
  "skills_sync",
  "spec_sync",
  "mcp_prefetch",
  "spawning",
  "ready",
  "first_event",
];
const REUSE_SEQUENCE: Phase[] = ["dispatched", "delivered", "inject_received", "first_event"];

/* ───────────── 状态条（DOM 结构对齐生产 TurnStatusBar） ───────────── */

function Spinner() {
  return (
    <span
      aria-hidden
      className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-primary/25 border-t-primary"
    />
  );
}

function TypingDots() {
  return (
    <span aria-hidden className="sh-typing-dots">
      <span />
      <span />
      <span />
    </span>
  );
}

function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
      <div className="mt-3 flex flex-col gap-2.5">{children}</div>
    </section>
  );
}

/**
 * 阶段状态条（改造后形态）。
 * 结构对齐生产 turn-status-bar.tsx：spinner + 阶段标签（替代笼统「排队中/执行中」位）+
 * 开始时刻 + 计时 + 右侧活动摘要。超时态整条切 warning 系 token。
 */
function PhaseStatusBar({
  phase,
  timedOutSeconds,
  startClock = "14:32:07",
  elapsed = "00:38",
  activity,
}: {
  phase: Phase;
  /** 超时秒数：传入即渲染警示态（已等待 N 秒）。 */
  timedOutSeconds?: number;
  startClock?: string;
  elapsed?: string;
  activity?: string | null;
}) {
  const warn = timedOutSeconds != null;
  return (
    <div
      className={`flex items-center gap-2.5 rounded-md border px-3 py-1.5 text-xs ${
        warn
          ? "border-warning/40 bg-warning/10"
          : "border-primary/[0.18] bg-primary/[0.06]"
      }`}
    >
      <Spinner />
      <span className={`shrink-0 ${warn ? "font-medium text-warning" : "text-muted-foreground"}`}>
        {PHASE_LABEL[phase]}
        {warn ? ` · 已等待 ${timedOutSeconds} 秒` : ""}
      </span>
      <span className="shrink-0 text-muted-foreground" title="本轮开始时间">
        开始 {startClock}
      </span>
      <span
        className={`shrink-0 font-mono font-medium ${warn ? "text-warning" : "text-brand-600"}`}
      >
        {elapsed}
      </span>
      {activity ? (
        <span
          className={`ml-auto flex min-w-0 max-w-[46%] items-center gap-1.5 text-[11.5px] ${
            warn ? "text-warning" : "text-foreground"
          }`}
        >
          <TypingDots />
          <span className="min-w-0 truncate" title={activity}>
            {activity}
          </span>
        </span>
      ) : null}
    </div>
  );
}

/** 现状对照条（今天线上形态：只有笼统状态 + 兜底「思考中」）。 */
function LegacyStatusBar() {
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-primary/[0.18] bg-primary/[0.06] px-3 py-1.5 text-xs">
      <Spinner />
      <span className="shrink-0 text-muted-foreground">执行中</span>
      <span className="shrink-0 text-muted-foreground" title="本轮开始时间">
        开始 14:32:07
      </span>
      <span className="shrink-0 font-mono font-medium text-brand-600">00:38</span>
      <span className="ml-auto flex min-w-0 max-w-[46%] items-center gap-1.5 text-[11.5px] text-foreground">
        <TypingDots />
        <span className="min-w-0 truncate">思考中</span>
      </span>
    </div>
  );
}

/** 单条阶段快照（阶段名 + 来源标注 + 状态条）。 */
function PhaseRow({
  phase,
  source,
  note,
  ...bar
}: {
  phase: Phase;
  source: string;
  note?: string;
} & Omit<Parameters<typeof PhaseStatusBar>[0], "phase">) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2 text-[10.5px] text-muted-foreground">
        <code className="rounded bg-muted px-1 py-px font-mono">turn_phase={phase}</code>
        <span>· {source}</span>
        {note ? <span className="text-foreground/70">{note}</span> : null}
      </div>
      <PhaseStatusBar phase={phase} {...bar} />
    </div>
  );
}

export function SessionStageProgressView() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <DemoBar />
      <main className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-xl font-semibold">
          会话阶段化进度 · 原型（2026-10-26-session-stage-progress）
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          覆盖状态条文案增强全部形态：现状对照 / 冷启动序列 / 复用序列 / 超时警示 / 轮内既有能力。
          轻量单行形态（D-001）——不新增区域，阶段随事件实时切换，历史不留痕。
        </p>

        <Section
          title="① 现状对照"
          desc="今天：新会话首轮冷启动期间（实测最长约 40 秒）只有笼统「执行中 + 思考中」，用户无法区分「正常慢」和「卡住了」。"
        >
          <LegacyStatusBar />
        </Section>

        <Section
          title="② 新会话首轮（冷启动全序列）"
          desc="按时间推进依次切换。前两阶段由 backend 在控制指令状态机翻转点发布（执行器零改动）；后六阶段由执行器在启动各步骤边界上报（计时钩子已存在，仅把日志数据顺便发出来）。"
        >
          {COLD_START_SEQUENCE.map((p, i) => (
            <PhaseRow
              key={p}
              phase={p}
              source={i < 2 ? "backend 发布" : "daemon 上报"}
              note={
                i === COLD_START_SEQUENCE.length - 1
                  ? "此后活动摘要接管（已有能力）"
                  : undefined
              }
              startClock={`14:32:${String(7 + i).padStart(2, "0")}`}
              elapsed={`00:${String(String(i).length + 2 + i).padStart(2, "0")}`}
              activity={i === COLD_START_SEQUENCE.length - 1 ? "正在思考" : null}
            />
          ))}
        </Section>

        <Section
          title="③ 追问轮（复用会话，无冷启动）"
          desc="AI 进程已在运行，仅剩消息转发与注入，通常 1-2 秒内进入「AI 开始响应」。"
        >
          {REUSE_SEQUENCE.map((p, i) => (
            <PhaseRow
              key={p}
              phase={p}
              source={i < 2 ? "backend 发布" : "daemon 上报"}
              startClock={`15:01:${String(12 + i).padStart(2, "0")}`}
              elapsed={`00:0${i}`}
              activity={i === REUSE_SEQUENCE.length - 1 ? "正在思考" : null}
            />
          ))}
        </Section>

        <Section
          title="④ 超时警示态（停留超阈值默认 30s）"
          desc="整条切警示样式 + 追加已等待秒数，区分「正常慢」和「卡死了」。不弹窗不打扰；仅前端本地计时，不发事件。左：执行器可能离线；右：网络慢。"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <PhaseRow
              phase="dispatched"
              source="backend 发布"
              note="等待领取 47s 超时"
              timedOutSeconds={47}
              elapsed="00:47"
            />
            <PhaseRow
              phase="spec_sync"
              source="daemon 上报"
              note="同步 36s 超时"
              timedOutSeconds={36}
              elapsed="01:12"
            />
          </div>
        </Section>

        <Section
          title="⑤ 轮内既有能力（本次不动，仅纳入同一文案体系）"
          desc="AI 干活期间已有实时信号：活动摘要随思考 / 工具 / 输出实时变化，工具结束后无事件间隙显示「等待模型响应」（跑马灯既有合成语义）。阶段标签在首事件后固定为「AI 开始响应」随后让位活动摘要。"
        >
          <PhaseStatusBar phase="first_event" elapsed="00:52" activity="正在思考" />
          <PhaseStatusBar phase="first_event" elapsed="01:03" activity="Bash pnpm test" />
          <PhaseStatusBar phase="first_event" elapsed="01:15" activity="等待模型响应" />
        </Section>
      </main>
    </div>
  );
}

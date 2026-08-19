"use client";

/**
 * task-05（2026-08-19-session-stream-ux / FR-01 / FR-03 / FR-06 / D-003@v1）：
 * 段渲染组件族——消费 session-log-assembler（task-01）的 TurnSegment 结构化段
 * 模型，按 prototype-session-stream.html 视觉基准（D-003）渲染五类段：
 *
 *   - TextSegmentView   文本段气泡（MarkdownText + streaming 尾部闪烁光标）
 *   - ThinkingRowView   思考折叠行（摘要 60 字截断 + streaming「思考中」脉冲标记）
 *   - ToolRowView       工具单行（图标+工具名+主参数+状态徽章+耗时+运行中扫动；
 *                       点击整行展开 result，MarkdownText 渲染；复制按钮平移现有
 *                       turn-timeline parseToolRaw 的 copyText 规则）
 *   - SubagentBlockView 子代理嵌套块（头部状态点/名称/类型/时长 + children 递归
 *                       渲染；运行中默认展开+头部扫动，完成默认折叠；subagent_stub
 *                       兜底段复用同组件）
 *   - StderrRowView     stderr 警示行（⚠ 前缀，平移现有 amber 样式）
 *   - SegmentView       统一入口分发器（按 kind 分发；tool 段有 children 时升级为
 *                       子代理块渲染）
 *
 * 渲染经济性（FR-06 / R-03）：全部组件 React.memo（默认浅比较）——装配器
 * path-copy 保证未触及段引用稳定，流式 delta 只重渲染当前段；列表层以段 id 为
 * 稳定 key（消费方 task-06 负责 map）；折叠内容按需挂载（默认折叠不渲染重内容）。
 *
 * 约束（task-05 constraints）：纯展示组件只消费 segment props，不读 SSE /
 * store / 本地时钟（运行中段不显示实时秒数——live 计时归 task-07/08 状态条）；
 * 不用 antd；动画走 CSS 类；颜色走 tailwind 项目 token / CSS 变量，不硬编码 hex。
 *
 * 动画实现说明：原型 keyframes（sweep 1.8s 扫动 / blink 0.9s step-end 光标）项目
 * tailwind.config 与 globals.css 均未定义且不在本卡允许路径内，故本文件自包含注入
 * （ensureSegmentAnimations：文档级幂等 <style>，见下）。类名固定为 seg-sweep /
 * seg-caret，供 task-12 断言「扫动动画类名到位」。
 *
 * 与原型的两处已知偏差（备注）：
 *   1. 流式光标落在正文块末尾的下一行行首——MarkdownText 是块级容器，无法把
 *      inline 光标拼进 markdown 正文尾（sanitize 会剥注入的 HTML）；原型为 inline。
 *   2. 子代理块内文本段去掉气泡底色（原型 subagent-body 内 seg-text 透明化）——
 *      经 .seg-subagent-body 父级选择器覆盖，保持 props 契约不变（无 variant 参数）。
 */

import { memo, useEffect, useRef, useState } from "react";

import { MarkdownText } from "@/components/ui/markdown-text";
import type {
  StubTurnSegment,
  ToolTurnSegment,
  TurnSegment,
} from "@/components/daemon/session-log-assembler";
import { cn } from "@/lib/utils";

/* ───────────────── 段动画 keyframes（自包含注入，见文件头说明） ───────────────── */

/**
 * 原型动画 CSS：sweep 1.8s 无限扫动（工具行 / 子代理头部运行中覆盖层）+
 * caret 0.9s step-end 闪烁（文本段流式光标）。颜色取 --primary CSS 变量
 * （shadcn token，hsl 数值格式），不硬编码 hex。prefers-reduced-motion 时关闭。
 */
const SEGMENT_ANIMATION_CSS = `
@keyframes seg-sweep {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
@keyframes seg-caret-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
.seg-sweep::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(100deg, transparent 30%, hsl(var(--primary) / 0.16) 50%, transparent 70%);
  animation: seg-sweep 1.8s infinite;
}
.seg-caret {
  animation: seg-caret-blink 0.9s step-end infinite;
}
.seg-subagent-body .seg-text-bubble {
  background: transparent;
  border-color: transparent;
  box-shadow: none;
  padding: 6px 0;
  max-width: 100%;
}
@media (prefers-reduced-motion: reduce) {
  .seg-sweep::after,
  .seg-caret {
    animation: none;
  }
}
`;

const SEGMENT_ANIMATION_STYLE_ID = "turn-segment-views-animations";
let segmentAnimationsInjected = false;

/**
 * 文档级幂等注入段动画 keyframes（SSR 安全：服务端无 document 直接跳过，
 * 动画均在客户端水合后生效）。模块标记 + DOM id 双保险，多实例 / StrictMode
 * 重复渲染 / 测试多文件隔离下均只注入一份。
 */
function ensureSegmentAnimations(): void {
  if (segmentAnimationsInjected || typeof document === "undefined") return;
  if (!document.getElementById(SEGMENT_ANIMATION_STYLE_ID)) {
    const el = document.createElement("style");
    el.id = SEGMENT_ANIMATION_STYLE_ID;
    el.textContent = SEGMENT_ANIMATION_CSS;
    document.head.appendChild(el);
  }
  segmentAnimationsInjected = true;
}

/** 需要动画 CSS 的段组件统一挂载（注入本身幂等，组件卸载不回收——文档级共享）。 */
function useSegmentAnimations(): void {
  useEffect(() => {
    ensureSegmentAnimations();
  }, []);
}

/* ───────────────────── props 契约（task-06 / task-12 消费） ───────────────────── */

/** 段类型收窄别名（assembler 只导出 tool/stub 两个，此处补齐其余三类）。 */
export type TextTurnSegment = Extract<TurnSegment, { kind: "text" }>;
export type ThinkingTurnSegment = Extract<TurnSegment, { kind: "thinking" }>;
export type StderrTurnSegment = Extract<TurnSegment, { kind: "stderr" }>;
/** 子代理容器段：有 children 的 tool 段 + subagent_stub 兜底段（复用同一组件）。 */
export type SubagentContainerSegment = ToolTurnSegment | StubTurnSegment;

/** 统一入口 props（task-05 provides 契约：字段 [segment]）。 */
export interface SegmentViewProps {
  segment: TurnSegment;
}

export interface TextSegmentViewProps {
  segment: TextTurnSegment;
}
export interface ThinkingRowViewProps {
  segment: ThinkingTurnSegment;
}
export interface ToolRowViewProps {
  segment: ToolTurnSegment;
}
export interface SubagentBlockViewProps {
  segment: SubagentContainerSegment;
}
export interface StderrRowViewProps {
  segment: StderrTurnSegment;
}

/* ───────────────────────────── 内部工具（纯函数） ───────────────────────────── */

/** 摘要截断：空白折叠 + 60 字 + 省略号（规则平移自现有 TurnDetailsList 思考摘要）。 */
function summaryOf(text: string, max = 60): string {
  const s = text.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** 工具行耗时：<10s 一位小数（0.3s），≥10s 取整（12s）——原型 t-dur 格式。 */
function formatToolDuration(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
}

/** 子代理块时长：mm:ss（01:24，分钟可 >59）——原型 sa-dur 格式。 */
function formatClockDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(total / 60))}:${p(total % 60)}`;
}

/**
 * 复制文本提取——规则平移自 turn-timeline parseToolRaw 的 copyText 分支
 * （design §12 解析规则平移不重造；parseToolRaw 未导出且 assembler 的
 * parseToolUseRaw 是私有函数，本地实现精简版，只用复制语义）：
 * Bash→command；Write/Edit/Read→file_path（有 content 则附带）；Agent→
 * description??prompt；通用→完整 args JSON。解析失败（非 JSON，R-07）/ raw
 * 空串（孤儿 result）→ null（不渲染复制按钮）。
 */
function toolCopyText(raw: string, toolName: string | null): string | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw.trim()) as { args?: unknown } | null;
    if (!obj || typeof obj !== "object") return null;
    const args = (obj.args && typeof obj.args === "object" ? obj.args : {}) as Record<
      string,
      unknown
    >;
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    if (toolName === "Bash") return str(args.command) ?? null;
    if (toolName === "Write" || toolName === "Edit" || toolName === "Read") {
      const fp = str(args.file_path) ?? "";
      const content = str(args.content);
      return content ? `${fp}\n\n${content}` : fp || null;
    }
    if (toolName === "Agent") return str(args.description) ?? str(args.prompt) ?? null;
    return JSON.stringify(args, null, 2);
  } catch {
    return null;
  }
}

/** 工具行图标——原型 t-icon 语义映射（未列工具统一 🔧 扳手，同现有 Wrench 语义）。 */
const TOOL_ICON: Record<string, string> = {
  Read: "📂",
  Write: "🎨",
  Edit: "✏️",
  Grep: "🔧",
  Glob: "🔧",
  Bash: "💻",
  Task: "🤖",
  Agent: "🤖",
};

function toolIconOf(toolName: string | null): string {
  return (toolName && TOOL_ICON[toolName]) || "🔧";
}

/** 工具状态徽章元数据（图标/颜色/提示文案平移现有 ToolEventCard）。 */
const TOOL_STATUS_META: Record<
  ToolTurnSegment["status"],
  { icon: string; cls: string; title: string }
> = {
  ok: { icon: "✓", cls: "text-emerald-600", title: "执行成功" },
  deny: { icon: "✗", cls: "text-destructive", title: "执行失败 / 被拒" },
  running: { icon: "⏳", cls: "text-blue-600", title: "执行中" },
};

/**
 * 子代理块状态：tool 段取自身 status；stub 段无状态字段——它是 tool_use 段
 * 尚未到达（或永不到达）的临时容器，子消息仍在流入，视为 running（后续合并
 * 迁入 tool 段后由其 status 接管，design §9.5）。
 */
function subagentStatus(segment: SubagentContainerSegment): "running" | "ok" | "deny" {
  return segment.kind === "subagent_stub" ? "running" : segment.status;
}

/* ───────────────────────────── 段组件（全部 memo） ───────────────────────────── */

/**
 * 文本段：markdown 气泡（与现 turn-timeline 答复气泡同款式——rounded-2xl 左上
 * 收角 + bg-card + MarkdownText）。streaming=true 时尾部流式光标（原型
 * streaming-caret：7×15px 蓝色竖条，blink 0.9s step-end；因 MarkdownText 是
 * 块级容器，光标落在正文末段之后的新行行首，见文件头偏差说明 1）。
 */
export const TextSegmentView = memo(function TextSegmentView({ segment }: TextSegmentViewProps) {
  useSegmentAnimations();
  return (
    <div className="seg-text-bubble max-w-[86%] self-start rounded-2xl rounded-tl-md border bg-card px-4 py-2.5 text-sm leading-6 text-foreground shadow-sm">
      <MarkdownText content={segment.text} />
      {segment.streaming && (
        <span
          aria-hidden
          className="seg-caret ml-0.5 inline-block h-[15px] w-[7px] rounded-[1px] bg-blue-600 align-[-2px]"
        />
      )}
    </div>
  );
});

/**
 * 思考折叠行（原型 seg-thinking / deepseek ReasoningRow 风格）：折叠头部 =
 * 箭头 + 💭 思考过程 + 摘要（空白折叠 60 字截断，流式自动跟随段文本更新）；
 * streaming 时标题旁「思考中」脉冲标记；默认折叠（R-03 展开才挂载正文）；
 * 展开正文 MarkdownText 限高 180px 滚动。
 */
export const ThinkingRowView = memo(function ThinkingRowView({ segment }: ThinkingRowViewProps) {
  const [open, setOpen] = useState(false);
  const summary = summaryOf(segment.text);
  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full cursor-pointer select-none items-center gap-[7px] rounded-md px-1.5 py-[3px] text-left text-[11.5px] text-muted-foreground hover:bg-muted"
      >
        <span
          aria-hidden
          className={cn(
            "shrink-0 text-[9px] transition-transform duration-150",
            open && "rotate-90",
          )}
        >
          ▶
        </span>
        <span className="shrink-0 font-medium">💭 思考过程</span>
        {segment.streaming && (
          <span className="inline-flex shrink-0 items-center gap-1 text-[10.5px] text-blue-600">
            <span aria-hidden className="h-[5px] w-[5px] animate-pulse rounded-full bg-blue-600" />
            思考中
          </span>
        )}
        {!open && summary && (
          <span className="ml-1 min-w-0 flex-1 truncate opacity-75">{summary}</span>
        )}
      </button>
      {open && (
        <div className="mt-1 max-h-[180px] overflow-y-auto rounded-lg bg-muted px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
          <MarkdownText content={segment.text} />
        </div>
      )}
    </div>
  );
});

/**
 * 工具行（原型 seg-tool / deepseek ToolRow 风格）：单行摘要 = 图标 + 工具名 +
 * 主参数（truncate）+ 状态徽章（✓/✗/⏳）+ 耗时（起止均有时才显示；运行中不显
 * 秒数——纯组件不读时钟，live 计时归状态条）+ 复制按钮（copyText 规则平移）。
 * status=running 时整行 seg-sweep 扫动动画（1.8s）。点击整行展开 result
 * （MarkdownText，默认折叠，限高 200px 滚动）；运行中无 result 展开显示
 * 「执行中…」占位。toolName 为空：孤儿 result 段显示「工具结果」，解析失败
 * （R-07）主参数位置原样显示 raw。
 */
export const ToolRowView = memo(function ToolRowView({ segment }: ToolRowViewProps) {
  useSegmentAnimations();
  const [open, setOpen] = useState(false);
  const running = segment.status === "running";
  const badge = TOOL_STATUS_META[segment.status];
  const duration =
    segment.startedAt != null && segment.endedAt != null
      ? formatToolDuration(segment.endedAt - segment.startedAt)
      : null;
  const copyText = toolCopyText(segment.raw, segment.toolName);
  const desc = segment.primary ?? (segment.raw || null);
  const result = segment.result?.trim() ?? "";
  return (
    <div className="w-full">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(!open);
          }
        }}
        className={cn(
          "relative flex w-full cursor-pointer items-center gap-2 overflow-hidden rounded-lg border border-blue-200 bg-blue-50 px-3 py-[5px] text-xs",
          running && "seg-sweep",
        )}
      >
        <span aria-hidden className="shrink-0 text-xs">
          {toolIconOf(segment.toolName)}
        </span>
        <span className="shrink-0 text-[11.5px] font-semibold text-blue-600">
          {segment.toolName ?? (segment.raw ? "工具调用" : "工具结果")}
        </span>
        {desc && (
          <span
            className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground"
            title={segment.raw || desc}
          >
            {desc}
          </span>
        )}
        <span
          className={cn("ml-auto shrink-0 font-mono text-[11px]", badge.cls)}
          title={badge.title}
          aria-label={badge.title}
        >
          {badge.icon}
        </span>
        {duration && (
          <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
            {duration}
          </span>
        )}
        {copyText && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void navigator.clipboard?.writeText(copyText);
            }}
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
            title="复制命令"
          >
            复制
          </button>
        )}
      </div>
      {open && (
        <div className="mt-1 max-h-[200px] overflow-y-auto rounded-lg bg-muted px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          {result ? (
            <MarkdownText content={result} />
          ) : running ? (
            <span>执行中…</span>
          ) : (
            <span>（无结果）</span>
          )}
        </div>
      )}
    </div>
  );
});

/**
 * 子代理嵌套块（原型 seg-subagent）：容器 = indigo 底嵌套卡；头部 = 状态点
 * （running 蓝色脉冲 / ok 绿 / deny 红）+ 🤖 名称（tool.primary 或 subagentType，
 * stub 显示 subagentType 或「子代理」）+ subagentType 标签 + 时长（起止差 mm:ss；
 * 运行中显示「运行中」，不读时钟）。运行中头部 seg-sweep 扫动。默认：运行中
 * 展开、完成折叠，均可点击切换；running→终态过渡时自动收敛为折叠（跟随
 * 「完成折叠」默认，task-05 implementation）。body 内 children 段序列经
 * SegmentView 递归渲染（支持 depth>1 嵌套），折叠时不挂载（R-03）。
 */
export const SubagentBlockView = memo(function SubagentBlockView({
  segment,
}: SubagentBlockViewProps) {
  useSegmentAnimations();
  const status = subagentStatus(segment);
  const running = status === "running";
  const [open, setOpen] = useState(running);
  // running→终态过渡：收敛为折叠（初值已按运行态取展开，此处只管生命周期中段翻转）。
  const prevRunningRef = useRef(running);
  useEffect(() => {
    if (prevRunningRef.current && !running) setOpen(false);
    prevRunningRef.current = running;
  }, [running]);

  const dotCls =
    status === "running"
      ? "bg-blue-600 animate-pulse"
      : status === "deny"
        ? "bg-destructive"
        : "bg-emerald-600";
  const name =
    segment.kind === "tool"
      ? (segment.primary?.trim() || segment.subagentType || "子代理")
      : (segment.subagentType || "子代理");
  let durationText: string | null = null;
  if (running) {
    durationText = "运行中";
  } else if (
    segment.kind === "tool" &&
    segment.startedAt != null &&
    segment.endedAt != null
  ) {
    durationText = formatClockDuration(segment.endedAt - segment.startedAt);
  }
  return (
    <div className="w-full self-stretch overflow-hidden rounded-[10px] border border-indigo-200 bg-indigo-50">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(!open);
          }
        }}
        className={cn(
          "relative flex cursor-pointer items-center gap-2 overflow-hidden px-3.5 py-[7px] text-xs",
          running && "seg-sweep",
        )}
      >
        <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", dotCls)} />
        <span aria-hidden className="shrink-0">
          🤖
        </span>
        <span className="min-w-0 truncate font-semibold">{name}</span>
        {segment.subagentType && (
          <span className="shrink-0 rounded-lg border border-border bg-card px-1.5 text-[10px] text-muted-foreground">
            {segment.subagentType}
          </span>
        )}
        {durationText && (
          <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
            {durationText}
          </span>
        )}
      </div>
      {open && (
        <div className="seg-subagent-body flex flex-col gap-[5px] border-t border-indigo-200 px-3.5 pb-2.5 pl-5 pt-2">
          {segment.children.map((child) => (
            <SegmentView key={child.id} segment={child} />
          ))}
        </div>
      )}
    </div>
  );
});

/**
 * stderr 警示行：⚠ 前缀 + amber 文本（样式平移现有 TurnDetailsList stderr 行，
 * 原型 --amber 语义对应）。whitespace-pre-wrap 保留原始换行。
 */
export const StderrRowView = memo(function StderrRowView({ segment }: StderrRowViewProps) {
  return (
    <div className="flex items-start gap-1.5 px-1 py-0.5 text-[11px] text-amber-700">
      <span aria-hidden className="shrink-0">
        ⚠
      </span>
      <span className="min-w-0 whitespace-pre-wrap break-words">{segment.text}</span>
    </div>
  );
});

/* ───────────────────────── 统一入口分发器 ───────────────────────── */

/**
 * SegmentView：按 kind 分发到五个段组件（task-05 统一入口）。tool 段带
 * children（子代理归属，FR-03）时升级为 SubagentBlockView 渲染，普通工具走
 * ToolRowView；subagent_stub 兜底段复用 SubagentBlockView（design §9.5）。
 * memo 默认浅比较依赖装配器 path-copy 的段引用稳定性（FR-06）；列表层以
 * segment.id 为稳定 key（消费方 task-06）。
 */
export const SegmentView = memo(function SegmentView({ segment }: SegmentViewProps) {
  switch (segment.kind) {
    case "text":
      return <TextSegmentView segment={segment} />;
    case "thinking":
      return <ThinkingRowView segment={segment} />;
    case "tool":
      return segment.children.length > 0 ? (
        <SubagentBlockView segment={segment} />
      ) : (
        <ToolRowView segment={segment} />
      );
    case "subagent_stub":
      return <SubagentBlockView segment={segment} />;
    case "stderr":
      return <StderrRowView segment={segment} />;
    default: {
      // 穷尽防御：TurnSegment 新增 kind 时此处编译期报错（never 不兼容）。
      const exhaustive: never = segment;
      void exhaustive;
      return null;
    }
  }
});

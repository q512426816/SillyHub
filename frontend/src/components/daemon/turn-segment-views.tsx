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
 *                       turn-timeline parseToolRaw 的 copyText 规则；
 *                       task-12：团队 MCP 工具（dispatch_worker 等 5 个）泛化微调
 *                       ——短名 + mcp 标识 + 👥 图标 + 角色/目标主参数摘要；
 *                       ql-20260824-018/019：展开区内容整体收编到
 *                       tool-args-detail 的 ToolExpandBody（Write 内容预览 / Edit
 *                       行级 diff 行号+红绿高亮 / Bash 纯文本输出 / Grep 命中数 /
 *                       Agent Prompt / 通用参数 JSON 兜底），下方接工具 result）
 *   - SubagentBlockView 子代理嵌套块（头部状态点/名称/类型/时长 + children 递归
 *                       渲染；运行中默认展开+头部扫动，完成默认折叠；subagent_stub
 *                       兜底段复用同组件；task-13：段带 [TASK_*] 元数据（async 后台
 *                       派发）时块头改状态徽标「后台运行中+走秒 / 已完成(真实时长) /
 *                       失败 / 已停止」+ 正文尾行进度摘要——元数据驱动，终态即终）
 *   - StderrRowView     stderr 警示行（⚠ 前缀，平移现有 amber 样式）
 *   - TeamWorkerBlockView 分身段块（task-12 / 2026-08-22-team-session-unify FR-07：
 *                       brand 折叠卡——角色/目标工作区徽标/状态/耗时 + children
 *                       日志产物；dispatch_worker tool 段在 SegmentView 升级路由到此）
 *   - file 段 → FileMessageCard（task-08 / 2026-08-23-agent-file-upload-mcp FR-01 /
 *                       D-001@v1：agent 上传文件卡片——图片缩略图 / 通用文件卡两
 *                       形态；本文件只包一层「agent 上传了文件」标注，卡片本体在
 *                       daemon/file-message-card.tsx）
 *   - SegmentView       统一入口分发器（按 kind 分发；tool 段有 children 时升级为
 *                       子代理块渲染；dispatch_worker 团队工具升级为分身段块）
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

import { Children, memo, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { MarkdownText } from "@/components/ui/markdown-text";
import { FileMessageCard } from "@/components/daemon/file-message-card";
import { ToolExpandBody } from "@/components/daemon/tool-args-detail";
import type {
  StubTurnSegment,
  ToolTurnSegment,
  TurnSegment,
} from "@/components/daemon/session-log-assembler";
import { workspaceTypeBadge } from "@/lib/workspace-types";
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

/** 段类型收窄别名（assembler 只导出 tool/stub 两个，此处补齐其余四类）。 */
export type TextTurnSegment = Extract<TurnSegment, { kind: "text" }>;
export type ThinkingTurnSegment = Extract<TurnSegment, { kind: "thinking" }>;
export type StderrTurnSegment = Extract<TurnSegment, { kind: "stderr" }>;
/** 文件段（task-08 / design §7.3）：FileMessageCard 的段级数据源。 */
export type FileTurnSegment = Extract<TurnSegment, { kind: "file" }>;
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
/** ql-20260825-011：上下文前导段（默认收起、可展开）。 */
export interface PreambleSegmentViewProps {
  segment: Extract<TurnSegment, { kind: "preamble" }>;
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
  running: { icon: "⏳", cls: "text-brand-600", title: "执行中" },
};

/**
 * 子代理块状态：tool 段取自身 status；stub 段无状态字段——它是 tool_use 段
 * 尚未到达（或永不到达）的临时容器，子消息仍在流入，视为 running（后续合并
 * 迁入 tool 段后由其 status 接管，design §9.5）。
 */
function subagentStatus(segment: SubagentContainerSegment): "running" | "ok" | "deny" {
  return segment.kind === "subagent_stub" ? "running" : segment.status;
}

/* ───────── task-13（2026-08-27-background-subagent-progress / FR-07 / D-005@v1）───────── */

/** [TASK_*] 任务状态（tool 段 taskStatus 元数据，task-11 装配）。 */
type SubagentTaskStatus = "running" | "completed" | "failed" | "stopped";

/**
 * 块头状态徽标（原型 .st 药丸：bg-running=brand 阶 / done=绿 / 失败=红 / 停止=灰；
 * 三主题语义阶——brand-* 随主题换肤，emerald/destructive 同既有完成/拒绝点色系）。
 */
const TASK_STATUS_BADGE: Record<SubagentTaskStatus, { label: string; cls: string }> = {
  running: { label: "后台运行中", cls: "bg-brand-100 text-brand-700" },
  completed: { label: "已完成", cls: "bg-emerald-600/15 text-emerald-600" },
  failed: { label: "失败", cls: "bg-destructive/15 text-destructive" },
  stopped: { label: "已停止", cls: "bg-muted text-muted-foreground" },
};

/**
 * task-13：子代理容器段的 [TASK_*] 元数据收窄——段带元数据（taskStatus 或
 * taskAsync 存在 = async 后台派发，task-11 装配）时返回任务状态：taskStatus
 * 有值即权威（终态即终，不再因 result 配对判完成——async 启动回执 0.1s 配对
 * 不是完成信号，design §1）；仅 taskAsync 时按 running。stub 段无这些字段恒
 * null；无元数据的前台阻塞式子代理也恒 null → 消费方走原推导，零回归。
 */
function taskMetaStatusOf(segment: SubagentContainerSegment): SubagentTaskStatus | null {
  if (segment.kind !== "tool") return null;
  if (segment.taskStatus === undefined && segment.taskAsync === undefined) return null;
  return segment.taskStatus ?? "running";
}

/* ─────────────── 团队 MCP 工具识别与摘要（task-12 / FR-07） ─────────────── */

/** 主控团队 MCP 5 工具（sillyhub-daemon mcp-server.ts registerTool 名单）。 */
const TEAM_MCP_TOOLS: ReadonlySet<string> = new Set([
  "dispatch_worker",
  "get_worker_result",
  "list_workers",
  "converge_mission",
  "report_progress",
]);

/**
 * 团队 MCP 工具短名识别：Claude 上报形态带 `mcp__<server>__` 前缀（如
 * mcp__sillyhub__dispatch_worker），daemon 直报裸名（dispatch_worker）——取末段
 * 匹配 5 工具白名单；非团队工具返回 null（走既有 ToolRowView 泛化路径）。
 */
function teamMcpToolName(toolName: string | null): string | null {
  if (!toolName) return null;
  const last = toolName.split("__").pop() ?? "";
  return TEAM_MCP_TOOLS.has(last) ? last : null;
}

/** 团队工具 args 解析（raw 为 tool_call JSON；解析失败返回空对象）。 */
function parseTeamToolArgs(raw: string): Record<string, unknown> {
  try {
    const obj = JSON.parse((raw ?? "").trim()) as { args?: unknown } | null;
    if (obj && typeof obj === "object" && obj.args && typeof obj.args === "object") {
      return obj.args as Record<string, unknown>;
    }
  } catch {
    // 非 JSON → 空对象（desc 回退既有 primary/raw 链）
  }
  return {};
}

/** 摘要截断（团队工具主参数，40 字）。 */
function teamBrief(text: string, max = 40): string {
  const s = text.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * 团队 MCP 工具主参数摘要（原型 §03 tool-card .cmd 语义）：
 * dispatch_worker → 「角色 · 目标」；get_worker_result → 读取产出；
 * converge_mission → 收敛分身产出；list_workers → 列出分身进度；
 * report_progress → 进度备注。args 空时返回 null（回退既有 desc 链）。
 */
function teamToolSummaryOf(tool: string, raw: string): string | null {
  const args = parseTeamToolArgs(raw);
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  switch (tool) {
    case "dispatch_worker": {
      const role = str(args.role);
      const objective = str(args.objective);
      if (!role && !objective) return null;
      return objective ? `${role ?? "分身"} · ${teamBrief(objective)}` : (role ?? "分身");
    }
    case "get_worker_result": {
      const role = str(args.role) ?? str(args.run_id);
      return role ? `读取 ${teamBrief(role)} 产出` : "读取分身产出";
    }
    case "converge_mission":
      return "收敛分身产出";
    case "list_workers":
      return "列出分身进度";
    case "report_progress": {
      const note = str(args.note) ?? str(args.progress);
      return note ? `进度：${teamBrief(note)}` : "上报进度";
    }
    default:
      return null;
  }
}

/** dispatch_worker tool 段 → 分身段块（SegmentView 升级路由用，见 TeamWorkerBlockView）。 */
function isTeamDispatchTool(toolName: string | null): boolean {
  return teamMcpToolName(toolName) === "dispatch_worker";
}

/**
 * ql-20260825-011：用户是否正在选中文字（选区非空）。可点击折叠行（思考/工具/
 * 子代理/分身/前导）的 onClick 先查本函数——拖选文本松开鼠标触发的 click 不再
 * 触发折叠/展开，选中内容可正常复制（用户反馈「聊天页选不了文字想复制不方便」）。
 */
function hasActiveTextSelection(): boolean {
  if (typeof window === "undefined") return false;
  const sel = window.getSelection();
  return sel != null && !sel.isCollapsed && sel.toString().length > 0;
}

/* ───────────────────────────── 段组件（全部 memo） ───────────────────────────── */

/**
 * 文本段：markdown 气泡（与现 turn-timeline 答复气泡同款式——rounded-2xl 左上
 * 收角 + bg-card + MarkdownText）。streaming=true 时尾部流式光标（原型
 * streaming-caret：7×15px 竖条（brand 阶随主题），blink 0.9s step-end；因 MarkdownText 是
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
          className="seg-caret ml-0.5 inline-block h-[15px] w-[7px] rounded-[1px] bg-brand-600 align-[-2px]"
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
        onClick={() => {
          if (hasActiveTextSelection()) return; // ql-20260825-011：拖选中不触发折叠
          setOpen(!open);
        }}
        aria-expanded={open}
        className="flex w-full cursor-pointer select-text items-center gap-[7px] rounded-md px-1.5 py-[3px] text-left text-[11.5px] text-muted-foreground hover:bg-muted"
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
          <span className="inline-flex shrink-0 items-center gap-1 text-[10.5px] text-brand-600">
            <span aria-hidden className="h-[5px] w-[5px] animate-pulse rounded-full bg-brand-600" />
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
 *
 * task-12（2026-08-22-team-session-unify FR-07）团队 MCP 工具泛化微调（原型 §03
 * tool-card）：5 团队工具（mcp__server__ 前缀或裸名）→ 👥 图标 + mcp 来源标识 +
 * 短名（剥前缀）+ 角色/目标主参数摘要；其余工具渲染零改动。
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
  const teamTool = teamMcpToolName(segment.toolName);
  const teamSummary = teamTool ? teamToolSummaryOf(teamTool, segment.raw) : null;
  const desc = teamSummary ?? segment.primary ?? (segment.raw || null);
  return (
    <div className="w-full">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => {
          if (hasActiveTextSelection()) return; // ql-20260825-011：拖选中不触发折叠
          setOpen(!open);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(!open);
          }
        }}
        className={cn(
          "relative flex w-full cursor-pointer select-text items-center gap-2 overflow-hidden rounded-lg border border-brand-200 bg-brand-50 px-3 py-[5px] text-xs",
          running && "seg-sweep",
        )}
      >
        <span aria-hidden className="shrink-0 text-xs">
          {teamTool ? "👥" : toolIconOf(segment.toolName)}
        </span>
        {teamTool && (
          <span
            className="shrink-0 rounded border border-brand-200 bg-brand-50 px-1 py-px text-[9.5px] font-semibold leading-none text-brand-700"
            title="团队 MCP 工具"
          >
            mcp
          </span>
        )}
        <span className="shrink-0 text-[11.5px] font-semibold text-brand-600">
          {teamTool ?? segment.toolName ?? (segment.raw ? "工具调用" : "工具结果")}
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
          {/* ql-20260824-018/019：展开区内容（参数详情 + result 区）整体收编到
              tool-args-detail 的 ToolExpandBody——Write 内容预览 / Edit 行级 diff /
              Bash 纯文本输出+复制 / Read 行范围+复制 / Grep 参数+命中数 / Agent
              Prompt 预览 / 其余工具通用参数 JSON 兜底。 */}
          <ToolExpandBody segment={segment} running={running} />
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
 *
 * task-13（2026-08-27-background-subagent-progress / FR-07 / D-005@v1）：段带
 * [TASK_*] 元数据（async 后台派发，task-11 装配）时块头改元数据驱动——状态徽标
 * 「后台运行中 / 已完成 / 失败 / 已停止」+ 时长（运行中本地走秒；终态 = 服务端
 * 权威 taskElapsedMs 真实用时，不再显示回执差值 00:00），正文尾行补最近一条
 * [TASK_*] 消费后的进度摘要（taskToolName + taskSummary）。走秒为组件局部 tick
 *（仅 async 运行中启动）——task-05「纯组件不读本地时钟」约束在此让位：运行中
 * 不显示秒数会重新制造「00:00 假完成」盲区。无元数据段走原推导（前台阻塞式
 * 子代理零回归）。
 */
export const SubagentBlockView = memo(function SubagentBlockView({
  segment,
}: SubagentBlockViewProps) {
  useSegmentAnimations();
  // task-13：[TASK_*] 元数据优先（stub 段无元数据恒走原三态推导）。
  const taskSeg = segment.kind === "tool" ? segment : null;
  const metaStatus = taskMetaStatusOf(segment);
  const status = metaStatus ?? subagentStatus(segment);
  const running = status === "running";
  const [open, setOpen] = useState(running);
  // running→终态过渡：收敛为折叠（初值已按运行态取展开，此处只管生命周期中段翻转）。
  const prevRunningRef = useRef(running);
  useEffect(() => {
    if (prevRunningRef.current && !running) setOpen(false);
    prevRunningRef.current = running;
  }, [running]);

  // task-13：后台异步运行中本地走秒（FR-06 渲染经济性对齐 subagent-catalog 模式：
  // tick 是组件局部 state，仅 async 运行中启动，终态/卸载清理）；锚点 = 段
  // startedAt（派发时刻）。
  const [now, setNow] = useState<number>(() => Date.now());
  const asyncRunning = metaStatus === "running";
  useEffect(() => {
    if (!asyncRunning) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [asyncRunning]);

  const dotCls =
    status === "running"
      ? "bg-brand-600 animate-pulse"
      : status === "deny" || status === "failed"
        ? "bg-destructive"
        : status === "stopped"
          ? "bg-muted-foreground"
          : "bg-emerald-600";
  const name =
    segment.kind === "tool"
      ? (segment.primary?.trim() || segment.subagentType || "子代理")
      : (segment.subagentType || "子代理");
  let durationText: string | null = null;
  if (metaStatus != null && taskSeg != null) {
    // task-13：元数据驱动时长——终态 = 服务端权威 taskElapsedMs（真实用时）；
    // 运行中 = 本地走秒（缺锚点回退最近一次 taskElapsedMs 校准值，再缺不显示）。
    if (metaStatus === "running") {
      durationText =
        taskSeg.startedAt != null
          ? formatClockDuration(now - taskSeg.startedAt)
          : taskSeg.taskElapsedMs != null
            ? formatClockDuration(taskSeg.taskElapsedMs)
            : null;
    } else {
      durationText =
        taskSeg.taskElapsedMs != null ? formatClockDuration(taskSeg.taskElapsedMs) : null;
    }
  } else if (running) {
    durationText = "运行中";
  } else if (
    segment.kind === "tool" &&
    segment.startedAt != null &&
    segment.endedAt != null
  ) {
    durationText = formatClockDuration(segment.endedAt - segment.startedAt);
  }
  // task-13：正文尾行 = 最近一条 [TASK_*] 消费后的进度摘要（段元数据，原型
  // blk-body 的 └ 行）——运行中 = 最近工具名（brand 阶）+ 进行中摘要（PROGRESS
  // 行）；终态 = 终态文案 + 摘要（NOTIFICATION 行，taskToolName 已陈旧不展示）。
  // 无摘要不渲染。
  const progressLine: { label: string | null; tool: string | null; summary: string } | null =
    (() => {
      if (taskSeg == null || metaStatus == null) return null;
      const summary = taskSeg.taskSummary?.trim() ?? "";
      if (metaStatus === "running") {
        const tool = taskSeg.taskToolName?.trim() ?? "";
        return tool || summary ? { label: null, tool: tool || null, summary } : null;
      }
      return summary
        ? { label: TASK_STATUS_BADGE[metaStatus].label, tool: null, summary }
        : null;
    })();
  return (
    <div className="w-full self-stretch overflow-hidden rounded-[10px] border border-indigo-200 bg-indigo-50">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => {
          if (hasActiveTextSelection()) return; // ql-20260825-011：拖选中不触发折叠
          setOpen(!open);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(!open);
          }
        }}
        className={cn(
          "relative flex cursor-pointer select-text items-center gap-2 overflow-hidden px-3.5 py-[7px] text-xs",
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
        {/* task-13：元数据驱动的块头状态徽标（后台运行中/已完成/失败/已停止，
            原型 .st 药丸）；前台路径不渲染（保持原形态零回归）。 */}
        {metaStatus != null && (
          <span
            className={cn(
              "shrink-0 rounded-[5px] px-2 py-px text-[10.5px] font-semibold",
              TASK_STATUS_BADGE[metaStatus].cls,
            )}
          >
            {TASK_STATUS_BADGE[metaStatus].label}
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
          {progressLine && (
            <p
              className="flex min-w-0 items-baseline gap-1.5 font-mono text-[10.5px] text-muted-foreground"
              title={`${progressLine.tool ?? progressLine.label ?? ""} ${progressLine.summary}`.trim()}
            >
              <span aria-hidden className="shrink-0 text-muted-foreground/70">
                └
              </span>
              {progressLine.label && (
                <span
                  className={cn(
                    "shrink-0 font-semibold",
                    metaStatus === "completed"
                      ? "text-emerald-600"
                      : metaStatus === "failed"
                        ? "text-destructive"
                        : "text-muted-foreground",
                  )}
                >
                  {progressLine.label}
                </span>
              )}
              {progressLine.tool && (
                <span className="shrink-0 font-semibold text-brand-600">
                  {progressLine.tool}
                </span>
              )}
              {progressLine.summary && (
                <span className="min-w-0 truncate">{progressLine.summary}</span>
              )}
            </p>
          )}
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

/**
 * 上下文前导卡（ql-20260825-011 收紧展示）：进度视图专属（对话视图不渲染
 * preamble 段），**默认收起**、点击头部展开原文——去除原「（创建轮，仅 AI
 * 可见）」括号说明（用户反馈），标题带字符数提示。正文 select-text 可选中
 * 复制；拖选不触发收起（hasActiveTextSelection 守卫）。
 */
export const PreambleSegmentView = memo(function PreambleSegmentView({
  segment,
}: PreambleSegmentViewProps) {
  const [open, setOpen] = useState(false);
  const charCount = segment.text.length;
  return (
    <div className="flex w-full max-w-[86%] flex-col gap-1 self-start">
      <button
        type="button"
        onClick={() => {
          if (hasActiveTextSelection()) return;
          setOpen(!open);
        }}
        aria-expanded={open}
        className="flex w-fit cursor-pointer select-text items-center gap-[7px] rounded-md px-1.5 py-[3px] text-left text-[11px] text-muted-foreground hover:bg-muted"
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
        <span className="shrink-0 font-medium">上下文注入</span>
        <span className="shrink-0 opacity-75">{`（${charCount} 字，已随消息发送）`}</span>
      </button>
      {open && (
        <div className="select-text whitespace-pre-wrap rounded-lg border border-dashed border-brand-300 bg-brand-50/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
          {segment.text}
        </div>
      )}
    </div>
  );
});

/* ─────────────── 分身段块（task-12 / 2026-08-22-team-session-unify / FR-07） ─────────────── */

/** 分身 run 状态 → 渲染态/文案/颜色（与 team-task-block WORKER_STATUS_META 对齐；
 * 段族文件保持零跨模块依赖，故独立维护同款映射）。
 * task-13：bg_running / stopped 为 [TASK_*] 元数据映射态——async 后台派发运行中
 * 显示「后台运行中」（brand 阶），任务被停止显示灰；无元数据路径不产生这两态。 */
const WORKER_STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: "排队中", cls: "text-muted-foreground" },
  running: { label: "运行中", cls: "text-brand-700" },
  bg_running: { label: "后台运行中", cls: "text-brand-700" },
  completed: { label: "已完成", cls: "text-emerald-700" },
  failed: { label: "失败", cls: "text-red-600" },
  killed: { label: "已终止", cls: "text-muted-foreground" },
  cancelled: { label: "已取消", cls: "text-muted-foreground" },
  interrupted: { label: "已打断", cls: "text-muted-foreground" },
  stopped: { label: "已停止", cls: "text-muted-foreground" },
};

const WORKER_STATUS_FALLBACK = { label: "未知", cls: "text-muted-foreground" };

export interface TeamWorkerBlockProps {
  /** 分身角色（dispatch_worker args.role；缺省「分身」）。 */
  role: string | null;
  /** 分身 run 状态（pending/running/completed/failed/killed…，未知值有兜底）。 */
  status: string;
  /** 分身目标（dispatch_worker args.objective）。 */
  objective?: string | null;
  /** 耗时（ms，起止差——纯组件不读本地时钟，由调用方传入）。 */
  durationMs?: number | null;
  /** 目标工作区徽标：名称 + 类型（类型配色走 workspaceTypeBadge 词表）。 */
  workspaceName?: string | null;
  workspaceType?: string | null;
  /** 目标工作区 id 短标识（无名称时兜底展示 #xxxxxxxx，原型 §03 ws-tag 语义）。 */
  workspaceId?: string | null;
  /** body 内容（分身归属日志/产物；SegmentView 路由为 children 段递归）。 */
  children?: ReactNode;
}

/**
 * 分身段块（原型 §03 violet `<details>` .worker 语义，实现已迁 brand 语义阶
 * ql-20260828-007-7dcf）：brand 折叠卡——头部 =
 * 👥 分身「角色」+ 状态 + mm:ss 耗时 + 目标工作区徽标；body = 目标一行 + children
 * （分身日志/产物）。运行中默认展开 + 无扫动（头部轻量），终态默认折叠，点击切换；
 * running→终态过渡自动收敛折叠（对齐 SubagentBlockView）。无 children 时显示
 * 日志/产物入口预留说明。
 *
 * 数据两条路：① SegmentView 升级路由——dispatch_worker tool 段（主控 MCP 派发
 * 调用，其 children 为分身归属日志段）自动进本组件；② 父层直传 props（task-11
 * 接线真实工作区名称/类型徽标）。
 */
export const TeamWorkerBlockView = memo(function TeamWorkerBlockView({
  role,
  status,
  objective,
  durationMs,
  workspaceName,
  workspaceType,
  workspaceId,
  children,
}: TeamWorkerBlockProps) {
  useSegmentAnimations();
  const wsMeta = WORKER_STATUS_META[status] ?? WORKER_STATUS_FALLBACK;
  // task-13：bg_running（[TASK_*] 元数据映射态）与 running 同属运行中口径。
  const running = status === "pending" || status === "running" || status === "bg_running";
  const [open, setOpen] = useState(running);
  // running → 终态过渡：收敛为折叠（同 SubagentBlockView 生命周期语义）。
  const prevRunningRef = useRef(running);
  useEffect(() => {
    if (prevRunningRef.current && !running) setOpen(false);
    prevRunningRef.current = running;
  }, [running]);

  const hasWs = Boolean(workspaceName || workspaceId);
  return (
    <div className="w-full self-stretch overflow-hidden rounded-[10px] border border-brand-200 bg-brand-50">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => {
          if (hasActiveTextSelection()) return; // ql-20260825-011：拖选中不触发折叠
          setOpen(!open);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(!open);
          }
        }}
        className="flex cursor-pointer select-text items-center gap-2 px-3 py-[7px] text-xs"
      >
        <span aria-hidden className="shrink-0">
          👥
        </span>
        <span className="min-w-0 shrink-0 truncate font-semibold text-brand-700">
          {`分身「${role || "分身"}」`}
        </span>
        <span className={cn("shrink-0 text-[12px]", wsMeta.cls)}>{wsMeta.label}</span>
        {durationMs != null && (
          <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
            {formatClockDuration(durationMs)}
          </span>
        )}
        {hasWs && (
          <span
            className={cn(
              "inline-flex h-5 shrink-0 items-center rounded border px-1.5 text-[10px] font-semibold",
              workspaceName
                ? workspaceTypeBadge(workspaceType).className
                : "border-brand-200 bg-card font-mono text-brand-700",
            )}
            title={workspaceId ?? workspaceName ?? undefined}
          >
            {workspaceName || (workspaceId ? `#${workspaceId.slice(0, 8)}` : "")}
          </span>
        )}
      </div>
      {open && (
        <div className="flex flex-col gap-[5px] border-t border-dashed border-brand-200 bg-card px-3 pb-2.5 pt-2">
          {objective && (
            <p className="text-[11.5px] text-muted-foreground">{`目标：${objective}`}</p>
          )}
          {Children.count(children) > 0 ? (
            children
          ) : (
            <p className="text-[11px] text-muted-foreground/80">
              日志与产物入口（接线后开放）
            </p>
          )}
        </div>
      )}
    </div>
  );
});

/**
 * dispatch_worker tool 段 → TeamWorkerBlockProps（args 解析 + 段三态映射）。
 * task-13（FR-07）：段带 [TASK_*] 元数据（async 后台派发）时状态/时长优先走
 * 元数据——taskStatus 终态即终（不再被段三态误判 completed），运行中映射
 * bg_running（头部「后台运行中」）；时长终态取服务端 taskElapsedMs，运行中
 * 不显示冻结值（本组件纯展示不读本地时钟，走秒归子代理块/目录）。无元数据
 * 走原段三态映射（团队路径零回归）。
 */
function teamWorkerBlockFromSegment(segment: ToolTurnSegment): TeamWorkerBlockProps {
  const args = parseTeamToolArgs(segment.raw);
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const metaStatus = taskMetaStatusOf(segment);
  return {
    role: str(args.role),
    status:
      metaStatus === "completed"
        ? "completed"
        : metaStatus === "failed"
          ? "failed"
          : metaStatus === "stopped"
            ? "stopped"
            : metaStatus === "running"
              ? (segment.taskAsync ? "bg_running" : "running")
              : // 段三态 → run 状态口径（running/ok/deny → running/completed/failed）
                segment.status === "ok"
                ? "completed"
                : segment.status === "deny"
                  ? "failed"
                  : "running",
    objective: str(args.objective),
    durationMs:
      metaStatus === "running"
        ? null
        : metaStatus != null
          ? (segment.taskElapsedMs ?? null)
          : segment.startedAt != null && segment.endedAt != null
            ? segment.endedAt - segment.startedAt
            : null,
    workspaceId: str(args.target_workspace_id),
    children: segment.children.map((child) => (
      <SegmentView key={child.id} segment={child} />
    )),
  };
}

/* ───────────────────────── 统一入口分发器 ───────────────────────── */

/**
 * SegmentView：按 kind 分发到段组件（task-05 统一入口）。tool 段带
 * children（子代理归属，FR-03）时升级为 SubagentBlockView 渲染，普通工具走
 * ToolRowView；subagent_stub 兜底段复用 SubagentBlockView（design §9.5）。
 * task-12（FR-07）：dispatch_worker 团队工具段升级为 TeamWorkerBlockView
 * （分身段块——派发调用即分身在进度视图的代表，其 children 为分身归属日志）。
 * task-08（FR-01）：file 段渲染 FileMessageCard（agent 上传文件卡片）。
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
      if (isTeamDispatchTool(segment.toolName)) {
        return <TeamWorkerBlockView {...teamWorkerBlockFromSegment(segment)} />;
      }
      return segment.children.length > 0 ? (
        <SubagentBlockView segment={segment} />
      ) : (
        <ToolRowView segment={segment} />
      );
    case "subagent_stub":
      return <SubagentBlockView segment={segment} />;
    case "stderr":
      return <StderrRowView segment={segment} />;
    case "preamble":
      // 2026-08-25-unified-floating-session task-11（FR-7）：上下文前导卡——
      // 「全部（进度）」视图显示首轮注入的【变更/页面上下文】【团队任务简报】
      // 来源（对话视图保持干净，不渲染本段——时间线仅 all 视图纳入 preamble）。
      // ql-20260825-011：默认收起、可展开（PreambleSegmentView）。
      return <PreambleSegmentView segment={segment} />;
    case "file":
      // task-08（FR-01 / D-001@v1）：文件段 → FileMessageCard（图片缩略图 / 通用
      // 卡两形态，antd 仅经其间接使用）；本层只加「agent 上传了文件」标注行
      // （原型 .file-msg .who），卡片本体在 task-09 产出文件区可原样复用。
      return (
        <div className="flex w-full max-w-[86%] flex-col gap-1 self-start">
          <span className="select-none pl-0.5 text-[11px] text-muted-foreground">
            agent 上传了文件
          </span>
          <FileMessageCard
            fileId={segment.fileId}
            name={segment.name}
            size={segment.size}
            mime={segment.mime}
            description={segment.description}
            ts={segment.ts}
          />
        </div>
      );
    default: {
      // 穷尽防御：TurnSegment 新增 kind 时此处编译期报错（never 不兼容）。
      const exhaustive: never = segment;
      void exhaustive;
      return null;
    }
  }
});

"use client";

/**
 * task-05（2026-08-19-session-stream-ux / FR-01 / FR-03 / FR-06 / D-003@v1）：
 * 段渲染组件族——消费 session-log-assembler（task-01）的 TurnSegment 结构化段
 * 模型，按 prototype-session-stream.html 视觉基准（D-003）渲染五类段：
 *
 *   - TextSegmentView   文本段无框正文（MarkdownText + streaming 尾部闪烁光标；
 *                       task-11：正文右下角 hover 浮出 CopyButton 复制 segment.text）
 *   - ThinkingRowView   思考折叠行（💭 思考 + 「·」+ 摘要 60 字截断 + streaming
 *                       「思考中」脉冲标记；task-11：展开正文右下角 hover 浮出
 *                       CopyButton 复制 segment.text）
 *   - ToolRowView       工具单行（D-025 语义标签 + 工具名 + 主参数 + 状态徽章 +
 *                       耗时 + 运行中扫动；标签映射见 process-labels.ts）；
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
 *                       失败 / 已停止」+ 正文尾行进度摘要——元数据驱动，终态即终；
 *                       2026-09-15-subagent-three-pane-display task-01：消费
 *                       SubagentPanelContext（page 模式 Provider）时改紧凑卡片——
 *                       只显头部行、children 移右栏、点击 toggle 面板；无 context
 *                       （dialog 等旧宿主）保持原内联展开零回归）
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
 *   - TurnForkEntry     轮头「⑂ 从此分叉」入口（2026-09-22-session-fork-continuation
 *                       task-07 / FR-01：caps≠none / 终态轮 / native 锚点缺失三重
 *                       门控，纯展示 props 驱动零请求，点击回调上抛挂载方）
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
 * 与原型的一处已知偏差（备注）：
 *   1. 流式光标落在正文块末尾的下一行行首——MarkdownText 是块级容器，无法把
 *      inline 光标拼进 markdown 正文尾（sanitize 会剥注入的 HTML）；原型为 inline。
 *      （原偏差 2「子代理块内文本段去气泡底色（.seg-subagent-body 父级选择器
 *      覆盖）」已消除：2026-09-20-agent-reply-no-bubble 起文本段整体改无框正文
 *      .seg-text-body，子代理文本天然无框，覆盖规则随之删除，不再是偏差。）
 */

import { Children, createContext, memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { MarkdownText } from "@/components/ui/markdown-text";
import { processLabel } from "@/components/daemon/process-labels";
import { CopyButton } from "@/components/daemon/copy-button";
import { FileMessageCard } from "@/components/daemon/file-message-card";
import { useSubagentPanel } from "@/components/daemon/subagent-panel-context";
// 2026-10-25-subagent-card-unify-panel（FR-05）：子代理卡片内嵌内部活动流动条
//（与外部会话跑马灯同一组件/机制，inline 变体贴卡片布局）。
import {
  TurnLiveMarquee,
  deriveLiveMarqueeEntries,
} from "@/components/daemon/turn-live-marquee";
import { ToolExpandBody } from "@/components/daemon/tool-args-detail";
import {
  TranslatedThinkingBody,
  useThinkingSummary,
} from "@/components/thinking-translate";
// ql-20260920-006：user_msg 段文本剥附件标记行（页内 import 惯例——turn-timeline
// 同源引用 runtime-session-helpers 的既有 util，此处沿用）。
import { parseAttachmentMarkers } from "@/components/daemon/runtime-session-helpers";
import { InlineAttRefTextWithPreview } from "@/components/daemon/attachment-ref-tag";
import type {
  StubTurnSegment,
  ToolTurnSegment,
  TurnSegment,
} from "@/components/daemon/session-log-assembler";
import { TURN_TRIGGER_META } from "@/components/daemon/session-log-assembler";
import { getProviderCaps } from "@/lib/provider-caps";
import type { ProviderCaps } from "@/lib/provider-caps";
import { workspaceTypeBadge } from "@/lib/workspace-types";
import { cn } from "@/lib/utils";
import { copyTextToClipboard } from "@/lib/clipboard";

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

/**
 * 2026-10-13-subagent-stub-reconcile（FR-01/02）：子代理容器头对账命中产物——
 * 服务端任务快照（GET /sessions/{id}/tasks 的 AgentSessionTaskRead，按
 * tool_use_id 关联）的展示最小面。结构化类型：session-panel 页面级经
 * buildSubagentTaskLookup（use-session-tasks.ts）构建 Map 后经
 * SubagentTaskLookupContext 下发，本组件不 import hooks 文件（防环）。
 */
export interface SubagentReconciledTask {
  taskName: string;
  status: "running" | "completed" | "failed" | "stopped";
  elapsedMs: number | null;
}

/**
 * 2026-10-13-subagent-stub-reconcile：子代理容器头对账索引（tool_use_id →
 * 快照行）。Provider 在 session-panel-page 页面级（同时覆盖时间线与右栏详情
 * 面板）；null（dialog 弹窗等旧宿主）= 不对账，行为与修复前一致。
 *
 * 2026-10-13-turn-live-visibility：值扩为双索引——byToolUseId 供容器头对账
 * （原面不变），byTaskId 供 TaskOutput 等待行任务名与派发段终态收敛（本变更
 * 新增面）。结构兼容 use-session-tasks 的 SubagentTaskLookupIndex（防环不
 * import hooks 文件，字段同构）。
 */
export interface SubagentTaskLookup {
  byToolUseId: Map<string, SubagentReconciledTask>;
  byTaskId: Map<string, SubagentReconciledTask>;
}
export const SubagentTaskLookupContext = createContext<
  SubagentTaskLookup | null
>(null);

/**
 * 2026-10-13-turn-live-visibility（FR-02·评审 P2 修复）：段的任务快照查找——
 * tool_use_id 直查（精确键优先），段带 taskTaskId（[TASK_*] 行写入）时按
 * task_id 兜底；快照行 tool_use_id 可空缺失时块头也能对账终态，与
 * turn-status-bar collectSubagents 的双键口径一致。未命中 null。
 */
export function taskSnapshotOfSegment(
  lookup: SubagentTaskLookup | null,
  segment: { id: string; taskTaskId?: string },
): SubagentReconciledTask | null {
  const direct = lookup?.byToolUseId.get(segment.id);
  if (direct) return direct;
  if (segment.taskTaskId && lookup) {
    return lookup.byTaskId.get(segment.taskTaskId) ?? null;
  }
  return null;
}
export interface StderrRowViewProps {
  segment: StderrTurnSegment;
}
/** ql-20260825-011：上下文前导段（默认收起、可展开）。 */
export interface PreambleSegmentViewProps {
  segment: Extract<TurnSegment, { kind: "preamble" }>;
}
/** ql-20260917-006：上下文压缩续接摘要段（默认收起、可展开，同 preamble 展示语义）。 */
export interface CompactSegmentViewProps {
  segment: Extract<TurnSegment, { kind: "compact" }>;
}
/** ql-20260917-006：压缩过程状态段（[COMPACT_STATUS] 协议行，渲染层解析 phase）。 */
export interface CompactStatusRowViewProps {
  segment: Extract<TurnSegment, { kind: "compact_status" }>;
}
/** 2026-10-28-model-retry-visible：模型重试过程段（[MODEL_RETRY] 协议行，渲染层解析载荷）。 */
export interface ModelRetryRowViewProps {
  segment: Extract<TurnSegment, { kind: "model_retry" }>;
}
/** ql-20260920-006：轮内用户消息段（引导注入留痕，三态右对齐用户气泡）。 */
export interface UserMsgSegmentViewProps {
  segment: Extract<TurnSegment, { kind: "user_msg" }>;
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
 * 2026-10-13-slim-subagent-false-running / FR-04：历史批量装配收尾仍残留的
 * 孤儿 stub（orphaned，派发行缺失/不可解析的数据病理）不可能再合并——显示
 * 中性 stopped 灰态（灰点无脉冲无「运行中」），不再恒假「运行中」。实时
 * 暂态 stub 不带标记，仍 running 等待合并，行为零变化。
 */
function subagentStatus(
  segment: SubagentContainerSegment,
): "running" | "ok" | "deny" | "stopped" {
  if (segment.kind === "subagent_stub") {
    return segment.orphaned ? "stopped" : "running";
  }
  return segment.status;
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

/* ───────── 2026-10-13-turn-live-visibility（FR-01：TaskOutput 等待行）───────── */

/** TaskOutput 工具调用解析产物（parseTaskOutputWait）。 */
export interface TaskOutputWaitInfo {
  taskId: string;
}

/**
 * 解析 TaskOutput 段 raw JSON 的等待参数（task_id）。tool_call 原文形如
 * {"tool":"TaskOutput","args":{"task_id":"bm…","block":true,"timeout":…}}——
 * 阻塞等待与快速查询统一显示等待行（快速查询瞬时终态回归，无形态差）；
 * 历史截断（slim）或形态变化解析失败 → null（消费方回退既有渲染，不崩）。
 */
export function parseTaskOutputWait(raw: string): TaskOutputWaitInfo | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const args = (parsed as { args?: unknown }).args;
  if (typeof args !== "object" || args === null) return null;
  const taskId = (args as { task_id?: unknown }).task_id;
  if (typeof taskId !== "string" || !taskId) return null;
  return { taskId };
}

/* ───────────── task-03（2026-09-15-subagent-three-pane-display / FR-02 / design §5.E）───────── */

/**
 * 子代理块头部派生结果（subagentHeaderOf 产出）——SubagentBlockView 两种模式
 * （紧凑卡片 / 内联展开）与右栏 SubagentDetailPanel 头部共用同一份派生，
 * 防两处复制漂移。
 */
export interface SubagentHeaderInfo {
  /** 综合状态（[TASK_*] 元数据优先，否则段三态；stub 恒 running）。 */
  status: SubagentTaskStatus | "ok" | "deny";
  /** task-13 元数据状态（无元数据 null——消费方据此不渲染状态徽标）。 */
  metaStatus: SubagentTaskStatus | null;
  /** 是否运行中（status === "running"，seg-sweep / 展开默认等消费）。 */
  running: boolean;
  /** 状态点样式（running=brand 阶 pulse / deny·failed=红 / stopped=灰 / 其余绿）。 */
  dotCls: string;
  /** 头部名称（tool 段 primary 优先，回退 subagentType / 「子代理」；stub 无 primary）。 */
  name: string;
  /** subagentType 标签（null 不渲染标签）。 */
  subagentType: string | null;
  /** task-13 状态徽标（后台运行中/已完成/失败/已停止；无元数据 null）。 */
  badge: { label: string; cls: string } | null;
  /** 时长文本（mm:ss / 「运行中」/ null 不渲染——推导规则见 subagentHeaderOf）。 */
  durationText: string | null;
}

/**
 * 子代理块头部公共纯函数（task-03 / design §5.E「复用 SubagentBlockView 头部
 * 派生逻辑，抽公共纯函数 subagentHeaderOf(segment)」）——名称/状态点/徽标/时长
 * 一处派生，SubagentBlockView（两模式）与右栏 SubagentDetailPanel 共用。
 *
 * 时长推导（task-13 元数据双路径原样收敛）：
 *   - 元数据终态 → 服务端权威 taskElapsedMs（缺失 null）；
 *   - 元数据运行中 → 本地走秒 now - startedAt（now 由消费方 tick state 传入，
 *     纯函数不读时钟）；缺 startedAt 锚点回退最近一次 taskElapsedMs 校准值；
 *   - 无元数据运行中 → 「运行中」（不读时钟，与原实现一致）；
 *   - 无元数据终态 → endedAt - startedAt（起止均有才显示）。
 */
export function subagentHeaderOf(
  segment: SubagentContainerSegment,
  now: number,
  reconciled?: SubagentReconciledTask | null,
): SubagentHeaderInfo {
  const taskSeg = segment.kind === "tool" ? segment : null;
  const metaStatus = taskMetaStatusOf(segment);
  // 2026-10-13-subagent-stub-reconcile（FR-01）：对账只在「无任务元数据且段
  // 三态 running」时生效（stub 恒 running；tool 段已配对结果 ok/deny 不覆盖）
  // ——元数据 > 对账 > 段三态三级优先，既有路径零回归。
  //
  // 2026-10-13-turn-live-visibility（FR-02）：running 元数据 + 快照终态 → 单向
  // 收敛——治理 [TASK_*] 终态 stdout 行丢失导致的永久「后台运行中」残留（快照
  // 行是服务端 agent_session_task 权威）。方向单向：终态元数据不被任何快照回退
  // （终态即终），快照 running 不动摇元数据展示；收敛时不受段三态配对限制
  // （async 派发段回执配对 status=ok 而任务仍在跑，收敛看任务不看回执）。
  const terminalReconciled =
    reconciled != null && metaStatus === "running" && reconciled.status !== "running";
  const reconciledStatus =
    !terminalReconciled && reconciled && metaStatus == null &&
    (segment.kind === "subagent_stub" || segment.status === "running")
      ? reconciled.status
      : null;
  const status = terminalReconciled && reconciled
    ? reconciled.status
    : (metaStatus ?? reconciledStatus ?? subagentStatus(segment));
  const running = status === "running";
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
      ? (segment.primary?.trim() || reconciled?.taskName || segment.subagentType || "子代理")
      : (reconciled?.taskName || segment.subagentType || "子代理");
  let durationText: string | null = null;
  if (terminalReconciled) {
    // FR-02 收敛终态：服务端权威时长优先（快照 elapsedMs），段元数据 elapsedMs 兜底；
    // 两者皆缺不伪造（null 不渲染）。
    durationText =
      reconciled && reconciled.elapsedMs != null
        ? formatClockDuration(reconciled.elapsedMs)
        : taskSeg != null && taskSeg.taskElapsedMs != null
          ? formatClockDuration(taskSeg.taskElapsedMs)
          : null;
  } else if (metaStatus != null && taskSeg != null) {
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
  } else if (reconciledStatus != null) {
    // 对账路径（FR-01/02）：终态用服务端权威时长；running 占位同原推导。
    durationText =
      reconciledStatus === "running"
        ? "运行中"
        : reconciled && reconciled.elapsedMs != null
          ? formatClockDuration(reconciled.elapsedMs)
          : null;
  } else if (running) {
    durationText = "运行中";
  } else if (
    segment.kind === "tool" &&
    segment.startedAt != null &&
    segment.endedAt != null
  ) {
    durationText = formatClockDuration(segment.endedAt - segment.startedAt);
  }
  return {
    status,
    metaStatus,
    running,
    dotCls,
    name,
    subagentType: segment.subagentType ?? null,
    badge:
      terminalReconciled && reconciled
        ? TASK_STATUS_BADGE[reconciled.status]
        : metaStatus != null
          ? TASK_STATUS_BADGE[metaStatus]
          : reconciledStatus != null
            ? TASK_STATUS_BADGE[reconciledStatus]
            : null,
    durationText,
  };
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
 * 文本段：无框正文（MarkdownText 直接铺在时间线背景上；2026-09-20-agent-reply-
 * no-bubble 去气泡——原 rounded-2xl 卡片气泡容器废弃，字号行高交由 MarkdownText
 * 内部与既有 .markdown-text 规则承担）。streaming=true 时尾部流式光标（原型
 * streaming-caret：7×15px 竖条（brand 阶随主题），blink 0.9s step-end；因 MarkdownText 是
 * 块级容器，光标落在正文末段之后的新行行首，见文件头偏差说明 1）。
 */
export const TextSegmentView = memo(function TextSegmentView({ segment }: TextSegmentViewProps) {
  useSegmentAnimations();
  return (
    // task-11（FR-07）：group+relative 供 CopyButton 右下角 hover 浮出（纯 CSS 零状态）
    // 2026-09-20-agent-reply-no-bubble：去气泡——容器改无框正文（w-full +
    // 阅读限宽，铺在时间线背景上），排版交 .markdown-text 既有
    // 规则（原 ql-20260909-009 的 80% 收窄 + 描边分层形态被此取代）。
    // 2026-10-20-session-page-dsh-alignment（FR-02 / D-016②）：正文与过程字阶分离——
    // 字号/行高/段距（14.5px / 1.78 / 0.6em）
    // 由 globals.css 的 `.seg-text-body` 元素级规则承担（MarkdownText compact 的
    // !text-xs 带 !important，容器类挂 font-size 压不住它，故不在此写死字号）。
    // 2026-10-25-session-tab-visual-unify：阅读限宽统一为「整行宽度-120px」
    // （seg-width-cap，随容器自适应）——原 48rem→52rem 限宽与其它
    // agent 信息块的 86% 限宽并存导致两视图宽度不齐（用户实测反馈），agent 侧
    // 信息块全部收口同一限宽（用户侧气泡 56%/80% 不在此列）。
    <div className="seg-text-body group relative w-full seg-width-cap self-start">
      <MarkdownText content={segment.text} />
      {segment.streaming && (
        <span
          aria-hidden
          className="seg-caret ml-0.5 inline-block h-[15px] w-[7px] rounded-[1px] bg-brand-600 align-[-2px]"
        />
      )}
      <CopyButton text={segment.text} />
    </div>
  );
});

/**
 * 思考折叠行（原型 seg-thinking / deepseek ReasoningRow 风格）：折叠头部 =
 * 箭头 + 💭 思考 + 「 · 」+ 摘要（空白折叠 60 字截断，流式自动跟随段文本更新）；
 * streaming 时标题旁「思考中」脉冲标记；默认折叠（R-03 展开才挂载正文）；
 * 展开正文 MarkdownText 限高 180px 滚动。
 *
 * 2026-10-19-thinking-zh-translate / FR-01·FR-04：摘要与展开正文接入离线翻译
 * （useThinkingSummary / TranslatedThinkingBody）——流式中显示原文零请求，
 * 流结束后摘要换中文；展开正文默认译文、可一键切原文。
 *
 * D-025@v1（2026-10-20-session-page-dsh-alignment）：标题由「💭 思考过程」改为
 * 固定语义词表「💭 思考」（标签映射见 process-labels.ts，纯展示不改原文）；
 * 之后补「·」再跟摘要，形成 `icon + 中文标签 + · + 一行摘要`。
 */
export const ThinkingRowView = memo(function ThinkingRowView({ segment }: ThinkingRowViewProps) {
  const [open, setOpen] = useState(false);
  const summary = useThinkingSummary(segment.text, segment.streaming);
  const label = processLabel("thinking");
  return (
    // 2026-10-26-subagent-card-width-unify：过程行限宽统一（整行-120px，随容器
    // 自适应）——与文本段/文件段同口径，思考行不再铺满整行。
    <div className="w-full seg-width-cap">
      <button
        type="button"
        onClick={() => {
          if (hasActiveTextSelection()) return; // ql-20260825-011：拖选中不触发折叠
          setOpen(!open);
        }}
        aria-expanded={open}
        /* 2026-10-21 用户裁决「对比加强」：过程行退到正文之后——字号 12px→11.5px、
           墨色 muted 全额→muted/80（同一 token 的透明度档，三主题各自换肤）。
           正文侧同期升到 15px（globals.css .seg-text-body 规则）。 */
        className="flex w-full cursor-pointer select-text items-center gap-[7px] rounded-md px-1.5 py-[3px] text-left text-[11.5px] leading-[1.55] text-muted-foreground/80 hover:bg-muted"
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
        <span className="shrink-0 font-medium">
          <span aria-hidden className="mr-1">{label.icon}</span>
          {label.label}
        </span>
        {segment.streaming && (
          <span className="inline-flex shrink-0 items-center gap-1 text-[10.5px] text-brand-600">
            <span aria-hidden className="h-[5px] w-[5px] animate-pulse rounded-full bg-brand-600" />
            思考中
          </span>
        )}
        {!open && summary && (
          /* 摘要不再叠自己的 opacity-75：行级已降到 muted/80，两层叠加在浅色主题下
             会掉到 ~0.6 alpha（对比 <3:1，摘要不可读）。摘要只吃行级 80% 档。 */
          <>
            <span aria-hidden className="shrink-0 text-muted-foreground/60">·</span>
            <span className="min-w-0 flex-1 truncate">{summary}</span>
          </>
        )}
      </button>
      {open && (
        /* task-11（FR-07）：group+relative 外包一层挂 CopyButton（右下角 hover 浮出）——
            不能塞进滚动容器内（overflow-y-auto 会裁掉浮出按钮）；折叠态不渲染（R-03）。 */
        <div className="group relative mt-1">
          <div className="max-h-[180px] overflow-y-auto rounded-lg bg-muted px-3 py-2 text-[12px] leading-[1.55] text-muted-foreground">
            <TranslatedThinkingBody text={segment.text} streaming={segment.streaming} />
          </div>
          <CopyButton text={segment.text} />
        </div>
      )}
    </div>
  );
});

/**
 * 工具行（原型 seg-tool / deepseek ToolRow 风格）：单行摘要 = 图标 + 中文语义
 * 标签 + 「·」+ 工具名 + 主参数（truncate）+ 状态徽章（✓/✗/⏳）+ 耗时（起止均有
 * 时显示；运行中不显秒数——纯组件不读时钟，live 计时归状态条）+ 复制按钮
 * （copyText 规则平移）。status=running 时整行 seg-sweep 扫动动画（1.8s）。点击
 * 整行展开 result（MarkdownText，默认折叠，限高 200px 滚动）；运行中无 result
 * 展开显示「执行中…」占位。toolName 为空：孤儿 result 段显示「工具结果」，解析
 * 失败（R-07）主参数位置原样显示 raw。
 *
 * D-025@v1（2026-10-20-session-page-dsh-alignment）：图标与标签来自固定语义词表
 * `processLabel("tool", toolName, status)`（process-labels.ts，纯展示映射）：运行
 * 命令 / 读写文件 / 搜索 / 其它；status=deny（失败/被拒）时标签恒为「失败」。工具
 * 名仍原样渲染（brand 色、label 之后），词表外工具显示「其它」而不是隐藏。
 *
 * task-12（2026-08-22-team-session-unify FR-07）团队 MCP 工具泛化微调（原型 §03
 * tool-card）：5 团队工具（mcp__server__ 前缀或裸名）→ 👥 图标 + mcp 来源标识 +
 * 短名（剥前缀）+ 角色/目标主参数摘要；其余工具渲染零改动（语义标签除外）。
 */
export const ToolRowView = memo(function ToolRowView({ segment }: ToolRowViewProps) {
  useSegmentAnimations();
  const [open, setOpen] = useState(false);
  const running = segment.status === "running";
  const badge = TOOL_STATUS_META[segment.status];
  // D-025@v1：展示层语义标签（错误状态优先 → 「失败」）。工具名不参与改写。
  const label = processLabel("tool", segment.toolName, segment.status);
  const duration =
    segment.startedAt != null && segment.endedAt != null
      ? formatToolDuration(segment.endedAt - segment.startedAt)
      : null;
  const copyText = toolCopyText(segment.raw, segment.toolName);
  const teamTool = teamMcpToolName(segment.toolName);
  const teamSummary = teamTool ? teamToolSummaryOf(teamTool, segment.raw) : null;
  // 2026-10-13-turn-live-visibility（FR-01）：TaskOutput 运行中 = 阻塞等待后台
  // 任务——主参数不再显示 raw JSON，改人话等待摘要（任务名经快照 byTaskId 对账，
  // 未命中回退通用文案）；行尾已等时长每秒跳动（数字在走 = 连接活着）。终态
  // （result 配对）waitInfo 即空，自然回归既有渲染。
  const taskLookup = useContext(SubagentTaskLookupContext);
  const waitInfo = useMemo(
    () =>
      running && segment.toolName === "TaskOutput"
        ? parseTaskOutputWait(segment.raw)
        : null,
    [running, segment.toolName, segment.raw],
  );
  const waitedTaskName = waitInfo
    ? taskLookup?.byTaskId.get(waitInfo.taskId)?.taskName ?? null
    : null;
  // 局部走秒（仅等待形态启动，SubagentBlockView FR-06 同款渲染经济性纪律）；
  // 锚点 = 段 startedAt（TaskOutput 调用时刻），缺失不显示走秒（不伪造）。
  const [now, setNow] = useState<number>(() => Date.now());
  const waiting = waitInfo != null;
  useEffect(() => {
    if (!waiting) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [waiting]);
  const waitElapsed =
    waitInfo && segment.startedAt != null
      ? formatClockDuration(Math.max(0, now - segment.startedAt))
      : null;
  const desc = waitInfo
    ? waitedTaskName
      ? `等待后台任务：${waitedTaskName}`
      : "等待后台任务输出"
    : (teamSummary ?? segment.primary ?? (segment.raw || null));
  return (
    // 2026-10-26-subagent-card-width-unify：工具调用行限宽统一（整行-120px）——
    // 用户实证进度视图工具卡铺满整行，与 2026-10-25 宽度统一规范补齐。
    <div className="w-full seg-width-cap">
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
          // 2026-10-20-session-page-dsh-alignment（FR-03 / D-013@v1 / D-016③）：
          // 工具卡去外框——满宽描边 + brand 浅底卡（rounded-lg border bg-brand-50）
          // 换成 2px 左规线（border-l-2 + 语义 --border），底透明，左内边距 9px、
          // 行内间距 9px；hover 时左规线转 brand（语义类，三主题各自成立）。
          // 2026-10-21 用户裁决「对比加强」：过程行字阶降一档 12px→11.5px，墨色退到
          // muted/80（同一 token 的透明度档）；左规线静息态降为 border/60（更轻），
          // hover 仍转 brand——工具行在静息时不与正文抢边界，正文（15px）成为主角。
          // group 供行尾动作（复制等）默认 opacity-45 → group-hover 复原。
          "group relative flex w-full cursor-pointer select-text items-center gap-[9px] overflow-hidden border-l-2 border-border/60 py-[4px] pl-[9px] pr-1 text-[11.5px] leading-[1.55] text-muted-foreground/80 hover:border-l-brand-600",
          running && "seg-sweep",
        )}
      >
        <span aria-hidden className="shrink-0 text-xs">
          {/* 团队工具保留 👥 实体标识；失败行统一换 ⚠（词表「失败」优先）。 */}
          {teamTool && label.label !== "失败" ? "👥" : label.icon}
        </span>
        {teamTool && (
          <span
            className="shrink-0 rounded border border-brand-200 bg-brand-50 px-1 py-px text-[9.5px] font-semibold leading-none text-brand-700"
            title="团队 MCP 工具"
          >
            mcp
          </span>
        )}
        <span className="shrink-0 text-[11.5px] font-medium">{label.label}</span>
        <span aria-hidden className="shrink-0 text-muted-foreground/60">·</span>
        <span className="shrink-0 text-[11.5px] font-semibold text-brand-600">
          {teamTool ?? segment.toolName ?? (segment.raw ? "工具调用" : "工具结果")}
        </span>
        {desc && (
          <>
            <span aria-hidden className="shrink-0 text-muted-foreground/60">·</span>
            <span
              className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted-foreground/80"
              title={segment.raw || desc}
            >
              {desc}
            </span>
          </>
        )}
        <span
          className={cn("ml-auto shrink-0 font-mono text-[11px]", badge.cls)}
          title={badge.title}
          aria-label={badge.title}
        >
          {badge.icon}
        </span>
        {waitElapsed && (
          <span
            className="shrink-0 font-mono text-[10.5px] text-brand-600"
            title="等待后台任务已进行时长（每秒更新）"
          >
            {waitElapsed}
          </span>
        )}
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
              void copyTextToClipboard(copyText);
            }}
            // 2026-10-20-session-page-dsh-alignment（FR-03 / D-016③）：行尾动作
            // 默认压到 45% 透明（工具行不再满宽描边卡，动作退到背景），
            // hover 本行（容器 group）复原 100%。
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground opacity-45 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
            title="复制命令"
          >
            复制
          </button>
        )}
      </div>
      {open && (
        <div className="mt-1 max-h-[200px] overflow-y-auto rounded-lg bg-muted px-3 py-2 text-[12px] leading-[1.55] text-muted-foreground">
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
 *
 * task-01（2026-09-15-subagent-three-pane-display / FR-02 / FR-05 / D-001@v1 /
 * D-002@v1，design §5.C）：双模式——useSubagentPanel() 消费到右栏面板 context
 * （page 模式 Provider）时渲染中栏紧凑卡片：仅头部行（状态点/🤖/名称/类型标签/
 * 徽标/时长全复用，running 时 seg-sweep 保留），不内联 children、无折叠语义
 * （aria-expanded 移除）；点击头部 toggle 右栏（未激活 → openSubagent(segment.id)，
 * 已激活 → closeSubagent()），根容器带 data-segment-id 锚点 + activeId 命中
 * ring-brand-300 描边高亮。无 context（dialog 弹窗/悬浮宿主等旧消费方）走原
 * 内联展开分支，行为零回归（FR-05）。
 */
export const SubagentBlockView = memo(function SubagentBlockView({
  segment,
}: SubagentBlockViewProps) {
  useSegmentAnimations();
  // task-01：右栏面板 context——null（dialog 等旧宿主无 Provider）走下方原内联
  // 展开分支；有值（page 模式）提前 return 紧凑卡片。两分支共享全部头部派生
  //（metaStatus/durationText/dotCls/name），零复制粘贴。
  const panel = useSubagentPanel();
  // 2026-10-13-subagent-stub-reconcile：任务快照对账（tool_use_id = 段 id）——
  // 仅在「无元数据且段三态 running」时生效（与 subagentHeaderOf 同一优先级
  // 契约），历史窗口截断 stub 按快照收敛名称/徽标/时长。
  const taskLookup = useContext(SubagentTaskLookupContext);
  const reconciledRaw = taskSnapshotOfSegment(taskLookup, segment);
  const metaStatus = taskMetaStatusOf(segment);
  // 2026-10-13-turn-live-visibility（FR-02）：对账传递放开两态——原「无元数据且
  // 段三态 running」（stub-reconcile 面，段三态限制由纯函数双保险裁决）与新增
  // 「running 元数据 + 快照终态」单向收敛面（终态事件丢失治理，见 subagentHeaderOf
  // 同名注释）；终态元数据永不被快照回退。
  const reconciled: SubagentReconciledTask | null =
    reconciledRaw &&
    (metaStatus == null || (metaStatus === "running" && reconciledRaw.status !== "running"))
      ? reconciledRaw
      : null;
  // task-13：[TASK_*] 元数据优先（stub 段无元数据恒走原三态推导）；
  // FR-02 收敛：running 元数据 + 快照终态 → 快照终态（与 subagentHeaderOf 同一裁决）。
  const status =
    reconciled && metaStatus === "running" && reconciled.status !== "running"
      ? reconciled.status
      : (metaStatus ?? reconciled?.status ?? subagentStatus(segment));
  const running = status === "running";

  // task-13：后台异步运行中本地走秒（FR-06 渲染经济性对齐 subagent-catalog 模式：
  // tick 是组件局部 state，仅 async 运行中启动，终态/卸载清理）；锚点 = 段
  // startedAt（派发时刻）。
  const [now, setNow] = useState<number>(() => Date.now());
  // FR-02：收敛终态即停走秒 tick（metaStatus 仍 running 但展示已终态——tick 只
  // 服务元数据驱动的运行中走秒；前台阻塞式（无元数据）维持原不 tick 零回归）。
  const asyncRunning = metaStatus === "running" && status === "running";
  useEffect(() => {
    if (!asyncRunning) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [asyncRunning]);

  // task-03（design §5.E）：头部派生收敛到共享纯函数 subagentHeaderOf（状态点/
  // 名称/徽标/时长一处派生）——右栏 SubagentDetailPanel 头部复用同一份逻辑，
  // 防两处复制漂移；now 走上方 tick state（async 运行中走秒）；对账命中经第三
  // 参传入（纯函数内同一优先级契约再裁决一次，双保险）。
  const header = subagentHeaderOf(segment, now, reconciled);
  const { dotCls, name, durationText } = header;
  // 头部行内容子结构：状态点 / 🤖 / 名称 / 类型标签 / task-13 徽标 / 时长——
  // 紧凑卡片与纯展示两分支同源派生，避免大段 JSX 复制漂移。
  // 2026-10-25-subagent-card-unify-panel：内联展开分支（children 原地渲染 +
  // progressLine 尾行）已按用户裁决删除——卡片统一为「紧凑卡片 + 右栏/Drawer
  // 详情」，children 一律经 SubagentDetailPanel 展示。
  const headerContent = (
    <>
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
    </>
  );

  // 2026-10-25-subagent-card-unify-panel（FR-05）：卡片内嵌内部活动流动条——
  // 子代理内部过程在框内流动展示（与外部会话跑马灯同机制：只向最新推进、
  // 不循环、运行中转圈/走秒/等待指示）；children 为空不渲染。外部会话跑马灯
  // 维持容器条目（名称/状态/时间），两层分工。
  const inlineEntries = useMemo(
    () => deriveLiveMarqueeEntries(segment.children),
    [segment.children],
  );
  const inlineMarquee =
    segment.children.length > 0 ? (
      <div className="border-t border-indigo-200/60 px-3 pb-2 pt-1.5">
        <TurnLiveMarquee
          layout="inline"
          testId="subagent-live-marquee"
          entries={inlineEntries}
          // 子代理终态后不再显示「等待模型响应」（2026-10-25 修复：等待只属于
          // 仍在运行的宿主；终态条目显示总耗时）。
          active={running}
        />
      </div>
    ) : null;

  // task-01：紧凑卡片分支（page 模式有 context）——中栏只显头部行，无展开
  // body、不内联 children（详情移右栏）；头部仍是可点击 button（含 Enter/Space
  // 键盘触发），但无折叠语义（不渲染 aria-expanded）；点击 toggle 右栏
  //（未激活 → openSubagent(segment.id)，已激活 → closeSubagent()，D-002@v1 ④）；
  // 根容器 data-segment-id 供右栏/目录联动定位，activeId 命中加 brand 阶
  // ring 描边高亮。
  if (panel) {
    const active = panel.activeId === segment.id;
    const togglePanel = () => {
      if (hasActiveTextSelection()) return; // ql-20260825-011：拖选中不触发
      if (active) panel.closeSubagent();
      else panel.openSubagent(segment.id);
    };
    return (
      <div
        data-segment-id={segment.id}
        className={cn(
          // 2026-10-26-subagent-card-width-unify：子代理卡限宽统一（整行-120px，
          // self-stretch→self-start 防 flex 父容器 stretch 反噬，对齐 file 段先例）。
          "w-full seg-width-cap self-start overflow-hidden rounded-[10px] border border-indigo-200 bg-indigo-50",
          active && "ring-1 ring-brand-300",
        )}
      >
        <div
          role="button"
          tabIndex={0}
          onClick={togglePanel}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              togglePanel();
            }
          }}
          className={cn(
            "relative flex cursor-pointer select-text items-center gap-2 overflow-hidden px-3.5 py-[7px] text-xs",
            running && "seg-sweep",
          )}
        >
          {headerContent}
        </div>
        {inlineMarquee}
      </div>
    );
  }

  // 2026-10-25-subagent-card-unify-panel（FR-01）：无面板上下文（回放体/悬浮
  // 助手等无 Provider 宿主）——同款头部纯展示：不可点击、无展开语义；完整
  // 内部过程由「进度」视图或具备面板能力的宿主承载。
  return (
    // 2026-10-26-subagent-card-width-unify：无 Provider 纯展示分支同款限宽（与
    // panel 紧凑卡片分支同口径，两分支视觉一致）。
    <div className="w-full seg-width-cap self-start overflow-hidden rounded-[10px] border border-indigo-200 bg-indigo-50">
      <div
        className={cn(
          "relative flex select-text items-center gap-2 overflow-hidden px-3.5 py-[7px] text-xs",
          running && "seg-sweep",
        )}
      >
        {headerContent}
      </div>
      {inlineMarquee}
    </div>
  );
});

/**
 * stderr 警示行：⚠ 前缀 + amber 文本（样式平移现有 TurnDetailsList stderr 行，
 * 原型 --amber 语义对应）。whitespace-pre-wrap 保留原始换行。
 */
export const StderrRowView = memo(function StderrRowView({ segment }: StderrRowViewProps) {
  return (
    // 2026-10-26-subagent-card-width-unify：警告行限宽统一（原无 w-full 但在
    // flex-col 父容器被 stretch 铺满，加 max-w 收口；弹性容器无需 self-start）。
    <div className="flex seg-width-cap items-start gap-1.5 px-1 py-0.5 text-[11px] text-amber-700">
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
    <div className="flex w-full seg-width-cap flex-col gap-1 self-start">
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

/**
 * 上下文压缩续接摘要卡（ql-20260917-006）：CLI 自动 compaction 后注入的结构化
 * 摘要（"This session is being continued from a previous conversation..."）——
 * 非用户答复，此前被当回复气泡整段刷屏。「全部（进度）」视图专属（对话视图改由
 * CompactNoticeChip 显示一行短提示），**默认收起**、点击头部展开全文（展示语义
 * 平移 PreambleSegmentView：字符数提示 + 拖选不触发收起守卫）。
 */
export const CompactSegmentView = memo(function CompactSegmentView({
  segment,
}: CompactSegmentViewProps) {
  const [open, setOpen] = useState(false);
  const charCount = segment.text.length;
  return (
    <div className="flex w-full seg-width-cap flex-col gap-1 self-start">
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
        <span className="shrink-0 font-medium">上下文已重新压缩</span>
        <span className="shrink-0 opacity-75">{`（${charCount} 字，摘要已注入新窗口）`}</span>
      </button>
      {open && (
        <div className="select-text whitespace-pre-wrap rounded-lg border border-dashed border-brand-300 bg-brand-50/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
          {segment.text}
        </div>
      )}
    </div>
  );
});

/**
 * 对话视图压缩短提示（ql-20260917-006）：compact 摘要段在「对话」视图的原位
 * 替换渲染——一行弱化提示替代大段摘要气泡（全文进「全部（进度）」视图
 * CompactSegmentView 折叠卡）。独立于 SegmentView 分发（对话分支特判渲染）。
 */
export function CompactNoticeChip() {
  return (
    <div className="flex select-none items-center gap-1.5 py-0.5 text-[11px] text-muted-foreground">
      <span aria-hidden className="shrink-0">
        ⇄
      </span>
      <span>上下文已重新压缩</span>
    </div>
  );
}

/**
 * 轮触发溯源行（2026-10-22-turn-trigger-generalize：TaskWakeupNoticeView 泛化，
 * dsh turn-trigger.ts 同构）——非人类消息开启的轮在时间线头部的来源留痕。
 * 按 TURN_TRIGGER_META 配置渲染：系统代笔源（task_wakeup/auto_resume）折叠行
 * 默认收起、点击展开全文（展示语义平移 PreambleSegmentView：拖选不触发收起
 * 守卫）；来源标注源（shadow_chat/group_chat）为纯标注行（正文照常显示为
 * prompt 气泡，不可展开）。对话与进度两视图共用本组件。
 */
export const TurnTriggerView = memo(function TurnTriggerView({
  segment,
}: {
  segment: Extract<TurnSegment, { kind: "turn_trigger" }>;
}) {
  const meta = TURN_TRIGGER_META[segment.trigger];
  const [open, setOpen] = useState(false);
  // 任务数仅 task_wakeup 有意义（防漏报模板每任务一行）；解析失败兜底 1。
  const taskCount =
    segment.trigger === "task_wakeup"
      ? (segment.text.match(/^- 任务「/gm) ?? []).length || 1
      : null;
  if (!meta.contentHidden) {
    // 来源标注源：纯行，无展开（正文在 prompt 气泡照常可见）。
    return (
      <div className="flex w-full seg-width-cap flex-col gap-1 self-start">
        <span
          aria-label={`${meta.label}（来源标注）`}
          className="flex w-fit select-text items-center gap-[7px] rounded-md px-1.5 py-[3px] text-[11px] text-muted-foreground"
        >
          <span aria-hidden className="shrink-0">
            {meta.glyph}
          </span>
          <span className="shrink-0 font-medium">{meta.label}</span>
        </span>
      </div>
    );
  }
  return (
    <div className="flex w-full seg-width-cap flex-col gap-1 self-start">
      <button
        type="button"
        onClick={() => {
          if (hasActiveTextSelection()) return;
          setOpen(!open);
        }}
        aria-expanded={open}
        className="flex w-fit cursor-pointer select-text items-center gap-[7px] rounded-md px-1.5 py-[3px] text-left text-[11px] text-muted-foreground hover:bg-muted"
      >
        <span aria-hidden className="shrink-0">
          {meta.glyph}
        </span>
        <span className="shrink-0 font-medium">{meta.label}</span>
        <span className="shrink-0 opacity-75">
          {segment.trigger === "task_wakeup"
            ? `（${taskCount} 个后台任务已结束）`
            : `（系统已恢复会话上下文）`}
        </span>
        <span
          aria-hidden
          className={cn(
            "shrink-0 text-[9px] transition-transform duration-150",
            open && "rotate-90",
          )}
        >
          ▶
        </span>
      </button>
      {open && (
        <div className="select-text whitespace-pre-wrap rounded-lg border border-dashed border-brand-300 bg-brand-50/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
          {segment.text}
        </div>
      )}
    </div>
  );
});

/**
 * 压缩过程状态行（ql-20260917-006）：daemon [COMPACT_STATUS] 协议行的渲染——
 * phase=compacting 显示「上下文正在重新压缩…」（运行中轮的实时提示，用户要求的
 * 「压缩过程中回显」）；failed 显示 amber 失败行（压缩失败时续接摘要不会到达，
 * 这是唯一可见信号）；success 返回 null（紧随的 compact 摘要段已是「已重新压缩」
 * 标记，避免双提示）。坏 JSON 容错按 compacting 处理（宁可多显示一行进行中提示
 * 也不吞失败信号）。
 */
export const CompactStatusRowView = memo(function CompactStatusRowView({
  segment,
}: CompactStatusRowViewProps) {
  let phase = "compacting";
  let error: string | undefined;
  try {
    const parsed = JSON.parse(segment.text) as { phase?: unknown; error?: unknown };
    if (parsed.phase === "success" || parsed.phase === "failed") phase = parsed.phase;
    if (typeof parsed.error === "string" && parsed.error) error = parsed.error;
  } catch {
    // 坏 JSON：保持 compacting 默认展示（容错不抛错）。
  }
  if (phase === "success") return null;
  if (phase === "failed") {
    return (
      <div className="flex items-start gap-1.5 px-1 py-0.5 text-[11px] text-amber-700">
        <span aria-hidden className="shrink-0">
          ⚠
        </span>
        <span className="min-w-0 whitespace-pre-wrap break-words">
          上下文压缩失败{error ? `：${error}` : ""}
        </span>
      </div>
    );
  }
  return (
    <div className="flex select-none items-center gap-1.5 px-1 py-0.5 text-[11px] text-muted-foreground">
      <span
        aria-hidden
        className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-[1.5px] border-muted-foreground/30 border-t-muted-foreground"
      />
      <span>上下文正在重新压缩…</span>
    </div>
  );
});

/**
 * 模型 API 重试过程行（2026-10-28-model-retry-visible）：daemon [MODEL_RETRY]
 * 协议行的渲染——载荷 attempt/max_retries 显示「模型限流重试中 第N/M次」+
 * 错误摘要（title 悬停看全文）；error_status=null（连接类）显示「连接异常重试中」
 * 口径；坏 JSON / 字段缺失退中性「模型重试中…」（容错不抛错，FR-02 场景三）。
 * 对话视图仅运行中轮挂载（turn-timeline textSegments 过滤门控）；「全部（进度）」
 * 视图保留过程行。
 */
export const ModelRetryRowView = memo(function ModelRetryRowView({
  segment,
}: ModelRetryRowViewProps) {
  let attempt: number | null = null;
  let maxRetries: number | null = null;
  let errorStatus: number | null | undefined;
  let error: string | undefined;
  let parseFailed = false;
  try {
    const parsed = JSON.parse(segment.text) as {
      attempt?: unknown;
      max_retries?: unknown;
      error_status?: unknown;
      error?: unknown;
    };
    if (typeof parsed.attempt === "number" && Number.isFinite(parsed.attempt)) {
      attempt = parsed.attempt;
    }
    if (
      typeof parsed.max_retries === "number" &&
      Number.isFinite(parsed.max_retries)
    ) {
      maxRetries = parsed.max_retries;
    }
    if (parsed.error_status === null || typeof parsed.error_status === "number") {
      errorStatus = parsed.error_status;
    }
    if (typeof parsed.error === "string" && parsed.error) error = parsed.error;
  } catch {
    parseFailed = true;
  }
  const countText =
    attempt != null && maxRetries != null
      ? ` 第${attempt}/${maxRetries}次`
      : attempt != null
        ? ` 第${attempt}次`
        : "";
  const summary = error ? summaryOf(error, 80) : undefined;
  return (
    <div
      data-testid="model-retry-row"
      className="flex select-none items-center gap-1.5 px-1 py-0.5 text-[11px] text-muted-foreground"
      title={error || undefined}
    >
      <span
        aria-hidden
        className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-[1.5px] border-muted-foreground/30 border-t-muted-foreground"
      />
      <span className="min-w-0">
        {parseFailed
          ? "模型重试中…"
          : errorStatus === null
            ? `模型连接异常重试中${countText}…`
            : `模型限流重试中${countText}…`}
        {summary ? (
          <span className="ml-1 text-muted-foreground/70">（{summary}）</span>
        ) : null}
      </span>
    </div>
  );
});

/* ────────────── 轮内用户消息段（ql-20260920-006 / 2026-09-18-single-chat-steering 修订） ────────────── */

/**
 * 轮内用户消息段渲染：mid-turn 引导注入的 user_input 留痕——右对齐用户气泡，
 * 随段序（实时追加 / 回放按 ts 插入）停在轮内真实时间位置（输出之间），不再
 * 前移到轮次 prompt 也不垫在时间线末尾。三态视觉平移自原 streamFooter 版
 * SteeredMessagesFooter（session-panel-page.tsx 留档类名），气泡 token 与既有
 * 用户气泡一致（bg-primary / brand 语义阶）：
 *   - steering：虚线 brand 气泡 + 脉冲点 +「引导中 · 本轮工具间隙投递」；
 *   - delivered：bg-primary 气泡 + emerald「✓ 已投递」小标；
 *   - ended：弱化气泡（opacity-70）+「本轮已结束，消息未投递」（R-04 如实暴露）。
 * data-steered-msg={phase} 供测试断言（自旧 footer 迁移）。文本经
 * parseAttachmentMarkers 剥附件标记行（同 prompt 气泡展示口径）。
 */
export const UserMsgSegmentView = memo(function UserMsgSegmentView({
  segment,
}: UserMsgSegmentViewProps) {
  const text = parseAttachmentMarkers(segment.text).text;
  return (
    <div
      data-steered-msg={segment.phase}
      className="flex items-end justify-end gap-1.5"
    >
      <div className="max-w-[80%]">
        {segment.phase === "steering" ? (
          <>
            <div className="turn-bubble whitespace-pre-wrap break-words rounded-2xl rounded-br-md border-2 border-dashed border-brand-400 bg-brand-50 px-4 py-2.5 text-sm leading-6 text-foreground">
              {/* task-06：引导段正文行内引用标签化（与主气泡同口径）。 */}
              <InlineAttRefTextWithPreview text={text} />
            </div>
            <p className="mt-1 flex items-center justify-end gap-1.5 text-[11px] font-medium text-brand-600">
              <span
                aria-hidden
                className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500"
              />
              引导中 · 本轮工具间隙投递
            </p>
          </>
        ) : segment.phase === "delivered" ? (
          <>
            <div className="turn-bubble whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-6 text-primary-foreground shadow-primary">
              {/* task-06：引导段正文行内引用标签化（蓝色主气泡内用 onPrimary 色调）。 */}
              <InlineAttRefTextWithPreview text={text} tone="onPrimary" />
            </div>
            <p className="mt-1 text-right text-[11px] text-emerald-600">
              ✓ 已投递，agent 已收到引导
            </p>
          </>
        ) : (
          <>
            <div className="turn-bubble whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-border bg-muted/50 px-4 py-2.5 text-sm leading-6 text-muted-foreground opacity-70">
              {/* task-06：引导段正文行内引用标签化（与主气泡同口径）。 */}
              <InlineAttRefTextWithPreview text={text} />
            </div>
            <p className="mt-1 text-right text-[11px] text-muted-foreground">
              本轮已结束，消息未投递
            </p>
          </>
        )}
      </div>
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
    // 2026-10-26-subagent-card-width-unify：团队分身卡限宽统一（与子代理卡同口径）。
    <div className="w-full seg-width-cap self-start overflow-hidden rounded-[10px] border border-brand-200 bg-brand-50">
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

/* ────────────── 轮头分叉入口（2026-09-22-session-fork-continuation task-07 / FR-01 / FR-04） ────────────── */

/** caps sessionFork 三档（@/lib/provider-caps 单源派生，勿手抄字面量）。 */
export type SessionForkTier = ProviderCaps["sessionFork"];

/** 轮头「⑂ 从此分叉」入口 props（纯展示零请求；挂载接线归 task-08）。 */
export interface TurnForkEntryProps {
  /** 会话引擎 provider（经 getProviderCaps 查 sessionFork 档位，单一数据源）。 */
  provider: string;
  /**
   * 该轮 run 状态（turn-timeline TurnUiStatus 字面量）。进行中三态
   * （pending/running/interrupting）置灰——对齐 backend fork 409 口径
   * （ACTIVE_RUN_STATUSES=pending/running/pending_approval，interrupting
   * 映射自 running，本质同属未终态）。
   */
  runStatus: string;
  /**
   * 该轮引擎锚点（AgentRun.engine_anchor，经 runs 快照注入——挂载方数据源）。
   * native 档缺失（null/undefined/空串）置灰「该轮缺少引擎锚点」（存量轮
   * 不回填，D-011 故障面：入口灰即降级面，不炸链路）；seed 档种子路径不
   * 消费锚点，不受此门控。
   */
  engineAnchor?: string | null;
  /** 点击回调（上抛挂载方开确认弹层；置灰态不触发）。 */
  onFork: () => void;
}

/**
 * 轮头动作区「⑂ 从此分叉」入口（design Wave3 第 1 点 / FR-01，原型
 * prototype-session-fork.html .turn-head .fork-btn）——三重门控纯展示组件：
 *
 *   1. caps 门控：provider sessionFork='none'（cursor / 未知引擎）不渲染；
 *   2. 终态门控：该轮 run 进行中（pending/running/interrupting）置灰
 *      「⑂ 进行中不可分叉」（FR-01 场景：进行中轮不可选）；
 *   3. 锚点门控：native 档且该轮 engine_anchor 缺失置灰「⑂ 该轮缺少引擎
 *      锚点」（tooltip 明示可退种子档，对齐 backend 422 文案语义；seed 档
 *      不受锚点门控）。
 *
 * 交互形态对齐原型：常驻隐藏、父容器（需带 `group` 类，挂载方负责）hover
 * 或自身 focus 浮出（同 CopyButton 的 opacity 纯 CSS 零状态方案，保键盘可
 * 达——display:none 方案键盘不可聚焦）；置灰态 hover 同样浮出，颜色降为
 * muted 阶 + cursor-not-allowed。样式全走 brand 与 muted 语义阶及主题 token
 * （双主题铁律，不硬编码 hex）。
 */
export const TurnForkEntry = memo(function TurnForkEntry({
  provider,
  runStatus,
  engineAnchor,
  onFork,
}: TurnForkEntryProps) {
  // 门控一：caps=none 不渲染（getProviderCaps 对未知 provider 回退拒绝对象，
  // 其 sessionFork='none'——未知引擎天然无入口，R-09）。
  const tier = getProviderCaps(provider).sessionFork;
  if (tier === "none") return null;
  // 门控二：run 进行中置灰（见 props.runStatus 注释的三活态口径）。
  const live =
    runStatus === "pending" ||
    runStatus === "running" ||
    runStatus === "interrupting";
  // 门控三：native 档锚点缺失置灰（seed 档不受锚点门控）。
  const anchorMissing = tier === "native" && !engineAnchor;
  const disabled = live || anchorMissing;
  const label = live
    ? "⑂ 进行中不可分叉"
    : anchorMissing
      ? "⑂ 该轮缺少引擎锚点"
      : "⑂ 从此分叉";
  const title = live
    ? "进行中的轮不可作为分叉点，请等该轮结束后再分叉"
    : anchorMissing
      ? "该轮缺少引擎锚点，无法原生分叉；可改用种子档（前情转述）"
      : "在此轮之后创建分叉会话";
  return (
    <button
      type="button"
      data-testid="turn-fork-entry"
      data-fork-tier={tier}
      disabled={disabled}
      onClick={() => {
        // disabled 守卫双保险：原生 disabled 已拦截真实浏览器点击；jsdom 的
        // fireEvent.click 会穿透 disabled 派发事件，此处兜底防误触发。
        if (!disabled) onFork();
      }}
      title={title}
      className={cn(
        "ml-auto shrink-0 rounded-md border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
        // 常驻隐藏：父容器 group hover / 自身 focus 浮出（纯 CSS 零状态）。
        "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        disabled
          ? "cursor-not-allowed border-border bg-muted text-muted-foreground/70"
          : "cursor-pointer border-brand-200 bg-card text-brand-600 hover:bg-brand-50",
      )}
    >
      {label}
    </button>
  );
});

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
    case "compact":
      // ql-20260917-006：压缩续接摘要——「全部（进度）」视图折叠卡（默认收起，
      // 点击展开全文）；对话视图不进 SegmentView（isConversationSegment 含
      // compact，由 turn-timeline 特判渲染 CompactNoticeChip 短提示）。
      return <CompactSegmentView segment={segment} />;
    case "compact_status":
      // ql-20260917-006：压缩过程状态行——compacting 实时提示 / failed 警示 /
      // success 静默（compact 摘要段已是完成标记）。
      return <CompactStatusRowView segment={segment} />;
    case "model_retry":
      // 2026-10-28-model-retry-visible：模型重试过程行——「模型限流重试中
      // 第N/M次」实时提示（对话视图仅运行中轮挂载，timeline 过滤门控；
      // 「全部」视图保留过程行）。
      return <ModelRetryRowView segment={segment} />;
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
        <div className="flex w-full seg-width-cap flex-col gap-1 self-start">
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
    case "user_msg":
      // ql-20260920-006（2026-09-18-single-chat-steering 修订）：轮内引导留痕段——
      // 三态气泡（steering 引导中 / delivered 已投递 / ended 未投递），data-steered-msg
      // 供测试断言；自旧 SteeredMessagesFooter 迁移，正文经 parseAttachmentMarkers
      // 剥附件标记行（同 prompt 气泡展示口径）。
      return <UserMsgSegmentView segment={segment} />;
    case "turn_trigger":
      // 2026-10-22-turn-trigger-generalize：轮触发溯源行（按 trigger 配置渲染
      // ——系统代笔折叠/来源标注两形态），对话/进度两视图共用。
      return <TurnTriggerView segment={segment} />;
    case "request_header":
      // 2026-10-25-trajectory-source-model（D-011）：配置面请求头快照段——会话级
      // 序列数据，仅轨迹视图消费（TrajectoryPane 全轮扫描）；轮块流不渲染。
      return null;
    default: {
      // 穷尽防御：TurnSegment 新增 kind 时此处编译期报错（never 不兼容）。
      const exhaustive: never = segment;
      void exhaustive;
      return null;
    }
  }
});

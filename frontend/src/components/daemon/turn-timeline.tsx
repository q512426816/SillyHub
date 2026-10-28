"use client";

/**
 * task-13（2026-08-14-sessions-portal / FR-05 / D-002@v1）：会话消息流共享子组件。
 *
 * 从 interactive-session-panel.tsx 纯机械抽取（弹窗零回归，NG-04/D-002）：
 *   - 轮次时间线渲染（用户气泡 / 过程项 / agent 答复 / 错误项 / 状态徽章）
 *   - 错误横幅 + AskUserQuestion 待答卡 + 空态
 *   - 自动滚动到底部
 *
 * 「对话/进度/轨迹」三态视图由 viewMode 控制（ql-20260729-005 建两态；
 * 2026-10-22-session-trajectory-third-view / D-001 上移轨迹为第三视图）；
 * AskUser 提问记录按 run_id 穿插到对应 turn（ql-20260802-001/003）。本组件无
 * 弹窗上下文依赖，/runtimes 弹窗与 /sessions 新页面均可独立 import 组装。
 *
 * task-06（2026-08-19-session-stream-ux / FR-01 / FR-02 / FR-06 / design §5 Phase2
 * + §9.3）：渲染层 v2 段模型双路径——
 *   - turn.segments 非 undefined → v2 路径（SegmentedTurnBody）：「对话」视图渲染
 *     文本段与文件段（文件卡片是面向用户的交付物，agent-file-upload-mcp FR-01；
 *     每段独立气泡）+ 运行中 TurnStatusBar（内置，Grill X-09 两消费方自动
 *     获得）；「全部（进度语义）」视图渲染完整段时间线（ml-9 竖线容器 + SegmentView
 *     段组件族），AskUser 记录按 ts 与段合并排序穿插（merged 逻辑平移）；
 *   - turn.segments === undefined（孤儿 turn 构造 / 旧数据）→ 旧渲染路径回退：
 *     output 单气泡 + processItems TurnDetailsList（§9.3 过渡期双路径，保留不删）；
 *   - whoLine / sender / errorDetail / 孤儿 turn 紧凑标记 / 轮次分隔 / 空态 /
 *     滚动到底等现有特性两路径共享不动。
 *
 * task-13（2026-08-20-frontend-ai-native-style / FR-05 / D-004@v1）：会话页 AI
 * 原生观感细节，仅表现层——whoLine 改 .sh-ctx-chip 引用 chip、ThinkingPlaceholder
 * 三点改 .sh-typing-dots、旧路径 output 气泡运行中尾挂 .sh-stream-caret 流式光标
 * （utility 与 reduced-motion 降级均在 globals.css；v2 路径流式光标由
 * TextSegmentView 的 .seg-caret 承担，双路径语义一致）。数据逻辑 / SSE 零改动。
 *
 * task-07（2026-09-09-askuser-pi-cursor / FR-03 / D-003@v2）：cursor marker 型
 * 提问卡文本段接入（双路径）——旧路径 turn.output 气泡与 v2 SegmentedTurnBody
 * 对话视图 text 段均先过 parseAskUserMarker，命中则正文换 textBefore（标记原文
 * 不显示，标记随文本原样持久化——标记即数据）并原位渲染 AskUserMarkerCard；
 * 解析返回 null 按普通文本渲染零变化。已答态 best-effort：marker 轮之后已存在
 * 用户消息（displayTurns 本地判定，无后端状态）。提交经既有 onResend 发送链路
 * 作下一条用户消息（cursor --resume 续轮天然生效）。
 *
 * task-08（2026-09-22-session-fork-continuation / FR-01 / FR-04）：轮级
 * 「⑂ 从此分叉」入口（TurnForkEntry，task-07 产出）可选接线——forkEntry prop
 * （provider / engineAnchors / onForkTurn）经 per-row 基元派生进 memo 行；对话
 * 视图挂轮尾 RoundDivider 行、全部视图挂状态徽章行（行容器带 group 供 hover
 * 浮出）。缺省不渲染（未接线消费方零回归）。
 */

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowRight, BookUser, Bot, Cloud, Settings, Wrench } from "lucide-react";
import { Badge, Skeleton } from "antd";

// task-07（2026-09-09-askuser-pi-cursor / FR-03）：cursor marker 型提问卡 +
// 标记解析器（文本段命中处原位渲染卡并隐藏标记原文）。
// （2026-10-22-askuser-dock-inputbar：pending 待答卡 AskUserDialogCard 已迁
//  PendingDialogDock，本组件仅保留历史 marker 卡。）
import { AskUserMarkerCard } from "@/components/ask-user-marker-card";
import { parseAskUserMarker } from "@/lib/askuser-marker";
import { RunErrorItem } from "@/components/agent-log/run-error-item";
import { formatScheduledTime } from "@/components/daemon/scheduled-messages-bar";
import type { ErrorLogItem } from "@/components/agent-log/normalize";
import type { TurnSegment } from "@/components/daemon/session-log-assembler";
// 2026-10-22-session-trajectory-view（D-035）：第三视图「轨迹」——三泳道时间轴由当前
// 轮视图派生（零网络请求、零后端改动），复用 dev 路由同一套 TrajectoryView。
import { trajectoryFromTurnViews } from "@/components/daemon/trajectory/from-turn-views";
import { TrajectoryView } from "@/components/daemon/trajectory/trajectory-view";
import type { TurnTimingSnapshot } from "@/components/daemon/trajectory/build-trajectory";
import {
  CompactNoticeChip,
  CompactStatusRowView,
  SegmentView,
  TurnTriggerView,
  TextSegmentView,
  TurnForkEntry,
} from "@/components/daemon/turn-segment-views";
// 2026-09-09-sessions-visual-refresh task-05/06（D-003@v1）：消息角色化共享构件
import { ChatMessageAvatar, RoundDivider } from "@/components/chat";
import { TurnStatusBar } from "@/components/daemon/turn-status-bar";
// 2026-10-26-session-stage-progress（FR-04）：currentPhase 类型（turn-state 单源）。
import type { TurnPhaseState } from "@/components/daemon/session-panel/turn-state";
import {
  TurnLiveMarquee,
  deriveLiveMarqueeEntries,
} from "@/components/daemon/turn-live-marquee";
// agent-file-upload-mcp：历史回放过程项渲染 agent 上传文件卡片（TurnDetailsList）
import { FileMessageCard } from "@/components/daemon/file-message-card";
// 2026-08-20-session-multimodal-attachments task-13（D-3）：历史附件标记行解析
// + 图片缩略图/文件 chip 渲染。
import { parseAttachmentMarkers } from "@/components/daemon/runtime-session-helpers";
import { formatRefsForPlainText } from "@/lib/attachment-refs";
import { turnTokenSpeedText } from "@/components/daemon/turn-speed";
import {
  foldHeaderText,
  isTurnFoldable,
  textOnlySegments,
  type DetailLevel,
} from "@/components/daemon/turn-fold";
// task-11（2026-10-20-session-page-dsh-alignment / FR-14 / FR-16 / D-023@v1）：
// 轮级文件变更卡与会话级汇总。数据全部由 props 注入（轮视图的 fileChanges /
// fileChangesCapability，由挂载方从 /runs 读模型透传），本组件零 fetch。
import {
  FileChangesCard,
  type FileChangeStatus,
  type FileChangesCapability,
} from "@/components/daemon/file-changes/file-changes-card";
import { FileChangesSummary } from "@/components/daemon/file-changes/file-changes-summary";
import {
  toFileChangesCardProps,
  type TurnFileChangesSnapshot,
} from "@/components/daemon/file-changes/turn-file-changes";
// 2026-10-23-turn-file-diff-dialog：文件行点击 → 本轮变更内容弹窗（自取数组件，
// 仅 sessionId 接线的挂载面渲染；旧消费方不传 prop 零回归）。
import { TurnFileDiffDialog } from "@/components/daemon/file-changes/turn-file-diff-dialog";
import { InlineAttRefTextWithPreview } from "@/components/daemon/attachment-ref-tag";
// task-10（2026-09-10-account-avatar-upload / FR-05）：自己（sender.me）的气泡
// 头像取 useSession user.avatar（选择器订阅仅 avatar 切片）。
import { useSession } from "@/stores/session";

/* ── ql-20260903-025：prompt 附件标记解析缓存——流式期间每次渲染对每一轮
 *    prompt 逐行正则拆分重复计算，按内容字符串缓存（FIFO 上限防泄漏）。 ── */
const PARSED_MARKER_CACHE = new Map<
  string,
  ReturnType<typeof parseAttachmentMarkers>
>();
const PARSED_MARKER_CACHE_MAX = 500;

function parseAttachmentMarkersCached(prompt: string) {
  let hit = PARSED_MARKER_CACHE.get(prompt);
  if (!hit) {
    hit = parseAttachmentMarkers(prompt);
    if (PARSED_MARKER_CACHE.size >= PARSED_MARKER_CACHE_MAX) {
      const oldest = PARSED_MARKER_CACHE.keys().next().value;
      if (oldest !== undefined) PARSED_MARKER_CACHE.delete(oldest);
    }
    PARSED_MARKER_CACHE.set(prompt, hit);
  }
  return hit;
}
import { AttachmentChips } from "@/components/daemon/attachment-chips";
import { CopyButton } from "@/components/daemon/copy-button";

/* ── task-07（2026-09-09-askuser-pi-cursor）：askuser 标记解析缓存——同上方
 *    附件标记缓存哲学（ql-20260903-025），流式期间每次渲染对 output/text 段
 *    重复尾部 8KB 窗口扫描 + JSON.parse，按内容字符串缓存（FIFO 上限防泄漏）。
 *    注意解析结果可为 null（多数普通文本），须用 has() 区分「已缓存 null」与
 *    「未缓存」（parseAttachmentMarkers 恒非 null 无此问题，这里不能照抄 !hit）。 ── */
const ASKUSER_MARKER_CACHE = new Map<
  string,
  ReturnType<typeof parseAskUserMarker>
>();
const ASKUSER_MARKER_CACHE_MAX = 500;

function parseAskUserMarkerCached(text: string) {
  let hit: ReturnType<typeof parseAskUserMarker>;
  if (ASKUSER_MARKER_CACHE.has(text)) {
    hit = ASKUSER_MARKER_CACHE.get(text)!;
    return hit;
  }
  hit = parseAskUserMarker(text);
  if (ASKUSER_MARKER_CACHE.size >= ASKUSER_MARKER_CACHE_MAX) {
    const oldest = ASKUSER_MARKER_CACHE.keys().next().value;
    if (oldest !== undefined) ASKUSER_MARKER_CACHE.delete(oldest);
  }
  ASKUSER_MARKER_CACHE.set(text, hit);
  return hit;
}

/** ql-20260817-003：轮次发送时间格式化（今天只显 HH:mm，跨天带 MM-DD HH:mm）。 */
function formatTurnTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay ? hm : `${p(d.getMonth() + 1)}-${p(d.getDate())} ${hm}`;
}

/**
 * quick-3c85b05e（2026-09-15 轮次时间三段显示）：带秒时刻格式化——今天
 * HH:MM:SS，跨天 MM-DD HH:MM:SS（开始/结束时间精度到秒，与 formatTurnTime 的
 * 分钟粒度区分用途）。
 */
function formatTurnTimeSec(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  const hms = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay ? hms : `${p(d.getMonth() + 1)}-${p(d.getDate())} ${hms}`;
}

/** quick-3c85b05e：轮次持续时间 mm:ss（分钟可 >59，格式同子代理块时长）。 */
function formatTurnDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(total / 60))}:${p(total % 60)}`;
}
import { ErrorBoundary } from "@/components/error-boundary";
import { MarkdownText } from "@/components/ui/markdown-text";
import {
  TranslatedThinkingBody,
  useThinkingSummary,
} from "@/components/thinking-translate";
import type { SessionDialogRead } from "@/lib/daemon";
import { cn } from "@/lib/utils";
import { extractDialogQA } from "@/components/daemon/session-log-sanitize";
import { copyTextToClipboard } from "@/lib/clipboard";

/**
 * ql-20260730-003：一个回合内按真实到达顺序排列的过程项。
 * 思考/工具/stderr 混在同一有序序列，渲染时连续 thinking 合并成一整段（被工具/stderr
 * 打断则分段、工具卡片穿插其间），保留 agent 真实执行时序——不一股脑合并丢顺序。
 * - thinking：[THINKING] 片段（可能多段，连续的才合并）
 * - tool：工具调用事件（含配对 result + 状态；raw 空串=孤儿 result 无配对 use）
 * - stderr：channel=stderr 的错误/告警文本
 */
/** 2026-09-12-chat-turn-auto-recovery：自动恢复条目（失败卡双信号推导用）。 */
export interface AutoResumeEntry {
  /** origin 复合值（'auto_resume:<源 run uuid>'）。 */
  origin: string;
  /** 条目面：queued=排队重放/nudge；scheduled=定时续跑（quota）。 */
  kind: "queued" | "scheduled";
  /** 定时面计划时间（queued 为 null/undefined）。 */
  dispatchAt?: string | null;
}

export type SessionProcessItem =
  | { kind: "thinking"; text: string; ts?: number }
  | ({ kind: "tool" } & SessionToolEvent & { ts?: number })
  | { kind: "stderr"; text: string; ts?: number }
  // agent-file-upload-mcp：历史回放投影的文件卡片项（TurnDetailsList 渲染 FileMessageCard）
  | {
      kind: "file";
      fileId: string;
      name: string;
      size: number;
      mime: string;
      description?: string | null;
      ts?: number;
    }
  /**
   * 2026-09-19-tool-report-session-replay（FR-02 / D-003 / Grill 交叉点 1）：
   * 系统注入类伪用户消息（task-notification / system-reminder）归一出的中性
   * 系统事件行（sender=system_event）。**仅回放数据路径产生**（agent-log-turns
   * 适配器投影），实时会话数据路径零产生；「全部」视图 TurnDetailsList 渲染为
   * 居中虚线中性行，与 thinking 同待遇——「对话」视图不渲染过程项。
   */
  | { kind: "system_event"; text: string; ts?: number };

export type SessionUiStatus = "idle" | "creating" | "active" | "ending" | "ended" | "failed" | "reconnecting";
export type TurnUiStatus = "pending" | "running" | "interrupting" | "completed" | "failed" | "killed";

/**
 * ql-20260730-001：agent 回合内的工具调用事件（折叠卡片用）。
 * - raw：[TOOL_USE] 内容（命令/args，已剥前缀；空串=孤儿 result 无配对 use）
 * - result：配对的 [TOOL_RESULT] 内容（已剥前缀，可能缺失=进行中）
 * - status：running（未配对 result）/ ok（成功）/ deny（被拒/失败）
 */
export interface SessionToolEvent {
  raw: string;
  result?: string;
  status: "running" | "ok" | "deny";
}

/**
 * task-01（2026-10-14-session-turn-preview-cards / FR-01）：未加载轮预览摘要
 * （preview-merge.ts 归并产物，TurnRow 前置分支渲染 TurnPreviewCard）。可选
 * 字段缺省零回归——真实轮不带此字段，渲染行为不变。
 */
export interface TurnPreviewInfo {
  /** 大纲提问摘要（后端截 60 字；缺省不渲染该行）。 */
  promptSummary?: string;
  /** 大纲答复摘要（缺省不渲染该行）。 */
  answerSummary?: string;
  /** 轮起始时间 ISO（started_at 兜底 created_at；卡片时间显示源）。 */
  startedAt?: string | null;
}

export interface SessionTurnView {
  runId: string;
  turn: number | null;
  prompt: string;
  output: string;
  status: TurnUiStatus;
  seenLogIds: Set<string>;
  /**
   * task-01（2026-10-14-session-turn-preview-cards）：非空即预览条目（mergePreviewIntoDisplayTurns
   * 产物；prompt/output 恒空串），TurnRow 渲染 TurnPreviewCard 取代完整轮块。
   * 真实轮不带（undefined），既有渲染路径零影响。
   */
  preview?: TurnPreviewInfo;
  /**
   * ql-20260621：实时累积 token。由 SSE `tokens` 事件（执行中）与
   * `turn_completed` 事件（终态）写入；null 表示尚未收到。
   */
  inputTokens: number | null;
  outputTokens: number | null;
  /**
   * 2026-08-27-session-token-usage-fix task-08 / FR-01：该轮期间最近一次 API
   * 调用的提示词大小（daemon ctx_tokens = input+cache_read+cache_creation，
   * 含缓存命中部分）。由 SSE tokens/turn_completed 事件与 runsMeta 回填写入；
   * null / 缺省 = 未知（历史会话 / 旧 daemon 不上报）。仅上下文环分子消费
   * （session-panel usedTokens 逆序取最新非 null 值），每轮徽标仍是本轮计费量
   * 渲染、不读此字段（D-004）。
   */
  ctxTokens?: number | null;
  /**
   * 2026-10-10-session-turn-token-speed：轮内模型 API 调用总时长 ms
   * （AgentRun.duration_api_ms，经 turn_completed 事件 / runs 快照回填写入）。
   * 与 outputTokens 组成 tok/s 生成速度（turnTokenSpeedText），不含工具执行
   * 时间。null / 缺省 = 未知（运行中 / 旧数据 / 无时长引擎）——轮尾不显示
   * 速度段，不伪造。可选：外部构造的历史 turn（logsToTurns 等旧形状）不带。
   */
  apiDurationMs?: number | null;
  /**
   * 2026-10-22-session-trajectory-view（D-035）：该轮 daemon TTFT/attempt 采样
   * （`GET /sessions/{id}/runs` 的 `timing`，由 page-helpers 从 run 快照透传）。
   * 有 attempts → 轨迹「模型」泳道按真实占用区间出条（`modelBasis="observed"`）；
   * null/缺省（老 daemon / 无采样 / 运行中）→ 保持近似空档并标「近似」。
   */
  timing?: TurnTimingSnapshot | null;
  /**
   * 2026-10-26-session-stage-progress（FR-04 / D-013①③）：当前阶段（turn_phase
   * 事件写入，applyTurnPhase last-write-wins；轮终态 clearTurnPhase 清空）。
   * 挂轮状态（非组件局部 state）——面板重挂载不丢失（Review Focus #3）。
   * 缺省/undefined = 无 phase 信号（老 daemon / 断线 / 已清理）→ 状态条走现状
   * 渲染路径（零回归，D-010）。
   */
  currentPhase?: TurnPhaseState | null;
  /**
   * 2026-07-29-model-error-visibility / FR-04：turn 终态=failed 时拉取的结构化错误
   * 详情（GET /sessions/{id}/runs 的 error_detail 经 buildErrorLogItem 映射）。
   * null/undefined（成功 turn / brownfield / attach 历史 turn）→ 不渲染 RunErrorItem。
   * 可选：外部 logsToTurns 构造的历史 turn 不带此字段（只读 import，不改其构造）。
   */
  errorDetail?: ErrorLogItem | null;

  /** （timeline 内部用）轮终结构化错误（含 reset_at 扩展）。 */
  /**
   * 2026-09-10-auto-resume-interrupted-turn：自动续跑轮标记（源 run id，取
   * run.metadata.auto_resume_of）——非空时轮次行渲染「自动续跑」徽标；缺省
   * undefined = 普通轮（enrichDisplayTurns 回填，实时轮不填）。
   */
  autoResumeOf?: string | null;
  /**
   * ql-20260730-003：回合过程项（思考/工具/stderr/文件），按真实到达顺序累积。
   * 「对话」视图渲染 prompt + output（答复正文）+ file 过程项（agent 上传文件卡片，
   * agent-file-upload-mcp FR-01 交付物）；切「全部」后在答复气泡前按序渲染——连续
   * thinking 合并成一整段、被工具/stderr 打断则分段（保留时序）。
   * 可选：外部构造的历史 turn（logsToTurns 已填充）。
   */
  processItems?: SessionProcessItem[];
  /**
   * ql-20260802-001：真实 agent_run_id（attach 历史 turn 用）。logsToTurns 按 log.run_id
   * 分组但 turn.runId 用伪 id（__attach_history_N__）作 React key；realRunId 保留真实
   * run_id，供 AskUser 提问历史按 run_id 穿插到对应 turn（跟会话顺序，不再堆顶）。实时
   * turn 的 runId 本就是真实 run_id，realRunId 留 undefined，渲染匹配用 realRunId ?? runId。
   */
  realRunId?: string;
  /**
   * task-14（2026-08-14-sessions-portal / FR-07 / D-008@v1）：该轮生效配置快照
   * （档案 · 智能体 · 供应商），由父层从 attach 历史 logs 的 run 级快照构造。
   * who 行读快照而非会话当前配置——切换后历史消息保持当时配置不跟随（D-008）。
   * profileName/providerName 为 null 时如实显示「未指定」/「本机默认」。
   * 可选：不传（/runtimes 弹窗旧组装 / 实时 turn 未带快照）→ 不渲染，行为不变（零回归）。
   */
  whoLine?: {
    /** 档案名；null=该轮未指定档案。 */
    profileName: string | null;
    /** 智能体展示名（该轮 run 所属 runtime）。 */
    agentName: string;
    /** 供应商名；null=该轮用本机默认供应商。 */
    providerName: string | null;
    /**
     * 2026-10-25-session-config-deferred-switch：该轮档案快照的模型名（run
     * 级快照 agent_profile_snapshot.model）。null=档案未配模型（跟随引擎默认）。
     * 注意这是**档案级**模型——会话级模型覆盖（模型子下拉）不落 run 快照，
     * 轮级不可得，configChangeLine 的实时路（发送方前端权威）不受此限。
     */
    modelName?: string | null;
  };
  /**
   * 2026-10-25-session-config-deferred-switch：该轮相对上一轮的配置切换说明
   * （如「模型已切换 A → B」；page-helpers.buildConfigChangeLine 生成——实时路
   * 由发送方在占位轮预置（含会话级模型覆盖维度），历史路由 enrichDisplayTurns
   * 相邻快照对比生成（供应商/档案维度））。null/缺省 = 无变化或无前轮快照，
   * 不渲染（零回归）。
   */
  configChangeLine?: string | null;
  /**
   * ql-20260817-003：轮次发送者（共享守护进程场景多用户同会话）。父层从
   * runs 快照（run.user_id + sender_name）注入。可选：不传（/runtimes 弹窗
   * 旧组装 / 旧 run 无发送者数据）→ 用户气泡不显示发送行（零回归）。
   */
  sender?: {
    /** 发送者显示名（后端 users.display_name）。 */
    name: string;
    /** true=会话属主（当前用户视角显示「我」）。 */
    me?: boolean;
    /** 轮次开始时间 ISO（无则前端不显示时间）。 */
    at: string | null;
  };
  /**
   * ql-20260817-004：该轮 agent 答复完成时间 ISO（run.finished_at，运行中/
   * 旧数据为 undefined/null → 不显示）。答复气泡右下角显示，与用户消息时间对齐。
   */
  replyAt?: string | null;
  /**
   * task-06（2026-08-19-session-stream-ux / FR-01 / design §7）：结构化段
   * 时间线（session-log-assembler 装配产物，task-01/02/11 产出）。非 undefined
   * 时渲染走 v2 段模型路径（SegmentedTurnBody：对话=文本段+运行中状态条、
   * 全部「进度」=完整段线 + AskUser 按 ts 穿插）；undefined（孤儿 turn 构造 /
   * 旧数据）走旧渲染回退（output 单气泡 + processItems，§9.3）。空数组 = 已装配
   * 但尚无段（运行初期），仍走 v2 路径（状态条/思考占位生效）。
   */
  segments?: TurnSegment[];
  /**
   * task-06（FR-02 / Grill X-01）：轮级状态条计时锚点（AssembledTurn 透传）：
   * live = 本地发送占位时刻；attach = run 快照 started_at；均缺 = 首条 log
   * timestamp。null/undefined → 运行中轮不渲染状态条（缺锚点，消费方 task-09
   * 接线后常态有值）。
   */
  turnStartedAt?: number | null;
  /**
   * task-11（2026-10-20-session-page-dsh-alignment / FR-14 / D-023@v1）：该轮工作区
   * 文件变更快照（`GET /sessions/{id}/runs` 的 `file_changes`，挂载方透传）。
   * `null`/`undefined` = 该轮无快照——**禁止**渲染成「本轮无改动」（E6/E8）；
   * 是否降级由 `fileChangesCapability` 裁决，不看本字段是否存在。
   */
  fileChanges?: TurnFileChangesSnapshot | null;
  /**
   * task-11 / FR-16：该轮快照能力档（`full` = daemon 上报了工作区快照；
   * `tool_only` = 老 daemon / 部署前的历史轮，无快照能力）。`undefined` = 挂载方
   * 未接线（不出卡、不出占位）；`tool_only` 与「无快照 / 采集失败」同口径——**不出卡**
   * （2026-10-22-file-card-hide-empty：没有信息就隐藏卡片，原「仅工具编辑」降级卡已下线）。
   */
  fileChangesCapability?: FileChangesCapability | null;
}

/** 消息视图模式（ql-20260729-005）：对话=用户消息+答复正文+文件卡片（交付物，
 * agent-file-upload-mcp FR-01）；全部=追加思考/工具等过程项。
 * 2026-10-22-session-trajectory-third-view（D-001，覆盖 D-035）：三态——「轨迹」与
 * 「对话 / 进度」同层并列，不再是进度视图内的第二层开关。 */
export type SessionViewMode = "conversation" | "all" | "trajectory";

export interface TurnTimelineProps {
  turns: SessionTurnView[];
  viewMode: SessionViewMode;
  /**
   * 视口样式变体（2026-10-26-mobile-four-page-layout-fix task-05 / FR-01/02，
   * 默认 "desktop"）：mobile 时向轮尾 TurnLiveMarquee（隐藏 LIVE 徽标）与
   * RoundDivider（胶囊收缩折行 + meta 大数缩写）下传 mobile 分支；缺省 desktop
   * 既有宿主（PC 会话页 / dialog / 悬浮宿主）零变化。
   */
  variant?: "desktop" | "mobile";
  /**
   * 2026-10-22-trajectory-context-jump（FR-02）：轮次导航 → 轨迹视图的跳转信号。
   * `{ turnKey, nonce }`——nonce 自增驱动重复点击；仅轨迹视图消费，其它视图零影响；
   * 不传零回归。目标轮不在轨迹（预览轮/未加载）静默跳过。
   */
  trajectoryJump?: { turnKey: string; nonce: number } | null;
  /**
   * 2026-10-20-session-page-dsh-alignment（D-009）：工作细节档位。
   * 不传（undefined）＝现行为零变化；传 "compact"/"standard" 时对**可折叠轮**
   * （isTurnFoldable：仅正常闭合轮）默认收起过程，只留正文 + 折叠头；
   * 传 "detailed" 等同现行为（不折叠）。dev 预览路由用它做新旧对照。
   */
  detailLevel?: DetailLevel;
  errorMsg: string | null;
  /**
   * 2026-09-10-auto-resume-interrupted-turn / FR-07：daemon_restarted 失败卡的
   * 场景化兜底建议（该错误码不在 8 类映射、无现 hint）——父级（会话页）按
   * 「中断自动续跑」开关状态传两态文案；不传保持现行为（类型表 defaultHint）。
   */
  daemonRestartedHint?: string | null;
  /**
   * 2026-09-12-chat-turn-auto-recovery / FR-5.1：会话当前 pending 的自动恢复
   * 条目（排队 ∪ 定时，origin=auto_resume:<源 run uuid>）——失败卡
   * autoRecoverHint 双信号推导的第二信号（存在性）。undefined = 父层无数据
   * （保持现行为，不注入提示）。
   */
  autoResumeEntries?: AutoResumeEntry[];
  /**
   * pending 待答卡渲染门控：ended/failed 会话不回显（ql-20260623 改动三，死卡防护）。
   * （2026-10-22-askuser-dock-inputbar：pending 卡已迁 PendingDialogDock 渲染于
   * 输入框位置，本字段仅剩空态/状态语义保留。）
   */
  sessionStatus: SessionUiStatus;
  /** AskUser 提问历史（ql-20260801-003，按 run_id 穿插到对应 turn）。 */
  dialogHistory: SessionDialogRead[];
  /** 失败轮次「重新发送」（RunErrorItem onResend，父级守卫 turn 级串行）。 */
  onResend: (_prompt: string) => void;
  /** RunErrorItem 主操作「切换供应商」。 */
  onSwitchProvider: () => void;
  /** 空态文案两态：在线显示 provider 已就绪；离线显示无守护进程。 */
  hasOnlineProvider: boolean;
  /** 空态文案：在线 provider 展示名（父级经 PROVIDER_META 解析后传入）。 */
  emptyProviderLabel: string;
  /**
   * ql-20260823-002-6a1a：消息流末尾注入位（会话式条目挂载口）——渲染在最后
   * 一个 turn 之后、同一滚动容器内，让附加信息以「对话流里的一条消息」形态
   * 出现而非面板级独立卡片。null/undefined 不渲染（零回归）；空 turns（空态
   * 占位）不渲染（流不存在无落点）。ql-20260904-021：首个消费方 AgentLogCard
   * 已迁面板顶部折叠栏，本注入口保留备用（暂无消费方）。
   */
  streamFooter?: ReactNode;
  /**
   * task-01（2026-09-08-session-turn-nav / FR-07 / D-007@v1）：受控高亮轮 key
   * （= realRunId ?? runId，与 data-turn-key 锚点同源）。命中行根节点渲染
   * ring+浅底高亮（主题语义类随主题换肤），清除节奏由父层控制（~2.2s 自清，
   * 本组件不做定时清除）。缺省 / null = 无高亮，dialog 等旧消费方零回归。
   * 本 prop 不直接传入 memo 行 TurnRow——TurnTimeline 内先派生 per-row 布尔
   * isHighlighted（R-07：字符串 prop 直传会在值变化时击穿全部行 memo）。
   */
  highlightTurnKey?: string | null;
  /**
   * quick（ql-20260916-017）：跳转翻页/定位期间暂停「贴底跟随」——用户原在底部
   * （isNearBottom=true）时点刻度跳转，每次翻页 prepend 都触发 [turns] effect
   * 强制滚回底部，与跳转 scrollIntoView 抢滚动（实测：跳 30 轮落位后被弹回
   * 第 47 轮）。跳转方全程置位，定位 settle 后解除。
   */
  suppressFollowBottom?: boolean;
  /**
   * task-08（2026-09-22-session-fork-continuation / FR-01 / FR-04）：轮级
   * 「⑂ 从此分叉」入口接线（可选；缺省不渲染——未接线的旧消费方零回归）。
   * engineAnchors=run key（realRunId ?? runId，与 data-turn-key 同源）→ 该轮
   * engine_anchor（/runs 快照，D-014③ 透出）；onForkTurn 上抛分叉锚轮
   * （runKey + 轮序号），挂载方开 ForkConfirmModal。行内渲染走 TurnRow 的
   * per-row 基元派生（isHighlighted 同法，R-07 防字符串/map 直传击穿行 memo）。
   */
  forkEntry?: TurnForkEntryWiring | null;
  /**
   * task-02（2026-10-14-session-turn-preview-cards / FR-02）：未加载轮预览卡展开
   * 回调（runKey 上抛；挂载方走单轮直达原地加载）。缺省（dialog / /runtimes 等
   * 旧消费方）预览分支整体不渲染——TurnRow 收到无 preview 的轮照旧；带 preview
   * 但未接线时也回落既有分支（类型收窄守卫），零回归。父级 useCallback 保证
   * 引用稳定（同 onResend 先例，防击穿 TurnRow memo）。
   */
  expandPreview?: (_runKey: string) => void;
  /**
   * task-11（2026-10-20-session-page-dsh-alignment / FR-16 / design E7）：会话级
   * 「文件改动汇总卡」开关——挂在会话流顶部（首轮之前），按各轮快照去重聚合。
   * 缺省 `true`（有数据才出卡：无任何快照时不渲染，零占位）；`false` 关闭。
   * 各轮数据来自 `SessionTurnView.fileChanges` / `fileChangesCapability`，本组件
   * 不取数（FR-22：不碰取数/分页/SSE）。
   */
  fileChangesSummary?: boolean;
  /**
   * 2026-10-23-turn-file-diff-dialog / FR-01/FR-04：会话 id——轮文件变更卡行点击
   * 查看该文件本轮变更内容弹窗的取数归属（getAgentSessionLogs(sessionId,{runId})）。
   * 缺省（undefined）＝旧消费方零回归：文件行不接线点击、弹窗不渲染
   * （agent-replay-body / group-chat-panel / proto 页等照旧）。
   */
  sessionId?: string;
  /**
   * 2026-10-23-session-first-load-ux / FR-01：首屏历史加载在飞指示。true 且
   * turns 为空时，以轮次卡形状骨架屏（antd Skeleton active 微光）替代静态
   * 空态文案——详情已返回而历史仍在拉取的阶段显示「已就绪」会被误读为
   * 页面卡死。缺省 false＝旧消费方（dialog / /runtimes / proto 页等）零回归；
   * turns 非空时本 prop 不起作用（骨架退场，预览卡/轮块照常渲染）。
   */
  historyLoading?: boolean;
}

/**
 * task-08（session-fork / FR-01）：TurnForkEntry 的挂载方接线契约（TurnTimeline
 * 消费，page/dialog 双模式同构传入）。provider 走 caps 单源（none 档入口不渲染）。
 */
export interface TurnForkEntryWiring {
  /** 会话引擎 provider（getProviderCaps → sessionFork 档位）。 */
  provider: string;
  /** run key → engine_anchor（/runs 快照派生；未命中按缺失=置灰处理）。 */
  engineAnchors: ReadonlyMap<string, string | null | undefined>;
  /** 轮入口点击（置灰态组件内已拦截）——挂载方开分叉确认弹层。 */
  onForkTurn: (_runKey: string, _seq: number) => void;
}

/* ── 2026-10-23-session-first-load-ux / FR-01：首屏历史加载骨架屏 ────────────
 * 详情已返回而首屏历史仍在拉取时，以轮次卡形状骨架占位替代静态空态文案
 * （「XX 已就绪」在加载期会被误读为页面卡死）。形态对齐轮块视觉：每张卡
 * 模拟「轮次徽标 + 时间行 + 两行正文」。antd Skeleton 经 ConfigProvider
 * token 着色（blue / ai-native 双主题自适应），active 微光即动态加载指示。
 * 纯占位展示：不取数、不参与滚动锚/贴底判定语义——轮次（含预览卡）到达
 * 即整体卸载。 */
function TurnHistorySkeleton() {
  return (
    <div
      data-testid="turn-history-skeleton"
      aria-label="正在加载会话历史"
      className="flex h-full min-h-[260px] flex-col justify-center gap-7 py-6"
    >
      <p className="text-xs text-muted-foreground">正在加载会话历史…</p>
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-2.5">
          <div className="flex items-center gap-2">
            <Skeleton.Button
              active
              size="small"
              block={false}
              style={{ width: 56, height: 20 }}
            />
            <Skeleton.Button
              active
              size="small"
              block={false}
              style={{ width: 64, height: 12 }}
            />
          </div>
          <Skeleton active title={false} paragraph={{ rows: 2 }} />
        </div>
      ))}
    </div>
  );
}

/** ql-20260903-026：单轮行 memo 组件——配合 session-panel displayTurns 的引用
 *  稳定守卫（ql-20260903-025），流式 delta 只重渲染变化行；未变化行连同其
 *  段级/markdown 子树整体跳过（行 JSX 自 map 原文逐字搬入，分支 key 保留
 *  冗余无害）。props 稳定性：turn 引用（父级守卫）+ viewMode 字符串 +
 *  dialogHistory useState 数组 + onResend/onSwitchProvider 父级 useCallback 化。
 *  task-01（2026-09-08-session-turn-nav / FR-07 / D-007@v1）：新增 isHighlighted
 *  布尔（父级按 highlightTurnKey 逐行派生后传入，字符串不进 memo 行，R-07）；
 *  两分支根 DOM 元素挂 data-turn-key 跳转锚点（design §7）。
 *  task-07（2026-09-09-askuser-pi-cursor / FR-03）：新增 hasLaterUserMessage
 *  布尔（父级逆序扫描派生，同 isHighlighted 的 per-row 布尔法）——marker 提问卡
 *  已答态 best-effort 判定数据源（该轮之后已存在用户消息，displayTurns 本地判定）。 */
/**
 * quick（ql-20260916-015）：超长轮输出折叠阈值——单轮 markdown 超过此长度时首屏
 * 只渲染前 N 字符 + 「展开全文」按钮（运行中轮不折叠，流式增量照常）。线上实证
 * 单轮最长 13.7 万字符（1.2MB 级 markdown），react-markdown 全量 parse 单块即
 * 数秒主线程阻塞（content-visibility 只救屏外，屏内大块仍需 parse）。折叠让
 * 首屏渲染量恒定，展开是用户显式动作（此时可承受一次 parse）。
 */
const HUGE_OUTPUT_THRESHOLD = 30_000;

/** 折叠态超长输出渲染：前 N 字符 + 截断提示 + 展开按钮。 */
function HugeOutputBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  if (expanded || text.length <= HUGE_OUTPUT_THRESHOLD) {
    return <MarkdownText content={text} />;
  }
  return (
    <div className="space-y-1.5">
      <MarkdownText content={text.slice(0, HUGE_OUTPUT_THRESHOLD)} />
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>（输出超长，已截断显示前 3 万字符——共 {text.length.toLocaleString()} 字符）</span>
        <button
          type="button"
          className="rounded border border-border px-1.5 py-0.5 hover:bg-muted"
          onClick={() => setExpanded(true)}
        >
          展开全文
        </button>
      </div>
    </div>
  );
}

/**
 * task-02（2026-10-14-session-turn-preview-cards / FR-01）：未加载轮预览卡——
 * 大纲摘要卡（虚线边框 + brand 浅底，与已加载实心气泡明确区分；视觉基准
 * prototype-turn-preview-cards.html）。整卡 button 可点（onExpand 上抛 runKey，
 * 挂载方走单轮直达原地加载）。纯展示零请求；屏外 content-visibility 跳过渲染
 * （数百轮会话卡量防御，先例同文件完整轮块分支）。
 */
function TurnPreviewCard({
  turn,
  isHighlighted,
  onExpand,
}: {
  turn: SessionTurnView;
  isHighlighted: boolean;
  onExpand: (_runKey: string) => void;
}) {
  const preview = turn.preview!;
  const runKey = turn.realRunId ?? turn.runId;
  // 状态点色（词表对齐 sessions/turn-catalog statusDotCls：running→warning 脉冲
  // / failed→destructive / 其余含 completed/killed→中性 muted）。
  const statusDot =
    turn.status === "running"
      ? "bg-warning animate-pulse"
      : turn.status === "failed"
        ? "bg-destructive/75"
        : "bg-muted-foreground/45";
  const statusLabel =
    turn.status === "running"
      ? "运行中"
      : turn.status === "failed"
        ? "失败"
        : turn.status === "killed"
          ? "已中止"
          : turn.status === "pending"
            ? "等待中"
            : "完成";
  const time = preview.startedAt ? formatTurnTime(preview.startedAt) : "";
  const ariaParts = [
    turn.turn != null ? `第${turn.turn}轮` : "轮次",
    statusLabel,
    preview.promptSummary ?? "（无内容记录）",
  ];
  return (
    <button
      type="button"
      key={turn.runId}
      data-turn-key={runKey}
      data-testid="turn-preview-card"
      // task-03（preview-cards）：预览卡标记——跳转链 hit() 的 60 字内容门据此
      // 显式排除（卡内大纲摘要可能超阈值，防被误判「已加载」跳过直达）。
      data-turn-preview="true"
      aria-label={`展开${ariaParts.join(" · ")}`}
      title={ariaParts.join(" · ")}
      onClick={() => onExpand(runKey)}
      className={cn(
        "group flex w-full cursor-pointer flex-col gap-1 rounded-xl border border-dashed border-brand-300/70 bg-brand-50 px-3.5 py-2.5 text-left transition-all outline-none",
        "hover:border-brand-300 hover:bg-brand-100 hover:shadow-md",
        "focus-visible:ring-2 focus-visible:ring-brand-400",
        // quick（ql-20260916-015）同款屏外跳过渲染（数百轮预览卡量防御）。
        "[content-visibility:auto] [contain-intrinsic-size:auto_96px]",
        isHighlighted && "ring-2 ring-brand-200",
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 font-mono text-[10.5px] font-semibold text-brand-700">
          {turn.turn != null ? `第 ${turn.turn} 轮` : "轮次"}
        </span>
        <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusDot)} />
        <span className="shrink-0 rounded-full border border-brand-300 bg-card px-1.5 py-px text-[9.5px] leading-[1.4] text-brand-700">
          未加载 · 点击展开
        </span>
        {time && (
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{time}</span>
        )}
      </span>
      {preview.promptSummary && (
        <span className="line-clamp-2 text-[12.5px] font-medium leading-[1.55] text-foreground">
          {preview.promptSummary}
        </span>
      )}
      {preview.answerSummary && (
        <span className="line-clamp-2 text-[11.5px] leading-[1.55] text-muted-foreground">
          {preview.answerSummary}
        </span>
      )}
      <span className="mt-0.5 flex items-center gap-1 text-[10.5px] font-medium text-brand-600">
        展开完整对话
        <ArrowRight
          aria-hidden
          className="h-3 w-3 transition-transform group-hover:translate-x-0.5"
        />
      </span>
    </button>
  );
}

/**
 * 2026-10-23-live-turn-meta-time / FR-01：进行中轮底部元信息的实时历时——
 * 「历时 mm:ss」每秒 +1（同轮次顶部 TurnStatusBar 走秒）。渲染经济同源：tick
 * 局部 state 不外溢（父级 TurnRow 不随秒重渲染）；轮转终态后 metaDetail 不再
 * 含本组件，随卸载满理 interval。
 */
function TurnLiveElapsedText({ startedAtMs }: { startedAtMs: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <>历时 {formatTurnDuration(Math.max(0, now - startedAtMs))}</>;
}

const TurnRow = memo(function TurnRow({
  turn,
  viewMode,
  mobile = false,
  isHighlighted,
  hasLaterUserMessage,
  dialogHistory,
  onResend,
  onSwitchProvider,
  daemonRestartedHint,
  autoResumeEntries,
  forkProvider,
  forkAnchor,
  forkSeq,
  onForkTurn,
  onExpandPreview,
  detailLevel,
  onOpenFileChanges,
}: {
  turn: SessionTurnView;
  viewMode: SessionViewMode;
  /**
   * 手机端窄视口布尔（2026-10-26-mobile-four-page-layout-fix task-05，默认 false）：
   * 父级 TurnTimeline 由 variant 派生（memo 友好基元），下传轮尾 marquee
   * （隐藏 LIVE）与 RoundDivider（收缩折行+大数缩写）；缺省 desktop 零变化。
   */
  mobile?: boolean;
  /** task-01：父级派生的 per-row 高亮布尔（命中行加 ring+浅底，R-07 防击穿）。 */
  isHighlighted: boolean;
  /** task-07：该轮之后是否已存在用户消息（marker 提问卡已答态 best-effort 判定）。 */
  hasLaterUserMessage: boolean;
  dialogHistory: SessionDialogRead[];
  onResend: (_prompt: string) => void;
  onSwitchProvider: () => void;
  /** 2026-09-10-auto-resume-interrupted-turn：daemon_restarted 场景化兜底建议。 */
  daemonRestartedHint?: string | null;
  /** 2026-09-12-chat-turn-auto-recovery：pending 自动恢复条目（双信号推导）。 */
  autoResumeEntries?: AutoResumeEntry[];
  /** task-08（session-fork / FR-01）：per-row 分叉入口基元（undefined=未接线不渲染）。 */
  forkProvider?: string;
  /** task-08：该轮 engine_anchor（null=缺失 → native 档置灰；seed 档不消费）。 */
  forkAnchor?: string | null;
  /** task-08：轮序号（turn.turn ?? 行序兜底，ForkConfirmModal「第 N 轮后」展示）。 */
  forkSeq?: number;
  /** task-08：分叉入口点击（runKey+seq 上抛挂载方；稳定 ref 由挂载方 useCallback 保证）。 */
  onForkTurn?: (_runKey: string, _seq: number) => void;
  /** task-02（2026-10-14-session-turn-preview-cards / FR-01 FR-02）：预览卡展开回调
   *  （runKey 上抛挂载方走单轮直达原地加载；缺省=旧消费方未接线，预览分支不渲染，
   *  dialog / /runtimes 弹窗零回归。函数引用由父级 useCallback 保证稳定，同
   *  onResend 先例）。 */
  onExpandPreview?: (_runKey: string) => void;
  /** 2026-10-20-session-page-dsh-alignment：工作细节档位（undefined＝现行为）。 */
  detailLevel?: DetailLevel;
  /**
   * 2026-10-23-turn-file-diff-dialog / FR-01/FR-04：文件变更卡行点击回调
   * （runKey + 行元信息上抛，弹窗挂 TurnTimeline 根）。undefined＝挂载面未接
   * sessionId，行点击零行为（旧消费方零回归）。引用由父级 useCallback 保证
   * 稳定（R-07，同 onResend 先例）。
   */
  onOpenFileChanges?: (
    _runKey: string,
    _file: {
      path: string;
      status?: FileChangeStatus;
      /** 该文件行有 agent 编辑归因（source=tool / 改N次>0）——弹窗无补丁文案区分用。 */
      agentEdited?: boolean;
    },
  ) => void;
}) {
  // task-07（FR-03 / D-003@v2）：旧路径 output 气泡 askuser 标记拦截——命中则
  // 气泡正文换 textBefore（标记原文不显示，提问卡随气泡原位渲染（下方 ml-9）；
  // 未命中（null）output 原样渲染，零变化。
  const outputMarker = turn.output ? parseAskUserMarkerCached(turn.output) : null;
  // task-10（2026-09-10-account-avatar-upload / FR-05）：当前用户平台头像——
  // 选择器订阅仅 avatar 切片（避免整 store 订阅引发无关重渲），仅 sender.me
  // 气泡消费；null/undefined 时 ChatMessageAvatar 首字回退现状不动。
  const myAvatar = useSession((s) => s.user?.avatar ?? null);
  // 2026-10-20-session-page-dsh-alignment（D-009）：整轮折叠——仅当调用方传了
  // detailLevel（非 detailed）且该轮具备折叠资格时生效；不传＝现行为零变化。
  const [foldOpen, setFoldOpen] = useState(false);
  const foldEligible =
    detailLevel !== undefined && detailLevel !== "detailed" && isTurnFoldable(turn);
  const folded = foldEligible && !foldOpen;
  /**
   * 2026-10-20-session-page-dsh-alignment（FR-01 / D-016① / D-015@v2）：轮元信息
   * 合并成一行——原先轮尾状态行（第 N 轮 · 状态 · tokens · tok/s）之外还有一条
   * 「开始 · 结束 · 历时」独立行，同屏两行元信息重复。此处把时间细节派生为一段
   * 文本，折进状态行的最右端（等宽 / muted / 10.5px，见 RoundDivider.detail 与
   * 下方 all 视图 span）。信息不丢：轮号/状态/耗时/结束时刻/tokens/tok·s 全在
   * 同一行；锚点缺失保持原回退（仅显结束时间，不编造开始与历时）。
   *
   * 2026-10-23-live-turn-meta-time / FR-01/FR-02：进行中三态优先分支——只显
   * 「开始 HH:MM:SS · 历时 mm:ss(实时)」，禁止显「结束」（运行中 run 无
   * finished_at，数据层已不再伪造 replyAt；本分支优先于 replyAt 判定，旁路装配
   * 带伪值也不显）；无锚点不显示（不编造）。历时由 TurnLiveElapsedText 局部
   * 每秒 tick；轮转终态后本分支失效回退三段字符串，走秒组件随之卸载清 interval。
   */
  const metaDetail: ReactNode =
    isLiveTurn(turn.status) && turn.turnStartedAt != null ? (
      <>
        {`开始 ${formatTurnTimeSec(new Date(turn.turnStartedAt).toISOString())}`} ·{" "}
        <TurnLiveElapsedText startedAtMs={turn.turnStartedAt} />
      </>
    ) : turn.replyAt != null
      ? [
          turn.turnStartedAt != null
            ? `开始 ${formatTurnTimeSec(new Date(turn.turnStartedAt).toISOString())}`
            : null,
          `结束 ${formatTurnTimeSec(turn.replyAt)}`,
          turn.turnStartedAt != null
            ? `历时 ${formatTurnDuration(
                Math.max(0, Date.parse(turn.replyAt) - turn.turnStartedAt),
              )}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;
  return (
    <>
    {/* task-01（2026-09-08-session-turn-nav / FR-07 / D-007@v1）：轮次跳转 DOM 锚点
        data-turn-key（值 = realRunId ?? runId，与刻度轨条目 key 同源）——两分支的
        根 DOM 元素均挂（fragment 上放 data-* 无效），供跳转方
        querySelector([data-turn-key]) 精确命中（design §7）。 */}
    {/* task-02（2026-10-14-session-turn-preview-cards / FR-01）：未加载轮预览卡
        分支最前置——preview 条目（mergePreviewIntoDisplayTurns 产物，正文恒空）
        渲染 TurnPreviewCard 取代完整轮块；expandPreview 缺省（旧消费方）不渲染
        该分支，行为回落到下方既有两分支（零回归）。data-turn-key 照挂（与加载后
        的真实块同源，原地替换后定位键不变）。 */}
    {turn.preview && !turn.prompt && !turn.output && onExpandPreview ? (
      <TurnPreviewCard turn={turn} isHighlighted={isHighlighted} onExpand={onExpandPreview} />
    ) : !turn.prompt && !turn.output && !!turn.whoLine && turn.status === 'completed' ? (
              <div
                key={turn.runId}
                data-turn-key={turn.realRunId ?? turn.runId}
                className={cn(
                  "flex items-center gap-1.5 text-[11px] text-muted-foreground opacity-70",
                  // quick（ql-20260916-015）：同完整轮块——屏外跳过渲染。
                  "[content-visibility:auto] [contain-intrinsic-size:auto_24px]",
                  // task-01：受控高亮（isHighlighted 命中行）——ring+浅底主题语义类
                  // 随主题换肤；compact 行原本无圆角，高亮时补 rounded-md。
                  isHighlighted && "rounded-md ring-2 ring-brand-200 bg-brand-50",
                )}
              >
                <Settings aria-hidden className="h-3 w-3" />
                {turn.replyAt && <span>{formatTurnTime(turn.replyAt)}</span>}
                <span>· <BookUser aria-hidden className="inline h-3 w-3 align-[-2px]" /> {turn.whoLine!.profileName ?? '未指定'}</span>
                <span>· {turn.whoLine!.agentName}</span>
                <span>· <Cloud aria-hidden className="inline h-3 w-3 align-[-2px]" /> {turn.whoLine!.providerName ?? '本机默认'}</span>
              </div>
            ) : <div
                  key={turn.runId}
                  data-turn-key={turn.realRunId ?? turn.runId}
                  className={cn(
                    "space-y-2.5",
                    // quick（ql-20260916-015）：屏外轮次跳过布局/绘制（浏览器原生
                    // 虚拟化，先例 deepseek-harness ChatView）。超长 run（单轮 13.7 万
                    // 字符 markdown）一次性全量渲染是翻页/跳转卡死根因——content-visibility
                    // 让滚动容器外的轮次只占位不解析布局；estimate 8 万 px 上限防
                    // 屏外占位塌陷导致滚动条跳变（大轮真实高度可达数万 px）。
                    "[content-visibility:auto] [contain-intrinsic-size:auto_800px]",
                    // task-01：受控高亮（isHighlighted 命中行）——ring+浅底主题语义
                    // 类随主题换肤；容器原本无圆角，高亮时补 rounded-md。
                    isHighlighted && "rounded-md ring-2 ring-brand-200 bg-brand-50",
                  )}
                >
              {/* 2026-10-25-session-config-deferred-switch（D-001）：配置切换说明行
                  ——本轮相对上一轮生效配置有变化时（供应商/模型/档案），轮块顶部
                  独占一行轻量提示（形态对齐 system_event 药丸：居中虚线圆角 +
                  muted 小字），替代旧「空切换轮」的轮次占位。缺省/无变化不渲染。 */}
              {turn.configChangeLine && (
                <div className="flex justify-center">
                  <div
                    data-testid="turn-config-change"
                    title={turn.configChangeLine}
                    className="flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-dashed border-border bg-card px-3 py-[3px] text-[11px] text-muted-foreground"
                  >
                    <span aria-hidden className="shrink-0">⇄</span>
                    <span className="min-w-0 truncate">{turn.configChangeLine}</span>
                  </div>
                </div>
              )}
              {/* 回带④（2026-09-20 双实现对撞深读裁决）：系统事件双视图可见——对话视图
                  也渲染 system_event 过程项（同「全部」视图的中性虚线药丸形态，从
                  processItems 提取；不冒充用户气泡、不带假运行语义，D-003 同源）。
                  「全部」视图不画（TurnDetailsList 已含同款渲染，防双画）。 */}
              {viewMode === "conversation" &&
                (() => {
                  const sysEvents = (turn.processItems ?? []).filter(
                    (item) => item && typeof item === "object" && "kind" in item && (item as { kind: string }).kind === "system_event",
                  ) as Array<{ kind: "system_event"; text: string }>;
                  if (sysEvents.length === 0) return null;
                  return sysEvents.map((item, i) => (
                    <div key={`${turn.runId}-sys-${i}`} className="flex justify-center">
                      <div
                        title={item.text}
                        className="flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-dashed border-border bg-card px-3 py-[3px] text-[11px] text-muted-foreground"
                      >
                        <span aria-hidden className="shrink-0">⚙</span>
                        <span className="min-w-0 truncate">{item.text}</span>
                      </div>
                    </div>
                  ));
                })()}
              {/* 用户消息气泡（右）。attach 中途接入的 unknown-run turn 无 prompt，不渲染。
                  ql-20260817-007：与 agent 答复对称——[时间][气泡][发送者头像]；
                  头像无图时用用户名首字（同顶栏用户菜单 AvatarFallback 模式）。 */}
              {turn.prompt && (
                <div className="flex items-end justify-end gap-1.5">
                  {turn.sender?.at && (
                    <span className="shrink-0 pb-1 text-[10.5px] text-muted-foreground">
                      {formatTurnTime(turn.sender.at)}
                    </span>
                  )}
                  {/* task-11（FR-07）：group+relative 供 CopyButton 右下角 hover 浮出。
                      ql-20260909-009：shadow-sm→shadow-primary 品牌投影（与发送按钮同
                      token），用户气泡从纯色块浮出时间线底。ql-20260915-009：turn-bubble
                      标记类供 mobile 放大规则定位（globals.css data-variant 块）——
                      2026-09-20-agent-reply-no-bubble task-02 起仅用户气泡持有该标记类
                      （旧路径答复已换 seg-text-body 无框正文）。
                      2026-10-20-session-page-dsh-alignment（FR-05 / D-015@v2 / D-016④）：
                      用户气泡降噪——纯 brand 实色大块曾是全屏第一视觉焦点（抢正文）。
                      改：①限宽 80%→56%（右侧留白给对话流）②底从 `bg-primary` 实色换
                      brand 8% 低饱和混合 + 20% brand 细边（`hsl(var(--primary) / 0.08)`
                      随三主题各自 primary 换肤，浅色不糊、暗色不刺）③字色由
                      primary-foreground（白）换 foreground（浅底上才是正文对比度）
                      ④去掉品牌投影（低饱和底配大投影显脏）⑤字号 13.5px。 */}
                  <div className="turn-bubble group relative max-w-[56%] rounded-2xl rounded-br-md border border-primary/20 bg-primary/[0.08] px-4 py-2.5 text-[13.5px] leading-6 text-foreground">
                    {/* task-13：剥离历史附件标记行（D-3），文本与 chips 分层渲染 */}
                    {(() => {
                      const parsed = parseAttachmentMarkersCached(turn.prompt);
                      return (
                        <>
                          {parsed.attachments.length > 0 && (
                            /* 2026-10-20-session-page-dsh-alignment（FR-05）：气泡底已降为
                               低饱和 brand 浅底，附件 chip 随之走 brand 档（默认 onPrimary
                               的白色半透明 chip 在浅底上不可见）。 */
                            <AttachmentChips attachments={parsed.attachments} tone="brand" />
                          )}
                          {parsed.text && (
                            <div className="whitespace-pre-wrap break-words">
                              {/* task-06（2026-10-09-attachment-inline-reference）：
                                  正文行内引用渲染为可点击标签（点击开预览窗）。
                                  2026-10-20-session-page-dsh-alignment（FR-05）：气泡底已
                                  从 brand 实色降为 8% 混合 + foreground 字色，行内引用标签
                                  随之由 onPrimary（白底白字，只在实色蓝泡里成立）改
                                  brand 档（品牌浅底 + brand 字，三主题都可读）。 */}
                              <InlineAttRefTextWithPreview text={parsed.text} tone="brand" />
                            </div>
                          )}
                          {/* task-11：复制剥离标记后的纯文本（与显示一致，点击时惰性重解析）；
                              纯附件消息（text 空串）不渲染复制钮。原型 .bubble-user .copy-btn
                              定位 right:0 / bottom:-24px，经 className 覆盖默认右下偏移。 */}
                          {parsed.text && (
                            <CopyButton
                              // 2026-10-22-session-composer-slim FR-01：复制结果为
                              // 人读文本（📎 文件名），不含协议标记。
                              getText={() => formatRefsForPlainText(turn.prompt)}
                              className="-bottom-6 right-0"
                            />
                          )}
                        </>
                      );
                    })()}
                  </div>
                  {turn.sender && (
                    <ChatMessageAvatar
                      kind="user"
                      name={turn.sender.name}
                      // task-10（FR-05）：仅自己（sender.me）的气泡接平台头像
                      // （ChatMessageAvatar 内部走 useAvatarSrc）；非 me 发送者
                      // 不传（undefined）——他人首字回退语义不动。
                      avatar={turn.sender.me ? myAvatar : undefined}
                      size={28}
                      title={
                        turn.sender.me
                          ? `我（${turn.sender.name}）`
                          : turn.sender.name
                      }
                    />
                  )}
                </div>
              )}
              {/* ql-20260802-003：「全部」视图把过程项（思考/工具/stderr）与 AskUser 提问
                  按 timestamp/created_at 合并排序统一渲染——AskUser 不再固定堆在过程项
                  之后，而是穿插进真实时间线（思考→工具→提问→工具→…连贯有序）。
                  task-06（§9.3）：本块为旧渲染回退路径（segments 缺省的 turn）；带
                  segments 的 turn 的 AskUser 穿插由 SegmentedTurnBody 段线合并排序承担。 */}
              {viewMode === "all" &&
                turn.segments === undefined &&
                (() => {
                  const realRunId = turn.realRunId ?? turn.runId;
                  const turnDialogs = dialogHistory.filter((d) => d.run_id === realRunId);
                  if ((turn.processItems?.length ?? 0) === 0 && turnDialogs.length === 0) return null;
                  const merged: Array<
                    SessionProcessItem | { kind: "askUser"; dialog: SessionDialogRead; ts?: number }
                  > = [
                    ...(turn.processItems ?? []),
                    ...turnDialogs.map((d) => ({
                      kind: "askUser" as const,
                      dialog: d,
                      ts: d.created_at ? Date.parse(d.created_at) : undefined,
                    })),
                  ];
                  merged.sort(
                    (a, b) =>
                      (Number.isFinite(a.ts) ? a.ts! : 0) - (Number.isFinite(b.ts) ? b.ts! : 0),
                  );
                  return <TurnDetailsList items={merged} />;
                })()}
              {/* ql-20260802-001/003：「对话」视图用轻量 ❓ 提问记录（只显问题+作答）。
                  2026-10-10-dialog-qa-inplace：v2 段路径的 ❓ 块改由
                  SegmentedTurnBody 按 created_at 与段 ts 合并排序穿插进对话流
                  （原「整组前置轮头部」造成一轮多问时序全丢）；本块仅剩旧渲染
                  回退路径（segments undefined 的孤儿轮/旧数据），行为不变。
                  AskUser 走 onUserDialog 不走 tool_use 日志，故用 dialog 历史渲染。
                  全部视图的 AskUser 已并入上方时间线。 */}
              {viewMode !== "all" &&
                turn.segments === undefined &&
                dialogHistory
                  .filter((d) => d.run_id === (turn.realRunId ?? turn.runId))
                  .map((d) => <DialogQaBlock key={`dialog-${d.request_id}`} dialog={d} />)}
              {/* task-14（FR-07 / D-008@v1）：消息 who 行——读该轮 run 配置快照
                  （档案 · 智能体 · 供应商），未选如实显示「未指定/本机默认」；
                  历史不跟随会话当前配置。whoLine 缺省（弹窗旧组装）不渲染（零回归）。
                  task-13（FR-05 / D-004@v1）：展示改 .sh-ctx-chip 上下文引用 chip
                  （虚线描边浅底，brand 阶随主题，globals.css utility）——数据源仍为
                  快照三字段，不加新数据，缺省不渲染语义不变。 */}
              {turn.whoLine && (
                <div aria-label="轮次配置快照" className="ml-9">
                  <span className="sh-ctx-chip">
                    <span className="inline-flex items-center gap-1">
                      <BookUser aria-hidden className="h-3 w-3" />
                      {turn.whoLine.profileName ?? "未指定"}
                    </span>
                    <span aria-hidden>·</span>
                    <span>{turn.whoLine.agentName}</span>
                    <span aria-hidden>·</span>
                    <span className="inline-flex items-center gap-1">
                      <Cloud aria-hidden className="h-3 w-3" />
                      {turn.whoLine.providerName ?? "本机默认"}
                    </span>
                  </span>
                </div>
              )}
              {/* task-06（FR-01 / design §5 Phase2 + §9.3）：渲染主体双路径分支。
                  segments 非 undefined → v2 段模型（SegmentedTurnBody：对话=文本段
                  逐段气泡 + 运行中状态条；全部「进度」=完整段时间线 + AskUser 穿插）；
                  segments undefined（孤儿 turn 构造 / 旧数据）→ 旧渲染路径回退（output
                  单气泡 + processItems），行为与现状等价（回退不崩不空）。 */}
              {turn.segments !== undefined ? (
                <>
                  {foldEligible && (
                    <button
                      type="button"
                      onClick={() => setFoldOpen((v) => !v)}
                      aria-expanded={foldOpen}
                      className="mb-1 ml-0 flex w-[min(100%,48rem)] items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-[12px] text-muted-foreground hover:bg-muted"
                    >
                      <span aria-hidden className="font-mono text-[10.5px]">
                        {foldOpen ? "▾" : "▸"}
                      </span>
                      <span>{foldHeaderText(turn, detailLevel ?? "standard")}</span>
                      <span className="ml-auto font-mono text-[10.5px]">
                        {foldOpen ? "收起过程" : "展开过程"}
                      </span>
                    </button>
                  )}
                  <SegmentedTurnBody
                    segments={folded ? textOnlySegments(turn.segments) : turn.segments}
                  turnStatus={turn.status}
                  turnStartedAt={turn.turnStartedAt}
                  viewMode={viewMode}
                  runKey={turn.realRunId ?? turn.runId}
                  mobile={mobile}
                  dialogHistory={dialogHistory}
                  markerAnswered={hasLaterUserMessage}
                  onMarkerSubmit={onResend}
                  // 2026-10-25-marquee-awaiting-real-data（FR-03）：轮级 token +
                  // 最后事件服务端时间戳——等待条目回显真实计时与本轮累计 token。
                  turnTokens={
                    turn.inputTokens != null || turn.outputTokens != null
                      ? { input: turn.inputTokens, output: turn.outputTokens }
                      : null
                  }
                  // 2026-10-26-session-stage-progress（FR-04）：轮当前阶段透传
                  // 状态条（缺省 undefined → 状态条现状分支，零回归）。
                  currentPhase={turn.currentPhase}
                  />
                </>
              ) : (
                <>
                  {/* 旧路径（回退）：agent 答复正文（左，带助手图标）——seg-text-body
                      无框容器，与 v2 主路径同款（2026-09-20-agent-reply-no-bubble
                      task-02）。运行中尚无答复时显示思考占位。
                      task-07（FR-03）：output 尾部 askuser 标记命中 → 正文换 textBefore；
                      纯标记消息（textBefore 空）不渲染正文行，仅下方提问卡。 */}
                  {turn.output ? (
                    outputMarker && !outputMarker.textBefore.trim() ? null : (
                      <div className="flex items-start gap-2.5">
                        <ChatMessageAvatar kind="agent" title="智能体" />
                        <div className="flex items-end gap-1.5">
                           {/* 2026-09-20-agent-reply-no-bubble task-02：换 v2 主路径同款
                               seg-text-body 无框正文（不取 w-full——容器在 flex items-end
                               行内与行尾时间戳并排，内容自适应宽度，时间戳尾随内容边缘）；
                               ql-20260915-009 的 mobile 放大标记类自此仅用户气泡持有
                               （globals.css 规则迁移归 task-03）。
                               2026-10-20-session-page-dsh-alignment（FR-02 / D-016②）：
                               与 v2 主路径同宽；字号/行高/段距
                               （14.5px / 1.78 / 0.6em）由 globals.css 的 .seg-text-body
                               元素级规则统一承担，两条路径不再各写一套。
                               2026-10-25-session-tab-visual-unify：阅读限宽随 v2 主路径
                               统一为「整行宽度-120px」（max-w-[calc(100%-120px)]）。 */}
                          <div className="seg-text-body max-w-[calc(100%-120px)]">
                            <HugeOutputBlock text={outputMarker ? outputMarker.textBefore : turn.output} />
                            {/* task-13（FR-05 / D-004@v1）：流式光标——旧路径 output
                                气泡运行中（isLiveTurn 三态）挂正文尾，轮终态随条件转
                                false 移除；与 v2 路径 TextSegmentView 的 .seg-caret 同
                                语义（双路径一致）。utility/降级见 globals.css
                                .sh-stream-caret。 */}
                            {isLiveTurn(turn.status) && (
                              <span aria-hidden className="sh-stream-caret" />
                            )}
                          </div>
                          {/* ql-20260817-004：答复完成时间（run.finished_at，缺省不渲染）。 */}
                          {turn.replyAt && (
                            <span className="shrink-0 pb-1 text-[10.5px] text-muted-foreground">
                              {formatTurnTime(turn.replyAt)}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  ) : (
                    isLiveTurn(turn.status) && <ThinkingPlaceholder viewMode={viewMode} />
                  )}
                  {/* task-07（FR-03 / D-003@v2）：旧路径 marker 提问卡——output 尾块
                      命中处原位渲染（对齐 agent 气泡列 ml-9）；提交经 onResend 发送
                      链路作下一条用户消息，已答态 best-effort（hasLaterUserMessage）。 */}
                  {outputMarker && (
                    <div className="ml-9">
                      <AskUserMarkerCard
                        payload={outputMarker.payload}
                        answered={hasLaterUserMessage}
                        onSubmit={onResend}
                      />
                    </div>
                  )}
                  {/* agent-file-upload-mcp（FR-01）：旧路径对话视图的文件卡片——file
                      过程项是面向用户的交付物，答复气泡之后渲染（与 v2 段路径
                      SegmentView case "file" 同款标注 + FileMessageCard）。 */}
                  {viewMode !== "all" &&
                    (turn.processItems ?? [])
                      .filter((p) => p.kind === "file")
                      .map((p) => (
                        <div key={`file-${p.fileId}`} className="ml-9 space-y-1">
                          <div className="text-[11px] text-muted-foreground">
                            agent 上传了文件
                          </div>
                          <FileMessageCard
                            fileId={p.fileId}
                            name={p.name}
                            size={p.size}
                            mime={p.mime}
                            description={p.description ?? ""}
                          />
                        </div>
                      ))}
                </>
              )}
              {turn.errorDetail && (
                <div className="flex justify-start">
                  {/* 2026-10-25-session-tab-visual-unify：错误卡同属 agent 反馈
                      信息块，限宽随统一规则（整行宽度-120px），原 86% 弃。 */}
                  <div className="max-w-[calc(100%-120px)]">
                    <ErrorBoundary
                      label="run-error-item"
                      fallback={() => (
                        <div className="text-[11px] text-red-600/70">
                          运行错误展示失败
                        </div>
                      )}
                    >
                      {/* 2026-07-29-model-error-visibility：turn 失败的结构化错误展示
                          （原因 + 针对性建议 + 操作）。onResend 仅在 prompt 存在时提供
                          （ql-20260904-010：重试按钮不再按 retryable 门控，所有失败卡
                          可重发）；onSwitchProvider 由父级定位供应商切换入口（会话页
                          = 底部配置条）。 */}
                      <RunErrorItem
                        item={turn.errorDetail}
                        fallbackHint={
                          turn.errorDetail.code === "daemon_restarted"
                            ? (daemonRestartedHint ?? undefined)
                            : undefined
                        }
                        autoRecoverHint={autoRecoverHintForTurn(turn, autoResumeEntries)}
                        onResend={
                          turn.prompt.trim()
                            ? () => {
                                onResend(turn.prompt);
                              }
                            : undefined
                        }
                        onSwitchProvider={onSwitchProvider}
                      />
                    </ErrorBoundary>
                  </div>
                </div>
              )}
              {/* 2026-09-09-sessions-visual-refresh task-06 → 2026-10-27-mobile-chat-
                  visual-round4（用户指定「对话/进度两 tab 统一用对话形态」）：原「全部」
                  视图 TurnStatusBadge 分支退役，两视图共用下方 RoundDivider（Grill G-03
                  分档作废）；meta/detail 同源同构，mobile 透传同款。
                  task-08（session-fork / FR-01）：轮容器行加 group——TurnForkEntry
                  常驻隐藏、hover 本行浮出。入口挂轮尾分隔行（「第 N 轮」行）。 */}
              {(
                /* task-08（session-fork / FR-01）：轮容器行加 group——TurnForkEntry
                    常驻隐藏、hover 本行浮出（task-07 纯 CSS 方案的挂载方义务；
                    行级 group 不上提整轮根，防轮内 CopyButton 的 group-hover 被
                    整轮 hover 误触发）。入口挂轮尾分隔行（「第 N 轮」行）——
                    语义=「在该轮之后分叉」，与本行是 N/N+1 轮边界的定位吻合。 */
                <div className="group flex items-center gap-2 pl-9 pr-2">
                  <div className="min-w-0 flex-1">
                    <RoundDivider
                      label={turn.turn != null ? `第 ${turn.turn} 轮` : "轮次"}
                      status={turn.status}
                      mobile={mobile}
                      detail={metaDetail ?? undefined}
                      meta={
                        // ql-20260831-010 语义保持：运行中输入 null 显示「↑执行中…」
                        // 不显示假 ↑0；终态 null（旧 daemon 无数据）按 ↑0 降级（与
                        // 旧 TurnStatusBadge 同口径，已统一）。
                        turn.inputTokens != null || turn.outputTokens != null
                          ? (() => {
                              const live =
                                turn.status === "running" ||
                                turn.status === "pending" ||
                                turn.status === "interrupting";
                              const inTxt =
                                turn.inputTokens != null
                                  ? `↑${turn.inputTokens.toLocaleString("zh-CN")}`
                                  : live
                                    ? "↑执行中…"
                                    : "↑0";
                              const outTxt =
                                turn.outputTokens != null
                                  ? `↓${turn.outputTokens.toLocaleString("zh-CN")}`
                                  : live
                                    ? "↓执行中…"
                                    : "↓0";
                              // 2026-10-10-session-turn-token-speed FR-03/04：
                              // 终态轮追加生成速度（output ÷ API 时长）；运行中 /
                              // 无数据 null 不渲染（不伪造）。
                              const speed = turnTokenSpeedText(
                                turn.outputTokens,
                                turn.apiDurationMs,
                                turn.status,
                              );
                              return speed ? `${inTxt} ${outTxt} · ${speed}` : `${inTxt} ${outTxt}`;
                            })()
                          : undefined
                      }
                    />
                  </div>
                  {turn.autoResumeOf != null && (
                    <span
                      className="shrink-0 rounded-full border border-brand-300 bg-brand-100 px-1.5 py-px text-[9.5px] text-brand-700"
                      title={`自动续跑：daemon 重启中断后自动继续的轮次（源轮 ${turn.autoResumeOf.slice(0, 8)}…）`}
                      data-testid="turn-auto-resume-badge"
                    >
                      自动续跑
                    </span>
                  )}
                  {forkProvider != null && onForkTurn != null && (
                    <TurnForkEntry
                      provider={forkProvider}
                      runStatus={turn.status}
                      engineAnchor={forkAnchor}
                      onFork={() =>
                        onForkTurn(turn.realRunId ?? turn.runId, forkSeq ?? 1)
                      }
                    />
                  )}
              </div>)}
              {/* task-11（2026-10-20-session-page-dsh-alignment / FR-14 / D-023@v1）：
                  轮级文件变更卡——挂在轮尾状态行**之后**（两视图同位置）。
                  `toFileChangesCardProps` 返回 null 时**不渲染任何占位**；该 null 现在
                  覆盖「无快照 / tool_only / 采集失败 / 快照确认零改动」（2026-10-22
                  file-card-hide-empty 用户裁决：没有信息就隐藏卡片，不再出「仅工具
                  编辑」降级卡；design E6/E8 的「绝不显示本轮无改动」仍成立）。 */}
              {(() => {
                const cardProps = toFileChangesCardProps(
                  turn.fileChanges,
                  turn.fileChangesCapability,
                  { turnNo: turn.turn ?? undefined },
                );
                if (cardProps == null) return null;
                // 2026-10-23-turn-file-diff-dialog / FR-01：行点击上抛（runKey+行元信息），
                // 弹窗由 TurnTimeline 根统一挂载。未接线（无 sessionId）→ undefined，
                // 行点击零行为（FR-04 旧消费方零回归）。行内闭包在 TurnRow 渲染期
                // 生成，不影响行 memo（R-07：memo 面只看 TurnRow 的 props）。
                if (onOpenFileChanges == null) return (
                  <div data-testid="turn-file-changes" className="pl-9">
                    <FileChangesCard {...cardProps} />
                  </div>
                );
                const runKey = turn.realRunId ?? turn.runId;
                return (
                  <div data-testid="turn-file-changes" className="pl-9">
                    <FileChangesCard
                      {...cardProps}
                      onOpenFile={(path) => {
                        const file = cardProps.files.find((f) => f.path === path);
                        onOpenFileChanges(runKey, {
                          path,
                          status: file?.status,
                          // 2026-10-24-pi-edit-patch-synth / FR-04：agent 编辑归因
                          //（弹窗无补丁时的文案区分——pi 等运行时存量轮次兜底）。
                          agentEdited: file != null && file.edits > 0,
                        });
                      }}
                    />
                  </div>
                );
              })()}
            </div>
    }
    </>
  );
});

/**
 * 2026-09-12-chat-turn-auto-recovery / FR-5.1 / D-009@v2：失败卡自动恢复提示
 * 双信号推导——error_detail 类型（第一信号）+ 会话存在同源 pending 恢复条目
 * （第二信号，存在性）。无恢复条目（开关关/链上限到/派发已消费）一律不注入
 * 提示，防静态文案误导。
 */
export function autoRecoverHintForTurn(
  turn: { runId?: string | null; errorDetail?: ErrorLogItem | null },
  entries: AutoResumeEntry[] | undefined,
): string | undefined {
  if (!entries || entries.length === 0 || !turn.errorDetail || !turn.runId) {
    return undefined;
  }
  const origin = `auto_resume:${turn.runId}`;
  const entry = entries.find((e) => e.origin === origin);
  if (!entry) return undefined;
  const d = turn.errorDetail;
  const raw = String(d.raw ?? "");
  if (d.type === "quota_exceeded") {
    if (!d.reset_at) return undefined;
    const when = formatScheduledTime(d.reset_at);
    return `额度耗尽，将于 ${when} 自动继续（可在定时消息中取消）`;
  }
  if (
    d.type === "rate_limited" ||
    d.type === "timeout" ||
    d.type === "network" ||
    d.type === "provider_error" ||
    raw.includes("silent stream truncation")
  ) {
    return raw.includes("silent stream truncation")
      ? "输出流中断，已自动续跑"
      : "上游瞬时故障，已自动重发";
  }
  return undefined;
}

/** quick（ql-20260921-003-42be）：贴底重申窗口时长（ms）——对齐 session-panel
 *  prepend 锚点（pendingAnchorRef until=2500）惯例。贴底 scrollTo 读的是执行
 *  瞬间的 scrollHeight，而初始加载期高度未稳定（content-visibility 屏外行按
 *  估算占位、markdown 异步撑开、面板布局压缩，实测 314→2069→973→1136 抖动），
 *  窗口期内每帧核对高度并重申贴底。 */
const BOTTOM_REASSERT_WINDOW_MS = 2500;

/**
 * 「轨迹」视图（2026-10-22-session-trajectory-third-view / D-001，原
 * 2026-10-22-session-trajectory-view / D-035 的进度内呈现方式上移为第三视图）。
 *
 * 数据来源＝当前会话已加载的轮视图（`SessionTurnView[]`）：`trajectoryFromTurnViews`
 * 纯函数派生三泳道所需行/轮，再交给 dev 路由同款 `TrajectoryView` 渲染。**零网络请求**
 * （不调任何 API、不读 `.proto-staging`），因此产品页与 dev 预览的差别只在数据来源。
 *
 * 选中态（2026-10-22-fix-trajectory-row-select 并入）：`TrajectoryView` 的选中是受控
 * 可选 props——不传则点击静默无反应（原缺陷）。此处自持 `selectedRowId` 并接线，
 * 与 dev 预览页 `trajectory-proto-view.tsx` 同一接法：点账本行 / 时间轴条目选中、
 * 右侧检查器出详情、↑↓ 切换、Esc 清除均由 TrajectoryView 内部逻辑承担。
 *
 * 空态：整段会话都没有可比对的时间戳（`rows` 为空）→ 出显式提示，**不白屏、不伪造条**
 * （伪造会让「没有数据」看起来像「这轮没有活动」）。
 */
function TrajectoryPane({
  turns,
  jump,
}: {
  turns: SessionTurnView[];
  jump?: { turnKey: string; nonce: number } | null;
}) {
  const trajectory = useMemo(() => trajectoryFromTurnViews(turns), [turns]);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  // 2026-10-22-trajectory-context-jump（FR-02）：轮次导航跳转——run key 匹配轮，
  // 选中该轮首行；滚入视野由账本选中 effect 承担。目标轮不在轨迹（预览轮/
  // 未加载）时静默跳过，不报错。nonce 只消费一次：流式更新（trajectory 引用
  // 变化）重跑本 effect 不得覆盖用户手动选中（评审 P2）。
  const lastJumpNonceRef = useRef(-1);
  useEffect(() => {
    if (!jump) return;
    if (jump.nonce === lastJumpNonceRef.current) return;
    lastJumpNonceRef.current = jump.nonce;
    const turn = trajectory.turns.find((item) => item.runId === jump.turnKey);
    if (!turn) return;
    const firstRow = trajectory.rows.find((row) => row.turnIndex === turn.index);
    if (firstRow) setSelectedRowId(firstRow.id);
  }, [jump, trajectory]);
  if (trajectory.rows.length === 0) {
    return (
      <div
        data-testid="trajectory-empty"
        className="rounded-md border border-dashed border-border px-4 py-6 text-center text-[12px] text-muted-foreground"
      >
        本轮会话没有可绘制的时间数据（历史轮缺少时间戳）。
        <br />
        产生新的对话轮后，这里会显示输入 / 模型 / 工具三泳道时间轴。
      </div>
    );
  }
  return (
    <div data-testid="trajectory-pane" className="h-full min-h-0 min-w-0">
      <TrajectoryView
        trajectory={trajectory}
        selectedRowId={selectedRowId}
        onSelectRow={setSelectedRowId}
      />
    </div>
  );
}

export function TurnTimeline({
  turns,
  viewMode,
  variant = "desktop",
  trajectoryJump,
  errorMsg,
  daemonRestartedHint,
  autoResumeEntries,
  // sessionStatus 不解构：原 pending 卡 ended/failed 门控已随卡迁
  // PendingDialogDock（2026-10-22-askuser-dock-inputbar），prop 保留在
  // interface（消费方零改，语义位留给终态时间线交互）。
  dialogHistory,
  onResend,
  onSwitchProvider,
  hasOnlineProvider,
  emptyProviderLabel,
  detailLevel,
  streamFooter,
  highlightTurnKey,
  suppressFollowBottom = false,
  forkEntry,
  expandPreview,
  fileChangesSummary = true,
  sessionId,
  historyLoading = false,
}: TurnTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // 2026-10-22-session-trajectory-third-view（D-001）：轨迹是第三个顶层视图，
  // 不再有「进度」内的「时间线 / 轨迹」第二层开关。
  const showTrajectory = viewMode === "trajectory";

  // ql-20260822-010：贴底跟随——原实现每次 turns 更新无条件 scrollTo 底部，
  // 用户上滚读历史时被流式更新反复拉回底部。改为：onScroll 维护「距底 <
  // 阈值」ref，仅贴底时跟随新内容滚底；新增 pending 轮（用户刚发送/入队
  // 消息的占位 turn）例外强制回底——用户应立即看到自己发出的消息。
  const isNearBottomRef = useRef(true);
  const lastTurnKeyRef = useRef<string | null>(null);
  // quick（ql-20260916-018）：首轮身份镜像——prepend 判定（见 [turns] effect）。
  const firstTurnKeyRef = useRef<string | null>(null);
  // quick（ql-20260916-018）：prepend 后贴底跟随静默截止时间（见 [turns] effect）。
  const prependFollowMuteUntilRef = useRef(0);
  // quick（ql-20260916-019）：最后一轮签名镜像（runId+输出长度+状态）——贴底
  // 跟随的「末轮变化」判据（见 [turns] effect 注释）。
  const lastSigRef = useRef<string | null>(null);

  // ── 回到底部悬浮按钮 + 新消息计数（ql-20260903-023，照群聊 group-chat-panel
  //    同款移植）：离开底部后按钮出现；离开期间新增轮数显示「N 条新消息」。
  //    锚定守卫：末轮身份未变（仅触顶翻页 prepend 历史页）不计入——否则向上
  //    加载历史会把 prepend 条数误计成「新消息」。末轮身份在渲染期直接从
  //    turns 计算（不经 effect/ref——ref 更新不触发重渲染，计数会滞后）。 ──
  const [nearBottom, setNearBottom] = useState(true);
  const [bottomAnchor, setBottomAnchor] = useState<{
    count: number;
    lastIdentity: string | null;
  } | null>(null);

  // ── task-07（2026-09-09-askuser-pi-cursor / FR-03 / design §Wave B.3）：
  //    marker 提问卡已答态 best-effort 判定——该轮之后已存在用户消息（后续 turn
  //    有 prompt；displayTurns 本地数据，无后端状态；启发式不区分「回答」与
  //    「无关插话」，仅展示层语义）。一次逆序扫描派生 per-row 布尔进 memo 行
  //    （与 isHighlighted 同法，R-07：布尔值变化只重渲染受影响行）。 ──
  const hasUserMessageAfter = useMemo(() => {
    const flags = new Array<boolean>(turns.length);
    let seen = false;
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      flags[i] = seen;
      if ((turns[i]?.prompt ?? "").trim().length > 0) seen = true;
    }
    return flags;
  }, [turns]);

  // task-11（FR-16 / design E7）：会话级汇总只吃各轮已注入的快照字段（props 派生，
  // 零取数）。挂载方未接线（两字段都缺）的轮由汇总的聚合函数跳过，不出空卡。
  const fileChangesSummaryEntries = useMemo(
    () =>
      turns.map((turn) => ({
        snapshot: turn.fileChanges ?? null,
        capability: turn.fileChangesCapability ?? null,
      })),
    [turns],
  );

  // 2026-10-23-turn-file-diff-dialog / FR-01：文件行点击目标（弹窗受控态）。
  // sessionId 缺省时 onOpenFileChanges 不下发（undefined），行点击零行为——
  // 旧消费方零回归（FR-04）。useCallback 保引用稳定（TurnRow memo，R-07）。
  const [fileDiffTarget, setFileDiffTarget] = useState<{
    runKey: string;
    path: string;
    status?: FileChangeStatus;
    agentEdited?: boolean;
  } | null>(null);
  const handleOpenFileChanges = useCallback(
    (
      runKey: string,
      file: {
        path: string;
        status?: FileChangeStatus;
        agentEdited?: boolean;
      },
    ) => {
      // agentEdited 透传（评审 P1 修复：此前漏写字段致弹窗文案二态在真实 UI
      // 链路恒不生效——组件直传 prop 的测试测不出该断链）。
      setFileDiffTarget({
        runKey,
        path: file.path,
        status: file.status,
        agentEdited: file.agentEdited,
      });
    },
    [],
  );

  const lastTurnIdentity = (() => {
    const last = turns[turns.length - 1];
    return last ? `${last.runId}:${last.turn ?? "-"}` : null;
  })();
  const newTurnCount = (() => {
    if (!bottomAnchor) return 0;
    if (lastTurnIdentity === bottomAnchor.lastIdentity) return 0;
    return Math.max(0, turns.length - bottomAnchor.count);
  })();

  // 2026-10-14-session-bottom-passive-grow：滚动基线镜像——区分「被动增高」与
  // 「用户上滚」。大纲后到中段插入预览卡时列表高度骤增，浏览器对视口未动也
  // 派发 scroll 事件（距底从 <80px 瞬变数千 px）——旧 handleScroll 直接按距离
  // 清 isNearBottomRef，贴底跟随被关，上轮 length 分量修复被此守卫拦下（实测
  // 3 次冷加载 2 次停距底 9092px）。被动增高判定：scrollHeight 增长且
  // scrollTop 未减少（容差 4px 布局抖动；50px 为显著增高阈，忽略 markdown 撑
  // 开的微小抖动）→ 不改变贴底判定、不设新消息计数锚（用户没离开底部），
  // 仅更新基线。
  const scrollBaselineRef = useRef<{ top: number; height: number } | null>(null);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const prev = scrollBaselineRef.current;
    scrollBaselineRef.current = { top: el.scrollTop, height: el.scrollHeight };
    if (
      prev &&
      el.scrollHeight > prev.height + 50 &&
      el.scrollTop >= prev.top - 4
    ) {
      // 被动增高（中段插入/内容撑开）：视口未上移——保持贴底判定原值。
      return;
    }
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    isNearBottomRef.current = near;
    // grace-window：每次真实贴底刷新记忆时间戳（宽限窗锚点）。
    if (near) lastBottomAnchoredAtRef.current = Date.now();
    setNearBottom((prev) => (prev === near ? prev : near));
    if (near) {
      // 回到底部（含点击悬浮按钮后的滚底触发）→ 计数锚清零。
      setBottomAnchor((prev) => (prev === null ? prev : null));
    } else {
      setBottomAnchor(
        (prev) => prev ?? { count: turns.length, lastIdentity: lastTurnIdentity },
      );
    }
  };

  /** 点击悬浮按钮平滑回底（滚底 onScroll 触发后锚点自然清零）。 */
  const jumpToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el || typeof el.scrollTo !== "function") return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    isNearBottomRef.current = true;
    setNearBottom(true);
    setBottomAnchor(null);
  }, []);

  // quick（ql-20260921-003-42be）：贴底重申循环——组件级自管理，刻意不挂 effect
  // cleanup：establish 后 SSE 对账等任何二次 turns 提交都会重跑 [turns] effect，
  // cleanup 会误杀仍在窗口期内的循环（新 effect 因末轮签名不变不再启动，视口
  // 永久停在高度未稳定时的落位）；StrictMode（reactStrictMode=true）dev 双跑
  // 同理。终止只有三个条件：窗口到期 / 用户上滚接管（isNearBottomRef=false）/
  // 容器脱离文档（真卸载兜底，isConnected 下一帧即停；StrictMode 模拟卸载不
  // 脱离 DOM，循环存活）。每次贴底 scrollTo 调用即续期重开窗口（流式期间
  // turns 更新持续跟随）。重申判据含 clientHeight（视口压缩同样产生距底）。
  const bottomReassertRef = useRef<{
    el: HTMLElement;
    cancelled: boolean;
    rafId: number;
  } | null>(null);
  const startOrRenewBottomReassert = useCallback((el: HTMLElement) => {
    const prev = bottomReassertRef.current;
    if (prev) {
      prev.cancelled = true;
      cancelAnimationFrame(prev.rafId);
    }
    const state = { el, cancelled: false, rafId: 0 };
    let lastH = el.scrollHeight;
    let lastCH = el.clientHeight;
    const deadline = Date.now() + BOTTOM_REASSERT_WINDOW_MS;
    const stop = () => {
      if (bottomReassertRef.current === state) bottomReassertRef.current = null;
    };
    const tick = () => {
      if (state.cancelled) return;
      if (!el.isConnected) return stop(); // 卸载/容器替换
      if (Date.now() > deadline) return stop(); // 窗口到期
      if (!isNearBottomRef.current) return stop(); // 用户上滚接管 → 弃贴底
      const h = el.scrollHeight;
      const ch = el.clientHeight;
      if (h !== lastH || ch !== lastCH) {
        lastH = h;
        lastCH = ch;
        el.scrollTo(0, h);
      }
      state.rafId = requestAnimationFrame(tick);
    };
    state.rafId = requestAnimationFrame(tick);
    bottomReassertRef.current = state;
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof el.scrollTo !== "function") return;
    const last = turns[turns.length - 1] ?? null;
    const turnKey = last ? `${last.runId}:${last.turn ?? "-"}` : null;
    // quick（ql-20260916-018）：prepend 判定——首轮身份变化 = 「加载更早」向上
    // 插入了旧内容（流式/新消息只改末轮，首轮不动）。用户上拉阅读历史时距底
    // 可能瞬时 <80px（isNearBottom 误真），prepend 触发本 effect 会把视口拉回
    // 最新轮（用户实测「往上拉弹到最新轮次」）。首轮变化（非首挂载）跳过贴底。
    const first = turns[0] ?? null;
    const firstKey = first ? `${first.runId}:${first.turn ?? "-"}` : null;
    const isPrepend =
      firstTurnKeyRef.current !== null && firstKey !== firstTurnKeyRef.current;
    firstTurnKeyRef.current = firstKey;
    // quick（ql-20260916-018）：prepend 落地后 3s 内贴底跟随休眠——content-visibility
    // 高度撑开/塌缩期间浏览器可能瞬间把视口钳到新底（near 误真），随后任何 turns
    // 提交（流式/队列 tick）都会触发贴底 scrollTo(h) 把用户拉到最新轮（实测步骤
    // 7 弹回精确 = h-视口）。窗口期过后（高度稳定）恢复常态贴底。
    if (isPrepend) prependFollowMuteUntilRef.current = Date.now() + 3000;
    if (isPrepend) return;
    if (Date.now() < prependFollowMuteUntilRef.current) return;
    // 占位 turn（status=pending）首次出现视为「用户刚发送」→ 无条件回底；
    // 同一 turn 后续状态更新（running/completed）不再触发强制回底。
    const isNewPendingTurn =
      last !== null && last.status === "pending" && lastTurnKeyRef.current !== turnKey;
    lastTurnKeyRef.current = turnKey;
    // ql-20260825-011：用户正在选中文字（复制中）时不自动滚底——流式 delta
    // 每次更新 turns 都会拉底，反复破坏进行中的选区。
    const selecting =
      typeof window !== "undefined" &&
      (() => {
        const sel = window.getSelection();
        return sel != null && !sel.isCollapsed && sel.toString().length > 0;
      })();
    if (selecting) return;
    // quick（ql-20260916-017）：跳转进行中不贴底（见 props 注释）。
    if (suppressFollowBottom) return;
    // quick（ql-20260916-019）：贴底跟随仅在「最后一轮发生变化」（新消息/流式
    // 输出增长/占位轮出现）时触发——prepend 只在头部加旧内容、最后一轮不变，
    // 天然永不触发（此前依赖 isNearBottomRef（初始 true、各种时序下陈旧为真）
    // + prepend 静默窗组合守卫，实测仍被穿透：触顶加载突发落地瞬间视口被钳到
    // 新底 → near 误真 → 后续任意 turns 提交拉底。本不变量与滚动位置无关，
    // 彻底消除「上拉读历史被弹回最新轮」）。
    // 2026-10-14-session-bottom-follow-insert：lastSig 补 length 分量——初始
    // 日志窗口贴底完成后全量大纲**后到**（归并层把预览卡插进中段：末轮不变、
    // 列表高度剧增），旧签名不触发滚动而 2.5s 高度重申窗口已过 → 视口绝对位
    // 置不动、内容被推下 → 停在倒数第几轮（用户实测「有时候没滚到底」根因）。
    // 中段/尾部插入（预览卡、孤儿补建、预取装配）同跟随；prepend 路径已被
    // 上方 isPrepend 早退 + 3s 静默窗守卫，上滚读历史由 isNearBottomRef 守卫，
    // 跳转由 suppressFollowBottom 守卫——三道既有守卫不动。
    const lastSig = last
      ? `${last.runId}:${(last.output ?? "").length}:${last.status}:${turns.length}`
      : null;
    const lastChanged = lastSigRef.current !== lastSig;
    lastSigRef.current = lastSig;
    if (
      isNewPendingTurn ||
      ((isNearBottomRef.current || inBottomGraceWindow()) && lastChanged)
    ) {
      el.scrollTo(0, el.scrollHeight);
      // quick（ql-20260921-003-42be）：贴底重申窗口——单次 scrollTo 撞上「高度=
      // 视口高」的未稳定窗口时滚动量为 0，或滚到中途后高度再涨/视口再压缩，
      // 末轮签名不变守卫又使后续 turns 提交不再补滚——视口永久停在错误位置
      //（初始加载不滚到底根因）。见 startOrRenewBottomReassert 注释。
      startOrRenewBottomReassert(el);
    }
  }, [turns, suppressFollowBottom, startOrRenewBottomReassert]);

  // （2026-10-22-askuser-dock-inputbar：pending 提问卡最小化 state、胶囊与决策
  //  pill 定位还原 effect 已整体迁至 PendingDialogDock——渲染于输入框位置，
  //  TurnTimeline 不再承载待答卡。）

  // ── 2026-10-14-session-bottom-resize-observer：内容高度迟到变化的贴底兜底 ──
  // 第四层根因（真浏览器注入取证）：懒加载图片 / markdown 迟渲染 / content-visibility
  // 真实化只改 scrollHeight——不触发 scroll 事件（scrollTop 未变）、无 turns 提交，
  // 2.5s 高度重申窗（BOTTOM_REASSERT_WINDOW_MS）过期后彻底无修正源（实测注入
  // 2000px → delta=2000 永久停住，用户「有时候没完全滚到底」的最后一类根因）。
  // 通解：ResizeObserver 观察滚动容器的**内容子元素**（容器自身 borderBox 由
  // flex 固定不变化）——任何来源的内容增高且用户在底部（isNearBottomRef）时
  // rAF 合帧 scrollTo 底。rAF 合帧：高频回调（流式/markdown 逐块撑开）去重为
  // 一帧一滚（2026-10-13 layout-storm 教训——滚动类处理器禁同步布局写）。
  // 用户上滚接管由 isNearBottomRef 守卫（handleScroll 置 false 后回调恒 no-op）；
  // 降级：无 ResizeObserver（jsdom/极旧浏览器）不挂观测，行为回到重申窗兜底。
  // ── 2026-10-14-session-bottom-grace-window：贴底记忆宽限窗（第六层加固）──
  // 用户实测刷新落位随机（19 轮复现 1 次；复现态：scrollTop=602=布局早期瞬态
  // 假底，贴底判定 near 在加载期被某事件误清后再无自愈路径，RO 随之死寂）。
  // 凶手路径无法稳定定位（低频竞态）——改加固式修复：不追凶手，让系统自愈。
  // 宽限窗：距最近一次贴底 <10s 且用户无真实滚动输入（wheel/touchstart/
  // pointerdown，程序滚动不产生这些事件）期间，内容任何高度变化都强制钉底；
  // 用户真实输入立即让权（回既有语义），超窗亦然。初始挂载视为在窗内（冷加载
  // 全程受保护——「打开即落底」是产品语义，scrollRestoration=manual 后无浏览器
  // 恢复与之竞争）。
  const lastBottomAnchoredAtRef = useRef<number>(Date.now());
  const userScrollTookOverRef = useRef(false);
  useEffect(() => {
    const markUser = () => {
      userScrollTookOverRef.current = true;
    };
    // capture：任何子元素上的真实输入都算接管；程序性 scrollTo 不触发这四类
    // （键盘 PgUp/↑/Home/Space 滚动无 wheel，需 keydown 覆盖）。
    window.addEventListener("wheel", markUser, { capture: true, passive: true });
    window.addEventListener("touchstart", markUser, { capture: true, passive: true });
    window.addEventListener("pointerdown", markUser, { capture: true, passive: true });
    window.addEventListener("keydown", markUser, { capture: true, passive: true });
    return () => {
      window.removeEventListener("wheel", markUser, { capture: true } as AddEventListenerOptions);
      window.removeEventListener("touchstart", markUser, { capture: true } as AddEventListenerOptions);
      window.removeEventListener("pointerdown", markUser, { capture: true } as AddEventListenerOptions);
      window.removeEventListener("keydown", markUser, { capture: true } as AddEventListenerOptions);
    };
  }, []);
  /** 宽限窗内（最近贴底 <10s 且无用户输入）——RO 钉底的放行判据。 */
  const inBottomGraceWindow = () =>
    !userScrollTookOverRef.current &&
    Date.now() - lastBottomAnchoredAtRef.current < 10_000;

  const bottomFollowRafRef = useRef<number | null>(null);
  // 2026-10-14-session-bottom-no-restore（第五层）：禁浏览器刷新滚动恢复——
  // Chrome reload 时恢复上次容器滚动位置，恢复晚到（内容装配后）会覆盖初始
  // 贴底 scrollTo 并经 handleScroll 正常分支清 isNearBottomRef（恢复写入=
  // scrollTop 骤减且 scrollHeight 稳定，不命中被动增高分支），贴底链全死 →
  // 停在上次位置（用户实测刷新落位随机 35/31/3 轮的根因；切换会话路径审计
  // 健康，故障为刷新专有）。刷新=重新打开会话，落底语义与切换一致；卸载还原
  // auto 不影响其它页面刷新体验。
  useEffect(() => {
    if (typeof history === "undefined" || !("scrollRestoration" in history)) {
      return;
    }
    const prev = history.scrollRestoration;
    history.scrollRestoration = "manual";
    return () => {
      history.scrollRestoration = prev;
    };
  }, []);
  // 审查 P2 补口：deps 含「turns 空态」布尔——冷加载首 commit turns=[] 渲染空态
  // div（观察快照只有它），历史到达后空态卸载、.space-y-5 内容容器挂载但不在
  // 快照（死观测盲区，恰好是「点击会话直开」主路径）。布尔翻转（false→true）
  // 时 effect 重跑：重新快照 children（此时内容容器已在）；此后恒 true 不再重跑。
  const hasTurns = turns.length > 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(() => {
      // grace-window：贴底判定 OR 宽限窗（加载期 near 被误清时自动复活钉底）。
      if (!isNearBottomRef.current && !inBottomGraceWindow()) return;
      if (bottomFollowRafRef.current !== null) return; // 合帧去重
      bottomFollowRafRef.current = requestAnimationFrame(() => {
        bottomFollowRafRef.current = null;
        const target = scrollRef.current;
        if (!target || !target.isConnected) return;
        if (!isNearBottomRef.current && !inBottomGraceWindow()) return;
        target.scrollTo(0, target.scrollHeight);
        lastBottomAnchoredAtRef.current = Date.now();
      });
    });
    // 观察直接子（错误条/pending 卡层/内容容器）——turns 空态翻转时经上方 deps
    // 重跑重快照（冷加载空态 div → 内容容器替换的补口）；streamFooter 是内容
    // 容器内部节点，其渲染引起的容器高度变化由容器观察覆盖（审查 P3 注释修正）。
    for (const child of Array.from(el.children)) obs.observe(child);
    return () => {
      obs.disconnect();
      if (bottomFollowRafRef.current !== null) {
        cancelAnimationFrame(bottomFollowRafRef.current);
        bottomFollowRafRef.current = null;
      }
    };
  }, [hasTurns]);
  // rAF 句柄声明在此 effect 外（cleanup 与合帧去重共用）。

  return (
    <>
    {/* ql-20260903-023：relative 包装容器承载「回到底部」悬浮按钮的定位
        （原 fragment 根无定位上下文）；flex 布局角色与原滚动容器等价。 */}
    <div className="relative flex min-h-0 flex-1 flex-col">
    {/* 2026-10-22-trajectory-view-redesign（D-002）：轨迹视图独立占满面板高度，
        与 turn-timeline-scroll 并列（不在滚动流内）——工具栏/时间线才能固定。
        （2026-10-22-askuser-dock-inputbar：pending 提问卡已迁 PendingDialogDock
        渲染于输入框位置，轨迹分支顶部固定层不再需要。） */}
    {showTrajectory ? (
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        {errorMsg && (
          <div className="mb-2 shrink-0 rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
            {errorMsg}
          </div>
        )}
        {turns.length === 0 ? (
          /* 2026-10-23-session-first-load-ux / FR-01：加载在飞优先骨架屏——
             旧静态空态文案（「已就绪」）仅在历史拉取终态（成功空/失败/旧
             消费方不传 prop）时出现，防误读为页面卡死。 */
          historyLoading ? (
            <TurnHistorySkeleton />
          ) : (
          <div className="flex h-full min-h-[260px] flex-col items-center justify-center text-center">
            <p className="text-xs font-medium text-foreground">
              {hasOnlineProvider ? `${emptyProviderLabel} 已就绪` : "没有在线守护进程"}
            </p>
            <p className="mt-1 max-w-[260px] text-[11px] text-muted-foreground">
              {hasOnlineProvider
                ? "首条消息将创建会话；单条 SSE 贯穿整段对话，可中途追问、打断本轮或结束会话。"
                : "启动守护进程后即可发送。"}
            </p>
          </div>
          )
        ) : (
          <div className="min-h-0 flex-1 px-3 py-2">
            <TrajectoryPane turns={turns} jump={trajectoryJump} />
          </div>
        )}
      </div>
    ) : (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      data-testid="turn-timeline-scroll"
      className="min-h-0 flex-1 overflow-y-auto bg-background px-5 pt-5"
      style={{ overflowAnchor: "none" }}
    >
      {errorMsg && (
        <div className="mb-3 rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {errorMsg}
        </div>
      )}
      {/* ql-20260802-001：AskUser 提问记录已改为按 run_id 穿插到对应 turn 内（跟会话
          顺序），不再在此处堆顶展示。pending 实时待答卡 2026-10-22-askuser-dock-inputbar
          起迁 PendingDialogDock 渲染于输入框位置，时间线滚动区不再出现。 */}
      {turns.length === 0 ? (
        /* 2026-10-23-session-first-load-ux / FR-01：加载在飞优先骨架屏——
           旧静态空态文案（「已就绪」）仅在历史拉取终态（成功空/失败/旧
           消费方不传 prop）时出现，防误读为页面卡死。 */
        historyLoading ? (
          <TurnHistorySkeleton />
        ) : (
        <div className="flex h-full min-h-[260px] flex-col items-center justify-center text-center">
          <p className="text-xs font-medium text-foreground">
            {hasOnlineProvider
              ? `${emptyProviderLabel} 已就绪`
              : "没有在线守护进程"}
          </p>
          <p className="mt-1 max-w-[260px] text-[11px] text-muted-foreground">
            {hasOnlineProvider
              ? "首条消息将创建会话；单条 SSE 贯穿整段对话，可中途追问、打断本轮或结束会话。"
              : "启动守护进程后即可发送。"}
          </p>
        </div>
        )
      ) : (
        /* 2026-10-20-session-page-dsh-alignment（FR-04 / D-013@v1 / D-016④）：轮间
           节奏——原 `space-y-5`（20px 等距）改「28px 留白」（每轮下留 pb-7）。
           2026-10-21 用户裁决「轮间 1px hairline 多余」：**只保留留白，不再画线**
           （原 `border-b border-border last:border-b-0` 已移除）；轮与轮靠白处分节。 */
        <div>
          {/* 轨迹分支已移出滚动容器（D-002），此处只渲染对话/进度轮块。 */}
          <>
          {/* task-11（FR-16 / design E7）：会话级文件改动汇总——会话流顶部（首轮之前）。
              无数据时组件自身返回 null（零占位）；`fileChangesSummary={false}` 可关闭。 */}
          {fileChangesSummary && (
            <FileChangesSummary turns={fileChangesSummaryEntries} className="mb-3" />
          )}
          {/* task-01（FR-07 / D-007@v1 / R-07）：highlightTurnKey 在此逐行派生为
              isHighlighted 布尔再进 memo 行（字符串 prop 直传会在值变化时击穿
              全部行 memo）；data-turn-key 锚点在 TurnRow 两分支根元素上。
              task-07（FR-03）：hasUserMessageAfter 同法逐行派生布尔（marker 卡
              已答态 best-effort 判定数据源）。 */}
          {turns.map((turn, idx) => (
            /* 2026-10-20-session-page-dsh-alignment（FR-04 / D-016④）：逐轮节容器——
               只承担视觉分节（pt-0 / pb-28px 留白），不碰任何数据流。
               2026-10-21 用户裁决：轮间 hairline 多余 → 去掉 border-b，
               仅留 pb-7（28px）作轮与轮之间的白处分隔。 */
            <div
              key={turn.runId}
              data-testid="turn-block"
              className="pb-7"
            >
            <TurnRow
              turn={turn}
              viewMode={viewMode}
              isHighlighted={highlightTurnKey === (turn.realRunId ?? turn.runId)}
              hasLaterUserMessage={hasUserMessageAfter[idx] ?? false}
              dialogHistory={dialogHistory}
              onResend={onResend}
              onSwitchProvider={onSwitchProvider}
              daemonRestartedHint={daemonRestartedHint}
              /* task-05（2026-10-26-mobile-four-page-layout-fix / R-07）：mobile
                 布尔基元下传（variant 派生，memo 友好）；desktop 宿主恒 false 零变化。 */
              mobile={variant === "mobile"}
            autoResumeEntries={autoResumeEntries}
              /* task-08（session-fork / FR-01 / R-07）：分叉入口 per-row 基元派生
                 （provider 字符串 / anchor string|null / seq number / 稳定回调），
                 map 对象不进 memo 行；seq 兜底 idx+1（与目录轨孤儿轮编号同口径）。 */
              forkProvider={forkEntry?.provider}
              forkAnchor={
                forkEntry
                  ? (forkEntry.engineAnchors.get(turn.realRunId ?? turn.runId) ?? null)
                  : undefined
              }
              forkSeq={turn.turn ?? idx + 1}
              onForkTurn={forkEntry?.onForkTurn}
              onExpandPreview={expandPreview}
              detailLevel={detailLevel}
              onOpenFileChanges={
                sessionId != null ? handleOpenFileChanges : undefined
              }
            />
            </div>
          ))}
          {/* ql-20260823-002-6a1a：消息流末尾注入位（props.streamFooter）——
              最后一个 turn 之后、同一流容器内渲染，附加信息以
              「对话流里的一条消息」形态出现（ql-20260904-021 起暂无消费方）。
              2026-10-20-session-page-dsh-alignment：流容器由 space-y-5 改逐轮
              padding+hairline 后，末尾注入位自身的上间距由末轮 pb-7 提供。 */}
          {streamFooter}
            </>
        </div>
      )}
    </div>
    )}
    {/* 回到底部悬浮按钮（ql-20260903-023，照群聊同款）：离开底部出现；
        离开期间新增轮数显示「N 条新消息」（仅触顶翻页 prepend 不计入），
        点击平滑回底。轨迹分支没有滚动流，不渲染（D-002）。 */}
    {!showTrajectory && !nearBottom && (
      <button
        type="button"
        data-testid="turn-jump-bottom"
        onClick={jumpToBottom}
        className="absolute bottom-3 right-4 z-10 inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-md transition-colors hover:bg-muted"
      >
        <ArrowDown aria-hidden className="h-3.5 w-3.5" />
        {newTurnCount > 0 ? `${newTurnCount} 条新消息` : "回到底部"}
      </button>
    )}
    </div>
    {/* 2026-10-23-turn-file-diff-dialog / FR-01：文件行点击 → 该文件本轮变更内容
        弹窗（受控挂 TurnTimeline 根，行内只上抛目标）。sessionId 未接线的旧消费方
        永不为 null 目标（onOpenFileChanges 不下发），此处恒不渲染（FR-04 零回归）。 */}
    {sessionId != null && fileDiffTarget != null && (
      <TurnFileDiffDialog
        sessionId={sessionId}
        runKey={fileDiffTarget.runKey}
        path={fileDiffTarget.path}
        status={fileDiffTarget.status}
        agentEdited={fileDiffTarget.agentEdited}
        open
        onOpenChange={(next) => {
          if (!next) setFileDiffTarget(null);
        }}
      />
    )}
    </>
  );
}

/* ---------- helpers ---------- */

/* ═════════ v2 段模型渲染（task-06 / 2026-08-19-session-stream-ux） ═════════ */

/** task-06：轮处于运行中三态（状态条 / 思考占位的渲染门控）。 */
function isLiveTurn(status: TurnUiStatus): boolean {
  return status === "running" || status === "pending" || status === "interrupting";
}

/**
 * 运行中尚无答复/文本段的思考占位（三点脉冲 + 文案）——markup 自旧内联渲染抽出
 * （task-06 双路径共用：旧路径 output 空时、v2 路径无 text 段时）。全部视图文案
 * 「执行中…」、对话视图「正在思考…」（原语义平移）。
 */
function ThinkingPlaceholder({ viewMode }: { viewMode: SessionViewMode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-muted text-muted-foreground">
        <Bot className="h-3.5 w-3.5" aria-hidden />
      </span>
      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-md border bg-card px-4 py-3 shadow-sm">
        {/* task-13（FR-05 / D-004@v1）：三点由内联 animate-pulse tailwind 类改为
            .sh-typing-dots utility（stagger 脉冲动画统一由 globals.css 承担，
            reduced-motion 静止半透明退化见该文件）；语义文案不变。 */}
        <span aria-hidden className="sh-typing-dots">
          <span />
          <span />
          <span />
        </span>
        <span className="ml-1 text-xs text-muted-foreground">
          {viewMode === "all" ? "执行中…" : "正在思考…"}
        </span>
      </div>
    </div>
  );
}

/** 段时间戳（AskUser 穿插排序用）：text/tool 用 startedAt、thinking/stderr 用 ts；
 *  subagent_stub 是临时容器无自身时刻 → null（排序视为 0，同旧路径缺 ts 语义）。 */
function segmentTsOf(seg: TurnSegment): number | null {
  switch (seg.kind) {
    case "text":
      return seg.startedAt;
    case "thinking":
      return seg.ts;
    // 2026-10-25-trajectory-source-model：请求头快照段取捕获 ts（仅轨迹消费，
    // 轮块流渲染已跳过——此分支只为类型穷尽，不参与 AskUser 穿插）。
    case "request_header":
      return seg.ts;
    case "tool":
      return seg.startedAt;
    case "stderr":
      return seg.ts;
    // ql-20260917-006：压缩摘要 / 压缩状态段取捕获时刻（同 stderr 语义）。
    case "compact":
      return seg.ts;
    case "compact_status":
      return seg.ts;
    // 2026-10-28-model-retry-visible：模型重试过程段取捕获时刻（同 compact_status）。
    case "model_retry":
      return seg.ts;
    // 2026-08-25-unified-floating-session task-11：前导段取捕获时刻。
    case "preamble":
      return seg.ts;
    case "subagent_stub":
      return null;
    // task-08（agent-file-upload-mcp）：file 段渲染走 SegmentView（文件卡片），
    // 排序时间戳取 log ts（同 thinking/stderr 语义）。
    case "file":
      return seg.ts;
    // ql-20260920-006：轮内用户消息段（引导注入留痕）取捕获时刻——「全部」视图
    // 与 AskUser 记录同款按 ts 穿插；对话视图走段序（实时追加 / 回放按 ts 插入）。
    case "user_msg":
      return seg.ts;
  // 2026-10-21-task-wakeup-restore：唤醒通知折叠行取捕获时刻（同 preamble 语义）。
    case "turn_trigger":
      return seg.ts;
  }
}

/** 「全部（进度）」视图合并时间线项：段 或 AskUser 提问记录（按 ts 与段穿插）。 */
type SegmentTimelineItem =
  | { kind: "segment"; segment: TurnSegment; ts: number | null }
  | { kind: "askUser"; dialog: SessionDialogRead; ts: number | null };

/**
 * task-02（2026-09-15-subagent-three-pane-display / FR-04 / D-002@v1 ①）：对话
 * 视图段过滤谓词——在 text/file 基础上放宽纳入子代理容器段（tool 段带 children
 * 的子代理归属，或 subagent_stub 兜底段），容器段经 SegmentView 分发到
 * SubagentBlockView 渲染（渲染侧零改动），修复默认视图下子代理整体不可见。
 *
 * 排除项保持不变：thinking / 普通 tool（无 children）/ stderr / preamble 段仍被
 * 过滤（渲染经济 FR-06 不回归）；dispatch_worker 团队分身段也不进对话视图
 * （团队卡仍仅「全部（进度）」视图，避免混入对话流）——判定语义同
 * turn-segment-views.tsx 的 isTeamDispatchTool（该函数模块私有未导出，此处本地
 * 等价实现：取 `__` 末段短名比对，兼容 mcp__<server>__ 前缀与 daemon 裸名两形态）。
 */
function isConversationSegment(seg: TurnSegment): boolean {
  if (seg.kind === "text" || seg.kind === "file") return true;
  if (seg.kind === "subagent_stub") return true;
  // ql-20260920-006（2026-09-18-single-chat-steering 修订）：引导消息（user_msg）
  // 必须在对话视图可见——右对齐用户气泡随轮内输出按时间位置穿插（与 text/file
  // 同级放行；不进对话流的思考/工具段过滤不变）。
  if (seg.kind === "user_msg") return true;
  // ql-20260917-006：压缩摘要段进对话视图——原位特判渲染一行「上下文已重新
  // 压缩」短提示（CompactNoticeChip，替代此前大段摘要气泡刷屏）；compact_status
  // 不在此判定（运行中才进对话流，见 SegmentedTurnBody turnStatus 过滤）。
  if (seg.kind === "compact") return true;
  // 2026-10-21-task-wakeup-restore：唤醒通知折叠行进对话视图（TaskWakeupNoticeView
  // 两视图共用——唤醒轮不再「无人说话 agent 凭空接话」不可溯源）。
  if (seg.kind === "turn_trigger") return true;
  return (
    seg.kind === "tool" &&
    seg.children.length > 0 &&
    (seg.toolName ?? "").split("__").pop() !== "dispatch_worker"
  );
}

/**
 * task-06（FR-01 / FR-02 / FR-06）：v2 段模型轮渲染主体（segments 非 undefined 的
 * turn 专用，双视图分支 + 内置轮级状态条）：
 *
 *   - 「对话」视图（viewMode=conversation）：渲染 text 段与 file 段（每段独立气泡，
 *     贴原型 .seg-text——file 段是面向用户的交付物，agent-file-upload-mcp FR-01 聊天流
 *     呈现）+ 子代理容器段（tool 带 children / subagent_stub，task-02 放宽过滤后经
 *     SegmentView 渲染为子代理卡片，见 isConversationSegment）；思考/普通工具/stderr/
 *     团队分身段不挂载——渲染经济，FR-06），轻量 ❓
 *     AskUser 记录由 convoTimeline 按 created_at 与段时刻合并排序穿插进对话流
 *     （2026-10-10-dialog-qa-inplace，原「外层整组前置答复之前」已废弃；
 *     segments undefined 的旧回退轮仍由外层原位渲染）；
 *   - 「全部（进度）」视图（viewMode=all）：完整段时间线——ml-9 竖线容器（原型
 *     .turn-timeline：左缩进 36px + 2px 边线 + 14px 内距 + 6px 段距）内按序渲染
 *     SegmentView 段组件族（key=segment.id，段级 memo 由 task-05 保证）；AskUser
 *     提问记录按 created_at 与段 ts 合并排序穿插（merged 排序逻辑平移自旧路径；
 *     2026-10-25-session-tab-visual-unify 起渲染统一用对话视图同款 DialogQaBlock
 *     问答块，原 AskUserToolCard 工具卡已删）；
 *   - TurnStatusBar 内置（FR-02 / Grill X-09）：轮处于 pending/running/interrupting
 *     且计时锚点 turnStartedAt 有值时渲染（两视图同显，段序列之前）；终态或锚点
 *     缺失不挂载；
 *   - 运行中且尚无 text 段：显示思考占位（ThinkingPlaceholder，同旧路径文案）；
 *   - replyAt：答复完成时间，段序列之后小字显示（特性保持）。
 *
 * 渲染经济性：段合并时间线 / 文本段过滤均 useMemo（segments 引用未变时跳过重算，
 * 装配器 path-copy 保证未触及段引用稳定）；段组件由 SegmentView 内部 memo。
 */
/** 2026-10-10-dialog-qa-inplace：对话视图轻量 ❓ 提问记录卡——原「整组前置轮
 *  头部」的同一标记原位组件化，供 SegmentedTurnBody 按时间戳穿插与旧回退路径
 *  两处复用。空 QA（不可解析 payload）渲染 null。
 *  2026-10-25-session-tab-visual-unify：升格两视图唯一 AskUser 渲染（进度视图
 *  原用 AskUserToolCard 工具卡，用户裁决统一优先对话视图形态）；原仅对话视图
 *  语境合理的 ml-9 缩进移除（对话视图与其它 agent 段左缘对齐、进度视图不与
 *  竖线容器双重缩进），宽度随 agent 反馈信息块统一规则（整行宽度-120px）。 */
function DialogQaBlock({ dialog }: { dialog: SessionDialogRead }) {
  const qa = extractDialogQA(dialog);
  if (qa.length === 0) return null;
  return (
    <div
      data-testid="dialog-qa-block"
      className="max-w-[calc(100%-120px)] space-y-0.5 rounded-md border border-indigo-200 bg-indigo-50/40 px-3 py-1.5 text-xs leading-5"
    >
      {qa.map((item, i) => (
        <div key={i} className="break-words">
          <span className="font-medium text-foreground">❓ {item.question}</span>
          <span className="ml-1 text-muted-foreground">
            →{" "}
            {item.answerText ??
              (dialog.status === "pending" ? "（待答）" : "（未回答）")}
          </span>
        </div>
      ))}
    </div>
  );
}

function SegmentedTurnBody({
  segments,
  turnStatus,
  turnStartedAt,
  viewMode,
  runKey,
  dialogHistory,
  markerAnswered,
  onMarkerSubmit,
  turnTokens,
  currentPhase,
  mobile = false,
}: {
  segments: TurnSegment[];
  turnStatus: TurnUiStatus;
  turnStartedAt: number | null | undefined;
  viewMode: SessionViewMode;
  /** AskUser 提问历史按 run_id 过滤键（realRunId ?? runId，同旧路径）。 */
  runKey: string;
  /** 手机端窄视口布尔（2026-10-26-mobile-four-page-layout-fix task-05，默认 false）：
   *  下传轮尾 marquee 隐藏 LIVE；缺省 desktop 零变化。 */
  mobile?: boolean;
  dialogHistory: SessionDialogRead[];
  /** task-07：marker 提问卡已答态 best-effort（该轮之后已存在用户消息）。 */
  markerAnswered: boolean;
  /** task-07：marker 提问卡提交回调（答案作下一条用户消息，父级传 onResend）。 */
  onMarkerSubmit: (_prompt: string) => void;
  /** 2026-10-25-marquee-awaiting-real-data：轮级累计 token（tokens 事件实时更新）。 */
  turnTokens?: { input: number | null; output: number | null } | null;
  /** 2026-10-26-session-stage-progress（FR-04）：轮当前阶段（turn 对象透传）。 */
  currentPhase?: TurnPhaseState | null;
}) {
  const turnDialogs = useMemo(
    () => dialogHistory.filter((d) => d.run_id === runKey),
    [dialogHistory, runKey],
  );
  const textSegments = useMemo(
    () =>
      viewMode === "all"
        ? null
        : segments.filter(
            // ql-20260917-006：compact_status 仅运行中轮进对话流（实时
            // 「上下文正在重新压缩」提示）；终态轮不显示（成功后紧随的
            // compact 摘要段已是「已重新压缩」标记，失败态经「全部」
            // 视图 amber 行可见）。
            // 2026-10-28-model-retry-visible：model_retry 同款门控——仅运行中
            // 轮进对话流（实时「模型限流重试中」提示）；终态轮对话正文不渲染
            // （失败原因由 RunErrorItem 失败卡承担），「全部」视图保留过程行。
            (s) =>
              isConversationSegment(s) ||
              (isLiveTurn(turnStatus) &&
                (s.kind === "compact_status" || s.kind === "model_retry")),
          ),
    [viewMode, segments, turnStatus],
  );
  // 2026-10-22-conversation-live-marquee（FR-01~FR-06）：对话视图 + 运行中轮次
  // 才派生跑马灯条目——进度/轨迹视图、终态轮、旧回退路径均不消费（渲染门控
  // 与派生门控同源，避免无谓递归）。条目上限与去重由纯函数承担。
  const liveEntries = useMemo(
    () =>
      viewMode === "conversation" && isLiveTurn(turnStatus)
        ? deriveLiveMarqueeEntries(segments)
        : [],
    [viewMode, turnStatus, segments],
  );
  // 2026-10-25-marquee-awaiting-real-data（FR-01）：最后事件服务端时间戳——
  // 等待计时真实锚点（刷新/中途打开不重置）。取条目三时刻最大值。
  const liveLastEventAt = useMemo(() => {
    if (liveEntries.length === 0) return null;
    let max: number | null = null;
    for (const entry of liveEntries) {
      const ts = entry.endedAt ?? entry.startedAt ?? null;
      if (ts != null && (max == null || ts > max)) max = ts;
    }
    return max;
  }, [liveEntries]);
  const timeline = useMemo(() => {
    if (viewMode !== "all") return null;
    const items: SegmentTimelineItem[] = [
      ...segments.map((s) => ({ kind: "segment" as const, segment: s, ts: segmentTsOf(s) })),
      ...turnDialogs.map((d) => ({
        kind: "askUser" as const,
        dialog: d,
        ts: d.created_at ? Date.parse(d.created_at) : null,
      })),
    ];
    // 排序规则平移旧路径：缺 ts（NaN/null）视为 0；稳定排序保文档序。
    items.sort(
      (a, b) => (Number.isFinite(a.ts) ? a.ts! : 0) - (Number.isFinite(b.ts) ? b.ts! : 0),
    );
    return items;
  }, [viewMode, segments, turnDialogs]);

  // 2026-10-10-dialog-qa-inplace：对话流合并穿插——❓ 提问记录卡（turnDialogs，
  //  ts=created_at）与对话段（textSegments，ts=段时刻）合并稳定排序，提问落在
  //  真实发生的时间位置（两段之间的提问渲染在两段之间），不再整组前置轮头部。
  //  排序约定与「全部」视图时间线（上方 timeline）一致：缺 ts（NaN/null）视为 0、
  //  稳定排序保文档序。段渲染逻辑逐字保留，仅新增 askUser 分支。
  const convoTimeline = useMemo(() => {
    if (viewMode === "all" || textSegments == null) return null;
    // 评审 P3-4 修复：payload 不可解析（QA 空）的 dialog 先行剔除——避免
    // 「零对话段 + 仅畸形 dialog」的轮挂出孤头像而唯一子项渲染 null（旧路径
    // 该情形完全无输出）；可解析性判定与 DialogQaBlock 渲染门同源。
    const renderableDialogs = turnDialogs.filter(
      (d) => extractDialogQA(d).length > 0,
    );
    const items: Array<
      | { kind: "segment"; segment: TurnSegment; ts: number | null }
      | { kind: "askUser"; dialog: SessionDialogRead; ts: number | null }
    > = [
      ...textSegments.map((s) => ({
        kind: "segment" as const,
        segment: s,
        ts: segmentTsOf(s),
      })),
      ...renderableDialogs.map((d) => ({
        kind: "askUser" as const,
        dialog: d,
        ts: d.created_at ? Date.parse(d.created_at) : null,
      })),
    ];
    items.sort(
      (a, b) =>
        (Number.isFinite(a.ts) ? a.ts! : 0) - (Number.isFinite(b.ts) ? b.ts! : 0),
    );
    return items;
  }, [viewMode, textSegments, turnDialogs]);

  return (
    <>
      {/* 轮级状态条（FR-02）：运行中三态 + 计时锚点有值才挂载（终态消失；锚点缺失
          容错不显示，消费方 task-09 接线后常态有值）。位置贴原型：whoLine 之后、
          段时间线之前，全宽。 */}
      {(turnStatus === "pending" || turnStatus === "running" || turnStatus === "interrupting") &&
        turnStartedAt != null && (
          <TurnStatusBar
            turnStartedAt={turnStartedAt}
            turnStatus={turnStatus}
            segments={segments}
            currentPhase={currentPhase ?? null}
          />
        )}
      {/* 「全部（进度）」：完整段时间线（段 + AskUser 按时间戳穿插）。空轮不渲染空容器。 */}
      {timeline != null && timeline.length > 0 && (
        /* 2026-10-21 用户裁决「对比加强」：助手列（过程行 + 答复正文同列）分两区——
           行间节奏仍走单一 spacing 值 7px（gap-[7px]），答复正文块（.seg-text-body）
           额外上留 7px，故「过程块 ↔ 答复块」的实际间隔 = 7 + 7 = 14px，两区读起来
           是两块而不是一条流水；过程行彼此保持紧凑（不跟着放大到 14px）。
           纯间距，零行为改动、零颜色改动（三主题共用一条规则）。 */
        <div
          data-testid="turn-progress-column"
          className="ml-9 flex flex-col gap-[7px] border-l-2 border-muted pl-3.5 [&>.seg-text-body]:mt-[7px]"
        >
          {timeline.map((item) =>
            item.kind === "segment" ? (
              <SegmentView key={item.segment.id} segment={item.segment} />
            ) : (
              // 2026-10-25-session-tab-visual-unify：进度视图 AskUser 统一用对话
              // 视图同款问答块（原 AskUserToolCard 工具卡形态弃，组件已删除）。
              <DialogQaBlock key={`dialog-${item.dialog.request_id}`} dialog={item.dialog} />
            ),
          )}
        </div>
      )}
      {/* 「对话」视图（2026-09-09-sessions-visual-refresh task-05 / D-003@v1）：
          agent 侧挂共享渐变光环头像（ChatMessageAvatar），text/file 段气泡行与
          头像横排（task-02 后子代理容器段卡片也在此列，随 SegmentView 分发）；
          「全部」视图不挂头像（Grill G-03——进度时间线保持 ml-9 竖线
          容器原样式）。2026-10-10-dialog-qa-inplace：渲染列表改 convoTimeline
          （段 + ❓ 提问记录合并排序穿插）；仅有提问无对话段的轮也渲染（旧行为
          的 ❓ 块同样不依赖段存在）。 */}
      {convoTimeline != null && convoTimeline.length > 0 && (
        <div className="flex items-start gap-2.5">
          <ChatMessageAvatar kind="agent" title="智能体" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {/* task-07（2026-09-09-askuser-pi-cursor / FR-03 / D-003@v2）：对话视图
                text 段先过 parseAskUserMarker——命中则该段原位渲染提问卡（AskUserMarkerCard）
                并以 textBefore 作正文（复用 TextSegmentView 气泡，标记原文不显示；
                纯标记段无正文气泡）；未命中走 SegmentView 零变化。 */}
            {convoTimeline.map((item) => {
              if (item.kind === "askUser") {
                return (
                  <DialogQaBlock
                    key={`dialog-${item.dialog.request_id}`}
                    dialog={item.dialog}
                  />
                );
              }
              const s = item.segment;
              // ql-20260917-006：compact 摘要段原位特判——一行短提示替代大段
              // 摘要气泡（全文在「全部（进度）」视图折叠卡）；compact_status
              // 运行中实时提示行（CompactStatusRowView，success 渲染 null）。
              if (s.kind === "compact") {
                return <CompactNoticeChip key={s.id} />;
              }
              // 2026-10-21-task-wakeup-restore：唤醒通知折叠行（对话视图原位渲染，
              // 两视图共用组件）。
              if (s.kind === "turn_trigger") {
                return <TurnTriggerView key={s.id} segment={s} />;
              }
              if (s.kind === "compact_status") {
                return <CompactStatusRowView key={s.id} segment={s} />;
              }
              if (s.kind !== "text") return <SegmentView key={s.id} segment={s} />;
              const marker = parseAskUserMarkerCached(s.text);
              if (!marker) return <SegmentView key={s.id} segment={s} />;
              return (
                <Fragment key={s.id}>
                  {marker.textBefore.trim() ? (
                    <TextSegmentView segment={{ ...s, text: marker.textBefore }} />
                  ) : null}
                  <div className="pt-0.5">
                    <AskUserMarkerCard
                      payload={marker.payload}
                      answered={markerAnswered}
                      onSubmit={onMarkerSubmit}
                    />
                  </div>
                </Fragment>
              );
            })}
          </div>
        </div>
      )}
      {/* 运行中尚无 text 段（两视图同规则）：思考占位。 */}
      {isLiveTurn(turnStatus) && !segments.some((s) => s.kind === "text") && (
        <ThinkingPlaceholder viewMode={viewMode} />
      )}
      {/* 2026-10-22-conversation-live-marquee（FR-01 / FR-04）：对话视图运行中
          轮次末尾的实时活动跑马灯——纯感知、不交互；进度/轨迹视图与终态轮
          liveEntries 为空不挂载。位置=本轮最新处（思考占位之后）。
          2026-10-25-marquee-awaiting-real-data：等待条目接入服务端真实计时
          与本轮累计 token。 */}
      {liveEntries.length > 0 && (
        <TurnLiveMarquee
          entries={liveEntries}
          mobile={mobile}
          lastEventAt={liveLastEventAt}
          turnTokens={turnTokens}
        />
      )}
      {/* 2026-10-20-session-page-dsh-alignment（FR-01 / D-016①）：原 quick-3c85b05e
          的「开始 · 结束 · 历时」独立行已删除——它与轮尾状态行重复，时间细节改由
          TurnRow 派生 metaDetail 折进那条唯一元信息行（RoundDivider.detail / all 视图
          turn-meta-detail）。渲染语义不变：仍是 replyAt 存在才显示，锚点缺失时只显
          结束时刻。故本组件不再直接渲染该行（turnStartedAt/replyAt 仍用于运行中状态
          条与调用方派生）。 */}
    </>
  );
}

/**
 * 「全部」视图的思考组卡片（2026-10-19-thinking-zh-translate / FR-04 抽出为
 * 组件以挂翻译 hook）：折叠摘要离线译中、展开正文默认译文可切原文（无
 * streaming 标记——静态回放直翻、实时增长文本走 1.2s 稳定窗防抖）。
 */
function ThinkingProcessCard({ text }: { text: string }) {
  const summary = useThinkingSummary(text);
  return (
    <SessionCollapsible tone="thinking" title="思考过程" summary={summary}>
      <div className="rounded-md bg-muted/50 px-2.5 py-1.5 text-[11px] leading-5 text-muted-foreground">
        <TranslatedThinkingBody text={text} />
      </div>
    </SessionCollapsible>
  );
}

/**
 * ql-20260729-005：「全部」视图的过程项列表，按真实到达顺序渲染。
 * 缩进对齐答复气泡（ml-9 ≈ 助手图标宽度），左侧竖线表示"执行过程"语义。
 * ql-20260730-003：连续 thinking 合并成一整段「思考过程」卡片，被工具/stderr 打断则
 * 分段（参考 agent 日志 mergedThinkingContent），工具卡片穿插其间保留时序；思考正文
 * 与工具结果均用 MarkdownText 渲染（与对话答复一致）。
 */
function TurnDetailsList({
  items,
}: {
  items: Array<SessionProcessItem | { kind: "askUser"; dialog: SessionDialogRead }>;
}) {
  // 先把连续 thinking 合并成单个渲染项（被 tool/stderr/askUser 打断则分段），保留真实顺序
  type RenderItem =
    | { kind: "thinking"; text: string }
    | { kind: "tool"; event: SessionToolEvent }
    | { kind: "stderr"; text: string }
    | { kind: "askUser"; dialog: SessionDialogRead }
    | {
        kind: "file";
        fileId: string;
        name: string;
        size: number;
        mime: string;
        description?: string | null;
        ts?: number;
      }
    // 2026-09-19-tool-report-session-replay（D-003）：系统事件中性行（仅回放产生）
    | { kind: "system_event"; text: string };
  const grouped: RenderItem[] = [];
  for (const item of items) {
    if (item.kind === "thinking") {
      const last = grouped[grouped.length - 1];
      if (last && last.kind === "thinking") {
        last.text = `${last.text}\n${item.text}`;
      } else {
        grouped.push({ kind: "thinking", text: item.text });
      }
    } else if (item.kind === "tool") {
      grouped.push({
        kind: "tool",
        event: { raw: item.raw, result: item.result, status: item.status },
      });
    } else if (item.kind === "askUser") {
      grouped.push({ kind: "askUser", dialog: item.dialog });
    } else if (item.kind === "file") {
      grouped.push({
        kind: "file",
        fileId: item.fileId,
        name: item.name,
        size: item.size,
        mime: item.mime,
        description: item.description,
        ts: item.ts,
      });
    } else if (item.kind === "system_event") {
      // 2026-09-19-tool-report-session-replay（D-003）：直通独立成项，不参与
      // 连续 thinking 合并——系统事件是切轮/注入锚点，须保留真实时序独立可见。
      grouped.push({ kind: "system_event", text: item.text });
    } else {
      grouped.push({ kind: "stderr", text: item.text });
    }
  }
  return (
    <div className="ml-9 space-y-1 border-l-2 border-muted pl-3">
      {grouped.map((item, idx) => {
        if (item.kind === "thinking") {
          return <ThinkingProcessCard key={idx} text={item.text} />;
        }
        if (item.kind === "tool") {
          return <ToolEventCard key={idx} event={item.event} />;
        }
        if (item.kind === "askUser") {
          // 2026-10-25-session-tab-visual-unify：AskUser 统一用对话视图同款
          // 问答块（原 AskUserToolCard 工具卡形态弃，组件已删除）。
          return <DialogQaBlock key={idx} dialog={item.dialog} />;
        }
        if (item.kind === "file") {
          // agent-file-upload-mcp：历史回放的 agent 上传文件卡片（与段渲染路径
          // turn-segment-views 同款「agent 上传了文件」标注 + FileMessageCard）
          return (
            <div key={idx} className="space-y-1">
              <div className="text-[11px] text-muted-foreground">agent 上传了文件</div>
              <FileMessageCard
                fileId={item.fileId}
                name={item.name}
                size={item.size}
                mime={item.mime}
                description={item.description ?? ""}
              />
            </div>
          );
        }
        if (item.kind === "system_event") {
          // 2026-09-19-tool-report-session-replay（D-003）：系统事件居中虚线中性行
          // （原型 .sysrow 形态）——仅回放链路产生；border-border / bg-card /
          // text-muted-foreground 双主题语义类，不复用用户气泡样式、不带「执行中」
          // 假运行语义（回放只读）；超长文本截断、title 悬浮看全文。
          return (
            <div key={idx} className="flex justify-center">
              <div
                title={item.text}
                className="flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-dashed border-border bg-card px-3 py-[3px] text-[11px] text-muted-foreground"
              >
                <span aria-hidden className="shrink-0">⚙</span>
                <span className="min-w-0 truncate">{item.text}</span>
              </div>
            </div>
          );
        }
        // stderr
        return (
          <div key={idx} className="flex items-start gap-1.5 text-[11px] text-amber-700">
            <span aria-hidden className="shrink-0">⚠</span>
            <span className="min-w-0 whitespace-pre-wrap break-words">{item.text}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * ql-20260730-003：单个配对工具事件卡片。
 * 解析 raw（tool_use JSON）为工具名 + 命令 + 复制文本（parseToolRaw，解析失败原样显示），
 * 右上角状态徽章（✓ 成功 / ✗ 失败·被拒 / ⏳ 执行中），result 默认折叠（结果常太长），
 * 展开后用 MarkdownText 渲染。raw 空串=孤儿 result（无配对 use），只显示结果。
 */
function ToolEventCard({ event }: { event: SessionToolEvent }) {
  const parsed = event.raw ? parseToolRaw(event.raw) : null;
  const badge =
    event.status === "ok"
      ? { icon: "✓", cls: "text-emerald-600", title: "执行成功" }
      : event.status === "deny"
        ? { icon: "✗", cls: "text-destructive", title: "执行失败 / 被拒" }
        : { icon: "⏳", cls: "text-brand-600", title: "执行中" };
  const result = event.result?.trim() ?? "";
  return (
    <div className="rounded border border-brand-200 bg-brand-50/40 px-2 py-1.5">
      <div className="mb-0.5 flex items-center gap-1.5 text-[10px] text-brand-700">
        <Wrench className="h-3 w-3 shrink-0" aria-hidden />
        <span className="font-medium">{parsed?.tool ?? (event.raw ? "工具调用" : "工具结果")}</span>
        <span className={cn("font-mono", badge.cls)} title={badge.title} aria-label={badge.title}>
          {badge.icon}
        </span>
        {parsed?.copyText && (
          <button
            type="button"
            onClick={() => {
              const ct = parsed?.copyText ?? "";
              void copyTextToClipboard(ct);
            }}
            className="ml-auto rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
            title="复制命令"
          >
            复制
          </button>
        )}
      </div>
      {event.raw && (
        <div className="break-all font-mono text-[10px] text-muted-foreground" title={event.raw}>
          {parsed?.primary ?? event.raw}
        </div>
      )}
      {result && (
        <SessionCollapsible
          tone="tool"
          title="结果"
          summary={result.slice(0, 60) + (result.length > 60 ? "…" : "")}
        >
          <div className="rounded-md bg-muted/50 px-2 py-1 text-[10px] leading-5 text-muted-foreground">
            <MarkdownText content={result} />
          </div>
        </SessionCollapsible>
      )}
    </div>
  );
}

/**
 * ql-20260730-003：会话气泡内的折叠卡片（灰底思考 / 蓝底工具）。
 * 带摘要的单行折叠条，点击展开内容。替代 agent-log 的 CollapsibleSection
 * （后者日志流小箭头风格与气泡不搭）。融合自 WhaleFall d5466b7e，配 processItems 渲染。
 */
function SessionCollapsible({
  tone,
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  tone: "thinking" | "tool";
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const headerCls =
    tone === "thinking"
      ? "bg-zinc-100 border-zinc-200 text-zinc-600"
      : "bg-brand-50 border-brand-200 text-brand-700";
  return (
    <div className={`overflow-hidden rounded border ${headerCls}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] font-medium"
      >
        <span className="text-[9px]">{open ? "▼" : "▶"}</span>
        <span className="shrink-0">{title}</span>
        {!open && summary && (
          <span className="ml-1 min-w-0 flex-1 truncate text-[10px] font-normal opacity-60">
            {summary}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-current/10 bg-background px-2.5 py-2 text-foreground">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * ql-20260730-002：解析 tool_use raw（JSON 字符串）为工具名 + 主要参数 + 复制文本。
 * 解析失败（非 JSON）返回 null，渲染时原样显示 raw。
 */
function parseToolRaw(
  raw: string,
): { tool: string; primary: string; copyText: string } | null {
  try {
    const obj = JSON.parse(raw);
    const tool = obj.tool ?? "工具";
    const args = obj.args ?? {};
    if (tool === "Bash") {
      const cmd = args.command ?? "";
      return { tool, primary: cmd, copyText: cmd };
    }
    if (tool === "Write" || tool === "Edit" || tool === "Read") {
      const fp = args.file_path ?? "";
      const ct = args.content ? `${fp}\n\n${args.content}` : fp;
      return { tool, primary: fp, copyText: ct };
    }
    if (tool === "Agent") {
      const desc = args.description ?? args.prompt ?? "";
      return { tool, primary: desc, copyText: desc };
    }
    // 通用：取 description/command/file_path/prompt/pattern/query/url（ql-20260820-008
    // 与 assembler extractPrimaryArg 同步补 pattern 系键），复制完整 args JSON
    const generic =
      args.description ?? args.command ?? args.file_path ?? args.prompt ??
      args.pattern ?? args.query ?? args.url ?? raw.slice(0, 120);
    return { tool, primary: generic, copyText: JSON.stringify(args, null, 2) };
  } catch {
    return null;
  }
}


"use client";

/**
 * GroupChatPanel — 群聊面板（2026-09-01-session-group-chat task-08 / FR-05 /
 * FR-09 / FR-12 / FR-13 / D-011，design §7 群聊视图 + 原型
 * prototype-group-chat.html .chat/.timeline/.msg/.typing-bar/.composer 视觉
 * 与交互基准）。
 *
 * 依据：
 *   - tasks/task-08.md（implementation：平铺时间线全局排序/气泡渲染/群流 SSE
 *     消费/输入区 @补全与 typing 上报；constraints：不复用 session-panel 单
 *     currentRunId 状态机、不动单聊 streamSession、typing 草稿不落库）
 *   - design.md §7（平铺消息流——忽略 run 分组按 log timestamp 全局排序）、
 *     §6.2（envelope 群身份扩展字段）、§5.4（typing 合流帧 + presence）、
 *     §9.8（群不消费 run 级视图）
 *   - lib/daemon.ts streamGroupChat（本变更群流 SSE 封装）/ sendGroupMessage /
 *     sendGroupTyping（task-08 落地）
 *
 * 结构（双列：左时间线 + 右成员面板，task-09 MemberPanel 常驻右栏）：
 *   - 顶栏：群名 + 成员摘要（N 名成员 · X 位 Agent · Y 位用户）+ facepile 头像
 *     堆叠（+N 溢出）；
 *   - 平铺时间线：数据源 = 回放 getAgentSessionLogs(群会话 id)（user_input 行 +
 *     投影行——载体 run 上 channel='stdout' 的行，task-05 落库形态）+ 实时 SSE
 *     log 事件追加；**实时与回放共用 sortGroupTimeline 单一排序函数按 timestamp
 *     全局平铺**（忽略 run 分组——多成员交错回复时 run 锚分组会把迟到回复吸回
 *     触发消息组，D-011）；log_id 去重（投影行 id 实时与回放同 id）、
 *     segment_id 半截行流式光标、stale 撤回令箭按段撤回、完整行前缀吞噬半截行；
 *   - 气泡：user_input 行 → 用户气泡（sender_member_name 身份，当前用户右对齐
 *     self 样式）；投影行 → agent 气泡（member_name/member_id 头像昵称 + 引擎
 *     标签 + 流式光标，member_id 分色）；系统事件（群解散等）居中灰字；
 *     @提及文本高亮（正则同后端 _MENTION_TOKEN_RE 口径 [@＠]\S+ + 边界截断）；
 *   - typing 指示器（输入框上方气泡）：SSE typing 分支 member_name + 草稿
 *     preview，用户事件 TTL 2.5s 过期自动消失（design §5.4）；
 *   - 群聊运行态可见（quick 2026-09-02）：agent typing（member_kind='agent'）
 *     为持续态（不设 TTL——typing:false 止息 / turn_completed 移除）；带
 *     reply_to_log_id 锚点的事件在触发消息（user_input 行）气泡下方渲染
 *     「{member_name} 正在回复…」brand 描边小标签 + 三点动画（@全体 同消息
 *     多标签横排），无锚点 agent typing（互@触发）落原 typing 指示条；群详情
 *     members[].shadow_running 兜底灌入运行集（刷新回放/SSE 迟连场景，无锚点
 *     不强挂消息——诚实降级）+ 成员面板「运行中」徽标 / facepile 小绿点；
 *   - 输入区：@补全（session-mention-popover member kind——输入 @ 触发
 *     buildMemberMentionItems(群成员)+过滤+键盘）；Enter 发送调群消息端点；
 *     typing 上报（输入节流 250ms typing=true+preview ≤400 字，停顿 1s / 发送后
 *     typing=false）。
 *
 * 群聊体验对齐 quick（2026-09-02）：气泡视觉 token 对照会话 TurnTimeline
 * conversation 视图重做（用户 self 右侧 rounded-2xl rounded-br-md bg-primary /
 * 他人与 agent 左侧 rounded-2xl rounded-tl-md border bg-card 卡片、28px 圆头像、
 * typing 走 .sh-typing-dots）——只抄语义类不改 TurnTimeline；群特有元素
 * （@提及高亮/成员分色头像/引擎标签）融合进会话风格。
 *
 * quick 群 P2（2026-09-02）：@全体 二次确认（含 @全体/@all 且 agent 成员 ≥2
 * 弹 Modal.confirm——后端无拦截，前端兜底防误触多机并发）；置顶消息（顶栏下
 * 横幅=群读体 pinned 快照；群主可在气泡右上角图钉置顶/横幅取消——PUT/DELETE
 * /pinned，已置顶行浅 brand 底高亮）；触发失败展示（sendGroupMessage 响应
 * triggered[].error 逐条 warning——消息本身已落时间线）。
 *
 * 群 P2 第二波（2026-09-02）：引用回复（气泡 hover「引用回复」全员可用 →
 * 输入区引用条（成员名+摘要+X 取消）→ 发送 body 带 reply_to_log_id；气泡
 * metadata/SSE 事件 reply_to 快照 → 顶部竖线引用条纯视觉呈现）；未读（挂载
 * PUT /read 推服务端已读位点 + 乐观清零列表缓存；时间线「第 N 条未读」前插
 * 微信式「以下 N 条为新消息」分隔线——挂载快照只算一次，会话中新消息不再插线）。
 *
 * 群 P3 体验/性能 quick（2026-09-03，ql-20260903-010）：
 *   - GroupTimelineRow memo 化——流式期间每个 token 原会带动全部历史行重渲染，
 *     memo + 稳定 props（回调 useCallback / 空 replying 常量数组）后仅变化行
 *     重渲染；
 *   - 回放分页——初始回放 limit 200（原全量拉回），顶部「加载更早消息」按
 *     before=当前最早一条 timestamp 游标向上翻页（数据层既有语义），落不满一页
 *     即无更早历史；归并走 applyGroupTimelineEvent（log_id 去重 + 同一排序函数），
 *     加载后 scrollTop 同步抬高增量——视口停留在用户正在读的位置不被下推；
 *   - 回到底部悬浮按钮——离开底部后出现（上滚读历史不再只能手动划回），离开
 *     期间到达的消息计入「N 条新消息」，滚回底部或点击按钮清零。
 *
 * 数据流关键点：
 *   - 回放身份还原：投影行 metadata.member_id/member_name（task-05 落库形态）
 *     ——2026-09-01-session-group-chat 收口：后端 /logs DTO 已暴露 metadata/
 *     segment_id（gen:types 已同步），刷新回放恒带身份；sender 缺省回退
 *     「成员」占位仅兜底旧行/异常缺列（见 GroupReplayLogEntry 注释）；
 *   - SSE 经 streamGroupChat（断线退避重连 + resync 增量回放 after=lastLogTs-2s
 *     + 轮后对账，照 streamSession 惯例）；重连恢复清流式光标（群无 run 快照可
 *     合成 turn_completed，收口状态以实时事件为准）。
 */

import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, FileText, Image as ImageIcon, Paperclip, Pin, PinOff, Quote, RefreshCw, Search, SendHorizontal, Users, X } from "lucide-react";

import { Drawer, Modal } from "antd";
import { MemberPanel } from "@/components/group-chat/member-panel";
import { GroupMemberAvatar } from "@/components/group-chat/group-member-avatar";
import {
  SessionMentionPopover,
  buildMemberMentionItems,
  filterMentionItems,
  handleMentionKeyDown,
} from "@/components/daemon/session-mention-popover";
import { AttachmentChips } from "@/components/daemon/attachment-chips";
import { classifySessionLog } from "@/components/daemon/session-log-assembler";
import { MarkdownText } from "@/components/ui/markdown-text";
import { applyMentionPick, detectMention } from "@/lib/session-mention";
import type { AgentRunLogEntry } from "@/lib/agent";
import { errMessage, useNotify } from "@/lib/errors";
import { markGroupOpened } from "@/lib/group-unread";
import {
  removeSessionAttachment,
  uploadSessionAttachment,
  type AttachmentRead,
} from "@/lib/api/session-attachments";
import {
  PROVIDER_META,
  getAgentSessionLogs,
  getGroupChat,
  listGroupChats,
  markGroupRead,
  maxLogTimestamp,
  pinGroupMessage,
  sendGroupMessage,
  sendGroupTyping,
  streamGroupChat,
  unpinGroupMessage,
  type GroupChatListItemRead,
  type GroupChatStreamEnvelope,
  type GroupMessageAttachmentSummary,
  type GroupMessageReplySnapshot,
  type GroupReplayLogEntry,
} from "@/lib/daemon";
import { useSession } from "@/stores/session";
import { cn } from "@/lib/utils";

/* ────────────────────── 常量 ────────────────────── */

/** typing 指示器本地 TTL（design §5.4：2.5s 过期自动消失）。 */
export const GROUP_TYPING_TTL_MS = 2500;

/** typing 上报节流间隔（design §5.4：前端 250ms 心跳）。 */
const TYPING_REPORT_THROTTLE_MS = 250;

/** 输入停顿多久后上报 typing=false（指示器靠 TTL 也能自熄，此为显式收口）。 */
const TYPING_IDLE_STOP_MS = 1000;

/** typing 草稿预览上报长度上限（design §5.4 ≤400 字，取尾部）。 */
const TYPING_PREVIEW_MAX_CHARS = 400;

/** facepile 直显头像数（超出 +N）。 */
const FACEPILE_MAX = 4;

/** 群回放分页页大小（初始回放与「加载更早消息」同口径；数据层 limit=最新 N 条语义）。 */
const GROUP_REPLAY_PAGE_SIZE = 200;

/** 单次批量上传附件上限（超出部分忽略并 toast 告知；单聊 session-input-bar 同值）。 */
const MAX_ATTACHMENTS_PER_BATCH = 10;

/** replying 空集常量（memo 稳定 props：行无「正在回复」标签时恒用同一引用，
 *    避免 map 里 `?? []` 每次新建数组击穿 GroupTimelineRow 的 memo）。 */
const NO_REPLYING: GroupReplyingMember[] = [];

/** agent 成员头像配色档（member_id 哈希分色分组，design §7「member_id 分色」）。 */
const AGENT_AVATAR_COLORS = [
  "bg-brand-600",
  "bg-info",
  "bg-accent-600",
  "bg-success",
  "bg-warning",
  "bg-purple-500",
  "bg-cyan-600",
  "bg-pink-500",
] as const;

/** 头像配色解析（member_id 哈希；缺 id 用昵称兜底，保持同成员同色）。 */
function agentAvatarColor(seed: string | null | undefined, name: string | null): string {
  const key = seed || name || "agent";
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return AGENT_AVATAR_COLORS[hash % AGENT_AVATAR_COLORS.length]!;
}

/** 时间戳 HH:mm 展示（zh-CN 铁律显式 locale）。 */
function formatTime(ts: string): string {
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** 附件大小展示（单聊 session-input-bar formatBytes 同口径）。 */
function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(n / 1024))}KB`;
}

/** FR-05 补遗：附件摘要 → AttachmentChips 消费形态（kind 未知值按 file 降级）。 */
function summaryToChips(items: GroupMessageAttachmentSummary[]): {
  id: string;
  kind: "image" | "file";
  name: string;
}[] {
  return items.map((a) => ({
    id: a.file_id,
    kind: a.kind === "image" ? "image" : "file",
    name: a.name,
  }));
}

/* ────────────────────── 引用回复（群 P2 第二波，2026-09-02） ────────────────── */

/** 引用摘要长度上限（对齐后端 content_head(60) 快照口径）。 */
const REPLY_HEAD_MAX_CHARS = 60;

/**
 * 引用回复快照运行时守卫（回放 metadata 与实时事件 payload 同构；生成版
 * metadata 是松散索引签名，此处窄化）：入参宽收（unknown——畸形旧数据/异常
 * payload 容错），log_id 缺失/畸形 → null 不渲染引用条。
 */
export function parseReplySnapshot(raw: unknown): GroupMessageReplySnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<GroupMessageReplySnapshot>;
  const logId = typeof r.log_id === "string" ? r.log_id.trim() : "";
  if (!logId) return null;
  return {
    log_id: logId,
    member_name: typeof r.member_name === "string" ? r.member_name : "",
    content_head: typeof r.content_head === "string" ? r.content_head : "",
  };
}

/** 本地引用摘要（点「引用回复」时由当前气泡内容现算，与后端快照同口径）。 */
export function quoteHeadOf(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, REPLY_HEAD_MAX_CHARS);
}

/** 输入区引用条目标（被引用消息行 id + 发送者 + 内容摘要）。 */
export interface GroupQuoteTarget {
  logId: string;
  memberName: string;
  contentHead: string;
}

/* ────────────────────── 平铺时间线纯数据模型（单测推理面） ────────────────────── */

/**
 * 平铺时间线条目判别联合（D-011）：实时事件与回放读库归一到同一形态后共用
 * sortGroupTimeline 排序渲染——群视图不消费 run 分组装配。
 */
export type GroupTimelineEntry =
  | {
      kind: "user";
      /** log id（user_input 行；实时与回放同 id，去重键）。 */
      id: string;
      timestamp: string;
      /** 发送者群内昵称（metadata.sender_member_name；缺省「成员」占位）。 */
      senderName: string;
      senderUserId: string | null;
      content: string;
      /** 当前用户消息（右对齐 self 气泡样式）。 */
      isSelf: boolean;
      /** FR-05 补遗：随消息发送的附件摘要（metadata/log 事件 attachments；无附件 null）。 */
      attachments: GroupMessageAttachmentSummary[] | null;
      /** 群 P2 引用回复快照（metadata/log 事件 reply_to；无引用 null）。 */
      replyTo: GroupMessageReplySnapshot | null;
    }
  | {
      kind: "agent";
      id: string;
      timestamp: string;
      /** agent 成员身份（投影行 metadata/实时事件 member_*；缺省 null 占位）。 */
      memberId: string | null;
      memberName: string | null;
      memberSessionId: string | null;
      /** 载体 run id（同成员同轮消息共享；前缀吞噬半截行的匹配维度之一）。 */
      runId: string;
      content: string;
      /** partial 半截行（segment_id 非空）→ 流式光标；null=完整行。 */
      segmentId: string | null;
    }
  | {
      kind: "system";
      id: string;
      timestamp: string;
      content: string;
    };

/** 时间轴比较：timestamp 升序（解析失败回退字符串比较），同拍按 id 稳定定序。 */
function compareTimelineEntries(a: GroupTimelineEntry, b: GroupTimelineEntry): number {
  const ta = Date.parse(a.timestamp);
  const tb = Date.parse(b.timestamp);
  const na = Number.isNaN(ta) ? null : ta;
  const nb = Number.isNaN(tb) ? null : tb;
  if (na !== null && nb !== null && na !== nb) return na - nb;
  // 任一侧不可解析：回退字符串比较（ISO 前缀字典序对同源格式成立）。
  const cmp = a.timestamp.localeCompare(b.timestamp);
  if (cmp !== 0) return cmp;
  return a.id.localeCompare(b.id);
}

/**
 * 平铺时间线排序（**实时与回放共用同一函数**，task 卡 implementation 1 /
 * D-011）：按 log timestamp 全局排序、忽略 run 分组——多成员交错回复时保证
 * 刷新回放与直播顺序一致。稳定（同拍 id 定序）。
 */
export function sortGroupTimeline(
  entries: GroupTimelineEntry[],
): GroupTimelineEntry[] {
  return [...entries].sort(compareTimelineEntries);
}

/** 回放日志行 → 时间线条目（null=不进群时间线：工具/思考/撤回令箭/系统行）。 */
export function entryFromReplayLog(
  log: GroupReplayLogEntry,
  currentUserId: string | null,
): GroupTimelineEntry | null {
  const content = log.content_redacted ?? "";
  const meta = log.metadata ?? null;
  if (log.channel === "user_input") {
    const senderUserId = meta?.sender_user_id ?? null;
    return {
      kind: "user",
      id: log.id,
      timestamp: log.timestamp,
      senderName: meta?.sender_member_name?.trim() || "成员",
      senderUserId,
      content,
      // 当前用户判定（sender_user_id 缺省的旧行恒非 self，右侧样式只属本人）。
      isSelf:
        currentUserId != null && senderUserId != null && senderUserId === currentUserId,
      // FR-05 补遗：附件摘要（旧行/无附件缺省 null——附件条不渲染）。
      attachments: meta?.attachments ?? null,
      // 群 P2 引用回复快照（缺省 null——气泡顶部引用条不渲染）。
      replyTo: parseReplySnapshot(meta?.reply_to),
    };
  }
  if (log.channel !== "stdout") return null;
  // 载体 run 上 stdout 行即投影行（task-05 形态：仅 user_input + 投影行落群会话）；
  // 分类口径复用 classifySessionLog（前缀剥除 + 噪音行丢弃，与单聊同源）。
  const segment = classifySessionLog(content, log.channel, log.tool_kind);
  if (!segment || segment.kind !== "reply") return null;
  return {
    kind: "agent",
    id: log.id,
    timestamp: log.timestamp,
    memberId: meta?.member_id ?? null,
    memberName: meta?.member_name ?? null,
    memberSessionId: null,
    runId: log.run_id,
    content: segment.text,
    segmentId: log.segment_id ?? null,
  };
}

/** 实时 log 事件的消费产物：新条目 / 撤回令箭（按段撤回半截行）/ 忽略。 */
export type GroupLiveLogResult =
  | { type: "entry"; entry: GroupTimelineEntry }
  | { type: "revoke"; segmentId: string }
  | { type: "ignore" };

/**
 * 实时群频道 log 事件 → 消费产物（task-05 契约：投影行 log_id=投影行 id、
 * member_* 身份；user_input 行 sender_*；stale 令箭行 [ASSISTANT_OVERRIDE]
 * 前缀 + segment_id、log_id=null）。
 */
export function parseGroupLiveLog(
  env: GroupChatStreamEnvelope,
  currentUserId: string | null,
): GroupLiveLogResult {
  const content = env.content ?? "";
  if (env.channel === "user_input") {
    const senderUserId = env.sender_user_id ?? null;
    return {
      type: "entry",
      entry: {
        kind: "user",
        id: env.log_id ?? "",
        timestamp: env.timestamp ?? "",
        senderName: env.sender_member_name?.trim() || "成员",
        senderUserId,
        content,
        isSelf:
          currentUserId != null &&
          senderUserId != null &&
          senderUserId === currentUserId,
        // FR-05 补遗：附件摘要（实时事件 payload；无附件缺省不渲染）。
        attachments: env.attachments ?? null,
        // 群 P2 引用回复快照（实时事件 payload；与回放 metadata 同构）。
        replyTo: parseReplySnapshot(env.reply_to),
      },
    };
  }
  if (env.channel !== "stdout") return { type: "ignore" };
  // 撤回令箭（stale=true 且 [ASSISTANT_OVERRIDE] 前缀；分类器 override kind 的
  // segmentId 捕获组即被撤回段）——按段撤回已渲染半截行，不产生新条目。
  const segment = classifySessionLog(content, env.channel, env.tool_kind);
  if (segment?.kind === "override") {
    if (segment.variant === "assistant" && segment.segmentId) {
      return { type: "revoke", segmentId: segment.segmentId };
    }
    return { type: "ignore" };
  }
  if (!segment || segment.kind !== "reply") return { type: "ignore" };
  return {
    type: "entry",
    entry: {
      kind: "agent",
      id: env.log_id ?? "",
      timestamp: env.timestamp ?? "",
      memberId: env.member_id ?? null,
      memberName: env.member_name ?? null,
      memberSessionId: env.member_session_id ?? null,
      runId: env.run_id ?? "",
      content: segment.text,
      segmentId: env.segment_id ?? null,
    },
  };
}

/** agent 条目流式归属键（成员维度收口：turn_completed.member_id 匹配用）。 */
export function agentStreamKey(entry: {
  memberId: string | null;
  memberSessionId: string | null;
  memberName: string | null;
}): string {
  return entry.memberId ?? entry.memberSessionId ?? entry.memberName ?? "";
}

/**
 * 把新条目 / 撤回令箭并入时间线（纯函数，实时与回放共用）：
 *   - log_id 去重（seenIds 命中即跳过——实时与回放同 id 天然兼容）；
 *   - 完整行（segmentId=null 的 agent 条目）到达时吞噬同成员同 run 的旧半截行
 *     （其文本是完整行前缀或为空——backend 合成令箭丢失时的自愈路径，
 *     对齐 run_sync 完整行清理语义）；
 *   - 撤回令箭按 segmentId 移除半截行；
 *   - 归并后统一 sortGroupTimeline 排序（与回放同一函数）。
 */
export function applyGroupTimelineEvent(
  entries: GroupTimelineEntry[],
  seenIds: Set<string>,
  incoming:
    | { type: "entry"; entry: GroupTimelineEntry }
    | { type: "revoke"; segmentId: string },
): GroupTimelineEntry[] {
  if (incoming.type === "revoke") {
    const next = entries.filter(
      (e) => !(e.kind === "agent" && e.segmentId === incoming.segmentId),
    );
    return next.length === entries.length ? entries : next;
  }
  const entry = incoming.entry;
  if (!entry.id || seenIds.has(entry.id)) return entries;
  seenIds.add(entry.id);
  let base = entries;
  if (entry.kind === "agent" && entry.segmentId == null) {
    // 完整行吞噬同归属键同 run 的半截前缀行（乱序胶水段自愈）。
    const key = agentStreamKey(entry);
    base = base.filter(
      (e) =>
        !(
          e.kind === "agent" &&
          e.segmentId != null &&
          e.runId === entry.runId &&
          agentStreamKey(e) === key &&
          (e.content === "" || entry.content.startsWith(e.content))
        ),
    );
  }
  return sortGroupTimeline([...base, entry]);
}

/** 回放日志批量归并（挂载回灌：逐行 entryFromReplayLog + 去重 + 统一排序）。 */
export function buildTimelineFromReplay(
  logs: GroupReplayLogEntry[],
  currentUserId: string | null,
): GroupTimelineEntry[] {
  const seen = new Set<string>();
  let entries: GroupTimelineEntry[] = [];
  for (const log of logs) {
    const entry = entryFromReplayLog(log, currentUserId);
    if (!entry) continue;
    const next = applyGroupTimelineEvent(entries, seen, { type: "entry", entry });
    if (next !== entries) entries = next;
  }
  return entries;
}

/* ────────────────────── @提及高亮（后端口径） ────────────────────── */

/** 提及 token 正则（backend _MENTION_TOKEN_RE 同口径：全/半角 @ + 非空白词）。 */
const MENTION_TOKEN_RE = /[@＠](\S+)/g;

/**
 * @全体 判定（quick 群 P2 二次确认的触发条件；后端 _mention_match 同口径）：
 * @/＠ 后的首个非空白词恰为「全体」或「all」（``@全体x`` 不算——token 是
 * ``全体x``）。纯函数，单测推理面。
 */
export function containsMentionAll(content: string): boolean {
  MENTION_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MENTION_TOKEN_RE.exec(content)) !== null) {
    const token = match[1]!;
    if (token === "全体" || token === "all") return true;
  }
  return false;
}

/**
 * @提及高亮节点（backend _mention_match 边界口径的展示侧近似）：@全体/@all
 * 恒高亮；@昵称 在成员昵称集内命中（昵称后继为标点/空白即命中——展示侧无
 * 精确边界字符集，后端解析仍为权威，此处仅高亮展示）。
 */
function renderMentionHighlights(
  content: string,
  memberNames: readonly string[],
  self: boolean,
): React.ReactNode {
  const names = new Set(memberNames);
  MENTION_TOKEN_RE.lastIndex = 0;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = MENTION_TOKEN_RE.exec(content)) !== null) {
    const token = match[1]!;
    const hit =
      token === "全体" ||
      token === "all" ||
      [...names].some((n) => token === n || token.startsWith(n));
    if (!hit) continue;
    const start = match.index;
    if (start > last) nodes.push(content.slice(last, start));
    nodes.push(
      <span
        key={`mention-${key++}`}
        data-testid="group-mention"
        className={cn(
          "cursor-pointer rounded px-0.5 font-semibold",
          self
            ? "bg-white/25 text-white"
            : "bg-accent/15 text-accent-700 dark:text-accent-400",
        )}
      >
        {content.slice(start, start + 1 + token.length)}
      </span>,
    );
    last = start + 1 + token.length;
  }
  if (last < content.length) nodes.push(content.slice(last));
  return nodes.length > 0 ? nodes : content;
}

/* ────────────────────── typing 指示器 ────────────────────── */

/**
 * typing 指示器条目（群聊运行态可见 quick 2026-09-02 分化）：
 *   - 用户事件：TTL 2.5s 过期自动消失（design §5.4 原口径）；
 *   - agent 事件：**不设 TTL**（expiresAt=null 持续到止息信号——run 可能跑
 *     数分钟，TTL 会把「正在生成」错杀）；typing:false / turn_completed 移除。
 */
export interface GroupTypingIndicator {
  /** 成员归属键（agent:{member_id|昵称} / user:{昵称}）。 */
  key: string;
  name: string;
  /** user=用户成员 / agent=后端代发（「成员正在生成回复」）。 */
  kind: string;
  preview: string | null;
  /** null=不过期（agent 持续运行态）；数字=epoch ms（用户 TTL 到期）。 */
  expiresAt: number | null;
  /** agent 成员行 id（用户事件 null）——成员运行徽标/facepile 联动键。 */
  memberId: string | null;
  /** live=SSE 事件驱动 / bootstrap=群详情 shadow_running 兜底灌入。 */
  source: "live" | "bootstrap";
}

/**
 * agent 归属键候选（member_id 优先、昵称兜底）：止息帧/turn_completed 按
 * member_id 定位，但老事件可能只带昵称——移除时按候选集任一命中即清。
 */
export function agentTypingKeyCandidates(
  memberId: string | null | undefined,
  memberName: string | null | undefined,
): string[] {
  const keys: string[] = [];
  if (memberId?.trim()) keys.push(`agent:${memberId.trim()}`);
  const name = memberName?.trim();
  if (name) keys.push(`agent:${name}`);
  return keys;
}

/** typing 事件 → 指示器表（纯函数：typing=true upsert / false 移除）。 */
export function applyTypingEvent(
  map: Record<string, GroupTypingIndicator>,
  event: {
    member_name: string | null;
    member_id?: string | null;
    member_kind?: string | null;
    typing: boolean;
    preview?: string | null;
  },
  now: number,
  ttlMs: number = GROUP_TYPING_TTL_MS,
): Record<string, GroupTypingIndicator> {
  const name = event.member_name?.trim();
  if (!name) return map;
  const isAgent = event.member_kind === "agent";
  const memberId = event.member_id?.trim() || null;
  // 归属键：agent 按 member_id（缺省昵称兜底）；用户按昵称。
  const key = isAgent
    ? (agentTypingKeyCandidates(memberId, name)[0] ?? `agent:${name}`)
    : `user:${name}`;
  const next = { ...map };
  if (!event.typing) {
    // 止息：按候选键全清（member_id 与昵称键并存的历史事件兼容）。
    for (const k of isAgent
      ? agentTypingKeyCandidates(memberId, name)
      : [`user:${name}`]) {
      delete next[k];
    }
    return next;
  }
  next[key] = {
    key,
    name,
    kind: isAgent ? "agent" : "user",
    preview: isAgent ? null : (event.preview?.trim() || null),
    // agent 持续态不设 TTL（止息信号移除）；用户维持 2.5s TTL。
    expiresAt: isAgent ? null : now + ttlMs,
    memberId: isAgent ? memberId : null,
    source: "live",
  };
  return next;
}

/** 裁剪过期指示器（expiresAt=null 的 agent 持续态豁免；返回原引用当无过期）。 */
export function pruneTypingIndicators(
  map: Record<string, GroupTypingIndicator>,
  now: number,
): Record<string, GroupTypingIndicator> {
  let changed = false;
  const next: Record<string, GroupTypingIndicator> = {};
  for (const ind of Object.values(map)) {
    if (ind.expiresAt == null || ind.expiresAt > now) next[ind.key] = ind;
    else changed = true;
  }
  return changed ? next : map;
}

/* ────────────────────── 「正在回复」锚点标签（群聊运行态可见 quick） ────── */

/** 触发消息下方「XX 正在回复…」标签条目（同一消息可多个 agent 响应——@全体）。 */
export interface GroupReplyingMember {
  /** 成员归属键（agent:{member_id|昵称}，与指示器同一键空间）。 */
  key: string;
  memberId: string | null;
  memberName: string;
}

/**
 * typing 事件 → 回复锚点标签表（纯函数）：
 *   - agent typing:true 带 reply_to_log_id → 在该消息下追加标签（按成员键去重）；
 *   - agent typing:false（止息帧不带锚点）→ 按成员键从**所有**消息移除；
 *   - 用户事件 / 无锚点 agent 事件（互@触发）→ 不入本表（走 typing 指示条）。
 */
export function applyReplyingEvent(
  map: Record<string, GroupReplyingMember[]>,
  event: {
    member_name: string | null;
    member_id?: string | null;
    member_kind?: string | null;
    typing: boolean;
    reply_to_log_id?: string | null;
  },
): Record<string, GroupReplyingMember[]> {
  if (event.member_kind !== "agent") return map;
  const name = event.member_name?.trim();
  if (!name) return map;
  const memberId = event.member_id?.trim() || null;
  const keys = agentTypingKeyCandidates(memberId, name);
  if (!event.typing) {
    return removeReplyingMembers(map, keys);
  }
  const logId = event.reply_to_log_id?.trim();
  if (!logId) return map;
  const existing = map[logId] ?? [];
  const key = keys[0] ?? `agent:${name}`;
  if (existing.some((r) => r.key === key)) return map;
  return { ...map, [logId]: [...existing, { key, memberId, memberName: name }] };
}

/** 按成员归属键候选从全部消息移除标签（turn_completed 收口复用；空列表键回收）。 */
export function removeReplyingMembers(
  map: Record<string, GroupReplyingMember[]>,
  keys: string[],
): Record<string, GroupReplyingMember[]> {
  const keySet = new Set(keys);
  let next: Record<string, GroupReplyingMember[]> | null = null;
  for (const [logId, list] of Object.entries(map)) {
    const filtered = list.filter((r) => !keySet.has(r.key));
    if (filtered.length === list.length) continue;
    next = next ?? { ...map };
    if (filtered.length === 0) delete next[logId];
    else next[logId] = filtered;
  }
  return next ?? map;
}

/* ────────────────────── 组件 ────────────────────── */

export interface GroupChatPanelProps {
  /** 群 id（AgentGroupChat.id；SSE/消息端点锚点）。 */
  groupId: string;
  /**
   * 选中群快照（列表项形态；null = 深链恢复尚未就位——群详情查询兜底供数）。
   * 兼挂载点契约：task-07 GroupChatPanelMount props 即接入面。
   */
  group: GroupChatListItemRead | null;
  /** 列表刷新信号（群解散/成员变更后 invalidate 通道，同 SessionPanel 语义）。 */
  onSessionListRefresh?: () => void;
  className?: string;
}

/**
 * 群聊面板（task-08 接入契约兑现：替换 sessions-portal GroupChatPanelMount，
 * key={groupId} 重挂载契约照 SessionPanel——换群即清 SSE/时间线/typing 状态）。
 */
export function GroupChatPanel({
  groupId,
  group,
  onSessionListRefresh,
  className,
}: GroupChatPanelProps) {
  const notify = useNotify();
  const qc = useQueryClient();
  const user = useSession((s) => s.user);
  const currentUserId = user?.id ?? null;
  // 当前用户 id 经 ref 供 SSE 回调闭包读取（回调注册后登录态变化无需重订阅）。
  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;

  /* ── 群详情（六要素成员列表：@补全/身份解析/成员面板共用） ── */
  const detailQ = useQuery({
    queryKey: ["groupChat", groupId],
    queryFn: () => getGroupChat(groupId),
    staleTime: 15_000,
  });
  const detail = detailQ.data ?? null;
  const sessionId = detail?.session_id ?? group?.session_id ?? null;
  const members = useMemo(
    () => (detail?.members ?? group?.members ?? []).filter((m) => m.removed_at == null),
    [detail, group],
  );
  const memberNames = useMemo(() => members.map((m) => m.display_name), [members]);

  /* ── presence 在线集：与列表分区同键查询（["groupChats","list",null] 全局桶）
   *    ——门户 SSE 变更信号 invalidate ["groupChats"] 前缀命中重拉，绿点随刷新
   *    （task-06 presence 读列表快照口径；详情读体不含 online_member_ids）。 ── */
  const presenceListQ = useQuery({
    queryKey: ["groupChats", "list", null],
    queryFn: () => listGroupChats(),
    staleTime: 30_000,
    select: (items: GroupChatListItemRead[]) =>
      items.find((g) => g.id === groupId) ?? null,
  });
  const onlineMemberIds = presenceListQ.data?.online_member_ids
    ?? group?.online_member_ids
    ?? [];

  /* ── 平铺时间线状态 ── */
  const [entries, setEntries] = useState<GroupTimelineEntry[]>([]);
  /** log_id 去重集（实时与回放同 id；投影行 id 单源）。 */
  const seenIdsRef = useRef<Set<string>>(new Set());
  /** 增量回放游标（streamGroupChat cursor 起点 + 发送后主动对账锚点）。 */
  const lastLogTsRef = useRef<string | null>(null);
  /** 正在流式输出的成员归属键集（turn_completed/member 维度收口光标）。 */
  const [streamingKeys, setStreamingKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const streamConnRef = useRef<{ close: () => void; resync?: () => void } | null>(null);

  /* ── 向上翻页（群 P3 分页 quick）：顶部「加载更早消息」——before=当前最早一条
   *    timestamp 游标，后端返回「游标之前的最新一页」；经 applyGroupTimelineEvent
   *    归并（log_id 去重 + 与实时同一全局排序函数）。hasMoreHistory：初始/翻页
   *    拉回满一页即认为可能有更早，落不满一页即无更早。 ── */
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  /** 翻页前的时间线 scrollHeight：归并渲染后把 scrollTop 同步抬高增量，视口
   *    停留在用户正在读的位置不被新插入的历史下推（layout 阶段消费，见下方
   *    useLayoutEffect）。 */
  const preserveTopHeightRef = useRef<number | null>(null);

  /* ── typing 指示器（用户 TTL 2.5s 周期裁剪；agent 持续态豁免——止息信号移除，
   *    群聊运行态可见 quick 2026-09-02）+「正在回复」锚点标签表 ── */
  const [typingMap, setTypingMap] = useState<Record<string, GroupTypingIndicator>>({});
  /* quick-fdd8219a 运行徽标实时性：详情快照 shadow_running 的"已停"覆盖集——
   * 止息/turn_completed 即时剔除（免刷新），typing:true 复活（新 run）。 */
  const stoppedDetailIdsRef = useRef<Set<string>>(new Set());
  /* ── quick-fdd8219a 群内搜索（会话工具栏要素对齐；q 参数走 logs 端点） ── */
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AgentRunLogEntry[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const resetSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults(null);
  }, []);
  const runSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q || searching) return;
    setSearching(true);
    try {
      const logs = await getAgentSessionLogs(groupId, { q, limit: 100 });
      setSearchResults(logs);
    } catch (err) {
      // error(err, fallback)：第一参必须是错误对象，误传文案字符串会被
      // errMessage 吞成兜底「操作失败」。
      notify.error(err, "搜索失败，请稍后重试");
    } finally {
      setSearching(false);
    }
  }, [groupId, searchQuery, searching, notify]);
  /** 命中词 <mark> 高亮（大小写不敏感分段渲染；正则特殊字符转义后切分）。 */
  const SearchHighlight = useCallback(
    ({ text, term }: { text: string; term: string }) => {
      if (!term) return <>{text}</>;
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const parts = text.split(new RegExp(`(${escaped})`, "gi"));
      return (
        <>
          {parts.map((part, i) =>
            part.toLowerCase() === term.toLowerCase() ? (
              <mark key={i} className="rounded bg-warning/30 px-0.5 text-foreground">
                {part}
              </mark>
            ) : (
              <span key={i}>{part}</span>
            ),
          )}
        </>
      );
    },
    [],
  );
  /** 触发消息（log_id）→ 正在回复的 agent 成员集（@全体 同消息多标签）。 */
  const [replyingBy, setReplyingBy] = useState<Record<string, GroupReplyingMember[]>>({});
  /** 已收到的 agent 止息归属键（typing:false/turn_completed）——shadow_running
   *    兜底灌入时跳过（详情快照可能早于止息信号，防「已停成员复活」）。 */
  const stoppedAgentKeysRef = useRef<Set<string>>(new Set());
  const typingTick = useRef(0);
  useEffect(() => {
    const timer = setInterval(() => {
      typingTick.current += 1;
      setTypingMap((map) => pruneTypingIndicators(map, Date.now()));
    }, 500);
    return () => clearInterval(timer);
  }, []);

  /* ── 群聊体验 quick（2026-09-02）：打开群即视为已读——挂载时写「上次打开 =
   *    now」本地记忆（列表行 @我红点据 this 抑制）。实时收到新 log 事件也推进
   *    （在群内盯着时间线时到达的 @不构成未读）。
   *    群 P2 第二波：另推服务端已读位点（PUT /read）——成功后本地乐观清零
   *    presence 群列表缓存 + invalidate 群列表前缀（列表徽标即时消失，不等
   *    重拉；失败静默，下次进群重试）。invalidate 落地后**再清一次**：兜「乐观
   *    清零早于首拉（缓存空 no-op）+ invalidate 与首拉去重」的微时序——旧值
   *    5 落缓存后最终仍被清零。 ── */
  useEffect(() => {
    // ql-20260903-007：已读锚改服务端时钟域——挂载不再写客户端 now（与
    // last_mention.ts 服务端时钟跨域比较会吞红点），由回放落地（maxLogTimestamp）
    // 与实时事件（env.timestamp）两处写锚；无消息的空群无 mention 可丢，不写。
    const clearUnreadInCache = () => {
      qc.setQueryData<GroupChatListItemRead[]>(
        ["groupChats", "list", null],
        (items) =>
          items?.map((g) => (g.id === groupId ? { ...g, unread_count: 0 } : g)),
      );
    };
    void (async () => {
      try {
        await markGroupRead(groupId);
        clearUnreadInCache();
        await qc.invalidateQueries({ queryKey: ["groupChats"] });
        clearUnreadInCache();
      } catch {
        /* 已读位点纯增益：失败静默（不阻断群聊）。 */
      }
    })();
  }, [groupId, qc]);

  /* ── 群 P2 第二波 未读分隔线：挂载时快照群 unread_count（group props / 群
   *    详情先到先用——markGroupRead 只清列表缓存与重拉，不动群详情查询，快照
   *    不被已读动作污染）；回放时间线首次就绪时**计算一次**「第 N 条未读」锚点
   *    （倒序第 unread_count 条消息行前插分隔线），此后会话中新消息不再改锚
   *    （不二次插线）；unread=0 恒不渲染。换群 key 重挂载自然重算。 ── */
  const unreadSnapshotRef = useRef<number | null>(null);
  const unreadDividerComputedRef = useRef(false);
  const [unreadDivider, setUnreadDivider] = useState<{
    beforeId: string;
    count: number;
  } | null>(null);
  useEffect(() => {
    if (unreadSnapshotRef.current === null) {
      const count = group?.unread_count ?? detail?.unread_count ?? null;
      if (count != null && count > 0) unreadSnapshotRef.current = count;
    }
    if (unreadDividerComputedRef.current || entries.length === 0) return;
    unreadDividerComputedRef.current = true;
    const count = unreadSnapshotRef.current ?? 0;
    if (count <= 0) return;
    const messages = entries.filter((e) => e.kind !== "system");
    const anchor = messages[Math.max(0, messages.length - count)];
    if (anchor) setUnreadDivider({ beforeId: anchor.id, count });
  }, [entries, group, detail]);

  /* ── 回放 + SSE 订阅（sessionId 就位后一次性装配；key 重挂载清全部状态） ── */
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    let connection: ReturnType<typeof streamGroupChat> | null = null;
    // 群切换守卫（key 重挂载下防御性重置；同群 effect 重跑同样归零起步）。
    setEntries([]);
    seenIdsRef.current = new Set();
    lastLogTsRef.current = null;
    setStreamingKeys(new Set());
    setTypingMap({});
    setReplyingBy({});
    stoppedAgentKeysRef.current = new Set();
    // 群 P3 分页 quick：翻页态随时间线一并归零。
    setHasMoreHistory(false);
    setLoadingMore(false);
    setLoadMoreError(false);
    preserveTopHeightRef.current = null;

    void (async () => {
      // 回放读库（刷新回放：user_input 行 + 投影行，统一排序平铺）。limit 分页：
      // 初始只取最新一页，更早历史走顶部「加载更早消息」（群 P3 分页 quick）。
      try {
        const logs = (await getAgentSessionLogs(sessionId, {
          limit: GROUP_REPLAY_PAGE_SIZE,
        })) as GroupReplayLogEntry[];
        if (cancelled) return;
        // 拉回满一页 → 可能有更早历史（不足一页必无更早）。
        setHasMoreHistory(logs.length >= GROUP_REPLAY_PAGE_SIZE);
        const built = buildTimelineFromReplay(logs, currentUserIdRef.current);
        setEntries(built);
        for (const e of built) seenIdsRef.current.add(e.id);
        const lastTs = maxLogTimestamp(logs);
        if (lastTs) {
          lastLogTsRef.current = lastTs;
          // ql-20260903-007：打开群回放落地 → 已读锚 = 最新消息的服务端 ts
          // （时钟域与 last_mention.ts 一致，见 lib/group-unread.ts 头注）。
          markGroupOpened(groupId, lastTs);
        }
      } catch {
        /* 回放失败 → 空时间线起步，SSE resync/轮后对账兜底（不阻断订阅）。 */
      }
      if (cancelled) return;
      // 实时订阅（cursor=回放游标：首连增量同步从该点拉起，避免二次全量）。
      connection = streamGroupChat(
        sessionId,
        {
          onLog: (env) => {
            // 在群内实时收到行 → 推进已读记忆（打开群期间的 @不算未读）。
            // 锚用事件服务端 timestamp（ql-20260903-007 时钟域统一）。
            markGroupOpened(groupId, env.timestamp);
            const result = parseGroupLiveLog(env, currentUserIdRef.current);
            if (result.type === "revoke") {
              setEntries((prev) =>
                applyGroupTimelineEvent(prev, seenIdsRef.current, result),
              );
              return;
            }
            if (result.type === "ignore") return;
            // 实时行到达即推进游标（与 streamGroupChat 内部游标同源语义）。
            if (env.timestamp && (!lastLogTsRef.current || env.timestamp > lastLogTsRef.current)) {
              lastLogTsRef.current = env.timestamp;
            }
            setEntries((prev) =>
              applyGroupTimelineEvent(prev, seenIdsRef.current, result),
            );
            if (result.entry.kind === "agent") {
              const key = agentStreamKey(result.entry);
              if (key) {
                setStreamingKeys((prev) => {
                  if (prev.has(key)) return prev;
                  const next = new Set(prev);
                  next.add(key);
                  return next;
                });
              }
            }
          },
          onTurnCompleted: (env) => {
            // 成员收口：停该成员流式光标（member_id/member_name 身份，design §6.2）。
            const key = env.member_id ?? env.member_name ?? "";
            if (key) {
              setStreamingKeys((prev) => {
                if (!prev.has(key)) return prev;
                const next = new Set(prev);
                next.delete(key);
                return next;
              });
            }
            // 运行态收口（群聊运行态可见 quick 2026-09-02）：同成员 agent typing
            // 持续指示 + 回复锚点标签一并移除（止息 typing:false 丢失时的兜底）。
            // quick-fdd8219a 实时性：详情快照 shadow_running 同步剔除（徽标即时
            // 灭，不等详情重拉）+ 触发详情 refetch（六要素/运行态对齐）。
            if (env.member_id) stoppedDetailIdsRef.current.add(env.member_id);
            void qc.invalidateQueries({ queryKey: ["groupChat", groupId] });
            const stopKeys = agentTypingKeyCandidates(env.member_id, env.member_name);
            if (stopKeys.length > 0) {
              for (const k of stopKeys) stoppedAgentKeysRef.current.add(k);
              setTypingMap((map) => {
                let changed = false;
                const next = { ...map };
                for (const k of stopKeys) {
                  if (next[k]) {
                    delete next[k];
                    changed = true;
                  }
                }
                return changed ? next : map;
              });
              setReplyingBy((map) => removeReplyingMembers(map, stopKeys));
            }
          },
          onTyping: (event) => {
            const now = Date.now();
            setTypingMap((map) => applyTypingEvent(map, event, now));
            setReplyingBy((map) => applyReplyingEvent(map, event));
            if (event.member_kind === "agent") {
              const keys = agentTypingKeyCandidates(event.member_id, event.member_name);
              if (event.typing) {
                // 重新点亮：清止息记忆（shadow_running 兜底可重新灌入该成员）。
                for (const k of keys) stoppedAgentKeysRef.current.delete(k);
                if (event.member_id) stoppedDetailIdsRef.current.delete(event.member_id);
              } else {
                for (const k of keys) stoppedAgentKeysRef.current.add(k);
                if (event.member_id) stoppedDetailIdsRef.current.add(event.member_id);
                // 止息 → 群详情 shadow_running 兜底刷新（成员运行徽标收口）。
                void qc.invalidateQueries({ queryKey: ["groupChat", groupId] });
              }
            }
          },
          // queue_changed：群内不展示队列 UI（design §9.8）——影子队列事件透传
          // 备消费，本面板无渲染动作。
          onSessionEnded: () => {
            notify.warning("该群聊已解散");
            onSessionListRefresh?.();
          },
          onError: () => {
            /* 解析/校验错误静默（连接层退避重连自兜；避免刷屏）。 */
          },
          onStatusChange: (status) => {
            if (status === "reconnected") {
              // 重连恢复：清流式光标（群无 run 快照可合成收口，保守归零；
              // 仍在输出的成员下一条实时行会重新点亮）。
              setStreamingKeys(new Set());
              // 运行态重对账（群聊运行态可见 quick 2026-09-02）：断连窗口可能
              // 错过止息/turn_completed——agent 持续指示降级为 bootstrap 态，
              // 交由群详情 shadow_running 对账（仍在跑→保留；已停→retire 回收
              // + 回复锚点标签联动清除）；止息记忆作废（详情快照晚于一切断前
              // 信号，新 run 不被旧止息压制）。
              setTypingMap((map) => {
                let changed = false;
                const next: Record<string, GroupTypingIndicator> = {};
                for (const ind of Object.values(map)) {
                  if (ind.kind === "agent" && ind.source === "live") {
                    next[ind.key] = { ...ind, source: "bootstrap" };
                    changed = true;
                  } else {
                    next[ind.key] = ind;
                  }
                }
                return changed ? next : map;
              });
              stoppedAgentKeysRef.current = new Set();
              void qc.invalidateQueries({ queryKey: ["groupChat", groupId] });
            }
          },
        },
        { cursor: lastLogTsRef.current ?? undefined },
      );
      if (cancelled) {
        connection.close();
        return;
      }
      streamConnRef.current = connection;
    })();

    return () => {
      cancelled = true;
      streamConnRef.current = null;
      connection?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  /* ── 运行态兜底（群聊运行态可见 quick 2026-09-02）：群详情 members[].
   *    shadow_running → agent 运行集灌入 typingMap（持续态、preview=null、
   *    source=bootstrap）——刷新回放/SSE 迟连时 typing 事件丢失的兜底。
   *    详情无回复锚点关联，不强挂消息（诚实降级：成员侧徽标 + typing 指示条）；
   *    live 指示器不被兜底覆盖，详情不再 running 的 bootstrap 指示器回收。
   *    声明在 SSE 订阅 effect 之后：同一次提交里 sessionId 建连重置与兜底灌入
   *    并发时，先重置后灌入（顺序反了会被重置清空）。 ── */
  const bootstrapRunningKeysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!detail) return;
    const fresh = new Set<string>();
    for (const m of detail.members ?? []) {
      if (m.member_type !== "agent" || !m.shadow_running) continue;
      const candidates = agentTypingKeyCandidates(m.id, m.display_name);
      const key = candidates[0];
      if (!key) continue;
      for (const k of candidates) fresh.add(k);
      if (stoppedAgentKeysRef.current.has(key)) continue;
      setTypingMap((map) =>
        map[key]
          ? map
          : {
              ...map,
              [key]: {
                key,
                name: m.display_name,
                kind: "agent",
                preview: null,
                expiresAt: null,
                memberId: m.id,
                source: "bootstrap",
              },
            },
      );
    }
    const retired = [...bootstrapRunningKeysRef.current].filter(
      (k) => !fresh.has(k),
    );
    if (retired.length > 0) {
      setTypingMap((map) => {
        let changed = false;
        const next = { ...map };
        for (const k of retired) {
          if (next[k]?.source === "bootstrap") {
            delete next[k];
            changed = true;
          }
        }
        return changed ? next : map;
      });
      // 详情判定已停的成员：回复锚点标签一并清除（重连对账路径——止息帧
      // 可能错过，标签不能永久滞留）。
      setReplyingBy((map) => removeReplyingMembers(map, retired));
    }
    bootstrapRunningKeysRef.current = fresh;
  }, [detail]);

  /* ── 时间线自动滚底（对齐 TurnTimeline ql-20260822-010 三要素）──
   * ① onScroll 维护「距底 < 80」ref（非每帧计算——上滚读历史不被流式拉回）；
   * ② 仅贴底时跟随新内容滚底；③ 自己刚发送的消息（isSelf 的 user_input 行）
   * 首次出现 → 无条件强制回底（立即看到自己发出的消息，常规会话 isNewPendingTurn
   * 同语义；他人发言不触发——上滚读历史不被拽底，ql-20260903-002）；
   * ④ 选中文字（复制中）不自动滚底（ql-20260825-011 同款）；
   * ⑤ 挂载/换群首帧无条件回底（常规会话同体验——打开即定位最新消息）。 */
  const timelineRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const lastOwnSendTsRef = useRef<string | null>(null);
  const initialScrollDoneRef = useRef(false);
  /* ── 回到底部悬浮按钮 + 新消息计数（群 P3 quick）：nearBottom 驱动按钮显隐；
   *    leftBottomTs=离开底部那一刻的最新消息时间戳，之后时间戳更大的消息计入
   *    「N 条新消息」——滚回底部（含点按钮）清零。 ── */
  const [nearBottom, setNearBottom] = useState(true);
  const [leftBottomTs, setLeftBottomTs] = useState<string | null>(null);
  /** 当前时间线最新一条的 timestamp（scroll 回调闭包经 ref 读最新值）。 */
  const newestEntryTsRef = useRef<string | null>(null);
  useEffect(() => {
    newestEntryTsRef.current =
      entries.length > 0 ? entries[entries.length - 1]!.timestamp : null;
  }, [entries]);
  /** 离开底部期间到达的新消息数（0 时按钮只显示「回到底部」）。 */
  const newCount = leftBottomTs
    ? entries.reduce((n, e) => (e.timestamp > leftBottomTs ? n + 1 : n), 0)
    : 0;
  const handleTimelineScroll = useCallback(() => {
    const el = timelineRef.current;
    if (!el) return;
    const near =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    nearBottomRef.current = near;
    setNearBottom((prev) => (prev === near ? prev : near));
    if (near) {
      // 回到底部 → 新消息计数清零（含点击悬浮按钮后的滚底触发）。
      setLeftBottomTs((prev) => (prev === null ? prev : null));
    } else {
      // 离开底部 → 锚定「离开点」最新时间戳，此后更大的 ts 计入新消息。
      setLeftBottomTs((prev) => prev ?? newestEntryTsRef.current);
    }
  }, []);
  /** 点击悬浮按钮平滑回底（滚底 onScroll 触发后计数自然清零）。 */
  const jumpToBottom = useCallback(() => {
    const el = timelineRef.current;
    if (!el || typeof el.scrollTo !== "function") return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    nearBottomRef.current = true;
    setNearBottom(true);
    setLeftBottomTs(null);
  }, []);

  /* ── 向上翻页（群 P3 分页 quick）：before 游标拉「最早一条之前的一页」，
   *    归并经 applyGroupTimelineEvent（log_id 去重——SSE resync 可能与翻页
   *    重叠；同一排序函数）；视口位置保持由下方 useLayoutEffect 完成。 ── */
  const loadMoreHistory = useCallback(async () => {
    const oldest = entries[0]?.timestamp;
    if (!sessionId || !oldest || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(false);
    preserveTopHeightRef.current = timelineRef.current?.scrollHeight ?? null;
    try {
      const logs = (await getAgentSessionLogs(sessionId, {
        before: oldest,
        limit: GROUP_REPLAY_PAGE_SIZE,
      })) as GroupReplayLogEntry[];
      if (logs.length < GROUP_REPLAY_PAGE_SIZE) setHasMoreHistory(false);
      if (logs.length === 0) preserveTopHeightRef.current = null;
      setEntries((prev) => {
        let next = prev;
        for (const log of logs) {
          const entry = entryFromReplayLog(log, currentUserIdRef.current);
          if (!entry) continue;
          next = applyGroupTimelineEvent(next, seenIdsRef.current, {
            type: "entry",
            entry,
          });
        }
        return next;
      });
    } catch {
      preserveTopHeightRef.current = null;
      setLoadMoreError(true);
    } finally {
      setLoadingMore(false);
      // 兜底清视口保持标记：若归并后 entries 引用未变（全部去重），layout
      // effect 不触发，标记不能滞留到下一次无关 entries 变化时误调整视口。
      setTimeout(() => {
        preserveTopHeightRef.current = null;
      }, 0);
    }
  }, [entries, sessionId, loadingMore]);
  /* 翻页视口保持（绘制前）：scrollTop 抬高「新插入历史内容的高度增量」，
   *    用户正在读的区域保持原位（微信/钉钉向上翻页同款语义）。 */
  useLayoutEffect(() => {
    const preserved = preserveTopHeightRef.current;
    if (preserved == null) return;
    preserveTopHeightRef.current = null;
    const el = timelineRef.current;
    if (el) el.scrollTop += el.scrollHeight - preserved;
  }, [entries]);
  useEffect(() => {
    const el = timelineRef.current;
    if (!el || typeof el.scrollTo !== "function") return;
    // 首帧（挂载/换群 key 重挂）：无条件定位底部。同时播种 own-send 基线
    // （ql-20260903-002）：首帧分支提前 return 不走下方判定，若 entries 已有
    // 回放内容而基线仍为 null，首个 entries 变化（哪怕由他人消息触发）会把
    // 回放里自己已有的旧消息误判为「刚发送」强制回底。
    if (!initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true;
      nearBottomRef.current = true;
      const firstOwn = [...entries]
        .reverse()
        .find((e) => e.kind === "user" && e.isSelf);
      lastOwnSendTsRef.current = firstOwn?.timestamp ?? null;
      el.scrollTo(0, el.scrollHeight);
      return;
    }
    // 用户刚发送（**自己**最新 user_input 行的 timestamp 变化）→ 强制回底。
    // ql-20260903-002：群时间线里所有成员的发言都是 kind:"user"（isSelf 只用于
    // 气泡左右侧），不过滤 isSelf 时他人发言同样触发强制回底，把上滚读历史的
    // 视口拽到底——②「上滚不被拉回」被③架空。
    const lastOwnSend = [...entries]
      .reverse()
      .find((e) => e.kind === "user" && e.isSelf);
    const lastUserTs = lastOwnSend?.timestamp ?? null;
    const isNewOwnSend = lastUserTs !== null && lastUserTs !== lastOwnSendTsRef.current;
    lastOwnSendTsRef.current = lastUserTs;
    // 选中文字（复制中）不滚底。
    const selecting =
      typeof window !== "undefined" &&
      (() => {
        const sel = window.getSelection();
        return sel != null && !sel.isCollapsed && sel.toString().length > 0;
      })();
    if (selecting) return;
    if (isNewOwnSend || nearBottomRef.current) {
      el.scrollTo(0, el.scrollHeight);
    }
  }, [entries, typingMap, replyingBy]);

  /* ── 输入区：草稿 / @补全 / typing 上报 / 发送 / 附件（FR-05 补遗） ── */
  const [draft, setDraft] = useState("");
  /* 群 P2 引用回复：输入区引用条目标（null=无引用；发送成功清空、失败保留重发）。 */
  const [replyTarget, setReplyTarget] = useState<GroupQuoteTarget | null>(null);
  /* 手机端群聊 quick：窄屏成员抽屉开关。 */
  const [membersDrawerOpen, setMembersDrawerOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /* 附件流（照单聊 session-input-bar task-12 管线）：📎 选文件即传（复用
   * 上传端点产出 AttachmentRead）、chips 预览可删、发送随消息提交、成功后
   * 仅清本地列表（附件已随载体绑定群会话，服务端不删）。 */
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentRead[]>([]);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const mentionItems = useMemo(() => buildMemberMentionItems(members), [members]);
  const mentionDetection = useMemo(
    () => detectMention(draft, inputRef.current?.selectionStart ?? draft.length),
    [draft],
  );
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const mentionOpen = mentionDetection?.trigger === "@";
  const mentionFiltered = useMemo(
    () => (mentionOpen ? filterMentionItems(mentionItems, mentionDetection?.query ?? "") : []),
    [mentionOpen, mentionItems, mentionDetection],
  );
  useEffect(() => {
    setMentionActiveIndex(0);
  }, [mentionDetection?.query]);

  const typingLastSentRef = useRef(0);
  const typingIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopTypingReport = useCallback(() => {
    if (typingIdleTimerRef.current) {
      clearTimeout(typingIdleTimerRef.current);
      typingIdleTimerRef.current = null;
    }
  }, []);

  /** typing 上报（design §5.4：输入节流 250ms typing=true+preview 尾 400 字；停顿 1s / 发送后 typing=false）。 */
  const reportTyping = useCallback(
    (value: string) => {
      const now = Date.now();
      if (now - typingLastSentRef.current >= TYPING_REPORT_THROTTLE_MS) {
        typingLastSentRef.current = now;
        void sendGroupTyping(groupId, {
          typing: true,
          preview: value.slice(-TYPING_PREVIEW_MAX_CHARS) || null,
        }).catch(() => {
          /* 纯增益信号：失败静默（指示器靠 TTL 自熄）。 */
        });
      }
      stopTypingReport();
      typingIdleTimerRef.current = setTimeout(() => {
        typingIdleTimerRef.current = null;
        typingLastSentRef.current = 0;
        void sendGroupTyping(groupId, { typing: false }).catch(() => {
          /* 同上静默 */
        });
      }, TYPING_IDLE_STOP_MS);
    },
    [groupId, stopTypingReport],
  );

  // 卸载清 idle 定时器（防幽灵 typing=false 上报）。
  useEffect(() => stopTypingReport, [stopTypingReport]);

  const handleInputChange = (value: string) => {
    setDraft(value);
    if (value.trim()) reportTyping(value);
  };

  /** 点气泡「引用回复」→ 输入区挂引用条并聚焦（全员可用，群 P2 第二波）。 */
  const handleQuoteReply = useCallback((target: GroupQuoteTarget) => {
    setReplyTarget(target);
    inputRef.current?.focus();
  }, []);

  const handleMentionSelect = useCallback((entity: { displayName: string }) => {
    const input = inputRef.current;
    const detection = detectMention(
      input?.value ?? draft,
      input?.selectionStart ?? draft.length,
    );
    if (!detection) return;
    const { value, caret } = applyMentionPick(
      input?.value ?? draft,
      detection,
      entity.displayName,
    );
    // quick-23f25e3b 连续选择：回填段后自动续一个 @ 触发字符——浮层保持打开
    // （query="" 全量候选），可连续点选多名成员（IM @ 多选惯例）；Esc 放行后
    // 键入空白自然关层，Backspace 删掉续 @ 也可退出。仅群聊输入区启用（单聊
    // session-input-bar 语义不变）。
    const continuous = `${value.slice(0, caret)}@${value.slice(caret)}`;
    setDraft(continuous);
    const nextCaret = caret + 1;
    // 光标复位到续 @ 之后（jsdom 无 rAF 时同步兜底）——detectMention 以该
    // 光标回看命中新 @，浮层经 [draft] 派生自动重开。
    const restore = () => {
      if (!input) return;
      input.focus();
      input.setSelectionRange(nextCaret, nextCaret);
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(restore);
    } else {
      restore();
    }
  }, [draft]);

  /** 附件上传（单聊 handleFiles 同管线：逐文件上传，失败行内红字不中断其余）。 */
  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadError(null);
    if (files.length > MAX_ATTACHMENTS_PER_BATCH) {
      notify.warning(
        `一次最多上传 ${MAX_ATTACHMENTS_PER_BATCH} 个附件，已忽略多余的 ${
          files.length - MAX_ATTACHMENTS_PER_BATCH
        } 个`,
      );
    }
    for (const file of Array.from(files).slice(0, MAX_ATTACHMENTS_PER_BATCH)) {
      const kind = file.type.startsWith("image/") ? "image" : "file";
      setUploading((n) => n + 1);
      try {
        const added = await uploadSessionAttachment(file, kind);
        setPendingAttachments((prev) => [...prev, added]);
      } catch (err) {
        setUploadError(errMessage(err, "上传失败"));
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  /** 移除待发附件（草稿行服务端同步删；发送后清理不走此处——行已绑定群会话）。 */
  const handleRemoveAttachment = async (att: AttachmentRead) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== att.id));
    try {
      await removeSessionAttachment(att.id);
    } catch {
      /* 行已在本地移除；服务端残留由 48h 草稿清理兜底 */
    }
  };

  const performSend = useCallback(async () => {
    const content = draft.trim();
    const attachmentIds = pendingAttachments.map((a) => a.id);
    if ((!content && attachmentIds.length === 0) || sending) return;
    setSending(true);
    // 发送即收口 typing（停顿指示器 + 心跳）。
    stopTypingReport();
    typingLastSentRef.current = 0;
    void sendGroupTyping(groupId, { typing: false }).catch(() => {});
    try {
      const res = await sendGroupMessage(
        groupId,
        content,
        attachmentIds.length > 0 ? attachmentIds : undefined,
        // 群 P2 引用回复：引用条挂起时随消息带被引用行 id（无引用 null 不发键）。
        replyTarget?.logId ?? null,
      );
      setDraft("");
      setPendingAttachments([]);
      setReplyTarget(null);
      setUploadError(null);
      /* ── quick 群 P2 触发失败展示：消息恒 200 已落时间线，单成员触发失败
       *    （附件引擎不符/机器离线/闸满等）在 triggered[].error 透传——逐条
       *    warning 告知；全部成功不弹。 */
      for (const t of res.triggered ?? []) {
        if (t.error) notify.warning(`${t.member_name} 未能触发：${t.error}`);
      }
      // 发送成功主动对账一次（未 @ 消息无成员轮次，SSE log 事件丢失时兜回显）。
      streamConnRef.current?.resync?.();
    } catch (err) {
      // 队列满（HTTP_409_DAEMON_SESSION_QUEUE_FULL）等业务错误：消息可能已落
      // 时间线（design §4.1 失败语义）——提示原文，时间线以对账回显为准；
      // 附件与草稿保留供重发。
      notify.error(err, "发送失败，请稍后重试");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [draft, sending, groupId, pendingAttachments, replyTarget, notify, stopTypingReport]);

  const handleSend = useCallback(async () => {
    const content = draft.trim();
    const attachmentIds = pendingAttachments.map((a) => a.id);
    if ((!content && attachmentIds.length === 0) || sending) return;
    /* ── quick 群 P2：@全体 二次确认（后端无拦截，前端兜底防误触多机并发）——
     *    消息含 @全体/@all 且群内 agent 成员 ≥2 时弹 Modal.confirm，确认才发；
     *    单 agent（无并发面）或无 @全体 直发。从简恒确认（不做"不再询问"）。 */
    if (containsMentionAll(content)) {
      const agentMemberCount = members.filter((m) => m.member_type === "agent").length;
      if (agentMemberCount >= 2) {
        Modal.confirm({
          title: "发送 @全体 消息？",
          content: `@全体 将同时触发 ${agentMemberCount} 个 Agent 成员（多机并发），确定发送？`,
          okText: "发送",
          cancelText: "取消",
          onOk: () => {
            void performSend();
          },
        });
        return;
      }
    }
    await performSend();
  }, [draft, sending, pendingAttachments, members, performSend]);

  const handleInputKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // IME 组合期不劫持（联想浮层键盘契约前置守卫）。
    if (e.nativeEvent.isComposing) return;
    if (mentionOpen && mentionFiltered.length > 0) {
      const handled = handleMentionKeyDown(e, {
        count: mentionFiltered.length,
        activeIndex: mentionActiveIndex,
        onMove: (next) => setMentionActiveIndex(next),
        onSelect: () => {
          const picked = mentionFiltered[mentionActiveIndex];
          if (picked?.kind === "member") {
            handleMentionSelect(picked.entity);
          }
        },
        onClose: () => {
          /* 关层由 detectMention 状态驱动（Esc 放行后键入空白自然关层）。 */
        },
      });
      if (handled) return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  /* ── 顶栏摘要 ── */
  const agentCount = members.filter((m) => m.member_type === "agent").length;
  const userCount = members.length - agentCount;
  const facepile = members.slice(0, FACEPILE_MAX);
  const facepileMore = members.length - facepile.length;

  /* ── quick 群 P2 置顶：群主判定 + 置顶/取消 mutation（横幅与气泡图钉共用）。
   *    置顶快照经群读体 pinned 字段透出——成功后 invalidate 群详情 + 群列表
   *    前缀（横幅/高亮/列表摘要随重拉对齐）。 ── */
  const isOwner =
    currentUserId != null &&
    (detail?.created_by ?? group?.created_by) === currentUserId;
  const pinned = detail?.pinned ?? null;
  const pinMutation = useMutation({
    mutationFn: (logId: string) => pinGroupMessage(groupId, { log_id: logId }),
    onSuccess: () => {
      notify.success("已置顶该消息");
      void qc.invalidateQueries({ queryKey: ["groupChat", groupId] });
      void qc.invalidateQueries({ queryKey: ["groupChats"] });
    },
    onError: (err) => {
      notify.error(err, "置顶失败，请稍后重试");
    },
  });
  const unpinMutation = useMutation({
    mutationFn: () => unpinGroupMessage(groupId),
    onSuccess: () => {
      notify.success("已取消置顶");
      void qc.invalidateQueries({ queryKey: ["groupChat", groupId] });
      void qc.invalidateQueries({ queryKey: ["groupChats"] });
    },
    onError: (err) => {
      notify.error(err, "取消置顶失败，请稍后重试");
    },
  });
  /* 群 P3 quick：置顶入口稳定回调——memo 化 GroupTimelineRow 的 props 稳定性
   *    要求 onPin 跨渲染同引用；先解构出 mutate（React Query 稳定引用，结果
   *    对象每次渲染新建，不可作 dep 否则回调随渲染重建、memo 失效）。 */
  const { mutate: pinMutate } = pinMutation;
  const handlePin = useCallback(
    (logId: string) => pinMutate(logId),
    [pinMutate],
  );

  /* ── 运行态派生（群聊运行态可见 quick 2026-09-02） ── */
  /** 有回复锚点标签的 agent 归属键（标签已挂触发消息下方，typing 指示条不重复）。 */
  const anchoredAgentKeys = useMemo(() => {
    const s = new Set<string>();
    for (const list of Object.values(replyingBy)) {
      for (const r of list) s.add(r.key);
    }
    return s;
  }, [replyingBy]);
  const typingIndicators = Object.values(typingMap).filter(
    (ind) => ind.kind !== "agent" || !anchoredAgentKeys.has(ind.key),
  );
  /** agent 运行成员 id 集（详情 shadow_running ∪ SSE typing live 态——成员面板
   *  「运行中」徽标 + facepile 小绿点共用数据源）。 */
  const runningMemberIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of detail?.members ?? []) {
      if (
        m.member_type === "agent" &&
        m.shadow_running &&
        !stoppedDetailIdsRef.current.has(m.id)
      ) {
        ids.add(m.id);
      }
    }
    for (const ind of Object.values(typingMap)) {
      if (ind.kind === "agent" && ind.memberId) ids.add(ind.memberId);
    }
    return ids;
  }, [detail, typingMap]);

  /** 每个流式归属键的最后一条 agent 行（光标只挂成员时间线尾巴）。 */
  const lastAgentIdByStreamKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entries) {
      if (e.kind === "agent") map.set(agentStreamKey(e), e.id);
    }
    return map;
  }, [entries]);

  /**
   * agent 成员引擎标签解析（原型 .m-model「claude · opus」的占位形态）：
   * member_id/member_name → 群详情成员表 provider → PROVIDER_META 标签；
   * 已移除成员/身份未知（回放降级）→ null 不渲染标签。
   */
  const providerLabelByMemberKey = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const m of members) {
      if (m.member_type !== "agent") continue;
      const label = PROVIDER_META[m.provider ?? ""]?.label ?? m.provider ?? null;
      if (m.id) map.set(m.id, label);
      map.set(m.display_name, label);
    }
    return map;
  }, [members]);

  /* ── quick 群成员头像自定义：气泡头像解析（member_id / user_id / 昵称 →
   *    群详情成员表 avatar；空值渲染现状首字回退，见 GroupMemberAvatar）。 ── */
  const avatarByMemberKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) {
      const v = m.avatar ?? "";
      if (m.id) map.set(m.id, v);
      map.set(m.display_name, v);
    }
    return map;
  }, [members]);
  const avatarByUserId = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) {
      if (m.user_id) map.set(m.user_id, m.avatar ?? "");
    }
    return map;
  }, [members]);

  return (
    <div
      data-testid="group-chat-panel-mount"
      data-group-id={groupId}
      aria-label="群聊面板"
      className={cn(
        /* 手机端群聊 quick（2026-09-02）：窄屏（<768px）单列——右列成员面板
         * 不再常驻挤掉对话区，改顶栏「成员」按钮开 Drawer；宽屏维持双列。 */
        "grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_320px] gap-3.5",
        className,
      )}
    >
      {/* ── 左列：群聊主区（顶栏 + 时间线 + typing + 输入区） ── */}
      <section
        aria-label="群聊时间线区"
        className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm"
      >
        {/* 顶栏：群名 + 成员摘要 + facepile（原型 .chat-head）。 */}
        <header className="flex flex-none items-center gap-3 border-b border-border px-4 py-3">
          <span
            aria-hidden
            className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-gradient-to-br from-brand-600 to-info text-xs font-bold text-white shadow-primary"
          >
            群
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-semibold text-foreground">
              {group?.title?.trim() || detail?.title?.trim() || "群聊"}
            </h3>
            <p className="text-xs text-muted-foreground">
              {members.length > 0
                ? `${members.length} 名成员 · ${agentCount} 位 Agent · ${userCount} 位用户`
                : "成员加载中…"}
            </p>
          </div>
          <div className="flex-1" />
          {/* facepile 头像堆叠（+N 溢出；avatar 有值→图片，无值 agent 分色/
              用户 muted 首字，原型 .facepile；运行成员右下小绿点呼吸动画——
              群聊运行态可见 quick 2026-09-02）。 */}
          <div
            className="flex flex-none items-center"
            title={`共 ${members.length} 名成员`}
          >
            {facepile.map((m) => (
              <span
                key={m.id}
                className={cn(
                  "relative flex-none rounded-full border-2 border-card first:ml-0 [&:not(:first-child)]:-ml-1.5",
                  // 运行小绿点位于右下角，叠层时抬高防被右邻头像遮住。
                  runningMemberIds.has(m.id) && "z-10",
                )}
              >
                <GroupMemberAvatar
                  avatar={m.avatar}
                  name={m.display_name}
                  size={28}
                  title={m.display_name}
                  className="rounded-full"
                  fallbackClassName={cn(
                    "h-7 w-7 text-[11px] font-semibold",
                    m.member_type === "agent"
                      ? agentAvatarColor(m.id, m.display_name)
                      : "bg-muted-foreground/70",
                  )}
                />
                {runningMemberIds.has(m.id) && (
                  <span
                    aria-hidden
                    data-testid={`facepile-running-dot-${m.id}`}
                    title={`${m.display_name} 运行中`}
                    className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 animate-pulse rounded-full border-2 border-card bg-success"
                  />
                )}
              </span>
            ))}
            {facepileMore > 0 && (
              <span className="-ml-1.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-card bg-muted text-[11px] font-semibold text-muted-foreground">
                +{facepileMore}
              </span>
            )}
          </div>
          {/* quick-fdd8219a：会话工具栏要素对齐——#群id 短码复制（session-panel
              :3458 惯例）+ 群内搜索（后端 logs q 参数，回车全量查 100 条命中，
              <mark> 高亮，清除恢复；照 session-panel 搜索浮层形态）。 */}
          <button
            type="button"
            aria-label="复制群聊 ID"
            title={`点击复制群聊 ID：${groupId}`}
            data-testid="group-chat-copy-id"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(groupId)
                .then(() => notify.success("已复制群聊 ID"))
                .catch(() => {
                  /* 剪贴板不可用静默（http 环境） */
                });
            }}
            className="flex-none rounded-md border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            #{groupId.slice(0, 8)}
          </button>
          <button
            type="button"
            aria-label="搜索群聊记录"
            title="搜索群聊记录"
            data-testid="group-chat-search-toggle"
            onClick={() => (searchOpen ? resetSearch() : setSearchOpen(true))}
            className="flex-none"
          >
            <Search aria-hidden className="h-4 w-4 text-muted-foreground transition-colors hover:text-foreground" />
          </button>
          {/* 手机端群聊 quick：窄屏「成员」按钮开抽屉（宽屏 hidden——右列常驻）。 */}
          <button
            type="button"
            aria-label="群成员"
            title="群成员"
            data-testid="group-chat-members-toggle"
            onClick={() => setMembersDrawerOpen(true)}
            className="flex-none md:hidden"
          >
            <Users aria-hidden className="h-4 w-4 text-muted-foreground transition-colors hover:text-foreground" />
          </button>
        </header>
        {/* 置顶横幅（quick 群 P2）：图钉 + 内容摘要一行截断 + 成员名 + 时间；
            群主可「取消置顶」（DELETE pinned → invalidate 群详情/列表）。 */}
        {pinned && (
          <div
            data-testid="group-pinned-banner"
            className="flex flex-none items-center gap-2 border-b border-brand-200 bg-brand-50/70 px-4 py-2 dark:border-brand-500/40 dark:bg-brand-500/10"
          >
            <Pin
              aria-hidden
              className="h-3.5 w-3.5 flex-none text-brand-600 dark:text-brand-300"
            />
            <p className="min-w-0 flex-1 truncate text-xs text-foreground" title={pinned.content}>
              <span className="font-semibold">{pinned.member_name}：</span>
              {pinned.content}
              <span className="ml-1.5 flex-none text-[10.5px] text-muted-foreground">
                {formatTime(pinned.pinned_at)}
              </span>
            </p>
            {isOwner && (
              <button
                type="button"
                aria-label="取消置顶"
                title="取消置顶"
                data-testid="group-pinned-unpin"
                disabled={unpinMutation.isPending}
                onClick={() => unpinMutation.mutate()}
                className="flex flex-none items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <PinOff aria-hidden className="h-3 w-3" />
                取消置顶
              </button>
            )}
          </div>
        )}
        {/* 搜索输入行（打开时显示，回车执行 q 查询）。 */}
        {searchOpen && (
          <div className="flex-none border-b border-border px-4 py-2">
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void runSearch();
                }
                if (e.key === "Escape") resetSearch();
              }}
              placeholder="搜索群聊记录，回车查询"
              aria-label="搜索群聊记录"
              data-testid="group-chat-search-input"
              className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-[13px] text-foreground outline-none focus:border-brand-500"
            />
          </div>
        )}
        {searchResults !== null && (
          <div
            data-testid="group-chat-search-results"
            className="max-h-64 flex-none overflow-y-auto border-b border-border bg-muted/30 px-5 py-3"
          >
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                搜索结果 {searchResults.length} 条
              </span>
              <button
                type="button"
                onClick={resetSearch}
                className="text-xs text-brand-600 hover:text-brand-700"
              >
                清除搜索
              </button>
            </div>
            {searchResults.length === 0 && (
              <p className="py-2 text-center text-xs text-muted-foreground">没有匹配的记录</p>
            )}
            {searchResults.map((l) => (
              <div
                key={l.id}
                className="border-b border-border-weak py-1.5 text-[13px] last:border-none"
              >
                <span className="mr-1.5 text-[11px] text-muted-foreground">
                  {String(
                    l.metadata?.member_name ?? l.metadata?.sender_member_name ?? "记录",
                  )}
                </span>
                <SearchHighlight text={l.content_redacted ?? ""} term={searchQuery.trim()} />
              </div>
            ))}
          </div>
        )}

        {/* 平铺时间线（原型 .timeline；容器内距对齐会话 TurnTimeline px-5 py-5）。
            外层 relative 容器承载「回到底部」悬浮按钮（定位相对视口而非滚动内容）。 */}
        <div className="relative min-h-0 flex-1">
          <div
            ref={timelineRef}
            onScroll={handleTimelineScroll}
            data-testid="group-chat-timeline"
            role="log"
            aria-label="群消息时间线"
            className="h-full overflow-y-auto px-5 py-5"
          >
            {/* 向上翻页入口（群 P3 分页 quick）：初始拉满一页才出现；点击按
                before 游标拉更早一页（视口位置保持，见 loadMoreHistory）。 */}
            {hasMoreHistory && entries.length > 0 && (
              <div className="mb-3 flex justify-center">
                <button
                  type="button"
                  data-testid="group-load-earlier"
                  disabled={loadingMore}
                  onClick={() => void loadMoreHistory()}
                  className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loadingMore
                    ? "加载中…"
                    : loadMoreError
                      ? "加载失败，点击重试"
                      : "加载更早消息"}
                </button>
              </div>
            )}
            {entries.length === 0 && (
            <p
              data-testid="group-chat-timeline-empty"
              className="py-10 text-center text-xs text-muted-foreground"
            >
              {detailQ.isError ? (
                <>
                  群消息加载失败。
                  <button
                    type="button"
                    onClick={() => void detailQ.refetch()}
                    className="ml-1 underline underline-offset-2 hover:text-foreground"
                  >
                    点击重试
                  </button>
                </>
              ) : detailQ.isLoading || presenceListQ.isLoading ? (
                "群消息加载中…"
              ) : (
                "还没有消息——发第一句，@昵称 唤起指定 Agent 成员"
              )}
            </p>
          )}
          {entries.map((entry) => (
            <Fragment key={entry.id}>
              {/* 群 P2 未读分隔线（微信式居中细线+文字）：挂载快照的第 N 条未读
                  消息前插一次；会话中后续新消息不再插线（锚点只算一次）。 */}
              {unreadDivider?.beforeId === entry.id && (
                <div
                  data-testid="group-unread-divider"
                  data-before-log-id={unreadDivider.beforeId}
                  role="separator"
                  aria-label={`以下 ${unreadDivider.count} 条为新消息`}
                  className="my-3 flex items-center gap-2"
                >
                  <span aria-hidden className="h-px min-w-8 flex-1 bg-border" />
                  <span className="flex-none text-[11px] font-medium text-brand-600 dark:text-brand-300">
                    以下 {unreadDivider.count} 条为新消息
                  </span>
                  <span aria-hidden className="h-px min-w-8 flex-1 bg-border" />
                </div>
              )}
              <GroupTimelineRow
                entry={entry}
                memberNames={memberNames}
                replying={
                  entry.kind === "user"
                    ? (replyingBy[entry.id] ?? NO_REPLYING)
                    : NO_REPLYING
                }
                onQuote={handleQuoteReply}
                providerLabel={
                  entry.kind === "agent"
                    ? entry.memberId
                      ? (providerLabelByMemberKey.get(entry.memberId) ??
                        providerLabelByMemberKey.get(entry.memberName ?? "") ??
                        null)
                      : (providerLabelByMemberKey.get(entry.memberName ?? "") ?? null)
                    : null
                }
                avatar={
                  entry.kind === "user"
                    ? (entry.senderUserId
                        ? avatarByUserId.get(entry.senderUserId)
                        : undefined) ||
                      avatarByMemberKey.get(entry.senderName) ||
                      null
                    : entry.kind === "agent"
                      ? (entry.memberId
                          ? avatarByMemberKey.get(entry.memberId) ??
                            avatarByMemberKey.get(entry.memberName ?? "")
                          : avatarByMemberKey.get(entry.memberName ?? "")) || null
                      : null
                }
                streaming={
                  entry.kind === "agent" &&
                  streamingKeys.has(agentStreamKey(entry)) &&
                  lastAgentIdByStreamKey.get(agentStreamKey(entry)) === entry.id
                }
                canPin={isOwner && entry.kind !== "system"}
                isPinned={pinned?.log_id === entry.id}
                pinPending={pinMutation.isPending}
                onPin={handlePin}
              />
            </Fragment>
          ))}
          </div>
          {/* 回到底部悬浮按钮（群 P3 quick）：离开底部出现；离开期间有新消息
              显示「N 条新消息」，否则只显示「回到底部」。 */}
          {!nearBottom && (
            <button
              type="button"
              data-testid="group-jump-bottom"
              onClick={jumpToBottom}
              className="absolute bottom-3 right-4 z-10 inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-md transition-colors hover:bg-muted"
            >
              <ArrowDown aria-hidden className="h-3.5 w-3.5" />
              {newCount > 0 ? `${newCount} 条新消息` : "回到底部"}
            </button>
          )}
        </div>

        {/* typing 指示器（原型 .typing-bar：谁正在输入 + 三点动画 + 草稿预览）。 */}
        <div
          data-testid="group-typing-bar"
          aria-live="polite"
          className={cn(
            "min-h-0 overflow-hidden px-5 transition-all",
            typingIndicators.length > 0 ? "max-h-10 py-1.5" : "max-h-0",
          )}
        >
          {typingIndicators.map((ind) => (
            <div
              key={ind.key}
              data-testid="group-typing-bubble"
              className="inline-flex max-w-full items-center gap-2 rounded-2xl rounded-tl-md border border-border bg-card px-3.5 py-2 text-xs text-muted-foreground shadow-sm"
            >
              <span className="shrink-0 font-medium text-foreground">
                {ind.name}
                {ind.kind === "agent" ? "（Agent）" : ""}
              </span>
              {/* 会话同款三点脉冲（.sh-typing-dots utility，task-13 会话 AI 观感）。 */}
              <span aria-hidden className="sh-typing-dots shrink-0">
                <span />
                <span />
                <span />
              </span>
              <span className="min-w-0 truncate">
                {ind.kind === "agent"
                  ? "正在生成回复…"
                  : ind.preview
                    ? `正在输入：${ind.preview}`
                    : "正在输入…"}
              </span>
            </div>
          ))}
        </div>

        {/* 输入区（原型 .composer：@补全浮层 + textarea + 工具条）。 */}
        <div className="relative flex-none px-4 pb-4 pt-3">
          {mentionOpen && (
            <SessionMentionPopover
              trigger="@"
              query={mentionDetection?.query ?? ""}
              items={mentionItems}
              activeIndex={mentionActiveIndex}
              onSelect={(entity) => {
                if ("displayName" in entity) {
                  handleMentionSelect(
                    entity as { displayName: string },
                  );
                }
              }}
              onClose={() => {
                /* 关层由 detectMention 状态驱动（Esc 放行后键入空白自然关层）。 */
              }}
            />
          )}
          <div className="rounded-xl border border-border bg-card shadow-sm transition-[border-color,box-shadow] focus-within:border-primary focus-within:shadow-primary">
            {/* 群 P2 引用条：被引用消息摘要一行 + 取消（发送随 body 带
                reply_to_log_id；X 清空回到普通发送）。 */}
            {replyTarget && (
              <div
                data-testid="group-reply-bar"
                data-reply-to-log-id={replyTarget.logId}
                className="flex items-center gap-2 border-b border-border px-3 py-2"
              >
                <Quote
                  aria-hidden
                  className="h-3.5 w-3.5 flex-none text-brand-600 dark:text-brand-300"
                />
                <p
                  className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
                  title={`${replyTarget.memberName}：${replyTarget.contentHead}`}
                >
                  <span className="font-semibold text-foreground">
                    {replyTarget.memberName}
                  </span>
                  <span className="mx-1">：</span>
                  {replyTarget.contentHead}
                </p>
                <button
                  type="button"
                  aria-label="取消引用回复"
                  title="取消引用回复"
                  data-testid="group-reply-cancel"
                  onClick={() => setReplyTarget(null)}
                  className="flex h-5 w-5 flex-none items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <X aria-hidden className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            {/* 待发附件 chips（FR-05 补遗，单聊 session-input-bar 同形态）。 */}
            {(pendingAttachments.length > 0 || uploading > 0 || uploadError) && (
              <div className="space-y-1.5 px-3 pt-2.5">
                <div className="flex flex-wrap gap-1.5">
                  {pendingAttachments.map((att) => (
                    <span
                      key={att.id}
                      data-testid="group-pending-attachment-chip"
                      className="flex max-w-[220px] items-center gap-1 rounded border border-input bg-muted/50 px-2 py-1 text-[11px]"
                      title={`${att.name} · ${formatBytes(att.bytes)}`}
                    >
                      <span className="inline-flex shrink-0 items-center gap-1 truncate">
                        {att.kind === "image" ? (
                          <ImageIcon aria-hidden className="h-3 w-3" />
                        ) : (
                          <FileText aria-hidden className="h-3 w-3" />
                        )}
                        <span className="truncate">{att.name}</span>
                        <span className="shrink-0 text-muted-foreground">
                          {formatBytes(att.bytes)}
                        </span>
                      </span>
                      <button
                        type="button"
                        aria-label={`移除附件 ${att.name}`}
                        onClick={() => void handleRemoveAttachment(att)}
                        className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  {uploading > 0 && (
                    <span className="flex items-center gap-1 rounded border border-input px-2 py-1 text-[11px] text-muted-foreground">
                      <RefreshCw className="h-3 w-3 animate-spin" /> 上传中…（{uploading}）
                    </span>
                  )}
                </div>
                {uploadError && (
                  <p className="text-[11px] text-destructive">{uploadError}</p>
                )}
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              aria-label="选择群消息附件"
              onChange={(e) => void handleFiles(e.target.files)}
            />
            <textarea
              ref={inputRef}
              value={draft}
              rows={1}
              aria-label="群消息输入框"
              placeholder="发送消息，@昵称 唤起指定 Agent，@全体 通知所有 Agent…"
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleInputKeyDown}
              onPaste={(e) => {
                // 剪贴板带文件（截图等）→ 与 📎 同上传管线（单聊同口径）。
                const files = e.clipboardData?.files;
                if (!files || files.length === 0) return;
                e.preventDefault();
                void handleFiles(files);
              }}
              className="max-h-[120px] min-h-[44px] w-full resize-none border-none bg-transparent px-3.5 py-2.5 text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground/70"
            />
            <div className="flex items-center gap-2 px-2.5 pb-2 pt-1">
              <button
                type="button"
                aria-label="添加附件"
                title="添加图片/文件附件，支持 Ctrl+V 直接粘贴"
                disabled={sending}
                onClick={() => fileRef.current?.click()}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Paperclip aria-hidden className="h-4 w-4" />
              </button>
              <p className="text-[11px] text-muted-foreground/80">
                Enter 发送 · Shift+Enter 换行 · 输入 @ 提及成员
              </p>
              <div className="flex-1" />
              <button
                type="button"
                aria-label="发送群消息"
                disabled={sending || (!draft.trim() && pendingAttachments.length === 0)}
                onClick={() => void handleSend()}
                className="inline-flex items-center gap-1 rounded-full bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <SendHorizontal aria-hidden className="h-3.5 w-3.5" />
                发送
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── 右列：成员面板（task-09；原型 .members-panel 常驻右栏形态——宽屏
          常驻；窄屏 hidden，改顶栏「成员」按钮开下方 Drawer） ── */}
      <div className="hidden min-h-0 md:block">
      {detail ? (
        <MemberPanel
          group={detail}
          onlineMemberIds={onlineMemberIds}
          runningMemberIds={runningMemberIds}
          currentUserId={currentUserId}
          onRefresh={() => {
            void qc.invalidateQueries({ queryKey: ["groupChats"] });
            void qc.invalidateQueries({ queryKey: ["groupChat", groupId] });
            onSessionListRefresh?.();
          }}
        />
      ) : (
        <aside
          data-testid="group-member-panel-loading"
          aria-label={detailQ.isError ? "群成员面板加载失败" : "群成员面板加载中"}
          className="flex h-full min-h-0 flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl border border-dashed border-border bg-card px-6 text-center shadow-sm"
        >
          <Users aria-hidden className="h-6 w-6 text-brand-600" />
          {detailQ.isError ? (
            <>
              <p className="text-xs text-destructive">群详情加载失败</p>
              <button
                type="button"
                data-testid="group-detail-retry"
                onClick={() => void detailQ.refetch()}
                className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-accent"
              >
                重试
              </button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">群成员加载中…</p>
          )}
        </aside>
      )}
      </div>

      {/* 手机端群聊 quick：窄屏成员抽屉（顶栏「成员」按钮开关；宽屏按钮
          hidden 不渲染）。 */}
      <Drawer
        open={membersDrawerOpen}
        onClose={() => setMembersDrawerOpen(false)}
        placement="right"
        width="min(84vw, 340px)"
        title="群成员"
        styles={{ body: { padding: 0 } }}
      >
        {detail ? (
          <MemberPanel
            group={detail}
            onlineMemberIds={onlineMemberIds}
            runningMemberIds={runningMemberIds}
            currentUserId={currentUserId}
            onRefresh={() => {
              void qc.invalidateQueries({ queryKey: ["groupChats"] });
              void qc.invalidateQueries({ queryKey: ["groupChat", groupId] });
              onSessionListRefresh?.();
            }}
          />
        ) : detailQ.isError ? (
          <p className="p-6 text-center text-xs text-destructive">
            群详情加载失败
            <button
              type="button"
              onClick={() => void detailQ.refetch()}
              className="ml-1 underline underline-offset-2"
            >
              点击重试
            </button>
          </p>
        ) : (
          <p className="p-6 text-center text-xs text-muted-foreground">群成员加载中…</p>
        )}
      </Drawer>
    </div>
  );
}

/* ────────────────────── 时间线行渲染 ────────────────────── */

/**
 * 单条时间线行（用户/agent 气泡 + 系统事件居中；原型 .msg / .sys-event）。
 *
 * memo 化（群 P3 quick）：流式期间每个 SSE 事件都会重建 entries 数组，未 memo
 * 时全部历史行随每个 token 重渲染；props 已全部稳定——entry 引用（归并函数
 * 不可变更新）、memberNames（useMemo）、replying（map 内空集用模块常量
 * NO_REPLYING）、onPin/onQuote（useCallback），memo 浅比较后仅变化行重渲染。
 *
 * 群聊体验对齐 quick（2026-09-02）：视觉 token 对照会话 TurnTimeline conversation
 * 视图抄语义类（不改 TurnTimeline 本身）——
 *   - 用户消息（self 右）：rounded-2xl rounded-br-md bg-primary px-4 py-2.5
 *     text-sm leading-6 text-primary-foreground shadow-sm（会话用户气泡同款，
 *     时间在气泡左侧 + 发送者头像在右）；
 *   - 用户消息（他人左）/ agent 回复：rounded-2xl rounded-tl-md border bg-card
 *     px-4 py-2.5 text-sm leading-6 shadow-sm（会话助手卡片同款）；头像统一
 *     28px 圆形（会话 h-7 w-7 rounded-full 惯例），成员分色/引擎标签/@提及
 *     高亮等群特有元素融合进该风格；
 *   - 系统事件居中灰字胶囊（会话相邻的 muted 语义）。
 */
/** 气泡右上角图钉小按钮（quick 群 P2：群主可见；点击置顶该消息）。 */
function PinMessageButton({
  logId,
  onPin,
  disabled,
  className,
}: {
  logId: string;
  onPin: (logId: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label="置顶该消息"
      title="置顶该消息"
      data-testid="group-msg-pin"
      data-log-id={logId}
      disabled={disabled}
      onClick={() => onPin(logId)}
      className={cn(
        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-muted hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:text-brand-300",
        className,
      )}
    >
      <Pin aria-hidden className="h-3 w-3" />
    </button>
  );
}

/**
 * 气泡「引用回复」小按钮（群 P2 第二波：**全员可见**，行容器 group hover 浮现；
 * 点击把被引用消息摘要挂到输入区引用条）。jsdom 无 hover——按钮恒在 DOM，
 * opacity 仅视觉（测试可直接命中）。
 */
function QuoteMessageButton({
  target,
  onQuote,
  className,
}: {
  target: GroupQuoteTarget;
  onQuote: (target: GroupQuoteTarget) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label="引用回复"
      title="引用回复"
      data-testid="group-msg-reply"
      data-log-id={target.logId}
      onClick={() => onQuote(target)}
      className={cn(
        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/60 opacity-0 transition-colors hover:bg-muted hover:text-brand-600 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:text-brand-300",
        className,
      )}
    >
      <Quote aria-hidden className="h-3 w-3" />
    </button>
  );
}

/**
 * 气泡顶部引用条（群 P2 第二波）：左侧竖线 + 被引用成员名 + 内容摘要截断
 * （纯视觉呈现，不跳转定位原消息）。self 气泡走白色半透明阶（primary 底上
 * 可读），他人气泡走 muted + brand 竖线。
 */
function ReplyQuoteBar({
  snapshot,
  self,
}: {
  snapshot: GroupMessageReplySnapshot;
  self: boolean;
}) {
  return (
    <div
      data-testid="group-msg-reply-quote"
      data-reply-to-log-id={snapshot.log_id}
      className={cn(
        "mb-1.5 flex items-center gap-1.5 rounded-md border-l-2 px-2 py-1 text-[11px] leading-4",
        self
          ? "border-white/60 bg-white/15 text-white/85"
          : "border-brand-400 bg-muted/60 text-muted-foreground dark:border-brand-500/60",
      )}
    >
      <span className={cn("shrink-0 font-semibold", !self && "text-foreground")}>
        {snapshot.member_name}
      </span>
      <span className="min-w-0 truncate">{snapshot.content_head}</span>
    </div>
  );
}

function GroupTimelineRowInner({
  entry,
  memberNames,
  replying,
  providerLabel,
  avatar,
  streaming,
  canPin,
  isPinned,
  pinPending,
  onPin,
  onQuote,
}: {
  entry: GroupTimelineEntry;
  memberNames: readonly string[];
  /** 触发消息下方「XX 正在回复…」标签集（仅 user 条目消费；群聊运行态可见 quick）。 */
  replying: GroupReplyingMember[];
  providerLabel: string | null;
  /** 发送者头像 URL（群详情成员表解析；空 → 首字回退，quick 头像自定义）。 */
  avatar: string | null;
  streaming: boolean;
  /** 群主可见置顶入口（quick 群 P2；系统行不可置顶由调用方保证）。 */
  canPin: boolean;
  /** 该行是当前置顶消息（quick 群 P2 浅 brand 底高亮）。 */
  isPinned: boolean;
  /** 置顶请求进行中（防连点）。 */
  pinPending: boolean;
  onPin: (logId: string) => void;
  /** 引用回复入口（群 P2：全员可用；目标=本行摘要）。 */
  onQuote: (target: GroupQuoteTarget) => void;
}) {
  // 已置顶行高亮：浅 brand 底 + 等宽外扩（-mx-2 px-2 不改变行宽，仅底色外延）。
  const pinnedRowClass = isPinned
    ? "-mx-2 rounded-xl bg-brand-50/70 px-2 dark:bg-brand-500/10"
    : "";

  // 引用回复目标摘要（群 P2：本行内容现算，口径对齐后端 content_head(60)）。
  const quoteTarget: GroupQuoteTarget | null =
    entry.kind === "user"
      ? {
          logId: entry.id,
          memberName: entry.senderName,
          contentHead: quoteHeadOf(entry.content),
        }
      : entry.kind === "agent"
        ? {
            logId: entry.id,
            memberName: entry.memberName ?? "Agent 成员",
            contentHead: quoteHeadOf(entry.content),
          }
        : null;

  if (entry.kind === "system") {
    return (
      <div
        data-testid="group-system-event"
        className="my-2.5 text-center text-[11px] text-muted-foreground"
      >
        <span className="rounded-full bg-muted/60 px-2.5 py-0.5">{entry.content}</span>
      </div>
    );
  }

  if (entry.kind === "user") {
    const chips = entry.attachments ? summaryToChips(entry.attachments) : [];
    if (entry.isSelf) {
      // 会话用户气泡同款（右）：[时间][气泡列][头像]。
      return (
        <div
          data-testid="group-msg-user"
          data-self="true"
          data-sender={entry.senderName}
          data-log-id={entry.id}
          className={cn("group my-2.5 flex items-end justify-end gap-1.5", pinnedRowClass)}
        >
          <span className="shrink-0 pb-1 text-[10.5px] text-muted-foreground">
            {formatTime(entry.timestamp)}
          </span>
          <div className="flex max-w-[82%] flex-col items-end gap-1">
            {/* 悬浮操作行（群 P2：引用回复全员 + 群主图钉；hover 浮现）。 */}
            {quoteTarget && (
              <div className="-mb-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                {canPin && (
                  <PinMessageButton logId={entry.id} onPin={onPin} disabled={pinPending} />
                )}
                <QuoteMessageButton target={quoteTarget} onQuote={onQuote} />
              </div>
            )}
            {chips.length > 0 && <AttachmentChips attachments={chips} align="end" />}
            {(entry.replyTo || entry.content) && (
              <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-6 text-primary-foreground shadow-sm">
                {entry.replyTo && <ReplyQuoteBar snapshot={entry.replyTo} self />}
                {entry.content
                  ? renderMentionHighlights(entry.content, memberNames, true)
                  : null}
              </div>
            )}
            <ReplyingTags replying={replying} />
          </div>
          <GroupMemberAvatar
            avatar={avatar}
            name={entry.senderName}
            size={28}
            className="rounded-full"
            fallbackClassName={cn(
              "h-7 w-7 text-xs",
              entry.isSelf ? "bg-brand-600" : "bg-muted-foreground/70",
            )}
          />
        </div>
      );
    }
    // 他人用户消息（左）：头像 + 成员名行 + 会话卡片样式气泡。
    return (
      <div
        data-testid="group-msg-user"
        data-sender={entry.senderName}
        data-log-id={entry.id}
        className={cn("group my-2.5 flex items-start gap-2.5", pinnedRowClass)}
      >
        <GroupMemberAvatar
          avatar={avatar}
          name={entry.senderName}
          size={28}
          className="mt-0.5 rounded-full"
          fallbackClassName="h-7 w-7 bg-muted-foreground/70 text-xs"
        />
        <div className="min-w-0 max-w-[82%]">
          <div className="mb-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{entry.senderName}</span>
            <span className="text-[10.5px]">{formatTime(entry.timestamp)}</span>
            {canPin && (
              <PinMessageButton logId={entry.id} onPin={onPin} disabled={pinPending} />
            )}
            {quoteTarget && <QuoteMessageButton target={quoteTarget} onQuote={onQuote} />}
          </div>
          {chips.length > 0 && <AttachmentChips attachments={chips} align="start" />}
          {(entry.replyTo || entry.content) && (
            <div className="whitespace-pre-wrap break-words rounded-2xl rounded-tl-md border border-border bg-card px-4 py-2.5 text-sm leading-6 text-foreground shadow-sm">
              {entry.replyTo && <ReplyQuoteBar snapshot={entry.replyTo} self={false} />}
              {entry.content
                ? renderMentionHighlights(entry.content, memberNames, false)
                : null}
            </div>
          )}
          <ReplyingTags replying={replying} />
        </div>
      </div>
    );
  }

  // agent 回复卡片（左，会话助手卡片同款）：头像 + 成员名/引擎标签行 + 正文区
  // （Markdown 渲染保留）+ 流式光标（原型 .msg）。
  return (
    <div
      data-testid="group-msg-agent"
      data-member-id={entry.memberId ?? undefined}
      data-member-name={entry.memberName ?? undefined}
      data-log-id={entry.id}
      className={cn("group my-2.5 flex items-start gap-2.5", pinnedRowClass)}
    >
      <GroupMemberAvatar
        avatar={avatar}
        name={entry.memberName ?? "Agent"}
        size={28}
        className="mt-0.5 rounded-full"
        fallbackClassName={cn(
          "h-7 w-7 text-xs",
          agentAvatarColor(entry.memberId, entry.memberName),
        )}
      />
      <div className="min-w-0 max-w-[82%]">
        <div className="mb-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">
            {entry.memberName ?? "Agent 成员"}
          </span>
          {providerLabel && (
            <span className="font-mono text-[10px] text-muted-foreground/70">
              {providerLabel}
            </span>
          )}
          <span className="text-[10.5px]">{formatTime(entry.timestamp)}</span>
          {canPin && (
            <PinMessageButton logId={entry.id} onPin={onPin} disabled={pinPending} />
          )}
          {quoteTarget && <QuoteMessageButton target={quoteTarget} onQuote={onQuote} />}
        </div>
        {/* 群聊体验 quick（2026-09-02）：agent 回复走 MarkdownText（content 已经
            classifySessionLog 剥 [ASSISTANT] 等前缀；流式 partial 同容器容错渲染），
            @提及高亮仅在用户消息纯文本路径保留（md 气泡内 @ 自然显示，从简）。 */}
        <div className="break-words rounded-2xl rounded-tl-md border border-border bg-card px-4 py-2.5 text-sm leading-6 text-foreground shadow-sm">
          <MarkdownText content={entry.content} />
          {streaming && (
            <span
              data-testid="group-stream-cursor"
              aria-hidden
              className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-[1px] bg-brand-600 align-text-bottom"
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** 时间线行（memo 包装——流式期间仅变化行重渲染，理由见 GroupTimelineRowInner 头注）。 */
const GroupTimelineRow = memo(GroupTimelineRowInner);

/**
 * 「XX 正在回复…」标签行（群聊运行态可见 quick 2026-09-02，核心新需求）：
 * 挂在触发消息（typing 事件 reply_to_log_id 锚定的 user_input 行）气泡下方，
 * 「{member_name} 正在回复…」brand 语义阶描边小标签 + 三点动画（.sh-typing-dots
 * 复用）；同一消息可多个 agent 响应（@全体）→ 横排多标签。
 */
function ReplyingTags({ replying }: { replying: GroupReplyingMember[] }) {
  if (replying.length === 0) return null;
  return (
    <div
      data-testid="replying-tags"
      className="mt-1 flex flex-wrap items-center gap-1.5"
    >
      {replying.map((r) => (
        <span
          key={r.key}
          data-testid={`replying-tag-${r.memberId ?? r.memberName}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-brand-300 bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 dark:border-brand-500/50 dark:bg-brand-500/10 dark:text-brand-300"
        >
          {/* 会话同款三点脉冲（.sh-typing-dots utility 复用）。 */}
          <span aria-hidden className="sh-typing-dots shrink-0">
            <span />
            <span />
            <span />
          </span>
          {r.memberName} 正在回复…
        </span>
      ))}
    </div>
  );
}

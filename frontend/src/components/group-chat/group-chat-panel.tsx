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
 *     preview，TTL 2.5s 过期自动消失（design §5.4；agent typing 显示成员昵称）；
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
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Image as ImageIcon, Paperclip, RefreshCw, SendHorizontal, Users, X } from "lucide-react";

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
  maxLogTimestamp,
  sendGroupMessage,
  sendGroupTyping,
  streamGroupChat,
  type GroupChatListItemRead,
  type GroupChatStreamEnvelope,
  type GroupMessageAttachmentSummary,
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

/** typing 指示器条目（TTL 2.5s 过期自动消失；key=成员昵称）。 */
export interface GroupTypingIndicator {
  key: string;
  name: string;
  /** user=用户成员 / agent=后端代发（「成员正在生成回复」）。 */
  kind: string;
  preview: string | null;
  expiresAt: number;
}

/** typing 事件 → 指示器表（纯函数：typing=true upsert / false 移除 / 过期裁剪）。 */
export function applyTypingEvent(
  map: Record<string, GroupTypingIndicator>,
  event: { member_name: string | null; member_kind?: string | null; typing: boolean; preview?: string | null },
  now: number,
  ttlMs: number = GROUP_TYPING_TTL_MS,
): Record<string, GroupTypingIndicator> {
  const name = event.member_name?.trim();
  if (!name) return map;
  const next = { ...map };
  if (!event.typing) {
    delete next[name];
    return next;
  }
  next[name] = {
    key: name,
    name,
    kind: event.member_kind ?? "user",
    preview: event.preview?.trim() || null,
    expiresAt: now + ttlMs,
  };
  return next;
}

/** 裁剪过期指示器（渲染前调用；返回原引用当无过期，避免无谓重渲染）。 */
export function pruneTypingIndicators(
  map: Record<string, GroupTypingIndicator>,
  now: number,
): Record<string, GroupTypingIndicator> {
  let changed = false;
  const next: Record<string, GroupTypingIndicator> = {};
  for (const ind of Object.values(map)) {
    if (ind.expiresAt > now) next[ind.key] = ind;
    else changed = true;
  }
  return changed ? next : map;
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

  /* ── typing 指示器（TTL 2.5s；周期裁剪驱动过期消失） ── */
  const [typingMap, setTypingMap] = useState<Record<string, GroupTypingIndicator>>({});
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
   *    （在群内盯着时间线时到达的 @不构成未读）。 ── */
  useEffect(() => {
    markGroupOpened(groupId);
  }, [groupId]);

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

    void (async () => {
      // 回放读库（刷新回放：user_input 行 + 投影行，统一排序平铺）。
      try {
        const logs = (await getAgentSessionLogs(sessionId)) as GroupReplayLogEntry[];
        if (cancelled) return;
        const built = buildTimelineFromReplay(logs, currentUserIdRef.current);
        setEntries(built);
        for (const e of built) seenIdsRef.current.add(e.id);
        const lastTs = maxLogTimestamp(logs);
        if (lastTs) lastLogTsRef.current = lastTs;
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
            markGroupOpened(groupId);
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
          },
          onTyping: (event) => {
            setTypingMap((map) => applyTypingEvent(map, event, Date.now()));
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

  /* ── 时间线自动滚底（新行到达且视口贴近底部时跟随）。 ── */
  const timelineRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [entries, typingMap]);

  /* ── 输入区：草稿 / @补全 / typing 上报 / 发送 / 附件（FR-05 补遗） ── */
  const [draft, setDraft] = useState("");
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
    setDraft(value);
    // 回填后光标复位到插入段之后（jsdom 无 rAF 时同步兜底）。
    const restore = () => {
      if (!input) return;
      input.focus();
      input.setSelectionRange(caret, caret);
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(restore);
    } else {
      restore();
    }
  }, [draft]);

  /** 附件上传（单聊 handleFiles 同管线：逐文件上传，失败 toast 不中断其余）。 */
  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadError(null);
    for (const file of Array.from(files).slice(0, 10)) {
      const kind = file.type.startsWith("image/") ? "image" : "file";
      setUploading((n) => n + 1);
      try {
        const added = await uploadSessionAttachment(file, kind);
        setPendingAttachments((prev) => [...prev, added]);
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "上传失败");
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

  const handleSend = useCallback(async () => {
    const content = draft.trim();
    const attachmentIds = pendingAttachments.map((a) => a.id);
    if ((!content && attachmentIds.length === 0) || sending) return;
    setSending(true);
    // 发送即收口 typing（停顿指示器 + 心跳）。
    stopTypingReport();
    typingLastSentRef.current = 0;
    void sendGroupTyping(groupId, { typing: false }).catch(() => {});
    try {
      await sendGroupMessage(
        groupId,
        content,
        attachmentIds.length > 0 ? attachmentIds : undefined,
      );
      setDraft("");
      setPendingAttachments([]);
      setUploadError(null);
      // 发送成功主动对账一次（未 @ 消息无成员轮次，SSE log 事件丢失时兜回显）。
      streamConnRef.current?.resync?.();
    } catch (err) {
      // 队列满（HTTP_409_DAEMON_SESSION_QUEUE_FULL）等业务错误：消息可能已落
      // 时间线（design §4.1 失败语义）——提示原文，时间线以对账回显为准；
      // 附件与草稿保留供重发。
      notify.error(errMessage(err, "发送失败，请稍后重试"));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [draft, sending, groupId, pendingAttachments, notify, stopTypingReport]);

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

  const typingIndicators = Object.values(typingMap);

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
        "grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px] gap-3.5",
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
              用户 muted 首字，原型 .facepile）。 */}
          <div
            className="flex flex-none items-center"
            title={`共 ${members.length} 名成员`}
          >
            {facepile.map((m) => (
              <GroupMemberAvatar
                key={m.id}
                avatar={m.avatar}
                name={m.display_name}
                size={28}
                title={m.display_name}
                className="rounded-full border-2 border-card first:ml-0 [&:not(:first-child)]:-ml-1.5"
                fallbackClassName={cn(
                  "h-7 w-7 text-[11px] font-semibold",
                  m.member_type === "agent"
                    ? agentAvatarColor(m.id, m.display_name)
                    : "bg-muted-foreground/70",
                )}
              />
            ))}
            {facepileMore > 0 && (
              <span className="-ml-1.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-card bg-muted text-[11px] font-semibold text-muted-foreground">
                +{facepileMore}
              </span>
            )}
          </div>
        </header>

        {/* 平铺时间线（原型 .timeline；容器内距对齐会话 TurnTimeline px-5 py-5）。 */}
        <div
          ref={timelineRef}
          data-testid="group-chat-timeline"
          role="log"
          aria-label="群消息时间线"
          className="min-h-0 flex-1 overflow-y-auto px-5 py-5"
        >
          {entries.length === 0 && (
            <p
              data-testid="group-chat-timeline-empty"
              className="py-10 text-center text-xs text-muted-foreground"
            >
              {detailQ.isLoading || presenceListQ.isLoading
                ? "群消息加载中…"
                : "还没有消息——发第一句，@昵称 唤起指定 Agent 成员"}
            </p>
          )}
          {entries.map((entry) => (
            <GroupTimelineRow
              key={entry.id}
              entry={entry}
              memberNames={memberNames}
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
            />
          ))}
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

      {/* ── 右列：成员面板（task-09；原型 .members-panel 常驻右栏形态） ── */}
      {detail ? (
        <MemberPanel
          group={detail}
          onlineMemberIds={onlineMemberIds}
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
          aria-label="群成员面板加载中"
          className="flex min-h-0 flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl border border-dashed border-border bg-card px-6 text-center shadow-sm"
        >
          <Users aria-hidden className="h-6 w-6 text-brand-600" />
          <p className="text-xs text-muted-foreground">群成员加载中…</p>
          {detailQ.isError && (
            <p className="text-xs text-destructive">群详情加载失败，稍后自动重试</p>
          )}
        </aside>
      )}
    </div>
  );
}

/* ────────────────────── 时间线行渲染 ────────────────────── */

/** 单条时间线行（用户/agent 气泡 + 系统事件居中；原型 .msg / .sys-event）。
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
function GroupTimelineRow({
  entry,
  memberNames,
  providerLabel,
  avatar,
  streaming,
}: {
  entry: GroupTimelineEntry;
  memberNames: readonly string[];
  providerLabel: string | null;
  /** 发送者头像 URL（群详情成员表解析；空 → 首字回退，quick 头像自定义）。 */
  avatar: string | null;
  streaming: boolean;
}) {
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
          className="my-2.5 flex items-end justify-end gap-1.5"
        >
          <span className="shrink-0 pb-1 text-[10.5px] text-muted-foreground">
            {formatTime(entry.timestamp)}
          </span>
          <div className="flex max-w-[82%] flex-col items-end gap-1">
            {chips.length > 0 && <AttachmentChips attachments={chips} align="end" />}
            {entry.content ? (
              <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-6 text-primary-foreground shadow-sm">
                {renderMentionHighlights(entry.content, memberNames, true)}
              </div>
            ) : null}
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
        className="my-2.5 flex items-start gap-2.5"
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
          </div>
          {chips.length > 0 && <AttachmentChips attachments={chips} align="start" />}
          {entry.content ? (
            <div className="whitespace-pre-wrap break-words rounded-2xl rounded-tl-md border border-border bg-card px-4 py-2.5 text-sm leading-6 text-foreground shadow-sm">
              {renderMentionHighlights(entry.content, memberNames, false)}
            </div>
          ) : null}
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
      className="my-2.5 flex items-start gap-2.5"
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

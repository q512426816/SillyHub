// runtime-session-helpers.tsx: 从 page.tsx 提取的会话列表/历史回看/attach 续聊 helper（task-01）
"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MessageSquarePlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MarkdownText } from "@/components/ui/markdown-text";
import { SessionPanel } from "@/components/daemon/session-panel";
import type { SessionTurnView } from "@/components/daemon/turn-timeline";
import { classifySessionLog } from "@/components/daemon/session-log-sanitize";
import {
  extractPreambleText,
  logsToSegments,
  segmentsToLegacy,
  stripPreambleText,
  type AssemblerLogInput,
  type TurnSegment,
} from "@/components/daemon/session-log-assembler";
import { type AgentRunLogEntry } from "@/lib/agent";
import {
  type AgentSessionRead,
  type AgentSessionStatus,
  type DaemonRuntimeRead,
} from "@/lib/daemon";
import { cn } from "@/lib/utils";

export function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id;
}

/**
 * task-11：交互式会话面板包装（演进自 quick-chat）。
 *
 * 保留 provider/model 选择 + runtime 卡片布局，会话核心替换为
 * InteractiveSessionPanel（单一 SSE 贯穿多 turn / inject / interrupt / end）。
 * 旧 QuickChatPanel / quickChat / streamQuickChat / getQuickChatResult / getQuickChatLogs
 * 保留用于 brownfield 回归，不再被页面使用。
 */
export function InteractiveSessionChatSection({
  runtimes,
  attachSession,
  initialTurns,
  onCloseAttach,
  focusProvider,
}: {
  runtimes: DaemonRuntimeRead[];
  attachSession?: AgentSessionRead;
  initialTurns?: SessionTurnView[];
  onCloseAttach?: () => void;
  /** ql-012：runtime 卡片「会话」聚焦时钦定的 provider（覆盖默认 claude 优先）。 */
  focusProvider?: string;
}) {
  // ql-20260623（改动一）：用 ?session=<id> 在 URL 中承载当前活跃会话 id，
  // 刷新后从 URL 恢复。router.replace 不进历史栈。
  const router = useRouter();
  const searchParams = useSearchParams();

  // task-08 / D-005@v1：Codex 与 Claude 均走 interactive SessionManager（撤销 quick-chat 分流）。
  // daemon SessionManager（task-06）与 backend reopen（task-07）已放开 codex，二者都是
  // 在线 interactive provider。
  const onlineProviders = useMemo(() => {
    const SUPPORTED_SESSION_PROVIDERS = ["claude", "codex"];
    const list = runtimes
      .filter(
        (r) =>
          r.status === "online" &&
          r.provider &&
          SUPPORTED_SESSION_PROVIDERS.includes(r.provider),
      )
      .map((r) => r.provider!);
    return [...new Set(list)];
  }, [runtimes]);
  const [model, setModel] = useState<string | null>(null);
  const hasOnlineProvider = onlineProviders.length > 0;
  // ql-012：runtime 卡片聚焦时用 focusProvider 钦定；否则优先 claude，再退首个在线 provider。
  const defaultProvider = focusProvider
    ?? attachSession?.provider
    ?? (onlineProviders.includes("claude") ? "claude" : (onlineProviders[0] ?? "claude"));
  // providers 列表：有在线时用在线列表，无在线时给占位让组件能渲染
  const providers = hasOnlineProvider ? onlineProviders : [defaultProvider];

  // ql-20260623（改动一）：createSession 成功 → 写 ?session=<id>（保留其它 query param）
  const handleSessionCreated = useCallback((sessionId: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("session", sessionId);
    router.replace(`?${next.toString()}`, { scroll: false });
  }, [router, searchParams]);

  // ql-20260623（改动一）：新建会话（重置回 idle）→ 清除 ?session= param
  const handleSessionReset = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("session");
    const qs = next.toString();
    const target = qs ? `?${qs}` : window.location.pathname;
    router.replace(target, { scroll: false });
  }, [router, searchParams]);

  return (
    <div className="flex h-full min-w-0 flex-col">
      {attachSession && onCloseAttach && (
        <div className="flex h-10 shrink-0 items-center justify-end border-b bg-muted/20 px-5">
          <Button
            size="sm"
            variant="ghost"
            onClick={onCloseAttach}
            className="h-7 text-xs"
          >
            返回历史
          </Button>
        </div>
      )}
      {/* key 强制 attach 切换时重 mount（清旧 SSE/轮询，task-10 unmount close）。
          外层 min-h-0 flex-1 overflow-hidden 容器为 panel 提供确定高度：
          弹窗 grid 行高已由 grid-rows-[minmax(0,1fr)] 约束，此处再保证 attach
          返回栏与 panel 在 flex-col 下正确分配，panel h-full 填满剩余空间，
          否则消息变多会撑破容器被上层 overflow-hidden 裁掉（底部输入框/最新消息看不到）。 */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <SessionPanel
          key={attachSession?.id ?? "live"}
          mode="dialog"
          sessionId={attachSession?.id ?? null}
          providers={providers}
          defaultProvider={defaultProvider}
          model={model}
          onModelChange={setModel}
          hasOnlineProvider={hasOnlineProvider}
          initialTurns={initialTurns}
          onSessionCreated={handleSessionCreated}
          onSessionReset={handleSessionReset}
        />
      </div>
    </div>
  );
}

// ── 会话列表 + 历史回看（task-12 / FR-10 / D-005@v1） ───────────────────────

export const ACTIVE_SESSION_VIEW_STATUSES: ReadonlySet<AgentSessionStatus> = new Set([
  "pending",
  "active",
  "reconnecting",
]);

export function isActiveSession(s: AgentSessionRead): boolean {
  return ACTIVE_SESSION_VIEW_STATUSES.has(s.status);
}

/**
 * task-11 / task-08 续聊可用性（D-004@v1 / D-007@v1）：
 * claude 或 codex + 有 agent_session_id + 终态（ended/failed）可恢复。
 * active 本就活跃（不显示按钮，走只读回看 ql-007）；
 * 无 agent_session_id（create 失败的 failed）无法恢复（D-007：缺 threadId 不得伪造恢复）。
 */
export function canResumeSession(session: AgentSessionRead | null): boolean {
  if (!session) return false;
  return (
    (session.provider === "claude" || session.provider === "codex") &&
    !!session.agent_session_id &&
    (session.status === "ended" || session.status === "failed")
  );
}

/** 续聊按钮不可用时的 title 提示文案。 */
export function resumeDisabledTitle(session: AgentSessionRead): string {
  if (session.provider !== "claude" && session.provider !== "codex") {
    return "当前会话不支持续聊";
  }
  if (!session.agent_session_id) return "会话未建立，无法续聊";
  return "当前会话不支持续聊";
}

/**
 * task-11 历史 turn 扩展形状：segments（结构化段时间线，FR-01）+ turnStartedAt
 * （计时锚点，design §7.5——attach 优先 run 快照 started_at，此处兜底组内首条 log
 * timestamp）。SessionTurnView 本体的这两个可选字段声明归 task-06（渲染层收编）；
 * 此处以交叉类型先行携带，结构类型兼容（HistoryAttachTurnView 可赋给 SessionTurnView，
 * 导出签名与既有产出字段零变化）。
 */
type HistoryAttachTurnView = SessionTurnView & {
  segments?: TurnSegment[];
  turnStartedAt?: number | null;
};

/** AgentRunLogEntry（历史 DTO）→ AssemblerLogInput（装配器归一形状，字段一一映射）。 */
function toAssemblerInput(entry: AgentRunLogEntry): AssemblerLogInput {
  return {
    logId: entry.id,
    channel: entry.channel,
    content: entry.content_redacted,
    timestamp: entry.timestamp,
    parentToolUseId: entry.parent_tool_use_id ?? null,
    subagentType: entry.subagent_type ?? null,
    depth: entry.depth ?? null,
    toolKind: entry.tool_kind ?? null,
    editPatch: entry.edit_patch ?? null,
  };
}

/** 计时锚点兜底：组内首条 log timestamp（ms）；缺失 / 非法 → null 容错。 */
function firstLogTimestampMs(entries: AgentRunLogEntry[]): number | null {
  const first = entries[0];
  if (!first?.timestamp) return null;
  const ms = Date.parse(first.timestamp);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * ql-20260822-010：run 快照终态 → 轮次 UI 终态修正（历史回看一致性）。
 * logsToTurns 对历史轮一律标 completed（历史 logs 无 SSE 终态事件），失败/中止
 * 轮的真实终态由消费方（session-panel displayTurns）按 run 快照回补。映射语义
 * 对齐实时路径 deriveTurnTerminalStatus + daemon.ts run.status 先例
 * （interrupted/cancelled → killed）。completed/pending/running 等正常状态返回
 * null（调用方不动原状态）。
 */
export function runTerminalTurnStatus(
  status: string | null,
): "failed" | "killed" | null {
  if (status === "failed") return "failed";
  if (status === "interrupted" || status === "cancelled") return "killed";
  return null;
}

/**
 * task-11 logsToTurns：把历史日志按 run_id 分组，转成 attach 面板预填的 SessionTurnView。
 *
 * 职责划分（design §7 Grill X-05 形状澄清）——turn 级胶水留本函数：run 分组
 * （turn.runId 用伪 id __attach_history_N__）、user_input 提取 prompt、realRunId、
 * status completed、token 置空；轮内装配改走共享装配器 logsToSegments（task-01，
 * FR-05）：AgentRunLogEntry 归一为 AssemblerLogInput 后逐组喂入（段不跨 run），
 * 连续 thinking 合并、tool_use 状态取 JSON success、tool_result 归属桶位置配对与
 * 孤儿 deny 判定均由装配器核心承担，本函数不再手写。
 *
 * 2026-07-11-unify-runtime-session-dialog / FR-04: 对每条 content_redacted 先经
 * classifySessionLog 过滤（与 sanitizeSessionLogContent 同源规则），
 * 剥离 SYSTEM/AskUserQuestion 等原始标记。
 *
 * 2026-07-11 task-12 去重：同内容（kind+文本为键）只保留一次，避免 attach 历史时
 * 后端 logs 含重复 user_input/agent log 致消息重复显示（防御性，覆盖 logs 内重复
 * 条目等多种根因）。该 seenText 内容级去重保留在喂入装配器**之前**过滤——与 SSE 的
 * log_id 去重（seenLogIds）两路语义不合并（design §9.4 / Grill X-08，装配器不去重）。
 *
 * 2026-08-03-session-stream-partial-revoke / FR-06 / D-003：本函数消费 AgentRunLogEntry
 * （GET /sessions/{id}/logs 返回），其 DTO 不含 segment_id（envelope 新字段仅实时 SSE 通道
 * 有）。历史数据本就干净——partial 已 DELETE（task-14）、override publish-only 不落库
 * （task-02），故历史回显不加撤回逻辑，渲染分支原样保留（design §2.4 / §3 非目标）。
 *
 * task-11 兼容投影（design §9.4）：turn.output / turn.processItems 由 segmentsToLegacy
 * 从段序列投影产出（output = 文本段按序拼接，reply delta 直接 concat；processItems =
 * 平铺投影，tool.startedAt→ts、thinking/stderr.ts→ts，AskUser 穿插排序依赖），与改前
 * 手写路径产出等价；segments / turnStartedAt 为本卡新增字段。
 */
export function logsToTurns(logs: AgentRunLogEntry[]): SessionTurnView[] {
  const map = new Map<string, AgentRunLogEntry[]>();
  for (const log of logs) {
    const list = map.get(log.run_id) ?? [];
    list.push(log);
    map.set(log.run_id, list);
  }
  const turns: HistoryAttachTurnView[] = [];
  let turnIndex = 0;
  for (const [runId, entries] of Array.from(map.entries())) {
    turnIndex += 1;
    // ql-20260825-002：prompt 收集从「逐条 push + 相同文本去重」改「二阶段归并」——
    // 先按「文本主体」（剥掉 [附件:...] 标记行）归一，同主体组内 marker 版优先
    // （含附件标记行的版本才能回显 chips）、无 marker 版取首条。修存量显示：daemon
    // 历史上双提交首句（backend 落 marker 版 + daemon 落裸文本版，同 run 同 turn
    // 两条 user_input），按组并合后只显示一条。用户真实连发多条不同消息：主体
    // 不同各自成组，全部保留。
    const promptGroups: Array<{
      key: string;
      withMarker: string | null;
      plain: string | null;
    }> = [];
    const promptGroupIndex = new Map<string, number>();
    // 2026-08-25-unified-floating-session task-11（FR-7）：daemon 回传首条
    // user_input 的前导块（dispatch_prompt 注入段）提取为 preamble 段（对话
    // 视图不渲染，「全部」视图显示注入来源）。
    const preambleSegments: TurnSegment[] = [];
    const seenText = new Set<string>();
    const assemblerInputs: AssemblerLogInput[] = [];
    for (const entry of entries) {
      const seg = classifySessionLog(entry.content_redacted ?? "", entry.channel);
      if (!seg) continue;
      // ql-20260822-010：内容级去重收窄到 user_input / reply——原 kind:text 一刀切
      // 会误删同轮内合法的重复内容（两次相同工具输出/重复思考段），而实时 SSE
      // 路径只按 log_id 去重不丢这些内容，形成「聊天时可见、刷新后消失」的不一致。
      // 防御目的（task-12：后端重复广播 user_input/agent log）由收窄后的两类覆盖；
      // tool/thinking/stderr 的条目唯一性由 log id 保证，不做内容级去重。
      const dedupable = entry.channel === "user_input" || seg.kind === "reply";
      if (dedupable) {
        const dedupKey = `${seg.kind}:${seg.text}`;
        if (seenText.has(dedupKey)) continue;
        seenText.add(dedupKey);
      }
      // user_input 是用户消息（prompt）——turn 级胶水，不装配进段（Grill X-05）。
      if (entry.channel === "user_input") {
        // 2026-08-25-unified-floating-session task-11（FR-7）：daemon 回传的首条
        // user_input 含完整 dispatch_prompt——提取前导块为 preamble 段（对话视图
        // 不渲染，「全部」视图显示注入来源）；其余照原逻辑收 prompt。
        const preambleText = extractPreambleText(seg.text);
        if (preambleText) {
          preambleSegments.push({
            kind: "preamble",
            id: `preamble:${entry.id ?? `idx${turnIndex}`}`,
            text: preambleText,
            ts: entry.timestamp ? Date.parse(entry.timestamp) : null,
          });
        }
        // ql-20260825-011：prompt 气泡剥掉前导块——上下文注入只在「进度」视图的
        // preamble 段（默认收起）展示，对话视图不重复显示前导全文。
        // 用户反馈⑥修正：含前导的全文条剥完与干净条文本相同，两者都 push 会让
        // prompt 气泡显示两次同一问题——前导条只产 preamble 段，prompt 一律由
        // 干净条承载（backend 恒写干净 user_input，见 create/inject 路径）。
        if (preambleText) {
          continue;
        }
        // ql-20260825-002：剥标记行得文本主体为归一键（附件行不影响主体判定）。
        const lines = seg.text.split("\n");
        const markerLines: string[] = [];
        let bodyStart = 0;
        const MARKER_RE = /^\[附件:[0-9a-fA-F-]{36}\|/;
        while (bodyStart < lines.length && MARKER_RE.test(lines[bodyStart] ?? "")) {
          markerLines.push(lines[bodyStart] ?? "");
          bodyStart += 1;
        }
        const body = lines.slice(bodyStart).join("\n").trim();
        const key = body; // 空主体（纯附件）也按空串归一——纯附件双提交同组
        const gi = promptGroupIndex.get(key);
        if (gi === undefined) {
          promptGroupIndex.set(key, promptGroups.length);
          promptGroups.push({
            key,
            withMarker: markerLines.length > 0 ? seg.text : null,
            plain: markerLines.length > 0 ? null : seg.text,
          });
        } else {
          const group = promptGroups[gi];
          if (group && markerLines.length > 0 && group.withMarker === null) {
            // 同主体组内后到的 marker 版替换位置（marker 版优先保留）。
            group.withMarker = seg.text;
          }
        }
        continue;
      }
      assemblerInputs.push(toAssemblerInput(entry));
    }
    const prompts = promptGroups.map((g) => g.withMarker ?? g.plain ?? "");
    // task-11：按 run 分组后逐组喂入共享装配器（段不跨 run）。
    // ql-20260822-010：seenTextDedup: false——内容级去重收敛到上方预过滤
    // （user_input / reply 防御性去重）单层。装配器默认开启的第二层 kind:text
    // 去重会误删同轮内合法的重复内容（两次相同工具输出等），而实时 SSE 路径
    // 只按 log_id 去重，形成「聊天时可见、刷新后消失」的路径不一致。
    const segments = logsToSegments(assemblerInputs, { seenTextDedup: false });
    // task-11（FR-7）：前导段并入段序列首部（ts 排序在渲染层完成，此处按捕获序）。
    // 兼容投影（§9.4）：output / processItems 形状与改前手写路径等价。
    const legacy = segmentsToLegacy(segments);
    turns.push({
      runId: `__attach_history_${turnIndex}__`,
      // ql-20260802-001：保留真实 run_id 供 AskUser 提问历史穿插到对应 turn（跟会话顺序）
      realRunId: runId,
      turn: turnIndex,
      prompt: prompts.join("\n"),
      // ql-20260730-004：reply 流式 delta 直接 concat（投影按序拼接，语义同前）。
      output: legacy.output,
      status: "completed",
      seenLogIds: new Set(entries.map((e) => e.id)),
      processItems: legacy.processItems,
      segments: [...preambleSegments, ...segments],
      turnStartedAt: firstLogTimestampMs(entries),
      // ql-20260621：历史回看无实时 token（logs 接口不含 token），置 null。
      // 若后续 logs 接口补 token 字段可在此填充。
      inputTokens: null,
      outputTokens: null,
    });
  }
  return turns;
}

/**
 * 只读历史回看：跨 AgentRun 的日志按 run_id 分组渲染（D-005@v1）。
 * 不渲染发送 / interrupt / end 控件（只读）。
 */
export function SessionHistoryView({
  session,
  logs,
  loading,
  error,
  onClose,
  onContinue,
}: {
  session: AgentSessionRead | null;
  logs: AgentRunLogEntry[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onContinue?: (_session: AgentSessionRead) => void;
}) {
  // 跨 run 分组（保持后端返回顺序：run 顺序内 timestamp 升序）
  const groups = useMemo(() => {
    const map = new Map<string, AgentRunLogEntry[]>();
    for (const log of logs) {
      const list = map.get(log.run_id) ?? [];
      list.push(log);
      map.set(log.run_id, list);
    }
    return Array.from(map.entries());
  }, [logs]);

  // task-11 D-004：active 不显示续聊按钮（本就活跃走只读回看 ql-007）；
  // 其余状态显示按钮，canResume 决定是否可点。
  const showResumeBtn = session != null && session.status !== "active";
  const resumeEnabled = canResumeSession(session);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-card">
      <header className="flex items-center justify-between gap-3 border-b bg-muted/20 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">
            历史回看{session ? ` · ${shortId(session.id)}` : ""}
          </h2>
          <p className="text-[11px] text-muted-foreground">
            只读视图（{groups.length} 个 turn）
          </p>
        </div>
        <div className="flex items-center gap-2">
          {showResumeBtn && session && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-[11px]"
              disabled={!resumeEnabled || !onContinue}
              title={resumeEnabled ? "恢复会话并续聊" : resumeDisabledTitle(session)}
              onClick={() => {
                if (resumeEnabled && onContinue && session) onContinue(session);
              }}
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
              继续对话
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose} className="h-7 text-[11px]">
            关闭
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto bg-background px-5 py-5">
        {loading ? (
          <p className="text-center text-[11px] text-muted-foreground">加载历史日志…</p>
        ) : error ? (
          <p className="text-center text-[11px] text-destructive">{error}</p>
        ) : groups.length === 0 ? (
          <p className="py-8 text-center text-[11px] text-muted-foreground">暂无历史日志</p>
        ) : (
          <div className="space-y-4">
            {groups.map(([runId, entries]) => (
              <div key={runId} className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                  <span className="font-mono">run {shortId(runId)}</span>
                </div>
                {entries.map((log) => {
                  // task-02 / FR-1：按 channel 区分 user / agent 气泡。
                  // channel === "user_input" → 右对齐 primary 气泡；其余（含缺失）→ 左对齐白底。
                  const isUser = log.channel === "user_input";
                  return (
                    <div
                      key={log.id}
                      className={isUser ? "flex justify-end" : "flex justify-start"}
                    >
                      <div
                        className={
                          isUser
                            ? "max-w-[86%] whitespace-pre-wrap break-words rounded-md bg-primary px-3 py-2 text-xs leading-relaxed text-primary-foreground shadow-sm"
                            : "max-w-[86%] rounded-md border bg-card px-3 py-2 text-xs leading-relaxed text-foreground shadow-sm"
                        }
                      >
                        {isUser ? (
                          log.content_redacted ?? ""
                        ) : (
                          <MarkdownText content={log.content_redacted ?? ""} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ── 2026-08-20-session-multimodal-attachments task-13（D-3）：附件标记行解析 ──

/** 附件标记行解析产物：附件清单 + 剥离标记后的纯文本。 */
export interface ParsedAttachmentMarker {
  id: string;
  kind: "image" | "file";
  name: string;
}

/**
 * 解析 prompt 头部的附件标记行（backend inject 写入，D-3）：
 * `[附件:<uuid>|<kind>|<name>]` 逐行一条；UUID 锚定（防用户伪标记文本误报）。
 * 解析失败的行按原文本保留（容错）；标记行后的正文原样返回。
 */
export function parseAttachmentMarkers(prompt: string): {
  attachments: ParsedAttachmentMarker[];
  text: string;
} {
  const uuidRe =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  const markerRe =
    /^\[附件:([0-9a-fA-F-]{36})\|(image|file)\|(.+)\]$/;
  const attachments: ParsedAttachmentMarker[] = [];
  const lines = prompt.split("\n");
  let i = 0;
  while (i < lines.length) {
    const m = markerRe.exec(lines[i]!.trim());
    if (!m || !uuidRe.test(m[1]!)) break;
    attachments.push({
      id: m[1]!,
      kind: m[2] as "image" | "file",
      name: m[3]!,
    });
    i += 1;
  }
  if (i === 0) return { attachments, text: prompt };
  // 标记行后的空行（backend 以 \n 接正文）剥一层。
  const rest = lines.slice(i).join("\n").replace(/^\n/, "");
  return { attachments, text: rest };
}

/**
 * 拼接附件标记行与正文（parseAttachmentMarkers 的逆操作，语义对齐 backend
 * inject 落库口径：仅附件存在时才写 `标记行\n正文`，无附件 = 原文）。
 * ql-20260824-004：旧拼接 `${markerLines}\n${prompt}` 在无附件（markerLines 空串）
 * 时产出前导换行 `\n正文`，气泡 whitespace-pre-wrap 渲染出用户文字上方空行。
 */
export function joinAttachmentMarkers(markerLines: string, prompt: string): string {
  if (!markerLines) return prompt;
  return prompt ? `${markerLines}\n${prompt}` : markerLines;
}

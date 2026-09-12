
/**
 * 会话面板共享模块级状态机与纯 helper（自 session-panel.tsx 拆出，task-14 /
 * 2026-09-07-arch-large-file-split design §5 Wave 3，原样搬移零行为变化）：
 * 共享输入常量与 mention 组装、turn 状态机（upsertTurn / 装配胶水）、视图模式与
 * 草稿 localStorage、bash 进度归约（BashProgressState / applyBashStatusEvent /
 * appendBashChunk）。page / dialog 两模式共用。
 */

import {
  applyLogToSegments, createEmptyAssembledTurn, transferAssemblerInternals, type AssembledTurn,
  type AssemblerLogInput, type TurnSegment,
} from "@/components/daemon/session-log-assembler";
import { type SessionTurnView, type TurnUiStatus } from "@/components/daemon/turn-timeline";
import { type SessionInputMentions } from "@/components/daemon/session-input-bar";
import { type BashChunkItem } from "@/components/daemon/bash-progress-card";
import { type BashStatusEvent } from "@/lib/daemon";
import { type SessionStreamEnvelope, type PpmItemKind } from "@/lib/daemon";


export const MAX_PROMPT_LEN = 8000;

/* ── task-05（2026-08-26-session-input-mention）：@ 联想接线共享常量与组装 ──── */

/**
 * FR-08：输入框联想能力提示——追加在三个渲染点「可正常输入」态 placeholder
 * 尾部（与 Enter/Shift+Enter 按键提示同括号同「 · 」分隔）；禁用/排队/恢复等
 * 状态文案不追加（彼时提示语义已让位于状态说明）。
 */
export const MENTION_PLACEHOLDER_HINT = "/ 唤起技能 · @ 关联变更";

/**
 * task-05（FR-06 / D-003）：@ 联想选中 → inject 绑定字段条件展开（有值才带，
 * 缺省展开为空对象不进请求体，保后端零行为差异；bind_change_key = 变更自然键、
 * bind_quick_id = 快速修复短码，后端 binder 幂等写 M:N link，不注入 prompt）。
 * page 与 dialog 的全部四个 inject 发送点位共用本组装。
 * task-06（2026-08-28-session-ppm-task-binding / FR-02）：扩展
 * bind_ppm_item_kind/bind_ppm_item_id 成对追问绑定（对齐 bind_change_key 模式；
 * 后端 binder 幂等写 ppm_item_session_links，只追加 link 不注入前导——对齐
 * quicklog 行为，重复选择追问绑定幂等）。
 */
export function mentionBindOptions(m: SessionInputMentions): {
  bind_change_key?: string;
  bind_quick_id?: string;
  bind_ppm_item_kind?: PpmItemKind;
  bind_ppm_item_id?: string;
} {
  return {
    ...(m.change ? { bind_change_key: m.change.change_key } : {}),
    ...(m.quick ? { bind_quick_id: m.quick.ql_id } : {}),
    ...(m.ppmItem
      ? {
          bind_ppm_item_kind: m.ppmItem.kind,
          bind_ppm_item_id: m.ppmItem.id,
        }
      : {}),
  };
}

/**
 * task-10（2026-08-29-daemon-platform-resilience / design A5+A6）：suspended
 * 挂起期间会话详情轮询间隔。挂起窗口以小时计（24h GC 上限），复用 pending/
 * reconnecting 的 1.5s 高频轮询浪费；daemon 重启 recover（suspended →
 * reconnecting → active，D-001 自动恢复）的翻转靠该轮询驱动——SSE 只推
 * 轮次事件，会话级状态变化无推送。15s 兼顾翻转及时性与请求量。
 */
export const SUSPENDED_SESSION_REFETCH_MS = 15_000;

/** turn 状态（currentRunId 只指向 pending/running/interrupting turn）。 */
export interface TurnState {
  turns: SessionTurnView[];
  currentRunId: string | null;
}

export const INITIAL_TURN_STATE: TurnState = { turns: [], currentRunId: null };

/**
 * 群聊体验 quick（2026-09-02）：初始历史窗口条数（logs 端点 limit=最新 N 条
 * 升序）。「加载更早消息」按钮同页距翻页（before 游标）。满页即视为可能还有
 * 更早（< 页距 = 已到头，按钮隐藏）。
 */
export const HISTORY_PAGE_SIZE = 100;

/* ────────────────────── SSE turn 状态机辅助（task-09：只留组装胶水，日志内容处理走装配器；两模式共用，diff-analysis §4.3 归属〔内部〕模块级函数） ────────────────────── */

export const TERMINAL_TURN_STATUSES: ReadonlySet<TurnUiStatus> = new Set([
  "completed",
  "failed",
  "killed",
]);

export interface UpsertOpts {
  setCurrentRun?: string;
  clearCurrentRun?: string;
}

/**
 * 按 env.run_id upsert turn；unknown run id 先建无 prompt turn。
 * 终态幂等：已终态的 turn 不被后续事件覆盖（log 事件例外——turn_completed 可能
 * 先于 log 到达，output 尚未追加）。
 */
export function upsertTurn(
  prev: TurnState,
  env: SessionStreamEnvelope,
  apply: (_turn: SessionTurnView) => SessionTurnView,
  opts: UpsertOpts,
): TurnState {
  const runId = env.run_id;
  if (!runId) return prev;
  // ql-20260817-007：attach 历史 turn 的 key 是伪 id（__attach_history_N__），
  // 真实 id 在 realRunId——SSE 事件按两者匹配，命中即合并到既有 turn，
  // 否则同一 run 会渲染出第二个「正在思考…」空块（新建会话输入后复现）。
  // ql-20260903-002：realRunId 匹配须取**最末**块——「加载更早」prepend 的同
  // run 更早段（#e 游标变体，realRunId 同值）排在数组头部，findIndex 首中会
  // 把实时流式输出写进历史块（healToRunning 还会把已完成的更早块翻回
  // running），当前尾部块停滞。精确 runId 命中优先（实时新建 turn），否则从
  // 尾部反向找 realRunId——时间序上该 run 的最新块才是流式输出的归属。
  let idx = prev.turns.findIndex((t) => t.runId === runId);
  if (idx === -1) {
    for (let i = prev.turns.length - 1; i >= 0; i -= 1) {
      const candidate = prev.turns[i];
      if (candidate?.realRunId === runId) {
        idx = i;
        break;
      }
    }
  }
  let turns: SessionTurnView[];
  if (idx === -1) {
    // task-09：新建 turn 用装配器空产物初始化（segments/output/processItems/
    // seenLogIds 同源一致）；turnStartedAt 起始 null，由首条 log timestamp 兜底
    // 写入、displayTurns 再按 run 快照 started_at 补（attach 恢复锚点）。
    const empty = createEmptyAssembledTurn();
    const newTurn: SessionTurnView = {
      runId,
      turn: env.turn ?? null,
      prompt: "",
      output: empty.output,
      status: "running",
      seenLogIds: empty.seenLogIds,
      inputTokens: env.input_tokens ?? null,
      outputTokens: env.output_tokens ?? null,
      // task-08（FR-01）：unknown run 首建 turn 同步携带 ctx（tokens 事件到达
      // 早于 turn_started 时 upsert 走此分支）；null = 未知。
      ctxTokens: env.ctx_tokens ?? null,
      errorDetail: null,
      processItems: empty.processItems,
      segments: empty.segments,
      turnStartedAt: empty.turnStartedAt,
    };
    turns = [...prev.turns, apply(newTurn)];
  } else {
    // attach 竞态修复（ql-20260820-007）防御分支：主修正位于历史回灌处；若某条
    // 路径仍漏改（当前 run 的日志持续流入而轮卡终态），log 分支自愈翻回 running。
    // 真正完成的 run 其 currentRunId 已被 onTurnCompleted 清空，不会误翻。
    const healToRunning = env.event === "log" && prev.currentRunId === runId;
    turns = prev.turns.map((t, i) => {
      if (i !== idx) return t;
      if (env.event !== "log" && TERMINAL_TURN_STATUSES.has(t.status)) return t;
      const next = apply(t);
      if (healToRunning && TERMINAL_TURN_STATUSES.has(next.status)) {
        return { ...next, status: "running" };
      }
      return next;
    });
  }
  let currentRunId = prev.currentRunId;
  if (opts.setCurrentRun) currentRunId = opts.setCurrentRun;
  if (opts.clearCurrentRun && currentRunId === opts.clearCurrentRun) {
    currentRunId = null;
  }
  return { turns, currentRunId };
}

/**
 * task-09（FR-05）：SessionTurnView → AssembledTurn 收窄视图（组装胶水）。
 * SessionTurnView 的段模型字段可选（task-06 过渡期双路径），装配器要求全量形状
 * ——缺失按空值兜底；装配产物字段与 SessionTurnView 同名，调用方经
 * `{ ...turn, ...next }` 回填（其余 turn 级字段不动）。
 */
export function asAssembled(turn: SessionTurnView): AssembledTurn {
  const view: AssembledTurn = {
    segments: turn.segments ?? [],
    output: turn.output,
    processItems: turn.processItems ?? [],
    turnStartedAt: turn.turnStartedAt ?? null,
    seenLogIds: turn.seenLogIds,
  };
  // F7：同 assembledViewOf——转移增量内部状态，segments 有值时同源同引用。
  transferAssemblerInternals(view, turn as AssembledTurn);
  return view;
}

/**
 * task-09（FR-05）：单条 SSE log envelope 归一为 AssemblerLogInput 喂共享装配器
 * applyLogToSegments（替代原 applyLogToTurn 副本——分类 / override 撤回 / tool
 * 配对 / 子代理归属一律依赖装配器导出，本文件不重写；partial 段起点 Map 随副本
 * 一并删除，装配器按段 id 前缀路由撤回）。产出段序列 + 兼容投影（output /
 * processItems）+ 计时锚点兜底（首条 log timestamp）+ log_id 去重集合。
 */
export function applyEnvelopeToTurn(
  turn: SessionTurnView,
  env: SessionStreamEnvelope,
): SessionTurnView {
  const input: AssemblerLogInput = {
    logId: env.log_id,
    channel: env.channel,
    content: env.content,
    timestamp: env.timestamp,
    segmentId: env.segment_id ?? null,
    stale: env.stale ?? null,
    parentToolUseId: env.parent_tool_use_id ?? null,
    subagentType: env.subagent_type ?? null,
    depth: env.depth ?? null,
    toolKind: env.tool_kind ?? null,
    editPatch: env.edit_patch ?? null,
  };
  return { ...turn, ...applyLogToSegments(asAssembled(turn), input) };
}

/** run 快照 started_at（ISO）→ ms；缺失 / 非法 → null（displayTurns 计时锚点 ?? 链次优源）。 */
export function parseRunStartedAt(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** DFS 全 turn 段树找 id 匹配段（子代理目录跳转的名称定位用，嵌套 children 递归）。 */
export function findSegmentById(
  segments: TurnSegment[] | undefined,
  id: string,
): TurnSegment | null {
  if (!segments) return null;
  for (const s of segments) {
    if (s.id === id) return s;
    if (s.kind === "tool" || s.kind === "subagent_stub") {
      const inner = findSegmentById(s.children, id);
      if (inner) return inner;
    }
  }
  return null;
}

/**
 * 子代理块头部展示名（DOM 名称匹配用）——规则镜像 turn-segment-views
 * SubagentBlockView：tool 段 primary ?? subagentType ?? 「子代理」；stub 段
 * subagentType ?? 「子代理」（stub 无 primary）。
 */
export function subagentBlockNameOf(seg: TurnSegment): string | null {
  if (seg.kind === "tool") {
    return seg.primary?.trim() || seg.subagentType || "子代理";
  }
  if (seg.kind === "subagent_stub") {
    return seg.subagentType || "子代理";
  }
  return null;
}

/** turn_completed 的 status/exit_code → TurnUiStatus 终态。 */
export function deriveTurnTerminalStatus(env: SessionStreamEnvelope): TurnUiStatus {
  const status = env.status;
  if (status === "failed") return "failed";
  if (status === "killed" || status === "cancelled") return "killed";
  if (env.exit_code !== null && env.exit_code !== 0 && env.status === null) {
    return env.exit_code === 130 || env.exit_code === 143 ? "killed" : "failed";
  }
  return "completed";
}

/* ── ql-20260822-010：会话视图模式（对话/进度）按会话持久化 ──────────────── */

/** localStorage key（先例 NEW_SESSION_MACHINE_LS_KEY 同 sillyhub.sessions 前缀）。 */
function viewModeLsKey(sessionId: string): string {
  return `sillyhub.sessions.viewMode.${sessionId}`;
}

/** 挂载回读：仅识别 "all"，其余/缺失/SSR 无 window 一律默认 "conversation"。 */
export function readPersistedViewMode(sessionId: string): "conversation" | "all" {
  if (typeof window === "undefined") return "conversation";
  try {
    return window.localStorage.getItem(viewModeLsKey(sessionId)) === "all"
      ? "all"
      : "conversation";
  } catch {
    return "conversation";
  }
}

/** 切换时写入（隐私模式等写入失败静默，不阻断切换本身）。 */
export function writePersistedViewMode(
  sessionId: string,
  m: "conversation" | "all",
): void {
  try {
    window.localStorage.setItem(viewModeLsKey(sessionId), m);
  } catch {
    /* 静默容错 */
  }
}

/* ── ql-20260825-011：输入框草稿按会话持久化（刷新/切换会话不丢）────────── */
/* task-01（2026-09-13-session-group-ux-fixes / FR-1 / D-001）：预会话草稿键按
 * 入口隔离——原固定 __pre__ 键跨工作区/跨机器入口共享，任一入口未发送内容必然
 * 带入下一入口（用户实测串台根因）。分支规则：真会话（sessionId 非空）键照旧
 * 按 sessionId 组装（preScope 被忽略，真会话隔离零回归）；预会话且有入口标识串
 * preScope（page 形如 "<workspaceId|'-'>:<runtimeId>"，dialog 无 runtime 维度
 * 只传 "<workspaceId|'-'>"）→ __pre__:<preScope>；均无回落共享键 __pre__
 * （未传 preScope 的旧调用点行为兼容；不做旧键迁移——项目未上线，非目标）。 */

/** 预会话态（无 sessionId）的草稿键前缀（亦即无 preScope 时的共享回落键）。 */
const SESSION_DRAFT_PRE_KEY = "__pre__";

function sessionDraftLsKey(sessionId: string | null, preScope?: string | null): string {
  const key =
    sessionId ?? (preScope ? `${SESSION_DRAFT_PRE_KEY}:${preScope}` : SESSION_DRAFT_PRE_KEY);
  return `sillyhub.sessions.draft.${key}`;
}

/** 挂载/切换会话回读草稿（SSR 或读取失败返回空串；preScope 仅预会话态参与键组装）。 */
export function readSessionDraft(sessionId: string | null, preScope?: string | null): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(sessionDraftLsKey(sessionId, preScope)) ?? "";
  } catch {
    return "";
  }
}

/** 每次输入变化写入（隐私模式等写入失败静默；preScope 仅预会话态参与键组装）。 */
export function writeSessionDraft(
  sessionId: string | null,
  draft: string,
  preScope?: string | null,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(sessionDraftLsKey(sessionId, preScope), draft);
  } catch {
    /* 静默容错 */
  }
}

/* ── bash 进度卡片状态归约（page / dialog 两模式共用，2026-08-25 修复）────── */

/** BashProgressCard 聚合状态（bash_status + bash_chunk 事件归约产物）。 */
export interface BashProgressState {
  runId: string;
  command: string;
  status: "running" | "completed" | "failed";
  exitCode?: number | null;
  elapsedMs?: number | null;
  chunks: BashChunkItem[];
}

/** chunks 环形截断上限：条数（后端 100ms/8KB 节流下 600 条已覆盖长跑输出窗口）。 */
const BASH_CHUNKS_MAX_COUNT = 600;
/** chunks 环形截断上限：累计 content 字节（约 256KB，防数 MB 输出常驻内存）。 */
const BASH_CHUNKS_MAX_BYTES = 256 * 1024;

/** chunk content 的 UTF-8 字节长度近似（BMP 内 1~3 字节/字符，与 TextEncoder 一致）。 */
function bashChunkBytes(content: string): number {
  let bytes = 0;
  for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i);
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : 3;
  }
  return bytes;
}

/**
 * bash_status 归约：按「新命令开始」判定是否重置 chunks。
 *
 * P1 修复：同一 run 内第二条 bash 命令（runId 不变、command 变化）不能沿用上一
 * 条的输出 chunks——含 is_final 的旧 chunk 会让新命令 spinner 被提前终止
 * （bash-progress-card 的 isRunning = status==="running" && 无 is_final chunk）、
 * 输出拼接错乱。新命令判定 = runId / command 任一变化，或同命令 status 从终态
 * 翻回 running（重跑兜底）。
 */
export function applyBashStatusEvent(
  prev: BashProgressState | null,
  event: Pick<
    BashStatusEvent,
    "run_id" | "command" | "status" | "exit_code" | "elapsed_ms"
  >,
): BashProgressState {
  const isNewCommand =
    !prev ||
    prev.runId !== event.run_id ||
    prev.command !== event.command ||
    (prev.status !== "running" && event.status === "running");
  return {
    runId: event.run_id,
    command: event.command,
    status: event.status,
    exitCode: event.exit_code,
    elapsedMs: event.elapsed_ms,
    chunks: isNewCommand ? [] : prev.chunks,
  };
}

/**
 * bash_chunk 归约：追加输出片段 + 环形截断。
 *
 * P1 修复：裸 `[...prev.chunks, chunk]` 无上限，长跑命令可数 MB 常驻内存且每次
 * 触发全量重拼。截断策略：超条数上限先裁尾保最近 N 条；再超字节预算从头部丢弃
 * 整条 chunk（保底留最后一条，防全空）。is_final 语义：最后一条 is_final 不丢
 * （卡片靠它提前停 spinner；权威收敛仍由 bash_status 终态事件兜底）。
 */
export function appendBashChunk(
  prev: BashProgressState,
  chunk: BashChunkItem,
): BashProgressState {
  let chunks = [...prev.chunks, chunk];
  if (chunks.length > BASH_CHUNKS_MAX_COUNT) {
    chunks = chunks.slice(chunks.length - BASH_CHUNKS_MAX_COUNT);
  }
  let bytes = 0;
  for (const c of chunks) bytes += bashChunkBytes(c.content);
  let start = 0;
  while (chunks.length - start > 1 && bytes > BASH_CHUNKS_MAX_BYTES) {
    const head = chunks[start]!;
    // 保最后一条 is_final：丢弃它会破坏「is_final 到达停 spinner」语义。
    if (head.is_final && !chunks.slice(start + 1).some((c) => c.is_final)) break;
    bytes -= bashChunkBytes(head.content);
    start += 1;
  }
  return start > 0 ? { ...prev, chunks: chunks.slice(start) } : { ...prev, chunks };
}


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
import {
  type SessionTurnView,
  type SessionViewMode,
  type TurnUiStatus,
} from "@/components/daemon/turn-timeline";
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
 * 当前阶段（2026-10-26-session-stage-progress FR-04 / D-013①③）。
 * phase 为 turn_phase 事件词表值（词表外值透传原始字符串，兜底展示由
 * TurnStatusBar PHASE_LABEL 缺省分支承接）；at = 客户端本地到达时刻
 * Date.now()（事件到达时刻，规避服务端/客户端时钟偏移，D-013①）。
 * task-04 的 currentPhase prop 与本类型同构。
 */
export interface TurnPhaseState {
  phase: string;
  at: number;
}

/**
 * 轮内实时心跳（2026-10-29-engine-live-perception FR-03 / D-001@v1）。
 * kind 两值（awaiting_first_token 等待首包 / generating 正在生成工具参数等
 * 不可见内容）；est_* 为估算（precision=estimated，标「约」展示）或引擎权威
 * 值（authoritative）；at = 客户端本地到达时刻（**不进** lastEventAt——其语义
 * 为最后真实内容事件，心跳不刷新）。瞬态信号：消费侧 5s 无新心跳视为过期
 * 回落等待态（渲染层判定，不改性态存储）。
 */
export interface TurnHeartbeatState {
  kind: "awaiting_first_token" | "generating";
  est_chars: number | null;
  est_tokens: number | null;
  precision: "estimated" | "authoritative";
  source: string;
  at: number;
}

/**
 * turn_heartbeat 事件 → 轮状态 heartbeat 写入（2026-10-29-engine-live-perception
 * FR-03，applyTurnPhase 同款路由形态）：按 runId 归属（含 realRunId 匹配），
 * 未命中回退 currentRunId 活跃轮（同 FR-01 竞态回退语义），再未命中丢弃不建轮。
 *
 * 选主策略（Grill P1-b 修正 / design Phase C）：仅 main 心跳（parent_tool_use_id
 * 空/缺省）入主轮状态——子代理心跳（非空）不入，主会话跑马灯不被子代理并发
 * 心跳抖动（子代理卡片心跳为后续增强面，本期不渲染不算错）。
 * 载荷守卫：kind/precision 非法值静默忽略（不伪造）；est_* 非有限数值归 null。
 */
export function applyTurnHeartbeat(
  turns: SessionTurnView[],
  runId: string | null | undefined,
  hb: {
    kind?: string | null;
    est_chars?: number | null;
    est_tokens?: number | null;
    precision?: string | null;
    source?: string | null;
    parent_tool_use_id?: string | null;
  },
  currentRunId?: string | null,
): SessionTurnView[] {
  if (!runId) return turns;
  // 选主：子代理心跳不入主轮状态（P1-b）。
  if (typeof hb.parent_tool_use_id === "string" && hb.parent_tool_use_id) {
    return turns;
  }
  // 载荷守卫：kind/precision 非法不伪造（stream 层已拦缺 run_id，此处拦畸形值）。
  if (hb.kind !== "awaiting_first_token" && hb.kind !== "generating") return turns;
  if (hb.precision !== "estimated" && hb.precision !== "authoritative") return turns;
  const state: TurnHeartbeatState = {
    kind: hb.kind,
    est_chars:
      typeof hb.est_chars === "number" && Number.isFinite(hb.est_chars)
        ? hb.est_chars
        : null,
    est_tokens:
      typeof hb.est_tokens === "number" && Number.isFinite(hb.est_tokens)
        ? hb.est_tokens
        : null,
    precision: hb.precision,
    source: hb.source ?? "",
    at: Date.now(),
  };
  const write = (t: SessionTurnView): SessionTurnView => ({ ...t, heartbeat: state });
  let hit = false;
  const next = turns.map((t) => {
    if (t.runId === runId || t.realRunId === runId) {
      hit = true;
      return write(t);
    }
    return t;
  });
  if (hit) return next;
  if (currentRunId) {
    let fallbackHit = false;
    const fallback = turns.map((t) => {
      if (t.runId === currentRunId) {
        fallbackHit = true;
        return write(t);
      }
      return t;
    });
    if (fallbackHit) return fallback;
  }
  return turns;
}

/**
 * 阶段词表序（2026-10-27-turn-phase-observability-monotonic）：九值推进链定序，
 * 词表外值不参与（透传兼容策略不变）。投递段（dispatched/delivered）＜ 执行段
 * （skills_sync…ready）＜ 送达/首响段（inject_received/first_event）。
 */
const PHASE_ORDER: Readonly<Record<string, number>> = {
  dispatched: 0,
  delivered: 1,
  skills_sync: 2,
  spec_sync: 3,
  mcp_prefetch: 4,
  spawning: 5,
  ready: 6,
  inject_received: 7,
  first_event: 8,
};

/**
 * 单调写入判定（FR-02）：新 phase 与现值均在词表内且新序 < 现序 → 回退写，
 * 丢弃。任一词表外 → 维持 last-write-wins 透传（兼容策略零回归）。
 */
function isPhaseRegression(current: string | undefined | null, next: string): boolean {
  if (current == null) return false;
  const cur = PHASE_ORDER[current];
  const nxt = PHASE_ORDER[next];
  return cur !== undefined && nxt !== undefined && nxt < cur;
}

/**
 * turn_phase 事件 → 轮状态 currentPhase 写入（last-write-wins，乱序到达按事件
 * 序覆盖）；按 runId 归属路由（含 realRunId 匹配），未命中既有轮时**不建轮**
 * （phase 不是轮存在性信号——轮由 turn_started/log 创建）。
 *
 * 2026-10-26-turn-phase-orphan-fallback FR-01/02/04：未命中时不再静默丢弃——
 * 若 currentRunId 指向活跃轮（发送后 HTTP 响应未回、占位轮尚未换真实 run_id
 * 的竞态窗口——事件跑赢响应被丢弃 = 生产实证卡「执行器已接收」超时的根因），
 * 回退写入该活跃轮；无活跃轮回退不命中时维持原丢弃（断线重连迟到事件，防
 * 幽灵轮原语义不变）。回退只认 currentRunId（单会话单活跃 run 不变式，
 * decisions D-001 反例排查：子代理/团队/steering/排队均不构成多活跃轮），不
 * 做模糊匹配。replacePlaceholderTurn 以对象展开保留 currentPhase（FR-03）。
 * 返回新数组（不可变更新）；无 runId / 全程未命中原样返回。
 *
 * 2026-10-27-turn-phase-observability-monotonic FR-02：写入加词表序单调守卫——
 * 回退写（如 steering 忙轮注入的 dispatched/delivered 回执覆盖已 first_event/
 * 执行段的轮）静默丢弃，防显示从「执行中」退化回投递段卡住（first_event 每
 * run 防重不会重发，退化后无自愈信号）；正常推进/前跳/词表外值不受影响。
 */
export function applyTurnPhase(
  turns: SessionTurnView[],
  runId: string | null | undefined,
  phase: string,
  currentRunId?: string | null,
): SessionTurnView[] {
  if (!runId) return turns;
  const at = Date.now();
  let hit = false;
  const next = turns.map((t) => {
    if (t.runId === runId || t.realRunId === runId) {
      hit = true;
      if (isPhaseRegression(t.currentPhase?.phase, phase)) return t;
      return { ...t, currentPhase: { phase, at } };
    }
    return t;
  });
  if (hit) return next;
  // FR-01 竞态回退：事件带真实 run_id 先于占位轮替换到达 → 写当前活跃轮。
  // FR-04：排队轮不在 currentRunId 指向内（它尚未建轮），天然不接回退事件。
  if (currentRunId) {
    let fallbackHit = false;
    const fallback = turns.map((t) => {
      if (t.runId === currentRunId) {
        fallbackHit = true;
        if (isPhaseRegression(t.currentPhase?.phase, phase)) return t;
        return { ...t, currentPhase: { phase, at } };
      }
      return t;
    });
    if (fallbackHit) return fallback;
  }
  // FR-02：无活跃轮（断线重连迟到事件等）维持丢弃，不建幽灵轮。
  return turns;
}

/**
 * 轮终态清空 currentPhase（D-013③ / R-01「不显示陈旧值」兑现点）：
 * turn_completed/failed/killed 终态分支消费——防断线错过 first_event 的轮在
 * 终态后仍挂「正在启动 AI 进程 · 已等待 N 秒」假警示。泛型签名兼容 page
 * （SessionTurnView）与 dialog（DialogTurnView，segments 可选旧形状）双轮型。
 *
 * 2026-10-29-engine-live-perception（FR-03）：终态一并清空 heartbeat——轮终态
 * 权威 usage 随 turn_completed 到达，估算补显「落定即隐」的兜底兑现点（心跳
 * 停发 5s 自清之外的强清路径）；heartbeat 为可选字段，旧轮型（DialogTurnView
 * 无此字段）泛型兼容零影响。
 */
export function clearTurnPhase<
  T extends {
    currentPhase?: TurnPhaseState | null;
    heartbeat?: TurnHeartbeatState | null;
  },
>(turn: T): T {
  if (turn.currentPhase == null && turn.heartbeat == null) return turn;
  return { ...turn, currentPhase: null, heartbeat: null };
}

/**
 * 投递/送达阶段词表（2026-10-27-turn-phase-stall-honest-ui；FR-03 扩展于
 * 2026-10-27-turn-phase-observability-monotonic）：dispatched/delivered 表示
 * 「消息已下发/已领取」，inject_received 表示「消息已送达 AI」——三者都只
 * 描述消息搬运态，不描述执行进展。
 */
const DELIVERY_PHASES: ReadonlySet<string> = new Set([
  "dispatched",
  "delivered",
  "inject_received",
]);

/**
 * log 到达退位投递/送达阶段（2026-10-27-turn-phase-stall-honest-ui）：轮收到
 * 真实输出（log 事件有 DB 兜底必达）时，仍挂着的 dispatched/delivered 已失去
 * 展示意义（消息显然已被处理），清 null 让状态条退位回轮状态文案。只清搬运
 * 段——执行期阶段（skills_sync/spawning/…）可能与 log 并行推进，不越权。
 * 与 clearTurnPhase（终态全清）并列；生产实证：会话忙时消息在 backend 排队
 * 滞留 9 分钟，前端唯一 phase=delivered 无限计时（2026-10-27 会话 7eff99e1）。
 * FR-03（observability-monotonic）：集合扩展 inject_received——AI 已输出的
 * 场合「消息已送达 AI」同样失去展示意义。
 */
export function retireDeliveryPhase<
  T extends { currentPhase?: TurnPhaseState | null },
>(turn: T): T {
  const phase = turn.currentPhase?.phase;
  if (phase == null || !DELIVERY_PHASES.has(phase)) return turn;
  return { ...turn, currentPhase: null };
}

/**
 * ql-20260918-003：直发占位轮 → 真实 run_id 的合并替换（page/dialog 发送路径共用）。
 *
 * 常态：占位轮原位改名（runId=realRunId + status=nextStatus）。
 * 竞态：backend 在 `_inject_into_session` commit 后补发的 user_input log 事件
 * （SSE）先于 inject HTTP 响应到达时，upsertTurn 已按真实 run_id 建轮——此时
 * 删除占位轮、其 prompt 在先建轮为空时转移（通常先建轮已从 user_input 事件
 * 写入 prompt），避免同 runId 双轮。
 */
export function replacePlaceholderTurn<
  T extends { runId: string; prompt: string; status: TurnUiStatus },
>(turns: T[], placeholderId: string, realRunId: string, nextStatus: TurnUiStatus): T[] {
  const raced = turns.some((t) => t.runId === realRunId && t.runId !== placeholderId);
  if (!raced) {
    return turns.map((t) =>
      t.runId === placeholderId ? { ...t, runId: realRunId, status: nextStatus } : t,
    );
  }
  const placeholder = turns.find((t) => t.runId === placeholderId);
  return turns
    .filter((t) => t.runId !== placeholderId)
    .map((t) =>
      t.runId === realRunId && placeholder != null && !t.prompt.trim()
        ? { ...t, prompt: placeholder.prompt }
        : t,
    );
}

/**
 * 群聊体验 quick（2026-09-02）：初始历史窗口条数（logs 端点 limit=最新 N 条
 * 升序）。「加载更早消息」按钮同页距翻页（before 游标）。满页即视为可能还有
 * 更早（< 页距 = 已到头，按钮隐藏）。
 */
/** 历史日志单页条数（初始窗口 + 翻页步长）。
 * quick（ql-20260916-013）：50 → 400——线上实证 6e213eb3 会话 44 轮共 1.1 万条
 * 日志（单轮最多 1324 条），50 条/页要滚 220 次才能看全，用户滚几页只见未加载
 * 轮的配置行（“一堆空白”）。翻页单位是日志行而显示单位是轮——400 条/页（后端
 * 上限 le=1000）每次滚动覆盖数个完整轮；初始窗口 400 条覆盖最近几轮完整内容。
 * ql-20260916-009 的 100→50 撤销（丢弃概率考量让位于覆盖效率——丢弃仅影响
 * 单 run 跨页边界的更早段，属既有可接受降级）。 */
export const HISTORY_PAGE_SIZE = 400;

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
  // 2026-10-27-turn-phase-stall-honest-ui：log 事件的目标轮在 apply 后退位仍挂
  // 的投递阶段（dispatched/delivered）——真实输出已到达（log 有 DB 兜底必达），
  // 投递信号失去展示意义；page/dialog 双模式共用本函数，单点兜底。非 log 事件
  // 走原 apply 零变化。
  const applyRetiringDelivery = (t: SessionTurnView): SessionTurnView =>
    env.event === "log" ? retireDeliveryPhase(apply(t)) : apply(t);
  // 父归属优先跨轮路由（2026-09-15-subagent-three-pane-display 用户验收返工）：
  // 后台子代理的终态信号（[TASK_NOTIFICATION]）与内容行常经**后续 run** 上报
  // （daemon 任务注册表丢失时 writeTaskLine 回退 currentRunId，DB 实证：通知行
  // run_id ≠ 派发 run_id）。按 run_id 分轮会让这些行落到后续轮——装配器内
  // findToolById 找不到派发段 → 信号丢弃 → 派发段永久「运行中」+ 后续轮冒出
  // 永久 running 的幽灵 stub。带 parent_tool_use_id 的 log 先全轮 DFS 找父段，
  // 命中即路由到父段所在轮（终态信号更新段元数据，不重开轮）；未命中回退
  // run_id 分轮原路径（stub 兜底不变）。
  const parentToolUseId = env.parent_tool_use_id?.trim() || null;
  if (parentToolUseId && env.event === "log") {
    for (let i = prev.turns.length - 1; i >= 0; i -= 1) {
      const owner = prev.turns[i];
      if (owner && findSegmentById(owner.segments, parentToolUseId)) {
        // 只更新父段所在轮：apply（段元数据/children 追加），不 healToRunning
        // （后台通知到达时派发轮可能已完成——不把终态轮翻回 running），也不
        // 新建/合并 run_id 轮。倒序找最末命中（同 id 多轮仅极端重放场景）。
        // （本分支已限定 env.event === "log"，applyRetiringDelivery 同步退位。）
        const turns = prev.turns.map((t, idx) =>
          idx === i ? applyRetiringDelivery(t) : t,
        );
        return { ...prev, turns };
      }
    }
  }
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
      // 2026-10-10-session-turn-token-speed：轮内 API 时长（tok/s 分母）。
      // 仅 turn_completed 事件携带；新建时 null（运行中无此数据）。
      apiDurationMs: env.duration_api_ms ?? null,
      errorDetail: null,
      processItems: empty.processItems,
      segments: empty.segments,
      turnStartedAt: empty.turnStartedAt,
    };
    turns = [...prev.turns, applyRetiringDelivery(newTurn)];
  } else {
    // attach 竞态修复（ql-20260820-007）防御分支：主修正位于历史回灌处；若某条
    // 路径仍漏改（当前 run 的日志持续流入而轮卡终态），log 分支自愈翻回 running。
    // 真正完成的 run 其 currentRunId 已被 onTurnCompleted 清空，不会误翻。
    const healToRunning = env.event === "log" && prev.currentRunId === runId;
    turns = prev.turns.map((t, i) => {
      if (i !== idx) return t;
      if (env.event !== "log" && TERMINAL_TURN_STATUSES.has(t.status)) return t;
      const next = applyRetiringDelivery(t);
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

/**
 * turn_completed 的 status/exit_code/error_code → TurnUiStatus 终态。
 *
 * ql-20260918-003：打断语义分流——daemon SDK abort 上报 error_during_execution
 * 时 run.status=failed 但 error_code=interactive_interrupted（立即发送的忙时
 * 打断 / 手动打断本轮同源）；显示为 killed（已中止）而非 failed（轮次失败），
 * 消除「系统主动打断被渲染成失败」的误导。无 error_code 的老事件 / 老 backend
 * 保持 failed 原映射（真实失败必带 interactive_failed / interactive_unknown_status，
 * 不冒进归类）。
 */
export function deriveTurnTerminalStatus(env: SessionStreamEnvelope): TurnUiStatus {
  const status = env.status;
  if (status === "failed") {
    return env.error_code === "interactive_interrupted" ? "killed" : "failed";
  }
  if (status === "killed" || status === "cancelled") return "killed";
  if (env.exit_code !== null && env.exit_code !== 0 && env.status === null) {
    return env.exit_code === 130 || env.exit_code === 143 ? "killed" : "failed";
  }
  return "completed";
}

/* ── ql-20260822-010：会话视图模式（对话/进度）按会话持久化 ────────────────
 * 2026-10-22-session-trajectory-third-view（D-001）：视图扩为三态
 * （对话 / 进度 / 轨迹），key 不变、旧值语义不变。 */

/** localStorage key（先例 NEW_SESSION_MACHINE_LS_KEY 同 sillyhub.sessions 前缀）。 */
function viewModeLsKey(sessionId: string): string {
  return `sillyhub.sessions.viewMode.${sessionId}`;
}

/** 挂载回读：识别 "all" / "trajectory"，其余/缺失/SSR 无 window 一律默认 "conversation"。 */
export function readPersistedViewMode(sessionId: string): SessionViewMode {
  if (typeof window === "undefined") return "conversation";
  try {
    const raw = window.localStorage.getItem(viewModeLsKey(sessionId));
    return raw === "all" || raw === "trajectory" ? raw : "conversation";
  } catch {
    return "conversation";
  }
}

/** 切换时写入（隐私模式等写入失败静默，不阻断切换本身）。 */
export function writePersistedViewMode(
  sessionId: string,
  m: SessionViewMode,
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

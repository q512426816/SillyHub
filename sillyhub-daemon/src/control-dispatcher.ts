/**
 * 控制指令统一消费入口（2026-08-29-daemon-platform-resilience task-06 / design A2 消费端）。
 *
 * 背景：backend task-04 把 session_inject/interrupt/end/resume、permission_response、
 * provider_config_changed 六类下发点统一改走 `daemon_control_commands` 表三段式投递
 *（INSERT pending → WS 推送 → delivered；失败保持 pending 等补拉）。daemon 侧
 * 由此出现两条到达通道——WS 实时推送（payload 尾部注入可选 `command_id`）与
 * HTTP 补拉（getPendingControls 仅返回 pending）——本模块给两条通道提供同一条
 * 消费路径：(kind, payload) → 去重 → 按 kind 路由 handler → 收集 command_id 回执。
 *
 * 职责（单一，R4 防 daemon.ts god 文件膨胀）：
 *   - 按 kind 路由到构造注入的 handler 映射（handler 全部是 daemon.ts 既有
 *     `_routeSessionControl` / `_routePermissionResponse` / `_routeProviderConfigChanged`
 *     的薄包装——本模块不复制任何业务逻辑，只做路由/去重/回执）；
 *   - LRU 滑动窗（256 条）按 command_id 去重——仅防御「补拉在途时 WS 推送同条
 *     到达」的窗口竞态（同 backend ws_hub task_available 128 去重先例的 daemon 版，
 *     design A2 / D-006）；
 *   - ack 收集：消费成功与业务失败（handler 抛错 / 未知 kind）均收集 command_id，
 *     批量 POST controls/ack——毒丸指令不无限重投；ack 网络失败不删队列，留待
 *     下轮补拉重试（backend 端 ack 幂等）。
 *
 * 不做：
 *   - 不内嵌业务逻辑（session 状态机 / 权限 resolver / reload 全在 handler）；
 *   - 不做过期判断（backend GC 收口，daemon 只消费推送/补拉到的指令）；
 *   - 不做重试调度（补拉时机归 daemon 对账/心跳循环，本模块 pullAndConsume 单趟）。
 *
 * @module control-dispatcher
 */

import type { PendingControlCommand } from './protocol.js';

// ── 常量 ──────────────────────────────────────────────────────────────────────

/**
 * command_id 去重滑动窗容量（design A2：256 条，同 ws_hub `_DEDUP_WINDOW_SIZE=128`
 * 先例的 daemon 版翻倍——daemon 单边要同时容纳补拉+WS 双通道在途指令）。
 * 超容量淘汰最旧条目（Set 迭代序 = 插入序，天然 LRU 滑窗）。
 */
export const CONTROL_DEDUP_LRU_CAPACITY = 256;

/** WS 通道消费但 payload 不携带 runtime_id 时，回执暂存的桶键（见 _queueAck）。 */
const UNKNOWN_RUNTIME_KEY = '';

// ── 类型 ──────────────────────────────────────────────────────────────────────

/** 单条控制指令的消费结果。 */
export type ControlConsumeOutcome =
  /** handler 正常返回（业务语义上的成败由 handler 自行落日志）。 */
  | 'handled'
  /** command_id 在去重窗内（已在途/已消费），本次跳过执行。 */
  | 'duplicate'
  /** kind 不在 handler 映射内（词表漂移/旧版残留），无法路由。 */
  | 'unknown_kind'
  /** handler 抛错（业务失败——按 ack 语义同样回执，防毒丸重投）。 */
  | 'handler_error';

/** kind → handler 映射。handler 即 daemon.ts 既有路由方法的薄包装。 */
export interface ControlHandlerMap {
  [kind: string]: (
    payload: Record<string, unknown>,
  ) => Promise<void> | void;
}

/**
 * 控制指令 HTTP 源端口（鸭子类型——生产路径由 daemon 把 HubClient 的
 * getPendingControls/ackControls 适配进来；测试注入 mock。未注入（旧 client
 * 不实现两方法）时 pullAndConsume no-op，WS 路由不受影响）。
 */
export interface ControlCommandSource {
  getPendingControls(runtimeId: string): Promise<PendingControlCommand[]>;
  ackControls(runtimeId: string, ids: string[]): Promise<unknown>;
}

/** 最小日志接口（与 daemon.ts 既有 Logger 结构同构，避免反向依赖）。 */
export interface ControlDispatcherLogger {
  debug?(event: string, kv?: Record<string, unknown>): void;
  info?(event: string, kv?: Record<string, unknown>): void;
  warn?(event: string, kv?: Record<string, unknown>): void;
  error?(event: string, kv?: Record<string, unknown>): void;
}

/** ControlDispatcher 构造参数。 */
export interface ControlDispatcherOptions {
  /** kind → handler 映射（必填；daemon 注入六个既有路由方法）。 */
  handlers: ControlHandlerMap;
  /** HTTP 源（可选——缺省只做 WS 路由+去重，不补拉不回执）。 */
  source?: ControlCommandSource | null;
  /** 日志（可选，缺省静默——单测直接断言返回值）。 */
  logger?: ControlDispatcherLogger | null;
  /** 去重窗容量（默认 256；测试可缩小）。 */
  lruCapacity?: number;
}

/** pullAndConsume 单趟汇总（观测/测试断言用）。 */
export interface PullControlsSummary {
  /** 补拉到的 pending 指令数。 */
  pulled: number;
  /** 实际执行（handled/handler_error/unknown_kind）的指令数（duplicate 不计）。 */
  consumed: number;
  /** 本趟 ack POST 成功发出的指令数。 */
  acked: number;
}

// ── 主类 ──────────────────────────────────────────────────────────────────────

export class ControlDispatcher {
  private readonly _handlers: ControlHandlerMap;
  private readonly _source: ControlCommandSource | null;
  private readonly _logger: ControlDispatcherLogger | null;
  private readonly _lruCapacity: number;
  /** command_id 去重滑动窗（Set 迭代序=插入序，超容量淘汰最旧）。 */
  private readonly _seen = new Set<string>();
  /**
   * 待回执 command_id，按 runtime 分桶（Map 迭代序=插入序）。ack POST 成功才
   * 清桶；网络失败保留，下轮补拉重试。WS 通道消费但 payload 无 runtime_id 的
   * 指令进 UNKNOWN_RUNTIME_KEY 桶——由下一次任意 runtime 的补拉趟捎带回执
   *（backend ack 按行归属翻转，不属该 runtime 的 id 静默 no-op，多发无害）。
   */
  private readonly _pendingAcks = new Map<string, Set<string>>();

  constructor(opts: ControlDispatcherOptions) {
    this._handlers = opts.handlers;
    this._source = opts.source ?? null;
    this._logger = opts.logger ?? null;
    this._lruCapacity =
      opts.lruCapacity && opts.lruCapacity > 0
        ? Math.floor(opts.lruCapacity)
        : CONTROL_DEDUP_LRU_CAPACITY;
  }

  /**
   * 统一消费入口：去重 → 路由 handler → 收集回执。
   *
   * WS 推送与 HTTP 补拉共用本方法：
   *   - `commandId` 缺省（旧 backend 消息无该字段）→ 跳过去重直接路由（行为与
   *     改造前 WS 直连路由逐字一致）；
   *   - `commandId` 已在去重窗 → 返回 'duplicate'，不执行 handler；
   *   - handler 抛错 / 未知 kind → 业务失败：同样收集回执（ack 语义=已处理，
   *     防毒丸无限重投），错误落日志不向上抛。
   *
   * @param kind      控制指令 kind（CONTROL_KIND 词表）。
   * @param payload   与既有 WS 消息同构的 payload（补拉路径可能为 null → 传空对象）。
   * @param opts      commandId（去重键）/ runtimeId（回执归属）。
   */
  async consume(
    kind: string,
    payload: Record<string, unknown>,
    opts: { commandId?: string; runtimeId?: string } = {},
  ): Promise<ControlConsumeOutcome> {
    const { commandId, runtimeId } = opts;
    if (commandId !== undefined) {
      if (!this._markSeen(commandId)) {
        this._logger?.info?.('control_command_duplicate', {
          kind,
          command_id: commandId,
        });
        // 补拉趟里重复出现 = 上次消费后 ack 未达（backend 仍 pending）——重新
        // 排队回执，让 ack 最终收敛（重复执行已被上方去重拦截）。
        this._queueAck(runtimeId, commandId);
        return 'duplicate';
      }
    }
    const handler = this._handlers[kind];
    if (!handler) {
      this._logger?.warn?.('control_command_unknown_kind', { kind });
      this._queueAck(runtimeId, commandId);
      return 'unknown_kind';
    }
    try {
      await handler(payload ?? {});
    } catch (e) {
      this._logger?.error?.('control_command_handler_failed', {
        kind,
        command_id: commandId,
        error: e,
      });
      this._queueAck(runtimeId, commandId);
      return 'handler_error';
    }
    this._queueAck(runtimeId, commandId);
    return 'handled';
  }

  /**
   * 单趟补拉：getPendingControls → 逐条 consume（带 commandId+runtimeId，走
   * 同一条去重/路由路径）→ 批量 ack。
   *
   * 错误边界：
   *   - getPendingControls 抛错（网络 / 旧 backend 404）→ **向上抛**，由调用方
   *（daemon 对账/心跳）降级 warn 不崩，指令留 backend pending 等下轮；
   *   - 单条消费的业务失败在 consume 内消化（handler_error 仍回执）；
   *   - ack POST 网络失败 → ids 保留在待回执桶，返回 acked=0，下趟重试。
   *
   * 未注入 source（client 不实现两方法，旧测试 mock）→ 汇总全 0 的 no-op。
   */
  async pullAndConsume(runtimeId: string): Promise<PullControlsSummary> {
    if (!this._source) {
      return { pulled: 0, consumed: 0, acked: 0 };
    }
    const commands = await this._source.getPendingControls(runtimeId);
    let consumed = 0;
    for (const cmd of commands) {
      if (!cmd || typeof cmd.id !== 'string' || !cmd.id) continue;
      const payload =
        cmd.payload && typeof cmd.payload === 'object'
          ? cmd.payload
          : {};
      const outcome = await this.consume(cmd.kind, payload, {
        commandId: cmd.id,
        runtimeId,
      });
      if (outcome !== 'duplicate') consumed++;
    }
    const acked = await this._flushAcks(runtimeId);
    return { pulled: commands.length, consumed, acked };
  }

  /** 当前待回执指令数（按 runtime 汇总；测试/观测用）。 */
  get pendingAckCount(): number {
    let n = 0;
    for (const bucket of this._pendingAcks.values()) n += bucket.size;
    return n;
  }

  // ── 内部 ───────────────────────────────────────────────────────────────────

  /**
   * 去重窗标记。返回 false = 已存在（重复）；true = 新标记（并按需淘汰最旧）。
   * Set 迭代序 = 插入序，`values().next()` 即最旧条目——同 Python deque(maxlen)
   * 滑动窗语义（ws_hub `_dedup_window` 先例）。
   */
  private _markSeen(commandId: string): boolean {
    if (this._seen.has(commandId)) return false;
    this._seen.add(commandId);
    while (this._seen.size > this._lruCapacity) {
      const oldest = this._seen.values().next().value;
      if (oldest === undefined) break;
      this._seen.delete(oldest);
    }
    return true;
  }

  /** 收集回执（commandId/runtimeId 任一缺省则跳过——无 id 无法回执，无桶可挂）。 */
  private _queueAck(
    runtimeId: string | undefined,
    commandId: string | undefined,
  ): void {
    if (commandId === undefined) return;
    const key = runtimeId !== undefined && runtimeId !== '' ? runtimeId : UNKNOWN_RUNTIME_KEY;
    let bucket = this._pendingAcks.get(key);
    if (!bucket) {
      bucket = new Set<string>();
      this._pendingAcks.set(key, bucket);
    }
    bucket.add(commandId);
  }

  /**
   * 批量回执：runtime 桶 + 未知 runtime 桶合并 POST（不属该 runtime 的 id 在
   * backend 静默 no-op）。**POST 成功才逐 id 出队**（await 期间新入队的 id 不受
   * 影响）；网络失败保留待下趟（ack 幂等，重发无害）。
   */
  private async _flushAcks(runtimeId: string): Promise<number> {
    if (!this._source) return 0;
    const bucket = this._pendingAcks.get(runtimeId);
    const unknownBucket = this._pendingAcks.get(UNKNOWN_RUNTIME_KEY);
    const ids = [...(bucket ?? []), ...(unknownBucket ?? [])];
    if (ids.length === 0) return 0;
    try {
      const resp = await this._source.ackControls(runtimeId, ids);
      // 成功后才出队本批快照（新入队 id 留给下趟）。
      for (const id of ids) {
        bucket?.delete(id);
        unknownBucket?.delete(id);
      }
      const acked =
        resp && typeof (resp as { acked?: unknown }).acked === 'number'
          ? (resp as { acked: number }).acked
          : ids.length;
      return acked;
    } catch (e) {
      this._logger?.warn?.('control_ack_failed', {
        runtime_id: runtimeId,
        count: ids.length,
        error: e,
      });
      return 0;
    }
  }
}

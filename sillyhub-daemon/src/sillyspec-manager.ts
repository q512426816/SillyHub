/**
 * sillyspec-manager.ts —— 运行期 sillyspec 版本探测与升级状态机。
 *
 * 2026-08-31-machine-sillyspec-version task-04（design §1 daemon 侧核心，
 * D-001@v1 方案 A）：preflight 的 sillyspec 检查只在 daemon 启动时跑一次，本模块
 * 把它延伸到运行期——本机/最新版本探测（latest 10min 缓存）+ npm 安装升级 +
 * 升级状态机（内存态），为 task-05（心跳上报 / WS SILLYSPEC_UPDATE 触发 / 1h
 * 自动循环接线）提供独立可测的核心。
 *
 * 职责边界：
 *   - 探测/安装 spawn 一律复用 preflight 基建（runCmd / installSillySpec，底层
 *     runWithTreeKill 超时杀树，Windows taskkill /T /F），本模块零自写进程逻辑；
 *   - 不 import daemon.ts（依赖单向注入：isBusy 回调由 task-05 接
 *     daemon._isBusyForUpdate），不接线 config / protocol / hub-client；
 *   - 版本比较复用 preflight isOutdated（semver 元组 + 字符串不等兜底），不重实现。
 *
 * 状态机（内存态，daemon 重启即回 idle——重启后 preflight 启动检查已保证最新）：
 *
 *   idle ──requestUpgrade（空闲）──▶ running ──成功──▶ success ─┐
 *     │                                │                      ├─10min 展示窗─▶ idle
 *     │ 机器忙（isBusy）                └─失败──▶ failed ───────┘
 *     ▼
 *   deferred ──每 30s 复查：转空闲 ▶ running；仍忙 ▶ 再推迟（定时器单实例不叠）
 *
 *   in-flight 门：running/deferred 期间新 requestUpgrade 仅记日志去重
 *   （CLEANUP 惯例）；终态（success/failed）展示窗内新请求可再次进入升级。
 *
 * 终态 10min 过期采用**惰性判定**而非定时器：getSnapshot 每次调用（生产 = 每拍
 * 心跳）时判定 now - 终态时刻 ≥ 窗口即回 idle——常驻进程专门排一个 10min 定时器
 * 只为清内存标志属多余，且无人取快照时终态留在内存无外部可见副作用。
 *
 * 升级成败判定：installSillySpec 保持 preflight 原样导出（void 返回——本变更
 * 铁律「preflight 只加 export，行为零变化」），故成败以**安装后 probeLocal** 为
 * 准：探测到版本即 success（to_version=探测值），探测不到即 failed。已知边界：
 * 安装失败（npm 不可达等）但旧版本仍在位时，探测返回旧版本 → 上报 from==to 的
 * success；版本徽标仍以真实探测值为准、下轮自动检查自愈（design R4 同思路）。
 *
 * @module sillyspec-manager
 */

import {
  runCmd,
  installSillySpec,
  isOutdated,
  type PreflightLogger,
} from './preflight.js';

// ── 导出常量（时间参数默认值，全部可注入覆盖；对齐 design §1）─────────────────

/** `npm view sillyspec version` 探测结果缓存 TTL（10 分钟，design R2）。 */
export const SILLYSPEC_LATEST_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * deferred 复查间隔（30 秒）。对齐 daemon 自更新 SELF_UPDATE_RETRY_INTERVAL_MS
 * 的忙推迟复查节奏（design §1 状态机表）。
 */
export const SILLYSPEC_DEFERRED_RECHECK_MS = 30_000;

/** 终态（success/failed）展示窗口（10 分钟后回 idle，design F14）。 */
export const SILLYSPEC_TERMINAL_WINDOW_MS = 10 * 60 * 1000;

/** failed 态 error 摘要截断上限（字符，design 接口定义）。 */
const SILLYSPEC_ERROR_MAX_CHARS = 200;

// ── 类型（task-05 心跳/注册接线将复用）─────────────────────────────────────────

/** 升级触发来源：server_command（WS 指令）/ auto（定时自动检查）。 */
export type SillySpecUpdateTrigger = 'server_command' | 'auto';

/** 升级状态机阶段（idle 为无状态，不在此联合内——快照以 update 键缺席表达）。 */
export type SillySpecUpdateStatus = 'running' | 'deferred' | 'success' | 'failed';

/** 升级状态快照（heartbeat sillyspec_update 键的载荷形状，design 接口定义）。 */
export interface SillySpecUpdateState {
  state: SillySpecUpdateStatus;
  trigger: SillySpecUpdateTrigger;
  /** 升级前本机版本；未安装/未知为 null。 */
  from_version: string | null;
  /** 升级后版本；success 时必带。 */
  to_version?: string;
  /** 失败摘要；failed 时必带（截断至 200 字符）。 */
  error?: string;
}

/** getSnapshot 返回形状：{version, latest_version, update?}。 */
export interface SillySpecSnapshot {
  /** 本机 sillyspec 版本（最近一次 probeLocal 结果）；null=未安装或未知。 */
  version: string | null;
  /** npm 最新版（最近一次成功 probeLatest 的缓存值）；null=未知。 */
  latest_version: string | null;
  /** 升级状态；键仅在存在（且未过 10min 展示窗）时携带——缺席=idle/backend 清除。 */
  update?: SillySpecUpdateState;
}

/** 构造依赖（runner/isBusy/clock/间隔常量注入供测试；生产由 task-05 接线）。 */
export interface SillySpecManagerDeps {
  /**
   * 探测命令 runner：默认 preflight runCmd（spawn+超时杀树，失败返回 null）。
   * 测试注入假实现避免真实 spawn。
   */
  runCommand?: (cmd: string) => Promise<string | null>;
  /**
   * 安装执行器：默认 preflight installSillySpec（`npm install -g sillyspec@latest`）。
   * 测试注入假实现；升级执行只经此（不在 manager 内另写 npm spawn）。
   */
  install?: (logger: PreflightLogger) => Promise<void>;
  /**
   * 机器忙判定（必填）：生产接 daemon._isBusyForUpdate（恢复在途+运行中轮次+
   * 活跃 lease 三臂）。忙时升级走 deferred，不打断运行中的会话/任务。
   */
  isBusy: () => boolean;
  /** 时钟（毫秒 epoch），默认 Date.now；测试注入可推进假钟。 */
  now?: () => number;
  /** 日志回调（PreflightLogger 形状），默认静默；task-05 适配 daemon 内部 Logger。 */
  logger?: PreflightLogger;
  /** latest 缓存 TTL（毫秒），默认 {@link SILLYSPEC_LATEST_CACHE_TTL_MS}。 */
  latestCacheTtlMs?: number;
  /** deferred 复查间隔（毫秒），默认 {@link SILLYSPEC_DEFERRED_RECHECK_MS}。 */
  deferredRecheckMs?: number;
  /** 终态展示窗口（毫秒），默认 {@link SILLYSPEC_TERMINAL_WINDOW_MS}。 */
  terminalWindowMs?: number;
}

// ── 实现 ──────────────────────────────────────────────────────────────────────

/**
 * sillyspec 运行期版本管理与升级状态机。
 *
 * 对外契约（task-05 provides：SillySpecManagerApi）：
 * probeLocal / probeLatest / getSnapshot / requestUpgrade / checkAndUpgrade。
 */
export class SillySpecManager {
  private readonly _runCommand: (cmd: string) => Promise<string | null>;
  private readonly _install: (logger: PreflightLogger) => Promise<void>;
  private readonly _isBusy: () => boolean;
  private readonly _now: () => number;
  private readonly _log: PreflightLogger;
  private readonly _latestCacheTtlMs: number;
  private readonly _deferredRecheckMs: number;
  private readonly _terminalWindowMs: number;

  /** 最近一次本机探测结果（null=未安装/未知）。 */
  private _version: string | null = null;
  /** latest 成功探测缓存（失败不缓存，TTL 过期即重探）。 */
  private _latestCache: { value: string; at: number } | null = null;
  /** 升级状态；null=idle。 */
  private _update: SillySpecUpdateState | null = null;
  /** 终态进入时刻（惰性过期判定用）；非终态为 null。 */
  private _terminalAt: number | null = null;
  /** deferred 复查定时器（单实例：排新前清旧，不叠）。 */
  private _deferredTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: SillySpecManagerDeps) {
    this._runCommand = deps.runCommand ?? ((cmd: string) => runCmd(cmd));
    this._install = deps.install ?? ((logger: PreflightLogger) => installSillySpec(logger));
    this._isBusy = deps.isBusy;
    this._now = deps.now ?? (() => Date.now());
    this._log =
      deps.logger ??
      (() => {
        /* 默认静默：测试/未接线时不刷屏，task-05 注入真实日志 */
      });
    this._latestCacheTtlMs = deps.latestCacheTtlMs ?? SILLYSPEC_LATEST_CACHE_TTL_MS;
    this._deferredRecheckMs = deps.deferredRecheckMs ?? SILLYSPEC_DEFERRED_RECHECK_MS;
    this._terminalWindowMs = deps.terminalWindowMs ?? SILLYSPEC_TERMINAL_WINDOW_MS;
  }

  // ── 探测 ────────────────────────────────────────────────────────────────────

  /**
   * 探测本机 sillyspec 版本（`sillyspec --version`）。
   * 成功返回 trim 后版本串并记入快照缓存；失败（未安装/命令失败/超时杀树）返回
   * null 且缓存置 null（未安装语义）。
   */
  async probeLocal(): Promise<string | null> {
    const out = await this._runCommand('sillyspec --version');
    // trim/空串归一在 manager 侧兜底（默认 runCmd 已做，注入 runner 时契约不变）。
    const version = out !== null ? out.trim() : null;
    this._version = version === '' ? null : version;
    if (this._version === null) {
      this._log('warn', 'sillyspec_local_probe_failed');
    }
    return this._version;
  }

  /**
   * 探测 npm 最新版（`npm view sillyspec version`），成功结果缓存 TTL 10 分钟。
   *
   * 失败（npm 不可达）不缓存——下次调用即重试（调用频率为小时级循环/手动触发，
   * 无重试风暴风险）；缓存过期后旧值仅作 getSnapshot 兜底展示，探到新值即覆盖。
   */
  async probeLatest(): Promise<string | null> {
    const cached = this._latestCache;
    if (cached !== null && this._now() - cached.at < this._latestCacheTtlMs) {
      return cached.value;
    }
    const out = await this._runCommand('npm view sillyspec version');
    if (out === null || out.trim() === '') {
      this._log('warn', 'sillyspec_latest_probe_failed');
      return null;
    }
    const latest = out.trim();
    this._latestCache = { value: latest, at: this._now() };
    return latest;
  }

  /**
   * 当前快照（纯同步，零 spawn）：{version, latest_version, update?}。
   *
   * update 键仅在升级状态存在且未过 10min 终态展示窗时携带（缺席 = idle，backend
   * 据此清除 sillyspec_update 列——pending_update 同款反向语义）。返回的是内部
   * 状态浅拷贝，调用方改写不影响状态机。
   */
  getSnapshot(): SillySpecSnapshot {
    this._expireTerminalIfDue();
    const snapshot: SillySpecSnapshot = {
      version: this._version,
      latest_version: this._latestCache?.value ?? null,
    };
    if (this._update !== null) {
      snapshot.update = { ...this._update };
    }
    return snapshot;
  }

  // ── 升级入口 ────────────────────────────────────────────────────────────────

  /**
   * 手动指令入口（WS SILLYSPEC_UPDATE → daemon.ts 接线）：先版本门再
   * :meth:`requestUpgrade`。
   *
   * ql-20260902-003：auto 路径经 :meth:`checkAndUpgrade` 已有 isOutdated 门
   * （已最新 no-op），手动 server_command 原先直入 requestUpgrade 无门——已最新
   * 时白跑一次 `npm install -g` 还滚动一轮 running→success 横幅。此处先探
   * latest+local（probeLatest 有 10min 缓存），已安装且 !isOutdated → no-op
   * （不写状态，横幅不动）；探测失败不阻断（网络不可达照旧升级，宁装勿漏）。
   * 刻意不把门塞进 requestUpgrade——该方法依赖「running 同步置位先于首个
   * await」契约（in-flight 门/测试同步断言），异步探测必须外置。
   */
  async requestManualUpgrade(): Promise<void> {
    const latest = await this.probeLatest();
    const local = await this.probeLocal();
    if (latest !== null && local !== null && !isOutdated(local, latest)) {
      this._log('debug', 'sillyspec_upgrade_skipped_up_to_date', {
        trigger: 'server_command',
        local,
        latest,
      });
      return;
    }
    await this.requestUpgrade('server_command');
  }

  /**
   * 请求升级（WS 指令 server_command / 自动检查 auto 统一入口）。
   *
   * - in-flight 门：running/deferred 期间新请求仅记日志去重（CLEANUP 惯例）；
   * - 机器忙（isBusy）→ deferred + 30s 复查定时（空闲转 running）；
   * - 空闲 → running：installSillySpec → probeLocal 刷新 → success（from/to）；
   *   安装后探测失败或过程异常 → failed（error 截断 200 字符）。
   *
   * 全路径自收敛不 reject。
   */
  async requestUpgrade(trigger: SillySpecUpdateTrigger): Promise<void> {
    const current = this._update;
    if (
      current !== null &&
      (current.state === 'running' || current.state === 'deferred')
    ) {
      // in-flight 去重：与 daemon CLEANUP 指令同款——仅记日志，不叠加执行。
      this._log('warn', 'sillyspec_upgrade_skipped_inflight', {
        current_state: current.state,
        trigger,
      });
      return;
    }
    if (this._isBusy()) {
      const from = this._version;
      this._terminalAt = null;
      this._update = { state: 'deferred', trigger, from_version: from };
      this._log('info', 'sillyspec_upgrade_deferred', {
        trigger,
        from_version: from,
        recheck_ms: this._deferredRecheckMs,
      });
      this._scheduleDeferredRecheck();
      return;
    }
    await this._runUpgrade(trigger);
  }

  /**
   * 自动检查入口（1h 循环/启动衔接探测用，task-05 接线）：
   * probeLatest + probeLocal → 未安装或 isOutdated → requestUpgrade(trigger)；
   * 已最新 no-op（debug 记录）；latest 不可达 → warn no-op（不做离线重试/退避，
   * 失败留给下轮自动检查或手动重试）。
   */
  async checkAndUpgrade(
    trigger: SillySpecUpdateTrigger = 'auto',
  ): Promise<void> {
    const latest = await this.probeLatest();
    if (latest === null) {
      this._log('warn', 'sillyspec_latest_unavailable');
      return;
    }
    const local = await this.probeLocal();
    if (local === null) {
      this._log('info', 'sillyspec_not_installed', { latest });
      await this.requestUpgrade(trigger);
      return;
    }
    if (isOutdated(local, latest)) {
      this._log('info', 'sillyspec_outdated', { local, latest });
      await this.requestUpgrade(trigger);
      return;
    }
    this._log('debug', 'sillyspec_up_to_date', { version: local, latest });
  }

  // ── 内部：升级执行与状态机流转 ───────────────────────────────────────────────

  /**
   * 执行升级链：置 running（同步——requestUpgrade 的 in-flight 门依赖此置位先于
   * 任何 await）→ installSillySpec → probeLocal 刷新 → 终态。
   *
   * from_version 取最近已知本机版本（checkAndUpgrade 刚探测过；server_command
   * 路径未探测过则为 null，展示窗语义允许）。全链 try/catch 收敛不 reject。
   */
  private async _runUpgrade(trigger: SillySpecUpdateTrigger): Promise<void> {
    this._clearDeferredTimer();
    const from = this._version;
    this._terminalAt = null;
    this._update = { state: 'running', trigger, from_version: from };
    this._log('info', 'sillyspec_upgrade_started', { trigger, from_version: from });
    try {
      await this._install(this._log);
      const to = await this.probeLocal();
      if (to === null) {
        // 安装后探测不到版本：安装可能失败（旧版本在位）或 CLI 不可用——统一按
        // failed 上报（design R4：版本列保留旧值，下轮自动循环自愈）。
        this._finishTerminal(trigger, from, 'failed', {
          error: '安装后 sillyspec --version 探测失败（安装未生效或 CLI 不可用）',
        });
        return;
      }
      this._finishTerminal(trigger, from, 'success', { to_version: to });
    } catch (e) {
      this._finishTerminal(trigger, from, 'failed', { error: fmtErrorSnippet(e) });
    }
  }

  /** 进入终态（success/failed）并记录展示窗起点。 */
  private _finishTerminal(
    trigger: SillySpecUpdateTrigger,
    from: string | null,
    state: 'success' | 'failed',
    fields: { to_version?: string; error?: string },
  ): void {
    this._clearDeferredTimer();
    this._terminalAt = this._now();
    this._update = { state, trigger, from_version: from, ...fields };
    this._log(state === 'success' ? 'info' : 'warn', `sillyspec_upgrade_${state}`, {
      trigger,
      from_version: from,
      ...fields,
    });
  }

  /**
   * 惰性终态过期（取舍见模块头注释）：仅 getSnapshot 调用点判定——非终态不动作；
   * 超窗回 idle（update 置 null + 清起点，下次快照 update 键缺席）。
   */
  private _expireTerminalIfDue(): void {
    const current = this._update;
    if (
      current === null ||
      (current.state !== 'success' && current.state !== 'failed') ||
      this._terminalAt === null
    ) {
      return;
    }
    if (this._now() - this._terminalAt >= this._terminalWindowMs) {
      this._update = null;
      this._terminalAt = null;
      this._log('debug', 'sillyspec_update_window_expired');
    }
  }

  /**
   * 排/刷新 deferred 复查定时器（单实例：clearTimeout 再 setTimeout，不叠）。
   * 到点仍忙 → 再推迟；转空闲 → 以原 trigger 转 running。unref 对齐
   * daemon._scheduleUpdateRetry 惯例（不阻止进程退出）。
   */
  private _scheduleDeferredRecheck(): void {
    if (this._deferredTimer !== null) {
      clearTimeout(this._deferredTimer);
    }
    this._deferredTimer = setTimeout(() => {
      this._deferredTimer = null;
      const current = this._update;
      if (current === null || current.state !== 'deferred') {
        // 状态已离开 deferred（新升级已开/终态）——定时器属迟到回调，不动作。
        return;
      }
      if (this._isBusy()) {
        this._log('debug', 'sillyspec_upgrade_still_deferred', {
          trigger: current.trigger,
        });
        this._scheduleDeferredRecheck();
        return;
      }
      // 空闲 → 转 running（保持原 trigger）。_runUpgrade 全路径 catch 收敛不
      // reject；.catch 为防御性兜底（daemon 定时器惯例）。
      void this._runUpgrade(current.trigger).catch((e: unknown) => {
        this._log('error', 'sillyspec_upgrade_recheck_failed', {
          error: fmtErrorSnippet(e),
        });
      });
    }, this._deferredRecheckMs);
    if (typeof this._deferredTimer.unref === 'function') {
      this._deferredTimer.unref();
    }
  }

  /** 清 deferred 复查定时器（离开 deferred 态必调）。 */
  private _clearDeferredTimer(): void {
    if (this._deferredTimer !== null) {
      clearTimeout(this._deferredTimer);
      this._deferredTimer = null;
    }
  }
}

/** unknown 错误 → 摘要串（Error 取 message，其余 String()），截断至 200 字符。 */
function fmtErrorSnippet(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  return text.length > SILLYSPEC_ERROR_MAX_CHARS
    ? text.slice(0, SILLYSPEC_ERROR_MAX_CHARS)
    : text;
}

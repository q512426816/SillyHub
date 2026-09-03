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
 * 2026-09-02-changes-overview-card task-02 扩展：progress show --json 采集器
 * （collectStatusOnce/getStatusSnapshot，三态降级矩阵 + 32KB 预算截断），
 * 与升级状态机相互独立（升级链路不复用本采集器）。
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

// 2026-09-02-changes-overview-card task-02（FR-02/NFR-02）：progress show --json
// 采集器用 execFile 数组形参直跑 node <sillyspec-bin>（无 shell 依赖，路径空格
// 安全）；bin 解析用 existsSync 探测 npm 全局布局候选。
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

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

/**
 * progress 采集子进程超时（30s）。仿 runtime-handler.ts SILLYSPEC_TIMEOUT_MS 先例
 * （design §5 三态矩阵 ③ / FR-03；backend 侧无 RPC 时限，纯本地采集上限）。
 */
export const SILLYSPEC_STATUS_TIMEOUT_MS = 30_000;

/** 心跳摘要 changes 列表截断上限（N=50，design §4 / Grill B2）。 */
export const SILLYSPEC_STATUS_CHANGES_MAX = 50;

/**
 * 心跳 sillyspec_status 载荷自设预算（32KB，design §4 / Grill B2 修订）：心跳 REST
 * 通道无 8KB 级既有限制，自设预算一倍余量；超限降级纯计数模式（丢列表保计数）。
 */
export const SILLYSPEC_STATUS_BUDGET_BYTES = 32 * 1024;

/** 采集 stdout maxBuffer（8MB）：envelope 正常 KB 级，防御 ghost 爆量场景。 */
const SILLYSPEC_STATUS_MAX_BUFFER = 8 * 1024 * 1024;

/**
 * execFile 一次执行的结果（三态矩阵判别输入）。
 *
 * - code：进程退出码；spawn 失败（error 事件，如 ENOENT）为 null。
 * - timedOut：超时被杀（child_process timeout → SIGTERM + killed=true）。
 * - errorCode：spawn error 事件的字符串 code（'ENOENT' 等）；正常执行不带。
 */
export interface SillySpecProgressOutcome {
  code: number | null;
  stdout: string;
  timedOut: boolean;
  errorCode?: string;
}

/**
 * 心跳 sillyspec_status 摘要（design §4 数据契约，backend 契约锚 task-01
 * DaemonHeartbeatSillySpecStatus）。envelope 的 readable/command 字段容忍但不透传。
 */
export interface SillySpecStatusSummary {
  ok: boolean;
  errors_count: number;
  warnings_count: number;
  generated_at: string;
  active_changes: number;
  healthy_count: number;
  ghost_count: number;
  conflict_count: number;
  /** 冲突按 type 计数（如 { 'spec-tree': 1, progress: 2 }）。 */
  conflict_types: Record<string, number>;
  /** 变更行截断至 N=50；每项六字段（steps 为 {total, completed} 投影）。 */
  changes: SillySpecStatusChangeItem[];
  pending_conflicts: SillySpecStatusPendingConflict[];
}

/** 摘要 changes[] 单项（envelope 六字段投影，readable/stages 明细不透传）。 */
export interface SillySpecStatusChangeItem {
  name: string;
  ghost: boolean;
  current_stage: string;
  stage_label: string;
  last_active: string;
  steps: { total: number; completed: number };
}

/** 摘要 pending_conflicts[] 单项（change/created_at/type 三字段原样）。 */
export interface SillySpecStatusPendingConflict {
  change: string;
  created_at: string;
  type: string;
}

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
  /**
   * 2026-09-02-changes-overview-card task-02（FR-02/NFR-02）：progress 采集执行器
   * （execFile 数组形参，file=node、args[0]=sillyspec bin JS）。默认真实 execFile；
   * 测试注入假实现避免真实 spawn。
   */
  runProgressJson?: (
    file: string,
    args: string[],
    options: { cwd: string; timeoutMs: number; maxBufferBytes: number },
  ) => Promise<SillySpecProgressOutcome>;
  /**
   * sillyspec bin JS 入口解析器：默认 SILLYSPEC_BIN env（源码直连联调）→ npm 全局
   * 布局候选（win32: <execDir>/node_modules/...；posix: <execDir>/../lib/node_modules/...）
   * 逐个 existsSync；全不存在返回 null（=能力缺失三态②）。测试可注入固定值。
   */
  resolveSillySpecBin?: () => string | null;
  /**
   * 采集 cwd（workspace 主仓根，规则 22 禁 worktree）提供者。daemon 接线为
   * claim 观察到的 rootPath 回调；返回 null = 本拍跳过（尚无已知主仓根）。
   */
  statusCwd?: () => string | null;
  /** 采集超时（毫秒），默认 SILLYSPEC_STATUS_TIMEOUT_MS；测试注入调小。 */
  statusTimeoutMs?: number;
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

  // ── 2026-09-02-changes-overview-card task-02：progress 采集状态（三态矩阵）──

  /** 采集执行器（execFile 数组形参；默认真实实现，测试注入假实现）。 */
  private readonly _runProgressJson: (
    file: string,
    args: string[],
    options: { cwd: string; timeoutMs: number; maxBufferBytes: number },
  ) => Promise<SillySpecProgressOutcome>;
  /** sillyspec bin 解析器（默认 env + npm 全局布局探测）。 */
  private readonly _resolveSillySpecBin: () => string | null;
  /** 采集 cwd 提供者（workspace 主仓根；null = 无已知根跳过）。 */
  private readonly _statusCwd: () => string | null;
  /** 采集超时毫秒。 */
  private readonly _statusTimeoutMs: number;
  /**
   * 最近一次采集结果摘要；null = 能力缺失（三态②，上报 null=backend 置 NULL 清除）。
   * 三态③瞬态失败保留旧值不清除；未定级前 _statusKnown=false（上报键缺席）。
   */
  private _statusSummary: SillySpecStatusSummary | null = null;
  /** 是否已有终分级（①快照或②能力缺失）；false=心跳不携带 sillyspec_status 键。 */
  private _statusKnown = false;
  /** 三态②同类告警去重（warn 一次后同类静默：bin_not_found/spawn_enoent/bad_json）。 */
  private readonly _statusWarnedClasses = new Set<string>();

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
    this._runProgressJson = deps.runProgressJson ?? runProgressJsonDefault;
    this._resolveSillySpecBin = deps.resolveSillySpecBin ?? resolveSillySpecBinDefault;
    this._statusCwd = deps.statusCwd ?? (() => null);
    this._statusTimeoutMs = deps.statusTimeoutMs ?? SILLYSPEC_STATUS_TIMEOUT_MS;
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

  // ── 2026-09-02-changes-overview-card task-02：progress 状态采集（三态矩阵）─────

  /**
   * 采集一拍：spawn `node <sillyspec-bin> progress show --json`（execFile 数组形参，
   * cwd=workspace 主仓根）→ 三态矩阵（FR-03 / design §5）：
   *   ① 成功（exit 0 + 合法 JSON）→ 落新快照；
   *   ② 能力缺失（bin 不存在/spawn ENOENT=未安装；exit 0 但非 JSON=旧版无 --json）
   *     → warn 一次同类静默，快照置 null（上报=清除）；
   *   ③ 瞬态失败（超时/非零退出/spawn 其他错误）→ 保留上次快照不清除。
   * 全路径自收敛不 reject；无已知主仓根（statusCwd→null）本拍跳过（debug）。
   */
  async collectStatusOnce(): Promise<void> {
    const cwd = this._statusCwd();
    if (!cwd) {
      this._log('debug', 'sillyspec_status_skip_no_root');
      return;
    }
    const bin = this._resolveSillySpecBin();
    if (bin === null) {
      this._markStatusCapabilityMissing('bin_not_found', { cwd });
      return;
    }
    let outcome: SillySpecProgressOutcome;
    try {
      outcome = await this._runProgressJson(
        process.execPath,
        [bin, 'progress', 'show', '--json'],
        {
          cwd,
          timeoutMs: this._statusTimeoutMs,
          maxBufferBytes: SILLYSPEC_STATUS_MAX_BUFFER,
        },
      );
    } catch (e) {
      // 执行器本身抛错（不应发生——默认实现全收敛；注入实现防御）→ 按瞬态处理。
      this._log('warn', 'sillyspec_status_runner_error', {
        cwd,
        error: fmtErrorSnippet(e),
      });
      return;
    }
    // 三态③：超时 / 非零退出 / spawn 其他错误 → 保留上次快照（不清除不上报 null）。
    if (outcome.timedOut) {
      this._log('warn', 'sillyspec_status_collect_timeout', {
        cwd,
        timeout_ms: this._statusTimeoutMs,
      });
      return;
    }
    if (outcome.code === null) {
      if (outcome.errorCode === 'ENOENT') {
        this._markStatusCapabilityMissing('spawn_enoent', { cwd });
        return;
      }
      this._log('warn', 'sillyspec_status_spawn_failed', {
        cwd,
        error_code: outcome.errorCode ?? 'unknown',
      });
      return;
    }
    if (outcome.code !== 0) {
      this._log('warn', 'sillyspec_status_nonzero_exit', {
        cwd,
        exit_code: outcome.code,
      });
      return;
    }
    // 三态①/②分界：exit 0 后 stdout 必须是合法 JSON envelope；非 JSON=旧版本
    // 无 --json（人类可读输出）→ 能力缺失。
    let parsed: unknown;
    try {
      const text = outcome.stdout;
      parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    } catch {
      this._markStatusCapabilityMissing('bad_json', { cwd });
      return;
    }
    const summary = buildSillySpecStatusSummary(parsed);
    this._statusSummary = summary;
    this._statusKnown = true;
    this._log('debug', 'sillyspec_status_collected', {
      cwd,
      active_changes: summary.active_changes,
      ghost_count: summary.ghost_count,
      conflict_count: summary.conflict_count,
    });
  }

  /**
   * 采集状态快照（纯同步零 spawn，_sendHeartbeatOnce 组装用）：
   *   - undefined = 采集未出终分级（未启动/未采集过/无根）→ 心跳不带 sillyspec_status 键；
   *   - null = 能力缺失（三态②）→ 心跳带 null（backend 置 NULL 清除）；
   *   - 摘要对象 = 最近一次成功快照（三态①，或③保留的旧值）。
   */
  getStatusSnapshot(): SillySpecStatusSummary | null | undefined {
    return this._statusKnown ? this._statusSummary : undefined;
  }

  /** 三态②：置能力缺失（快照 null）+ warn 一次同类静默。 */
  private _markStatusCapabilityMissing(
    reason: 'bin_not_found' | 'spawn_enoent' | 'bad_json',
    extra: Record<string, unknown>,
  ): void {
    this._statusSummary = null;
    this._statusKnown = true;
    if (this._statusWarnedClasses.has(reason)) {
      this._log('debug', 'sillyspec_status_capability_missing_repeat', {
        reason,
        ...extra,
      });
      return;
    }
    this._statusWarnedClasses.add(reason);
    this._log('warn', 'sillyspec_status_capability_missing', { reason, ...extra });
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

// ── 2026-09-02-changes-overview-card task-02：采集器默认实现与摘要构造 ──────────

/**
 * 默认采集执行器：node child_process execFile（数组形参，无 shell 依赖，NFR-02；
 * Windows 路径空格安全）。错误映射：err=null → code=0；ExecApiError 的数字 code =
 * 退出码、字符串 code = spawn 错误码（ENOENT 等）；killed=true → 超时被杀。全收敛
 * 不 reject。
 */
function runProgressJsonDefault(
  file: string,
  args: string[],
  options: { cwd: string; timeoutMs: number; maxBufferBytes: number },
): Promise<SillySpecProgressOutcome> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        cwd: options.cwd,
        timeout: options.timeoutMs,
        maxBuffer: options.maxBufferBytes,
        windowsHide: true,
      },
      (err, stdout) => {
        if (err === null) {
          resolve({ code: 0, stdout: String(stdout ?? ''), timedOut: false });
          return;
        }
        const e = err as NodeJS.ErrnoException & { killed?: boolean };
        resolve({
          code: typeof e.code === 'number' ? e.code : null,
          stdout: String(stdout ?? ''),
          timedOut: e.killed === true,
          errorCode: typeof e.code === 'string' ? e.code : undefined,
        });
      },
    );
  });
}

/**
 * 默认 sillyspec bin 解析：SILLYSPEC_BIN env（源码直连联调，design §9）→ npm 全局
 * 布局候选（win32: node 同目录 node_modules【nvm-windows 布局】+ %APPDATA%\npm\
 * node_modules【Node.js 标准安装器布局——npm 全局 prefix 在 APPDATA，node 同目录
 * 布局覆盖不到，不补此候选时已安装环境会被误判能力缺失，ql-20260904-M4】；
 * posix: ../lib/node_modules——npm prefix 布局，覆盖 /usr/local、homebrew、nvm）。
 * 逐个 existsSync，全缺返回 null。
 */
function resolveSillySpecBinDefault(): string | null {
  const candidates: string[] = [];
  const envBin = process.env.SILLYSPEC_BIN;
  if (envBin && envBin.trim()) {
    candidates.push(resolve(envBin.trim()));
  }
  const execDir = dirname(process.execPath);
  if (process.platform === 'win32') {
    candidates.push(
      join(execDir, 'node_modules', 'sillyspec', 'bin', 'sillyspec.js'),
    );
    // ql-20260904-M4（24h 审计）：标准安装器布局——Node.js Windows 安装器的
    // npm 全局 prefix 是 %APPDATA%\npm（nvm-windows 才是 node 同目录）。
    const appData = process.env.APPDATA;
    if (appData && appData.trim()) {
      candidates.push(
        join(appData.trim(), 'npm', 'node_modules', 'sillyspec', 'bin', 'sillyspec.js'),
      );
    }
  } else {
    candidates.push(
      join(execDir, '..', 'lib', 'node_modules', 'sillyspec', 'bin', 'sillyspec.js'),
    );
  }
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/** unknown → Record 收窄守卫。 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** unknown → string（非字符串归 ''）。 */
function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** unknown → 非负整数计数（数组取长度，数字取整数，其余 0）。 */
function asCount(v: unknown): number {
  if (Array.isArray(v)) return v.length;
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
    return Math.floor(v);
  }
  return 0;
}

/**
 * envelope → 心跳摘要（design §4 契约，纯函数导出供 task-04 直测）：
 *   - changes 截断 N=50，每项六字段投影（readable/command 容忍不透传）；
 *   - pending_conflicts 原样三字段投影；conflict_types 按 type 计数；
 *   - active_changes 缺失时回退 changes 全长（截断前）；
 *   - 序化超 32KB 预算 → 降级纯计数模式（changes/pending_conflicts 置空数组，
 *     计数字段全保留——卡片显「列表过大，仅计数」）。
 * 防御式解析：字段缺失/类型不符一律兜底（0/''/空数组），不抛错。
 */
export function buildSillySpecStatusSummary(
  envelope: unknown,
): SillySpecStatusSummary {
  const env = isRecord(envelope) ? envelope : {};
  const data = isRecord(env.data) ? env.data : {};
  const rawChanges = Array.isArray(data.changes) ? data.changes : [];
  const changes: SillySpecStatusChangeItem[] = rawChanges
    .slice(0, SILLYSPEC_STATUS_CHANGES_MAX)
    .map((raw) => {
      const c = isRecord(raw) ? raw : {};
      const steps = isRecord(c.steps) ? c.steps : {};
      return {
        name: asString(c.name),
        ghost: c.ghost === true,
        current_stage: asString(c.current_stage),
        stage_label: asString(c.stage_label),
        last_active: asString(c.last_active),
        steps: {
          total: asCount(steps.total),
          completed: asCount(steps.completed),
        },
      };
    });
  const rawConflicts = Array.isArray(data.pending_conflicts)
    ? data.pending_conflicts
    : [];
  const pending_conflicts: SillySpecStatusPendingConflict[] = rawConflicts.map(
    (raw) => {
      const p = isRecord(raw) ? raw : {};
      return {
        change: asString(p.change),
        created_at: asString(p.created_at),
        type: asString(p.type),
      };
    },
  );
  const conflict_types: Record<string, number> = {};
  for (const c of pending_conflicts) {
    if (c.type) {
      conflict_types[c.type] = (conflict_types[c.type] ?? 0) + 1;
    }
  }
  const ghost_count = changes.filter((c) => c.ghost).length;
  const summary: SillySpecStatusSummary = {
    ok: env.ok === true,
    errors_count: asCount(env.errors),
    warnings_count: asCount(env.warnings),
    generated_at: asString(env.generated_at),
    active_changes: asCount(data.active_changes) || rawChanges.length,
    healthy_count: changes.length - ghost_count,
    ghost_count,
    conflict_count: pending_conflicts.length,
    conflict_types,
    changes,
    pending_conflicts,
  };
  if (
    Buffer.byteLength(JSON.stringify(summary), 'utf8') > SILLYSPEC_STATUS_BUDGET_BYTES
  ) {
    return { ...summary, changes: [], pending_conflicts: [] };
  }
  return summary;
}

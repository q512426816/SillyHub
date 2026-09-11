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
 * 2026-09-04-conflict-resolve-entry task-06 扩展：平台命令执行器与结果槽——
 * runResolve（冲突裁决）/ runGhostCleanup（doctor 清理 + platform sync 收敛）
 * 复用 runProgressJson 执行器形态（execFile 数组形参、windowsHide、全收敛不
 * reject，超时 config 键 sillyspec_command_timeout_sec）；最新一条结果内存槽
 * _lastCommandResult（latest-wins，10min 终态窗惰性过期——语义同 _update/
 * _terminalAt，过期后 getCommandResult 返回 null、心跳键不出现）。
 *
 * 2026-09-07-conflict-diff-compare task-02 扩展：本地冲突快照 conflictSnapshot
 * （change, kind）——只读快照供 backend compare 编排经 sillyspec_conflict_snapshot
 * RPC 实时拉取（D-001@v1 方案A）：spec-tree 逐路径读 .sillyspec 下冲突文件（realpath
 * 落点校验 + 256KB/300 路径/4MB 聚合三道截断护栏 + 二进制嗅探），progress 跑
 * progress show --json 全局 envelope 自行过滤；ql_id best-effort 读 quick 会话
 * guard.json；collectStatusOnce 心跳后处理对 quick-* 冲突条补 ql_id（buildSillySpec
 * StatusSummary 保持纯函数不落 fs）。
 *
 * 状态机（内存态，daemon 重启即回 idle——重启后 preflight 启动检查已保证最新）：
 *
 *   idle ──requestUpgrade（空闲）──▶ running ──成功──▶ success ─┐
 *     │                                │                      ├─10min 展示窗─▶ idle
 *     │ 机器忙（isBusy）                └─失败──▶ failed ───────┘
 *     ▼
 *   deferred ──每 30s 复查：转空闲 ▶ running；仍忙 ▶ 再推迟（定时器单实例不叠）
 *
 *   requestManualUpgrade 已最新（!isOutdated）─▶ up_to_date（终态，同 10min 展示
 *   窗；ql-20260904-019——原静默 no-op 改为横幅明示「已是最新版」）
 *
 *   in-flight 门：running/deferred 期间新 requestUpgrade 仅记日志去重
 *   （CLEANUP 惯例）；终态（success/failed/up_to_date）展示窗内新请求可再次进入升级。
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
 * ql-20260907-001：版本门官方源仲裁。`npm view` 走机器配置的 npm 源（常见为
 * 镜像），镜像滞后时返回旧 latest → 版本门误判「已是最新」拦死升级（实测
 * crrcdt-hubin 滞后 3 天；清 npm 本地缓存无效——旧数据在镜像服务器上）。修复：
 *   - 探测命令一律加 `--prefer-online`（跳过本地 HTTP 缓存新鲜度检查）；
 *   - 版本门（手动/自动入口）在本地源探测外直查官方源（--registry）取较新者；
 *   - 官方较新（或本地源不可达）→ 安装同带 `--registry` 官方源——仍走镜像会装回
 *     旧版；官方安装失败不自动回退镜像（装回旧版报 success 比诚实 failed 更糟）；
 *   - 官方源不可达（内网机器常态）→ 静默回退本地源现行为，仲裁直查不缓存
 *     （每小时一次直查是被设计接受的探测成本）。
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
// 2026-09-07-conflict-diff-compare task-02：冲突快照逐路径 stat/realpath/readFile
//（只读，不写任何文件——RPC 只读快照铁律）。
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
// task-02 同上：冲突快照错误经 RpcError 通道回传（code 语义见 _dispatchRpc）；
// ws-client 不反向依赖本模块，无环。
import { RpcError } from './ws-client.js';
// 2026-09-04-conflict-resolve-entry task-06：平台命令结果槽类型（心跳
// sillyspec_command_result 载荷，task-05 落于 protocol.ts；type-only import，
// protocol 不反向依赖本模块，无环）。
import type { SillySpecCommandResult } from './protocol.js';
// ql-20260907-007：spec-sync 熔断预算 env 缺省值常量（单一源在 spawn-env.ts，
// 与 agent 子进程注入共用；spawn-env 链路仅 config/credential-injector/types，无环）。
import {
  SILLYSPEC_SYNC_TIMEOUT_DEFAULT_MS,
  SILLYSPEC_SYNC_TIMEOUT_MS_FIELD,
} from './spawn-env.js';

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
 * 官方 npm 源地址（ql-20260907-001 版本门仲裁直查用）。镜像滞后时以官方源
 * 为权威信源；官方源不可达的内网机器由仲裁静默回退本地源。
 */
export const SILLYSPEC_OFFICIAL_REGISTRY = 'https://registry.npmjs.org';

/**
 * 心跳 sillyspec_status 载荷自设预算（32KB，design §4 / Grill B2 修订）：心跳 REST
 * 通道无 8KB 级既有限制，自设预算一倍余量；超限降级纯计数模式（丢列表保计数）。
 */
export const SILLYSPEC_STATUS_BUDGET_BYTES = 32 * 1024;

/** 采集 stdout maxBuffer（8MB）：envelope 正常 KB 级，防御 ghost 爆量场景。 */
const SILLYSPEC_STATUS_MAX_BUFFER = 8 * 1024 * 1024;

/**
 * 平台命令（resolve / ghost cleanup 各步）单进程执行超时默认（120s）。design
 * §5 Phase2 第2条 Grill 裁决：keep-local 内置自动重推 sync 有网络往返，比 30s
 * 采集宽，单变更粒度 120s 够用。config 键 sillyspec_command_timeout_sec（默认
 * 120）经 daemon 接线换算毫秒注入覆盖（commandTimeoutMs 依赖）。
 */
export const SILLYSPEC_COMMAND_TIMEOUT_MS = 120 * 1000;

// ── 2026-09-07-conflict-diff-compare task-02：冲突快照截断护栏常量（design §8，集中文件头）──

/**
 * 冲突快照单文件读取上限（256KB，design §8 护栏 1）：超限置 truncated=true 且
 * content 缺省（不部分读取——部分内容会被 backend 误算全 insert 方向失真的 diff）。
 */
export const SILLYSPEC_SNAPSHOT_FILE_MAX_BYTES = 256 * 1024;

/** conflicting_paths 路径数上限（300，design §8 护栏 2）：超出直接截断。 */
export const SILLYSPEC_SNAPSHOT_PATHS_MAX = 300;

/**
 * files 内容聚合预算（4MB，design §8 护栏 3 / Grill B2 修订）：RPC 腿护栏，低于
 * WS 帧默认 16MB 上限一倍余量；超预算路径按信噪比排序（本变更目录优先、archive
 * 沉底）溢出仅元信息（truncated=true 不带 content）。
 */
export const SILLYSPEC_SNAPSHOT_CONTENT_BUDGET_BYTES = 4 * 1024 * 1024;

/**
 * resolve strategy（payload/REST 下划线值域）→ CLI 中划线 flag 单点映射
 * （design §6 resolve 数据流：前端 keep_local → … → daemon 此处单点映射
 * --keep-local → execFile）。daemon.ts 入口已做值域校验，映射不到（运行时
 * 脏值）记 failed 不 spawn——三重防线之一（backend 白名单 + 数组参数不经
 * shell + CLI assertSafeChangeName）。
 */
const RESOLVE_STRATEGY_FLAG: Record<string, string> = {
  keep_local: '--keep-local',
  take_platform: '--take-platform',
};

/**
 * 平台命令身份字段：resolve 携带 change/strategy（回显匹配键，design R-07）；
 * ghost_cleanup 无身份字段（空对象展开为无键）。
 */
type SillySpecCommandIdentify = Pick<SillySpecCommandResult, 'change' | 'strategy'>;

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
  /**
   * stderr 原文（ql-20260910-017-2006 补，可选——既有 DI 假 runner 不带不受
   * 影响）：sillyspec CLI 的用法/错误横幅走 console.error（stderr），能力检测
   * （旧版本「未知命令: scope-audit」）与失败摘要需要它；progress show 链路
   * 不消费（JSON 面恒在 stdout）。
   */
  stderr?: string;
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

/**
 * 三态③采集失败状态（2026-09-08 temp 投毒排障衍生）：心跳 sillyspec_status_error
 * 载荷形状。reason 取值与 collectStatusOnce 的四条③路径一一对应；detail 为短描述
 * （≤200 字符，backend 落库前再截双保险）；since=同 reason 首败时刻 ISO（换
 * reason 重置，①/②清空）。
 */
export interface SillySpecStatusError {
  reason: 'collect_timeout' | 'nonzero_exit' | 'spawn_failed' | 'runner_error';
  detail: string;
  since: string;
}

/**
 * 采集目标（2026-09-08 总览工作区级化）：workspaceId + 主仓根。workspaceId=null
 * =旧单槽位形态（仅喂 legacy sillyspec_status，不进 per-workspace map）。daemon 侧
 * 从 claim 学习映射（落盘 + 上限 LRU），经 statusTargets 回调注入。
 */
export interface SillySpecStatusTarget {
  workspaceId: string | null;
  rootPath: string;
}

/** 摘要 changes[] 单项（envelope 六字段投影，readable/stages 明细不透传）。 */
export interface SillySpecStatusChangeItem {
  name: string;
  ghost: boolean;
  current_stage: string;
  stage_label: string;
  last_active: string;
  steps: { total: number; completed: number };
  /**
   * quick 会话映射到的 QUICKLOG 编号（如 ql-20260910-014-6c29）；普通变更/读
   * 不到为 null 或缺省——collectStatusOnce 后处理对 quick-* 名 best-effort 读
   * guard.json 填充（同 pending_conflicts[].ql_id 的 _attachPendingConflictQlIds
   * 先例，buildSillySpecStatusSummary 纯函数不落 fs）。前端快速修复抽屉据此把
   * ql_id 反查成会话名，代入 scope-audit --change quick-<8hex> 命令。
   */
  ql_id?: string | null;
}

/**
 * 摘要 pending_conflicts[] 单项（change/created_at/type 三字段原样）。
 *
 * 2026-09-07-conflict-diff-compare task-02：加可选 ql_id（quick-* 名 best-effort
 * 读 quick 会话 guard.json 的 quicklogId；非 quick 条/读不到为 null 或缺省——
 * collectStatusOnce 后处理填充，buildSillySpecStatusSummary 纯函数不落 fs）。
 */
export interface SillySpecStatusPendingConflict {
  change: string;
  created_at: string;
  type: string;
  /** quick 会话映射到的 QUICKLOG 编号（如 ql-20260907-006-2972）；无映射 null/缺省。 */
  ql_id?: string | null;
}

// ── 2026-09-07-conflict-diff-compare task-02：sillyspec_conflict_snapshot 契约类型 ──

/**
 * 冲突快照 files[] 单项（design §7.1）。content 仅在可读文本且未被截断护栏命中时
 * 携带：单文件 256KB 帽 / 聚合 4MB 帽 / 二进制（非 utf8）/ 磁盘缺失 / 越界拒读
 * 五种情形均缺省 content。
 */
export interface SillySpecConflictSnapshotFile {
  /** conflicting_paths 原始相对路径（.sillyspec/ 下，POSIX 风格原样透传）。 */
  path: string;
  /** 文件内容（utf8 文本）；truncated/binary/missing/越界拒读时缺省。 */
  content?: string;
  /** 修改时间 ISO 串；读不到 stat（缺失/拒读）为 null。 */
  mtime: string | null;
  /** 原始字节数（未截断值）；拒读为 0（不泄漏根外文件元信息）。 */
  size: number;
  /** true=被单文件 256KB 帽或聚合 4MB 帽截断（content 缺省）。 */
  truncated: boolean;
  /** true=非 utf8 二进制（NUL 或严格解码失败），不带 content。 */
  binary: boolean;
  /** true=清单内有、磁盘上无（realpath/stat ENOENT 等）。 */
  missing: boolean;
}

/**
 * sillyspec_conflict_snapshot RPC result（design §7.1）：
 * kind=spec-tree 时 files 非空、progress=null；kind=progress 时 files=[]、
 * progress=全局 envelope data.changes[] 中该 change 的条目（CLI --json 忽略
 * --change 恒回全局 envelope，daemon 自行过滤）。
 */
export interface SillySpecConflictSnapshot {
  change: string;
  kind: 'spec-tree' | 'progress';
  /** quick-* 名且 guard.json 可读时为其 quicklogId；否则 null。 */
  ql_id: string | null;
  /** 冲突记录 created_at 原样透传。 */
  conflict_created_at: string;
  /** spec-tree=冲突文件 mtime 最大值（无文件回退记录 created_at）；progress=last_active。 */
  local_updated_at: string | null;
  /** 按信噪比排序（changes/<change>/ 优先、changes/archive/ 沉底、其余居中稳定序）。 */
  files: SillySpecConflictSnapshotFile[];
  /** kind=progress 时非空（envelope 条目原样）；其余 null。 */
  progress: Record<string, unknown> | null;
}

// ── ql-20260910-017-2006：sillyspec_file_diff 契约类型（变更中心单文件变化比对）──

/**
 * sillyspec_file_diff RPC result：`scope-audit --change <c> --file <f> --json`
 * stdout 信封的字段投影（camelCase→snake_case 对齐 backend DTO）+ diff 截断
 * 护栏。锚点解析与表格行数同源（工具单一源，daemon 零自研）。
 */
export interface SillySpecFileDiff {
  /** 对账目标（普通变更名或 quick-<8hex> 会话名，原样回显）。 */
  change: string;
  /** 仓库内文件相对路径（POSIX，原样回显）。 */
  file: string;
  /** scope-audit --file 是否成功产出（false 时 note 带原因）。 */
  ok: boolean;
  /** 对账模式：'quick' | 'full-flow'。 */
  mode: string;
  /** 对账同源锚点（commit 短 hash 或 'HEAD'）；缺省 null。 */
  base_ref: string | null;
  /** 锚点人类可读标签（表头同款，如「HEAD 未提交窗口」）；缺省 null。 */
  anchor_label: string | null;
  /** git 原生 unified diff 文本；untracked/无改动时 null 或空串（看 note）。 */
  diff: string | null;
  /** 三态说明：untracked 新文件提示 / 窗口内无改动 / 失败原因。 */
  note: string | null;
  /** diff 超长被截断（256KB 护栏命中）。 */
  truncated: boolean;
}

/** sillyspec_file_diff 的 diff 文本截断护栏（字符口径，防大 diff 撑爆 RPC 载荷）。 */
export const SILLYSPEC_FILE_DIFF_MAX_CHARS = 256 * 1024;

/**
 * 按 UTF-16 code unit 截断并保证不产生孤立代理对（ql-20260911-003-355a P2）：
 * String.slice 恰好切在代理对中间时尾字符是 lone surrogate，backend Python 侧
 * JSON 还原后 ensure_ascii=False 的 UTF-8 编码会抛 UnicodeEncodeError → HTTP 500
 * （CJK diff 边界约半概率）。截在高代理项（U+D800-D7FF 区间首项）时丢弃该项。
 */
export function truncateUtf16Safe(str: string, maxChars: number): string {
  if (str.length <= maxChars) return str;
  const sliced = str.slice(0, maxChars);
  const last = sliced.charCodeAt(sliced.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) {
    return sliced.slice(0, -1);
  }
  return sliced;
}

// ── ql-20260911-001-c0be：sillyspec_scope_audit 契约类型（变更中心结果卡）─────

/** 对账表行数截断护栏（防大仓全表撑爆 RPC 载荷；超限截断置 truncated）。 */
export const SILLYSPEC_AUDIT_ROWS_MAX = 500;

/** 对账表单行：full-flow 带 verdict（planned/unplanned/untouched）+ planned（design
 * 文件清单原话，如「修改」），quick 带 attribution（declared/soft/undeclared）+
 * declared——两组字段互斥（按 mode 取用），行数 additions/deletions 二进制为 null。 */
export interface SillySpecAuditRow {
  path: string;
  additions: number | null;
  deletions: number | null;
  kind: string;
  planned?: string | null;
  verdict?: string | null;
  declared?: boolean | null;
  attribution?: string | null;
}

/** sillyspec_scope_audit RPC result（表模式信封投影 + rows 截断护栏）。 */
export interface SillySpecAuditTable {
  change: string;
  ok: boolean;
  mode: string;
  /** 对账锚点完整 hash（quick 无锚为 null）。 */
  base_ref: string | null;
  /** 锚点短化标签（表头同款 7 位短 hash；quick=HEAD 窗口语义时为 null）。 */
  anchor_label: string | null;
  /** ok=false 时的原因（quick 会话不存在 / 实际侧失败等）。 */
  degraded_reason: string | null;
  totals: { files: number; additions: number | null; deletions: number | null };
  rows: SillySpecAuditRow[];
  /** 他者已声明文件（quick 窗口剔除清单）。 */
  excluded_foreign_declared: string[];
  note: string | null;
  truncated: boolean;
}

// ── 类型（task-05 心跳/注册接线将复用）─────────────────────────────────────────

/** 升级触发来源：server_command（WS 指令）/ auto（定时自动检查）。 */
export type SillySpecUpdateTrigger = 'server_command' | 'auto';

/** 升级状态机阶段（idle 为无状态，不在此联合内——快照以 update 键缺席表达）。 */
export type SillySpecUpdateStatus =
  | 'running'
  | 'deferred'
  | 'success'
  | 'failed'
  | 'up_to_date';

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
  /** npm 最新版（最近一次成功探测/仲裁的缓存值）；null=未知。 */
  latest_version: string | null;
  /** 升级状态；键仅在存在（且未过 10min 展示窗）时携带——缺席=idle/backend 清除。 */
  update?: SillySpecUpdateState;
}

/**
 * 版本门 latest 仲裁结果（ql-20260907-001，见 `_resolveLatestForGate`）。
 */
interface SillySpecLatestGate {
  /** 本地源（机器配置的 npm 源，常见镜像）latest 探测值；null=不可达。 */
  local: string | null;
  /** 官方源 latest 直查值；null=不可达（内网机器常态）。 */
  official: string | null;
  /** 两路取较新者；两路都失败为 null（调用方按探测失败现语义放行/no-op）。 */
  effective: string | null;
  /** 官方严格新于本地源（或本地源不可达）——安装须切官方源。 */
  officialNewer: boolean;
}

/** 构造依赖（runner/isBusy/clock/间隔常量注入供测试；生产由 task-05 接线）。 */
export interface SillySpecManagerDeps {
  /**
   * 探测命令 runner：默认 preflight runCmd（spawn+超时杀树，失败返回 null）。
   * 测试注入假实现避免真实 spawn。
   */
  runCommand?: (cmd: string) => Promise<string | null>;
  /**
   * 安装执行器：默认 preflight installSillySpec（`npm install -g sillyspec@latest`，
   * ql-20260907-001：opts.officialRegistry=true 时同带官方源 --registry——镜像
   * 滞后时仍走镜像会装回旧版）。测试注入假实现；升级执行只经此（不在 manager
   * 内另写 npm spawn）。
   */
  install?: (
    logger: PreflightLogger,
    opts?: { officialRegistry?: boolean },
  ) => Promise<void>;
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
  /**
   * workspace 级根解析器（2026-09-09-conflict-root-workspace-scoping task-01 /
   * FR-02）：按 wsId 查 claim 学习的映射根（daemon 接线为
   * _sillyspecStatusRoots.get(wsId)?.rootPath）。未命中返回 null——由调用方
   * （conflictSnapshot/runResolve）决定报错语义，本解析器**不回退单槽位**
   *（回退等于保留单槽位投毒 bug，D-001@v1）。缺省返回 null（未注入=永远
   * 未命中，带 ws 调用一律 workspace_root_unknown）。
   */
  statusRootFor?: (workspaceId: string) => string | null;
  /**
   * 工作区级采集目标提供者（2026-09-08 总览工作区级化）：daemon 从 claim 学习的
   * wsId→主仓根映射（落盘 + LRU 上限）。返回空数组 = 回退 statusCwd 单槽位旧形态
   *（兼容：映射未建立时 legacy 字段仍出数）。缺省 undefined 同样回退。
   */
  statusTargets?: () => SillySpecStatusTarget[];
  /** 采集超时（毫秒），默认 SILLYSPEC_STATUS_TIMEOUT_MS；测试注入调小。 */
  statusTimeoutMs?: number;
  /**
   * 2026-09-04-conflict-resolve-entry task-06（FR-02/FR-03 / design §5 Phase2
   * 第2条）：平台命令执行超时（毫秒），默认 {@link SILLYSPEC_COMMAND_TIMEOUT_MS}
   * （daemon 接线从 config 键 sillyspec_command_timeout_sec × 1000 注入）。
   * 非有限/非正数回退默认——超时无「关闭」语义，不开 0=禁用口。
   */
  commandTimeoutMs?: number;
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
  private readonly _install: (
    logger: PreflightLogger,
    opts?: { officialRegistry?: boolean },
  ) => Promise<void>;
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
  /**
   * deferred 期间保留的官方源安装 flag（ql-20260907-001）：忙推迟时记下仲裁
   * 结论，30s 复查转 running 时消费——否则镜像滞后场景推迟一轮后装回旧版。
   */
  private _deferredOfficialRegistry = false;

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
  /** workspace 级根解析器（2026-09-09-conflict-root-workspace-scoping task-01）：未注入恒 null。 */
  private readonly _statusRootFor: (workspaceId: string) => string | null;
  /** 工作区级目标提供者（undefined=单槽位旧形态）。 */
  private readonly _statusTargets: (() => SillySpecStatusTarget[]) | undefined;
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
  /**
   * 三态③采集失败状态（2026-09-08 temp 投毒排障衍生）：超时/非零退出/spawn 失败
   * 持续发生时经心跳上报 backend（sillyspec_status_error 列），前端据此把总览
   * 占位区分成「数据源查询失败」而非误显「未安装/版本过低」。since=同 reason
   * 首败时刻（换 reason 重置；①成功/②能力缺失清空——②是终分级非查询失败）。
   * 内存态，进程重启即失（backend register 恒清对齐）。
   */
  private _statusError: SillySpecStatusError | null = null;
  /**
   * 工作区级成功快照（2026-09-08 总览工作区级化）：wsId → 最近一次①成功摘要。
   * 刻意只存成功项——②能力缺失是 CLI 机器级（全目标同灭，清空 map）；③瞬态按
   * 目标独立（该 ws 本拍失败=缺席，保留旧值不清除）。心跳 sillyspec_status_map。
   */
  private readonly _statusSummariesByWs = new Map<string, SillySpecStatusSummary>();

  // ── 2026-09-04-conflict-resolve-entry task-06：平台命令执行器与结果槽 ──────────

  /** 平台命令执行超时毫秒（runResolve/runGhostCleanup 每步 execFile timeout）。 */
  private readonly _commandTimeoutMs: number;
  /**
   * 最新一条平台命令结果（latest-wins，design R-07：连续多条只留最新，页面按
   * 下发时刻+action/change 匹配回显）；null=无结果或终态窗已过（心跳键不出现）。
   */
  private _lastCommandResult: SillySpecCommandResult | null = null;
  /** 结果写入时刻（惰性 10min 过期判定用，与 _update/_terminalAt 同款取舍）；null=槽空。 */
  private _commandResultAt: number | null = null;

  constructor(deps: SillySpecManagerDeps) {
    this._runCommand = deps.runCommand ?? ((cmd: string) => runCmd(cmd));
    this._install =
      deps.install ??
      ((logger: PreflightLogger, opts?: { officialRegistry?: boolean }) =>
        installSillySpec(
          logger,
          opts?.officialRegistry
            ? { registry: SILLYSPEC_OFFICIAL_REGISTRY }
            : undefined,
        ));
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
    this._statusRootFor = deps.statusRootFor ?? (() => null);
    this._statusTargets = deps.statusTargets;
    this._statusTimeoutMs = deps.statusTimeoutMs ?? SILLYSPEC_STATUS_TIMEOUT_MS;
    // task-06：超时无关闭口——undefined/null/非有限/<=0 一律回退默认。
    this._commandTimeoutMs =
      typeof deps.commandTimeoutMs === 'number' &&
      Number.isFinite(deps.commandTimeoutMs) &&
      deps.commandTimeoutMs > 0
        ? deps.commandTimeoutMs
        : SILLYSPEC_COMMAND_TIMEOUT_MS;
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
   * 探测 npm 最新版（`npm view sillyspec version --prefer-online`——跳过本地
   * HTTP 缓存新鲜度检查，ql-20260907-001），成功结果缓存 TTL 10 分钟。
   *
   * 失败（npm 不可达）不缓存——下次调用即重试（调用频率为小时级循环/手动触发，
   * 无重试风暴风险）；缓存过期后旧值仅作 getSnapshot 兜底展示，探到新值即覆盖。
   *
   * @param force true=跳过缓存读强制现探（手动升级触发用——刚发布的版本不该被
   *   10min 旧缓存拦住）；成功仍写缓存，快照随之刷新。
   */
  async probeLatest(force: boolean = false): Promise<string | null> {
    const cached = this._latestCache;
    if (
      !force &&
      cached !== null &&
      this._now() - cached.at < this._latestCacheTtlMs
    ) {
      return cached.value;
    }
    const out = await this._runCommand('npm view sillyspec version --prefer-online');
    if (out === null || out.trim() === '') {
      this._log('warn', 'sillyspec_latest_probe_failed');
      return null;
    }
    const latest = out.trim();
    this._latestCache = { value: latest, at: this._now() };
    return latest;
  }

  /**
   * 直查官方 npm 源最新版（ql-20260907-001 版本门仲裁信源）：
   * `npm view sillyspec version --registry=<官方源> --prefer-online`。
   *
   * 机器配置的 npm 源（常见镜像）滞后时返回旧 latest，本方法绕过它直连官方源。
   * 失败（官方源不可达——内网机器常态）返回 null，调用方静默回退本地源结果；
   * 结果不缓存（每次仲裁现查，探测成本被小时级/手动触发频率接受）。
   */
  async probeLatestOfficial(): Promise<string | null> {
    const out = await this._runCommand(
      `npm view sillyspec version --registry=${SILLYSPEC_OFFICIAL_REGISTRY} --prefer-online`,
    );
    if (out === null || out.trim() === '') {
      this._log('debug', 'sillyspec_official_probe_failed');
      return null;
    }
    return out.trim();
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
    // 2026-09-08 总览工作区级化：优先多目标（wsId→root 映射），逐目标采集；
    // 映射未建立（空/未注入）回退 statusCwd 单槽位旧形态（legacy 字段语义不变）。
    const targets = this._statusTargets?.() ?? [];
    if (targets.length > 0) {
      // ql-20260910-002：_statusError 是机器级单槽位，多目标下「后位成功清掉
      // 前位失败」会掩蔽持续失败的工作区（心跳 sillyspec_status_error 恒 null、
      // map 携带陈旧摘要）——改为轮内聚合：任一目标③失败即保留失败账，整轮
      // 全成功才清（恢复语义不变：失败目标下一轮成功即参与全成功清空）。
      let anyFailed = false;
      for (const t of targets) {
        const ok = await this._collectOneTarget(t.workspaceId, t.rootPath);
        anyFailed = anyFailed || !ok;
      }
      if (!anyFailed) {
        // 三态①成功：清失败状态（心跳 sillyspec_status_error 置 null，backend 清除）。
        this._statusError = null;
      }
      // ql-20260909-002：目标集裁剪——daemon 侧 wsId→root 映射有 LRU 上限，被淘汰
      // 的 wsId 不再是采集目标，其摘要若滞留会随心跳 sillyspec_status_map 整包直发
      //（淘汰工作区永久脏数据 + map 随历史 ws 数无界增长）。本拍移除目标集之外的
      // 槽位；仍在目标集内的 ws ③失败缺席仍保留旧值（既有语义不变）。
      const live = new Set(
        targets
          .map((t) => t.workspaceId)
          .filter((id): id is string => id !== null),
      );
      for (const wsId of this._statusSummariesByWs.keys()) {
        if (!live.has(wsId)) this._statusSummariesByWs.delete(wsId);
      }
      return;
    }
    const cwd = this._statusCwd();
    if (!cwd) {
      this._log('debug', 'sillyspec_status_skip_no_root');
      return;
    }
    // legacy 单槽位形态：①成功清失败（原 _collectOneTarget 内联语义不变）。
    if (await this._collectOneTarget(null, cwd)) {
      this._statusError = null;
    }
  }

  /** 单目标采集（原 collectStatusOnce 主体，参数化 workspaceId + cwd）。
   *
   * 返回 false = 本目标记了一笔③瞬态失败（_recordStatusError 已落账）；true =
   * ①成功或②能力缺失（②机器级终分级，自身已清失败状态与 map）。①成功的
   * 失败状态清理由调用方按「整轮无③失败」聚合执行（见方法尾注）。 */
  private async _collectOneTarget(
    workspaceId: string | null,
    cwd: string,
  ): Promise<boolean> {
    const bin = this._resolveSillySpecBin();
    if (bin === null) {
      this._markStatusCapabilityMissing('bin_not_found', { cwd });
      return true;
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
      this._recordStatusError('runner_error', `error=${fmtErrorSnippet(e)}`);
      return false;
    }
    // 三态③：超时 / 非零退出 / spawn 其他错误 → 保留上次快照（不清除不上报 null），
    // 但失败状态经 sillyspec_status_error 上报（2026-09-08：区分「数据源查询失败」
    // 与「未安装/版本过低」——持续③叠加从未①成功时旧 UI 误显后者）。
    if (outcome.timedOut) {
      this._log('warn', 'sillyspec_status_collect_timeout', {
        cwd,
        timeout_ms: this._statusTimeoutMs,
      });
      this._recordStatusError('collect_timeout', `timeout_ms=${this._statusTimeoutMs}`);
      return false;
    }
    if (outcome.code === null) {
      if (outcome.errorCode === 'ENOENT') {
        this._markStatusCapabilityMissing('spawn_enoent', { cwd });
        return true;
      }
      this._log('warn', 'sillyspec_status_spawn_failed', {
        cwd,
        error_code: outcome.errorCode ?? 'unknown',
      });
      this._recordStatusError(
        'spawn_failed',
        `error_code=${outcome.errorCode ?? 'unknown'}`,
      );
      return false;
    }
    if (outcome.code !== 0) {
      this._log('warn', 'sillyspec_status_nonzero_exit', {
        cwd,
        exit_code: outcome.code,
      });
      this._recordStatusError('nonzero_exit', `exit_code=${outcome.code}`);
      return false;
    }
    // 三态①/②分界：exit 0 后 stdout 必须是合法 JSON envelope；非 JSON=旧版本
    // 无 --json（人类可读输出）→ 能力缺失。
    let parsed: unknown;
    try {
      const text = outcome.stdout;
      parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    } catch {
      this._markStatusCapabilityMissing('bad_json', { cwd });
      return true;
    }
    const summary = buildSillySpecStatusSummary(parsed);
    // 2026-09-07-conflict-diff-compare task-02：心跳补报——buildSillySpecStatusSummary
    // 是纯函数不落 fs，ql_id 在此处后处理填充（quick-* 名读 guard.json，单条失败仅
    // 缺省该条不阻断心跳，design §5 Phase 1 第 3 条）。
    await this._attachPendingConflictQlIds(cwd, summary);
    // ql-20260910-014-6c29：changes[] 同款补报（quick-* 名读 guard.json）——前端
    // 快速修复抽屉按 ql_id 反查会话名，代入 scope-audit 命令（变更中心展示）。
    await this._attachChangeQlIds(cwd, summary);
    this._statusSummary = summary;
    this._statusKnown = true;
    // 工作区级化：具名目标成功 → 该 ws 的 map 槽位更新（③失败缺席保留旧值）。
    if (workspaceId !== null) {
      this._statusSummariesByWs.set(workspaceId, summary);
    }
    // 三态①成功的失败状态清理由调用方 collectStatusOnce 轮内聚合（ql-20260910-002：
    // _statusError 是机器级单槽位，此处直接清会被同轮后位目标的③失败→前位失败
    // 掩蔽反序（后位成功清掉前位失败）——单槽位只在整轮无③失败时才清）。
    this._log('debug', 'sillyspec_status_collected', {
      cwd,
      workspace_id: workspaceId ?? undefined,
      active_changes: summary.active_changes,
      ghost_count: summary.ghost_count,
      conflict_count: summary.conflict_count,
    });
    return true;
  }

  /**
   * 采集失败状态（纯同步零 spawn，_sendHeartbeatOnce 组装用）：null=无失败
   * （①成功/②能力缺失/未采集），对象=三态③持续失败中（latest-wins 每跳携带，
   * backend 非破坏直写）。
   */
  getStatusError(): SillySpecStatusError | null {
    return this._statusError;
  }

  /**
   * 三态③失败记账（2026-09-08 temp 投毒排障衍生）：同 reason 持续失败保留首败
   * since（防退化成最后心跳时间）、刷新 detail；换 reason 重置 since（新失败
   * 事件）；detail 截 200（backend 落库前再截双保险）。
   */
  private _recordStatusError(
    reason: SillySpecStatusError['reason'],
    detail: string,
  ): void {
    const capped = detail.slice(0, 200);
    this._statusError = {
      reason,
      detail: capped,
      since:
        this._statusError?.reason === reason
          ? this._statusError.since
          : new Date(this._now()).toISOString(),
    };
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

  /**
   * 工作区级 map 快照（2026-09-08 总览工作区级化，心跳 sillyspec_status_map）：
   * undefined = 未启用工作区级采集（statusTargets 未注入/映射空）→ 键不出现
   * （backend 保留旧值，旧 daemon 兼容）；对象 = 已启用（含空对象=启用但全失败/
   * 未成功过，空对象照发清 backend）。值仅含成功项（③缺席=保留旧值在 daemon 内存，
   * ②清空——见 _statusSummariesByWs 注释）。
   */
  getStatusMapSnapshot(): Record<string, SillySpecStatusSummary> | undefined {
    return this._statusTargets ? Object.fromEntries(this._statusSummariesByWs) : undefined;
  }

  /** 三态②：置能力缺失（快照 null）+ warn 一次同类静默。 */
  private _markStatusCapabilityMissing(
    reason: 'bin_not_found' | 'spawn_enoent' | 'bad_json',
    extra: Record<string, unknown>,
  ): void {
    this._statusSummary = null;
    this._statusKnown = true;
    // 三态②能力缺失是终分级（非查询失败）：清失败状态，前端走「未安装/版本过低」
    // 占位而非「数据源查询失败」。②是 CLI 机器级（bin 缺失/旧版无 --json 对所有
    // 目标同灭）——工作区级 map 一并清空（2026-09-08 工作区级化）。
    this._statusError = null;
    this._statusSummariesByWs.clear();
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

  // ── 2026-09-04-conflict-resolve-entry task-06：平台命令执行器与结果槽 ──────────

  /**
   * 执行冲突裁决（FR-02 / design §5 Phase2 第2条）：`sillyspec platform resolve
   * --change <名> --keep-local|--take-platform`。
   *
   * - strategy→flag 单点映射（RESOLVE_STRATEGY_FLAG）；映射不到（运行时脏值）记
   *   failed 不 spawn（daemon.ts 入口已校验值域，此处防御兜底）；
   * - cwd 用 statusCwd 回调根（claim 观察到的 workspace 主仓根，规则 22 禁
   *   worktree），无根直接记 failed 不 spawn；bin 解析失败同记 failed；
   * - 执行复用 runProgressJson 形态（execFile 数组形参、windowsHide、数组参数
   *   不经 shell，NFR 兼容三平台），超时=commandTimeoutMs；
   * - 终判全收敛不 reject：timedOut / 退出码 null（spawn 失败）/ 非零 → failed
   *   （error 截 ≤200 字符），exit 0 → success；结果写 _lastCommandResult 槽。
   *
   * 忙拒（命令 in-flight / 升级链在跑）归 daemon.ts _runSillySpecCommand 前置
   * guard（两臂判定），本方法不做忙判定——调用到达即视为已过串行保护。
   */
  async runResolve(
    change: string,
    strategy: 'keep_local' | 'take_platform',
    workspaceId?: string,
  ): Promise<void> {
    const identify: SillySpecCommandIdentify = { change, strategy };
    this._log('info', 'sillyspec_resolve_started', { change, strategy, workspace_id: workspaceId ?? null });
    try {
      const flag = RESOLVE_STRATEGY_FLAG[strategy as string];
      if (flag === undefined) {
        this.recordCommandResult({
          action: 'resolve',
          ...identify,
          state: 'failed',
          error: `未知的裁决策略（${String(strategy)}），合法值 keep_local / take_platform`,
        });
        return;
      }
      const pre = this._requireCommandPrecondition('resolve', identify, workspaceId);
      if (pre === null) return;
      const outcome = await this._execSillySpecCli(
        pre.bin,
        ['platform', 'resolve', '--change', change, flag],
        pre.cwd,
      );
      this._recordCommandOutcome('resolve', identify, outcome);
    } catch (e) {
      this._recordCommandExecutorError('resolve', identify, e);
    }
  }

  /**
   * 执行 ghost 清理（FR-03 / design §5 Phase2 第2条）：先 `doctor
   * --cleanup-ghosts --confirm`（本地 DB 幽灵行翻 archived + 超 7 天空壳归档），
   * 成功后再 `platform sync`（上行终态 + 墓碑，平台侧收敛——闭环依据 sync.js
   * X1 墓碑链，X-05 修订）。任一步超时/非零/spawn 失败 → 记 failed 终止，不
   * 继续后续步。cwd/超时/收敛语义同 runResolve（每步独立计超时——doctor 为纯
   * 本地 DB 操作秒级，正常路径总耗远低于前端 150s 恢复窗）。
   */
  async runGhostCleanup(): Promise<void> {
    const identify: SillySpecCommandIdentify = {};
    this._log('info', 'sillyspec_ghost_cleanup_started', {});
    try {
      const pre = this._requireCommandPrecondition('ghost_cleanup', identify);
      if (pre === null) return;
      const doctor = await this._execSillySpecCli(
        pre.bin,
        ['doctor', '--cleanup-ghosts', '--confirm'],
        pre.cwd,
      );
      if (!isSuccessOutcome(doctor)) {
        this._recordCommandOutcome('ghost_cleanup', identify, doctor);
        return;
      }
      const sync = await this._execSillySpecCli(pre.bin, ['platform', 'sync'], pre.cwd);
      this._recordCommandOutcome('ghost_cleanup', identify, sync);
    } catch (e) {
      this._recordCommandExecutorError('ghost_cleanup', identify, e);
    }
  }

  /**
   * npm 升级链在跑判定（running/deferred → true）——daemon 忙拒第二臂
   * （design §5 Phase2 第4条：命令执行与升级链共用同一 in-flight 判定，
   * 升级进行中到达的命令同样记 failed busy，不排队）。
   */
  isUpgradeInFlight(): boolean {
    const current = this._update;
    return (
      current !== null &&
      (current.state === 'running' || current.state === 'deferred')
    );
  }

  /**
   * 写命令结果内存槽（latest-wins：新结果覆盖旧并重开 10min 终态窗，design
   * R-07）。规范化单点：error 截断 ≤200 字符（协议契约）、executed_at 缺省补
   * 机器本地钟 ISO 串（与 daemon.ts 忙拒戳记同款 new Date().toISOString()）。
   * 调用方：daemon.ts 忙拒路径（task-05）+ 本模块执行器终判（task-06）。
   */
  recordCommandResult(result: SillySpecCommandResult): void {
    const normalized: SillySpecCommandResult = { ...result };
    if (normalized.error !== undefined) {
      normalized.error = truncateToMaxChars(normalized.error, SILLYSPEC_ERROR_MAX_CHARS);
    }
    if (normalized.executed_at == null) {
      normalized.executed_at = new Date().toISOString();
    }
    this._lastCommandResult = normalized;
    this._commandResultAt = this._now();
    this._log(
      normalized.state === 'failed' ? 'warn' : 'info',
      `sillyspec_command_${normalized.state ?? 'recorded'}`,
      { ...normalized },
    );
  }

  /**
   * 读最新一条命令结果（daemon._sendHeartbeatOnce 组装 sillyspec_command_result
   * 用，纯同步零 spawn）：null = 无结果或终态窗已过 → 心跳不携带键（backend 置
   * NULL 清除，两态语义 D-004@v1——daemon 无需也不得发送显式 null）。返回浅
   * 拷贝，调用方改写不影响槽内值。
   */
  getCommandResult(): SillySpecCommandResult | null {
    this._expireCommandResultIfDue();
    return this._lastCommandResult === null ? null : { ...this._lastCommandResult };
  }

  /**
   * 惰性终态过期（取舍同 _expireTerminalIfDue：常驻进程不为清内存标志排专门
   * 定时器，仅在 get 口判定）：超窗清槽——下次 getCommandResult 返回 null，
   * 心跳键随之不出现（backend 侧置 NULL 清除）。
   */
  private _expireCommandResultIfDue(): void {
    if (this._lastCommandResult === null || this._commandResultAt === null) {
      return;
    }
    if (this._now() - this._commandResultAt >= this._terminalWindowMs) {
      this._lastCommandResult = null;
      this._commandResultAt = null;
      this._log('debug', 'sillyspec_command_result_window_expired');
    }
  }

  /**
   * 根解析统一入口（2026-09-09-conflict-root-workspace-scoping task-01 /
   * FR-02/FR-03）：workspaceId 非空 → statusRootFor 查映射（null=未命中，
   * **不回退单槽位**——回退等于保留单槽位投毒 bug）；空/undefined →
   * _statusCwd() 单槽位（legacy 语义不变，含 ghost_cleanup 无 ws 路径）。
   */
  private _resolveWorkspaceRoot(workspaceId?: string): string | null {
    if (workspaceId) {
      return this._statusRootFor(workspaceId);
    }
    return this._statusCwd();
  }

  /**
   * 执行前置校验：cwd（statusCwd 回调根）与 sillyspec bin 双就绪才返回
   * {cwd, bin}；任一缺失记 failed（不 spawn——无根/无 CLI 时起进程必错，还
   * 浪费超时窗）并返回 null。change 名不再重复校验：daemon.ts 入口已验非空、
   * backend 白名单 + CLI assertSafeChangeName 双保险，数组形参不经 shell。
   */
  private _requireCommandPrecondition(
    action: 'resolve' | 'ghost_cleanup',
    identify: SillySpecCommandIdentify,
    workspaceId?: string,
  ): { cwd: string; bin: string } | null {
    const cwd = this._resolveWorkspaceRoot(workspaceId);
    if (!cwd) {
      // 2026-09-09-conflict-root-workspace-scoping task-01（FR-02/FR-03 两态）：带
      // ws 且映射未命中 → 「尚未认领」文案（不回退单槽位，不 spawn——错根下执行
      // 写命令正是本 bug 的危害模式）；不带 ws（legacy，含 ghost_cleanup）→
      // 既有「未观察到主仓根」语义不变。
      this.recordCommandResult({
        action,
        ...identify,
        state: 'failed',
        error: workspaceId
          ? '该工作区尚未被本机会话认领，无法执行 sillyspec 命令'
          : '未观察到 workspace 主仓根，无法执行 sillyspec 命令',
      });
      return null;
    }
    const bin = this._resolveSillySpecBin();
    if (bin === null) {
      this.recordCommandResult({
        action,
        ...identify,
        state: 'failed',
        error: '未找到 sillyspec CLI（bin 解析失败），请先安装 sillyspec',
      });
      return null;
    }
    return { cwd, bin };
  }

  /**
   * 单步 CLI 执行：node <sillyspec-bin> <args...>（execFile 数组形参，windowsHide
   * + 超时杀进程，maxBuffer 同采集器）。默认实现全收敛不 reject；此处 try/catch
   * 防御注入实现的异常 → 合成 spawn 失败形态（errorCode='runner_error'）交终判。
   */
  private async _execSillySpecCli(
    bin: string,
    args: string[],
    cwd: string,
  ): Promise<SillySpecProgressOutcome> {
    try {
      return await this._runProgressJson(process.execPath, [bin, ...args], {
        cwd,
        timeoutMs: this._commandTimeoutMs,
        maxBufferBytes: SILLYSPEC_STATUS_MAX_BUFFER,
      });
    } catch (e) {
      this._log('warn', 'sillyspec_command_runner_error', {
        args: args.join(' '),
        error: fmtErrorSnippet(e),
      });
      return { code: null, stdout: '', timedOut: false, errorCode: 'runner_error' };
    }
  }

  /**
   * 终判 outcome → 结果槽（全收敛不 reject）：
   * timedOut → failed（超时文案）；code null → failed（spawn 失败，exit_code
   * 缺省——协议「取不到时缺省」）；非零 → failed（带 exit_code + 输出尾段
   * 摘要）；0 → success（exit_code=0）。
   */
  private _recordCommandOutcome(
    action: 'resolve' | 'ghost_cleanup',
    identify: SillySpecCommandIdentify,
    outcome: SillySpecProgressOutcome,
  ): void {
    if (outcome.timedOut) {
      this.recordCommandResult({
        action,
        ...identify,
        state: 'failed',
        error: `执行超时（${Math.round(this._commandTimeoutMs / 1000)}s）被终止`,
      });
      return;
    }
    if (outcome.code === null) {
      this.recordCommandResult({
        action,
        ...identify,
        state: 'failed',
        error: `进程启动失败（${outcome.errorCode ?? 'unknown'}）`,
      });
      return;
    }
    if (outcome.code !== 0) {
      this.recordCommandResult({
        action,
        ...identify,
        state: 'failed',
        exit_code: outcome.code,
        error: `执行失败（exit ${outcome.code}）${cliOutputSnippet(outcome.stdout)}`,
      });
      return;
    }
    this.recordCommandResult({ action, ...identify, state: 'success', exit_code: 0 });
  }

  /** 执行器意外异常防御（约定不 reject，此处兜底记 failed 不上抛）。 */
  private _recordCommandExecutorError(
    action: 'resolve' | 'ghost_cleanup',
    identify: SillySpecCommandIdentify,
    e: unknown,
  ): void {
    this.recordCommandResult({
      action,
      ...identify,
      state: 'failed',
      error: `执行器异常：${fmtErrorSnippet(e)}`,
    });
  }

  // ── 2026-09-07-conflict-diff-compare task-02：本地冲突快照（只读，RPC 实时拉取）──

  /**
   * 生成本地冲突快照（design §5 Phase 1 第 1 条 / §7.1 契约，D-001@v1 方案A）：
   * backend compare 编排经 sillyspec_conflict_snapshot RPC 实时拉取，本方法只读
   * 不写任何文件、不进状态机。
   *
   * - spec 根复用 _statusCwd 回调（claim 观察到的 workspace 主仓根，runResolve
   *   同款）；无根抛 RpcError('no_spec_root')；
   * - kind=spec-tree：读 .sillyspec/.runtime/spec-sync-conflict-<change>.json 取
   *   conflicting_paths，逐路径读 .sillyspec/<path>（realpath 落点必须在根内——
   *   file-rpc explorer 系同款校验双保险；单文件 256KB / 路径 300 / 聚合 4MB
   *   三道截断护栏 + 非 utf8 二进制嗅探）；local_updated_at=冲突文件 mtime 最大值
   *   （无文件回退记录 created_at）；
   * - kind=progress：读 .runtime/sync-conflict-<change>.json 后跑 progress show
   *   --json（CLI --json 忽略 --change 恒回全局 envelope，daemon 自行从
   *   data.changes[] 过滤该 change 条目）；local_updated_at=条目 last_active；
   * - ql_id：quick-* 名 best-effort 读 .runtime/quick-sessions/<change>/guard.json
   *   的 quicklogId，读不到/非 quick 为 null。
   *
   * @throws {RpcError} no_spec_root（无已知主仓根）/ invalid_params（kind 值域外
   *   或 change 空）/ conflict_record_missing|conflict_record_corrupt（记录缺失或
   *   JSON 损坏）/ progress_collect_failed（progress 分支采集失败）。
   */
  async conflictSnapshot(
    change: string,
    kind: string,
    workspaceId?: string,
  ): Promise<SillySpecConflictSnapshot> {
    const root = this._resolveWorkspaceRoot(workspaceId);
    if (!root) {
      // 2026-09-09-conflict-root-workspace-scoping task-01（FR-02/FR-03 两态）：带
      // ws 且映射未命中 → workspace_root_unknown（不回退单槽位，D-001@v1）；不带
      // ws（legacy）→ 既有 no_spec_root 语义不变。
      throw new RpcError(
        workspaceId ? 'workspace_root_unknown' : 'no_spec_root',
        workspaceId
          ? '该工作区尚未被本机会话认领，请先在该工作区发起一次会话'
          : '未观察到 workspace 主仓根，无法生成冲突快照',
      );
    }
    if (typeof change !== 'string' || change === '') {
      throw new RpcError('invalid_params', 'change 名为空，无法生成冲突快照');
    }
    if (kind !== 'spec-tree' && kind !== 'progress') {
      throw new RpcError(
        'invalid_params',
        `未知的冲突类型 kind=${kind}，合法值 spec-tree / progress`,
      );
    }
    const record = await readSillySpecConflictRecord(root, change, kind);
    const qlId = await readQuickSessionQuicklogId(root, change);
    if (kind === 'progress') {
      return this._conflictSnapshotProgress(root, change, qlId, record);
    }
    return this._conflictSnapshotSpecTree(root, change, qlId, record);
  }

  /**
   * spec-tree 快照分支：conflicting_paths 截 300 → 信噪比排序（changes/<change>/
   * 优先、archive 沉底）→ 并行逐路径 stat/readFile（realpath 落点校验逐路径粒度
   * 拒读，不连坐）→ 聚合 4MB 帽按排序顺序收内容，溢出仅元信息。
   */
  private async _conflictSnapshotSpecTree(
    root: string,
    change: string,
    qlId: string | null,
    record: Record<string, unknown>,
  ): Promise<SillySpecConflictSnapshot> {
    const createdAt = asString(record.created_at);
    const rawPaths = Array.isArray(record.conflicting_paths)
      ? record.conflicting_paths
      : [];
    const paths = rawPaths
      .filter((p): p is string => typeof p === 'string')
      .slice(0, SILLYSPEC_SNAPSHOT_PATHS_MAX)
      .sort(
        (a, b) =>
          specPathSignalRank(a, change) - specPathSignalRank(b, change),
      );
    const specDir = join(root, '.sillyspec');
    let realRoot: string;
    try {
      realRoot = await realpath(root);
    } catch (e) {
      throw new RpcError(
        'no_spec_root',
        `workspace 主仓根不可达：${fmtErrorSnippet(e)}`,
      );
    }
    const works = await Promise.all(
      paths.map((rel) => snapshotOneSpecPath(realRoot, specDir, rel)),
    );
    // 聚合帽按排序顺序收内容（先到先得——高信噪比路径优先占预算）。
    const files: SillySpecConflictSnapshotFile[] = [];
    let usedBytes = 0;
    let maxMtimeMs: number | null = null;
    for (const w of works) {
      if (w.mtimeMs !== null) {
        maxMtimeMs = maxMtimeMs === null ? w.mtimeMs : Math.max(maxMtimeMs, w.mtimeMs);
      }
      if (w.content !== undefined) {
        const bytes = Buffer.byteLength(w.content, 'utf8');
        if (usedBytes + bytes > SILLYSPEC_SNAPSHOT_CONTENT_BUDGET_BYTES) {
          w.entry.truncated = true; // 聚合 4MB 帽：溢出路径仅元信息
        } else {
          w.entry.content = w.content;
          usedBytes += bytes;
        }
      }
      files.push(w.entry);
    }
    return {
      change,
      kind: 'spec-tree',
      ql_id: qlId,
      conflict_created_at: createdAt,
      local_updated_at:
        maxMtimeMs !== null ? new Date(maxMtimeMs).toISOString() : createdAt,
      files,
      progress: null,
    };
  }

  /**
   * progress 快照分支：CLI progress show --json 的 --json 分支忽略 --change、恒回
   * 全局 envelope（外部 CLI 实测行为），故只跑一次全局采集（runProgressJsonDefault
   * 形态：execFile 数组形参、cwd=spec 根、windowsHide），daemon 自行从
   * data.changes[] 过滤该 change 条目；过滤不到回 progress=null（local_updated_at
   * 同步为 null，不伪造时间）。
   */
  private async _conflictSnapshotProgress(
    root: string,
    change: string,
    qlId: string | null,
    record: Record<string, unknown>,
  ): Promise<SillySpecConflictSnapshot> {
    const bin = this._resolveSillySpecBin();
    if (bin === null) {
      throw new RpcError(
        'bin_not_found',
        '未找到 sillyspec CLI（bin 解析失败），无法采集进度快照',
      );
    }
    let outcome: SillySpecProgressOutcome;
    try {
      outcome = await this._runProgressJson(
        process.execPath,
        [bin, 'progress', 'show', '--json'],
        {
          cwd: root,
          timeoutMs: this._statusTimeoutMs,
          maxBufferBytes: SILLYSPEC_STATUS_MAX_BUFFER,
        },
      );
    } catch (e) {
      throw new RpcError(
        'progress_collect_failed',
        `progress show --json 执行器异常：${fmtErrorSnippet(e)}`,
      );
    }
    if (outcome.timedOut || outcome.code === null || outcome.code !== 0) {
      throw new RpcError(
        'progress_collect_failed',
        `progress show --json 采集失败（${
          outcome.timedOut ? '超时被终止' : `exit ${String(outcome.code)}`
        }）`,
      );
    }
    let envelope: unknown;
    try {
      const text = outcome.stdout;
      envelope = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    } catch {
      throw new RpcError(
        'progress_collect_failed',
        'progress show --json 输出非合法 JSON envelope',
      );
    }
    const env = isRecord(envelope) ? envelope : {};
    const data = isRecord(env.data) ? env.data : {};
    const changes = Array.isArray(data.changes) ? data.changes : [];
    const target = changes.find(
      (c) => isRecord(c) && asString(c.name) === change,
    );
    const progress = isRecord(target) ? target : null;
    const lastActive =
      progress !== null ? asString(progress.last_active) : '';
    return {
      change,
      kind: 'progress',
      ql_id: qlId,
      conflict_created_at: asString(record.created_at),
      local_updated_at: progress !== null && lastActive !== '' ? lastActive : null,
      files: [],
      progress,
    };
  }

  /**
   * 单文件变化比对（ql-20260910-017-2006，变更中心点击文件看 diff）：spawn 本机
   * sillyspec CLI 跑 `scope-audit --change <c> --file <f> --json`——锚点解析与
   * 表格行数同源（quick=HEAD 未提交窗口 / 归档=快照基点 / 活跃=worktree 或
   * post-apply 锚），daemon 不自研任何锚点/git 逻辑（D-003 同源）。只读不写。
   *
   * 能力门（旧 sillyspec 无 scope-audit 子命令）：exit 非零且 stdout+stderr 含
   * 「未知命令 / unknown command」→ RpcError('sillyspec_capability_missing')
   * （前端出升级提示）；其余非零 / stdout 非 JSON → RpcError('scope_audit_failed')
   * 带 exit code 与输出尾段摘要。diff 超 256KB 截断置 truncated（信封其余字段
   * 原样透传）。
   *
   * @throws {RpcError} invalid_params（change/file 空）/ no_spec_root（无已知根）/
   *   sillyspec_bin_missing（bin 解析失败）/ scope_audit_timeout（执行超时）/
   *   sillyspec_capability_missing（旧 sillyspec 无 scope-audit）/ scope_audit_failed。
   */
  async fileDiff(
    change: string,
    filePath: string,
    workspaceId?: string,
  ): Promise<SillySpecFileDiff> {
    if (!change || !filePath) {
      throw new RpcError('invalid_params', 'change 与 file 均必填（非空字符串）');
    }
    const root = this._resolveWorkspaceRoot(workspaceId);
    if (!root) {
      throw new RpcError('no_spec_root', workspaceId
        ? '该工作区尚未被本机认领，请先在该工作区发起一次会话后重试'
        : '未观察到 workspace 主仓根，无法执行 sillyspec 命令');
    }
    const bin = this._resolveSillySpecBin();
    if (bin === null) {
      throw new RpcError('sillyspec_bin_missing', '未找到 sillyspec CLI（bin 解析失败），请先安装 sillyspec');
    }
    const parsed = await this._runScopeAuditJson(
      bin,
      ['--change', change, '--file', filePath, '--json'],
      root,
    );
    const asStr = (v: unknown): string | null =>
      typeof v === 'string' && v !== '' ? v : null;
    const rawDiff = typeof parsed.diff === 'string' ? parsed.diff : null;
    const truncated = rawDiff !== null && rawDiff.length > SILLYSPEC_FILE_DIFF_MAX_CHARS;
    return {
      change: typeof parsed.change === 'string' ? parsed.change : change,
      file: typeof parsed.file === 'string' ? parsed.file : filePath,
      ok: parsed.ok,
      mode: asStr(parsed.mode) ?? 'full-flow',
      base_ref: asStr(parsed.baseRef),
      anchor_label: asStr(parsed.anchorLabel),
      diff: truncated
        ? truncateUtf16Safe(rawDiff!, SILLYSPEC_FILE_DIFF_MAX_CHARS)
        : rawDiff,
      note: asStr(parsed.note),
      truncated,
    };
  }

  /**
   * 对账表（ql-20260911-001-c0be，变更中心结果卡数据源）：spawn 本机 sillyspec
   * CLI 跑 `scope-audit --change <c> --json` 表模式——三态全表（full-flow：
   * verdict 计划内/计划外/计划未动；quick：attribution 已声明/软归属/未声明）
   * + 行数，锚点与 --file 同源。锚点短化（表头同款 7 位短 hash）；rows 超
   * 护栏截断置 truncated（totals 仍为工具原值，截断信息见 truncated）。
   *
   * @throws {RpcError} invalid_params / no_spec_root / sillyspec_bin_missing /
   *   scope_audit_timeout / sillyspec_capability_missing / scope_audit_failed
   *   （同 fileDiff，经 _runScopeAuditJson 共享执行器）。
   */
  async auditTable(
    change: string,
    workspaceId?: string,
  ): Promise<SillySpecAuditTable> {
    if (!change) {
      throw new RpcError('invalid_params', 'change 必填（非空字符串）');
    }
    const root = this._resolveWorkspaceRoot(workspaceId);
    if (!root) {
      throw new RpcError('no_spec_root', workspaceId
        ? '该工作区尚未被本机认领，请先在该工作区发起一次会话后重试'
        : '未观察到 workspace 主仓根，无法执行 sillyspec 命令');
    }
    const bin = this._resolveSillySpecBin();
    if (bin === null) {
      throw new RpcError('sillyspec_bin_missing', '未找到 sillyspec CLI（bin 解析失败），请先安装 sillyspec');
    }
    const parsed = await this._runScopeAuditJson(
      bin,
      ['--change', change, '--json'],
      root,
    );
    const asStr = (v: unknown): string | null =>
      typeof v === 'string' && v !== '' ? v : null;
    const asCount = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? v : null;
    const rawRows = Array.isArray(parsed.rows) ? parsed.rows : [];
    const rows: SillySpecAuditRow[] = [];
    for (const raw of rawRows) {
      if (!isRecord(raw) || typeof raw.path !== 'string') continue;
      rows.push({
        path: raw.path,
        additions: asCount(raw.additions),
        deletions: asCount(raw.deletions),
        kind: asStr(raw.kind) ?? 'modified',
        planned: asStr(raw.planned),
        verdict: asStr(raw.verdict),
        declared: typeof raw.declared === 'boolean' ? raw.declared : null,
        attribution: asStr(raw.attribution),
      });
      if (rows.length >= SILLYSPEC_AUDIT_ROWS_MAX) break;
    }
    const excluded = isRecord(parsed.excluded) && Array.isArray(parsed.excluded.foreignDeclared)
      ? parsed.excluded.foreignDeclared.filter((p): p is string => typeof p === 'string')
      : [];
    const baseRef = asStr(parsed.baseAnchor);
    return {
      change: typeof parsed.change === 'string' ? parsed.change : change,
      ok: parsed.ok,
      mode: asStr(parsed.mode) ?? 'full-flow',
      base_ref: baseRef,
      // hash 锚短化 7 位（表头同款）；语义锚（quick-window:* / HEAD 窗口）原样
      anchor_label:
        baseRef === null
          ? null
          : /^[0-9a-f]{7,40}$/.test(baseRef)
            ? baseRef.slice(0, 7)
            : baseRef,
      degraded_reason: asStr(parsed.degradedReason),
      totals: {
        files: asCount((isRecord(parsed.totals) ? parsed.totals.files : null)) ?? rows.length,
        additions: asCount((isRecord(parsed.totals) ? parsed.totals.additions : null)),
        deletions: asCount((isRecord(parsed.totals) ? parsed.totals.deletions : null)),
      },
      rows,
      excluded_foreign_declared: excluded,
      note: asStr(parsed.note),
      truncated: rows.length >= SILLYSPEC_AUDIT_ROWS_MAX && rawRows.length > rows.length,
    };
  }

  /**
   * scope-audit CLI JSON 执行共享器（fileDiff / auditTable 共用，ql-20260911-001-c0be
   * 抽出防双实现）：spawn（node+bin 数组形参）→ 超时 / 能力门（exit 非零且输出含
   * 「未知命令 / unknown command」→ sillyspec_capability_missing）/ 其余非零 →
   * scope_audit_failed → stdout JSON 解析 + ok 字段契约校验。返回解析后的 envelope
   * （Record；字段取值由调用方各自投影）。
   */
  private async _runScopeAuditJson(
    bin: string,
    args: string[],
    root: string,
  ): Promise<Record<string, unknown> & { ok: boolean }> {
    const outcome = await this._execSillySpecCli(bin, ['scope-audit', ...args], root);
    if (outcome.timedOut) {
      throw new RpcError(
        'scope_audit_timeout',
        `scope-audit 执行超时（${Math.round(this._commandTimeoutMs / 1000)}s）被终止`,
      );
    }
    if (outcome.code === null) {
      throw new RpcError('scope_audit_failed', `进程启动失败（${outcome.errorCode ?? 'unknown'}）`);
    }
    const combined = `${outcome.stdout}\n${outcome.stderr ?? ''}`;
    if (outcome.code !== 0) {
      if (/未知命令|unknown command/i.test(combined)) {
        throw new RpcError(
          'sillyspec_capability_missing',
          '本机 sillyspec 版本不支持 scope-audit 命令，请升级 sillyspec 后重试',
        );
      }
      throw new RpcError(
        'scope_audit_failed',
        `执行失败（exit ${outcome.code}）${cliOutputSnippet(combined)}`,
      );
    }
    let parsed: unknown;
    try {
      const text = outcome.stdout;
      parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    } catch {
      throw new RpcError('scope_audit_failed', `stdout 非法 JSON（旧版本无 --json 面？）${cliOutputSnippet(outcome.stdout)}`);
    }
    if (!isRecord(parsed) || typeof parsed.ok !== 'boolean') {
      throw new RpcError('scope_audit_failed', 'stdout JSON 缺 ok 字段（信封形态不符）');
    }
    // ok 经上面 typeof 窄化，cast 到交叉返回型（调用方免重复窄化）
    return parsed as Record<string, unknown> & { ok: boolean };
  }

  /**
   * 心跳补报后处理（design §5 Phase 1 第 3 条）：对 summary.pending_conflicts 的
   * quick-* 条同步读 guard.json 补 ql_id。best-effort——readQuickSessionQuicklogId
   * 内部全收敛回 null，此处再兜一层 try/catch 保证单条意外（防御注入 fs 异常）仅
   * 缺省该条，绝不阻断其余条与整拍心跳快照。
   */
  private async _attachPendingConflictQlIds(
    root: string,
    summary: SillySpecStatusSummary,
  ): Promise<void> {
    for (const entry of summary.pending_conflicts) {
      if (!entry.change.startsWith('quick-')) continue;
      try {
        entry.ql_id = await readQuickSessionQuicklogId(root, entry.change);
      } catch (e) {
        entry.ql_id = null;
        this._log('debug', 'sillyspec_conflict_ql_id_read_failed', {
          change: entry.change,
          error: fmtErrorSnippet(e),
        });
      }
    }
  }

  /**
   * 心跳补报后处理（ql-20260910-014-6c29）：对 summary.changes 的 quick-* 条
   * 同步读 guard.json 补 ql_id——变更中心快速修复抽屉按 ql_id 反查会话名，代入
   * scope-audit --change quick-<8hex> 命令。best-effort 同 _attachPendingConflictQlIds
   * ——单条意外（防御注入 fs 异常）仅缺省该条，绝不阻断其余条与整拍心跳快照。
   */
  private async _attachChangeQlIds(
    root: string,
    summary: SillySpecStatusSummary,
  ): Promise<void> {
    for (const entry of summary.changes) {
      if (!entry.name.startsWith('quick-')) continue;
      try {
        entry.ql_id = await readQuickSessionQuicklogId(root, entry.name);
      } catch (e) {
        entry.ql_id = null;
        this._log('debug', 'sillyspec_change_ql_id_read_failed', {
          change: entry.name,
          error: fmtErrorSnippet(e),
        });
      }
    }
  }

  // ── 升级入口 ────────────────────────────────────────────────────────────────

  /**
   * 手动指令入口（WS SILLYSPEC_UPDATE → daemon.ts 接线）：先版本门（官方源
   * 仲裁）再 :meth:`requestUpgrade`。
   *
   * ql-20260902-003：auto 路径经 :meth:`checkAndUpgrade` 已有 isOutdated 门
   * （已最新 no-op），手动 server_command 原先直入 requestUpgrade 无门——已最新
   * 时白跑一次 `npm install -g` 还滚动一轮 running→success 横幅。此处先探
   * latest+local，已安装且 !isOutdated → 写 up_to_date 终态不跑 npm
   * （ql-20260904-019 推翻原静默 no-op：无反馈无法与指令丢失区分，改为横幅明示
   * 「已是最新版」，10min 后自然消失）；探测失败不阻断（网络不可达照旧升级，宁
   * 装勿漏）。刻意不把门塞进 requestUpgrade——该方法依赖「running 同步置位先于
   * 首个 await」契约（in-flight 门/测试同步断言），异步探测必须外置。
   *
   * ql-20260907-001：门的 latest 信源升级为官方源仲裁（:meth:
   * `_resolveLatestForGate`）+ 手动触发强制现探（force=true 绕过 10min 缓存）。
   * 镜像滞后（本地源旧值 == 本机版 → 误判已最新）由官方直查纠正；官方较新时
   * requestUpgrade 切官方源安装。探测失败语义不变（两路都 null 才放行）。
   */
  async requestManualUpgrade(): Promise<void> {
    const gate = await this._resolveLatestForGate(true);
    const local = await this.probeLocal();
    if (gate.effective !== null && local !== null && !isOutdated(local, gate.effective)) {
      // ql-20260904-019：已最新不再静默——回传 up_to_date 终态（10min 展示窗，
      // 与 success/failed 同款惰性过期），机器卡横幅给「已是最新版」明确反馈
      // （推翻 ql-20260902-003 的静默 no-op：用户点升级却无任何可见结果，无法
      // 与指令丢失区分）。running/deferred in-flight 期不覆盖（保留升级轨迹，
      // 与 requestUpgrade 侧 in-flight 门同语义）；覆盖 deferred 前清复查定时器。
      const current = this._update;
      if (current !== null && (current.state === 'running' || current.state === 'deferred')) {
        this._log('debug', 'sillyspec_up_to_date_during_inflight', {
          current_state: current.state,
          local,
          latest: gate.effective,
        });
        return;
      }
      this._clearDeferredTimer();
      this._terminalAt = this._now();
      this._update = {
        state: 'up_to_date',
        trigger: 'server_command',
        from_version: local,
        to_version: local,
      };
      this._log('info', 'sillyspec_upgrade_skipped_up_to_date', {
        trigger: 'server_command',
        local,
        latest: gate.effective,
        local_latest: gate.local,
        official_latest: gate.official,
      });
      return;
    }
    await this.requestUpgrade('server_command', gate.officialNewer);
  }

  /**
   * 请求升级（WS 指令 server_command / 自动检查 auto 统一入口）。
   *
   * - in-flight 门：running/deferred 期间新请求仅记日志去重（CLEANUP 惯例）；
   * - 机器忙（isBusy）→ deferred + 30s 复查定时（空闲转 running，官方源安装
   *   flag 随 deferred 保留、复查时消费——ql-20260907-001）；
   * - 空闲 → running：installSillySpec → probeLocal 刷新 → success（from/to）；
   *   安装后探测失败或过程异常 → failed（error 截断 200 字符）。
   *
   * 全路径自收敛不 reject。
   *
   * @param useOfficialRegistry ql-20260907-001：官方源仲裁判定镜像滞后时为 true，
   *   安装命令同带官方源 --registry（仍走镜像会装回旧版）。官方安装失败不自动
   *   回退镜像安装——装回旧版报 success 比诚实 failed 更糟，失败留给下轮重试。
   */
  async requestUpgrade(
    trigger: SillySpecUpdateTrigger,
    useOfficialRegistry: boolean = false,
  ): Promise<void> {
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
      this._deferredOfficialRegistry = useOfficialRegistry;
      this._terminalAt = null;
      this._update = { state: 'deferred', trigger, from_version: from };
      this._log('info', 'sillyspec_upgrade_deferred', {
        trigger,
        from_version: from,
        recheck_ms: this._deferredRecheckMs,
        official_registry: useOfficialRegistry,
      });
      this._scheduleDeferredRecheck();
      return;
    }
    await this._runUpgrade(trigger, useOfficialRegistry);
  }

  /**
   * 自动检查入口（1h 循环/启动衔接探测用，task-05 接线）：
   * 版本门（官方源仲裁，本地源探测走 10min 缓存）+ probeLocal → 未安装或
   * isOutdated → requestUpgrade(trigger)；已最新 no-op（debug 记录）；两路
   * latest 都不可达 → warn no-op（不做离线重试/退避，失败留给下轮自动检查或
   * 手动重试）。仲裁（ql-20260907-001）让镜像滞后的机器在小时级自动检查中
   * 自愈——实测镜像可滞后 3 天以上，单信源门永不触发。
   */
  async checkAndUpgrade(
    trigger: SillySpecUpdateTrigger = 'auto',
  ): Promise<void> {
    const gate = await this._resolveLatestForGate(false);
    if (gate.effective === null) {
      this._log('warn', 'sillyspec_latest_unavailable');
      return;
    }
    const local = await this.probeLocal();
    if (local === null) {
      this._log('info', 'sillyspec_not_installed', { latest: gate.effective });
      await this.requestUpgrade(trigger, gate.officialNewer);
      return;
    }
    if (isOutdated(local, gate.effective)) {
      this._log('info', 'sillyspec_outdated', {
        local,
        latest: gate.effective,
        official_latest: gate.official,
      });
      await this.requestUpgrade(trigger, gate.officialNewer);
      return;
    }
    this._log('debug', 'sillyspec_up_to_date', { version: local, latest: gate.effective });
  }

  // ── 内部：官方源仲裁与升级执行、状态机流转 ──────────────────────────────────

  /**
   * 版本门 latest 仲裁（ql-20260907-001）：本地源探测 + 官方源直查，取较新者。
   *
   * - 官方严格新于本地源（或本地源不可达）→ officialNewer=true，安装须切官方源；
   * - 官方较新时把心跳缓存覆盖为官方值（getSnapshot 徽标显示真实最新，不被镜像
   *   旧值拖累），并记 info 事件 `sillyspec_latest_arbitrated` 留痕；
   * - 官方不可达 → 静默回退本地源结果（内网机器常态）；两路都失败 → effective
   *   为 null，调用方按「探测失败放行/_warn no-op」现语义处理。
   *
   * @param force 本地源探测是否强制现探（手动触发传 true 绕过 10min 缓存）。
   */
  private async _resolveLatestForGate(
    force: boolean,
  ): Promise<SillySpecLatestGate> {
    const local = await this.probeLatest(force);
    const official = await this.probeLatestOfficial();
    const officialNewer =
      official !== null && (local === null || isOutdated(local, official));
    if (officialNewer) {
      this._latestCache = { value: official, at: this._now() };
      this._log('info', 'sillyspec_latest_arbitrated', {
        local_latest: local,
        official_latest: official,
      });
    }
    return { local, official, effective: officialNewer ? official : local, officialNewer };
  }

  /**
   * 执行升级链：置 running（同步——requestUpgrade 的 in-flight 门依赖此置位先于
   * 任何 await）→ installSillySpec → probeLocal 刷新 → 终态。
   *
   * from_version 取最近已知本机版本（checkAndUpgrade 刚探测过；server_command
   * 路径未探测过则为 null，展示窗语义允许）。全链 try/catch 收敛不 reject。
   */
  private async _runUpgrade(
    trigger: SillySpecUpdateTrigger,
    useOfficialRegistry: boolean = false,
  ): Promise<void> {
    this._clearDeferredTimer();
    const from = this._version;
    this._terminalAt = null;
    this._update = { state: 'running', trigger, from_version: from };
    this._log('info', 'sillyspec_upgrade_started', {
      trigger,
      from_version: from,
      official_registry: useOfficialRegistry,
    });
    try {
      await this._install(
        this._log,
        useOfficialRegistry ? { officialRegistry: true } : undefined,
      );
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
      (current.state !== 'success' &&
        current.state !== 'failed' &&
        current.state !== 'up_to_date') ||
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
      // 空闲 → 转 running（保持原 trigger 与官方源安装 flag——ql-20260907-001：
      // 仲裁结论跨 deferred 存活，推迟一轮后不能装回镜像旧版）。_runUpgrade 全
      // 路径 catch 收敛不 reject；.catch 为防御性兜底（daemon 定时器惯例）。
      const official = this._deferredOfficialRegistry;
      this._deferredOfficialRegistry = false;
      void this._runUpgrade(current.trigger, official).catch((e: unknown) => {
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

// ── 2026-09-04-conflict-resolve-entry task-06：平台命令终判辅助 ────────────────

/** outcome 是否成功一步（未超时且退出码 0）——ghost cleanup 链式推进的门。 */
function isSuccessOutcome(outcome: SillySpecProgressOutcome): boolean {
  return !outcome.timedOut && outcome.code === 0;
}

/** 字符串截断至 max 字符（结果槽 error ≤200 契约的单点实现，含边界==max 不截）。 */
function truncateToMaxChars(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

/**
 * CLI 输出尾段摘要（非零退出 error 拼接用）：trim 后取尾 120 字符（sillyspec
 * 报错摘要多在输出末尾）；空输出返回空串（error 恰为「执行失败（exit N）」）。
 * 整串最终仍经 recordCommandResult 截 ≤200。
 */
function cliOutputSnippet(stdout: string): string {
  const trimmed = stdout.trim();
  if (trimmed === '') return '';
  return `：${trimmed.slice(-120)}`;
}

// ── 2026-09-07-conflict-diff-compare task-02：冲突快照模块级辅助 ────────────────

/**
 * 读冲突记录（按 kind 分文件名，CLI 实证：spec-tree → spec-sync-conflict-<change>
 * .json、progress → sync-conflict-<change>.json，均位于 <根>/.sillyspec/.runtime/）。
 *
 * @throws {RpcError} conflict_record_missing（文件不存在）/ conflict_record_corrupt
 *   （JSON 损坏或非对象）——不回退空快照（task-01 契约：backend 可区分错误码）。
 */
async function readSillySpecConflictRecord(
  root: string,
  change: string,
  kind: 'spec-tree' | 'progress',
): Promise<Record<string, unknown>> {
  const filename =
    kind === 'spec-tree'
      ? `spec-sync-conflict-${change}.json`
      : `sync-conflict-${change}.json`;
  let raw: string;
  try {
    raw = await readFile(join(root, '.sillyspec', '.runtime', filename), 'utf8');
  } catch {
    throw new RpcError('conflict_record_missing', `冲突记录不存在：${filename}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch {
    throw new RpcError('conflict_record_corrupt', `冲突记录 JSON 损坏：${filename}`);
  }
  if (!isRecord(parsed)) {
    throw new RpcError('conflict_record_corrupt', `冲突记录结构损坏：${filename}`);
  }
  return parsed;
}

/**
 * quick 会话名 → QUICKLOG 编号映射（D-004@v1）：唯一来源是 daemon 机器本地
 * .sillyspec/.runtime/quick-sessions/<change>/guard.json 的 quicklogId 字段
 * （.runtime/ 在上传排除集内，平台侧拿不到）。best-effort：非 quick 名 / 文件
 * 缺失 / JSON 损坏 / 字段非字符串 一律回 null 不抛（guard 已清理的存量冲突属
 * design §8 低风险行——前端兜底显示原始 ID）。
 */
async function readQuickSessionQuicklogId(
  root: string,
  change: string,
): Promise<string | null> {
  if (typeof change !== 'string' || !change.startsWith('quick-')) {
    return null;
  }
  try {
    const raw = await readFile(
      join(root, '.sillyspec', '.runtime', 'quick-sessions', change, 'guard.json'),
      'utf8',
    );
    const parsed: unknown = JSON.parse(
      raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw,
    );
    if (isRecord(parsed) && typeof parsed.quicklogId === 'string' && parsed.quicklogId !== '') {
      return parsed.quicklogId;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 路径信噪比排序秩（design §8 风险表：存量冲突实测 164 条全是 archive 旧归档）：
 * changes/<change>/（本变更目录）=0 最优先，其余（ROADMAP 等）=1，changes/archive/
 * 旧归档 =2 沉底。分隔符兼容 Windows（\ 归一为 / 后比较）。
 */
function specPathSignalRank(path: string, change: string): number {
  const posix = path.replace(/\\/g, '/');
  if (posix.startsWith(`changes/${change}/`)) return 0;
  if (posix.startsWith('changes/archive/')) return 2;
  return 1;
}

/**
 * realpath 落点边界敏感前缀比较（file-rpc assertWithinExplorerRoot 同款语义）：
 * 相等或 startsWith(realRoot + sep)（杜绝兄弟撞名）；Windows 盘符大小写归一。
 * 双方都是 realpath 结果——覆盖「根内 symlink/junction 指向根外」逃逸面。
 */
function isRealPathWithinRoot(realPath: string, realRoot: string): boolean {
  const isWin =
    sep === '\\' || /^[A-Za-z]:[\\/]/.test(realPath) || /^[A-Za-z]:[\\/]/.test(realRoot);
  const norm = (p: string): string => (isWin ? p.toLowerCase() : p);
  const np = norm(realPath);
  const nr = norm(realRoot);
  return np === nr || np.startsWith(nr + sep);
}

/** 严格 UTF-8 解码器（fatal：非法序列抛错而非产出 U+FFFD，二进制嗅探用）。 */
const SNAPSHOT_UTF8_FATAL_DECODER = new TextDecoder('utf-8', { fatal: true });

/**
 * 二进制嗅探（file-rpc explorerReadFile 同款双判据）：窗口含 NUL 字节（文本文件
 * 几乎不可能含 0x00）或严格 UTF-8 解码失败 → 二进制。快照整读文件（≤256KB 才
 * 读，无截断误切多字节序列问题），无需 explorer 的截断边界裁剪。
 */
function snapshotLooksBinary(buf: Buffer): boolean {
  if (buf.includes(0)) return true;
  try {
    SNAPSHOT_UTF8_FATAL_DECODER.decode(buf);
    return false;
  } catch {
    return true;
  }
}

/** 单路径快照工作产物：entry 元信息骨架 + 候选 content（聚合帽裁决前）+ mtime 毫秒。 */
interface SnapshotSpecPathWork {
  entry: SillySpecConflictSnapshotFile;
  /** 候选内容（已过单文件帽 + 二进制嗅探）；不携带 = 该路径无内容可收。 */
  content: string | undefined;
  /** stat 成功时的 mtime 毫秒值（local_updated_at 聚合用）；未 stat 到为 null。 */
  mtimeMs: number | null;
}

/**
 * 逐路径快照（task-01 契约的拒读/缺失/截断/二进制四态全落在这）：
 *   - realpath 失败（ENOENT/ENOTDIR 等）→ missing=true 不带 content；
 *   - realpath 落点在根外（.. 段折叠 / junction·symlink 越界）→ 拒读：不带
 *     content、不置 missing（文件存在但拒绝读取），元信息不泄漏（size=0/mtime=null）；
 *   - stat 后非普通文件 → 元信息保留、无内容（目录等不该出现在 conflicting_paths，
 *     防御兜底）；
 *   - size > 256KB → truncated=true、content 缺省（元信息保留）；
 *   - 非 utf8（NUL/严格解码失败）→ binary=true、content 缺省；
 *   - 其余 → 候选 content（聚合 4MB 帽由调用方按信噪比顺序裁决）。
 */
async function snapshotOneSpecPath(
  realRoot: string,
  specDir: string,
  rel: string,
): Promise<SnapshotSpecPathWork> {
  const entry: SillySpecConflictSnapshotFile = {
    path: rel,
    mtime: null,
    size: 0,
    truncated: false,
    binary: false,
    missing: false,
  };
  let real: string;
  try {
    real = await realpath(resolve(specDir, rel));
  } catch {
    entry.missing = true;
    return { entry, content: undefined, mtimeMs: null };
  }
  if (!isRealPathWithinRoot(real, realRoot)) {
    return { entry, content: undefined, mtimeMs: null };
  }
  let st;
  try {
    st = await stat(real);
  } catch {
    entry.missing = true; // realpath 通过后竞态消失
    return { entry, content: undefined, mtimeMs: null };
  }
  entry.size = st.size;
  entry.mtime = st.mtime.toISOString();
  if (!st.isFile()) {
    return { entry, content: undefined, mtimeMs: st.mtimeMs };
  }
  if (st.size > SILLYSPEC_SNAPSHOT_FILE_MAX_BYTES) {
    entry.truncated = true;
    return { entry, content: undefined, mtimeMs: st.mtimeMs };
  }
  let buf: Buffer;
  try {
    buf = await readFile(real);
  } catch {
    entry.missing = true; // stat 后竞态消失
    return { entry, content: undefined, mtimeMs: st.mtimeMs };
  }
  if (snapshotLooksBinary(buf)) {
    entry.binary = true;
    return { entry, content: undefined, mtimeMs: st.mtimeMs };
  }
  return { entry, content: buf.toString('utf8'), mtimeMs: st.mtimeMs };
}


// ── 2026-09-02-changes-overview-card task-02：采集器默认实现与摘要构造 ──────────

/**
 * 默认采集执行器：node child_process execFile（数组形参，无 shell 依赖，NFR-02；
 * Windows 路径空格安全）。错误映射：err=null → code=0；ExecApiError 的数字 code =
 * 退出码、字符串 code = spawn 错误码（ENOENT 等）；killed=true → 超时被杀。全收敛
 * 不 reject。
 *
 * ql-20260907-007：env 显式传「缺省值垫底 + process.env 覆盖」——daemon 自身跑的
 * sillyspec 命令（runResolve / ghostCleanup 会触发平台同步）同样获得
 * SILLYSPEC_SYNC_TIMEOUT_MS=20000 缺省（process.env 已预设时原值优先，展开顺序
 * 即语义）。导出供测试直测（对齐本文件 envelope → 心跳摘要纯函数导出先例）。
 */
export function runProgressJsonDefault(
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
        env: {
          [SILLYSPEC_SYNC_TIMEOUT_MS_FIELD]: SILLYSPEC_SYNC_TIMEOUT_DEFAULT_MS,
          ...process.env,
        },
      },
      (err, stdout, stderr) => {
        if (err === null) {
          resolve({ code: 0, stdout: String(stdout ?? ''), timedOut: false, stderr: String(stderr ?? '') });
          return;
        }
        const e = err as NodeJS.ErrnoException & { killed?: boolean };
        resolve({
          code: typeof e.code === 'number' ? e.code : null,
          stdout: String(stdout ?? ''),
          timedOut: e.killed === true,
          errorCode: typeof e.code === 'string' ? e.code : undefined,
          stderr: String(stderr ?? ''),
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

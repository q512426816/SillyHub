/**
 * daemon 开机自启动核心模块（2026-08-30-daemon-autostart task-01，Wave 1 骨架）。
 *
 * 顶层 API（design §1，平台无关）：
 *   - enableAutostart(opts)     注册本平台自启任务（幂等，重复执行覆盖）
 *   - disableAutostart(target)  注销自启任务（按 server 或 all）
 *   - autostartStatus()         列出本地记录 + 系统注册实况对账
 *
 * 目录拆分（design 文件变更清单：避免多 task 共享单文件无法并行）：
 *   - index.ts（本文件）：三类型 + 三顶层 API + AutostartRecord 本地读写 +
 *     任务名派生 + 启动命令模板 + process.platform 分派；
 *   - windows.ts / macos.ts / linux.ts：平台策略（register/unregister/query），
 *     Wave 1 为 stub（返回 not implemented 错误），真实实现归 task-02/03/04。
 *
 * 关键约定（design §1 / §2）：
 *   - 启动命令模板三平台一致：`<process.execPath> <脚本绝对路径> start --server
 *     <server_url>`；凭据绝不进任务命令（D-004：开机拉起后由 start 从
 *     per-server config 读取）。
 *   - 本地注册记录 `~/.sillyhub/daemon/autostart-<hash8>.json`（AutostartRecord）：
 *     status 的数据源 + disable 的对账依据；hash8 复用 config.ts 的 serverHash，
 *     目录复用 config.ts 的 DEFAULT_CONFIG_DIR。
 *   - 仅开机（或登录）后自动启动一次，无任何保活配置（D-002：无 KeepAlive/Restart）。
 *   - 未支持平台返回 ok=false 的错误结果，不抛异常。
 *
 * @module autostart
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';

import { DEFAULT_CONFIG_DIR, serverHash } from '../config.js';
import { windowsAutostartStrategy } from './windows.js';
import { macosAutostartStrategy } from './macos.js';
import { linuxAutostartStrategy } from './linux.js';

// ── 类型定义（design「接口定义」）────────────────────────────────────────────

/**
 * 支持自启注册的三平台（process.platform 的受支持子集）。
 * AutostartRecord.platform 与本模块任务名派生共用同一来源。
 */
export type AutostartPlatform = 'win32' | 'darwin' | 'linux';

/**
 * 系统注册实况三态（autostartStatus 对账结果）：
 *   - registered：系统注册存在
 *   - missing：   本地记录在但系统注册丢失（如被用户手动删）
 *   - unknown：   查询系统状态失败
 */
export type AutostartSystemState = 'registered' | 'missing' | 'unknown';

/**
 * enableAutostart 入参（凭据语义归 CLI 层 task-05，本模块只透传形状）。
 */
export interface AutostartEnableOptions {
  /**
   * 注册目标 server（必填；CLI 层已解析默认值：不带 --server 时 cli.ts 用
   * DEFAULT_CONFIG.server_url 填充后传入）。
   */
  serverUrl: string;
  /** 与 token 互斥（同 start 语义，先校验）。本函数不消费——见 D-004 注释。 */
  apiKey?: string;
  /** 与 apiKey 互斥。本函数不消费——凭据不进任务命令，开机后由 start 读 per-server config。 */
  token?: string;
}

/**
 * 本地注册记录（~/.sillyhub/daemon/autostart-<hash8>.json 的文件格式）。
 * producer=enableAutostart 写、consumer=autostartStatus/disableAutostart 读，
 * daemon 本机私有格式，不跨进程透传。
 *
 * 注意：六字段均无凭据（凭据走 per-server config，D-004），序列化落盘天然不含 secrets。
 */
export interface AutostartRecord {
  /** 注册目标 server（记录源，非网络请求）。 */
  server_url: string;
  /** 注册时的平台（任务名派生依据，AutostartPlatform = win32/darwin/linux）。 */
  platform: AutostartPlatform;
  /** process.execPath 固化（launchd/systemd 环境 PATH 受限，必须绝对路径）。 */
  node_path: string;
  /** path.resolve(process.argv[1]) 固化（生产 bundle 与开发 dist/cli.js 均适用）。 */
  script_path: string;
  /** SillyHubDaemon-<hash8> / com.sillyhub.daemon.<hash8> / sillyhub-daemon-<hash8>.service。 */
  task_name: string;
  /** ISO 8601。 */
  enabled_at: string;
}

/** status 单条结果：本地记录 + 系统注册实况。 */
export interface AutostartStatusEntry extends AutostartRecord {
  /** 系统注册实况（registered/missing/unknown，见 AutostartSystemState）。 */
  systemState: AutostartSystemState;
}

// ── 平台策略接口（windows/macos/linux 三文件的实现目标形状）────────────────

/**
 * 平台注册/注销操作的通用结果：成功无负载；失败携带 error 与可选修复提示。
 * 平台策略一律不抛异常（上层据此转成 ok=false 返回）。
 */
export type AutostartPlatformResult = { ok: true } | { ok: false; error: string; hint?: string };

/**
 * 平台查询结果：systemState 三态 + unknown 时的失败原因。
 */
export interface AutostartQueryResult {
  systemState: AutostartSystemState;
  /** systemState === 'unknown' 时的失败原因（registered/missing 时无意义）。 */
  error?: string;
}

/**
 * 平台策略接口（task-02 windows / task-03 macos / task-04 linux 各自实现）。
 * index.ts 按 process.platform 分派：register←enableAutostart、
 * unregister←disableAutostart、query←autostartStatus（系统注册实况对账）。
 */
export interface AutostartPlatformStrategy {
  /**
   * 注册自启任务（幂等，重复执行覆盖）。record 已固化 node/script 绝对路径与
   * 派生任务名；平台产物（VBS/plist/service）由各实现自行派生清理路径。
   */
  register(record: AutostartRecord): Promise<AutostartPlatformResult>;
  /** 注销自启任务（含平台产物文件清理，如 Windows VBS / launchd plist / systemd service）。 */
  unregister(taskName: string): Promise<AutostartPlatformResult>;
  /** 查询系统注册实况（registered/missing/unknown）。 */
  query(taskName: string): Promise<AutostartQueryResult>;
}

// ── 启动命令模板（三平台共用，design §1）────────────────────────────────────

/**
 * 当前 CLI 脚本绝对路径。
 * `path.resolve(process.argv[1])`：生产 = ~/.sillyhub/daemon/bin/sillyhub-daemon.js
 * bundle，开发 = dist/cli.js（npm link 场景同样可用）。argv[1] 极端缺失时
 * resolve('') 回退 process.cwd()，仍保证绝对路径。
 */
export function currentScriptPath(): string {
  return resolve(process.argv[1] ?? '');
}

/**
 * 构造自启任务的启动命令（三平台一致模板，design §1）：
 *   `<node> <script> start --server <server_url>`
 *
 * - node 默认 process.execPath（运行时直取；macOS launchd / Linux systemd
 *   环境 PATH 受限，必须绝对路径）。
 * - script 默认 path.resolve(process.argv[1])（见 currentScriptPath）。
 * - 凭据绝不进命令（D-004）：签名不含任何凭据字段，静态可保证。
 * - 引号转义归各平台实现（Windows 经 VBS 中转规避 /TR 转义地狱，task-02）。
 */
export function buildStartCommand(
  serverUrl: string,
  nodePath: string = process.execPath,
  scriptPath: string = currentScriptPath(),
): string {
  return `${nodePath} ${scriptPath} start --server ${serverUrl}`;
}

// ── 任务名派生（design §2 标识行 + §1 per-server 后缀）───────────────────────

/**
 * 派生某 server 在某平台的自启任务名（serverHash 8 位十六进制后缀，
 * per-server 独立注册，多 server 互不干扰）。
 *   - win32:  SillyHubDaemon-<hash8>          （schtasks /TN）
 *   - darwin: com.sillyhub.daemon.<hash8>     （launchd label / plist 文件名）
 *   - linux:  sillyhub-daemon-<hash8>.service （systemd user unit）
 */
export function taskNameFor(platform: AutostartPlatform, serverUrl: string): string {
  const hash8 = serverHash(serverUrl);
  switch (platform) {
    case 'win32':
      return `SillyHubDaemon-${hash8}`;
    case 'darwin':
      return `com.sillyhub.daemon.${hash8}`;
    case 'linux':
      return `sillyhub-daemon-${hash8}.service`;
  }
}

// ── AutostartRecord 本地读写（status 数据源 + disable 对账依据）──────────────

/** 本地注册记录文件名模式（autostart-<8位hex>.json；排除 VBS 等其它 autostart-* 产物）。 */
const AUTOSTART_RECORD_RE = /^autostart-[0-9a-f]{8}\.json$/;

/**
 * 某 server 的本地注册记录文件绝对路径（design §1）：
 * `<DEFAULT_CONFIG_DIR>/autostart-<hash8>.json`（即 ~/.sillyhub/daemon/autostart-<hash8>.json）。
 * 目录常量与 hash 片段均复用 config.ts（DEFAULT_CONFIG_DIR / serverHash）。
 */
export function autostartRecordPath(serverUrl: string): string {
  return join(DEFAULT_CONFIG_DIR, `autostart-${serverHash(serverUrl)}.json`);
}

/**
 * 记录最小形状校验：六字段均为非空 string，platform 为合法三平台之一。
 * 手写文件/半截写入的脏数据在此拦下，status 与 disable 不因一条坏记录崩溃。
 */
function isValidRecord(value: unknown): value is AutostartRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.server_url === 'string' &&
    v.server_url.length > 0 &&
    (v.platform === 'win32' || v.platform === 'darwin' || v.platform === 'linux') &&
    typeof v.node_path === 'string' &&
    v.node_path.length > 0 &&
    typeof v.script_path === 'string' &&
    v.script_path.length > 0 &&
    typeof v.task_name === 'string' &&
    v.task_name.length > 0 &&
    typeof v.enabled_at === 'string' &&
    v.enabled_at.length > 0
  );
}

/**
 * 读单个 server 的本地记录。
 * 文件不存在 / 损坏 JSON / 形状非法 → 返回 null（不抛）。
 */
async function readAutostartRecord(serverUrl: string): Promise<AutostartRecord | null> {
  const path = autostartRecordPath(serverUrl);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf-8'));
    return isValidRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 列出全部本地记录（扫描 DEFAULT_CONFIG_DIR 下 autostart-<hash8>.json）。
 * 目录不存在（从未 enable 过）→ 空数组；单个文件损坏 → 跳过该条不阻断整体。
 */
async function listAutostartRecords(): Promise<AutostartRecord[]> {
  let names: string[];
  try {
    names = await readdir(DEFAULT_CONFIG_DIR);
  } catch {
    return [];
  }
  const records: AutostartRecord[] = [];
  for (const name of names) {
    if (!AUTOSTART_RECORD_RE.test(name)) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(await readFile(join(DEFAULT_CONFIG_DIR, name), 'utf-8'));
      if (isValidRecord(parsed)) {
        records.push(parsed);
      }
    } catch {
      // 单条损坏 → 跳过（status 不因一条脏数据整体失败）
    }
  }
  return records;
}

/**
 * 写本地记录（enable 平台注册成功后调用）。幂等覆盖（同 server 重跑 enable
 * 直接整文件重写）。AutostartRecord 无凭据字段，序列化内容天然不含 secrets。
 */
async function writeAutostartRecord(record: AutostartRecord): Promise<void> {
  const path = autostartRecordPath(record.server_url);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(record, null, 2), 'utf-8');
}

/**
 * 删本地记录（disable 注销成功后调用，best-effort）。
 * 注销已成功，记录残留只影响 status 显示，不因删除失败回滚。
 */
async function deleteAutostartRecord(serverUrl: string): Promise<void> {
  try {
    await rm(autostartRecordPath(serverUrl), { force: true });
  } catch {
    // best-effort：吞掉非 ENOENT 的意外错误（对齐 cli.ts removePid 模式）
  }
}

// ── 平台分派（process.platform → 策略）───────────────────────────────────────

/** 三平台策略表（Record 键覆盖 AutostartPlatform 全集，编译期保证不漏平台）。 */
const PLATFORM_STRATEGIES: Record<AutostartPlatform, AutostartPlatformStrategy> = {
  win32: windowsAutostartStrategy,
  darwin: macosAutostartStrategy,
  linux: linuxAutostartStrategy,
};

/** process.platform 收窄到受支持三平台（其余平台走 ok=false 错误路径，不抛异常）。 */
function isAutostartPlatform(platform: string): platform is AutostartPlatform {
  return platform === 'win32' || platform === 'darwin' || platform === 'linux';
}

/**
 * 当前平台的 {platform, strategy}；未支持平台返回 null，由调用方转成 ok=false。
 * Wave 1 策略为 stub：分派路径真实可达，但 register/unregister/query 返回
 * not implemented 错误（真实实现归 task-02/03/04，误调用不静默）。
 */
function currentPlatform(): {
  platform: AutostartPlatform;
  strategy: AutostartPlatformStrategy;
} | null {
  return isAutostartPlatform(process.platform)
    ? { platform: process.platform, strategy: PLATFORM_STRATEGIES[process.platform] }
    : null;
}

// ── 顶层 API（design「接口定义」逐字对齐）────────────────────────────────────

/**
 * 注册本平台自启任务（幂等，重复执行覆盖）。
 *
 * 流程：process.platform 分派 → 组装 AutostartRecord（固化 node/script 双绝对
 * 路径 + 派生任务名）→ 平台 register → 成功后写本地记录。
 *
 * opts.apiKey / opts.token 本函数不消费：凭据合并与校验语义归 CLI 层（task-05，
 * 与 start 完全一致）；D-004 凭据不进任务命令，开机拉起后由 start 从
 * per-server config 读取。
 */
export async function enableAutostart(opts: AutostartEnableOptions): Promise<
  { ok: true; record: AutostartRecord } | { ok: false; error: string; hint?: string }
> {
  const cur = currentPlatform();
  if (!cur) {
    return {
      ok: false,
      error: `unsupported platform: ${process.platform}`,
      hint: 'autostart 仅支持 Windows / macOS / Linux 的用户级注册。',
    };
  }
  const record: AutostartRecord = {
    server_url: opts.serverUrl,
    platform: cur.platform,
    node_path: process.execPath,
    script_path: currentScriptPath(),
    task_name: taskNameFor(cur.platform, opts.serverUrl),
    enabled_at: new Date().toISOString(),
  };
  const res = await cur.strategy.register(record);
  if (!res.ok) {
    return { ok: false, error: res.error, hint: res.hint };
  }
  // 注册成功后写本地记录。写失败不静默：明确 ok=false 报错（系统注册已成功，
  // 重跑 enable 幂等覆盖可自愈，不留半残状态）。
  try {
    await writeAutostartRecord(record);
  } catch (e) {
    return {
      ok: false,
      error: `system registration succeeded but failed to write local record: ${
        (e as Error).message
      }`,
      hint: `重新执行 enable 可修复（幂等覆盖）：${autostartRecordPath(record.server_url)}`,
    };
  }
  return { ok: true, record };
}

/**
 * 注销自启任务（按 server 或 all）。只注销注册（系统任务 + 平台产物 + 本地
 * 记录），不动运行中的进程（停进程仍用 stop，避免误杀多实例，design §3）。
 *
 * 对账：优先用本地记录里的 task_name（注册时的真实标识）；记录缺失（孤儿
 * 注册）时按当前平台从 serverUrl 重新派生。target.all 与 target.serverUrl
 * 同时给出时 all 优先；两者都缺 → ok=false（缺省时的交互选择归 CLI 层 task-05）。
 *
 * @returns 成功时 removed 为已注销的 server_url 列表（all 且无任何注册 →
 *          空数组，幂等成功）。
 */
export async function disableAutostart(target: {
  serverUrl?: string;
  all?: boolean;
}): Promise<{ ok: true; removed: string[] } | { ok: false; error: string; hint?: string }> {
  const cur = currentPlatform();
  if (!cur) {
    return {
      ok: false,
      error: `unsupported platform: ${process.platform}`,
      hint: 'autostart 仅支持 Windows / macOS / Linux 的用户级注册。',
    };
  }

  // 注销范围解析：all → 全部本地记录；serverUrl → 该 server（记录缺失也尝试注销孤儿注册）。
  let targets: Array<{ serverUrl: string; taskName: string }>;
  if (target.all) {
    targets = (await listAutostartRecords()).map((rec) => ({
      serverUrl: rec.server_url,
      taskName: rec.task_name,
    }));
  } else if (target.serverUrl) {
    const rec = await readAutostartRecord(target.serverUrl);
    targets = [
      {
        serverUrl: target.serverUrl,
        taskName: rec?.task_name ?? taskNameFor(cur.platform, target.serverUrl),
      },
    ];
  } else {
    return {
      ok: false,
      error: 'disable target required',
      hint: '指定 serverUrl 或 all（对应 CLI 的 --server / --all）。',
    };
  }

  // 逐条注销：单条失败不阻断其余（best-effort 全试完再汇总），成功即删本地记录。
  const removed: string[] = [];
  const failures: string[] = [];
  for (const t of targets) {
    const res = await cur.strategy.unregister(t.taskName);
    if (res.ok) {
      await deleteAutostartRecord(t.serverUrl);
      removed.push(t.serverUrl);
    } else {
      failures.push(`${t.serverUrl} (${res.error})`);
    }
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: `failed to disable: ${failures.join('; ')}`,
      hint:
        removed.length > 0
          ? `其余 ${removed.length} 个已注销：${removed.join(', ')}`
          : undefined,
    };
  }
  return { ok: true, removed };
}

/**
 * 列出本地记录 + 系统注册实况对账（design §1 / §3 status 数据源）。
 *
 * 读全部 autostart-<hash8>.json → 逐条调平台 query → 附加 systemState。
 * 查询失败或平台未支持 → 该条 systemState='unknown'（design 固定
 * AutostartStatusEntry 无 error 字段，query 的失败原因不进返回结构）。
 * 无任何记录时返回空数组。
 */
export async function autostartStatus(): Promise<AutostartStatusEntry[]> {
  const records = await listAutostartRecords();
  const cur = currentPlatform();
  const entries: AutostartStatusEntry[] = [];
  for (const rec of records) {
    // 用记录内的 task_name 查询（注册时的真实标识）。跨平台迁移来的记录在
    // 当前平台查不到 → missing，如实反映"本机无此系统注册"。
    const q = cur
      ? await cur.strategy.query(rec.task_name)
      : { systemState: 'unknown' as const };
    entries.push({ ...rec, systemState: q.systemState });
  }
  return entries;
}

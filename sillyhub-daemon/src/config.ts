/**
 * sillyhub-daemon 配置持久化层。
 *
 * 替代 Python `sillyhub_daemon/config.py`，管理
 * `~/.sillyhub/daemon/config.json` 的加载/保存。
 *
 * 对照 Python:
 *   - DEFAULTS 字典:      config.py:22-32
 *   - 路径常量:           config.py:15-16
 *   - _load() 加载逻辑:   config.py:41-51
 *   - save() 写入逻辑:    config.py:53-57
 *
 * 设计取舍（Python → Node）:
 *   - class DaemonConfig（property + 内部 _data）→ 函数式（loadConfig 返回纯对象、
 *     saveConfig 接收对象）。函数式更易测试，daemon 主类持有 config 后只读使用，
 *     无需 mutable 属性。若后续需改配置，直接改对象再 save，接口天然支持。
 *   - 同步 open/read/json.load → 异步 fs/promises（design G-03 原生异步契合）。
 *     不提供同步版本（YAGNI，同步是 Python 历史包袱）。
 *   - uuid.uuid4() → crypto.randomUUID()。
 *   - Path.home() → os.homedir()（POSIX/Windows 行为一致）。
 *
 * @module config
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

// ── 工具函数 ──────────────────────────────────────────────────────────────────

/**
 * 去除字符串开头的 BOM（﻿）。
 * JSON.parse 不跳过 BOM，需要先 strip 再 parse。
 */
function stripBOM(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

// ── 路径常量（对齐 Python config.py:15-16）──────────────────────────────────

/**
 * 默认配置目录 `~/.sillyhub/daemon`。
 *
 * 等价 Python `Path.home() / ".sillyhub" / "daemon"`。
 * 用 `os.homedir()` 而非 `process.env.HOME`（Windows 下后者可能 undefined）。
 * 被 cli/daemon 复用（Python 的 DEFAULT_CONFIG_PATH 被 cli.py 引用）。
 */
export const DEFAULT_CONFIG_DIR: string = join(homedir(), '.sillyhub', 'daemon');

/**
 * 默认配置文件 `<DEFAULT_CONFIG_DIR>/config.json`。
 * 等价 Python `DEFAULT_CONFIG_DIR / "config.json"`。
 *
 * 2026-07-03-daemon-entity-binding task-04（D-001）：保留为旧配置文件路径常量，
 * **仅用于首次升级迁移源**（per-server 文件缺失时从此处搬运 daemon_local_id）
 * 与外部测试的兼容断言。生产代码定位新 daemon 配置文件统一改用
 * `configPathForServer(server_url)`，不再直接消费本常量。不删除以保持
 * 向后兼容引用稳定（cli.test.ts 等历史断言依赖）。
 */
export const DEFAULT_CONFIG_PATH: string = join(DEFAULT_CONFIG_DIR, 'config.json');

// ── per-server 配置路径（task-04 / D-001）──────────────────────────────────

/**
 * 按 server_url 计算的 per-server 配置文件名前缀长度（sha256 前 8 位十六进制）。
 *
 * 碰撞概率 16^8 ≈ 43 亿分之一，可接受（后端最终以 daemon_local_id 主键去重，
 * server_hash 仅用于本地文件名隔离，碰撞最坏后果是两 server 共用一份配置，
 * 不影响身份正确性）。
 */
const SERVER_HASH_LENGTH = 8;

/**
 * 计算某 server_url 的本地配置文件 hash 片段（sha256 前 8 位十六进制）。
 *
 * 纯函数（同一输入恒同输出），导出供 cli/测试复用。hash 计算用
 * `node:crypto` 的 `createHash('sha256')`（同步 digest，UTF-8 编码 server_url）。
 *
 * @param server_url daemon 连接的后端地址（如 `http://localhost:8000`）。
 * @returns 8 位十六进制字符串（小写）。
 */
export function serverHash(server_url: string): string {
  return createHash('sha256').update(server_url, 'utf-8').digest('hex').slice(0, SERVER_HASH_LENGTH);
}

/**
 * 返回某 server_url 对应的 per-server 配置文件绝对路径。
 *
 * 文件名格式：`config-<server_hash>.json`（如 `config-a1b2c3d4.json`），
 * 位于 `configDir`（默认 `DEFAULT_CONFIG_DIR = ~/.sillyhub/daemon`）下。
 *
 * 设计（design §5.1 / D-001）：每个 daemon 进程按它连接的后端地址用独立配置文件
 * → 独立 daemon_local_id。同机多 daemon 连不同后端时配置互不覆盖。
 *
 * @param server_url daemon 连接的后端地址。
 * @param configDir  配置目录（默认 DEFAULT_CONFIG_DIR；测试可注入 tmpdir）。
 */
export function configPathForServer(
  server_url: string,
  configDir: string = DEFAULT_CONFIG_DIR,
): string {
  return join(configDir, `config-${serverHash(server_url)}.json`);
}

/**
 * 检查某配置目录下是否已存在**任意** per-server 配置文件（`config-<hash>.json`）。
 *
 * task-04 一次性迁移判定（design §5.1 + acceptance "两 server 不同 daemon_local_id"）：
 * 首次升级时，legacy `config.json` 的 runtime_id 只迁移给第一个被创建的 per-server
 * 文件；本函数通过扫描目录判断「是否已有 per-server 文件」来阻止重复迁移（否则连 N 个
 * 后端会共享同一 legacy 身份，违反隔离）。
 *
 * 仅匹配 `config-<8位hex>.json` 命名（PER_SERVER_CONFIG_RE），忽略旧 `config.json`
 * 与其他文件（pid/log 等）。
 *
 * @param configDir 配置目录（默认 DEFAULT_CONFIG_DIR）。
 * @returns 已有 per-server 文件 → true；目录不存在/无匹配文件 → false。
 */
const PER_SERVER_CONFIG_RE = /^config-[0-9a-f]{8}\.json$/;
export function hasAnyPerServerConfig(configDir: string = DEFAULT_CONFIG_DIR): boolean {
  let entries: string[];
  try {
    entries = readdirSync(configDir);
  } catch {
    // 目录不存在或不可读 → 视为无 per-server 文件（不阻断迁移）
    return false;
  }
  return entries.some((name) => PER_SERVER_CONFIG_RE.test(name));
}

// ── DaemonConfig interface（字段与 Python DEFAULTS 1:1）─────────────────────

/**
 * daemon 配置结构。字段名/默认值逐字对齐
 * `sillyhub_daemon/config.py` 的 `DEFAULTS` 字典（config.py:22-32）。
 *
 * 修改本 interface 必须同步检查 Python config.py 是否也改
 * （本重写期间 Python 版仍存活，两边字段须保持一致直到 W5 删除 Python）。
 *
 * 注意类型严格性：
 *   - `token` 与 `runtime_id` 在 Python 中是 `str | None`，TS 显式
 *     `string | null`（不用 `string | undefined`），因 `null` 是 JSON 原生 null，
 *     往返序列化语义一致。
 *   - strict 模式下访问 `config.token` 后需 `if (config.token)` 收窄类型，
 *     与 Python `if config.token` 等价（避免 `Bearer null`）。
 */
export interface DaemonConfig {
  /** backend 服务地址，默认 http://localhost:8000。 */
  server_url: string;
  /** Bearer token（浏览器 access_token，TTL 15min），未配置时为 null。 */
  token: string | null;
  /**
   * 长期 API Key（admin 通过 /settings/api-keys 签发，存于 X-API-Key）。
   * 与 token 互斥；二者同时配置时 CLI 启动报错。
   */
  api_key: string | null;
  /** runtime 唯一标识，缺失时自动生成 uuid v4。 */
  runtime_id: string;
  /** 配置 profile 名，默认 "default"。 */
  profile: string;
  /** workspace 根目录，默认 ~/sillyhub_workspaces（对齐 Python `str(Path.home() / "sillyhub_workspaces")`）。 */
  workspace_dir: string;
  /** HTTP 轮询间隔（秒），默认 30。 */
  poll_interval: number;
  /** WS 心跳间隔（秒），默认 15。 */
  heartbeat_interval: number;
  /** 最大并发任务数，默认 5。 */
  max_concurrent_tasks: number;
  /** 日志级别，默认 "info"。 */
  log_level: string;
  /**
   * 单任务默认超时秒数（lease.metadata.timeout_seconds 未指定时用），默认 1800。
   * task-10 B2：resolveTimeout 优先级链第 2 层。
   */
  default_timeout_seconds: number;
  /**
   * spawn 级失败最大重试次数，默认 1（业务 is_error 不重试）。
   * task-10 B3：硬上限 3（resolveMaxRetries 截断 > 3 的值）。
   */
  max_retries: number;
  /**
   * 网络层（ResilienceService）重试最大尝试次数，默认 3。
   * 2026-06-24-daemon-network-resilience task-09：仅对可重试错误（fetch
   * failed/timeout/5xx/429）退避重试；4xx 业务错误 fail-fast 不重试。
   */
  retry_max_attempts: number;
  /** 网络重试初始退避毫秒，默认 1000。退避 = base × factor^i ± jitter。 */
  retry_base_delay_ms: number;
  /** 网络重试退避倍数，默认 2（1s/2s/4s）。 */
  retry_backoff_factor: number;
  /** 网络重试退避抖动比例 [0,1]，默认 0.2（±20%）。 */
  retry_jitter: number;
  /**
   * _fire 循环自愈重启退避毫秒，默认 5000。
   * 2026-06-24-daemon-network-resilience task-04：非 AbortError 异常后带退避
   * 重启三循环，防快速重启风暴。
   */
  loop_restart_backoff_ms: number;
  /**
   * _fire 循环连续崩溃最大重启次数，默认 10。
   * 达到上限后循环停止重启并记 FATAL 日志（断路器）。
   * 成功运行超过 loop_restart_backoff_ms 后计数器自动归零。
   */
  max_loop_restarts: number;
  /**
   * outbox 每个 run 最大暂存条数，默认 500。
   * 2026-06-24-daemon-network-resilience task-15：超限丢最旧 + warn。
   */
  outbox_max_per_run: number;
  /** outbox 全局最大暂存条数，默认 5000。超限丢最旧 + warn。 */
  outbox_max_total: number;
  /**
   * 连续断连超该秒数记一次 FATAL 日志（运维感知），默认 30。
   * 2026-06-24-daemon-network-resilience task-05（D-006@v1）：仅 FATAL 计数，
   * 不主动上报 degraded——backend DEFAULT_RUNTIME_STALE_SECONDS=45s 已因心跳
   * 超时自然判 runtime offline，网络恢复后 heartbeat 自动拉回 online。
   */
  disconnect_log_threshold_sec: number;
  /**
   * 是否在 agent run 启动时弹出本地终端窗口观察执行过程。默认 false。
   * daemon 写观察日志到 ~/.sillyhub/daemon/runs/<leaseId>/terminal.log，
   * enabled=true 时调 terminal-launcher 弹终端 tail 该日志。
   * 服务器/无 GUI 环境保持 false，避免乱弹窗。
   */
  terminal_observer_enabled: boolean;
  /**
   * lease 心跳间隔（秒），默认 5。
   * ql-20260616-006：daemon 在 runLease 内并发跑 heartbeat 循环，
   * 既续期 lease_expires_at（防 expire_leases 误杀），又检测 backend
   * cancel_lease 信号（status='cancelled' → 自动 cancel + SIGTERM kill）。
   */
  lease_heartbeat_interval: number;
  /**
   * 观察日志写入模式：
   *   - 'parsed'：只写 echoAgentEvent/echoTaskBoundary 渲染后的可读文本
   *   - 'raw'：只写 Claude 原始 stdout/stderr
   *   - 'both'：parsed + raw 都写
   */
  terminal_observer_mode: 'parsed' | 'raw' | 'both';
  /**
   * 任务退出后是否关闭观察终端窗口。默认 false（保留窗口方便查看）。
   * 实现层弹窗命令带 -Wait/-NoExit 时该字段控制是否替换为会退出的命令。
   */
  terminal_observer_close_on_exit: boolean;
  /**
   * 自定义终端启动命令模板，支持 {log} 和 {title} 占位符。
   * 例：'konsole --new-tab -e tail -f {log}'。
   * null 时按平台默认（win32 wt.exe、darwin osascript、linux x-terminal-emulator）。
   */
  terminal_observer_command: string | null;
  /**
   * list_dir RPC 允许浏览的根目录白名单（绝对路径数组）。
   *
   * 用途（FR-04 / D-002@v1）：前端树形目录浏览请求的 path 必须落在
   * 某个 allowed_root 之下（含 root 本身），越界由 task-05 file-rpc.ts
   * 返回 error.code='forbidden'。
   *
   * 默认 `[os.homedir()]`：未显式配置时仅允许浏览用户家目录。
   * 用户可在 ~/.sillyhub/daemon/config.json 中追加项目目录扩展范围。
   *
   * 元素约定：
   *   - 必须为绝对路径（loadConfig 已做规范化，见 normalizeAllowedRoots）。
   *   - 允许重复项（loadConfig 去重保序）。
   *   - 大小写：Windows 下盘符保留原样（'C:\\Users\\...'），规范化不做大小写归一
   *     （由 task-05 比较时按平台决定是否 case-insensitive）。
   *   - 不展开 shell 风格 `~`（Node path.resolve 不识别 `~`，用户须写真实绝对路径）。
   *
   * 字段非 nullable：默认值恒为非空数组（含 homedir），下游消费无需 null 检查。
   */
  allowed_roots: string[];
  /**
   * prompt 路径翻译映射，格式 "from:to"，如 "/data/spec-workspaces:C:/data/spec-workspaces"。
   * daemon 在 prompt 透传给 SessionManager.create 前，把 from 替换为 to。
   * 来自 process.env.SPEC_ROOT_MAP（daemon 启动脚本注入），env 优先于 config.json 落盘值。
   * 空串表示不翻译（向后兼容旧 daemon，SPEC_ROOT_MAP 未设）。
   *
   * 背景：backend 在 Docker 容器内按 /data/spec-workspaces 拼 spec_root，daemon 跑在
   * Windows 宿主机见 C:/data/spec-workspaces，二者物理同一目录（bind mount 共享）。
   * 不翻译则 prompt 里 /data/... 字面落到 Claude Code Bash → Git Bash MSYS 转成
   * C:\Program Files\Git\data\... → EPERM。
   *
   * 详见 design 2026-06-22-agent-run-pipeline-fix §4.1 A1。
   */
  spec_root_map: string;
}

// ── 默认值常量 ───────────────────────────────────────────────────────────────

/**
 * 默认配置。
 *
 * 对照 Python `DEFAULTS`（config.py:22-32），字段名/默认值 1:1。
 * `runtime_id` 用空串占位（对应 Python `None`），loadConfig 检测到空/null 时
 * 生成 uuid 并落盘。
 *
 * 防污染策略：
 *   1. `Object.freeze` 冻结本常量（双保险，防止任何代码误改 DEFAULT_CONFIG）。
 *   2. `loadConfig` 内部用 `{ ...DEFAULT_CONFIG }` 浅拷贝起始数据，不直接操作常量。
 *
 * 注：freeze 是浅冻结，但 DaemonConfig 全是扁平字段（string/number/null），
 * 无嵌套，浅冻结即足够。
 */
export const DEFAULT_CONFIG: Readonly<DaemonConfig> = Object.freeze({
  server_url: 'http://localhost:8000',
  /** Bearer token for server auth（对齐 Python config.py:24 注释）。 */
  token: null,
  /** Long-lived API Key (X-API-Key)，与 token 互斥（daemon-api-key 变更）。 */
  api_key: null,
  /** auto-generated（对齐 Python config.py:25 注释，load 时生成）。 */
  runtime_id: '',
  profile: 'default',
  workspace_dir: join(homedir(), 'sillyhub_workspaces'),
  poll_interval: 30,
  heartbeat_interval: 15,
  max_concurrent_tasks: 5,
  log_level: 'info',
  // task-10 B2/B3：超时优先级链兜底 + spawn 级失败重试上限。
  default_timeout_seconds: 1800,
  max_retries: 1,
  // 2026-06-24-daemon-network-resilience task-09：网络层可靠性配置默认值。
  retry_max_attempts: 3,
  retry_base_delay_ms: 1000,
  retry_backoff_factor: 2,
  retry_jitter: 0.2,
  loop_restart_backoff_ms: 5000,
  max_loop_restarts: 10,
  outbox_max_per_run: 500,
  outbox_max_total: 5000,
  disconnect_log_threshold_sec: 30,
  // ql-20260616-003：本地终端观察（默认关闭，--open-terminal 开启）
  terminal_observer_enabled: false,
  terminal_observer_mode: 'parsed',
  terminal_observer_close_on_exit: false,
  terminal_observer_command: null,
  // ql-20260616-006：lease 心跳间隔（cancel 信号检测 + 续期）
  lease_heartbeat_interval: 5,
  // FR-04 / D-002@v1：list_dir 白名单根目录，默认仅允许浏览用户家目录。
  // 注：用 [homedir()] 而非 homedir() —— 字段类型是数组。
  // 不在此处做 path.resolve（homedir() 已返回绝对路径），规范化在 loadConfig/normalizeAllowedRoots。
  allowed_roots: [homedir()],
  // 2026-06-22-agent-run-pipeline-fix task-02：prompt 路径翻译映射，默认空串（向后兼容）。
  spec_root_map: '',
});

// ── loadConfig（异步加载 + 合并默认 + 自动生成 runtime_id）──────────────────

/**
 * `loadConfig` 的可选参数。
 *
 * 2026-07-03-daemon-entity-binding task-04（D-001）：配置文件路径现由 server_url
 * 驱动（`configPathForServer`）。两个可选字段覆盖默认定位，仅用于测试与历史兼容：
 *   - `path`：显式指定文件绝对路径（**优先级最高**，跳过 server_url 计算）。
 *     保留以兼容历史 `loadConfig(path)` 调用语义（config.test.ts 的 path-based
 *     用例：嵌套目录、损坏 JSON、空文件等）。
 *   - `configDir`：注入配置目录（默认 DEFAULT_CONFIG_DIR）；与 server_url 配合
 *     定位 per-server 文件，测试用来隔离到 tmpdir 而不污染真实 ~/.sillyhub。
 */
export interface LoadConfigOptions {
  /** 显式文件路径（覆盖 server_url 计算，最高优先级）。 */
  path?: string;
  /** per-server 文件所在目录（默认 DEFAULT_CONFIG_DIR）。仅在 path 未指定时生效。 */
  configDir?: string;
}

/**
 * 从 per-server 配置文件加载配置。
 *
 * 2026-07-03-daemon-entity-binding task-04（D-001）签名变更：
 *   - 旧：`loadConfig(path?)`，path 默认 `DEFAULT_CONFIG_PATH`（单一全局 config.json）。
 *   - 新：`loadConfig(server_url, opts?)`，server_url **必填**，文件名由
 *     `configPathForServer(server_url)` 计算（`config-<sha256[0:8]>.json`）。
 *     `opts.path` 可显式覆盖路径（历史兼容/测试）。
 *
 * 行为对齐 Python `DaemonConfig._load()`（config.py:41-51）：
 *
 * 1. 起始 = 浅拷贝 `DEFAULT_CONFIG`（不污染常量）。
 * 2. **首次升级迁移（brownfield 兼容，design §5.1 / §10）**：
 *    per-server 文件不存在 **且** 旧 `config.json`（DEFAULT_CONFIG_PATH）存在 →
 *    读旧文件，把 `runtime_id`（仅此字段，其余字段走默认 + 旧文件合并）写到新
 *    per-server 文件，保留 daemon 身份。**幂等**：per-server 文件已存在则不迁移。
 *    迁移后**不删**旧 config.json（保留备份，用户可手动清理）。
 * 3. per-server 文件存在 → `readFile` + `JSON.parse`，结果**浅合并**到 _data
 *    （`Object.assign`，等价 Python `self._data.update(saved)`）。
 *    缺字段自动补默认；DaemonConfig 全是扁平字段，浅合并即正确。
 * 4. `runtime_id` 为空/null/falsy（`""` / `null` / `undefined`）→
 *    生成 `randomUUID()` 并立即 `saveConfig()` 落盘（对齐 Python config.py:49-51）。
 * 5. 返回合并后的完整配置。
 *
 * 异常策略（对齐 Python「宽容加载，严格使用」）：
 *   - JSON 损坏 → `JSON.parse` 抛 `SyntaxError` 原样冒泡，不吞不降级
 *     （否则用户配置静默丢失，违反 G-01 等价原则）。
 *   - 空文件 → `JSON.parse('')` 抛 `SyntaxError` 同样冒泡。
 *   - 路径不可写（`saveConfig` 内 mkdir/writeFile EACCES/ENOSPC）→ 原样抛出，
 *     daemon 应停止而非带病运行（YAGNI，不 retry 不降级）。
 *   - `server_url` 为空 → 不报错，交由 hub-client 在实际请求时失败。
 *
 * @param server_url daemon 连接的后端地址（决定 per-server 文件名）。
 * @param opts       路径覆盖/目录注入（测试与历史兼容用）。
 * @returns 合并后的完整配置（所有字段必有值）。
 */
export async function loadConfig(
  server_url: string,
  opts: LoadConfigOptions = {},
): Promise<DaemonConfig> {
  // step 0: 定位配置文件路径。opts.path 显式覆盖优先；否则按 server_url 算 per-server 文件。
  const path = opts.path ?? configPathForServer(server_url, opts.configDir);
  // 是否走 per-server 默认路径（非测试/历史 path 覆盖）。迁移逻辑仅在 per-server
  // 模式触发——opts.path 显式指定是测试/历史兼容场景，不应被 legacy config.json 迁移污染。
  const usingPerServerPath = opts.path === undefined;

  // step 1: 浅拷贝起始数据（避免污染 DEFAULT_CONFIG 常量）。
  const data: DaemonConfig = { ...DEFAULT_CONFIG };

  // step 2: 首次升级迁移（brownfield）。仅当走 per-server 默认路径 + per-server 文件
  // 不存在 + 旧 config.json 存在时触发，幂等（per-server 已存在则跳过）。仅搬 runtime_id
  // 字段，保留 daemon 身份。不删旧 config.json（design §10：保留备份）。
  // migrated 标记：迁移发生后，step 4 必须强制落盘 per-server 文件（哪怕 runtime_id
  // 已从 legacy 继承无需新生成），否则迁移结果丢失，下次启动重复迁移且 per-server 永不落盘。
  //
  // **一次性语义**（task-04 acceptance "两 server 不同 daemon_local_id" 守护）：
  // 迁移只在「DEFAULT_CONFIG_DIR 下尚无任何 per-server 文件」时触发——首个被创建的
  // per-server 文件继承 legacy runtime_id，之后用户连其他后端时目录已有 per-server 文件，
  // 不再迁移（新建独立身份）。否则字面"per-server 不存在即迁移"会让连 N 个后端共享同一
  // legacy 身份，违反隔离目标。
  let migrated = false;
  const perServerExisted = existsSync(path);
  const migrationDir = opts.configDir ?? DEFAULT_CONFIG_DIR;
  // 一次性迁移：仅当走 per-server 路径 + 当前 per-server 不存在 + 目录下无任何
  // per-server 文件 + legacy 存在时触发。hasAnyPerServerConfig 已隐含 perServerExisted
  //（当前文件在则扫描到），故不再单独检查 perServerExisted。
  if (
    usingPerServerPath &&
    !hasAnyPerServerConfig(migrationDir) &&
    existsSync(DEFAULT_CONFIG_PATH)
  ) {
    try {
      const legacyRaw = await readFile(DEFAULT_CONFIG_PATH, 'utf-8');
      const legacy = JSON.parse(stripBOM(legacyRaw)) as Partial<DaemonConfig>;
      // 仅迁移 runtime_id（daemon_local_id 身份）。其余字段让默认值 + 后续合并兜底，
      // 避免 legacy 的 server_url/token 等污染新 per-server（不同后端身份应隔离）。
      if (legacy.runtime_id) {
        data.runtime_id = legacy.runtime_id;
        migrated = true;
      }
    } catch {
      // 旧 config.json 损坏/不可读 → 放弃迁移，按全新身份生成（不阻断启动）。
      // 记录由调用方/默认 runtime_id 生成路径兜底。
    }
  }

  // step 3: per-server 文件存在则读 + 解析 + 浅合并。
  // 用 existsSync 而非 fs/promises.access + try/catch：启动一次性调用，语义直观。
  if (existsSync(path)) {
    const raw = await readFile(path, 'utf-8');
    // JSON 损坏/空文件时 JSON.parse 抛 SyntaxError，原样冒泡到调用方。
    const saved = JSON.parse(stripBOM(raw)) as Partial<DaemonConfig>;
    // 浅合并：仅覆盖 saved 中存在的键，保留 data 中已有默认。
    // 等价 Python `self._data.update(saved)`。
    Object.assign(data, saved);
  }

  // ── allowed_roots 向后兼容 + 规范化（FR-04 / D-002@v1）──
  // 浅拷贝 DEFAULT_CONFIG 后 data.allowed_roots 仍指向 DEFAULT 的同一数组引用，
  // 必须用 normalize 返回的全新数组覆盖，避免后续 mutation 污染 DEFAULT（R-3）。
  // 规范化幂等：resolve + 去重对已是规范的输入无副作用，因此 round-trip 一致。
  // 不因规范化立即落盘——与 runtime_id 自动生成路径不同，避免每次启动写盘。
  data.allowed_roots = normalizeAllowedRoots(data.allowed_roots);

  // step 4: runtime_id 为空/null/undefined（边界 R5）→ 生成 uuid 并落盘。
  // 用 `||` 一步覆盖 null / "" / undefined 三种 falsy，对齐 Python
  // `if not self._data.get("runtime_id")` 的语义。
  // 注：interface 声明 runtime_id 为 string（非 nullable），但用户 config.json
  // 可能写 `"runtime_id": null`，合并后 data.runtime_id 实际为 null ——
  // `|| randomUUID()` 把它纠正回 string，保证运行时与类型一致。
  // 触发条件：①全新身份（无 legacy 也无 per-server）②per-server 缺 runtime_id。
  // 若迁移已注入 runtime_id 或 per-server 已存 runtime_id，则不重生（身份稳定）。
  const generated = !data.runtime_id;
  if (generated) {
    data.runtime_id = randomUUID();
  }
  // 落盘条件（对齐 Python config.py:51 `self.save()` 的「自动生成后立即落盘」+ 迁移固化）：
  //   - generated：runtime_id 刚生成 → 必须落盘
  //   - migrated：从 legacy 迁移了 runtime_id → 必须落盘固化到 per-server（否则丢失）
  //   - !perServerExisted：目标文件原本不存在（全新 per-server，无论路径来源）→ 落盘新建
  // 仅当目标文件已存在且未迁移且未生成时，跳过落盘（避免每次启动无谓写盘，T11 守护）。
  if (generated || migrated || !perServerExisted) {
    await saveConfig(data, path);
  }

  // ── spec_root_map env 覆盖（2026-06-22-agent-run-pipeline-fix task-02）──
  // daemon 启动脚本（daemon-start.bat 等）注入 SPEC_ROOT_MAP，优先于 config.json。
  // 不落盘（避免 host 路径被序列化到 config.json，跨机器冲突）。
  // env !== undefined 即覆盖（含空串，空串 = 显式关闭翻译）。
  // 详见 design §4.1 A1 第 2 层、§9 兼容策略。
  const envSpecRootMap = process.env.SPEC_ROOT_MAP;
  if (envSpecRootMap !== undefined) {
    data.spec_root_map = envSpecRootMap;
  }

  return data;
}

// ── normalizeAllowedRoots（私有纯函数，规范化白名单数组）─────────────────────

/**
 * 规范化 allowed_roots：处理缺字段/非数组/相对路径/重复项/脏数据/Windows 路径。
 *
 * 纯函数，不修改入参，始终返回全新数组（满足 R-3：loadConfig 用返回值覆盖
 * DEFAULT 浅拷贝共享的数组引用）。
 *
 * 边界处理（task-02.md §6）：
 *   - B1 缺字段 / 非数组 / 空数组 / 过滤后空 → 回填默认 [homedir()]
 *   - B4 相对路径 → path.resolve（基于 process.cwd()）
 *   - B5 Windows 路径：path.resolve 在 win32 自动统一反斜杠/盘符；不归一大小写
 *   - B6 去重保序（首次出现优先，Set）
 *   - B7 非字符串 / 空串元素被 filter 掉
 *
 * @param raw 从 JSON 合并后的原始值（可能 undefined / 非数组 / 含相对路径 / 脏数据）。
 * @returns 规范化后的非空绝对路径数组（去重保序，全新数组）。
 */
export function normalizeAllowedRoots(raw: unknown): string[] {
  // B1：缺字段 / 非数组 / 空数组 → 回填默认 [homedir()]
  if (!Array.isArray(raw) || raw.length === 0) {
    return [homedir()];
  }

  // B7：filter 掉非 string / 空串；B4：resolve 相对路径为绝对路径。
  // B5：path.resolve 在 win32 自动处理反斜杠/盘符；不归一大小写（交由 task-05）。
  const resolved = (raw as unknown[])
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .map((p) => resolve(p));

  // B1 兜底：全部为脏数据（filter 后空）→ 回填默认
  if (resolved.length === 0) {
    return [homedir()];
  }

  // B6：去重保序（首次出现优先，Set 维护插入序）
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const p of resolved) {
    if (!seen.has(p)) {
      seen.add(p);
      deduped.push(p);
    }
  }
  return deduped;
}

// ── saveConfig（写 JSON + 自动建父目录）─────────────────────────────────────

/**
 * 保存配置到 config.json。
 *
 * 行为对齐 Python `DaemonConfig.save()`（config.py:53-57）：
 *
 * 1. `mkdir(dirname(path), { recursive: true })`（等价 Python
 *    `self._path.parent.mkdir(parents=True, exist_ok=True)`）。
 * 2. `writeFile(path, JSON.stringify(config, null, 2), 'utf-8')`
 *    （等价 Python `json.dump(self._data, f, indent=2)`，indent=2 与 Python 一致，
 *    保证 git diff 友好 + 跨版本字节一致）。
 *
 * @param config 要保存的配置对象。
 * @param path   目标路径，默认 `DEFAULT_CONFIG_PATH`。
 */
export async function saveConfig(
  config: DaemonConfig,
  path: string = DEFAULT_CONFIG_PATH,
): Promise<void> {
  // step 1: 递归建父目录（嵌套不存在的 a/b/c/ 也能自动创建）。
  await mkdir(dirname(path), { recursive: true });
  // step 2: 写 JSON（indent=2，UTF-8）。
  await writeFile(path, JSON.stringify(config, null, 2), 'utf-8');
}

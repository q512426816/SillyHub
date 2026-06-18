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
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

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
 */
export const DEFAULT_CONFIG_PATH: string = join(DEFAULT_CONFIG_DIR, 'config.json');

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
});

// ── loadConfig（异步加载 + 合并默认 + 自动生成 runtime_id）──────────────────

/**
 * 从 config.json 加载配置。
 *
 * 行为对齐 Python `DaemonConfig._load()`（config.py:41-51）：
 *
 * 1. 起始 = 浅拷贝 `DEFAULT_CONFIG`（不污染常量）。
 * 2. 文件存在 → `readFile` + `JSON.parse`，结果**浅合并**到 _data
 *    （`Object.assign`，等价 Python `self._data.update(saved)`）。
 *    缺字段自动补默认；DaemonConfig 全是扁平字段，浅合并即正确。
 * 3. `runtime_id` 为空/null/falsy（`""` / `null` / `undefined`）→
 *    生成 `randomUUID()` 并立即 `saveConfig()` 落盘（对齐 Python config.py:49-51）。
 * 4. 返回合并后的完整配置。
 *
 * 异常策略（对齐 Python「宽容加载，严格使用」）：
 *   - JSON 损坏 → `JSON.parse` 抛 `SyntaxError` 原样冒泡，不吞不降级
 *     （否则用户配置静默丢失，违反 G-01 等价原则）。
 *   - 空文件 → `JSON.parse('')` 抛 `SyntaxError` 同样冒泡。
 *   - 路径不可写（`saveConfig` 内 mkdir/writeFile EACCES/ENOSPC）→ 原样抛出，
 *     daemon 应停止而非带病运行（YAGNI，不 retry 不降级）。
 *   - `server_url` 为空 → 不报错，交由 hub-client 在实际请求时失败。
 *
 * @param path 配置文件路径，默认 `DEFAULT_CONFIG_PATH`。
 * @returns 合并后的完整配置（所有字段必有值）。
 */
export async function loadConfig(
  path: string = DEFAULT_CONFIG_PATH,
): Promise<DaemonConfig> {
  // step 1: 浅拷贝起始数据（避免污染 DEFAULT_CONFIG 常量）。
  const data: DaemonConfig = { ...DEFAULT_CONFIG };

  // step 2: 文件存在则读 + 解析 + 浅合并。
  // 用 existsSync 而非 fs/promises.access + try/catch：启动一次性调用，语义直观。
  if (existsSync(path)) {
    const raw = await readFile(path, 'utf-8');
    // JSON 损坏/空文件时 JSON.parse 抛 SyntaxError，原样冒泡到调用方。
    const saved = JSON.parse(raw) as Partial<DaemonConfig>;
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

  // step 3: runtime_id 为空/null/undefined（边界 R5）→ 生成 uuid 并落盘。
  // 用 `||` 一步覆盖 null / "" / undefined 三种 falsy，对齐 Python
  // `if not self._data.get("runtime_id")` 的语义。
  // 注：interface 声明 runtime_id 为 string（非 nullable），但用户 config.json
  // 可能写 `"runtime_id": null`，合并后 data.runtime_id 实际为 null ——
  // `|| randomUUID()` 把它纠正回 string，保证运行时与类型一致。
  if (!data.runtime_id) {
    data.runtime_id = randomUUID();
    // 对齐 Python config.py:51 `self.save()`：自动生成后立即落盘。
    await saveConfig(data, path);
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
function normalizeAllowedRoots(raw: unknown): string[] {
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

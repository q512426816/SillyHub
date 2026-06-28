/**
 * preflight.ts —— daemon 启动前预检（sillyspec 版本 + daemon 自更新）。
 *
 * 两项独立的自动更新，任一失败仅记 warn，不阻断 daemon 启动：
 *
 * 功能1（sillyspec CLI）：
 *   - 本地版本 `sillyspec --version`，最新版本 `npm view sillyspec version`
 *   - 未安装或版本落后 → `npm install -g sillyspec@latest`
 *   - npm view 不可达 / 安装失败 → 仅 warn
 *
 * 功能2（daemon 自身）：
 *   - 本地构建标识 {@link BUILD_ID}（release 时为 git SHA）
 *   - 服务器最新版本 `fetch ${server_url}/daemon/latest.json` → { version, url, publishedAt }
 *   - version 与本地 SHA 不一致 → 从 url 下载新 bundle，原子替换
 *     ~/.sillyhub/daemon/bin/sillyhub-daemon.js，warn 提示需重启
 *   - 服务器不可达 / 下载失败 → 仅 warn
 *
 * 同步性：sillyspec 检查/安装用 `execSync`（启动阶段同步可控，npm install 可能
 * 耗时数十秒，刻意阻塞以确保启动前 CLI 就绪）；daemon 自更新用 Node 20 原生
 * fetch（异步）。两者皆在 runPreflight 内 try/catch 隔离。
 *
 * 可测性：除公开入口 {@link runPreflight} 外，导出 {@link runSillySpecCheck} /
 * {@link runDaemonSelfUpdate} 供单测直接调用（buildId / binDir 可注入）。
 *
 * @module preflight
 */

import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import type { DaemonConfig } from './config.js';
import { BUILD_ID } from './build-id.js';
import { parseSemver, type SemVerTuple } from './version.js';

// ── 类型（日志回调签名）─────────────────────────────────────────────────────

/** 日志级别，与 daemon.Logger 对齐（createLogger 接受的 level）。 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * 预检日志回调签名：`(level, 事件名, 结构化字段?)`。
 * 由调用方（daemon.start）适配成内部 Logger 的 debug/info/warn/error 方法。
 */
export type PreflightLogger = (
  level: LogLevel,
  msg: string,
  data?: Record<string, unknown>,
) => void;

// ── 路径常量（对齐 scripts/install.sh 的 BIN_DIR / BUNDLE_NAME）──────────────

/**
 * daemon bundle 落盘目录 `~/.sillyhub/daemon/bin`。
 * 对齐 install.sh 的 `BIN_DIR="${HOME}/.sillyhub/daemon/bin"`，install.sh 与
 * 本模块写同一文件，保证自更新后 install.sh 创建的 wrapper 仍指向新 bundle。
 */
const DAEMON_BIN_DIR: string = join(homedir(), '.sillyhub', 'daemon', 'bin');

/** daemon bundle 文件名，对齐 install.sh 的 `BUNDLE_NAME="sillyhub-daemon.js"`。 */
const DAEMON_BUNDLE_NAME = 'sillyhub-daemon.js';

/** latest.json 描述的服务器版本信息结构。 */
interface LatestInfo {
  /** 最新构建标识（git short SHA）。 */
  version: string;
  /** bundle 下载地址（相对路径由调用方拼接 server_url）。 */
  url: string;
  /** 发布时间（ISO 字符串，仅记录用，可选）。 */
  publishedAt?: string;
}

// ── 入口 ─────────────────────────────────────────────────────────────────────

/**
 * 启动前预检：先 sillyspec 版本检查，再 daemon 自更新。两步独立、互不影响，
 * 任一步骤抛错仅记 warn 不向上冒泡（runPreflight 自身永不 reject），保证
 * 不阻断 daemon 启动。
 *
 * @param config daemon 配置（取 server_url 拉取 latest.json）
 * @param logger 日志回调
 */
export async function runPreflight(
  config: DaemonConfig,
  logger: PreflightLogger,
): Promise<void> {
  // 步骤隔离：sillyspec 检查（同步 execSync）失败不影响 daemon 自更新，反之亦然。
  try {
    runSillySpecCheck(logger);
  } catch (e) {
    logger('warn', 'preflight_sillyspec_unexpected', { error: fmtErr(e) });
  }
  try {
    await runDaemonSelfUpdate(BUILD_ID, config, logger);
  } catch (e) {
    logger('warn', 'preflight_daemon_update_unexpected', { error: fmtErr(e) });
  }
}

// ── 功能1：sillyspec 版本检查 + 自动安装 ─────────────────────────────────────

/**
 * 检查本机 sillyspec 是否安装且为最新，否则执行 `npm install -g sillyspec@latest`。
 *
 * 同步实现（execSync）：启动阶段执行，npm install 可能耗时数十秒，刻意阻塞
 * 以保证 daemon 启动前 sillyspec CLI 可用（spec 流程依赖）。
 *
 * 分支：
 *   - `npm view sillyspec version` 失败（npm 不可达/包不存在）→ warn 返回，不安装；
 *   - `sillyspec --version` 失败（未安装）→ 安装；
 *   - 本地 < 最新（semver 比较，或字符串不等）→ 安装；
 *   - 本地 == 最新 → debug 记录，不安装。
 *
 * @param logger 日志回调
 */
export function runSillySpecCheck(logger: PreflightLogger): void {
  const localVersion = runCmd('sillyspec --version');
  const latestVersion = runCmd('npm view sillyspec version');

  if (latestVersion === null) {
    // npm 不可达 / 包不存在 → 无法判断最新版，warn 不安装（不阻断启动）。
    logger('warn', 'sillyspec_latest_unavailable');
    return;
  }

  if (localVersion === null) {
    // 未安装 → 安装最新版。
    logger('info', 'sillyspec_not_installed', { latest: latestVersion });
    installSillySpec(logger);
    return;
  }

  if (isOutdated(localVersion, latestVersion)) {
    logger('info', 'sillyspec_outdated', {
      local: localVersion,
      latest: latestVersion,
    });
    installSillySpec(logger);
    return;
  }

  logger('debug', 'sillyspec_up_to_date', { version: localVersion });
}

/**
 * 执行 `npm install -g sillyspec@latest` 安装/升级 sillyspec。
 * 失败仅记 warn（runCmdFailed 内部已记 cmd_failed）。
 */
function installSillySpec(logger: PreflightLogger): void {
  const ok = runCmdBoolean('npm install -g sillyspec@latest', logger);
  if (ok) {
    logger('info', 'sillyspec_updated');
  }
  // 失败已在 runCmdBoolean 内记 warn，此处不重复。
}

// ── 功能2：daemon 自身版本检查 + 自更新 ──────────────────────────────────────

/**
 * 检查 daemon 自身构建标识与服务器最新版本，不一致则下载新 bundle 原子替换。
 *
 * @param buildId  本地构建标识（release=git SHA，dev 占位 "dev"）
 * @param config   daemon 配置（取 server_url）
 * @param logger   日志回调
 * @param binDir   bundle 落盘目录，默认 {@link DAEMON_BIN_DIR}（测试注入临时目录）
 */
export async function runDaemonSelfUpdate(
  buildId: string,
  config: DaemonConfig,
  logger: PreflightLogger,
  binDir: string = DAEMON_BIN_DIR,
): Promise<void> {
  // dev 构建（占位 "dev"）跳过自更新：本地开发无 SHA 注入，latest.version
  // 恒不为 "dev"，跑了也只是每次启动徒劳下载最新 bundle 覆盖本地开发版本。
  if (!buildId || buildId === 'dev') {
    logger('debug', 'daemon_self_update_skip_dev_build');
    return;
  }

  const latest = await fetchLatest(config, logger);
  if (latest === null) return; // 拉取失败已记 warn

  if (latest.version === buildId) {
    logger('debug', 'daemon_up_to_date', { version: buildId });
    return;
  }

  logger('info', 'daemon_newer_available', {
    current: buildId,
    latest: latest.version,
  });

  // 相对 URL → 拼接 server_url
  let fullUrl = latest.url;
  if (!fullUrl.startsWith('http')) {
    const base = config.server_url.replace(/\/+$/, '');
    fullUrl = `${base}${fullUrl.startsWith('/') ? '' : '/'}${fullUrl}`;
  }

  const updated = await downloadAndReplace(fullUrl, latest.version, buildId, binDir, logger);

  if (updated) {
    // 替换成功 → 优雅退出，等外部 supervisor（install.sh wrapper）重启拉起新版本。
    logger('info', 'daemon_self_update_restart', {
      from: buildId,
      to: latest.version,
    });
    setTimeout(() => process.exit(0), 500); // 给日志 flush 500ms
  }
}

/**
 * 拉取 latest.json 并校验结构。失败（网络/非 2xx/解析/字段缺失）返回 null
 * 并记 warn。
 */
async function fetchLatest(
  config: DaemonConfig,
  logger: PreflightLogger,
): Promise<LatestInfo | null> {
  // 去尾斜杠，避免 `${base}//daemon/latest.json`（对齐 daemon._serverOrigin）。
  const base = config.server_url.replace(/\/+$/, '');
  const url = `${base}/daemon/latest.json`;

  let resp: Response;
  try {
    resp = await fetch(url);
  } catch (e) {
    logger('warn', 'daemon_latest_fetch_failed', { url, error: fmtErr(e) });
    return null;
  }
  if (!resp.ok) {
    logger('warn', 'daemon_latest_fetch_non_ok', { url, status: resp.status });
    return null;
  }

  let body: unknown;
  try {
    body = await resp.json();
  } catch (e) {
    logger('warn', 'daemon_latest_parse_failed', { url, error: fmtErr(e) });
    return null;
  }

  const obj = body as Partial<LatestInfo> & Record<string, unknown> | null;
  // 兼容服务端 downloadUrl 和 preflight 原有 url 两种字段名
  const downloadUrl = obj?.url ?? obj?.downloadUrl ?? obj?.download_url;
  if (
    !obj
    || typeof obj.version !== 'string'
    || typeof downloadUrl !== 'string'
    || obj.version === ''
    || downloadUrl === ''
  ) {
    logger('warn', 'daemon_latest_invalid_shape', { url });
    return null;
  }

  return {
    version: obj.version,
    url: downloadUrl,
    publishedAt:
      typeof obj.publishedAt === 'string' ? obj.publishedAt : undefined,
  };
}

/**
 * 下载新 bundle 并原子替换落盘文件（tmp + rename）。
 *
 * 替换正在运行的 bundle 是安全的：node 已把当前进程代码加载进内存，本次进程
 * 不受影响；下次 daemon 启动（install.sh 的 wrapper exec node bundle.js）才
 * 加载新文件 → 故 warn 提示需重启。
 *
 * 下载失败 / 写盘失败 → 仅 warn。
 */
async function downloadAndReplace(
  fullUrl: string,
  newVersion: string,
  currentId: string,
  binDir: string,
  logger: PreflightLogger,
): Promise<boolean> {
  let resp: Response;
  try {
    resp = await fetch(fullUrl);
  } catch (e) {
    logger('warn', 'daemon_bundle_download_failed', {
      url: fullUrl,
      error: fmtErr(e),
    });
    return false;
  }
  if (!resp.ok) {
    logger('warn', 'daemon_bundle_download_non_ok', {
      url: fullUrl,
      status: resp.status,
    });
    return false;
  }

  const buf = Buffer.from(await resp.arrayBuffer());
  const target = join(binDir, DAEMON_BUNDLE_NAME);
  const tmp = `${target}.tmp`;
  try {
    await mkdir(binDir, { recursive: true });
    await writeFile(tmp, buf);
    // rename 原子替换：避免下载中途写坏 target 导致下次启动加载半截 bundle。
    await rename(tmp, target);
  } catch (e) {
    logger('warn', 'daemon_bundle_write_failed', {
      target,
      error: fmtErr(e),
    });
    return false;
  }

  logger('warn', 'daemon_self_updated_need_restart', {
    from: currentId,
    to: newVersion,
    target,
  });
  return true;
}

// ── 工具：同步执行 shell 命令 ─────────────────────────────────────────────────

/**
 * 执行命令返回 stdout（trim）。失败（ENOENT / 非零退出 / 超时）返回 null。
 *
 * stdio: stdin/stderr 忽略，只捕获 stdout（npm/sillyspec 的版本号走 stdout；
 * npm 的 deprecation warning 走 stderr，忽略避免污染日志）。
 *
 * @param cmd shell 命令字符串
 * @returns stdout（trim 后）或 null（失败）
 */
function runCmd(cmd: string): string | null {
  try {
    const out = execSync(cmd, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 30_000,
    });
    const trimmed = out.trim();
    return trimmed || null;
  } catch {
    // 静默失败：调用方据 null 判定（未安装 / 不可达）。
    return null;
  }
}

/**
 * 执行安装类命令（无 stdout 需求），成功返回 true，失败记 warn 返回 false。
 *
 * timeout 120s：npm install -g 可能下载依赖较慢，给足时间但避免无限挂起。
 */
function runCmdBoolean(cmd: string, logger: PreflightLogger): boolean {
  try {
    execSync(cmd, {
      encoding: 'utf-8',
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 120_000,
    });
    return true;
  } catch (e) {
    logger('warn', 'cmd_failed', { cmd, error: fmtErr(e) });
    return false;
  }
}

// ── 工具：版本比较 + 错误格式化 ───────────────────────────────────────────────

/**
 * 判断本地版本是否旧于最新版本。
 *
 * 两边都能 parseSemver → 三元组字典序比较（major > minor > patch）；
 * 任一无法解析（非 semver，如含日期的 dev 版）→ 字符串不等即视为旧
 * （让 `npm view` 返回非标准版本时仍能触发更新，与用户「版本低→更新」语义一致）。
 */
function isOutdated(local: string, latest: string): boolean {
  const a = parseSemver(local);
  const b = parseSemver(latest);
  if (a && b) return isTupleOlder(a, b);
  return local !== latest;
}

/** 三元组 a < b（字典序）。SemVerTuple 是定长元组，索引访问无 undefined。 */
function isTupleOlder(a: SemVerTuple, b: SemVerTuple): boolean {
  if (a[0] !== b[0]) return a[0] < b[0];
  if (a[1] !== b[1]) return a[1] < b[1];
  return a[2] < b[2];
}

/** 格式化 unknown 错误为字符串（Error 取 message，其余 String()）。 */
function fmtErr(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

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
 * 异步性：sillyspec 检查/安装用 spawn+超时杀树（runWithTreeKill，启动阶段执行，
 * 耗时数十秒，刻意阻塞以确保启动前 CLI 就绪）；daemon 自更新用 Node 20 原生
 * fetch（异步）。两者皆在 runPreflight 内 try/catch 隔离。
 *
 * 可测性：除公开入口 {@link runPreflight} 外，导出 {@link runSillySpecCheck} /
 * {@link runDaemonSelfUpdate} 供单测直接调用（buildId / binDir 可注入）。
 *
 * @module preflight
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import type { DaemonConfig } from './config.js';
import { BUILD_ID } from './build-id.js';
import { parseSemver, type SemVerTuple } from './version.js';
import { parseJsonFromResponse } from './hub-client.js';

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
  // 步骤隔离：sillyspec 检查（async spawn+超时杀树）失败不影响 daemon 自更新，反之亦然。
  try {
    await runSillySpecCheck(logger);
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
 * 异步实现（runWithTreeKill spawn+超时杀树）：启动阶段执行，npm install 可能耗时数十秒，刻意阻塞
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
export async function runSillySpecCheck(logger: PreflightLogger): Promise<void> {
  const localVersion = await runCmd('sillyspec --version');
  const latestVersion = await runCmd('npm view sillyspec version');

  if (latestVersion === null) {
    // npm 不可达 / 包不存在 → 无法判断最新版，warn 不安装（不阻断启动）。
    logger('warn', 'sillyspec_latest_unavailable');
    return;
  }

  if (localVersion === null) {
    // 未安装 → 安装最新版。
    logger('info', 'sillyspec_not_installed', { latest: latestVersion });
    await installSillySpec(logger);
    return;
  }

  if (isOutdated(localVersion, latestVersion)) {
    logger('info', 'sillyspec_outdated', {
      local: localVersion,
      latest: latestVersion,
    });
    await installSillySpec(logger);
    return;
  }

  logger('debug', 'sillyspec_up_to_date', { version: localVersion });
}

/**
 * 执行 `npm install -g sillyspec@latest` 安装/升级 sillyspec。
 * 失败仅记 warn（runCmdFailed 内部已记 cmd_failed）。
 */
async function installSillySpec(logger: PreflightLogger): Promise<void> {
  const ok = await runCmdBoolean('npm install -g sillyspec@latest', logger);
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

  // 紧急运维开关：SKIP_DAEMON_SELF_UPDATE=1 完全跳过 daemon 自更新
  //（sillyspec 检查仍跑）。用于锁版本 / 服务器分发 manifest 过期导致循环降级时。
  if (process.env.SKIP_DAEMON_SELF_UPDATE === '1') {
    logger('info', 'daemon_self_update_skip_env');
    return;
  }

  const latest = await fetchLatest(config, logger);
  if (latest === null) return; // 拉取失败已记 warn

  if (latest.version === buildId) {
    logger('debug', 'daemon_up_to_date', { version: buildId });
    return;
  }

  // 防降级保护：version 格式 `<gitsha8>-<YYYYMMDDHHMMSS>`，解析时间戳部分比较。
  // 本地构建时间 >= 服务器分发时间 → 本地更新或同等，跳过（避免本地开发/新版
  // 被服务器旧分发无脑降级覆盖，形成"启动→降级→exit→重启→再降级"死循环）。
  // 解析失败（格式异常）回退原行为（不等就更新），保持对非标准 version 的兼容。
  const localTs = extractBuildTimestamp(buildId);
  const remoteTs = extractBuildTimestamp(latest.version);
  if (localTs && remoteTs && localTs >= remoteTs) {
    logger('info', 'daemon_self_update_skip_local_newer', {
      current: buildId,
      latest: latest.version,
    });
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
    body = await parseJsonFromResponse(resp);
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

// ── 工具：异步执行 shell 命令 + 超时杀进程树 ─────────────────────────────────

/**
 * 杀整个进程树（含孙进程）。Windows 上 execSync/spawnSync 的 timeout 只 SIGTERM
 * 直接子进程，杀不掉 .cmd wrapper（npm.cmd/claude.cmd）spawn 的孙 node.exe，
 * 导致 daemon 卡死在 preflight（2026-08-12 CPU profile 实证：97.7% ntdll，
 * spawnSync←execSync←runCmd←runSillySpecCheck）。taskkill /T /F 与进程组 kill
 * 能真正杀树，超时后调用确保 daemon 不被卡住的 npm view 拖死。
 *
 * 跨平台：
 * - Windows: `taskkill /PID <pid> /T /F`（/T 含孙进程，/F 强制）
 * - Linux/macOS: `process.kill(-<pgid>)`（detached:true 时子进程自成进程组，
 *   负 pid 杀整组；失败兜底递归 kill 已知子 pid）
 */
function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (typeof pid !== 'number') return;
  try {
    if (process.platform === 'win32') {
      // taskkill /T 杀进程树（含 npm.cmd spawn 的孙 node.exe），/F 强制。
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } else {
      // 进程组 kill（spawn 时 detached:true 使子自成组长，负 pid 杀整组）。
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        process.kill(pid, 'SIGKILL');
      }
    }
  } catch {
    // 杀树失败不抛（最坏情况是孙进程残留，已设 timeout 兜底；不阻塞 daemon）。
  }
}

/**
 * 异步执行命令，超时杀整树。返回 { ok, stdout }。
 *
 * 用 spawn（异步）+ Promise.race(timeout)：超时调 killTree（taskkill /T 或进程组
 * kill）真正杀孙进程，避免 execSync timeout 在 Windows 上杀不掉 npm 孙进程卡死。
 *
 * @param cmd shell 命令字符串（经 shell 执行，兼容 npm.cmd wrapper / 管道）
 * @param timeoutMs 超时毫秒，到期杀树 reject
 * @param captureStdout 是否捕获 stdout（runCmd=true / runCmdBoolean=false）
 */
function runWithTreeKill(
  cmd: string,
  timeoutMs: number,
  captureStdout: boolean,
): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, {
      shell: true,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', captureStdout ? 'pipe' : 'ignore', 'ignore'],
    });
    let stdoutChunks: Buffer[] = [];
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdout = captureStdout
        ? Buffer.concat(stdoutChunks).toString('utf-8')
        : '';
      resolve({ ok, stdout });
    };

    if (captureStdout && child.stdout) {
      child.stdout.on('data', (c: Buffer) => stdoutChunks.push(c));
    }
    child.on('error', () => finish(false)); // ENOENT 等
    child.on('close', (code) => finish(code === 0));

    const timer = setTimeout(() => {
      killTree(child);
      finish(false);
    }, timeoutMs);
  });
}

/**
 * 执行命令返回 stdout（trim）。失败（ENOENT / 非零退出 / 超时杀树）返回 null。
 *
 * 2026-08-12：从 execSync（timeout Win 不杀孙进程）改为 runWithTreeKill（spawn
 * + 超时 taskkill /T 杀树），修 daemon 启动被卡住的 npm view 拖死。
 *
 * async：runSillySpecCheck → runPreflight 已是 async，调用方 await。
 *
 * @param cmd shell 命令字符串
 * @returns stdout（trim 后）或 null（失败）
 */
async function runCmd(cmd: string): Promise<string | null> {
  const { ok, stdout } = await runWithTreeKill(cmd, 30_000, true);
  if (!ok) return null;
  const trimmed = stdout.trim();
  return trimmed || null;
}

/**
 * 执行安装类命令（无 stdout 需求），成功返回 true，失败记 warn 返回 false。
 *
 * timeout 120s：npm install -g 可能下载依赖较慢，给足时间但避免无限挂起
 * （超时后 killTree 杀整树，不再阻塞）。
 *
 * 2026-08-12：execSync → runWithTreeKill（同 runCmd，修 Windows 超时杀树）。
 */
async function runCmdBoolean(
  cmd: string,
  logger: PreflightLogger,
): Promise<boolean> {
  const { ok } = await runWithTreeKill(cmd, 120_000, false);
  if (!ok) {
    logger('warn', 'cmd_failed', { cmd });
    return false;
  }
  return true;
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

/**
 * 从 daemon 构建 version 串提取时间戳（YYYYMMDDHHMMSS，14 位数字字符串）。
 *
 * version 格式 `<gitsha8>-<YYYYMMDDHHMMSS>`（如 `66ac0478-20260720160736`），
 * 取最后一个 `-` 后的部分，校验为 14 位数字才返回，否则 null（格式异常，调用方
 * 回退原行为）。
 */
function extractBuildTimestamp(version: string): string | null {
  const idx = version.lastIndexOf('-');
  if (idx < 0 || idx === version.length - 1) return null;
  const ts = version.slice(idx + 1);
  return /^\d{14}$/.test(ts) ? ts : null;
}

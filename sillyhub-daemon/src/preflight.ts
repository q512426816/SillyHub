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
 *   - version 与本地 SHA 不一致 → 从 url 下载新 bundle，内容校验通过且旧文件
 *     已备份后原子替换 ~/.sillyhub/daemon/bin/sillyhub-daemon.js（mcp-server.js
 *     同目录 best-effort 伴生替换，同校验同备份），返回 true；调用方（启动期
 *     runPreflight / WS SELF_UPDATE）据 true 调 respawnDaemonAndExit 以 detached
 *     子进程拉起新版本后退出旧进程
 *   - 服务器不可达 / 下载失败 / 内容校验不过 → 仅 warn，返回 false 保持运行
 *
 * 内容校验（D-003，2026-08-30-daemon-self-heal）：{@link validateBundleContent}
 * 以「≥ {@link MIN_BUNDLE_BYTES} 且可提取 BUILD_ID」为共享校验口径——防线 2
 * （下载内容不过校验不落盘）与防线 3（坏盘不被 respawn 拉起）共用，拦
 * 'NEW BUNDLE BODY' 类占位/半截 bundle。
 *
 * 备份轮换（D-004，2026-08-30-daemon-self-heal）：downloadAndReplace 在 rename
 * 前把既有 bundle 复制为 `<target>.bak-<yyyyMMdd-HHmmss>`，同前缀按文件名字典
 * 序保留最近 3 份（纯数字定长时间戳，字典序即时间序，跨平台一致）。备份失败
 * 仅 warn 不阻塞替换——人工兜底路径，不拦自更新主线。
 *
 * respawn 最后防线（D-005，2026-08-30-daemon-self-heal）：
 * {@link respawnDaemonAndExit} spawn 前以 {@link validateBundleOnDisk} 复核
 * 盘上 bundle，不过 → error `daemon_self_update_respawn_validation_failed`
 * + 提前 return 不退出（不 spawn、不排定 exit，旧进程保活；启动路径正常
 * 继续启动旧逻辑）。函数因该校验 async 化（Promise<void>，plan 审查问题 3
 * 裁定方案 a），daemon.ts 两处调用点 fire-and-forget 零义务兼容（全路径
 * 自收敛不 reject）。
 *
 * 异步性：sillyspec 检查/安装用 spawn+超时杀树（runWithTreeKill，启动阶段执行，
 * 耗时数十秒，刻意阻塞以确保启动前 CLI 就绪）；daemon 自更新用 Node 20 原生
 * fetch（异步）。两者皆在 runPreflight 内 try/catch 隔离。
 *
 * 可测性：除公开入口 {@link runPreflight} 外，导出 {@link runSillySpecCheck} /
 * {@link runDaemonSelfUpdate} / {@link fetchLatestBuildId}（task-04：仅取
 * latest.json version，daemon 推迟路径目标版本回传）供单测直接调用
 * （buildId / binDir 可注入；{@link runPreflight} 第三参 binDir 同为测试
 * 隔离注入——生产调用点不传，默认盘上目录，行为不变）。
 *
 * @module preflight
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { mkdir, readFile, writeFile, rename, unlink, copyFile, readdir, access } from 'node:fs/promises';
import type { DaemonConfig } from './config.js';
import { daemonBinDir } from './config.js';
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
 * 2026-08-31 收口：派生 config.daemonBinDir()（与 daemon.ts 同源，消除双份重声明）；
 * SILLYHUB_DAEMON_DIR 隔离时一并重定向（install.sh 安装形态不受影响——默认态同值）。
 */
const DAEMON_BIN_DIR: string = daemonBinDir();

/** daemon bundle 文件名，对齐 install.sh 的 `BUNDLE_NAME="sillyhub-daemon.js"`。 */
const DAEMON_BUNDLE_NAME = 'sillyhub-daemon.js';

/**
 * MCP server bundle 文件名（与主 bundle 同目录，install.sh 一并安装）。
 * 自更新时 best-effort 伴生替换（URL 从主 bundle URL 同目录推导），失败仅
 * warn 不影响主 bundle 更新；运行中的 MCP 子进程已加载进内存不受影响。
 */
const MCP_SERVER_BUNDLE_NAME = 'mcp-server.js';

// ── bundle 内容校验（D-003：零子进程，防线 2/3 共享口径）─────────────────────

/**
 * bundle 内容可信的大小下限（D-003@v1）：64KB。
 *
 * 实测主 bundle 3,572,030B / mcp-server.js 1,157,632B，64KB 有 17 倍余量；
 * 8-30 事故类 'NEW BUNDLE BODY'（15 字节、无 BUILD_ID）占位/半截内容必被拦。
 */
export const MIN_BUNDLE_BYTES = 65_536;

/**
 * bundle 文本内 BUILD_ID 提取正则，与 daemon.ts 的 DISK_BUILD_ID_RE
 * （daemon.ts:210）同款同值重声明——本模块不可反向 import daemon.ts
 * （daemon.ts 已 import 本模块，会成环）；同值重声明先例：DAEMON_BUNDLE_NAME
 * 两文件各自声明（daemon.ts:200-203 注释）。
 *
 * gen-build-id.mjs 生成 `export const BUILD_ID = "<sha>-<ts>";` 单行，引号
 * 单双皆容；首处匹配即取（bundle 内无前序同形出现）。
 */
const DISK_BUILD_ID_RE = /BUILD_ID\s*=\s*["']([^"']+)/;

/**
 * 校验 bundle 内容可信（D-003@v1，纯函数：零子进程、零 IO、零平台分支，
 * Windows/Linux/macOS 行为一致——Buffer 长度 + 正则）。
 *
 * 口径：size ≥ {@link MIN_BUNDLE_BYTES} 且 {@link DISK_BUILD_ID_RE} 可提取
 * BUILD_ID，任一不过即 ok=false。防线 2（task-02 downloadAndReplace 写盘前）
 * 与防线 3（task-03 respawn / task-07 stop 前盘上复核）共享本口径。
 *
 * @param buf 下载到内存或从盘上读出的 bundle 字节
 * @returns ok=可信与否；buildId=首处提取值（提不出为 null；ok=false 时仍回传
 *          已提取值供日志定位）；size=buf.length
 */
export function validateBundleContent(buf: Buffer): {
  ok: boolean;
  buildId: string | null;
  size: number;
} {
  const size = buf.length;
  const match = DISK_BUILD_ID_RE.exec(buf.toString('utf-8'));
  const buildId = match?.[1] ?? null;
  return { ok: size >= MIN_BUNDLE_BYTES && buildId !== null, buildId, size };
}

/**
 * 校验盘上主 bundle（binDir/sillyhub-daemon.js）内容可信——respawn/stop 前
 * 的最后防线；读失败（文件缺失/权限等）视为不过。
 *
 * 失败仅 debug 记 `daemon_bundle_on_disk_invalid` 明细（label 定位 + 校验不过
 * 时的 size/buildId；读失败时 size/buildId 未知省略，附 error）。权威拦截事件
 * 由调用方记（task-03 respawnDaemonAndExit → error
 * `daemon_self_update_respawn_validation_failed`；task-07 daemon._tryUpdate →
 * warn `daemon_update_aborted_bad_bundle`），本函数只记 debug 明细，避免同一
 * 次拦截双记 warn/error。
 *
 * @param binDir bundle 所在目录（一律由调用方传入，测试注入临时目录）
 * @param logger 日志回调
 * @param label  日志定位标签（区分调用点），默认 {@link DAEMON_BUNDLE_NAME}
 * @returns true=盘上 bundle 可信可拉起；false=读失败或校验不过（已记 debug 明细）
 */
export async function validateBundleOnDisk(
  binDir: string,
  logger: PreflightLogger,
  label?: string,
): Promise<boolean> {
  let buf: Buffer;
  try {
    buf = await readFile(join(binDir, DAEMON_BUNDLE_NAME));
  } catch (e) {
    logger('debug', 'daemon_bundle_on_disk_invalid', {
      label: label ?? DAEMON_BUNDLE_NAME,
      error: fmtErr(e),
    });
    return false;
  }
  const { ok, buildId, size } = validateBundleContent(buf);
  if (!ok) {
    logger('debug', 'daemon_bundle_on_disk_invalid', {
      label: label ?? DAEMON_BUNDLE_NAME,
      size,
      buildId,
    });
    return false;
  }
  return true;
}

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
 * @param binDir bundle 落盘目录，透传 {@link runDaemonSelfUpdate} 与
 *                {@link respawnDaemonAndExit}；undefined 透传即默认
 *                {@link DAEMON_BIN_DIR}。仅测试隔离注入临时目录用（D-006），
 *                生产调用点（daemon.ts start）不传第三参，行为不变
 */
export async function runPreflight(
  config: DaemonConfig,
  logger: PreflightLogger,
  binDir?: string,
): Promise<void> {
  // 步骤隔离：sillyspec 检查（async spawn+超时杀树）失败不影响 daemon 自更新，反之亦然。
  try {
    await runSillySpecCheck(logger);
  } catch (e) {
    logger('warn', 'preflight_sillyspec_unexpected', { error: fmtErr(e) });
  }
  try {
    const updated = await runDaemonSelfUpdate(BUILD_ID, config, logger, binDir);
    if (updated) {
      // 启动期路径：daemon.start() 尚未 acquire runtime lock / 未起三循环，
      // 直接拉起新进程退出（新进程启动后版本一致不再触发更新，无循环风险）。
      // await（task-03）：respawn 已 async 化，await 确保 await runPreflight
      // 返回时 spawn 前的盘上校验已出结果（测试可同步断言拦截/拉起）；
      // respawn 全路径自收敛不 reject，runPreflight 永不 reject 语义不变。
      await respawnDaemonAndExit(logger, binDir);
    }
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
export async function installSillySpec(logger: PreflightLogger): Promise<void> {
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
 * @returns true=主 bundle 已替换需重启（调用方应 respawnDaemonAndExit）；
 *          false=未替换（dev/运维开关/已最新/防降级/拉取或下载失败已 warn）
 */
export async function runDaemonSelfUpdate(
  buildId: string,
  config: DaemonConfig,
  logger: PreflightLogger,
  binDir: string = DAEMON_BIN_DIR,
): Promise<boolean> {
  // dev 构建（占位 "dev"）跳过自更新：本地开发无 SHA 注入，latest.version
  // 恒不为 "dev"，跑了也只是每次启动徒劳下载最新 bundle 覆盖本地开发版本。
  if (!buildId || buildId === 'dev') {
    logger('debug', 'daemon_self_update_skip_dev_build');
    return false;
  }

  // 紧急运维开关：SKIP_DAEMON_SELF_UPDATE=1 完全跳过 daemon 自更新
  //（sillyspec 检查仍跑）。用于锁版本 / 服务器分发 manifest 过期导致循环降级时。
  if (process.env.SKIP_DAEMON_SELF_UPDATE === '1') {
    logger('info', 'daemon_self_update_skip_env');
    return false;
  }

  const latest = await fetchLatest(config, logger);
  if (latest === null) return false; // 拉取失败已记 warn

  if (latest.version === buildId) {
    logger('debug', 'daemon_up_to_date', { version: buildId });
    return false;
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
    return false;
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

  if (!updated) return false; // 下载/写盘失败已记 warn，保持运行

  // mcp-server.js best-effort 伴生替换（失败仅 warn，不影响主 bundle 更新结果）。
  await updateMcpServerBundle(fullUrl, latest.version, binDir, logger);

  logger('info', 'daemon_self_update_restart', {
    from: buildId,
    to: latest.version,
  });
  return true;
}

/**
 * task-04（2026-08-29-daemon-selfupdate-safety / S1）：拉取 latest.json 仅取
 * version（目标版本回传等价接口）。
 *
 * 背景：WS SELF_UPDATE 指令的忙推迟路径要往 pending-update.json 写
 * target_version，指令 payload 的 version 缺失时需要单独拉一次 latest.json 取
 * 目标——不动 runDaemonSelfUpdate 的 boolean 返回（既有调用方/测试零改动），
 * 以伴生函数复用同一 fetchLatest（同 URL 拼接 + 严格结构校验 + 失败 warn）。
 *
 * 永不 reject（fetchLatest 内部 fetch/解析全 try/catch 收敛）；失败返回 null，
 * 调用方（daemon._deferUpdate）以 '<disk>' 占位兜底。
 *
 * @param config daemon 配置（取 server_url）
 * @param logger 日志回调
 * @returns latest.json 的 version 字符串；拉取失败/结构无效 → null
 */
export async function fetchLatestBuildId(
  config: DaemonConfig,
  logger: PreflightLogger,
): Promise<string | null> {
  const latest = await fetchLatest(config, logger);
  return latest?.version ?? null;
}

/**
 * 伴生更新 `mcp-server.js`（与主 bundle 同目录同版本分发）。
 *
 * URL 推导：latest.json 只描述主 bundle URL，mcp-server.js 按「同目录同名段」
 * 替换文件名推导（backend dist_router 两个文件同在 /daemon/latest/ 下）。
 * 主 bundle URL 不以 sillyhub-daemon.js 结尾（自定义分发形态）→ debug 跳过。
 */
async function updateMcpServerBundle(
  daemonBundleUrl: string,
  newVersion: string,
  binDir: string,
  logger: PreflightLogger,
): Promise<void> {
  if (!daemonBundleUrl.endsWith(DAEMON_BUNDLE_NAME)) {
    logger('debug', 'mcp_server_update_skip_url_shape', { url: daemonBundleUrl });
    return;
  }
  const mcpUrl = daemonBundleUrl.slice(0, -DAEMON_BUNDLE_NAME.length)
    + MCP_SERVER_BUNDLE_NAME;
  const ok = await downloadAndReplace(
    mcpUrl,
    newVersion,
    '(unknown)',
    binDir,
    logger,
    MCP_SERVER_BUNDLE_NAME,
    'mcp_server_self_updated',
  );
  if (!ok) {
    // best-effort：主 bundle 已替换成功，mcp 旧版不阻塞重启（新 MCP 子进程
    // 下次会话 spawn 时若文件已换则用新版；保持旧文件也不影响主流程）。
    logger('warn', 'mcp_server_update_failed_keep_old', { url: mcpUrl });
  }
}

/**
 * 以 detached 子进程拉起新 bundle（复用当前进程的启动参数）并安排退出旧进程。
 *
 * 背景：仓库不存在外部 supervisor——install.sh/ps1 的 wrapper 是一次性
 * `exec node bundle.js`（无重启循环），也没注册 systemd/Windows 服务/计划
 * 任务，自更新后仅 process.exit 会"更新完就死"。故退出前自行拉起新版本。
 *
 * 防线 3（D-005，最后防线）：spawn 前先 {@link validateBundleOnDisk} 复核
 * 盘上 bundle——拦"下载内容可信但落盘后、拉起前盘又被写坏"或外部写入的
 * 坏盘，避免拉起的新进程加载半截 bundle SyntaxError 静默死。校验不过
 * （或读失败）→ error `daemon_self_update_respawn_validation_failed`
 * + 提前 return **不退出**（不 spawn、不排定 exit，旧进程保活）。拦截
 * 语义随调用点：
 *   - runPreflight 启动路径（无 stop）：拦截后正常继续启动旧逻辑；
 *   - daemon._tryUpdate 路径正常到不了此——主拦截在 stop 前（D-009，
 *     warn `daemon_update_aborted_bad_bundle`），本函数仅覆盖极端窗口，
 *     到达则停摆不退出待人工介入。
 *
 * async 签名（Promise<void>，plan 审查问题 3 裁定方案 a）：盘上校验需
 * 异步读文件，故同步 void 改 async。三处调用点零义务兼容——daemon.ts
 * 两处（WS SELF_UPDATE / 忙推迟复查）fire-and-forget 不 await（本函数
 * 全路径自收敛不 reject，无 unhandled rejection）；runPreflight 内调用
 * await（启动路径确定性，见其调用点注释）。
 *
 * 行为：
 *   - spawn `process.execPath <binDir>/sillyhub-daemon.js ...process.argv.slice(2)`
 *     （detached + stdio ignore + windowsHide，跨 Windows/Linux/macOS 存活于
 *     父进程退出后；新进程日志走 daemon 文件日志，不依赖终端 stdio）
 *   - 拉起成功 → 500ms 后 process.exit(0)（给日志 flush）；调用方应先完成
 *     资源释放（WS 路径 daemon.stop() 释放 runtime lock / 标 offline），
 *     保证新进程 acquire lock 时旧进程已释放
 *   - 拉起失败 → 记 error **不退出**：旧进程继续跑旧版本保持在线，等下次
 *     触发或人工介入（比"裸退出死掉"安全）
 *
 * @param logger      日志回调
 * @param binDir      新 bundle 所在目录，默认 {@link DAEMON_BIN_DIR}
 * @param exitDelayMs 退出前延迟（日志 flush），默认 500ms（测试注入）
 */
export async function respawnDaemonAndExit(
  logger: PreflightLogger,
  binDir: string = DAEMON_BIN_DIR,
  exitDelayMs: number = 500,
): Promise<void> {
  // 防线 3（D-005）：spawn 前最后复核盘上 bundle（validateBundleOnDisk
  // 已内部记 debug 明细），不过即 error + 提前 return——不 spawn、不排定
  // 退出，旧进程保活 / 启动路径正常继续（见函数注释）。
  const ok = await validateBundleOnDisk(binDir, logger);
  if (!ok) {
    logger('error', 'daemon_self_update_respawn_validation_failed', {
      bundle: join(binDir, DAEMON_BUNDLE_NAME),
    });
    return;
  }
  const bundlePath = join(binDir, DAEMON_BUNDLE_NAME);
  const startArgs = process.argv.slice(2);
  let child: ChildProcess;
  try {
    child = spawn(process.execPath, [bundlePath, ...startArgs], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      // ql-20260831-001-6dde：标记自更新交接。新进程的 start 单实例守卫据此
      // 豁免——旧进程 exit(0) 前 pid 短暂并存是交接既定时序，不豁免会被
      // 「daemon already running」拦下，自更新链断裂。
      env: { ...process.env, SILLYHUB_DAEMON_RESPAWN: '1' },
    });
    // 兜底吞异步 spawn error（error 事件异步 emit，无 listener 会崩进程）。
    child.on('error', () => {});
    if (typeof child.pid !== 'number') {
      throw new Error('spawn returned no pid');
    }
    child.unref();
  } catch (e) {
    logger('error', 'daemon_self_update_respawn_failed', {
      bundle: bundlePath,
      error: fmtErr(e),
    });
    return; // 不退出：旧进程保活（见函数注释）
  }
  logger('info', 'daemon_self_update_respawn', {
    pid: child.pid,
    bundle: bundlePath,
    args: startArgs,
  });
  setTimeout(() => process.exit(0), exitDelayMs); // 给日志 flush
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
 * 下载新 bundle：写盘前内容校验（D-003）→ 备份轮换（D-004）→ 原子替换落盘
 * （tmp + rename）。
 *
 * 替换正在运行的 bundle 是安全的：node 已把当前进程代码加载进内存，本次进程
 * 不受影响；新文件由 respawnDaemonAndExit 拉起的新进程加载生效。
 *
 * 写前校验（防线 2，task-02）：writeFile 前跑 {@link validateBundleContent}，
 * 不过（占位/半截 bundle）→ warn `daemon_bundle_validation_failed`（含 size/
 * buildId）+ 清理固定名 .tmp 上一轮残留 + 返回 false——不 mkdir 不写盘不
 * rename，调用链 runDaemonSelfUpdate 返回 false 不 respawn，旧进程保活，
 * 下次触发重试。
 *
 * 备份轮换（task-02）：rename 前若 target 已存在 → copyFile 为
 * `<target>.bak-<yyyyMMdd-HHmmss>`（本地时间手拼纯数字，字典序即时间序，
 * Windows/Linux/macOS 一致；同秒同名覆盖视为替换），随后按文件名字典序保留
 * 最近 3 份，超出逐个 unlink（ENOENT 忽略）。备份任一步失败（磁盘满等）→
 * warn `daemon_bundle_backup_failed` 但继续 rename——人工兜底路径，不拦
 * 自更新主线。
 *
 * 下载失败 / 写盘失败 → 仅 warn 返回 false（R3：失败路径清理 .tmp 残留）。
 *
 * @param fileName 落盘文件名（主 bundle 默认，mcp-server.js 伴生替换复用——
 *                 同校验同备份自动生效，无绕过点）
 * @param eventName 成功事件名（主 bundle 保留原事件，mcp 用独立事件区分）
 */
export async function downloadAndReplace(
  fullUrl: string,
  newVersion: string,
  currentId: string,
  binDir: string,
  logger: PreflightLogger,
  fileName: string = DAEMON_BUNDLE_NAME,
  eventName: string = 'daemon_self_updated_need_restart',
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
  const target = join(binDir, fileName);
  const tmp = `${target}.tmp`;

  // D-003（防线 2，task-02）：writeFile 前校验内容——不可信 bundle 连 binDir/
  // tmp 文件都不产生，不 rename，返回 false → 调用链 runDaemonSelfUpdate 返回
  // false 不 respawn，旧进程保活继续跑，下次触发重试。unlink 清上一轮写盘
  // 失败可能残留的固定名 .tmp（R3 同款，ENOENT 忽略）。
  const v = validateBundleContent(buf);
  if (!v.ok) {
    await unlink(tmp).catch(() => undefined);
    logger('warn', 'daemon_bundle_validation_failed', {
      url: fullUrl,
      size: v.size,
      buildId: v.buildId,
    });
    return false;
  }

  try {
    await mkdir(binDir, { recursive: true });
    await writeFile(tmp, buf);

    // D-004（task-02）：rename 前备份既有 target——8-30 事故实际靠人工 .bak
    // 救回，此处制度化。时间戳本地时间手拼纯数字（Date getFullYear/… +
    // padStart，不依赖 locale/第三方库），字典序即时间序，Windows/Linux/macOS
    // 一致；同秒写入同名覆盖视为替换（天然去重）。
    let targetExists = true;
    try {
      await access(target);
    } catch {
      targetExists = false; // ENOENT 等 → 首次安装，无旧文件可备份
    }
    if (targetExists) {
      try {
        const now = new Date();
        const p2 = (n: number): string => String(n).padStart(2, '0');
        const ts = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}`
          + `-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`;
        const bakPath = `${target}.bak-${ts}`;
        try {
          await copyFile(target, bakPath);
        } catch (copyErr) {
          // ql-20260831-001-6dde：copyFile 中断（ENOSPC/进程被杀）会留下截断的
          // 半截 .bak——不清理会被「保留最近 3 份」的字典序轮换当成真备份占位，
          // 多轮后把完整历史备份挤掉，人工 .bak 兜底无物可用。删残件后原样上抛
          // 走外层 warn（备份失败不阻塞替换）。
          await unlink(bakPath).catch(() => undefined);
          throw copyErr;
        }
        // 同前缀按文件名字典序排序，保留最近 3 份，超出逐个清理（ENOENT 忽略）。
        const backups = (await readdir(binDir))
          .filter((name) => name.startsWith(`${fileName}.bak-`))
          .sort();
        for (const stale of backups.slice(0, Math.max(0, backups.length - 3))) {
          try {
            await unlink(join(binDir, stale));
          } catch (e) {
            // 并发清理竞态下的 ENOENT 忽略；其余（权限等）上抛走外层 warn。
            if ((e as { code?: unknown }).code !== 'ENOENT') throw e;
          }
        }
      } catch (e) {
        // 备份失败（磁盘满等）不阻塞替换：人工兜底路径，不拦自更新主线。
        logger('warn', 'daemon_bundle_backup_failed', {
          target,
          error: fmtErr(e),
        });
      }
    }

    // rename 原子替换：避免下载中途写坏 target 导致下次启动加载半截 bundle。
    await rename(tmp, target);
  } catch (e) {
    // R3（2026-08-30 审计）：失败路径清理 .tmp 残留——固定名 tmp 不清会在下次
    // 下载覆写前滞留磁盘（Windows 目标被 AV/他进程短暂占用时 rename 失败的
    // 场景；忙推迟期 30s 复查每轮重跑会放大残留频率）。ENOENT 忽略。
    await unlink(tmp).catch(() => undefined);
    logger('warn', 'daemon_bundle_write_failed', {
      target,
      error: fmtErr(e),
    });
    return false;
  }

  logger('warn', eventName, {
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
export async function runCmd(cmd: string): Promise<string | null> {
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
export function isOutdated(local: string, latest: string): boolean {
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

/**
 * macOS 平台自启策略（2026-08-30-daemon-autostart task-03）。
 *
 * 机制（design §2 macOS 列）：launchd LaunchAgent——
 *   - 产物：~/Library/LaunchAgents/com.sillyhub.daemon.<hash8>.plist（用户级，
 *     免管理员权限；本文件只产系统注册产物，本地记录 json 归 index.ts）；
 *   - 触发：RunAtLoad=true（LaunchAgent 加载即登录时拉起一次）；
 *   - 无保活：全文不含 KeepAlive 键（D-002——与 respawnDaemonAndExit 自更新
 *     零冲突，daemon 崩溃不拉起）；
 *   - 命令：launchctl bootout gui/<uid>/<label>（幂等清场，忽略失败，R-07）
 *     → launchctl bootstrap gui/<uid> <plist>（真实注册）；
 *   - 输出兜底：StandardOutPath/StandardErrorPath 指向
 *     <DEFAULT_CONFIG_DIR>/autostart-<hash8>.launchd.txt——.txt 后缀避开
 *     clean 命令的 *.log/*.out/*.err glob（R-09）。
 *
 * ProgramArguments 五元素数组（R-06：launchd 环境 PATH 受限，node/脚本必须
 * 全绝对路径）：[node绝对路径, 脚本绝对路径, 'start', '--server', server_url]。
 * 数组形式天然无引号转义问题（不经 shell）；凭据不进数组（D-004，开机拉起后
 * 由 start 从 per-server config 读取）。
 *
 * plist XML 用手写模板字符串生成（任务约束：不引 XML 库、零 npm 依赖），
 * UTF-8 落盘，文件权限走默认 umask（launchd 要求用户所有，默认即满足）。
 *
 * 环境限制（R-05）：SSH-only 会话无 launchd GUI domain，bootstrap 会失败——
 * 返回含修复提示的 ok=false（引导在本地图形会话执行），CLI 层据此 exit 1。
 *
 * 可测性：{@link buildLaunchdPlist}（纯函数）与 {@link launchAgentPlistPath}
 * 导出供 task-06 tests/autostart.test.ts 直接断言产物内容与路径。
 *
 * @module autostart/macos
 */

import { execFile } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

import type { AutostartPlatformStrategy, AutostartRecord } from './index.js';
import { DEFAULT_CONFIG_DIR, serverHash } from '../config.js';

// ── 路径派生（系统注册产物）──────────────────────────────────────────────────

/**
 * 某 label 的 LaunchAgent plist 绝对路径：
 * `~/Library/LaunchAgents/<label>.plist`（label 即 task_name =
 * com.sillyhub.daemon.<hash8>，文件名对齐 design「数据模型」macOS 行）。
 */
export function launchAgentPlistPath(label: string): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
}

/**
 * 某 record 的 launchd 兜底输出文件绝对路径：
 * `<DEFAULT_CONFIG_DIR>/autostart-<hash8>.launchd.txt`（hash8 复用 config.ts
 * 的 serverHash）。.txt 后缀刻意避开 clean 命令的 *.log/*.out/*.err glob
 * （R-09），stdout/stderr 共用同一文件。
 */
function launchdLogPath(record: AutostartRecord): string {
  return join(DEFAULT_CONFIG_DIR, `autostart-${serverHash(record.server_url)}.launchd.txt`);
}

// ── plist XML 生成（手写模板字符串，无 XML 库）──────────────────────────────

/**
 * XML 五个预定义实体转义（& < > " '）。
 * server_url 可能含查询参数 `&`，node/脚本路径理论上也可含特殊字符——所有
 * 插值 string 一律转义，保证产物恒为结构合法的 XML。
 */
function escapePlistXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 生成 LaunchAgent plist XML（纯函数，UTF-8 文本）。
 *
 * 结构（design §2 macOS 列逐键对齐）：
 *   - Label = task_name（com.sillyhub.daemon.<hash8>）；
 *   - ProgramArguments 五元素绝对路径数组：node / 脚本 / start / --server /
 *     server_url（launchd 环境 PATH 受限，R-06；凭据不进数组，D-004）；
 *   - RunAtLoad = true（登录加载时拉起一次）；
 *   - **不写 KeepAlive 键**（D-002 无保活——崩溃不拉起，exit(0) 自更新不双开）；
 *   - StandardOutPath / StandardErrorPath 均指向 autostart-<hash8>.launchd.txt
 *     （R-09 避 clean glob）。
 *
 * @param record enableAutostart 组装的注册记录（node/script 双绝对路径已固化）
 */
export function buildLaunchdPlist(record: AutostartRecord): string {
  const esc = escapePlistXml;
  const logPath = launchdLogPath(record);
  const programArguments = [
    record.node_path,
    record.script_path,
    'start',
    '--server',
    record.server_url,
  ]
    .map((arg) => `\t\t<string>${esc(arg)}</string>`)
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '\t<key>Label</key>',
    `\t<string>${esc(record.task_name)}</string>`,
    '\t<key>ProgramArguments</key>',
    '\t<array>',
    programArguments,
    '\t</array>',
    '\t<key>RunAtLoad</key>',
    '\t<true/>',
    '\t<key>StandardOutPath</key>',
    `\t<string>${esc(logPath)}</string>`,
    '\t<key>StandardErrorPath</key>',
    `\t<string>${esc(logPath)}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

// ── launchctl 命令封装（对齐 host-fs-handler.ts 的 execFile 模式）────────────

/** launchctl 单命令超时：本地 launchd 操作毫秒级，10s 兜底防挂起。 */
const LAUNCHCTL_TIMEOUT_MS = 10_000;

/** launchctl 调用结果：ok + stdout；失败时 error 为合成原因文本。 */
interface LaunchctlResult {
  ok: boolean;
  stdout: string;
  /** 失败原因（err.message + stderr 合成），成功时为空串。 */
  error: string;
}

/**
 * 执行一条 launchctl 命令（execFile 非 shell，plist 绝对路径免引号转义、
 * 防注入；超时/非零退出 → ok:false，不抛——成败由调用方判定）。
 *
 * 不用 promisify(execFile)：@types/node 对 promisify 重载的 stdout/stderr
 * 类型推断在 Buffer/string 分支不精确（同 host-fs-handler.ts runCmd 注释），
 * callback 形式类型显式可控。
 */
function runLaunchctl(args: string[]): Promise<LaunchctlResult> {
  return new Promise((resolve) => {
    execFile(
      'launchctl',
      args,
      { timeout: LAUNCHCTL_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = Buffer.isBuffer(stdout) ? stdout.toString('utf-8') : stdout ?? '';
        const errOut = Buffer.isBuffer(stderr) ? stderr.toString('utf-8') : stderr ?? '';
        if (err) {
          const error = [err.message, errOut.trim()].filter(Boolean).join(': ');
          resolve({ ok: false, stdout: out, error });
        } else {
          resolve({ ok: true, stdout: out, error: '' });
        }
      },
    );
  });
}

/**
 * 当前用户的 launchd GUI domain target：`gui/<uid>`（uid=process.getuid()）。
 * 仅 darwin 分派路径可达（index.ts 按 process.platform 查策略表），getuid
 * 在该平台恒存在；@types/node 将其标注为可选（平台限定 API），故显式收窄，
 * 缺失即抛明确错误（不可达防御，避免拼出 `gui/undefined` 的坏命令——调用方
 * try/catch 转成 ok:false，维持策略不抛异常的约定）。
 */
function guiDomain(): string {
  const uid = process.getuid?.();
  if (uid === undefined) {
    throw new Error('process.getuid() unavailable on this platform');
  }
  return `gui/${uid}`;
}

/** 格式化 unknown 错误为字符串（Error 取 message，其余 String()）。 */
function fmtErr(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ── 策略实现（AutostartPlatformStrategy 的 darwin 实例）──────────────────────

/**
 * macOS 策略（launchd LaunchAgent）。签名与语义见 index.ts 的
 * AutostartPlatformStrategy 注释；不抛异常，失败一律返回 ok=false。
 */
export const macosAutostartStrategy: AutostartPlatformStrategy = {
  /**
   * 注册流程：写 plist → bootout 幂等清场（忽略失败）→ bootstrap。
   * bootstrap 失败不删已写 plist——plist 残留无害（重跑 enable 幂等覆盖 /
   * disable 可清理），且 SSH-only 场景回到本地图形会话登录时 launchd 会
   * 自行加载 LaunchAgents 目录下的 plist，重跑 enable 即完成显式注册。
   */
  async register(record) {
    const label = record.task_name;
    const plistPath = launchAgentPlistPath(label);

    // 步骤 1：写 plist（LaunchAgents 目录不存在则 mkdir -p；权限走默认
    // umask，launchd 要求用户所有，默认即满足，无需 chmod）。
    try {
      await mkdir(dirname(plistPath), { recursive: true });
      await writeFile(plistPath, buildLaunchdPlist(record), 'utf-8');
    } catch (e) {
      return {
        ok: false,
        error: `failed to write LaunchAgent plist ${plistPath}: ${fmtErr(e)}`,
      };
    }

    // 步骤 2 + 3（launchctl 段整体 try/catch：策略约定不抛异常，意外错误
    // 一律转 ok=false，如 guiDomain 的不可达防御）。
    try {
      // 步骤 2：幂等清场（R-07）——bootout 忽略失败：未注册时本就报
      // "No such process"，SSH-only 无 GUI domain 时同样报错；清场成败不阻断，
      // 注册成败由下一步 bootstrap 判定。
      await runLaunchctl(['bootout', `${guiDomain()}/${label}`]);

      // 步骤 3：真实注册。失败 → ok:false 含修复提示（R-05：SSH-only 会话
      // 无 GUI domain 是最常见原因，提示在本地图形会话执行，CLI 层 exit 1）。
      const boot = await runLaunchctl(['bootstrap', guiDomain(), plistPath]);
      if (!boot.ok) {
        return {
          ok: false,
          error: `launchctl bootstrap failed: ${boot.error}`,
          hint:
            'SSH 远程会话没有 launchd GUI domain，无法注册开机自启——请在本地图形会话执行'
            + `（直接登录 Mac 桌面后打开终端重跑 enable）；plist 已写入 ${plistPath}，无需手动清理。`,
        };
      }
    } catch (e) {
      return {
        ok: false,
        error: `launchctl registration failed unexpectedly: ${fmtErr(e)}`,
      };
    }
    return { ok: true };
  },

  /**
   * 注销流程：bootout（失败一律忽略——未注册时本就报 "No such process"，
   * SSH-only 会话无 GUI domain 时也报错，但 plist 删除后下次登录不再加载，
   * 注销语义已达成）→ 删 plist 文件。
   *
   * 只清注册产物，不杀运行中 daemon 进程（停进程用 stop，design §3）；
   * 兜底输出 .launchd.txt 保留（无凭据、供事后排查，clean 也不碰它）。
   */
  async unregister(taskName) {
    const plistPath = launchAgentPlistPath(taskName);
    try {
      await runLaunchctl(['bootout', `${guiDomain()}/${taskName}`]);
      await rm(plistPath, { force: true }); // force：plist 本就不在（重复 disable）也成功，幂等
    } catch (e) {
      return {
        ok: false,
        error: `failed to unregister LaunchAgent ${taskName}: ${fmtErr(e)}`,
      };
    }
    return { ok: true };
  },

  /**
   * 查询系统注册实况：`launchctl list` 输出按行取末列（Label 列）与
   * taskName 精确相等 → registered；无命中 → missing；命令失败 → unknown
   * （供 index.ts autostartStatus 对账，missing 才表示"注册丢失"）。
   */
  async query(taskName) {
    const res = await runLaunchctl(['list']);
    if (!res.ok) {
      return {
        systemState: 'unknown',
        error: `launchctl list failed: ${res.error}`,
      };
    }
    const hit = res.stdout.split('\n').some((line) => {
      const cols = line.trim().split(/\s+/);
      return cols.length >= 3 && cols[cols.length - 1] === taskName;
    });
    return { systemState: hit ? 'registered' : 'missing' };
  },
};

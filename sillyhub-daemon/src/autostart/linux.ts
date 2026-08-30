/**
 * Linux 平台自启策略（2026-08-30-daemon-autostart task-04）。
 *
 * 机制（design §2 Linux 列）：systemd user service ——
 *   - 产物：`~/.config/systemd/user/sillyhub-daemon-<hash8>.service`
 *     （XDG_CONFIG_HOME 默认形态的 systemd user unit 标准目录）；
 *   - register：PID1 前置检测（R-04）→ 写 service（[Unit]/[Service]/[Install]，
 *     WantedBy=default.target，**无 Restart 键**，D-002 无保活）→
 *     `systemctl --user daemon-reload` → `systemctl --user enable`（幂等覆盖
 *     R-07）→ `loginctl enable-linger`（best-effort，失败仅 warn，降级为
 *     登录后自启，不影响注册成功）；
 *   - unregister：`systemctl --user disable`（不带 --now，不停止运行中实例；
 *     unit 不存在视为成功幂等）→ 删 service 文件 → `systemctl --user
 *     daemon-reload`；
 *   - query：`systemctl --user is-enabled` 三态映射——enabled=registered、
 *     disabled/not-found=missing、其他失败=unknown（供 index.ts status 对账）。
 *
 * PID1 前置检测（R-04）：读 /proc/1/comm（不可读回退 `ps -p 1 -o comm=`），
 * 非 systemd（WSL 默认 init / 容器）→ register/unregister 直接 ok=false
 * （错误含替代建议：WSL 启用 systemd 或改 Windows 侧安装），**不执行任何
 * 注册命令、不写任何文件**（CLI 层据此 exit 1，不静默失败）。
 *
 * 命令执行：execFile 非 shell（对齐 host-fs-handler.ts 的 runCmd 封装——unit
 * 名/路径按 argv 传递防注入；design §5 单测按 mock node:child_process execFile
 * 设计），错误信息透出 stderr；systemctl 失败附 SSH 无用户总线的修复提示（R-05）。
 *
 * 本文件只在 Linux 平台被 index.ts 按 process.platform 分派调用，自身不做
 * 平台判断（task-04 constraints：平台分派归 index.ts）。
 *
 * @module autostart/linux
 */

import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { AutostartPlatformStrategy, AutostartRecord } from './index.js';

// ── 常量 ─────────────────────────────────────────────────────────────────────

/**
 * systemd user unit 目录 `~/.config/systemd/user`（design §2 Linux 列 / 数据
 * 模型：service 产物落点）。unit 文件名即 record.task_name
 * （`sillyhub-daemon-<hash8>.service`，taskNameFor('linux', ...) 派生）。
 */
const SYSTEMD_USER_DIR: string = join(homedir(), '.config', 'systemd', 'user');

/** systemctl/loginctl/ps 单命令超时：正常亚秒完成，15s 仅兜底挂起（防 CLI 卡死）。 */
const CMD_TIMEOUT_MS = 15_000;

/** PID1 期望可执行名（/proc/1/comm 内容，kernel 截断 15 字符内，"systemd" 恰好放得下）。 */
const PID1_SYSTEMD_COMM = 'systemd';

/**
 * systemctl 输出中「unit 不存在」的判定模式（大小写不敏感）：
 * 新版 systemd is-enabled 输出 `not-found`；旧版 disable/is-enabled stderr 报
 * `... does not exist` / `Failed to get unit file state ... No such file or
 * directory`。命中即按缺失/幂等处理（unregister 视为成功、query 记 missing）。
 */
const UNIT_ABSENT_RE = /not[- ]?found|does not exist|no such file/i;

// ── execFile 封装（对齐 host-fs-handler.ts runCmd：非 shell 防注入）──────────

/** execFile 调用结果（stdout/stderr 显式 string；ENOENT 等启动失败时 stderr 为空，用 err.message 兜底）。 */
interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/**
 * 执行一条系统命令（execFile 非 shell，防注入），超时/非零退出 → ok:false
 * （不抛，由调用方判定结构化返回——策略层契约：一律不抛异常）。
 *
 * 不用 promisify(execFile)：@types/node 对 promisify 重载的 stdout/stderr 类型
 * 推断在 Buffer/string 分支不精确（先例注释见 host-fs-handler.ts:445-447），
 * callback 形式类型显式可控。
 */
function runCmd(cmd: string, args: string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: CMD_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = Buffer.isBuffer(stdout) ? stdout.toString('utf8') : stdout ?? '';
        let errOut = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : stderr ?? '';
        if (err && !errOut) {
          errOut = err.message; // ENOENT（命令不存在）等启动失败无 stderr，用 err.message 透出原因
        }
        resolve({ ok: !err, stdout: out, stderr: errOut });
      },
    );
  });
}

/** 组装失败原因文本：优先 stderr，兜底 stdout，最后占位说明（非零退出但无输出）。 */
function execErrText(r: ExecResult): string {
  return r.stderr.trim() || r.stdout.trim() || 'exit non-zero (no output)';
}

/**
 * systemctl 命令失败的统一错误：error 透出命令与 stderr，hint 给 SSH 无
 * systemd 用户总线（R-05）的修复提示。
 */
function systemctlFailure(
  cmd: string,
  r: ExecResult,
): { ok: false; error: string; hint: string } {
  return {
    ok: false,
    error: `${cmd} failed: ${execErrText(r)}`,
    hint:
      '若在 SSH 会话执行，systemd 用户实例可能未运行（R-05）：先完成一次本地/图形登录，'
      + '或确认 DBUS_SESSION_BUS_ADDRESS 与 XDG_RUNTIME_DIR 已设置后重试。',
  };
}

// ── PID1 前置检测（R-04）─────────────────────────────────────────────────────

/**
 * 读取 PID1 可执行名：先读 /proc/1/comm（零子进程、最快），不可读（挂载命名
 * 空间/权限/非 procfs）回退 `ps -p 1 -o comm=`。两路都失败 → null（无法判定，
 * 按不支持处理，不盲目注册）。
 */
async function pid1Comm(): Promise<string | null> {
  try {
    const content = await readFile('/proc/1/comm', 'utf-8');
    const trimmed = content.trim();
    if (trimmed) {
      return trimmed;
    }
  } catch {
    // /proc/1/comm 不可读 → 回退 ps（下方）
  }
  const r = await runCmd('ps', ['-p', '1', '-o', 'comm=']);
  if (!r.ok) {
    return null;
  }
  return r.stdout.trim() || null;
}

/**
 * register/unregister 前置检测（R-04）：PID1 非 systemd（WSL 默认/容器）→
 * ok=false，错误明确说明不支持原因 + 替代建议（WSL 在 /etc/wsl.conf 启用
 * systemd，或改在 Windows 侧安装后用计划任务注册）；调用方据此直接返回，
 * 不执行任何注册命令。
 */
async function systemdCheck(): Promise<
  { ok: true } | { ok: false; error: string; hint: string }
> {
  const comm = await pid1Comm();
  if (comm !== null && comm.toLowerCase() === PID1_SYSTEMD_COMM) {
    return { ok: true };
  }
  const seen = comm === null ? '无法读取（/proc 与 ps 均失败）' : `"${comm}"`;
  return {
    ok: false,
    error: `systemd unavailable: PID 1 comm is ${seen}, expected "${PID1_SYSTEMD_COMM}"（WSL 默认/容器环境常见）`,
    hint:
      'Linux 自启依赖 systemd 用户实例：WSL 可在 /etc/wsl.conf 的 [boot] 段配置 systemd=true 后重启 wsl；'
      + '或改在 Windows 侧安装 daemon 后用计划任务（autostart enable）注册自启。',
  };
}

// ── service 文件生成（INI 内容，D-002：无 Restart 键）────────────────────────

/**
 * ExecStart 词元的 INI 引号规则：含空白（路径带空格）时用双引号包裹（systemd
 * 命令行解析支持双引号分组）；无空格保持裸值，与启动命令模板输出一致。
 */
function quoteIniToken(token: string): string {
  return /\s/.test(token) ? `"${token}"` : token;
}

/** INI 值净化：折叠 CR/LF 为空格，防多行值破坏 unit 文件结构（防御性，URL 正常不含）。 */
function sanitizeIniValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ');
}

/**
 * 生成 unit 文件内容（design §2 Linux 列 + task-04 acceptance）：
 *
 * ```ini
 * [Unit]
 * Description=SillyHub Daemon (<server_url>)
 *
 * [Service]
 * ExecStart=<node> <script> start --server <server_url>
 *
 * [Install]
 * WantedBy=default.target
 * ```
 *
 * - ExecStart 模板与 index.ts buildStartCommand 同源（`<node> <script> start
 *   --server <url>`，node/script 用 record 固化的绝对路径——systemd 环境 PATH
 *   受限；凭据绝不进命令，开机拉起后由 start 读 per-server config，D-004）。
 *   此处按 record 拼装而非 import 复用：index.ts 顶层 PLATFORM_STRATEGIES
 *   引用本文件导出的 linuxAutostartStrategy，反向值 import 会成运行时循环
 *   （测试直引 linux.js 时 index.ts 读到 TDZ 的 linuxAutostartStrategy 会崩），
 *   故只保留 `import type`。
 * - **不写 Restart 键**（systemd 默认 no）——D-002 仅开机/登录启动一次，无保活。
 * - WantedBy=default.target：用户会话建立时触发（非纯开机语义）。
 */
function buildServiceContent(record: AutostartRecord): string {
  const serverUrl = sanitizeIniValue(record.server_url);
  const execStart = [
    quoteIniToken(sanitizeIniValue(record.node_path)),
    quoteIniToken(sanitizeIniValue(record.script_path)),
    'start',
    '--server',
    serverUrl,
  ].join(' ');
  return [
    '[Unit]',
    `Description=SillyHub Daemon (${serverUrl})`,
    '',
    '[Service]',
    `ExecStart=${execStart}`,
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

// ── 策略实现 ─────────────────────────────────────────────────────────────────

/**
 * Linux 策略（systemd user service）。签名与语义见 index.ts 的
 * AutostartPlatformStrategy 注释；三方法均不抛异常（失败转 ok=false /
 * systemState='unknown' 返回）。
 */
export const linuxAutostartStrategy: AutostartPlatformStrategy = {
  /**
   * 注册：PID1 检测 → 写 service → daemon-reload → enable（幂等覆盖）→
   * enable-linger（best-effort）。
   */
  async register(record) {
    const check = await systemdCheck();
    if (!check.ok) {
      return check; // R-04：未执行任何命令/写文件
    }

    // 步骤 1：写 unit 文件（mkdir -p 目录；重跑 enable 整文件覆盖，幂等 R-07）。
    const unitFile = join(SYSTEMD_USER_DIR, record.task_name);
    try {
      await mkdir(SYSTEMD_USER_DIR, { recursive: true });
      await writeFile(unitFile, buildServiceContent(record), 'utf-8');
    } catch (e) {
      return {
        ok: false,
        error: `failed to write unit file ${unitFile}: ${(e as Error).message}`,
      };
    }

    // 步骤 2：daemon-reload（让 systemd 重新扫描 unit 文件）。
    const reload = await runCmd('systemctl', ['--user', 'daemon-reload']);
    if (!reload.ok) {
      return systemctlFailure('systemctl --user daemon-reload', reload);
    }

    // 步骤 3：enable（已 enable 时覆盖不报错，幂等；只注册不 start，开机/登录才拉起）。
    const enable = await runCmd('systemctl', ['--user', 'enable', record.task_name]);
    if (!enable.ok) {
      return systemctlFailure(`systemctl --user enable ${record.task_name}`, enable);
    }

    // 步骤 4（best-effort）：enable-linger（当前用户）——成功时接近不登录也开机
    // 启动；失败（如 SSH 会话 polkit 拒绝）仅 warn（stderr，对齐 cli 层轻量日志
    // 不污染 stdout 的惯例），降级为登录后自启，**不影响 ok:true / exit 0 语义**。
    const linger = await runCmd('loginctl', ['enable-linger']);
    if (!linger.ok) {
      console.warn(
        `[autostart.linux] loginctl enable-linger 失败，已降级为登录后自启（不影响注册结果）：${execErrText(linger)}`,
      );
    }
    return { ok: true };
  },

  /**
   * 注销：disable（**不带 --now**——--now 会同时 stop 运行中的 unit，违反
   * 「只清注册产物，不动运行中的进程」契约；ql-20260831-001-6dde 修正，与
   * Windows schtasks /Delete、macOS 条件 bootout 对齐）→ 删 unit 文件 →
   * daemon-reload。运行中的 daemon 由本次登录自然结束或用户显式 stop。
   */
  async unregister(taskName) {
    const check = await systemdCheck();
    if (!check.ok) {
      return check; // R-04：与 register 同一前置口径，未执行任何命令
    }

    const disable = await runCmd('systemctl', ['--user', 'disable', taskName]);
    if (
      !disable.ok &&
      !UNIT_ABSENT_RE.test(`${disable.stdout}\n${disable.stderr}`)
    ) {
      // unit 不存在（not-found / does not exist）→ 跳过 disable 视为已注销（幂等）。
      return systemctlFailure(`systemctl --user disable ${taskName}`, disable);
    }

    // 删 unit 文件（force：文件不存在也成功——记录在但产物已被手删的孤儿场景）。
    const unitFile = join(SYSTEMD_USER_DIR, taskName);
    try {
      await rm(unitFile, { force: true });
    } catch (e) {
      return {
        ok: false,
        error: `failed to remove unit file ${unitFile}: ${(e as Error).message}`,
      };
    }

    // 让 systemd 忘掉已删除的 unit（残留注册态）。
    const reload = await runCmd('systemctl', ['--user', 'daemon-reload']);
    if (!reload.ok) {
      return systemctlFailure('systemctl --user daemon-reload', reload);
    }
    return { ok: true };
  },

  /**
   * 查询系统注册实况（index.ts autostartStatus 对账数据源）：
   * is-enabled → enabled（含 enabled-runtime 前缀族）= registered；
   * disabled / unit 不存在（not-found 等）= missing；其他失败（无用户总线/
   * systemctl 缺失/超时）= unknown + error 原因。
   */
  async query(taskName) {
    const r = await runCmd('systemctl', ['--user', 'is-enabled', taskName]);
    const state = r.stdout.trim();
    if (r.ok && state.startsWith('enabled')) {
      return { systemState: 'registered' as const };
    }
    if (state === 'disabled' || UNIT_ABSENT_RE.test(`${state}\n${r.stderr}`)) {
      return { systemState: 'missing' as const };
    }
    return {
      systemState: 'unknown' as const,
      error: `systemctl --user is-enabled ${taskName} failed: ${execErrText(r)}`,
    };
  },
};

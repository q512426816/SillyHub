/**
 * Windows 平台自启策略（2026-08-30-daemon-autostart task-02，design §2 Windows 列）。
 *
 * 机制：schtasks 计划任务（`SillyHubDaemon-<hash8>`，/SC ONLOGON 登录时触发）+
 * VBS 隐藏窗口中转脚本（`<DEFAULT_CONFIG_DIR>/autostart-<hash8>.vbs`）。
 * VBS 由 wscript.exe 执行（自身无窗口），`Run ..., 0` 隐藏子进程窗口，规避
 * console 弹黑框；同时 /TR 只含 `wscript.exe "<vbs>"`，规避 261 字符限制与
 * cmd 引号转义地狱（R-02）。
 *
 * 命令执行方式（对齐 workspace.ts runGit / agent-detector 的 execFile 非 shell 模式）：
 *   - 一律 execFile 独立 argv 传参，不经 shell 字符串拼接（防注入，DA-15 同源教训）。
 *   - /TR 值 `wscript.exe "<vbs>"` 含内嵌引号：execFile 在 Windows 按 MSVCRT 规则
 *     转义（外层引号包裹 + 内嵌 `"` → `\"`），schtasks 的 CRT argv 解析精确还原。
 *     实机验证（2026-08-30，Win10 22H2）：/Create 后 /XML 查询任务 action 存量为
 *     `<Command>wscript.exe</Command><Arguments>"C:\...\x.vbs"</Arguments>`，
 *     引号零丢失——因此**不需要** shell:true 或 cmd 包装（那反而引入二级转义）。
 *
 * 实机行为要点（2026-08-30 Win10 22H2 中文系统实测，见各函数注释）：
 *   1. schtasks 输出走 OEM 码页（中文系统 GBK），Node 默认 utf-8 解码成乱码
 *      → execFile 用 encoding:'buffer' + 手工解码（utf-8 严格 → GBK 回退）。
 *   2. `/SC ONLOGON` 的 /Create 在非管理员（含 UAC 拆分令牌）下报"拒绝访问"
 *      退出码 1，而 /SC ONCE 成功——是 schtasks CLI 对登录触发的提权要求，非
 *      任务计划程序本身限制；用 PowerShell Register-ScheduledTask（AtLogOn +
 *      本用户 Interactive principal）非提权可注册成功 → access denied 时降级
 *      走该路径（保持"用户级免管理员"设计目标）。
 *   3. `schtasks /Query /TN` 对"任务不存在"与其他错误退出码同为 1 且文案随
 *      locale 变化 → 不做文案匹配，用全量 CSV 列表复核判 missing（locale 无关）。
 *   4. `/Delete` 可删除经 PowerShell 注册的同名任务（同一任务存储），注销/查询
 *      仍统一走 schtasks。
 *
 * 仅含 win32 侧逻辑：本文件只被 index.ts 按 process.platform === 'win32' 分派引用，
 * 不在非 Windows 平台执行任何系统命令（task-02 constraints）。
 *
 * @module autostart/windows
 */

import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { DEFAULT_CONFIG_DIR } from '../config.js';
import type {
  AutostartPlatformStrategy,
  AutostartQueryResult,
  AutostartRecord,
} from './index.js';

const execFileAsync = promisify(execFile);

// ── 常量 ────────────────────────────────────────────────────────────────────

/** schtasks/PowerShell 调用超时（ms）：本地计划任务操作毫秒级，30/60s 仅防挂死。 */
const SCHTASKS_TIMEOUT_MS = 30_000;
const POWERSHELL_TIMEOUT_MS = 60_000;

/** Windows 任务名前缀（index.ts taskNameFor 派生 `SillyHubDaemon-<hash8>`）。 */
const WINDOWS_TASK_PREFIX = 'SillyHubDaemon-';

// ── 子进程输出解码（OEM 码页）───────────────────────────────────────────────

/**
 * 子进程输出解码：schtasks/PowerShell 在中文 Windows 用 OEM 码页（cp936/GBK）
 * 输出，Node execFile 默认 utf-8 解码成乱码（实机验证：`错误: 拒绝访问。` 被解
 * 成替换字符）。策略：严格 utf-8 优先（英文系统原样通过）→ 非 utf-8 时回退
 * GBK（TextDecoder 全量 ICU 内建，零 npm 依赖）→ 再兜底 Node 默认（替换字符）。
 * stdout 判定只匹配 ASCII 任务名（GBK 对 ASCII 字节兼容），解码差异不影响匹配。
 */
function decodeProcessOutput(buf: Buffer | undefined): string {
  if (!buf) {
    return '';
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    // 非 utf-8 字节序列 → 尝试 GBK
  }
  try {
    return new TextDecoder('gbk').decode(buf);
  } catch {
    // 极端情况（小 ICU 构建无 gbk）→ Node 默认宽松解码
    return buf.toString('utf-8');
  }
}

// ── schtasks 执行封装（结构化结果，不抛异常）───────────────────────────────

/** 单次 schtasks 调用结果：ok=退出码 0；code 为退出码（spawn 失败 = -1）。 */
interface SchtasksResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * 执行 schtasks（execFile 非 shell，独立 argv）。
 * encoding:'buffer' + 手工解码见 decodeProcessOutput 注释。
 * 任何失败（非 0 退出 / 超时 / spawn 错误）都折叠为 ok:false + 可读 stderr，
 * 供上层组装 ok=false 错误信息（含 stderr 透出，便于用户排障）。
 */
async function runSchtasks(args: readonly string[]): Promise<SchtasksResult> {
  try {
    const { stdout, stderr } = await execFileAsync('schtasks', [...args], {
      timeout: SCHTASKS_TIMEOUT_MS,
      windowsHide: true,
      encoding: 'buffer',
    });
    return {
      ok: true,
      code: 0,
      stdout: decodeProcessOutput(stdout),
      stderr: decodeProcessOutput(stderr),
    };
  } catch (e) {
    const err = e as NodeJS.ErrnoException & {
      code?: number | string;
      stdout?: Buffer;
      stderr?: Buffer;
    };
    // 退出码非 0 → code 是 number；系统错误（ENOENT）→ code 是 string；超时 → null
    const code = typeof err.code === 'number' ? err.code : -1;
    return {
      ok: false,
      code,
      stdout: decodeProcessOutput(err.stdout),
      stderr: decodeProcessOutput(err.stderr) || String(err.message ?? e),
    };
  }
}

// ── 任务存在性判定（locale 无关）────────────────────────────────────────────

/**
 * 全量 CSV 列表复核任务是否存在。
 *
 * 为什么不匹配 stderr 文案：`/Query /TN` 对"不存在"与权限等其他错误退出码同为 1，
 * 文案随系统 locale 变化（中文 `找不到指定的文件` / 英文 `cannot find the file
 * specified`），穷举文案脆弱。改查全量列表：列表命令成功（退出 0）且列表无该任务
 * → 确证 missing；列表命令也失败 → 无法判定（返回 null → unknown）。
 *
 * 根文件夹任务在 CSV 行中记为 `"\TaskName"`（实机样本：
 * `"\SillyHubDaemon-xxxx","2026/8/30 23:59:00","就绪"`）。任务名是纯 ASCII，
 * 该匹配不受 OEM 码页解码差异影响。
 *
 * @returns true=存在 / false=确证不存在 / null=列表查询失败无法判定。
 */
async function taskExistsViaListing(taskName: string): Promise<boolean | null> {
  const r = await runSchtasks(['/Query', '/FO', 'CSV', '/NH']);
  if (!r.ok) {
    return null;
  }
  return r.stdout.includes(`"\\${taskName}"`);
}

/**
 * 查询任务注册实况三态（task-02 卡：任务存在=registered、不存在=missing、
 * 命令执行失败=unknown）。
 *
 * 路径：先 `/Query /TN`（存在 → 退出 0，最快路径）；非 0 → 全量列表复核
 * （见 taskExistsViaListing）：列表可见 → registered，列表成功但无 → missing，
 * 列表也失败 → unknown（error 携带两次失败信息）。
 */
async function resolveTaskState(taskName: string): Promise<AutostartQueryResult> {
  const q = await runSchtasks(['/Query', '/TN', taskName]);
  if (q.ok) {
    return { systemState: 'registered' };
  }
  const viaListing = await taskExistsViaListing(taskName);
  if (viaListing !== null) {
    // 列表可见但单查失败：如实报 registered（注册在，单查异常不影响对账结论）
    return { systemState: viaListing ? 'registered' : 'missing' };
  }
  return {
    systemState: 'unknown',
    error: `schtasks /Query failed (exit=${q.code}): ${q.stderr || q.stdout}`,
  };
}

// ── VBS 中转脚本（design §2 Windows 隐藏窗口节）────────────────────────────

/**
 * 从任务名派生 VBS 脚本绝对路径：`<DEFAULT_CONFIG_DIR>/autostart-<hash8>.vbs`。
 * 任务名 `SillyHubDaemon-<hash8>` 的 hash8 与 serverHash(server_url) 一致
 * （index.ts taskNameFor 派生），unregister 只拿 taskName 也能定位同一文件。
 */
export function vbsPathFor(taskName: string): string {
  const hash8 = taskName.startsWith(WINDOWS_TASK_PREFIX)
    ? taskName.slice(WINDOWS_TASK_PREFIX.length)
    : taskName;
  return join(DEFAULT_CONFIG_DIR, `autostart-${hash8}.vbs`);
}

/**
 * 生成 VBS 中转脚本内容（design §2 模板）：
 *
 * ```vbs
 * ' sillyhub-daemon autostart launcher (generated, do not edit)
 * CreateObject("WScript.Shell").Run """<node绝对路径>"" ""<bundle绝对路径>"" start --server <url>", 0, False
 * ```
 *
 * - 启动命令 = buildStartCommand 同款模板（index.ts）：`<node> <script> start
 *   --server <url>`，node/script 取 record 固化的双绝对路径。node 与 script
 *   均加引号（ql-20260831-001-6dde）：node 默认装在 `C:\Program Files\...`
 *   等含空格路径，未引号时只能靠 CreateProcess 对未引号命令行的逐段回退
 *   猜中可执行文件，且存在 `C:\Program.exe` 植入面（经典未引号路径问题）。
 * - VBS 字符串内双引号转义为连写两个双引号（""）——对整条命令统一 replace，
 *   路径/URL 中意外出现的引号同样被转义，不会破坏字符串字面量。
 * - Run 第二参数 0 = 隐藏窗口，第三参数 False = 不等待子进程（登录瞬间放行）。
 * - 行尾显式 \r\n（CRLF）：writeFile 不做换行转换，VBS 惯例 CRLF。
 */
export function buildVbsContent(record: AutostartRecord): string {
  const command = `"${record.node_path}" "${record.script_path}" start --server ${record.server_url}`;
  return (
    `' sillyhub-daemon autostart launcher (generated, do not edit)\r\n` +
    `CreateObject("WScript.Shell").Run "${command.replace(/"/g, '""')}", 0, False\r\n`
  );
}

// ── node 路径漂移检测（design §2 R-01）──────────────────────────────────────

/**
 * 版本化 node 目录片段（win32 路径分隔符为反斜杠，两种分隔符都匹配）。
 * 点前缀可选：Unix 惯例 `~/.nvm` / `~/.asdf` 带点，nvm-windows 版本根
 * `...\Roaming\nvm\` 与 asdf XDG 布局 `...\asdf\` 不带点；`nvm4w\nodejs`
 * 活动目录（junction，跨版本稳定不漂移）不匹配（无尾随分隔符）。
 */
const NODE_DRIFT_PATTERNS: readonly RegExp[] = [
  // Windows 路径大小写不敏感（Volta 实际装在 %LOCALAPPDATA%\Volta，大写 V）
  /[\\/]\.?nvm[\\/]/i,
  /[\\/]volta[\\/]/i,
  /[\\/]\.?asdf[\\/]/i,
];

/**
 * 检测 node 路径是否位于版本管理目录（.nvm/volta/asdf）——R-01：node 升级换路径
 * 后自启任务指向的旧路径失效。
 *
 * @returns 漂移警告文案；无漂移返回 null。导出供 task-06 单测断言；macos/linux
 * 策略（task-03/04）面对同一 R-01 需求可复用或上提到 index.ts（见文件尾卡点注释）。
 */
export function nodePathDriftWarning(nodePath: string): string | null {
  if (!NODE_DRIFT_PATTERNS.some((re) => re.test(nodePath))) {
    return null;
  }
  return 'node 路径位于版本管理目录（.nvm/volta/asdf），node 升级换路径后自启任务会失效，届时重新执行本命令即可。';
}

/**
 * 输出黄色警告（design §2 R-01"输出黄色警告"）。
 * cli.ts 全仓无 ANSI 基建（纯文本 stderr），这里仅 TTY 时着色（重定向日志不混入
 * 转义码）。
 *
 * 注：AutostartPlatformResult 的 ok 分支无 warning 字段（index.ts task-01 契约），
 * 结构化回传通道缺失，故 register 内直接写 stderr——已作为卡点报回主代理；若
 * index.ts 后续给 ok 分支补 warning 字段，此处应改为结构化返回由 CLI 统一输出。
 */
function emitWarning(message: string): void {
  const line = process.stderr.isTTY
    ? `\x1b[33mWarning: ${message}\x1b[0m\n`
    : `Warning: ${message}\n`;
  process.stderr.write(line);
}

// ── PowerShell 降级注册（schtasks ONLOGON 提权限制的绕行）──────────────────

/** PowerShell 单引号字面量转义：内嵌 ' 连写两个。 */
function psSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * 经 PowerShell Register-ScheduledTask 注册登录触发任务（非提权可用的降级路径）。
 *
 * 实机依据（2026-08-30 Win10 22H2）：`schtasks /Create /SC ONLOGON` 在非管理员
 * （含 UAC 拆分令牌）报"拒绝访问"退出 1；同机 PowerShell 注册 AtLogOn 触发 +
 * 本用户 Interactive principal 成功——任务计划程序本身允许用户级登录触发任务，
 * 提权要求只是 schtasks CLI 的行为。
 *
 * 语义与 schtasks 蓝图参数一一对应：/SC ONLOGON → AtLogOn（限定本用户触发）、
 * /RL LIMITED → RunLevel Limited、/F → -Force 覆盖、/TR wscript.exe "<vbs>" →
 * Execute 'wscript.exe' + Argument '"<vbs>"'。Settings 放开电池限制（笔记本电池
 * 供电登录时也应触发；Register-ScheduledTask 默认 DisallowStartIfOnBatteries=true）。
 *
 * -EncodedCommand：脚本整体 base64(UTF-16LE) 传入，彻底绕开 PowerShell 命令行
 * 引号转义（比 -Command 拼接可靠）；路径/任务名经 psSingleQuote 转义防注入。
 */
async function registerViaPowerShell(
  taskName: string,
  vbsPath: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const script = [
    '$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited',
    '$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME',
    `$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ${psSingleQuote(`"${vbsPath}"`)}`,
    '$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries',
    `Register-ScheduledTask -TaskName ${psSingleQuote(taskName)} -Principal $principal -Trigger $trigger -Action $action -Settings $settings -Force -ErrorAction Stop | Out-Null`,
  ].join('\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { timeout: POWERSHELL_TIMEOUT_MS, windowsHide: true, encoding: 'buffer' },
    );
    return { ok: true };
  } catch (e) {
    const err = e as NodeJS.ErrnoException & {
      code?: number | string;
      stderr?: Buffer;
    };
    const code = typeof err.code === 'number' ? err.code : -1;
    return {
      ok: false,
      error: `PowerShell Register-ScheduledTask failed (exit=${code}): ${decodeProcessOutput(err.stderr) || String(err.message ?? e)}`,
    };
  }
}

/** "拒绝访问"识别（schtasks ONLOGON 非提权特征）：中英文两种 locale 文案。 */
const ACCESS_DENIED_PATTERNS: readonly RegExp[] = [/access is denied/i, /拒绝访问/];

// ── 策略对象（AutostartPlatformStrategy 契约）───────────────────────────────

/**
 * Windows 策略：VBS 生成 + schtasks 注册/注销/查询（含 PowerShell 降级注册）。
 * 签名与语义见 index.ts 的 AutostartPlatformStrategy 注释；不抛异常。
 */
export const windowsAutostartStrategy: AutostartPlatformStrategy = {
  /**
   * 注册（幂等）：
   * 1. 写 VBS 中转脚本（目录不存在则建；重复 enable 直接整文件覆盖）；
   * 2. `schtasks /Create /TN <名> /SC ONLOGON /TR "wscript.exe \"<vbs>\"" /RL
   *    LIMITED /F`——/F 幂等覆盖（R-07）；/TR 值经 execFile argv 精确落位
   *    （见文件头注释，无需 shell）；
   * 3. schtasks 报"拒绝访问"（非提权 ONLOGON 限制，见 registerViaPowerShell）
   *    → 降级 PowerShell 注册，保持用户级免管理员目标；
   * 4. 成功后做 node 路径漂移检测（R-01）输出黄色警告（不阻断 ok）。
   */
  async register(record) {
    // 步骤 1：VBS 生成（design §2 Windows 隐藏窗口节）
    const vbsPath = vbsPathFor(record.task_name);
    try {
      await mkdir(dirname(vbsPath), { recursive: true });
      await writeFile(vbsPath, buildVbsContent(record), 'utf-8');
    } catch (e) {
      return {
        ok: false,
        error: `failed to write VBS launcher ${vbsPath}: ${(e as Error).message}`,
        hint: `检查目录可写：${DEFAULT_CONFIG_DIR}`,
      };
    }

    // 步骤 2：schtasks 注册（蓝图参数：/SC ONLOGON /RL LIMITED /F）
    const tr = `wscript.exe "${vbsPath}"`;
    const create = await runSchtasks([
      '/Create',
      '/TN',
      record.task_name,
      '/SC',
      'ONLOGON',
      '/TR',
      tr,
      '/RL',
      'LIMITED',
      '/F',
    ]);
    if (!create.ok) {
      // 步骤 3：非提权 ONLOGON 的"拒绝访问"→ PowerShell 降级注册
      if (ACCESS_DENIED_PATTERNS.some((re) => re.test(create.stderr))) {
        const fallback = await registerViaPowerShell(record.task_name, vbsPath);
        if (fallback.ok) {
          const warning = nodePathDriftWarning(record.node_path);
          if (warning) {
            emitWarning(warning);
          }
          return { ok: true };
        }
        return {
          ok: false,
          error: `schtasks /Create failed (exit=${create.code}): ${create.stderr || create.stdout}; ${fallback.error}`,
          hint: '可尝试在管理员终端中重新执行本命令（提权后 schtasks 可直接注册）。',
        };
      }
      return {
        ok: false,
        error: `schtasks /Create failed (exit=${create.code}): ${create.stderr || create.stdout}`,
        hint: '确认任务计划程序服务（Schedule）处于运行状态后重试。',
      };
    }

    // 步骤 4：node 路径漂移检测（R-01）——警告不阻断注册成功
    const warning = nodePathDriftWarning(record.node_path);
    if (warning) {
      emitWarning(warning);
    }
    return { ok: true };
  },

  /**
   * 注销（幂等）：`schtasks /Delete /TN <名> /F` + 删 VBS 文件。
   * - 任务不存在视为成功（幂等）：/Delete 失败时用全量列表复核（locale 无关，
   *   同 query）区分"不存在"与真失败——不存在则继续走 VBS 清理。
   * - 只清注册产物（计划任务 + VBS），不杀运行中 daemon 进程（停进程用 stop，
   *   task-02 constraints）。
   */
  async unregister(taskName) {
    const del = await runSchtasks(['/Delete', '/TN', taskName, '/F']);
    if (!del.ok) {
      const viaListing = await taskExistsViaListing(taskName);
      if (viaListing !== false) {
        // 列表仍可见（真删除失败）或列表查询也失败 → 如实报错
        return {
          ok: false,
          error: `schtasks /Delete failed (exit=${del.code}): ${del.stderr || del.stdout}`,
          hint: '确认任务计划程序服务（Schedule）处于运行状态后重试。',
        };
      }
      // 任务本就不存在 → 幂等成功，继续清理 VBS
    }
    const vbsPath = vbsPathFor(taskName);
    try {
      // force:true = 不存在不报错（存在才删的幂等语义）
      await rm(vbsPath, { force: true });
    } catch (e) {
      return {
        ok: false,
        error: `failed to remove VBS launcher ${vbsPath}: ${(e as Error).message}`,
        hint: '请手动删除该文件后重新执行 disable。',
      };
    }
    return { ok: true };
  },

  /** 查询系统注册实况三态（详见 resolveTaskState 注释）。 */
  async query(taskName) {
    return resolveTaskState(taskName);
  },
};

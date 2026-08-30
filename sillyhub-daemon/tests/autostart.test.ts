// tests/autostart.test.ts
// 2026-08-30-daemon-autostart task-06：autostart 三平台策略 + 顶层 API 单测
// （design §5 / 任务卡 implementation 全量落地）。
//
// mock 策略（风格对齐 tests/preflight.test.ts 与 tests/host-fs-handler.test.ts）：
//   - node:child_process → execFileMock（vi.hoisted + vi.fn）：所有
//     schtasks/powershell/launchctl/systemctl/loginctl 调用全 mock，任何平台运行
//     均不触发真实系统命令（macOS/Linux 实机归 CI 矩阵与 verify 阶段，R-08）；
//     回调经 setImmediate 异步触发，兼容 promisify（windows.ts）与 callback
//     形式（macos.ts runLaunchctl / linux.ts runCmd）两种消费面。
//   - node:os → homedir 重定向到临时 HOME（vi.mock 工厂内 mkdtemp 创建）：config.ts
//     的 DEFAULT_CONFIG_DIR（~/.sillyhub/daemon）、macos 的 ~/Library/LaunchAgents、
//     linux 的 ~/.config/systemd/user 全部落进临时目录，不污染真实家目录。
//   - node:fs/promises → 仅拦截 readFile('/proc/1/comm')（linux PID1 检测注入，
//     跨平台确定性——真实 /proc 在 Windows 不存在、在 Linux CI 又是真实 systemd，
//     不拦截则 PID1 用例无法在两平台跑出同一结果）；其余读写全走真实 fs +
//     临时 HOME（对齐 preflight.test.ts 的"真实 fs + 临时目录"惯例）。
//   - process.platform 三态覆写：Object.defineProperty（getter-only，先例见
//     tests/terminal-launcher.test.ts setPlatform / tests/credential.test.ts L361）。
//   - process.getuid：darwin 策略 guiDomain 依赖；Windows 上不存在 → 全局
//     beforeEach 统一 stub 为 501，afterEach 恢复原描述符（或删除）。
//
// 覆盖场景（任务卡 implementation 对照）：
//   Windows：VBS 逐字模板（", 0, False"/注释行/双引号转义/CRLF）+ schtasks 蓝图
//     argv（/SC ONLOGON /RL LIMITED /F；/TR 只含 wscript+vbs，R-02）+ access denied
//     → PowerShell -EncodedCommand 降级链（R-13/D-006）+ unregister /Delete /F +
//     VBS 删除（含任务不存在的幂等路径）+ query 三态 + nodePathDriftWarning 版本
//     化目录布局（R-01）。
//   macOS：plist 产物（RunAtLoad=true 且无 KeepAlive，D-002；ProgramArguments 五
//     元素绝对路径，R-06；StandardOut/ErrPath=.launchd.txt，R-09；XML 实体转义）
//     + bootout（忽略失败）→ bootstrap gui/<uid> 顺序 + bootstrap 失败 R-05 提示
//     + unregister（bootout + 删 plist，保留兜底日志）+ query label 精确匹配三态。
//   Linux：service INI 产物（无 Restart，D-002；ExecStart 模板 + 空格路径引号；
//     WantedBy=default.target）+ 命令序列 daemon-reload → enable → enable-linger
//     + PID1 非 systemd 零命令零文件明确报错（R-04）+ linger 失败仅 warn 仍
//     ok:true + unregister（disable --now 幂等 + 删文件 + reload）+ query 三态。
//   顶层 API：record 六字段落盘 / 凭据不进 record 与产物（D-004）/ 同 server 二次
//     enable 幂等（R-07）/ disable 全量清理（系统注销 + VBS + 本地记录，不杀进程）
//     / 不同 server 独立记录 / status 对账三态合并 / 未支持平台 ok:false /
//     disable 缺 target ok:false。
//   clean glob 防误删（R-09）：autostart-<hash8>.launchd.txt 经真实 performCleanup
//     幸存（*.log/*.out/*.err 全被清）。
//
// 不覆盖（归 task-07 tests/cli.test.ts）：CLI 层凭据缺失 exit 1 / saveConfigFn
// 无条件落盘 / --token 过期警告 / nvm 路径警告的 CLI 输出侧。

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

// ── hoisted 状态 + 模块 mock（vi.hoisted 先于一切 mock factory 执行）─────────

/** 跨 mock 工厂共享的可变状态。 */
const testState = vi.hoisted(() => ({
  /** 临时 HOME（node:os.homedir 重定向目标；node:os mock 工厂创建）。 */
  home: '',
  /** /proc/1/comm 模拟值（linux PID1 检测注入，默认 systemd 存在）。 */
  proc1Comm: 'systemd\n' as string,
}));

/** execFile 路由 mock（(cmd, args, opts, cb) → 按 route 表回调）。 */
const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));

// child_process 只被 autostart 三平台策略消费（execFile），mock 工厂仅需导出它。
// 附加 [util.promisify.custom]：windows.ts 的 promisify(execFile) 会直接取该
// 自定义实现（绕开对 vi.fn 的通用 promisify 包装），resolve { stdout, stderr } /
// reject 挂载 stdout/stderr 的 Error——与真实 child_process.execFile 的 promisify
// 形态逐字一致，成功路径 stdout 不丢失。
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  type ExecFileCb = (err: Error | null, stdout?: Buffer, stderr?: Buffer) => void;
  const customImpl = (
    file: string,
    args: string[],
    opts: unknown,
  ): Promise<{ stdout?: Buffer; stderr?: Buffer }> =>
    new Promise((resolve, reject) => {
      execFileMock(file, args, opts, ((err, stdout, stderr) => {
        if (err) {
          reject(err);
        } else {
          resolve({ stdout, stderr });
        }
      }) as ExecFileCb);
    });
  (execFileMock as unknown as Record<symbol, unknown>)[promisify.custom] = customImpl;
  return { execFile: execFileMock };
});

// node:os：仅重定向 homedir（config.ts / macos.ts / linux.ts 的家目录定位），
// 其余导出（tmpdir 等）原样透传，测试自身与图内其它模块不受影响。
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  testState.home = mkdtempSync(join(actual.tmpdir(), 'autostart-test-home-'));
  return { ...actual, homedir: () => testState.home };
});

// node:fs/promises：仅拦截 /proc/1/comm（linux.ts pid1Comm 读它做 PID1 检测），
// 其余（mkdir/writeFile/rm/readdir/readFile 其它路径）透传真实实现——所有写盘
// 走临时 HOME，对齐 preflight.test.ts 的真实 fs 惯例。
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const readFileIntercept = (path: unknown, opts?: unknown): unknown => {
    if (path === '/proc/1/comm') {
      return Promise.resolve(testState.proc1Comm);
    }
    return actual.readFile(path as never, opts as never);
  };
  return { ...actual, readFile: readFileIntercept as typeof actual.readFile };
});

// import 必须在 vi.mock 之后（vitest hoist 会处理顺序，为可读性放在 mock 后）。
import {
  autostartRecordPath,
  autostartStatus,
  buildStartCommand,
  currentScriptPath,
  disableAutostart,
  enableAutostart,
  taskNameFor,
} from '../src/autostart/index.js';
import type {
  AutostartPlatform,
  AutostartRecord,
} from '../src/autostart/index.js';
import {
  buildVbsContent,
  nodePathDriftWarning,
  vbsPathFor,
  windowsAutostartStrategy,
} from '../src/autostart/windows.js';
import {
  buildLaunchdPlist,
  launchAgentPlistPath,
  macosAutostartStrategy,
} from '../src/autostart/macos.js';
import { linuxAutostartStrategy } from '../src/autostart/linux.js';
import { DEFAULT_CONFIG_DIR, serverHash } from '../src/config.js';
import { performCleanup } from '../src/cleanup.js';

// ── 测试常量与 fixture ───────────────────────────────────────────────────────

const NODE_PATH = 'C:\\Program Files\\nodejs\\node.exe';
const SCRIPT_PATH = 'C:\\Users\\dev\\.sillyhub\\daemon\\bin\\sillyhub-daemon.js';
const SERVER_URL = 'http://localhost:8000';
const OTHER_SERVER_URL = 'http://other-host:9000';

/** 构造完整六字段 record（task_name 按平台 + serverUrl 派生，与 index.ts 同源）。 */
function makeRecord(
  platform: AutostartPlatform = 'win32',
  overrides: Partial<AutostartRecord> = {},
): AutostartRecord {
  const serverUrl = overrides.server_url ?? SERVER_URL;
  return {
    server_url: serverUrl,
    platform,
    node_path: NODE_PATH,
    script_path: SCRIPT_PATH,
    task_name: taskNameFor(platform, serverUrl),
    enabled_at: '2026-08-30T12:00:00.000Z',
    ...overrides,
  };
}

// ── execFile 路由 mock ───────────────────────────────────────────────────────

/** 单次命令的路由结果：ok 或失败（code/stdout/stderr 模拟真实 execFile 语义）。 */
type RouteOutcome =
  | { ok: true; stdout?: string; stderr?: string }
  | { ok: false; code?: number; stdout?: string; stderr?: string };

/** 路由函数：按 (cmd, args) 决定结果；测试内覆写 route 变量切换场景。 */
type RouteFn = (cmd: string, args: string[]) => RouteOutcome;

let route: RouteFn = () => ({ ok: true });

/** mock.calls 便捷视图：[cmd, args] 对。 */
function execCalls(): Array<[string, string[]]> {
  return execFileMock.mock.calls.map((c) => [String(c[0]), (c[1] ?? []) as string[]]);
}

/** 找到第一条满足谓词的调用（找不到返回 undefined，配合 toTruthy 断言）。 */
function findCall(pred: (cmd: string, args: string[]) => boolean): [string, string[]] | undefined {
  return execCalls().find(([cmd, args]) => pred(cmd, args));
}

// ── 平台 / getuid 覆写（先例：terminal-launcher.test.ts setPlatform）────────

const REAL_PLATFORM_DESC = Object.getOwnPropertyDescriptor(process, 'platform')!;
const REAL_GETUID_DESC = Object.getOwnPropertyDescriptor(process, 'getuid');

/** 覆写 process.platform（getter-only，须用 defineProperty）。 */
function setPlatform(p: 'win32' | 'darwin' | 'linux' | 'freebsd'): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

function restorePlatform(): void {
  Object.defineProperty(process, 'platform', REAL_PLATFORM_DESC);
}

/** stub process.getuid（Windows 上本不存在；darwin guiDomain 需要）。 */
function stubGetuid(uid: number): void {
  Object.defineProperty(process, 'getuid', { value: () => uid, configurable: true });
}

function restoreGetuid(): void {
  if (REAL_GETUID_DESC) {
    Object.defineProperty(process, 'getuid', REAL_GETUID_DESC);
  } else {
    delete (process as { getuid?: unknown }).getuid;
  }
}

// ── 全局钩子 ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  execFileMock.mockReset();
  route = () => ({ ok: true });
  testState.proc1Comm = 'systemd\n';
  execFileMock.mockImplementation((...callArgs: unknown[]) => {
    const cb = callArgs[callArgs.length - 1] as (
      err: Error | null,
      stdout?: Buffer,
      stderr?: Buffer,
    ) => void;
    const cmd = String(callArgs[0]);
    const args = (Array.isArray(callArgs[1]) ? callArgs[1] : []) as string[];
    const out = route(cmd, args);
    setImmediate(() => {
      const stdout = Buffer.from(out.stdout ?? '');
      const stderr = Buffer.from(out.stderr ?? '');
      if (out.ok) {
        cb(null, stdout, stderr);
      } else {
        // 失败形态对齐真实 execFile：Error.code=退出码，stdout/stderr 挂到 err
        // （windows.ts runSchtasks 的 catch 依赖 err.stdout/err.stderr）。
        const err = Object.assign(new Error(out.stderr ?? `mock exit ${out.code ?? 1}`), {
          code: out.code ?? 1,
          stdout,
          stderr,
        });
        cb(err, stdout, stderr);
      }
    });
  });
  stubGetuid(501);
});

afterEach(() => {
  restorePlatform();
  restoreGetuid();
  vi.restoreAllMocks();
});

afterAll(() => {
  if (testState.home) {
    rmSync(testState.home, { recursive: true, force: true });
  }
});

// ── mock 基建自检（全 mock 契约 + 平台覆写生效性）──────────────────────────

describe('mock 基建（全 mock 不触真实系统命令 + 平台覆写）', () => {
  it('execFile 为 mock 函数：任何被测路径都不触真实 schtasks/launchctl/systemctl', () => {
    expect(vi.isMockFunction(execFileMock)).toBe(true);
  });

  it('homedir 重定向临时 HOME：DEFAULT_CONFIG_DIR / LaunchAgents / systemd user 全隔离', () => {
    expect(homedir()).toBe(testState.home);
    expect(DEFAULT_CONFIG_DIR.startsWith(testState.home)).toBe(true);
    expect(
      launchAgentPlistPath('com.sillyhub.daemon.deadbeef').startsWith(testState.home),
    ).toBe(true);
    expect(join(testState.home, '.config', 'systemd', 'user').startsWith(testState.home)).toBe(
      true,
    );
  });

  it('process.platform 三态覆写生效（win32 / darwin / linux）', () => {
    for (const p of ['win32', 'darwin', 'linux'] as const) {
      setPlatform(p);
      expect(process.platform).toBe(p);
      restorePlatform();
    }
    expect(process.platform).toBe(REAL_PLATFORM_DESC.value);
  });
});

// ── 纯函数：启动命令模板与任务名派生 ────────────────────────────────────────

describe('纯函数：buildStartCommand / taskNameFor', () => {
  it('buildStartCommand：默认 node=process.execPath、script=resolve(argv[1])，模板含 start --server <url>', () => {
    const url = 'http://s1.example:8000';
    expect(buildStartCommand(url)).toBe(
      `${process.execPath} ${currentScriptPath()} start --server ${url}`,
    );
  });

  it('buildStartCommand：显式 node/script 路径逐字透传', () => {
    expect(buildStartCommand('http://s2:8000', '/usr/bin/node', '/opt/app/cli.js')).toBe(
      '/usr/bin/node /opt/app/cli.js start --server http://s2:8000',
    );
  });

  it('buildStartCommand：输出不含凭据字段（D-004——签名即无凭据，静态可保证）', () => {
    const cmd = buildStartCommand('http://s:8000', '/usr/bin/node', '/opt/app/cli.js');
    expect(cmd).not.toContain('api_key');
    expect(cmd).not.toContain('apiKey');
    expect(cmd).not.toContain('token');
  });

  it('taskNameFor：三平台任务名均带 serverHash(server_url) 8 位后缀', () => {
    const h = serverHash(SERVER_URL);
    expect(taskNameFor('win32', SERVER_URL)).toBe(`SillyHubDaemon-${h}`);
    expect(taskNameFor('darwin', SERVER_URL)).toBe(`com.sillyhub.daemon.${h}`);
    expect(taskNameFor('linux', SERVER_URL)).toBe(`sillyhub-daemon-${h}.service`);
  });

  it('vbsPathFor / launchAgentPlistPath：产物路径按任务名派生', () => {
    const h = serverHash(SERVER_URL);
    expect(vbsPathFor(`SillyHubDaemon-${h}`)).toBe(join(DEFAULT_CONFIG_DIR, `autostart-${h}.vbs`));
    expect(launchAgentPlistPath(`com.sillyhub.daemon.${h}`)).toBe(
      join(testState.home, 'Library', 'LaunchAgents', `com.sillyhub.daemon.${h}.plist`),
    );
  });
});

// ── Windows：VBS 中转脚本产物（buildVbsContent 纯函数直调断言真实输出）──────

describe('Windows：buildVbsContent VBS 产物', () => {
  it('逐字模板：注释行 + Run 尾参数 ", 0, False" + bundle 路径双引号转义（""）', () => {
    const content = buildVbsContent(makeRecord('win32'));
    expect(content).toBe(
      `' sillyhub-daemon autostart launcher (generated, do not edit)\r\n` +
        `CreateObject("WScript.Shell").Run "${NODE_PATH} ""${SCRIPT_PATH}"" start --server ${SERVER_URL}", 0, False\r\n`,
    );
  });

  it('行尾 CRLF：全文无裸 LF（VBS 惯例，writeFile 不做换行转换）', () => {
    const content = buildVbsContent(makeRecord('win32'));
    expect(content).not.toMatch(/(?<!\r)\n/);
    expect(content.endsWith('\r\n')).toBe(true);
  });

  it('命令体：node 与脚本均为绝对路径、含 start --server <url>、不含凭据（D-004）', () => {
    const content = buildVbsContent(makeRecord('win32'));
    expect(content).toContain(`${NODE_PATH} `);
    expect(content).toContain(SCRIPT_PATH);
    expect(content).toContain(`start --server ${SERVER_URL}`);
    expect(content).not.toContain('api_key');
    expect(content).not.toContain('token');
  });
});

// ── Windows：node 路径漂移检测（R-01）────────────────────────────────────────

describe('Windows：nodePathDriftWarning 版本化目录检测（R-01）', () => {
  it.each([
    // [node 路径布局, 是否应告警]
    ['C:\\Users\\u\\.nvm\\nodejs\\node.exe', true], // Windows nvm（点前缀）
    ['/home/u/.nvm/versions/node/v20.11.0/bin/node', true], // POSIX nvm（点前缀）
    ['C:\\Users\\u\\AppData\\Roaming\\nvm\\v20.11.0\\node.exe', true], // nvm-windows 版本根（无点）
    ['/usr/local/volta/bin/node', true], // volta（POSIX）
    ['C:\\Users\\u\\AppData\\Local\\Volta\\bin\\node.exe', true], // volta（Windows，大小写不敏感）
    ['/home/u/.asdf/shims/node', true], // asdf（点前缀）
    ['C:\\Users\\u\\.asdf\\installs\\node\\22.0.0\\node.exe', true], // asdf（Windows）
    ['C:\\Program Files\\nodejs\\node.exe', false], // 官方安装（无漂移）
    ['/usr/local/bin/node', false], // 系统包管理器安装（无漂移）
    ['C:\\Users\\u\\AppData\\Roaming\\nvm4w\\nodejs\\node.exe', false], // nvm4w 活动目录（junction 跨版本稳定）
  ])('路径 %s → 告警=%s', (nodePath, expected) => {
    expect(nodePathDriftWarning(nodePath) !== null).toBe(expected);
  });

  it('命中时警告文案含修复指引（重新执行本命令即可）', () => {
    const warning = nodePathDriftWarning('/home/u/.nvm/v20.11.0/bin/node');
    expect(warning).toContain('重新执行本命令');
    expect(nodePathDriftWarning('/usr/bin/node')).toBeNull();
  });
});

// ── Windows 策略：register / unregister / query ─────────────────────────────

describe('Windows 策略（schtasks + VBS）', () => {
  beforeEach(() => {
    rmSync(DEFAULT_CONFIG_DIR, { recursive: true, force: true });
  });

  it('register 成功：schtasks 蓝图 argv（/SC ONLOGON /RL LIMITED /F）+ /TR 只含 wscript+vbs（R-02）+ VBS 落盘', async () => {
    const record = makeRecord('win32');
    const vbsPath = vbsPathFor(record.task_name);

    const res = await windowsAutostartStrategy.register(record);

    expect(res).toEqual({ ok: true });
    const create = findCall((cmd, args) => cmd === 'schtasks' && args[0] === '/Create');
    expect(create).toBeTruthy();
    expect(create![1]).toEqual([
      '/Create',
      '/TN',
      record.task_name,
      '/SC',
      'ONLOGON',
      '/TR',
      `wscript.exe "${vbsPath}"`,
      '/RL',
      'LIMITED',
      '/F',
    ]);
    // R-02：/TR 不含 node/脚本/URL——规避 261 字符限制与引号转义地狱
    const tr = create![1][6]!;
    expect(tr).not.toContain(NODE_PATH);
    expect(tr).not.toContain(SCRIPT_PATH);
    expect(tr).not.toContain(SERVER_URL);
    // VBS 中转脚本真实落盘，内容与纯函数产物一致
    expect(readFileSync(vbsPath, 'utf-8')).toBe(buildVbsContent(record));
    // 成功路径不触碰 PowerShell 降级链
    expect(findCall((cmd) => cmd === 'powershell.exe')).toBeUndefined();
  });

  it('schtasks 报"拒绝访问"（中文 locale）→ 降级 PowerShell Register-ScheduledTask（-EncodedCommand）', async () => {
    const record = makeRecord('win32');
    route = (cmd, args) => {
      if (cmd === 'schtasks' && args[0] === '/Create') {
        return { ok: false, code: 1, stderr: '错误: 拒绝访问。' };
      }
      return { ok: true };
    };

    const res = await windowsAutostartStrategy.register(record);

    expect(res).toEqual({ ok: true });
    const ps = findCall((cmd) => cmd === 'powershell.exe');
    expect(ps).toBeTruthy();
    expect(ps![1]).toContain('-NoProfile');
    expect(ps![1]).toContain('-EncodedCommand');
    // EncodedCommand = base64(UTF-16LE)：解码断言降级链脚本内容（AtLogOn 触发 + wscript 中转）
    const encoded = ps![1][ps![1].indexOf('-EncodedCommand') + 1]!;
    const script = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(script).toContain('Register-ScheduledTask');
    expect(script).toContain('New-ScheduledTaskTrigger -AtLogOn');
    expect(script).toContain("'wscript.exe'");
    expect(script).toContain(vbsPathFor(record.task_name));
    expect(script).toContain(record.task_name);
  });

  it('access denied（英文 locale "Access is denied."）同样触发 PowerShell 降级且注册成功', async () => {
    route = (cmd, args) => {
      if (cmd === 'schtasks' && args[0] === '/Create') {
        return { ok: false, code: 1, stderr: 'ERROR: Access is denied.' };
      }
      return { ok: true };
    };

    const res = await windowsAutostartStrategy.register(makeRecord('win32'));

    expect(res).toEqual({ ok: true });
    expect(findCall((cmd) => cmd === 'powershell.exe')).toBeTruthy();
  });

  it('schtasks 其他失败（非拒绝访问）→ ok:false 且不走 PowerShell 降级', async () => {
    route = (cmd, args) => {
      if (cmd === 'schtasks' && args[0] === '/Create') {
        return { ok: false, code: 1, stderr: 'ERROR: The task XML is malformed.' };
      }
      return { ok: true };
    };

    const res = await windowsAutostartStrategy.register(makeRecord('win32'));

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('schtasks /Create failed');
    }
    expect(findCall((cmd) => cmd === 'powershell.exe')).toBeUndefined();
  });

  it('降级链 PowerShell 也失败 → ok:false 汇总两侧错误 + 提权 hint（R-13）', async () => {
    route = (cmd) =>
      cmd === 'schtasks'
        ? { ok: false, code: 1, stderr: '错误: 拒绝访问。' }
        : { ok: false, code: 1, stderr: 'Register-ScheduledTask : 拒绝访问。' };

    const res = await windowsAutostartStrategy.register(makeRecord('win32'));

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('PowerShell Register-ScheduledTask failed');
      expect(res.hint).toContain('管理员');
    }
  });

  it('unregister：schtasks /Delete /TN <名> /F + 删除 VBS 文件', async () => {
    const record = makeRecord('win32');
    await windowsAutostartStrategy.register(record);
    execFileMock.mockClear();

    const res = await windowsAutostartStrategy.unregister(record.task_name);

    expect(res).toEqual({ ok: true });
    expect(findCall((cmd) => cmd === 'schtasks')![1]).toEqual([
      '/Delete',
      '/TN',
      record.task_name,
      '/F',
    ]);
    expect(existsSync(vbsPathFor(record.task_name))).toBe(false);
  });

  it('unregister 幂等：任务不存在（/Delete 失败 + 全量列表无该任务）→ 仍 ok 且清理 VBS', async () => {
    const record = makeRecord('win32');
    await windowsAutostartStrategy.register(record);
    execFileMock.mockClear();
    route = (cmd, args) => {
      if (cmd === 'schtasks' && args[0] === '/Delete') {
        return { ok: false, code: 1, stderr: '错误: 系统找不到指定的文件。' };
      }
      if (cmd === 'schtasks' && args.includes('CSV')) {
        // 全量 CSV 列表：只有别的任务（locale 无关的 missing 判定路径）。
        // 根文件夹任务在 CSV 中记为 "\TaskName"（单反斜杠，实机样本格式）
        return { ok: true, stdout: '"\\OtherTask","2026/8/30 23:59:00","就绪"\r\n' };
      }
      return { ok: true };
    };

    const res = await windowsAutostartStrategy.unregister(record.task_name);

    expect(res).toEqual({ ok: true });
    expect(existsSync(vbsPathFor(record.task_name))).toBe(false);
    expect(findCall((cmd, args) => cmd === 'schtasks' && args.includes('CSV'))).toBeTruthy();
  });

  it('unregister 真失败（列表仍可见该任务）→ ok:false 透出 schtasks 错误', async () => {
    const taskName = taskNameFor('win32', SERVER_URL);
    route = (cmd, args) => {
      if (cmd === 'schtasks' && args[0] === '/Delete') {
        return { ok: false, code: 1, stderr: 'ERROR: cannot delete' };
      }
      if (cmd === 'schtasks' && args.includes('CSV')) {
        // 根文件夹任务在 CSV 中记为 "\TaskName"（单反斜杠，实机样本格式）
        return { ok: true, stdout: `"\\${taskName}","2026/8/30","就绪"\r\n` };
      }
      return { ok: true };
    };

    const res = await windowsAutostartStrategy.unregister(taskName);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('schtasks /Delete failed');
    }
  });

  it('query：/Query /TN 退出 0 → registered（最快路径）', async () => {
    const res = await windowsAutostartStrategy.query(taskNameFor('win32', SERVER_URL));
    expect(res).toEqual({ systemState: 'registered' });
  });

  it('query：单查失败但全量列表可见 → registered（locale 无关复核）', async () => {
    const taskName = taskNameFor('win32', SERVER_URL);
    route = (cmd, args) => {
      if (cmd === 'schtasks' && args.includes('CSV')) {
        // 根文件夹任务在 CSV 中记为 "\TaskName"（单反斜杠，实机样本格式）
        return { ok: true, stdout: `"\\${taskName}","2026/8/30","就绪"\r\n` };
      }
      return { ok: false, code: 1, stderr: '错误' };
    };

    const res = await windowsAutostartStrategy.query(taskName);

    expect(res).toEqual({ systemState: 'registered' });
  });

  it('query：单查失败 + 列表成功但无该任务 → missing', async () => {
    route = (cmd, args) => {
      if (cmd === 'schtasks' && args.includes('CSV')) {
        return { ok: true, stdout: '"\\\\SomethingElse","a","b"\r\n' };
      }
      return { ok: false, code: 1, stderr: '错误' };
    };

    const res = await windowsAutostartStrategy.query(taskNameFor('win32', SERVER_URL));

    expect(res).toEqual({ systemState: 'missing' });
  });

  it('query：单查与列表均失败 → unknown + error 透出失败原因', async () => {
    route = () => ({ ok: false, code: 1, stderr: 'service down' });

    const res = await windowsAutostartStrategy.query(taskNameFor('win32', SERVER_URL));

    expect(res.systemState).toBe('unknown');
    expect(res.error).toContain('schtasks /Query failed');
  });
});

// ── macOS：plist 产物（buildLaunchdPlist 纯函数直调断言真实输出）────────────

describe('macOS：buildLaunchdPlist plist 产物', () => {
  it('含 RunAtLoad=true，且全文无 KeepAlive 键（D-002 无保活）', () => {
    const plist = buildLaunchdPlist(makeRecord('darwin'));
    expect(plist).toContain('<key>RunAtLoad</key>');
    expect(plist).toContain('<true/>');
    expect(plist).not.toContain('KeepAlive');
  });

  it('Label = task_name（com.sillyhub.daemon.<hash8>）', () => {
    const plist = buildLaunchdPlist(makeRecord('darwin'));
    expect(plist).toContain(`<string>${taskNameFor('darwin', SERVER_URL)}</string>`);
  });

  it('ProgramArguments 五元素绝对路径数组：[node, script, start, --server, url]（R-06）', () => {
    const plist = buildLaunchdPlist(makeRecord('darwin'));
    const arr = plist.slice(plist.indexOf('<array>') + '<array>'.length, plist.indexOf('</array>'));
    const strings = arr
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/^<string>/, '').replace(/<\/string>$/, ''));
    expect(strings).toEqual([NODE_PATH, SCRIPT_PATH, 'start', '--server', SERVER_URL]);
  });

  it('StandardOutPath/StandardErrorPath 均指向 autostart-<hash8>.launchd.txt（R-09 避 clean glob）', () => {
    const plist = buildLaunchdPlist(makeRecord('darwin'));
    const logPath = join(DEFAULT_CONFIG_DIR, `autostart-${serverHash(SERVER_URL)}.launchd.txt`);
    expect(plist).toContain('<key>StandardOutPath</key>');
    expect(plist).toContain('<key>StandardErrorPath</key>');
    // stdout/stderr 共用同一文件：全文恰好出现两次
    expect(plist.split(logPath).length - 1).toBe(2);
    expect(logPath).toMatch(/autostart-[0-9a-f]{8}\.launchd\.txt$/);
  });

  it('插值全部 XML 实体转义：server_url 含 & < > 仍为合法 XML', () => {
    const record = makeRecord('darwin', { server_url: 'http://h:8000/?a=1&b=<2>' });
    const plist = buildLaunchdPlist(record);
    expect(plist).toContain('http://h:8000/?a=1&amp;b=&lt;2&gt;');
  });
});

// ── macOS 策略（launchctl）──────────────────────────────────────────────────

describe('macOS 策略（launchd LaunchAgent）', () => {
  beforeEach(() => {
    rmSync(join(testState.home, 'Library'), { recursive: true, force: true });
    rmSync(DEFAULT_CONFIG_DIR, { recursive: true, force: true });
  });

  it('register：写 plist 到 ~/Library/LaunchAgents → bootout 幂等清场先于 bootstrap gui/<uid>', async () => {
    const record = makeRecord('darwin');
    const plistPath = launchAgentPlistPath(record.task_name);

    const res = await macosAutostartStrategy.register(record);

    expect(res).toEqual({ ok: true });
    expect(existsSync(plistPath)).toBe(true);
    expect(readFileSync(plistPath, 'utf-8')).toBe(buildLaunchdPlist(record));
    expect(execCalls()).toEqual([
      ['launchctl', ['bootout', `gui/501/${record.task_name}`]],
      ['launchctl', ['bootstrap', 'gui/501', plistPath]],
    ]);
  });

  it('bootout 失败被忽略（未注册时本就报 No such process）→ bootstrap 成功即注册成功（R-07 幂等清场）', async () => {
    route = (cmd, args) =>
      args[0] === 'bootout' ? { ok: false, stderr: 'No such process' } : { ok: true };

    const res = await macosAutostartStrategy.register(makeRecord('darwin'));

    expect(res).toEqual({ ok: true });
  });

  it('bootstrap 失败（SSH-only 无 GUI domain，R-05）→ ok:false + hint 引导本地图形会话，plist 不回滚', async () => {
    const record = makeRecord('darwin');
    route = (cmd, args) =>
      args[0] === 'bootstrap'
        ? { ok: false, stderr: 'Bootstrap failed: 5: Input/output error' }
        : { ok: true };

    const res = await macosAutostartStrategy.register(record);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('launchctl bootstrap failed');
      expect(res.hint).toContain('SSH');
    }
    // plist 残留无害（重跑 enable 幂等覆盖 / disable 可清理）
    expect(existsSync(launchAgentPlistPath(record.task_name))).toBe(true);
  });

  it('unregister：bootout + 删 plist，保留 .launchd.txt 兜底日志，不杀进程', async () => {
    const record = makeRecord('darwin');
    await macosAutostartStrategy.register(record);
    const logPath = join(DEFAULT_CONFIG_DIR, `autostart-${serverHash(SERVER_URL)}.launchd.txt`);
    mkdirSync(DEFAULT_CONFIG_DIR, { recursive: true });
    writeFileSync(logPath, 'launchd stdout');
    execFileMock.mockClear();

    const res = await macosAutostartStrategy.unregister(record.task_name);

    expect(res).toEqual({ ok: true });
    expect(execCalls()).toEqual([['launchctl', ['bootout', `gui/501/${record.task_name}`]]]);
    expect(existsSync(launchAgentPlistPath(record.task_name))).toBe(false);
    expect(existsSync(logPath)).toBe(true);
  });

  it('query：launchctl list 末列精确等于 label → registered', async () => {
    const label = taskNameFor('darwin', SERVER_URL);
    route = () => ({
      ok: true,
      stdout: `PID\tStatus\tLabel\n501\t0\t${label}\n-\t0\tcom.apple.other\n`,
    });

    const res = await macosAutostartStrategy.query(label);

    expect(res).toEqual({ systemState: 'registered' });
  });

  it('query：列表成功但无该 label → missing', async () => {
    route = () => ({ ok: true, stdout: 'PID\tStatus\tLabel\n-\t0\tcom.apple.other\n' });

    const res = await macosAutostartStrategy.query(taskNameFor('darwin', SERVER_URL));

    expect(res).toEqual({ systemState: 'missing' });
  });

  it('query：launchctl 失败 → unknown + error 透出原因', async () => {
    route = () => ({ ok: false, stderr: 'launchctl crash' });

    const res = await macosAutostartStrategy.query(taskNameFor('darwin', SERVER_URL));

    expect(res.systemState).toBe('unknown');
    expect(res.error).toContain('launchctl list failed');
  });
});

// ── Linux 策略（systemd user service）───────────────────────────────────────

describe('Linux 策略（systemd user service）', () => {
  /** unit 文件路径（linux.ts SYSTEMD_USER_DIR = ~/.config/systemd/user）。 */
  function unitPath(taskName: string): string {
    return join(testState.home, '.config', 'systemd', 'user', taskName);
  }

  beforeEach(() => {
    rmSync(join(testState.home, '.config'), { recursive: true, force: true });
  });

  it('register 成功：service INI 三段齐全 + ExecStart 模板 + WantedBy=default.target，全文无 Restart（D-002）', async () => {
    const record = makeRecord('linux', {
      node_path: '/usr/bin/node',
      script_path: '/home/dev/.sillyhub/daemon/bin/sillyhub-daemon.js',
    });

    const res = await linuxAutostartStrategy.register(record);

    expect(res).toEqual({ ok: true });
    const content = readFileSync(unitPath(record.task_name), 'utf-8');
    expect(content).toContain('[Unit]');
    expect(content).toContain('[Service]');
    expect(content).toContain('[Install]');
    expect(content).toContain('WantedBy=default.target');
    expect(content).not.toContain('Restart');
    expect(content).toContain(
      `ExecStart=/usr/bin/node /home/dev/.sillyhub/daemon/bin/sillyhub-daemon.js start --server ${SERVER_URL}`,
    );
    expect(content).toContain(`Description=SillyHub Daemon (${SERVER_URL})`);
  });

  it('register 成功：ExecStart 路径含空格时该词元双引号包裹（INI 引号规则）', async () => {
    const record = makeRecord('linux'); // node_path = C:\Program Files\... 含空格

    const res = await linuxAutostartStrategy.register(record);

    expect(res).toEqual({ ok: true });
    const content = readFileSync(unitPath(record.task_name), 'utf-8');
    expect(content).toContain(`ExecStart="${NODE_PATH}" ${SCRIPT_PATH} start --server ${SERVER_URL}`);
  });

  it('register 命令序列：daemon-reload → enable <unit> → enable-linger（顺序与 argv 精确）', async () => {
    const record = makeRecord('linux');

    const res = await linuxAutostartStrategy.register(record);

    expect(res).toEqual({ ok: true });
    expect(execCalls()).toEqual([
      ['systemctl', ['--user', 'daemon-reload']],
      ['systemctl', ['--user', 'enable', record.task_name]],
      ['loginctl', ['enable-linger']],
    ]);
  });

  it('PID1 非 systemd（WSL 默认 init，R-04）→ ok:false 明确报错含替代建议，零命令执行零文件写入', async () => {
    testState.proc1Comm = 'init\n';

    const res = await linuxAutostartStrategy.register(makeRecord('linux'));

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('systemd unavailable');
      expect(res.error).toContain('"init"');
      expect(res.hint).toContain('WSL');
      expect(res.hint).toContain('Windows');
    }
    // R-04：前置检测失败 → 不执行任何注册命令（含 ps 回退——/proc/1/comm 已 mock 命中）
    expect(execFileMock).not.toHaveBeenCalled();
    expect(existsSync(join(testState.home, '.config'))).toBe(false);
  });

  it('enable-linger 失败（polkit 拒绝）→ 仅 warn 降级为登录后自启，ok 仍 true 且 reload/enable 已执行', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    route = (cmd) =>
      cmd === 'loginctl' ? { ok: false, code: 1, stderr: 'Access denied' } : { ok: true };

    const res = await linuxAutostartStrategy.register(makeRecord('linux'));

    expect(res).toEqual({ ok: true });
    const argvText = execCalls()
      .map(([cmd, args]) => `${cmd} ${args.join(' ')}`)
      .join('\n');
    expect(argvText).toContain('daemon-reload');
    expect(argvText).toContain('enable ');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]![0])).toContain('enable-linger');
  });

  it('unregister：disable --now → 删 unit 文件 → daemon-reload（不杀运行中进程）', async () => {
    const record = makeRecord('linux');
    await linuxAutostartStrategy.register(record);
    execFileMock.mockClear();

    const res = await linuxAutostartStrategy.unregister(record.task_name);

    expect(res).toEqual({ ok: true });
    expect(execCalls()).toEqual([
      ['systemctl', ['--user', 'disable', '--now', record.task_name]],
      ['systemctl', ['--user', 'daemon-reload']],
    ]);
    expect(existsSync(unitPath(record.task_name))).toBe(false);
  });

  it('unregister 幂等：unit 不存在（not-found 文案）→ 视为已注销成功', async () => {
    route = (cmd, args) => {
      if (cmd === 'systemctl' && args.includes('disable')) {
        return { ok: false, code: 1, stderr: 'Failed to disable unit: unit does not exist.' };
      }
      return { ok: true };
    };

    const res = await linuxAutostartStrategy.unregister(taskNameFor('linux', SERVER_URL));

    expect(res).toEqual({ ok: true });
  });

  it.each([
    ['enabled\n', 'registered'],
    ['enabled-runtime\n', 'registered'],
    ['disabled\n', 'missing'],
    ['not-found\n', 'missing'],
  ])('query：is-enabled 输出 %s → %s', async (stdout, expected) => {
    route = (cmd) => (cmd === 'systemctl' ? { ok: true, stdout } : { ok: true });

    const res = await linuxAutostartStrategy.query(taskNameFor('linux', SERVER_URL));

    expect(res.systemState).toBe(expected);
  });

  it('query：is-enabled 失败且报 unit 不存在 → missing（旧版 systemd 文案口径）', async () => {
    route = () => ({
      ok: false,
      code: 1,
      stderr: 'Failed to get unit file state: No such file or directory',
    });

    const res = await linuxAutostartStrategy.query(taskNameFor('linux', SERVER_URL));

    expect(res.systemState).toBe('missing');
  });

  it('query：无 systemd 用户总线（R-05）→ unknown + error 透出原因', async () => {
    route = () => ({ ok: false, code: 1, stderr: 'Failed to connect to bus' });

    const res = await linuxAutostartStrategy.query(taskNameFor('linux', SERVER_URL));

    expect(res.systemState).toBe('unknown');
    expect(res.error).toContain('is-enabled');
  });
});

// ── 顶层 API：enableAutostart / disableAutostart / autostartStatus ──────────

describe('顶层 API enable/disable/status（平台分派 + 记录读写）', () => {
  beforeEach(() => {
    rmSync(DEFAULT_CONFIG_DIR, { recursive: true, force: true });
    rmSync(join(testState.home, 'Library'), { recursive: true, force: true });
    rmSync(join(testState.home, '.config'), { recursive: true, force: true });
  });

  it('win32 enable：AutostartRecord 六字段齐全（含固化双绝对路径）且逐字落盘', async () => {
    setPlatform('win32');

    const res = await enableAutostart({ serverUrl: SERVER_URL });

    expect(res.ok).toBe(true);
    if (!res.ok) {
      throw new Error(res.error);
    }
    const rec = res.record;
    expect(rec.server_url).toBe(SERVER_URL);
    expect(rec.platform).toBe('win32');
    expect(rec.node_path).toBe(process.execPath);
    expect(rec.script_path).toBe(currentScriptPath());
    expect(rec.task_name).toBe(taskNameFor('win32', SERVER_URL));
    expect(Number.isNaN(Date.parse(rec.enabled_at))).toBe(false); // ISO 8601 可解析
    // 本地记录落盘内容与返回 record 逐字一致；键集合恰为六字段
    const onDisk = JSON.parse(readFileSync(autostartRecordPath(SERVER_URL), 'utf-8'));
    expect(onDisk).toEqual(rec);
    expect(Object.keys(onDisk).sort()).toEqual([
      'enabled_at',
      'node_path',
      'platform',
      'script_path',
      'server_url',
      'task_name',
    ]);
  });

  it('凭据不进 record / 命令 / 产物（D-004）：apiKey 传入后无任何泄漏点', async () => {
    setPlatform('win32');

    const res = await enableAutostart({
      serverUrl: SERVER_URL,
      apiKey: 'sk-secret-do-not-leak',
    });

    expect(res.ok).toBe(true);
    const recordText = readFileSync(autostartRecordPath(SERVER_URL), 'utf-8');
    expect(recordText).not.toContain('sk-secret-do-not-leak');
    expect(recordText).not.toContain('api_key');
    expect(recordText).not.toContain('"token"');
    const vbsText = readFileSync(vbsPathFor(taskNameFor('win32', SERVER_URL)), 'utf-8');
    expect(vbsText).not.toContain('sk-secret-do-not-leak');
    expect(JSON.stringify(execFileMock.mock.calls)).not.toContain('sk-secret-do-not-leak');
  });

  it('幂等（R-07）：同 server 二次 enable 均成功（/F 覆盖），仅一份本地记录', async () => {
    setPlatform('win32');

    const first = await enableAutostart({ serverUrl: SERVER_URL });
    const second = await enableAutostart({ serverUrl: SERVER_URL });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    const creates = execCalls().filter(([cmd, args]) => cmd === 'schtasks' && args[0] === '/Create');
    expect(creates).toHaveLength(2);
    expect(creates[0]![1]).toContain('/F');
    const jsons = readdirSync(DEFAULT_CONFIG_DIR).filter(
      (n) => /^autostart-[0-9a-f]{8}\.json$/.test(n),
    );
    expect(jsons).toHaveLength(1);
  });

  it('disable 清理：系统注销（/Delete /F）+ VBS 删除 + 本地记录删除，不触发杀进程命令', async () => {
    setPlatform('win32');
    await enableAutostart({ serverUrl: SERVER_URL });
    execFileMock.mockClear();

    const res = await disableAutostart({ serverUrl: SERVER_URL });

    expect(res).toEqual({ ok: true, removed: [SERVER_URL] });
    expect(existsSync(autostartRecordPath(SERVER_URL))).toBe(false);
    expect(existsSync(vbsPathFor(taskNameFor('win32', SERVER_URL)))).toBe(false);
    expect(findCall((cmd, args) => cmd === 'schtasks' && args[0] === '/Delete')).toBeTruthy();
    // 只清注册产物：无 taskkill/kill 类命令（停进程归 stop，design §3）
    expect(execCalls().some(([cmd]) => /taskkill|kill/i.test(cmd))).toBe(false);
  });

  it('不同 server 独立记录（R-07）：autostart-<hash8>.json 两份 + task_name 互不相同', async () => {
    setPlatform('win32');

    await enableAutostart({ serverUrl: SERVER_URL });
    await enableAutostart({ serverUrl: OTHER_SERVER_URL });

    expect(existsSync(autostartRecordPath(SERVER_URL))).toBe(true);
    expect(existsSync(autostartRecordPath(OTHER_SERVER_URL))).toBe(true);
    const status = await autostartStatus();
    expect(status.map((s) => s.server_url).sort()).toEqual(
      [SERVER_URL, OTHER_SERVER_URL].sort(),
    );
    expect(status[0]!.task_name).not.toBe(status[1]!.task_name);
  });

  it('status 对账：systemState 三态（registered / missing / unknown）合并进条目', async () => {
    setPlatform('win32');
    await enableAutostart({ serverUrl: SERVER_URL });

    // registered：/Query /TN 退出 0（最快路径）
    route = (cmd, args) => {
      if (cmd === 'schtasks' && args[0] === '/Query' && !args.includes('CSV')) {
        return { ok: true };
      }
      return { ok: true };
    };
    expect((await autostartStatus())[0]!.systemState).toBe('registered');

    // missing：单查失败 + 全量列表成功但无该任务
    route = (cmd, args) => {
      if (cmd === 'schtasks' && args.includes('CSV')) {
        return { ok: true, stdout: '"\\SomethingElse","a","b"\r\n' };
      }
      return { ok: false, code: 1, stderr: 'x' };
    };
    expect((await autostartStatus())[0]!.systemState).toBe('missing');

    // unknown：两次查询均失败
    route = () => ({ ok: false, code: 1, stderr: 'service down' });
    expect((await autostartStatus())[0]!.systemState).toBe('unknown');
  });

  it('darwin 分派：enable 写 plist + task_name = com.sillyhub.daemon.<hash8>', async () => {
    setPlatform('darwin');

    const res = await enableAutostart({ serverUrl: SERVER_URL });

    expect(res.ok).toBe(true);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.record.platform).toBe('darwin');
    expect(res.record.task_name).toBe(taskNameFor('darwin', SERVER_URL));
    expect(existsSync(launchAgentPlistPath(res.record.task_name))).toBe(true);
    expect(findCall((cmd, args) => cmd === 'launchctl' && args[0] === 'bootstrap')).toBeTruthy();
  });

  it('linux 分派：enable 写 unit 文件 + task_name = sillyhub-daemon-<hash8>.service', async () => {
    setPlatform('linux');

    const res = await enableAutostart({ serverUrl: SERVER_URL });

    expect(res.ok).toBe(true);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.record.task_name).toBe(taskNameFor('linux', SERVER_URL));
    expect(existsSync(join(testState.home, '.config', 'systemd', 'user', res.record.task_name))).toBe(
      true,
    );
    expect(findCall((cmd, args) => cmd === 'systemctl' && args[1] === 'enable')).toBeTruthy();
  });

  it('未支持平台（freebsd）→ ok:false 不抛异常，零系统命令', async () => {
    setPlatform('freebsd');

    const res = await enableAutostart({ serverUrl: SERVER_URL });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('unsupported platform: freebsd');
    }
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('disable 缺 target（无 serverUrl 无 all）→ ok:false（选择交互归 CLI 层 task-07）', async () => {
    const res = await disableAutostart({});
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('disable target required');
    }
  });

  it('disable 孤儿注册：本地记录缺失也按派生任务名注销（任务不存在 → 幂等成功）', async () => {
    setPlatform('win32');

    const res = await disableAutostart({ serverUrl: SERVER_URL });

    expect(res).toEqual({ ok: true, removed: [SERVER_URL] });
  });
});

// ── clean glob 防误删（R-09）────────────────────────────────────────────────

describe('clean glob 防误删（R-09：.launchd.txt 兜底文件幸存）', () => {
  it('autostart-<hash8>.launchd.txt 不命中 performCleanup 根目录日志 glob（*.log/*.out/*.err）', async () => {
    // Arrange：临时目录放兜底文件 + 三个应被清的 decoy（rootLogFilePatterns，
    // src/cleanup.ts:131 ['*.log', '*.out', '*.err', 'config*.json.bak*']——常量未
    // 导出，用真实 performCleanup 行为对账，cleanup 改列表本测试自动跟随）
    const dir = mkdtempSync(join(tmpdir(), 'autostart-clean-test-'));
    try {
      const logName = `autostart-${serverHash(SERVER_URL)}.launchd.txt`;
      writeFileSync(join(dir, logName), 'launchd output');
      writeFileSync(join(dir, 'daemon.log'), 'x');
      writeFileSync(join(dir, 'agent.out'), 'x');
      writeFileSync(join(dir, 'agent.err'), 'x');

      // Act
      await performCleanup(dir);

      // Assert：decoy 全清、兜底文件幸存
      expect(existsSync(join(dir, logName))).toBe(true);
      expect(existsSync(join(dir, 'daemon.log'))).toBe(false);
      expect(existsSync(join(dir, 'agent.out'))).toBe(false);
      expect(existsSync(join(dir, 'agent.err'))).toBe(false);
      expect(logName).toMatch(/^autostart-[0-9a-f]{8}\.launchd\.txt$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

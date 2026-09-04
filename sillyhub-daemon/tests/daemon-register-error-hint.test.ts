/**
 * ql-20260904-026：register 鉴权/归属类失败的终端中文提示 + 后台进程 console tee。
 *
 * 背景：换账号 API Key 复用机器身份时 register 被 403（ownership mismatch），
 * daemon 只在内部日志静默重试；自更新 respawn（stdio=ignore）/ VBS 隐藏自启
 * 场景 console 输出更是凭空丢失——用户看到「启动不了」却零提示。
 *
 * 覆盖：
 *   - 403 ownership mismatch → 首错立即 console.error 中文提示（含出路文案）；
 *   - 节流：连续失败第 2..N-1 次不再重发（每 REGISTER_HINT_EVERY_N_FAILURES 次一条）；
 *   - 恢复：失败后成功 → console.log「注册已恢复」+ 计数清零（再失败立即重新提示）；
 *   - 401 → API Key 无效提示；
 *   - 网络错误（非 HubHttpError）→ 不打终端提示；
 *   - attachConsoleToLogFile：console 输出 tee 到指定日志文件。
 *
 * 策略：真实构造 Daemon（client mock 只提供 register，照
 * daemon-heartbeat-sillyspec.test.ts 的 makeRegisterHarness 惯例），私有方法
 * _registerDaemon 经 cast 直调；console 经 vi.spyOn 捕获并静音。
 *
 * @module daemon-register-error-hint.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Daemon, REGISTER_HINT_EVERY_N_FAILURES } from '../src/daemon.js';
import { HubHttpError } from '../src/hub-client.js';
import type { DaemonConfig } from '../src/config.js';

/** 完整 DaemonConfig fixture（循环间隔拉满防噪音；sillyspec 循环关闭防探测）。 */
function makeConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  return {
    server_url: 'http://127.0.0.1:8000',
    token: null,
    api_key: null,
    runtime_id: 'rt-reg-hint',
    profile: 'default',
    workspace_dir: '/tmp/ws-reg-hint',
    poll_interval: 9999,
    heartbeat_interval: 9999,
    max_concurrent_tasks: 5,
    log_level: 'error',
    default_timeout_seconds: 1800,
    max_retries: 1,
    retry_max_attempts: 3,
    retry_base_delay_ms: 1000,
    retry_backoff_factor: 2,
    retry_jitter: 0.2,
    loop_restart_backoff_ms: 5000,
    max_loop_restarts: 10,
    outbox_max_per_run: 500,
    outbox_max_total: 5000,
    disconnect_log_threshold_sec: 30,
    terminal_observer_enabled: false,
    terminal_observer_mode: 'parsed',
    terminal_observer_close_on_exit: false,
    terminal_observer_command: null,
    lease_heartbeat_interval: 5,
    allowed_roots: [],
    spec_root_map: '',
    self_reload_check_interval_sec: 600,
    sillyspec_update_interval_sec: 9999,
    sillyspec_status_interval_sec: 0,
    ...overrides,
  };
}

/** 最小假 SillySpecManager——_registerDaemon 注册前只用 probeLocal/probeLatest/getSnapshot。 */
function makeFakeManager() {
  return {
    getSnapshot: vi.fn(() => ({ version: null, latest_version: null })),
    probeLocal: vi.fn(async () => null),
    probeLatest: vi.fn(async () => null),
  };
}

/** 注册 harness：真实 Daemon + 可编程 register mock。 */
function makeRegisterHarness(registerImpl: () => Promise<unknown>) {
  const registerMock = vi.fn(registerImpl);
  const daemon = new Daemon(
    makeConfig(),
    { register: registerMock } as never,
    null as never,
    { sessionManager: null, sillyspecManager: makeFakeManager() as never },
  );
  const registerDaemon = (): Promise<void> =>
    (daemon as unknown as { _registerDaemon: (agents: unknown[]) => Promise<void> })._registerDaemon(
      [{ provider: 'claude', path: '/usr/bin/claude' }],
    );
  return { daemon, registerMock, registerDaemon };
}

function ownershipError(): HubHttpError {
  return new HubHttpError(
    403,
    JSON.stringify({ code: 'HTTP_403_DAEMON_INSTANCE_OWNERSHIP_MISMATCH', message: '已被其他用户注册' }),
    'http://127.0.0.1:8000/api/daemon/register',
    'POST',
  );
}

let errorSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
  logSpy.mockRestore();
});

describe('register 失败终端中文提示（ql-20260904-026）', () => {
  it('403 ownership mismatch：首错立即提示，含归属出路文案', async () => {
    const { registerDaemon } = makeRegisterHarness(async () => {
      throw ownershipError();
    });
    await registerDaemon();
    const lines = errorSpy.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('已绑定其他账号'))).toBe(true);
    expect(lines.some((l) => l.includes('处理办法'))).toBe(true);
  });

  it(`节流：连续失败仅首错与每 ${REGISTER_HINT_EVERY_N_FAILURES} 次重发，其间静默`, async () => {
    const { registerDaemon } = makeRegisterHarness(async () => {
      throw ownershipError();
    });
    // streak 1：提示
    await registerDaemon();
    expect(errorSpy.mock.calls.some((c) => String(c[0]).includes('已绑定其他账号'))).toBe(true);
    // streak 2..N：静默（daemon_register_failed 事件走 log_level=error 的
    // console.error，但不含中文 hint 行）
    for (let i = 2; i <= REGISTER_HINT_EVERY_N_FAILURES; i += 1) {
      errorSpy.mockClear();
      await registerDaemon();
      expect(errorSpy.mock.calls.some((c) => String(c[0]).includes('已绑定其他账号'))).toBe(false);
    }
    // streak 6（= 1 + 5）：重发一次
    errorSpy.mockClear();
    await registerDaemon();
    expect(errorSpy.mock.calls.some((c) => String(c[0]).includes('已绑定其他账号'))).toBe(true);
  });

  it('恢复：失败后成功 → console.log 注册已恢复，且计数清零（再失败立即重新提示）', async () => {
    let fail = true;
    const { registerDaemon } = makeRegisterHarness(async () => {
      if (fail) throw ownershipError();
      return { runtimes: [] };
    });
    await registerDaemon(); // streak=1，提示
    fail = false;
    await registerDaemon(); // 成功 → 恢复提示 + 清零
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('注册已恢复'))).toBe(true);
    fail = true;
    logSpy.mockClear();
    errorSpy.mockClear();
    await registerDaemon(); // streak 重新从 1 起 → 立即再提示
    expect(errorSpy.mock.calls.some((c) => String(c[0]).includes('已绑定其他账号'))).toBe(true);
  });

  it('401：提示 API Key 无效与重签出路', async () => {
    const { registerDaemon } = makeRegisterHarness(async () => {
      throw new HubHttpError(401, '{"code":"HTTP_401_AUTH_TOKEN_INVALID"}', 'http://x/api/daemon/register', 'POST');
    });
    await registerDaemon();
    const lines = errorSpy.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('API Key 无效、已过期或已被吊销'))).toBe(true);
  });

  it('网络错误（非 HubHttpError）：不打终端中文提示', async () => {
    const { registerDaemon } = makeRegisterHarness(async () => {
      throw new TypeError('fetch failed');
    });
    await registerDaemon();
    expect(errorSpy.mock.calls.some((c) => String(c[0]).startsWith('✗'))).toBe(false);
  });
});

describe('attachConsoleToLogFile（respawn/隐藏自启 console tee，ql-20260904-026）', () => {
  it('console 输出 tee 到指定日志文件（原通道保留）', async () => {
    // cli.ts 顶层 void main() 有副作用——照 cli.test.ts 范式 stub argv/exit +
    // resetModules 动态 import，避免 commander 读真实 vitest argv。
    const origArgv = process.argv;
    const origExit = process.exit;
    process.argv = ['node', 'sillyhub-daemon'];
    process.exit = ((code?: number) => {
      void code;
      return undefined as never;
    }) as never;
    try {
      vi.resetModules();
      const cli = await import('../src/cli.js');
      const dir = await mkdtemp(join(tmpdir(), 'daemon-tee-'));
      const logFile = join(dir, 'daemon.log');
      // 先 spy 再 attach：attach 包装 spy，mockRestore 即还原真实原方法（卸 patch）。
      const restoreLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const restoreErr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      cli.attachConsoleToLogFile(logFile);
      // eslint-disable-next-line no-console
      console.log('tee-line-alpha');
      // eslint-disable-next-line no-console
      console.error('tee-line-beta');
      await new Promise((r) => setTimeout(r, 100)); // appendFile 异步 flush
      const content = await readFile(logFile, 'utf-8');
      expect(content).toContain('tee-line-alpha');
      expect(content).toContain('tee-line-beta');
      restoreLog.mockRestore();
      restoreErr.mockRestore();
      // 幂等：再次 attach（不同文件）不重复包装——输出不落新文件。
      const logFile2 = join(dir, 'daemon2.log');
      cli.attachConsoleToLogFile(logFile2);
      // eslint-disable-next-line no-console
      console.log('tee-line-gamma');
      await new Promise((r) => setTimeout(r, 100));
      const content2 = await readFile(logFile2, 'utf-8').catch(() => '');
      expect(content2).not.toContain('tee-line-gamma');
    } finally {
      process.argv = origArgv;
      process.exit = origExit;
    }
  });
});

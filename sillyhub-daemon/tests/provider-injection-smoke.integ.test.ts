// tests/provider-injection-smoke.integ.test.ts
// change 2026-09-10-multi-provider-injection / task-07（FR-06 / D-002 / D-006 / R-02 / R-03）。
// 真实 CLI 冒烟：照 spike 手法（本地 mock HTTP 端点记录 path/Authorization/model，
// 全程不耗真实 key）对真实 codex / pi CLI 跑端到端凭证注入验证。
//
// 覆盖（蓝图谱系：mock 三条 + 热切换产物一条）：
//   A（codex 全链）: applyProviderFileSettings（agent_kind=codex + anthropic 形态，
//      api_key/base_url 指向 mock）→ 断言 per-session 目录产物（与 spike golden
//      a2b-config.toml / a2-auth.json 逐字段一致）→ 以该目录作 CODEX_HOME 真跑
//      codex exec 一条 → 断言 mock 收到 POST /v1/responses 且
//      Authorization = Bearer <测试 key>、model = 测试模型；
//   B（pi 全链）: 同法 pi（base_url 指向 mock）→ 产物与 spike golden
//      b1-models.json / b1b-auth.json / b1-settings.json 逐字段一致 → 真跑
//      pi -p --provider sillyhub --model <id> 一条（spike B 形态）→ mock 收到
//      POST /v1/chat/completions 且 Bearer/model 正确；
//   C（litellm 通道，产物级）: openai_chat 形态 ProviderConfig（litellm_base_url
//      指向 mock）→ config.toml base_url / auth.json key 断言。**不真跑**——
//      litellm 容器不在本机（R-02 残差：litellm /v1/responses 与 codex 的实际
//      兼容性未真连验证，降级路径=直连 anthropic，v2；此处只验产物形状，D-006）。
//   附（热切换，产物级）: 同 sessionKey 二次调用 applyProviderFileSettings →
//      目录文件差量重写、旧值清除（消费 task-04 hot_switch_rewrite 可观测动作的
//      产物面；daemon WS PROVIDER_CONFIG_CHANGED 链路断言归
//      tests/daemon-provider-config-changed-handler.test.ts，不重复）。
//
// CLI 缺席容错：codex / pi 探测不到（CI 无 CLI）→ console.warn 后 return 跳过，
// 不用 it.skip（动态条件，照 agent-detector.system-claude.integ.test.ts:71 惯例）。
//
// 进程 / 端口纪律：mock 监听 127.0.0.1:0（内核分配临时端口，天然避开常用端口与
// spike 的 18999），afterAll 统一关闭；CLI 子进程超时杀整树（Windows
// taskkill /PID /T /F、posix 进程组 kill——preflight.ts killTree 同模式），
// 用毕即杀不留残留。mock 记录的 Authorization 值全部是本文件编造的测试 key，
// 无真实凭证入日志。

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
// 分派单点（task-03）：与 daemon interactive / task-runner batch 两接线点共用同一函数。
// 2026-09-11-session-provider-switch-codex-pi task-01 起单点定义在 provider-file-settings.ts。
import { applyProviderFileSettings } from '../src/provider-file-settings.js';
import type { ProviderConfig } from '../src/types.js';

// ── 测试常量（编造凭证，无真实 key）────────────────────────────────────────────

const CODEX_TEST_KEY = 'sk-smoke-codex-000111';
const CODEX_TEST_MODEL = 'smoke-model-cx';
const PI_TEST_KEY = 'sk-smoke-pi-222333';
const PI_TEST_MODEL = 'smoke-model-pi';
const LITELLM_TEST_MODEL = 'usr-42-7';
const DAEMON_TEST_KEY = 'sk-smoke-daemon-444555';

/** CLI 单次真跑超时（ms）：codex/pi 对 mock 单请求秒级完成；重试 5 次 + 启动
 *  也在 45s 内富余。vitest 全局 testTimeout 60s 兜底。 */
const CLI_RUN_TIMEOUT_MS = 45_000;
/** CLI 存在性探测超时（ms）。 */
const CLI_PROBE_TIMEOUT_MS = 15_000;
/** mock 请求落账等待（ms）：CLI 退出后 poll entries。 */
const MOCK_WAIT_TIMEOUT_MS = 10_000;

// ── mock 端点（spike mock_server.py 手法的 Node 内嵌版）────────────────────────

/** mock 记账条目：Authorization 存完整值（断言 Bearer 全量匹配；值均为测试 key）。 */
interface MockEntry {
  method: string;
  /** path 不含 query。 */
  path: string;
  authorization: string;
  model: string | null;
  client: string;
}

/** /v1/responses 非 SSE 应答体（spike RESPONSES.responses 同形）。 */
const RESPONSES_JSON = {
  id: 'resp-mock',
  object: 'response',
  created_at: 0,
  status: 'completed',
  model: 'mock-model',
  output: [
    {
      type: 'message',
      id: 'msg-mock',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'mock says hi', annotations: [] }],
    },
  ],
  usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
};

/**
 * 内嵌 mock 端点：记录每个请求的 method/path/Authorization/model（spike 判据 =
 * mock 日志命中），对 /v1/responses、/v1/chat/completions 返回最小合法 SSE 流
 * （事件序列照抄 spike：responses = created → output_item.done → completed；
 * chat/completions = delta chunk → [DONE]），/v1/models 返回列表 JSON，其余
 * 通用 200 JSON。监听 127.0.0.1:0 —— 内核分配临时端口，避开常用端口。
 */
function startMockServer(): Promise<{ server: Server; port: number; entries: MockEntry[] }> {
  const entries: MockEntry[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('error', () => {
      /* 连接中断：不记账直接结束 */
      res.destroy();
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      let body: Record<string, unknown> = {};
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        body = {};
      }
      const path = (req.url ?? '').split('?')[0] ?? '';
      entries.push({
        method: req.method ?? '',
        path,
        authorization: req.headers.authorization ?? '',
        model: typeof body.model === 'string' ? body.model : null,
        client: String(req.headers['user-agent'] ?? '').slice(0, 60),
      });
      const wantStream = body.stream === true;
      const pathLower = path.toLowerCase();

      const sendJson = (payload: unknown): void => {
        const data = JSON.stringify(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(data);
      };

      if (pathLower.endsWith('/responses')) {
        if (!wantStream) {
          sendJson(RESPONSES_JSON);
          return;
        }
        // SSE：event 行 + data 内 type 双写（spike 同形，codex 0.147.0 实测可消费）。
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const sse = (event: string, payload: unknown): void => {
          res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
        };
        sse('response.created', {
          type: 'response.created',
          response: { id: RESPONSES_JSON.id, status: 'in_progress' },
        });
        sse('response.output_item.done', {
          type: 'response.output_item.done',
          output_index: 0,
          item: RESPONSES_JSON.output[0],
        });
        sse('response.completed', {
          type: 'response.completed',
          response: RESPONSES_JSON,
        });
        res.end();
        return;
      }

      if (pathLower.endsWith('/chat/completions')) {
        if (!wantStream) {
          sendJson({
            id: 'chatcmpl-mock',
            object: 'chat.completion',
            created: 0,
            model: 'mock-model',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'mock says hi' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          });
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(
          `data: ${JSON.stringify({
            id: 'chatcmpl-mock',
            object: 'chat.completion.chunk',
            choices: [
              { index: 0, delta: { content: 'mock says hi' }, finish_reason: null },
            ],
          })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({
            id: 'chatcmpl-mock',
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          })}\n\n`,
        );
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      if (pathLower.endsWith('/models')) {
        sendJson({
          object: 'list',
          data: [{ id: 'mock-model', object: 'model', created: 0, owned_by: 'mock' }],
        });
        return;
      }
      sendJson({ ok: true, mock: true });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      resolve({ server, port: addr.port, entries });
    });
  });
}

// ── CLI 探测 / 子进程纪律（killTree 照 preflight.ts 同模式）────────────────────

/** 杀整个进程树（含孙进程）。Windows taskkill /T /F；posix 进程组 kill
 *  （spawn 时 detached:true 自成进程组，负 pid 杀整组）。杀树失败不抛——
 *  有 per-run timeout 兜底（preflight.ts killTree 同注释语义）。 */
function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (typeof pid !== 'number') return;
  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.on('error', () => {});
    } else {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        process.kill(pid, 'SIGKILL');
      }
    }
  } catch {
    /* 最坏情况孙进程残留，timeout 兜底已生效，不阻塞测试。 */
  }
}

/**
 * shell 模式统一经「单一命令串」spawn（args 全为本文件写死的纯 ASCII 单词，
 * 无空格 / 引号 / 元字符，免转义）——规避 Node DEP0190（shell:true + args 数组
 * 只拼接不转义的弃用告警）。posix 直接 argv 数组不经 shell。
 */
function spawnCli(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; stdio?: 'ignore' | 'pipe' },
): ChildProcess {
  const useShell = process.platform === 'win32';
  return spawn(useShell ? [cmd, ...args].join(' ') : cmd, {
    // Windows npm .cmd shim 必须经 shell（Node ≥18 安全限制）。
    shell: useShell,
    detached: process.platform !== 'win32',
    windowsHide: true,
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
    ...(opts.env !== undefined ? { env: opts.env } : {}),
    stdio: opts.stdio === 'pipe' ? ['ignore', 'pipe', 'pipe'] : 'ignore',
  });
}

/** CLI 存在性探测：`<cmd> --version` 能 spawn 且退出即视为在（退出码不限——
 *  极端 CLI --version 非 0 也不代表不可执行）。超时 / ENOENT → false。 */
function probeCli(cmd: string): Promise<{ available: boolean; version: string }> {
  return new Promise((resolve) => {
    const child = spawnCli(cmd, ['--version'], { stdio: 'pipe' });
    const out: Buffer[] = [];
    child.stdout?.on('data', (c: Buffer) => out.push(c));
    const timer = setTimeout(() => {
      killTree(child);
      resolve({ available: false, version: '' });
    }, CLI_PROBE_TIMEOUT_MS);
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ available: false, version: '' });
    });
    child.on('exit', () => {
      clearTimeout(timer);
      resolve({ available: true, version: Buffer.concat(out).toString('utf-8').trim() });
    });
  });
}

/** CLI 真跑结果（exitCode null = 被 kill / spawn error）。 */
interface CliRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError: string;
}

/** 真跑一条 CLI：超时杀整树（用毕即杀纪律），不抛——由调用方按判据断言。 */
function runCli(
  cmd: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv; cwd: string; timeoutMs: number },
): Promise<CliRunResult> {
  return new Promise((resolve) => {
    // stdin=ignore：codex exec 在 stdin 为管道时会等 stdin 追加输入（spike a2
    // 曾因此挂起重连）；prompt 走 argv 单词，规避 Windows cmd 引号问题。
    const child = spawnCli(cmd, args, { env: opts.env, cwd: opts.cwd, stdio: 'pipe' });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout?.on('data', (c: Buffer) => stdoutChunks.push(c));
    child.stderr?.on('data', (c: Buffer) => stderrChunks.push(c));
    const result = (patch: Partial<CliRunResult>): void => {
      resolve({
        exitCode: null,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        timedOut: false,
        spawnError: '',
        ...patch,
      });
    };
    const timer = setTimeout(() => {
      killTree(child);
      result({ timedOut: true });
    }, opts.timeoutMs);
    child.on('error', (e: Error) => {
      clearTimeout(timer);
      result({ spawnError: e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      result({ exitCode: code });
    });
  });
}

/** poll 等待 mock 记账出现满足谓词的条目（CLI 退出后请求已落，留少量余量）。 */
async function waitForMockEntry(
  entries: MockEntry[],
  pred: (e: MockEntry) => boolean,
  timeoutMs = MOCK_WAIT_TIMEOUT_MS,
): Promise<MockEntry | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hit = entries.find(pred);
    if (hit) return hit;
    if (Date.now() >= deadline) return undefined;
    await new Promise((r) => setTimeout(r, 100));
  }
}

// ── 套件 ───────────────────────────────────────────────────────────────────────

describe('task-07 真实 CLI 冒烟：provider-injection 全链（mock 三条 + 热切换产物）', () => {
  let mockServer: Server;
  let mockPort = 0;
  let mockEntries: MockEntry[];
  let codexProbe: { available: boolean; version: string };
  let piProbe: { available: boolean; version: string };
  /** 每用例独立 daemon 状态根（vi.stubEnv 进 daemonStateDir 懒求值，零触碰真实 ~/.sillyhub）。 */
  let tmpRoot: string;

  beforeAll(async () => {
    const mock = await startMockServer();
    mockServer = mock.server;
    mockPort = mock.port;
    mockEntries = mock.entries;
    codexProbe = await probeCli('codex');
    piProbe = await probeCli('pi');
    // CLI 版本基线入档 R-03：本机版本写日志便于漂移归因（写盘器 golden 基线
    // codex 0.147.0 / pi 0.81.1）。
    console.log(
      `[task-07 smoke] mock=127.0.0.1:${mockPort} codex=${codexProbe.available ? codexProbe.version : 'ABSENT'} pi=${piProbe.available ? piProbe.version : 'ABSENT'}`,
    );
    if (!codexProbe.available) {
      console.warn(
        '[task-07 smoke] codex CLI 不可执行（CI 无 CLI 环境）——冒烟 A/C 真跑段跳过，不判红',
      );
    }
    if (!piProbe.available) {
      console.warn(
        '[task-07 smoke] pi CLI 不可执行（CI 无 CLI 环境）——冒烟 B 真跑段跳过，不判红',
      );
    }
  });

  afterAll(async () => {
    // 端口纪律：用毕即关（closeAllConnections 清 keep-alive 连接防悬挂）。
    mockServer.closeAllConnections?.();
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    tmpRoot = mkdtempSync(join(tmpdir(), 'pis-'));
    vi.stubEnv('SILLYHUB_DAEMON_DIR', tmpRoot);
    mockEntries.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  function readJson(path: string): Record<string, unknown> {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  }

  // ── 冒烟 A：codex 全链（写盘产物 golden 对照 + 真跑命中 mock /v1/responses）──

  it('A. codex：applyProviderFileSettings 产物对 spike golden 逐字段一致，真跑 codex exec 打 mock /v1/responses 且 Bearer=测试 key', async () => {
    if (!codexProbe.available) return; // 缺席容错（warn 已在 beforeAll 记录）

    const provider: ProviderConfig = {
      agent_kind: 'codex',
      api_key: CODEX_TEST_KEY,
      base_url: `http://127.0.0.1:${mockPort}/v1`,
      model: CODEX_TEST_MODEL,
    };
    const env = await applyProviderFileSettings({
      sessionKey: 'smoke-codex',
      provider,
      daemonApiKey: null,
    });

    // per-session 目录布局（D-011 / task-03 per_session_dir_layout 契约）。
    const codexHome = join(tmpRoot, 'codex', 'smoke-codex');
    expect(env).toEqual({ CODEX_HOME: codexHome });

    // 产物 1：auth.json —— spike golden a2-auth.json 同形（仅换测试值）。
    expect(readJson(join(codexHome, 'auth.json'))).toEqual({
      OPENAI_API_KEY: CODEX_TEST_KEY,
    });

    // 产物 2：config.toml —— spike golden a2b-config.toml 逐字段（D-002）：
    //   顶层 model/model_provider + [model_providers.sillyhub] 四键，块间单空行。
    const toml = readFileSync(join(codexHome, 'config.toml'), 'utf-8');
    expect(toml).toBe(
      [
        `model = "${CODEX_TEST_MODEL}"`,
        'model_provider = "sillyhub"',
        '',
        '[model_providers.sillyhub]',
        'name = "SillyHub"',
        `base_url = "http://127.0.0.1:${mockPort}/v1"`,
        'wire_api = "responses"',
        '',
      ].join('\n'),
    );

    // 真跑：以该目录作 CODEX_HOME 跑 codex exec 一条（spike A2 形态；
    // --skip-git-repo-check：scratch cwd 非 git 仓；sandbox 默认 read-only）。
    const workdir = join(tmpRoot, 'cwd-codex');
    mkdirSync(workdir, { recursive: true });
    const run = await runCli(
      'codex',
      ['exec', '--skip-git-repo-check', 'hi'],
      {
        env: { ...process.env, CODEX_HOME: codexHome },
        cwd: workdir,
        timeoutMs: CLI_RUN_TIMEOUT_MS,
      },
    );
    console.log(
      `[task-07 smoke A] codex exit=${run.exitCode} timedOut=${run.timedOut} stdout=${JSON.stringify(run.stdout.slice(0, 200))} stderr=${JSON.stringify(run.stderr.slice(0, 300))}`,
    );
    // 判据 = mock 命中（spike 判据同源）：CLI 退出码不设硬断言——mock SSE 非
    // 真实上游，codex 流语义不满时可能重连后非 0 退出，但请求已带 key 打到
    // mock，注入链即验证成立；超时 / spawn 失败才视为环境性失败。
    expect(run.timedOut).toBe(false);
    expect(run.spawnError).toBe('');

    const hit = await waitForMockEntry(
      mockEntries,
      (e) =>
        e.method === 'POST' &&
        e.path === '/v1/responses' &&
        e.authorization === `Bearer ${CODEX_TEST_KEY}`,
    );
    expect(hit, `mock 未收到带测试 key 的 /v1/responses；entries=${JSON.stringify(mockEntries)}`).toBeDefined();
    expect(hit!.model).toBe(CODEX_TEST_MODEL);
  });

  // ── 冒烟 B：pi 全链（写盘产物 golden 对照 + 真跑命中 mock /v1/chat/completions）──

  it('B. pi：applyProviderFileSettings 三文件对 spike golden 逐字段一致，真跑 pi 打 mock /v1/chat/completions 且 Bearer=测试 key', async () => {
    if (!piProbe.available) return; // 缺席容错（warn 已在 beforeAll 记录）

    const provider: ProviderConfig = {
      agent_kind: 'pi',
      api_key: PI_TEST_KEY,
      base_url: `http://127.0.0.1:${mockPort}/v1`,
      model: PI_TEST_MODEL,
    };
    const env = await applyProviderFileSettings({
      sessionKey: 'smoke-pi',
      provider,
      daemonApiKey: null,
    });

    const piDir = join(tmpRoot, 'pi', 'smoke-pi');
    expect(env).toEqual({ PI_CODING_AGENT_DIR: piDir });

    // 产物 1：auth.json —— spike golden b1b-auth.json 官方形状。
    expect(readJson(join(piDir, 'auth.json'))).toEqual({
      sillyhub: { type: 'api_key', key: PI_TEST_KEY },
    });

    // 产物 2：models.json —— spike golden b1-models.json 逐字段（D-002/D-010：
    // api 固定 "openai-completions" → 打 /chat/completions）。
    const models = readJson(join(piDir, 'models.json'));
    expect(models['providers']).toEqual({
      sillyhub: {
        name: 'SillyHub',
        api: 'openai-completions',
        baseUrl: `http://127.0.0.1:${mockPort}/v1`,
        models: [{ id: PI_TEST_MODEL }],
      },
    });

    // 产物 3：settings.json —— spike golden b1-settings.json。
    const settings = readJson(join(piDir, 'settings.json'));
    expect(settings['defaultProvider']).toBe('sillyhub');
    expect(settings['defaultModel']).toBe(PI_TEST_MODEL);

    // 真跑：以该目录作 PI_CODING_AGENT_DIR 跑 pi 一条（spike B1 形态：
    // --provider sillyhub --model <id>；-p 非交互、--no-session 不落会话）。
    const workdir = join(tmpRoot, 'cwd-pi');
    mkdirSync(workdir, { recursive: true });
    const run = await runCli(
      'pi',
      ['-p', '--no-session', '--provider', 'sillyhub', '--model', PI_TEST_MODEL, 'hi'],
      {
        env: { ...process.env, PI_CODING_AGENT_DIR: piDir },
        cwd: workdir,
        timeoutMs: CLI_RUN_TIMEOUT_MS,
      },
    );
    console.log(
      `[task-07 smoke B] pi exit=${run.exitCode} timedOut=${run.timedOut} stdout=${JSON.stringify(run.stdout.slice(0, 200))} stderr=${JSON.stringify(run.stderr.slice(0, 300))}`,
    );
    expect(run.timedOut).toBe(false);
    expect(run.spawnError).toBe('');

    const hit = await waitForMockEntry(
      mockEntries,
      (e) =>
        e.method === 'POST' &&
        e.path === '/v1/chat/completions' &&
        e.authorization === `Bearer ${PI_TEST_KEY}`,
    );
    expect(hit, `mock 未收到带测试 key 的 /v1/chat/completions；entries=${JSON.stringify(mockEntries)}`).toBeDefined();
    expect(hit!.model).toBe(PI_TEST_MODEL);
  });

  // ── 冒烟 C：litellm 通道（openai_chat 形态，产物级；不真跑）──────────────────

  it('C. codex openai_chat（litellm 通道）：产物 base_url/auth/model 断言（D-006；litellm 容器不在本机不真跑，R-02 残差文档标注）', async () => {
    // R-02 残差说明：spike 验的是 mock 直连 Responses 端点；真实链路上 codex 的
    // /v1/responses 请求由 hub litellm_proxy 通道承接，其兼容性未在本机真连验证
    //（litellm 容器不在本机）——本用例锁产物形状（通道零新增 D-006 的 daemon 侧
    // 事实源），降级路径 = 直连 anthropic（v2）。
    const provider: ProviderConfig = {
      agent_kind: 'codex',
      api_format: 'openai_chat',
      litellm_base_url: `http://127.0.0.1:${mockPort}/api/daemon/llm-proxy`,
      litellm_model_name: LITELLM_TEST_MODEL,
    };
    const env = await applyProviderFileSettings({
      sessionKey: 'smoke-litellm',
      provider,
      daemonApiKey: DAEMON_TEST_KEY,
    });

    const codexHome = join(tmpRoot, 'codex', 'smoke-litellm');
    expect(env).toEqual({ CODEX_HOME: codexHome });

    // auth key = daemon 进程级 apiKey（master key 不出 backend 铁律——
    // provider payload 刻意不含 api_key，D-012）。
    expect(readJson(join(codexHome, 'auth.json'))).toEqual({
      OPENAI_API_KEY: DAEMON_TEST_KEY,
    });
    // base_url = litellm_base_url（hub 代理地址）、model = litellm_model_name
    //（usr-<uid>-<pid> LiteLLM 路由键）；wire_api 仍恒 responses（Responses-only
    // 约束 → litellm 端必须实现 /v1/responses）。
    const toml = readFileSync(join(codexHome, 'config.toml'), 'utf-8');
    expect(toml).toContain(
      `base_url = "http://127.0.0.1:${mockPort}/api/daemon/llm-proxy"`,
    );
    expect(toml).toContain(`model = "${LITELLM_TEST_MODEL}"`);
    expect(toml).toContain('wire_api = "responses"');
  });

  // ── 附：热切换产物重写（task-04 hot_switch_rewrite 的产物面；无 CLI 依赖）────

  it('热切换：同 sessionKey 二次 applyProviderFileSettings → 目录文件差量重写、旧值清除（task-04 可观测动作产物面）', async () => {
    // daemon 收 PROVIDER_CONFIG_CHANGED 后对活跃会话**复用同一函数**按新
    // provider.agent_kind 重写 per-session 目录（daemon.ts 热切换 handler 调
    // applyProviderFileSettings，task-04 接线）；此处锁「同 sessionKey 二次
    // 调用 = 产物重写且旧值清除」，WS 链路断言归 task-04 既有测试。
    const providerA: ProviderConfig = {
      agent_kind: 'codex',
      api_key: CODEX_TEST_KEY,
      base_url: `http://127.0.0.1:${mockPort}/v1`,
      model: CODEX_TEST_MODEL,
    };
    const providerB: ProviderConfig = {
      agent_kind: 'codex',
      api_key: 'sk-smoke-codex-999888',
      base_url: `http://127.0.0.1:${mockPort}/relay`,
      model: 'smoke-model-cx-next',
    };

    const first = await applyProviderFileSettings({
      sessionKey: 'smoke-hot',
      provider: providerA,
      daemonApiKey: null,
    });
    const second = await applyProviderFileSettings({
      sessionKey: 'smoke-hot',
      provider: providerB,
      daemonApiKey: null,
    });
    // 同会话同目录（重写非重建新目录）。
    expect(second).toEqual(first);

    const codexHome = join(tmpRoot, 'codex', 'smoke-hot');
    expect(readJson(join(codexHome, 'auth.json'))).toEqual({
      OPENAI_API_KEY: 'sk-smoke-codex-999888',
    });
    const toml = readFileSync(join(codexHome, 'config.toml'), 'utf-8');
    expect(toml).toContain(`base_url = "http://127.0.0.1:${mockPort}/relay"`);
    expect(toml).toContain('model = "smoke-model-cx-next"');
    // 旧值清除（差量替换非追加）。
    expect(toml).not.toContain(`http://127.0.0.1:${mockPort}/v1"`);
    expect(toml).not.toContain(`model = "${CODEX_TEST_MODEL}"`);
  });

  // ── 附：产物落盘边界（无 CLI 依赖，锁 absent 边界在真实链下同样成立）────────

  it('absent 边界：provider_config 整体缺省 → 零目录零 env（D-012，真实链同判）', async () => {
    const env = await applyProviderFileSettings({
      sessionKey: 'smoke-absent',
      provider: null,
      daemonApiKey: null,
    });
    expect(env).toEqual({});
    expect(existsSync(join(tmpRoot, 'codex'))).toBe(false);
    expect(existsSync(join(tmpRoot, 'pi'))).toBe(false);
  });
});

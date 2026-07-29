// tests/spawn-env.test.ts
// task-09: B1 token + tool_config.env 注入 claude 子进程 env（含 redact 守卫）。
//
// 覆盖 AC-03..08：
//   AC-04 credentials.json 含 ANTHROPIC_API_KEY → buildSpawnEnv 注入
//   AC-08 process.env 兜底（credentials.json 不含时）
//   AC-05 redactEnv 遮蔽 KEY/TOKEN/SECRET 等，保留 PATH
//   AC-06 buildSpawnEnv 不 console.* 原文打印 env（token 不入日志）
//   边界：token 空串不注入；tool_config.env 最高优先级覆盖；不 mutate 入参
//
// 不泄漏铁律（R-09）：env 仅本地内存，不入日志/Redis/HTTP——spawn-env.ts 不引用
// submitMessages / complete_lease 链路（AC-07 静态 grep 验证）。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialManager } from '../src/credential.js';
import {
  buildSpawnEnv,
  redactEnv,
  redactProviderConfig,
  ANTHROPIC_API_KEY_FIELD,
  CLAUDE_OAUTH_TOKEN_FIELD,
} from '../src/spawn-env.js';
import type { ProviderConfig } from '../src/types.js';

describe('spawn-env (task-09: B1 token + tool_config.env 注入)', () => {
  let credDir: string;
  let cred: CredentialManager;
  // 备份/恢复被测试修改的 process.env 键，避免污染其他用例
  const envBackup: Record<string, string | undefined> = {};
  const ENV_KEYS = ['ANTHROPIC_API_KEY', 'CLAUDE_OAUTH_TOKEN'];

  beforeEach(async () => {
    credDir = await mkdtemp(join(tmpdir(), 'sillyhub-spawn-'));
    cred = new CredentialManager(join(credDir, 'credentials.json'));
    for (const k of ENV_KEYS) {
      envBackup[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(async () => {
    for (const k of ENV_KEYS) {
      if (envBackup[k] === undefined) delete process.env[k];
      else process.env[k] = envBackup[k];
    }
    await rm(credDir, { recursive: true, force: true });
  });

  it('AC-04: credentials.json 含 ANTHROPIC_API_KEY → buildSpawnEnv 注入', () => {
    cred.set(ANTHROPIC_API_KEY_FIELD, 'sk-test');
    const env = buildSpawnEnv({ toolConfig: {} }, { credential: cred });
    expect(env[ANTHROPIC_API_KEY_FIELD]).toBe('sk-test');
  });

  it('AC-04b: credentials.json 含 CLAUDE_OAUTH_TOKEN → 同时注入（OAuth 模式）', () => {
    cred.set(CLAUDE_OAUTH_TOKEN_FIELD, 'oauth-tok');
    const env = buildSpawnEnv({ toolConfig: {} }, { credential: cred });
    expect(env[CLAUDE_OAUTH_TOKEN_FIELD]).toBe('oauth-tok');
  });

  it('AC-08: process.env 兜底（credentials.json 不含 ANTHROPIC_API_KEY）', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-env';
    const env = buildSpawnEnv({ toolConfig: {} }, { credential: cred });
    expect(env[ANTHROPIC_API_KEY_FIELD]).toBe('sk-env');
  });

  it('边界: token 空串不注入（避免误判已配置）', () => {
    cred.set(ANTHROPIC_API_KEY_FIELD, '');
    const env = buildSpawnEnv({ toolConfig: {} }, { credential: cred });
    expect(env[ANTHROPIC_API_KEY_FIELD]).toBeUndefined();
  });

  it('优先级: tool_config.env 覆盖 claude token + process.env（最高）', () => {
    cred.set(ANTHROPIC_API_KEY_FIELD, 'sk-cred');
    process.env.ANTHROPIC_API_KEY = 'sk-env';
    const env = buildSpawnEnv(
      { toolConfig: { anthropic_api_key: 'sk-tool' } },
      { credential: cred },
    );
    // tool_config.env 经 buildEnv 大写后覆盖下层
    expect(env[ANTHROPIC_API_KEY_FIELD]).toBe('sk-tool');
  });

  it('AC-05: redactEnv 遮蔽 KEY/TOKEN/SECRET，保留 PATH', () => {
    const out = redactEnv({
      ANTHROPIC_API_KEY: 'sk-test',
      CLAUDE_OAUTH_TOKEN: 'oauth',
      GITHUB_TOKEN: 'ghp_x',
      API_SECRET: 'sec',
      DB_PASSWORD: 'pw',
      GIT_PAT: 'pat',
      MY_CREDENTIAL: 'cred',
      PATH: '/usr/bin',
      HOME: '/root',
    });
    expect(out.ANTHROPIC_API_KEY).toBe('***REDACTED***');
    expect(out.CLAUDE_OAUTH_TOKEN).toBe('***REDACTED***');
    expect(out.GITHUB_TOKEN).toBe('***REDACTED***');
    expect(out.API_SECRET).toBe('***REDACTED***');
    expect(out.DB_PASSWORD).toBe('***REDACTED***');
    expect(out.GIT_PAT).toBe('***REDACTED***');
    expect(out.MY_CREDENTIAL).toBe('***REDACTED***');
    expect(out.PATH).toBe('/usr/bin');
    expect(out.HOME).toBe('/root');
  });

  it('AC-05b: redactEnv 不修改入参（返回新对象）', () => {
    const input = { ANTHROPIC_API_KEY: 'sk-test', PATH: '/usr/bin' };
    const out = redactEnv(input);
    expect(out).not.toBe(input);
    expect(input.ANTHROPIC_API_KEY).toBe('sk-test'); // 入参未被 mutate
  });

  it('AC-06: buildSpawnEnv 不 console.* 原文打印 token（token 不入日志）', () => {
    cred.set(ANTHROPIC_API_KEY_FIELD, 'sk-secret-leak');
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    buildSpawnEnv({ toolConfig: {} }, { credential: cred });

    const allArgs = [
      ...debugSpy.mock.calls,
      ...logSpy.mock.calls,
      ...infoSpy.mock.calls,
      ...warnSpy.mock.calls,
    ]
      .flat()
      .join(' ');
    expect(allArgs).not.toContain('sk-secret-leak');

    debugSpy.mockRestore();
    logSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('AC-06b: redactEnv 输出可安全打印（含 token 的 env 经 redact 后无密钥）', () => {
    cred.set(ANTHROPIC_API_KEY_FIELD, 'sk-printable');
    const env = buildSpawnEnv({ toolConfig: {} }, { credential: cred });
    const safe = redactEnv(env);
    const dumped = JSON.stringify(safe);
    expect(dumped).not.toContain('sk-printable');
    expect(dumped).toContain('***REDACTED***');
  });

  it('不 mutate: buildSpawnEnv 不修改 ctx.toolConfig 入参', () => {
    const toolConfig = { github_token: '{{USER_GITHUB_TOKEN}}' };
    buildSpawnEnv({ toolConfig }, { credential: cred });
    expect(toolConfig.github_token).toBe('{{USER_GITHUB_TOKEN}}');
  });
});

// task-10：第 0 层 provider_config 注入单测（D-004 优先级 / D-007 兜底零回归 / R-02 脱敏）。
describe('spawn-env layer-0 (task-09: provider_config 第 0 层注入)', () => {
  let credDir: string;
  let cred: CredentialManager;
  // 备份/恢复被测试修改的 process.env 键，避免污染其他用例
  const envBackup: Record<string, string | undefined> = {};
  const ENV_KEYS = [
    'ANTHROPIC_API_KEY',
    'CLAUDE_OAUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_MODEL',
    'ANTHROPIC_AUTH_TOKEN',
  ];

  beforeEach(async () => {
    credDir = await mkdtemp(join(tmpdir(), 'sillyhub-layer0-'));
    cred = new CredentialManager(join(credDir, 'credentials.json'));
    for (const k of ENV_KEYS) {
      envBackup[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(async () => {
    for (const k of ENV_KEYS) {
      if (envBackup[k] === undefined) delete process.env[k];
      else process.env[k] = envBackup[k];
    }
    await rm(credDir, { recursive: true, force: true });
  });

  /** 构造 claude ProviderConfig 测试夹具。 */
  const claudeConfig = (overrides: Partial<ProviderConfig> = {}): ProviderConfig => ({
    agent_kind: 'claude',
    base_url: 'https://gw.layer0.example.com',
    api_key: 'sk-layer0',
    auth_field: 'ANTHROPIC_AUTH_TOKEN',
    default_fallback_model: 'kimi-k2',
    ...overrides,
  });

  it('第 0 层优先级：provider_config 注入全部 env（base_url / auth / model）', () => {
    const env = buildSpawnEnv(
      { toolConfig: {}, provider_config: claudeConfig() },
      { credential: cred },
    );
    expect(env.ANTHROPIC_BASE_URL).toBe('https://gw.layer0.example.com');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-layer0');
    expect(env.ANTHROPIC_MODEL).toBe('kimi-k2');
  });

  it('第 0 层优先级：盖过 tool_config.env 同名 key（层 1）', () => {
    const env = buildSpawnEnv(
      {
        toolConfig: { anthropic_base_url: 'https://tool-layer1.example.com' },
        provider_config: claudeConfig({ base_url: 'https://gw.layer0.example.com' }),
      },
      { credential: cred },
    );
    // tool_config.env 经 buildEnv 大写 → ANTHROPIC_BASE_URL，被第 0 层盖过
    expect(env.ANTHROPIC_BASE_URL).toBe('https://gw.layer0.example.com');
  });

  it('第 0 层优先级：盖过 credentials.json token（层 2，同名认证 key）', () => {
    cred.set(ANTHROPIC_API_KEY_FIELD, 'sk-cred-layer2');
    const env = buildSpawnEnv(
      {
        toolConfig: {},
        // provider_config 写 ANTHROPIC_API_KEY（与层 2 同名）
        provider_config: claudeConfig({ api_key: 'sk-layer0', auth_field: 'ANTHROPIC_API_KEY' }),
      },
      { credential: cred },
    );
    expect(env.ANTHROPIC_API_KEY).toBe('sk-layer0');
  });

  it('第 0 层优先级：盖过 process.env（层 3，同名 key）', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://env-layer3.example.com';
    process.env.ANTHROPIC_MODEL = 'env-model';
    const env = buildSpawnEnv(
      { toolConfig: {}, provider_config: claudeConfig() },
      { credential: cred },
    );
    expect(env.ANTHROPIC_BASE_URL).toBe('https://gw.layer0.example.com');
    expect(env.ANTHROPIC_MODEL).toBe('kimi-k2');
  });

  it('未配兜底（D-007）：provider_config=undefined → env 与不传逐字一致', () => {
    cred.set(ANTHROPIC_API_KEY_FIELD, 'sk-cred');
    const withoutLayer0 = buildSpawnEnv(
      { toolConfig: { foo: 'bar' } },
      { credential: cred },
    );
    const withUndefined = buildSpawnEnv(
      { toolConfig: { foo: 'bar' }, provider_config: undefined },
      { credential: cred },
    );
    expect(withUndefined).toEqual(withoutLayer0);
  });

  it('未配兜底（D-007）：provider_config=null → env 与不传逐字一致', () => {
    cred.set(ANTHROPIC_API_KEY_FIELD, 'sk-cred');
    const withoutLayer0 = buildSpawnEnv(
      { toolConfig: { foo: 'bar' } },
      { credential: cred },
    );
    const withNull = buildSpawnEnv(
      { toolConfig: { foo: 'bar' }, provider_config: null },
      { credential: cred },
    );
    expect(withNull).toEqual(withoutLayer0);
  });

  it('agent_kind 未注册（如 codex）→ 第 0 层 env 注入跳过（无 ANTHROPIC_*），但 CLAUDE_CONFIG_DIR 仍隔离（ql-20260729-002：provider_config 存在即隔离）', () => {
    cred.set(ANTHROPIC_API_KEY_FIELD, 'sk-cred');
    const unregistered = buildSpawnEnv(
      {
        toolConfig: {},
        provider_config: { agent_kind: 'codex', api_key: 'sk-x', base_url: 'https://x' },
      },
      { credential: cred },
    );
    // 第 0 层 env 注入跳过（codex 无 injector，不产 ANTHROPIC_* env）
    expect(unregistered.ANTHROPIC_BASE_URL).toBeUndefined();
    // 但 provider_config 存在 → 仍隔离 CLAUDE_CONFIG_DIR
    expect(unregistered.CLAUDE_CONFIG_DIR).toBeDefined();
  });

  it('tool_config + provider_config 共存：tool_config 非冲突 key 仍渲染', () => {
    const env = buildSpawnEnv(
      {
        toolConfig: { custom_tool_var: 'tool-val' },
        provider_config: claudeConfig(),
      },
      { credential: cred },
    );
    // tool_config 的非冲突 key 仍渲染（经 buildEnv 大写）
    expect(env.CUSTOM_TOOL_VAR).toBe('tool-val');
    // provider_config 第 0 层仍注入
    expect(env.ANTHROPIC_BASE_URL).toBe('https://gw.layer0.example.com');
  });

  it('redactEnv 脱敏第 0 层注入的 ANTHROPIC_AUTH_TOKEN（R-02）', () => {
    const env = buildSpawnEnv(
      {
        toolConfig: {},
        provider_config: claudeConfig({ api_key: 'sk-secret', auth_field: 'ANTHROPIC_AUTH_TOKEN' }),
      },
      { credential: cred },
    );
    const safe = redactEnv(env);
    expect(safe.ANTHROPIC_AUTH_TOKEN).toBe('***REDACTED***');
    expect(JSON.stringify(safe)).not.toContain('sk-secret');
    // 非敏感 key 保留原值
    expect(safe.ANTHROPIC_BASE_URL).toBe('https://gw.layer0.example.com');
    expect(safe.ANTHROPIC_MODEL).toBe('kimi-k2');
  });

  it('redactEnv 脱敏第 0 层注入的 ANTHROPIC_API_KEY（R-02）', () => {
    const env = buildSpawnEnv(
      {
        toolConfig: {},
        provider_config: claudeConfig({ api_key: 'sk-secret2', auth_field: 'ANTHROPIC_API_KEY' }),
      },
      { credential: cred },
    );
    const safe = redactEnv(env);
    expect(safe.ANTHROPIC_API_KEY).toBe('***REDACTED***');
    expect(JSON.stringify(safe)).not.toContain('sk-secret2');
  });

  it('redactProviderConfig 脱敏 api_key 字段（直接打对象防御场景，R-02）', () => {
    const config = claudeConfig({ api_key: 'sk-direct-leak' });
    const safe = redactProviderConfig(config);
    expect(safe.api_key).toBe('***REDACTED***');
    expect(JSON.stringify(safe)).not.toContain('sk-direct-leak');
    // 非敏感字段保留
    expect(safe.base_url).toBe('https://gw.layer0.example.com');
    expect(safe.agent_kind).toBe('claude');
  });

  it('redactProviderConfig 不修改入参（返回新对象）', () => {
    const config = claudeConfig({ api_key: 'sk-original' });
    redactProviderConfig(config);
    expect(config.api_key).toBe('sk-original');
  });

  it('redactProviderConfig：api_key 缺省时不写 ***REDACTED***', () => {
    const config = claudeConfig();
    delete config.api_key;
    const safe = redactProviderConfig(config);
    expect(safe.api_key).toBeUndefined();
  });

  // ql-20260729-002：CLAUDE_CONFIG_DIR 隔离条件化（有 provider_config 才隔离）
  describe('ql-20260729-002: CLAUDE_CONFIG_DIR 条件隔离', () => {
    it('有 provider_config → 设 CLAUDE_CONFIG_DIR（隔离,避免 cc-switch 污染平台注入）', () => {
      const env = buildSpawnEnv(
        { toolConfig: {}, provider_config: claudeConfig() },
        { credential: cred },
      );
      expect(env.CLAUDE_CONFIG_DIR).toBeDefined();
      expect(env.CLAUDE_CONFIG_DIR).toMatch(/claude-config$/);
    });

    it('无 provider_config（未配/未启用）→ 不设 CLAUDE_CONFIG_DIR（读默认 ~/.claude）', () => {
      const env = buildSpawnEnv({ toolConfig: {} }, { credential: cred });
      expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
    });

    it('provider_config=null → 不隔离（同 absent）', () => {
      const env = buildSpawnEnv(
        { toolConfig: {}, provider_config: null },
        { credential: cred },
      );
      expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
    });

    it('process.env 残留 CLAUDE_CONFIG_DIR + 无 provider_config → 清掉残留（确保读默认）', () => {
      process.env.CLAUDE_CONFIG_DIR = '/tmp/leftover-isolated';
      const env = buildSpawnEnv({ toolConfig: {} }, { credential: cred });
      expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
      delete process.env.CLAUDE_CONFIG_DIR;
    });
  });
});

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
  ANTHROPIC_API_KEY_FIELD,
  CLAUDE_OAUTH_TOKEN_FIELD,
} from '../src/spawn-env.js';

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

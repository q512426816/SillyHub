// tests/interactive/session-manager-one-m-suffix.test.ts
// ql-20260920-004：one_m 勾选未作用于主模型——[1m] 后缀补齐三层单测。
//
// 背景（会话 6e213eb3 实证）：one_m 的 [1m] 后缀原本只落 ANTHROPIC_DEFAULT_{ROLE}_MODEL，
// 主模型两条路径都拿裸名（injector 规则 3 的 ANTHROPIC_MODEL / daemon 显式塞进 SDK
// query options.model 的 backend payload.model），claude CLI 对未知模型按默认 200k
// 窗口算 → 1M 供应商 ~160k（80%）触发引擎自动压缩。修复点：
//   1. credential-injector 导出纯函数 withOneMSuffix（角色映射 model 匹配 + one_m=true
//      → 追加 [1m]，幂等）；
//   2. injector 规则 3：ANTHROPIC_MODEL 经 withOneMSuffix（reload/resume 走 env 的路径）；
//   3. buildDriverOptions（create/restore 单点）：claude 分支 spec.model 经
//      withOneMSuffix（state.providerConfig 提供映射；codex/pi 不认 [1m] 不应用）。
//
// 用例矩阵：
//   - withOneMSuffix：命中补缀 / 未勾选原样 / 无映射原样 / config 缺省原样 /
//     已带 [1m] 幂等 / 同名模型多角色任一勾选即补
//   - injector 规则 3：fallback 命中 → ANTHROPIC_MODEL 带 [1m]；无映射原样；
//     settings_config.env.ANTHROPIC_MODEL 仍最高优先级覆盖（ql-20260823-007 语义不回退）
//   - create 链：claude + providerConfig 命中 → driver.start 收 model 带 [1m]；
//     无 providerConfig / 未勾选 / provider=codex → 原样；state.model 保持裸名
//    （SDK 档位过滤 / sessions.json 持久化不受 [1m] 污染）
//
// mock 构造照 tests/interactive/session-thinking-level.test.ts（makeMockDriver /
// makeDeps / BASE_INPUT 同款范式）。

import { describe, it, expect, vi } from 'vitest';
import type { Query } from '@anthropic-ai/claude-agent-sdk';
import { SessionManager } from '../../src/interactive/session-manager.js';
import type { ClaudeSdkDriver } from '../../src/interactive/claude-sdk-driver.js';
import {
  ClaudeCredentialInjector,
  withOneMSuffix,
} from '../../src/credential-injector.js';
import type { ProviderConfig } from '../../src/types.js';

// ── withOneMSuffix 纯函数 ────────────────────────────────────────────────────

describe('ql-20260920-004 withOneMSuffix（角色映射 one_m → 主模型 [1m]）', () => {
  const mappings = (one_m: boolean | undefined): ProviderConfig => ({
    agent_kind: 'claude',
    model_role_mappings: {
      sonnet: { model: 'glm-5.3', one_m },
      opus: { model: 'glm-5.3', one_m },
    },
  });

  it('主模型名在角色映射里 one_m=true → 追加 [1m]', () => {
    expect(withOneMSuffix('glm-5.3', mappings(true))).toBe('glm-5.3[1m]');
  });

  it('one_m=false / undefined → 原样（不追加）', () => {
    expect(withOneMSuffix('glm-5.3', mappings(false))).toBe('glm-5.3');
    expect(withOneMSuffix('glm-5.3', mappings(undefined))).toBe('glm-5.3');
  });

  it('无 model_role_mappings / config 缺省 / null → 原样', () => {
    expect(withOneMSuffix('glm-5.3', { agent_kind: 'claude' })).toBe('glm-5.3');
    expect(withOneMSuffix('glm-5.3', undefined)).toBe('glm-5.3');
    expect(withOneMSuffix('glm-5.3', null)).toBe('glm-5.3');
  });

  it('已带 [1m] 后缀 → 幂等原样（不双缀）', () => {
    expect(withOneMSuffix('glm-5.3[1m]', mappings(true))).toBe('glm-5.3[1m]');
  });

  it('主模型与映射模型名不同 → 原样（不误缀）', () => {
    const pc: ProviderConfig = {
      agent_kind: 'claude',
      model_role_mappings: { sonnet: { model: 'kimi-k2', one_m: true } },
    };
    expect(withOneMSuffix('glm-5.3', pc)).toBe('glm-5.3');
  });

  it('同名模型多角色、任一勾选即补（勾选语义取并集）', () => {
    const pc: ProviderConfig = {
      agent_kind: 'claude',
      model_role_mappings: {
        sonnet: { model: 'glm-5.3', one_m: false },
        opus: { model: 'glm-5.3', one_m: true },
      },
    };
    expect(withOneMSuffix('glm-5.3', pc)).toBe('glm-5.3[1m]');
  });
});

// ── injector 规则 3：ANTHROPIC_MODEL 补缀 ───────────────────────────────────

describe('ql-20260920-004 injector 规则 3：ANTHROPIC_MODEL 按 one_m 补 [1m]', () => {
  const injector = new ClaudeCredentialInjector();

  it('default_fallback_model 命中角色映射 one_m=true → ANTHROPIC_MODEL 带 [1m]', () => {
    const env = injector.toEnv({
      agent_kind: 'claude',
      default_fallback_model: 'glm-5.3',
      model_role_mappings: { sonnet: { model: 'glm-5.3', one_m: true } },
    });
    expect(env.ANTHROPIC_MODEL).toBe('glm-5.3[1m]');
  });

  it('model 字段（无 fallback）命中同样补缀', () => {
    const env = injector.toEnv({
      agent_kind: 'claude',
      model: 'glm-5.3',
      model_role_mappings: { haiku: { model: 'glm-5.3', one_m: true } },
    });
    expect(env.ANTHROPIC_MODEL).toBe('glm-5.3[1m]');
  });

  it('无角色映射 / 未勾选 → ANTHROPIC_MODEL 原样（零回归）', () => {
    const noMappings = injector.toEnv({
      agent_kind: 'claude',
      default_fallback_model: 'glm-5.3',
    });
    expect(noMappings.ANTHROPIC_MODEL).toBe('glm-5.3');
    const notChecked = injector.toEnv({
      agent_kind: 'claude',
      default_fallback_model: 'glm-5.3',
      model_role_mappings: { sonnet: { model: 'glm-5.3' } },
    });
    expect(notChecked.ANTHROPIC_MODEL).toBe('glm-5.3');
  });

  it('settings_config.env.ANTHROPIC_MODEL 非空仍最高优先级覆盖（不带缀也照写）', () => {
    const env = injector.toEnv({
      agent_kind: 'claude',
      default_fallback_model: 'glm-5.3',
      model_role_mappings: { sonnet: { model: 'glm-5.3', one_m: true } },
      settings_config: { env: { ANTHROPIC_MODEL: 'user-pinned-model' } },
    });
    expect(env.ANTHROPIC_MODEL).toBe('user-pinned-model');
  });
});

// ── create 链：buildDriverOptions 补缀（fixtures 照 session-thinking-level）──

function makeMockDriver() {
  const fakeQuery = { interrupt: vi.fn(async () => {}) } as unknown as Query;
  const driver = {
    start: vi.fn(() => fakeQuery),
    consume: vi.fn(async () => {}),
    interrupt: vi.fn(async () => true),
  } as unknown as ClaudeSdkDriver;
  return { driver };
}

function makeDeps() {
  return {
    onTurnResult: vi.fn(async () => {}),
    onTurnMessage: vi.fn(async () => {}),
    onSessionEnd: vi.fn(async () => {}),
  };
}

const BASE_INPUT = {
  sessionId: 'sess-1',
  leaseId: 'lease-1',
  firstPrompt: 'hi',
  firstRunId: 'run-1',
  cwd: 'C:\\work',
  provider: 'claude' as const,
  pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
};

/** 取 driver.start 第二参（driverOpts）。 */
function startOptsOf(driver: ClaudeSdkDriver): Record<string, unknown> {
  expect(driver.start).toHaveBeenCalledTimes(1);
  return (driver.start as ReturnType<typeof vi.fn>).mock.calls[0]![1] as Record<
    string,
    unknown
  >;
}

describe('ql-20260920-004 create 链：claude 主模型经 buildDriverOptions 补 [1m]', () => {
  it('claude + providerConfig 角色映射命中 one_m → driver.start 收带 [1m] 的 model', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create({
      ...BASE_INPUT,
      model: 'glm-5.3',
      providerConfig: {
        agent_kind: 'claude',
        base_url: 'https://open.bigmodel.cn/api/anthropic',
        api_key: 'sk-x',
        default_fallback_model: 'glm-5.3',
        model_role_mappings: { sonnet: { model: 'glm-5.3', one_m: true } },
      },
    });
    expect(startOptsOf(driver).model).toBe('glm-5.3[1m]');
    // state.model 保持裸名（thinking-level 档位过滤 / sessions.json 持久化不受污染）。
    expect(sm.get('sess-1')!.model).toBe('glm-5.3');
  });

  it('claude + providerConfig 未勾选 one_m → model 原样', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create({
      ...BASE_INPUT,
      model: 'glm-5.3',
      providerConfig: {
        agent_kind: 'claude',
        model_role_mappings: { sonnet: { model: 'glm-5.3', one_m: false } },
      },
    });
    expect(startOptsOf(driver).model).toBe('glm-5.3');
  });

  it('claude + 无 providerConfig（本机默认凭证）→ model 原样（零回归）', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    await sm.create({ ...BASE_INPUT, model: 'claude-sonnet-4-6' });
    expect(startOptsOf(driver).model).toBe('claude-sonnet-4-6');
  });

  it('provider=codex → 不应用 [1m]（Claude Code 专属约定，codex 不认）', async () => {
    const { driver } = makeMockDriver();
    const sm = new SessionManager({
      drivers: { claude: driver, codex: driver },
      ...makeDeps(),
    } as ConstructorParameters<typeof SessionManager>[0]);
    await sm.create({
      ...BASE_INPUT,
      provider: 'codex' as unknown as 'claude',
      pathToAgentExecutable: 'C:\\bin\\codex.exe',
      model: 'glm-5.3',
      providerConfig: {
        agent_kind: 'claude',
        model_role_mappings: { sonnet: { model: 'glm-5.3', one_m: true } },
      },
    });
    expect(startOptsOf(driver).model).toBe('glm-5.3');
  });
});

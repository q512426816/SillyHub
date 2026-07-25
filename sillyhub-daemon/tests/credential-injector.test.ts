// tests/credential-injector.test.ts
// task-10: ClaudeCredentialInjector.toEnv 全分支 + getInjector 注册表单测。
//
// 覆盖 design §7 TS 块 6 条映射规则 + spike-01（FABLE env 名 / [1m] 后缀官方实测）。
// 不真起 claude 进程（纯函数 toEnv 输入输出断言，constraints 铁律）。
//
// 用例矩阵（task-10 acceptance）：
//   - base_url 非空 / 空 → ANTHROPIC_BASE_URL
//   - auth_field 选择（AUTH_TOKEN / API_KEY / 缺省，不双写，D-010 / X-13）
//   - default_fallback_model vs model → ANTHROPIC_MODEL
//   - 4 角色映射（sonnet/opus/fable/haiku）→ ANTHROPIC_DEFAULT_{ROLE}_MODEL（D-011）
//   - one_m 后缀 [1m]（X-12）
//   - extra_env 注入 + 覆盖角色 env
//   - getInjector 注册表（claude / 未知 / undefined / 空串）

import { describe, it, expect } from 'vitest';
import {
  ClaudeCredentialInjector,
  getInjector,
} from '../src/credential-injector.js';
import type { ProviderConfig } from '../src/types.js';

const baseConfig: ProviderConfig = { agent_kind: 'claude' };

describe('ClaudeCredentialInjector', () => {
  const injector = new ClaudeCredentialInjector();

  it('agentKind = "claude"（ROLE_ENV 4 角色常量可读）', () => {
    expect(injector.agentKind).toBe('claude');
    // spike-01 实测：4 角色 env 名全部官方文档收录（X-11 通过）
    expect(ClaudeCredentialInjector.ROLE_ENV.sonnet).toBe('ANTHROPIC_DEFAULT_SONNET_MODEL');
    expect(ClaudeCredentialInjector.ROLE_ENV.opus).toBe('ANTHROPIC_DEFAULT_OPUS_MODEL');
    expect(ClaudeCredentialInjector.ROLE_ENV.fable).toBe('ANTHROPIC_DEFAULT_FABLE_MODEL');
    expect(ClaudeCredentialInjector.ROLE_ENV.haiku).toBe('ANTHROPIC_DEFAULT_HAIKU_MODEL');
  });

  describe('base_url → ANTHROPIC_BASE_URL', () => {
    it('非空 → 写 ANTHROPIC_BASE_URL', () => {
      const env = injector.toEnv({ ...baseConfig, base_url: 'https://gw.example.com' });
      expect(env.ANTHROPIC_BASE_URL).toBe('https://gw.example.com');
    });
    it('空串 → 不写该 key', () => {
      expect(injector.toEnv({ ...baseConfig, base_url: '' }).ANTHROPIC_BASE_URL).toBeUndefined();
    });
    it('缺省 → 不写该 key', () => {
      expect(injector.toEnv(baseConfig).ANTHROPIC_BASE_URL).toBeUndefined();
    });
  });

  describe('auth_field 选择（D-010 / X-13 不再双写）', () => {
    it('api_key + auth_field=ANTHROPIC_AUTH_TOKEN → 落 AUTH_TOKEN，不写 API_KEY', () => {
      const env = injector.toEnv({ ...baseConfig, api_key: 'sk-x', auth_field: 'ANTHROPIC_AUTH_TOKEN' });
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-x');
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    });
    it('api_key + auth_field=ANTHROPIC_API_KEY → 落 API_KEY，不写 AUTH_TOKEN', () => {
      const env = injector.toEnv({ ...baseConfig, api_key: 'sk-x', auth_field: 'ANTHROPIC_API_KEY' });
      expect(env.ANTHROPIC_API_KEY).toBe('sk-x');
      expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    });
    it('api_key 缺省 auth_field → 落 ANTHROPIC_AUTH_TOKEN（默认）', () => {
      const env = injector.toEnv({ ...baseConfig, api_key: 'sk-x' });
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-x');
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    });
    it('api_key 缺省 → 不写任何认证 key', () => {
      const env = injector.toEnv(baseConfig);
      expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    });
    it('api_key 空串 → 不写认证 key', () => {
      const env = injector.toEnv({ ...baseConfig, api_key: '' });
      expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    });
  });

  describe('default_fallback_model vs model → ANTHROPIC_MODEL', () => {
    it('default_fallback_model 优先于 model', () => {
      const env = injector.toEnv({ ...baseConfig, model: 'a', default_fallback_model: 'b' });
      expect(env.ANTHROPIC_MODEL).toBe('b');
    });
    it('仅 model → 落 ANTHROPIC_MODEL', () => {
      const env = injector.toEnv({ ...baseConfig, model: 'a' });
      expect(env.ANTHROPIC_MODEL).toBe('a');
    });
    it('仅 default_fallback_model → 落 ANTHROPIC_MODEL', () => {
      const env = injector.toEnv({ ...baseConfig, default_fallback_model: 'fb' });
      expect(env.ANTHROPIC_MODEL).toBe('fb');
    });
    it('两者皆空 → 不写 ANTHROPIC_MODEL', () => {
      expect(injector.toEnv(baseConfig).ANTHROPIC_MODEL).toBeUndefined();
    });
  });

  describe('4 角色映射（D-011；spike-01 FABLE 实测通过）', () => {
    it('sonnet/opus/fable/haiku → 对应 ANTHROPIC_DEFAULT_{ROLE}_MODEL', () => {
      const env = injector.toEnv({
        ...baseConfig,
        model_role_mappings: {
          sonnet: { model: 'kimi-k2' },
          opus: { model: 'glm-4.6' },
          fable: { model: 'fable-5' },
          haiku: { model: 'haiku-4.5' },
        },
      });
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('kimi-k2');
      expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('glm-4.6');
      expect(env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe('fable-5');
      expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('haiku-4.5');
    });
    it('model 空 / 缺省的角色不注入', () => {
      const env = injector.toEnv({
        ...baseConfig,
        model_role_mappings: {
          sonnet: { model: 'kimi-k2' },
          opus: { model: '' },
          fable: {},
        },
      });
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('kimi-k2');
      expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
      expect(env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBeUndefined();
      expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
    });
    it('未知角色（如 subagent）忽略不抛', () => {
      const env = injector.toEnv({
        ...baseConfig,
        model_role_mappings: {
          subagent: { model: 'whatever' },
          sonnet: { model: 'kimi-k2' },
        },
      });
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('kimi-k2');
      // 未知角色不产任何 env（不抛异常）
      expect(Object.keys(env).some((k) => k.includes('SUBAGENT'))).toBe(false);
    });
    it('display 字段不影响 env 产出（仅 model 注入）', () => {
      const env = injector.toEnv({
        ...baseConfig,
        model_role_mappings: { sonnet: { display: 'Sonnet Pro', model: 'kimi-k2' } },
      });
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('kimi-k2');
    });
  });

  describe('one_m 后缀（X-12 官方实测：[1m] 触发 1M 上下文）', () => {
    it('one_m=true → 模型名追加 [1m]', () => {
      const env = injector.toEnv({
        ...baseConfig,
        model_role_mappings: { opus: { model: 'claude-opus-4-8', one_m: true } },
      });
      expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('claude-opus-4-8[1m]');
    });
    it('one_m=false → 原值（不追加）', () => {
      const env = injector.toEnv({
        ...baseConfig,
        model_role_mappings: { opus: { model: 'claude-opus-4-8', one_m: false } },
      });
      expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('claude-opus-4-8');
    });
    it('one_m undefined → 原值', () => {
      const env = injector.toEnv({
        ...baseConfig,
        model_role_mappings: { opus: { model: 'claude-opus-4-8' } },
      });
      expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('claude-opus-4-8');
    });
  });

  describe('extra_env（Object.assign 注入）', () => {
    it('extra_env 注入', () => {
      const env = injector.toEnv({
        ...baseConfig,
        extra_env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
      });
      expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1');
    });
    it('extra_env 在后覆盖角色 env 同名 key（design §7 Object.assign 顺序）', () => {
      const env = injector.toEnv({
        ...baseConfig,
        model_role_mappings: { sonnet: { model: 'kimi-k2' } },
        extra_env: { ANTHROPIC_DEFAULT_SONNET_MODEL: 'override-model' },
      });
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('override-model');
    });
    it('extra_env 缺省 → 不影响', () => {
      const env = injector.toEnv({ ...baseConfig, base_url: 'https://gw.example.com' });
      expect(env.ANTHROPIC_BASE_URL).toBe('https://gw.example.com');
    });
  });

  it('不修改入参 config（纯函数）', () => {
    const config: ProviderConfig = {
      agent_kind: 'claude',
      base_url: 'https://gw.example.com',
      api_key: 'sk-x',
      model_role_mappings: { opus: { model: 'm', one_m: true } },
      extra_env: { FOO: 'bar' },
    };
    const snapshot = JSON.stringify(config);
    injector.toEnv(config);
    expect(JSON.stringify(config)).toBe(snapshot);
  });

  it('端到端：完整 ProviderConfig → 全部 env 落位', () => {
    const env = injector.toEnv({
      agent_kind: 'claude',
      base_url: 'https://open.bigmodel.cn/api/anthropic',
      api_key: 'sk-bigmodel',
      auth_field: 'ANTHROPIC_AUTH_TOKEN',
      default_fallback_model: 'glm-4.6',
      model_role_mappings: {
        sonnet: { model: 'glm-4.6', one_m: false },
        opus: { model: 'glm-4.6', one_m: true },
        haiku: { model: 'glm-4.6' },
      },
      extra_env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
    });
    expect(env.ANTHROPIC_BASE_URL).toBe('https://open.bigmodel.cn/api/anthropic');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-bigmodel');
    expect(env.ANTHROPIC_MODEL).toBe('glm-4.6');
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('glm-4.6');
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('glm-4.6[1m]');
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('glm-4.6');
    expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1');
  });
});

describe('getInjector 注册表', () => {
  it("getInjector('claude') 返回 ClaudeCredentialInjector 实例", () => {
    const inj = getInjector('claude');
    expect(inj).toBeInstanceOf(ClaudeCredentialInjector);
    expect(inj?.agentKind).toBe('claude');
  });

  it('多次调用返回同一单例（注册表 freeze）', () => {
    expect(getInjector('claude')).toBe(getInjector('claude'));
  });

  it('未知 agentKind 返回 undefined（不抛）', () => {
    expect(getInjector('codex')).toBeUndefined();
    expect(getInjector('gemini')).toBeUndefined();
    expect(getInjector('pi')).toBeUndefined();
    expect(getInjector('unknown-xyz')).toBeUndefined();
  });

  it('undefined / 空串 agentKind 返回 undefined（不抛）', () => {
    expect(getInjector(undefined)).toBeUndefined();
    expect(getInjector('')).toBeUndefined();
  });
});

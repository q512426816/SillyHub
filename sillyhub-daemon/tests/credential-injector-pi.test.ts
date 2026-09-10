// tests/credential-injector-pi.test.ts
// task-05（2026-09-10-review-dispatch-platform-fixes / D-002@v1）：PiCredentialInjector 单测。
//
// pi 执行器独立凭证链最后一环（design §5.2 缺口2）：pi 的 provider_config 经
// spawn-env 第 0 层 getInjector('pi') 命中后，toEnv 把中性 ProviderConfig 翻译成
// pi 认得的 env。不真起 pi 进程（纯函数 toEnv 输入输出断言，对齐
// credential-injector.test.ts 先例）。
//
// 用例矩阵（task-05 acceptance）：
//   - auth_field 显式（ZAI_API_KEY）/ 缺省（ANTHROPIC_API_KEY）/ 空串视同缺省
//   - api_key 缺省 / 空串 → 不写任何 env 键（未配 pi 凭证时 spawn env 与现状一致）
//   - extra_env 透传 + 空串值跳过（对齐 claude injector ql-20260823-007 先例）
//   - litellm_proxy / base_url / model / default_fallback_model / model_role_mappings /
//     settings_config 一律不映射（v1 边界，design §5.2/§3）
//   - REGISTRY 注册（getInjector('pi') 单例）+ 不修改入参（纯函数，R-02 不泄漏）

import { describe, it, expect } from 'vitest';
import { PiCredentialInjector, getInjector } from '../src/credential-injector.js';
import type { ProviderConfig } from '../src/types.js';

const baseConfig: ProviderConfig = { agent_kind: 'pi' };

describe('PiCredentialInjector', () => {
  const injector = new PiCredentialInjector();

  it('agentKind = "pi"', () => {
    expect(injector.agentKind).toBe('pi');
  });

  describe('api_key → env[auth_field ?? ANTHROPIC_API_KEY]', () => {
    it('auth_field 显式（ZAI_API_KEY）→ 落该键且仅该键', () => {
      const env = injector.toEnv({ ...baseConfig, api_key: 'sk-zai-x', auth_field: 'ZAI_API_KEY' });
      expect(env).toEqual({ ZAI_API_KEY: 'sk-zai-x' });
    });

    it('auth_field 缺省 → 落 ANTHROPIC_API_KEY（pi 缺省认证键）', () => {
      const env = injector.toEnv({ ...baseConfig, api_key: 'sk-x' });
      expect(env).toEqual({ ANTHROPIC_API_KEY: 'sk-x' });
    });

    it('auth_field 空串视同缺省 → 落 ANTHROPIC_API_KEY（backend 放宽后可能下发空串）', () => {
      const env = injector.toEnv({ ...baseConfig, api_key: 'sk-x', auth_field: '' });
      expect(env).toEqual({ ANTHROPIC_API_KEY: 'sk-x' });
    });

    it('api_key 缺省 → 不写任何 env 键（空对象，spawn env 与现状逐字一致）', () => {
      const env = injector.toEnv({ ...baseConfig, auth_field: 'ZAI_API_KEY' });
      expect(env).toEqual({});
    });

    it('api_key 空串 → 不写认证键（空串视为未配置）', () => {
      const env = injector.toEnv({ ...baseConfig, api_key: '' });
      expect(env).toEqual({});
    });
  });

  describe('extra_env 透传（空串值跳过，对齐 claude injector ql-20260823-007 先例）', () => {
    it('extra_env 非空值透传', () => {
      const env = injector.toEnv({
        ...baseConfig,
        api_key: 'sk-x',
        extra_env: { PI_CUSTOM_FLAG: 'on', ANOTHER: 'v' },
      });
      expect(env.PI_CUSTOM_FLAG).toBe('on');
      expect(env.ANOTHER).toBe('v');
      expect(env.ANTHROPIC_API_KEY).toBe('sk-x');
    });

    it('extra_env 空串值跳过（空占位视为未配置，不新建空值键）', () => {
      const env = injector.toEnv({
        ...baseConfig,
        api_key: 'sk-real',
        extra_env: { ANTHROPIC_API_KEY: '', CUSTOM_FLAG: 'on' },
      });
      // 空串占位不覆盖 api_key 注入的真实值，也不新建空值键
      expect(env.ANTHROPIC_API_KEY).toBe('sk-real');
      expect(env.CUSTOM_FLAG).toBe('on');
    });

    it('extra_env 非空值可覆盖认证键（透传在后）', () => {
      const env = injector.toEnv({
        ...baseConfig,
        api_key: 'sk-from-key',
        auth_field: 'ZAI_API_KEY',
        extra_env: { ZAI_API_KEY: 'sk-from-extra' },
      });
      expect(env.ZAI_API_KEY).toBe('sk-from-extra');
    });

    it('extra_env 缺省 → 不影响', () => {
      const env = injector.toEnv({ ...baseConfig, api_key: 'sk-x' });
      expect(env).toEqual({ ANTHROPIC_API_KEY: 'sk-x' });
    });
  });

  describe('v1 边界：其余字段一律不映射（design §5.2/§3 pi 实测约定）', () => {
    it('litellm_proxy=true → 忽略，不产任何键（pi 不支持 hub 代理形态）', () => {
      const env = injector.toEnv({
        ...baseConfig,
        litellm_proxy: true,
        litellm_base_url: 'http://hub:8000/api/daemon/llm-proxy',
        litellm_model_name: 'usr-111-222',
        api_format: 'openai_chat',
      });
      expect(env).toEqual({});
    });

    it('base_url → 不产 ANTHROPIC_BASE_URL（pi 不读任何 BASE_URL 类 env，自定义端点需宿主 ~/.pi/agent/models.json）', () => {
      const env = injector.toEnv({
        ...baseConfig,
        api_key: 'sk-x',
        base_url: 'https://open.bigmodel.cn/api/anthropic',
      });
      expect(env).toEqual({ ANTHROPIC_API_KEY: 'sk-x' });
      expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    });

    it('model / default_fallback_model → 不映射（pi 经 --model spawn 旗标，不走 env）', () => {
      const env = injector.toEnv({
        ...baseConfig,
        api_key: 'sk-x',
        model: 'glm-4.6',
        default_fallback_model: 'glm-5.2',
      });
      expect(env).toEqual({ ANTHROPIC_API_KEY: 'sk-x' });
    });

    it('model_role_mappings → 不映射（无 pi 对应 env）', () => {
      const env = injector.toEnv({
        ...baseConfig,
        api_key: 'sk-x',
        model_role_mappings: { sonnet: { model: 'kimi-k2' }, opus: { model: 'glm-4.6', one_m: true } },
      });
      expect(env).toEqual({ ANTHROPIC_API_KEY: 'sk-x' });
      expect(Object.keys(env).some((k) => k.startsWith('ANTHROPIC_DEFAULT_'))).toBe(false);
    });

    it('settings_config → 不映射（claude 专属 settings.json 链路，pi 不消费）', () => {
      const env = injector.toEnv({
        ...baseConfig,
        api_key: 'sk-x',
        settings_config: { env: { LEAKED: 'x' }, attribution: { commit: '', pr: '' } },
      });
      expect(env).toEqual({ ANTHROPIC_API_KEY: 'sk-x' });
      expect(env.LEAKED).toBeUndefined();
    });

    it('全字段混杂 → 仅 api_key/auth_field/extra_env 三路生效', () => {
      const env = injector.toEnv({
        agent_kind: 'pi',
        api_key: 'sk-zai-x',
        auth_field: 'ZAI_API_KEY',
        base_url: 'https://gw.example.com',
        model: 'glm-4.6',
        default_fallback_model: 'glm-5.2',
        model_role_mappings: { sonnet: { model: 'kimi-k2' } },
        litellm_proxy: false,
        settings_config: { env: { IGNORED: '1' } },
        extra_env: { PI_EXTRA: 'on' },
      });
      expect(env).toEqual({
        ZAI_API_KEY: 'sk-zai-x',
        PI_EXTRA: 'on',
      });
    });
  });

  it('不修改入参 config（纯函数，R-02 不泄漏铁律下 toEnv 保持纯函数语义）', () => {
    const config: ProviderConfig = {
      agent_kind: 'pi',
      api_key: 'sk-x',
      auth_field: 'ZAI_API_KEY',
      extra_env: { FOO: 'bar' },
    };
    const snapshot = JSON.stringify(config);
    injector.toEnv(config);
    expect(JSON.stringify(config)).toBe(snapshot);
  });
});

describe('getInjector 注册表（pi 注册）', () => {
  it("getInjector('pi') 返回 PiCredentialInjector 实例", () => {
    const inj = getInjector('pi');
    expect(inj).toBeInstanceOf(PiCredentialInjector);
    expect(inj?.agentKind).toBe('pi');
  });

  it('多次调用返回同一单例（注册表 freeze）', () => {
    expect(getInjector('pi')).toBe(getInjector('pi'));
  });

  it("pi 注入器与 claude 注入器互不干扰（getInjector('claude') 仍 ClaudeCredentialInjector）", async () => {
    const { ClaudeCredentialInjector } = await import('../src/credential-injector.js');
    expect(getInjector('claude')).toBeInstanceOf(ClaudeCredentialInjector);
    expect(getInjector('pi')).toBeInstanceOf(PiCredentialInjector);
  });
});

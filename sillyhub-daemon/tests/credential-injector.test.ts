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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ClaudeCredentialInjector,
  getInjector,
  setDaemonApiKey,
  _resetDaemonApiKeyForTest,
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

  // task-05 / D-007@v2：settings_config.env 在 extra_env 之后最后 Object.assign，覆盖优先级最高。
  // 用例矩阵（task-13 acceptance）：
  //   - settings_config.env 注入
  //   - settings_config.env 覆盖 extra_env 同名 key（D-007 最高）
  //   - settings_config.env 覆盖角色 env 同名 key（优先级链：角色 < extra_env < settings_config.env）
  //   - settings_config 缺失/undefined → toEnv 与现状逐字一致（零回归，结构 no-op）
  //   - settings_config 仅含顶层键（attribution，无 env）→ toEnv 不受影响（顶层键归 task-06）
  //   - api_key 永不从 settings_config 取（只走 c.api_key + auth_field，安全）
  describe('settings_config.env（D-007 覆盖优先级最高，task-05）', () => {
    it('settings_config.env 注入到 env', () => {
      const env = injector.toEnv({
        ...baseConfig,
        settings_config: { env: { CUSTOM_FLAG: 'on', ANOTHER: 'v' } },
      });
      expect(env.CUSTOM_FLAG).toBe('on');
      expect(env.ANOTHER).toBe('v');
    });

    it('settings_config.env 覆盖 extra_env 同名 key（最后 Object.assign，D-007）', () => {
      const env = injector.toEnv({
        ...baseConfig,
        extra_env: { FOO: 'from-extra' },
        settings_config: { env: { FOO: 'from-settings' } },
      });
      expect(env.FOO).toBe('from-settings');
    });

    it('settings_config.env 覆盖角色 env 同名 key（优先级链角色<extra_env<settings_config.env）', () => {
      const env = injector.toEnv({
        ...baseConfig,
        model_role_mappings: { sonnet: { model: 'kimi-k2' } },
        extra_env: { ANTHROPIC_DEFAULT_SONNET_MODEL: 'extra-override' },
        settings_config: { env: { ANTHROPIC_DEFAULT_SONNET_MODEL: 'settings-override' } },
      });
      // 最终 settings_config.env 胜出
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('settings-override');
    });

    it('settings_config 缺失/undefined → toEnv 与无该字段逐字一致（零回归，D-007 brownfield）', () => {
      // task-05 仅在 toEnv 末尾追加 Object.assign(env, c.settings_config?.env ?? {})；
      // settings_config absent/undefined 时 ?? {} 得空对象，Object.assign 是 no-op → 结构性零回归。
      const rich: ProviderConfig = {
        agent_kind: 'claude',
        base_url: 'https://gw.example.com',
        api_key: 'sk-x',
        model_role_mappings: { opus: { model: 'glm-4.6', one_m: true } },
        extra_env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
      };
      // omit settings_config vs explicit undefined → 完全相同
      const withoutField = injector.toEnv(rich);
      const withUndefined = injector.toEnv({ ...rich, settings_config: undefined });
      expect(withUndefined).toEqual(withoutField);
      // 锁死期望输出（与 task-05 前逐字一致）
      expect(withoutField).toEqual({
        ANTHROPIC_BASE_URL: 'https://gw.example.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-x',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-4.6[1m]',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      });
    });

    it('settings_config=null → toEnv 安全跳过不抛（运行时防御）', () => {
      // 运行时 backend 可能下发 null；c.settings_config?.env ?? {} 兜底成 {} 不抛。
      const env = injector.toEnv({
        ...baseConfig,
        extra_env: { X: '1' },
        settings_config: null as unknown as ProviderConfig['settings_config'],
      });
      expect(env.X).toBe('1');
    });

    it('settings_config 仅含顶层 attribution（无 env）→ toEnv 不受影响（顶层键归 task-06 settings.json）', () => {
      const env = injector.toEnv({
        ...baseConfig,
        base_url: 'https://gw.example.com',
        settings_config: { attribution: { commit: '', pr: '' } },
      });
      // attribution 是顶层键不进 env（归 task-06 applyClaudeSettings 写 settings.json）
      expect(env).toEqual({ ANTHROPIC_BASE_URL: 'https://gw.example.com' });
      expect('attribution' in env).toBe(false);
    });

    it('api_key 永不从 settings_config 取（只走 c.api_key + auth_field，安全 D-009）', () => {
      // settings_config 类型无 api_key 字段；确认 toEnv 认证来源恒为 c.api_key，
      // settings_config.env 即使含同名 KEY_* 也不影响 auth 落点。
      const env = injector.toEnv({
        ...baseConfig,
        api_key: 'sk-real',
        auth_field: 'ANTHROPIC_AUTH_TOKEN',
        settings_config: { env: { UNRELATED: 'x' } },
      });
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-real');
      expect(env.UNRELATED).toBe('x');
    });

    it('端到端：extra_env + settings_config.env 共存 → settings_config.env 胜', () => {
      const env = injector.toEnv({
        agent_kind: 'claude',
        base_url: 'https://open.bigmodel.cn/api/anthropic',
        api_key: 'sk-bigmodel',
        default_fallback_model: 'glm-4.6',
        extra_env: {
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
          SHARED: 'extra',
        },
        settings_config: {
          env: {
            SHARED: 'settings-wins',
            EXTRA_FROM_SETTINGS: 'yes',
          },
          attribution: { commit: '', pr: '' },
        },
      });
      expect(env.ANTHROPIC_BASE_URL).toBe('https://open.bigmodel.cn/api/anthropic');
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-bigmodel');
      expect(env.ANTHROPIC_MODEL).toBe('glm-4.6');
      expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1');
      // 覆盖
      expect(env.SHARED).toBe('settings-wins');
      expect(env.EXTRA_FROM_SETTINGS).toBe('yes');
      // attribution 顶层键不进 env
      expect('attribution' in env).toBe(false);
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

  // task-11 / change 2026-08-08-llm-provider-openai-format：openai_chat 分支（经 LiteLLM 网关）。
  // design §7.4 daemon injector openai 分支 + §5.1 数据流 + NFR-01/D-003 不注入上游 key。
  describe('api_format=openai_chat（经 LiteLLM 网关，task-11）', () => {
    it('openai → env 指向 LiteLLM：BASE_URL/AUTH_TOKEN/MODEL + 4 档位 DEFAULT_*_MODEL 全 = litellm_model_name（gap-D）', () => {
      const env = injector.toEnv({
        ...baseConfig,
        api_format: 'openai_chat',
        litellm_base_url: 'http://litellm:4000',
        litellm_auth_token: 'sk-litellm-master',
        litellm_model_name: 'usr-111-222',
      });
      // task-11 gap-D（live claude 实测）：4 档位全映射到 litellm_model_name，否则 claude
      // 副通道请求（haiku 标题/摘要等）在 LiteLLM 无 deployment 失败。
      expect(env).toEqual({
        ANTHROPIC_BASE_URL: 'http://litellm:4000',
        ANTHROPIC_AUTH_TOKEN: 'sk-litellm-master',
        ANTHROPIC_MODEL: 'usr-111-222',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'usr-111-222',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'usr-111-222',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'usr-111-222',
        ANTHROPIC_DEFAULT_FABLE_MODEL: 'usr-111-222',
      });
    });

    it('openai 即便含上游字段也不注入（D-003/NFR-01：c.api_key/base_url/角色映射/extra_env/settings_config 全忽略）', () => {
      const env = injector.toEnv({
        ...baseConfig,
        api_format: 'openai_chat',
        litellm_base_url: 'http://litellm:4000',
        litellm_auth_token: 'sk-litellm-master',
        litellm_model_name: 'usr-111-222',
        // 上游字段存在也应被 openai 早返回忽略（openai 形态 provider_config 本就不含，防御性）
        api_key: 'sk-openai-upstream-should-not-inject',
        base_url: 'https://opencode.ai/zen/v1',
        auth_field: 'ANTHROPIC_AUTH_TOKEN',
        model_role_mappings: { sonnet: { model: 'kimi-k2' } },
        default_fallback_model: 'glm-4.6',
        extra_env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
        settings_config: { env: { LEAKED: 'x' } },
      });
      // 恰 7 个 LiteLLM 指向的 env（BASE_URL/AUTH_TOKEN/MODEL + 4 档位全 = litellm_model_name，gap-D），
      // 无任何上游字段泄漏
      expect(env).toEqual({
        ANTHROPIC_BASE_URL: 'http://litellm:4000',
        ANTHROPIC_AUTH_TOKEN: 'sk-litellm-master',
        ANTHROPIC_MODEL: 'usr-111-222',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'usr-111-222',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'usr-111-222',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'usr-111-222',
        ANTHROPIC_DEFAULT_FABLE_MODEL: 'usr-111-222',
      });
      // 关键安全断言：上游 api_key 不进 env（D-003/NFR-01）
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(Object.keys(env).length).toBe(7);
      // 不走 extra_env / settings_config（上游 extra_env/settings_config.env 不注入）
      expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBeUndefined();
      expect(env.LEAKED).toBeUndefined();
      // gap-D：档位映射取 litellm_model_name，**不**取上游 model_role_mappings 的 kimi-k2
      //（openai 形态忽略 provider 的角色映射，4 档位恒 = litellm_model_name）
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('usr-111-222');
    });

    it('openai litellm_* 全缺省 → env 为空对象（不抛）', () => {
      const env = injector.toEnv({ ...baseConfig, api_format: 'openai_chat' });
      expect(env).toEqual({});
    });

    it('openai 仅 litellm_model_name → MODEL + 4 档位全 = litellm_model_name（无 base_url/auth_token）', () => {
      const env = injector.toEnv({
        ...baseConfig,
        api_format: 'openai_chat',
        litellm_model_name: 'usr-111-222',
      });
      // gap-D：model_name 非空即同时映射主模型 + 4 档位（base_url/auth_token 缺省不写）
      expect(env).toEqual({
        ANTHROPIC_MODEL: 'usr-111-222',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'usr-111-222',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'usr-111-222',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'usr-111-222',
        ANTHROPIC_DEFAULT_FABLE_MODEL: 'usr-111-222',
      });
    });

    it('api_format=anthropic → 走既有 6 条映射规则（零回归，与 api_format 缺省逐字一致）', () => {
      const explicit = injector.toEnv({
        ...baseConfig,
        api_format: 'anthropic',
        base_url: 'https://gw.example.com',
        api_key: 'sk-x',
      });
      const omitted = injector.toEnv({
        ...baseConfig,
        base_url: 'https://gw.example.com',
        api_key: 'sk-x',
      });
      expect(explicit).toEqual(omitted);
      expect(explicit).toEqual({
        ANTHROPIC_BASE_URL: 'https://gw.example.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-x',
      });
    });
  });

  // task-04（security-audit-remediation / Grill M-2 / D-003@v1）：litellm_proxy 代理形态。
  // backend 不再下发 master key（litellm_auth_token 删除），AUTH_TOKEN 改注 daemon
  // 自身 apiKey（setDaemonApiKey 进程级注入），BASE_URL 指向 hub 代理地址。
  describe('api_format=openai_chat + litellm_proxy（hub 代理形态，task-04）', () => {
    const proxyConfig: ProviderConfig = {
      ...baseConfig,
      api_format: 'openai_chat',
      litellm_proxy: true,
      litellm_base_url: 'http://hub:8000/api/daemon/llm-proxy',
      litellm_model_name: 'usr-111-222',
    };

    // 每用例重置进程级 apiKey（避免用例间泄漏；beforeEach 保证顺序无关）。
    beforeEach(() => {
      _resetDaemonApiKeyForTest();
    });
    afterEach(() => {
      _resetDaemonApiKeyForTest();
    });

    it('litellm_proxy → BASE_URL=代理地址、AUTH_TOKEN=daemon apiKey（setDaemonApiKey 注入）、MODEL+4 档位不变', () => {
      setDaemonApiKey('shk_live_daemon_key_xyz');
      const env = injector.toEnv({ ...proxyConfig });
      expect(env).toEqual({
        ANTHROPIC_BASE_URL: 'http://hub:8000/api/daemon/llm-proxy',
        ANTHROPIC_AUTH_TOKEN: 'shk_live_daemon_key_xyz',
        ANTHROPIC_MODEL: 'usr-111-222',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'usr-111-222',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'usr-111-222',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'usr-111-222',
        ANTHROPIC_DEFAULT_FABLE_MODEL: 'usr-111-222',
      });
      // 关键安全断言：绝无 master key 残留（proxy 形态 config 本就不含）
      expect(Object.values(env).join(' ')).not.toContain('sk-litellm-master');
    });

    it('litellm_proxy 且 apiKey 未注入 → 不写 AUTH_TOKEN 键（不写空值，回退本机凭证可诊断）', () => {
      const env = injector.toEnv({ ...proxyConfig });
      expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
      expect(env.ANTHROPIC_BASE_URL).toBe('http://hub:8000/api/daemon/llm-proxy');
    });

    it('litellm_proxy 优先于老 litellm_auth_token（两者并存取 daemon apiKey，防御性）', () => {
      setDaemonApiKey('shk_live_daemon_key_xyz');
      const env = injector.toEnv({
        ...proxyConfig,
        litellm_auth_token: 'sk-litellm-master-legacy',
      } as ProviderConfig);
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe('shk_live_daemon_key_xyz');
    });

    it('setDaemonApiKey(null/空串) 等价未注入（proxy 形态不写 AUTH_TOKEN）', () => {
      setDaemonApiKey(null);
      expect(injector.toEnv({ ...proxyConfig }).ANTHROPIC_AUTH_TOKEN).toBeUndefined();
      setDaemonApiKey('');
      expect(injector.toEnv({ ...proxyConfig }).ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    });

    it('老直连形态回归：无 litellm_proxy 标记 + litellm_auth_token → 仍按原样直连（向后兼容保留）', () => {
      const env = injector.toEnv({
        ...baseConfig,
        api_format: 'openai_chat',
        litellm_base_url: 'http://litellm:4000',
        litellm_auth_token: 'sk-litellm-master-legacy',
        litellm_model_name: 'usr-111-222',
      });
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-litellm-master-legacy');
      expect(env.ANTHROPIC_BASE_URL).toBe('http://litellm:4000');
    });
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

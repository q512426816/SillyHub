// tests/zcode-settings.test.ts
// 2026-10-15-zcode-engine-appserver task-05：per-session provider_config.json 写入器单测。
// 形状钉板 = 宿主有效 provider_config.json + zcode.cjs bundle .strict() schema
//（2026-10-17 修正：providerConfigRules 必须 {providerRules:[...]} 对象包裹——
// 裸数组被引擎静默丢弃 → 注册表无模型 → 每轮 turn.failed，腾讯云真机实证）。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildZcodeProviderConfig,
  isZcodeFormSufficient,
  writeZcodeProviderConfig,
} from '../src/zcode-settings.js';
import type { ProviderConfig } from '../src/types.js';

function baseProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    agent_kind: 'zcode',
    base_url: 'https://open.bigmodel.cn/api/anthropic',
    api_key: 'sk-test-key',
    model: 'GLM-5.3',
    ...overrides,
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zcode-settings-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('buildZcodeProviderConfig 形状（anthropic-messages 形态）', () => {
  it('schemaVersion=1 + providerOrder + providerRules 对象包裹 + modelConfigRules 两键（逐字段对齐宿主有效实例）', () => {
    const cfg = buildZcodeProviderConfig({ zcodeDir: dir, provider: baseProvider() });
    expect(cfg).toEqual({
      schemaVersion: 1,
      config: {
        providerOrder: ['sillyhub'],
        providerConfigRules: {
          providerRules: [
            {
              providerId: 'sillyhub',
              providerName: 'SillyHub',
              config: {
                group: 'standard-personal',
                access: { type: 'api-key', apiKey: 'sk-test-key' },
                api: { type: 'anthropic-messages', baseUrl: 'https://open.bigmodel.cn/api/anthropic' },
                personalModelIds: ['GLM-5.3'],
                modelOrder: ['GLM-5.3'],
              },
            },
          ],
        },
        modelConfigRules: {
          providerModelRules: [],
          manualProviderModelRules: [],
        },
      },
    });
  });

  it('api_format=openai_chat → api.type=openai-chat-completions + litellm_base_url', () => {
    const cfg = buildZcodeProviderConfig({
      zcodeDir: dir,
      provider: baseProvider({
        api_format: 'openai_chat',
        litellm_base_url: 'http://127.0.0.1:15721',
        litellm_model_name: 'usr-1-2',
        model: undefined,
        default_fallback_model: undefined,
      }),
      daemonApiKey: 'daemon-key',
      });
    const rule = (cfg as { config: { providerConfigRules: { providerRules: Array<{ config: Record<string, unknown> }> } } })
      .config.providerConfigRules.providerRules[0]!;
    expect((rule.config['api'] as Record<string, unknown>)).toEqual({
      type: 'openai-chat-completions',
      baseUrl: 'http://127.0.0.1:15721',
    });
    // 裸 model id 取值链 default_fallback_model ?? model ?? litellm_model_name
    expect(rule.config['personalModelIds']).toEqual(['usr-1-2']);
  });

  it('litellm_proxy=true → apiKey 取 daemonApiKey（hub 代理凭据）', () => {
    const cfg = buildZcodeProviderConfig({
      zcodeDir: dir,
      provider: baseProvider({ api_format: 'openai_chat', litellm_base_url: 'http://hub/proxy', litellm_proxy: true }),
      daemonApiKey: 'daemon-key',
    });
    const rule = (cfg as { config: { providerConfigRules: { providerRules: Array<{ config: { access: Record<string, unknown> } }> } } })
      .config.providerConfigRules.providerRules[0]!;
    expect(rule.config.access['apiKey']).toBe('daemon-key');
  });

  it('default_fallback_model 优先于 model（D-010 取值链）', () => {
    const cfg = buildZcodeProviderConfig({
      zcodeDir: dir,
      provider: baseProvider({ model: 'low', default_fallback_model: 'high' }),
    });
    const rule = (cfg as { config: { providerConfigRules: { providerRules: Array<{ config: { modelOrder: string[] } }> } } })
      .config.providerConfigRules.providerRules[0]!;
    expect(rule.config.modelOrder).toEqual(['high']);
  });

  it('字段缺失 → build 抛错（防御性；调用方应前置门槛）', () => {
    expect(() =>
      buildZcodeProviderConfig({ zcodeDir: dir, provider: baseProvider({ api_key: undefined }) }),
    ).toThrow(/所需字段缺失/);
  });
});

describe('isZcodeFormSufficient 门槛', () => {
  it('baseUrl + key + model 齐 → true；缺一 → false', () => {
    expect(isZcodeFormSufficient(baseProvider())).toBe(true);
    expect(isZcodeFormSufficient(baseProvider({ base_url: '' }))).toBe(false);
    expect(isZcodeFormSufficient(baseProvider({ api_key: '' }))).toBe(false);
    expect(isZcodeFormSufficient(baseProvider({ model: undefined }))).toBe(false);
  });

  it('litellm_proxy 形态不预判密钥（daemon 注入面）', () => {
    expect(
      isZcodeFormSufficient(
        baseProvider({
          api_format: 'openai_chat',
          litellm_base_url: 'http://hub/proxy',
          litellm_proxy: true,
          api_key: undefined,
        }),
      ),
    ).toBe(true);
  });

  it('openai_chat 非 proxy 形态仍要求 api_key', () => {
    expect(
      isZcodeFormSufficient(
        baseProvider({ api_format: 'openai_chat', litellm_base_url: 'http://x', api_key: undefined }),
      ),
    ).toBe(false);
  });
});

describe('writeZcodeProviderConfig 落盘', () => {
  it('写入 <dir>/.zcode/v2/provider_config.json（子目录自建）且内容可解', async () => {
    await writeZcodeProviderConfig({ zcodeDir: dir, provider: baseProvider() });
    const file = join(dir, '.zcode', 'v2', 'provider_config.json');
    expect(existsSync(file)).toBe(true);
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
    expect(parsed['schemaVersion']).toBe(1);
    // 末行换行（对齐写盘器定式）
    expect(readFileSync(file, 'utf-8').endsWith('\n')).toBe(true);
  });

  it('二次写入（热切换重写）→ 内容整体替换为最新 provider', async () => {
    await writeZcodeProviderConfig({ zcodeDir: dir, provider: baseProvider({ model: 'few' }) });
    await writeZcodeProviderConfig({
      zcodeDir: dir,
      provider: baseProvider({ model: 'GLM-5.3-FlashX' }),
    });
    const parsed = JSON.parse(
      readFileSync(join(dir, '.zcode', 'v2', 'provider_config.json'), 'utf-8'),
    ) as { config: { providerConfigRules: { providerRules: Array<{ config: { modelOrder: string[] } }> } } };
    expect(parsed.config.providerConfigRules.providerRules[0]!.config.modelOrder).toEqual(['GLM-5.3-FlashX']);
  });
});

// tests/dsh-settings.test.ts
// 2026-10-15-dsh-engine-acp task-04：dsh-settings 写盘器 / 门槛判定 / env 注入器。
// 同时承担注册表 smokeSuite 词表守护（api_format 全形态字面量：anthropic /
// openai_chat——provider-adapter-registry 守护③静态扫描本文件）。

import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DSH_API_KEY_ENV,
  DshCredentialInjector,
  isDshFormSufficient,
  writeDshHome,
} from '../src/dsh-settings.js';
import type { ProviderConfig } from '../src/types.js';

function makeProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    agent_kind: 'dsh',
    base_url: 'https://api.example.com/anthropic',
    api_key: 'sk-test',
    model: 'deepseek-v4',
    ...overrides,
  } as ProviderConfig;
}

describe('isDshFormSufficient（写盘门槛）', () => {
  it('anthropic 形态三字段齐 → true', () => {
    expect(isDshFormSufficient(makeProvider())).toBe(true);
  });

  it('openai_chat 代理形态 → false（不写盘，对齐 pi 判据族）', () => {
    expect(isDshFormSufficient(makeProvider({ api_format: 'openai_chat' }))).toBe(false);
  });

  it('缺 base_url / api_key / model 任一 → false（官方端点形态 skip 走 env 层）', () => {
    expect(isDshFormSufficient(makeProvider({ base_url: '' }))).toBe(false);
    expect(isDshFormSufficient(makeProvider({ api_key: '' }))).toBe(false);
    expect(isDshFormSufficient(makeProvider({ model: '' }))).toBe(false);
  });

  it('default_fallback_model 可替代 model（对齐 pi 判据）', () => {
    expect(
      isDshFormSufficient(makeProvider({ model: '', default_fallback_model: 'm-x' })),
    ).toBe(true);
  });
});

describe('writeDshHome（per-session 路由写盘）', () => {
  it('anthropic base_url → 三件套布局（package.json 模板清单 + workspace + 无 compat 的 patch）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-home-'));
    try {
      await writeDshHome({ dshHome: dir, provider: makeProvider() });
      const acp = join(dir, 'profiles', 'acp');
      // rc.2 布局：package.json（dsh.profile.bundles 模板清单）+ workspace + patch
      const manifest = JSON.parse(readFileSync(join(acp, 'package.json'), 'utf-8')) as {
        dsh?: { profile?: { bundles?: string[] } };
      };
      expect(manifest.dsh?.profile?.bundles).toEqual([
        '@deepseek-ai/dsh-base',
        '@deepseek-ai/dsh-acp-app',
      ]);
      expect(readFileSync(join(acp, 'pnpm-workspace.yaml'), 'utf-8')).toContain('nodeLinker: hoisted');
      const yaml = readFileSync(join(acp, 'cordis.patch.yml'), 'utf8');
      expect(yaml).toContain('- id: llm-pi-ai');
      expect(yaml).toContain('api: anthropic-messages');
      expect(yaml).toContain('baseURL: https://api.example.com/anthropic');
      expect(yaml).toContain(`apiKeyEnv: ${DSH_API_KEY_ENV}`);
      expect(yaml).toContain('- id: deepseek-v4');
      // rc.2 毒源（评审+探针实证）：compat 块存在即整条 provider 被静默拒收——禁止写盘
      expect(yaml).not.toContain('compat');
      // 密钥明文不落盘（R-02：patch 只存变量名）
      expect(yaml).not.toContain('sk-test');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('非 anthropic base_url → openai-completions 形态', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-home-'));
    try {
      await writeDshHome({
        dshHome: dir,
        provider: makeProvider({
          base_url: 'https://api.example.com/v1',
          api_format: 'anthropic',
        }),
      });
      const yaml = readFileSync(join(dir, 'profiles', 'acp', 'cordis.patch.yml'), 'utf8');
      expect(yaml).toContain('api: openai-completions');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('幂等重写（同配置二次写内容一致）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-home-'));
    try {
      await writeDshHome({ dshHome: dir, provider: makeProvider() });
      const first = readFileSync(join(dir, 'profiles', 'acp', 'cordis.patch.yml'), 'utf8');
      await writeDshHome({ dshHome: dir, provider: makeProvider() });
      const second = readFileSync(join(dir, 'profiles', 'acp', 'cordis.patch.yml'), 'utf8');
      expect(second).toBe(first);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('DshCredentialInjector（env 层注入器）', () => {
  it('api_key → SILLYHUB_DSH_API_KEY；extra_env 透传（空串跳过）；agentKind=dsh', () => {
    const injector = new DshCredentialInjector();
    expect(injector.agentKind).toBe('dsh');
    const env = injector.toEnv(
      makeProvider({ extra_env: { EXTRA_FLAG: '1', EMPTY_SKIP: '' } } as Partial<ProviderConfig>),
    );
    expect(env[DSH_API_KEY_ENV]).toBe('sk-test');
    expect(env.EXTRA_FLAG).toBe('1');
    expect(env.EMPTY_SKIP).toBeUndefined();
  });

  it('无 api_key → 不注入键（空对象 + extra_env 仍透传）', () => {
    const env = new DshCredentialInjector().toEnv(
      makeProvider({ api_key: '', extra_env: { A: 'b' } } as Partial<ProviderConfig>),
    );
    expect(env[DSH_API_KEY_ENV]).toBeUndefined();
    expect(env.A).toBe('b');
  });
});

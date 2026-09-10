// tests/codex-settings.test.ts
// change 2026-09-10-multi-provider-injection task-01：writeCodexHome 写盘行为覆盖。
//
// golden 事实源 = spike/a2b-config.toml + a2-auth.json（spike A2 完整闭环证据）：
//   - provider 表（[model_providers.<id>] name/base_url/wire_api="responses"）
//   - 顶层 model / model_provider
//   - auth.json {"OPENAI_API_KEY": ...}
//
// 覆盖 design 接口定义 + D-003（wire_api=responses 唯一值）/ D-005（文件层载体）/
// D-012（门槛：provider_config 存在即进入 + per-form 必需字段；absent 零回归）/
// Grill B-3（per-form 映射唯一事实源）/ Plan 约束 3（写失败 reject 交调用方跳 env）。
// 不真起 codex 进程（端到端留 task-07 冒烟），仅断言文件内容。
//
// 用例矩阵（task-01 acceptance）：
//   - anthropic 形态：config.toml/auth.json 与 golden 逐字段一致
//   - model 取值：default_fallback_model 优先，缺省回退 model 裸 id
//   - openai_chat 形态：key=daemonApiKey / base_url=litellm_base_url /
//     model=litellm_model_name，全程不引用 provider.api_key
//   - 保守合并：非托管段（[projects.xxx] / 兄弟 provider 表 / 未知顶层键）逐行保留，
//     托管段（顶层 model/model_provider + [model_providers.sillyhub]）差量替换；
//     auth.json 未知兄弟键保留
//   - 门槛正反例：anthropic 缺 api_key+base_url → warn + 零文件写入（不抛）；
//     openai_chat 缺 litellm 两字段 → 同（即使带 api_key/base_url 也不放行——
//     D-012：不得拿 anthropic 分支字段名当全形态判据）
//   - absent：provider null/undefined → 不写不抛不 warn
//   - 写失败：父目录不存在 → console.error + reject（IO 失败语义，Plan 约束 3）
//   - TOML 转义：值含双引号/反斜杠时 basic string 最小完备转义

import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeCodexHome } from '../src/codex-settings.js';
import type { ProviderConfig } from '../src/types.js';

const { mkdtempSync, existsSync, rmSync, readFileSync, writeFileSync } = fs;

// ─────────────────────────────────────────────────────────────────────────────
// 临时 CODEX_HOME 隔离（学 claude-settings.test.ts mkdtempSync 范式；每用例独立
// 目录 + afterEach recursive force 清理，不污染真实 ~/.codex）。
// ─────────────────────────────────────────────────────────────────────────────

const tmpRoots: string[] = [];

/** 每用例新建独立 codexHome（同时充当 provider R-06 的「目录由调用方先建」前提）。 */
function newCodexHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sillyhub-codex-settings-'));
  tmpRoots.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop();
    if (dir !== undefined && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

/** 读并 parse codexHome 下 JSON 文件；调用方应先 existsSync 断言文件存在。 */
function readJson(home: string, name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(home, name), 'utf-8')) as Record<
    string,
    unknown
  >;
}

/** anthropic 直连形态 fixture（api_format 缺省/anthropic 同路径，见门槛反例）。 */
function anthropicProvider(
  overrides: Partial<ProviderConfig> = {},
): ProviderConfig {
  return {
    agent_kind: 'codex',
    api_format: 'anthropic',
    api_key: 'sk-ant-direct-123',
    base_url: 'https://anthropic.example.com',
    model: 'glm-4.7',
    ...overrides,
  };
}

/** openai_chat 形态 fixture（D-012：刻意不带 api_key/base_url，同真实 payload）。 */
function openaiChatProvider(
  overrides: Partial<ProviderConfig> = {},
): ProviderConfig {
  return {
    agent_kind: 'codex',
    api_format: 'openai_chat',
    litellm_base_url: 'https://hub.example.com/api/daemon/llm-proxy',
    litellm_model_name: 'usr-42-7',
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. anthropic 形态 golden（spike a2b 逐字段）
// ─────────────────────────────────────────────────────────────────────────────

describe('writeCodexHome anthropic 形态（golden=spike a2b-config.toml/a2-auth.json）', () => {
  it('全新目录写 config.toml：顶层 model/model_provider + [model_providers.sillyhub] 表，wire_api=responses', async () => {
    const home = newCodexHome();
    await writeCodexHome({
      codexHome: home,
      provider: anthropicProvider(),
      daemonApiKey: 'sk-daemon-unused',
    });

    const config = readFileSync(join(home, 'config.toml'), 'utf-8');
    // 逐字段对齐 golden a2b-config.toml 形状：顶层 model + model_provider 指向
    // provider 表键名 + 表内 base_url + wire_api="responses"（0.147.0 唯一合法值）。
    expect(config).toBe(
      [
        'model = "glm-4.7"',
        'model_provider = "sillyhub"',
        '',
        '[model_providers.sillyhub]',
        'name = "SillyHub"',
        'base_url = "https://anthropic.example.com"',
        'wire_api = "responses"',
        '',
      ].join('\n'),
    );
  });

  it('auth.json = {"OPENAI_API_KEY": provider.api_key}（golden a2-auth.json 同形）', async () => {
    const home = newCodexHome();
    await writeCodexHome({
      codexHome: home,
      provider: anthropicProvider(),
      daemonApiKey: 'sk-daemon-unused',
    });

    const auth = readJson(home, 'auth.json');
    expect(auth.OPENAI_API_KEY).toBe('sk-ant-direct-123');
    // anthropic 形态 auth 只含托管键（全新目录无兄弟键）
    expect(Object.keys(auth)).toEqual(['OPENAI_API_KEY']);
  });

  it('model 取 default_fallback_model（优先于 model，D-010 先例）', async () => {
    const home = newCodexHome();
    await writeCodexHome({
      codexHome: home,
      provider: anthropicProvider({
        model: 'plain-model',
        default_fallback_model: 'fallback-model',
      }),
      daemonApiKey: null,
    });
    const config = readFileSync(join(home, 'config.toml'), 'utf-8');
    expect(config).toContain('model = "fallback-model"');
    expect(config).not.toContain('plain-model');
  });

  it('无 default_fallback_model 时回退 model 裸 id', async () => {
    const home = newCodexHome();
    await writeCodexHome({
      codexHome: home,
      provider: anthropicProvider({ default_fallback_model: undefined }),
      daemonApiKey: null,
    });
    expect(readFileSync(join(home, 'config.toml'), 'utf-8')).toContain(
      'model = "glm-4.7"',
    );
  });

  it('api_format 缺省走 anthropic 分支（同 api_format=anthropic 产物）', async () => {
    const home = newCodexHome();
    await writeCodexHome({
      codexHome: home,
      provider: anthropicProvider({ api_format: undefined }),
      daemonApiKey: null,
    });
    const config = readFileSync(join(home, 'config.toml'), 'utf-8');
    expect(config).toContain('model_provider = "sillyhub"');
    expect(config).toContain('base_url = "https://anthropic.example.com"');
  });

  it('key 缺省（仅 base_url）→ auth.json 不写（spike A3a keyless provider 合法），config.toml 照写且无 model 行（model 缺省）', async () => {
    const home = newCodexHome();
    await writeCodexHome({
      codexHome: home,
      provider: anthropicProvider({
        api_key: undefined,
        model: undefined,
      }),
      daemonApiKey: null,
    });
    expect(existsSync(join(home, 'auth.json'))).toBe(false);
    expect(readFileSync(join(home, 'config.toml'), 'utf-8')).toBe(
      [
        'model_provider = "sillyhub"',
        '',
        '[model_providers.sillyhub]',
        'name = "SillyHub"',
        'base_url = "https://anthropic.example.com"',
        'wire_api = "responses"',
        '',
      ].join('\n'),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. openai_chat 形态（per-form 映射唯一事实源 / 不引用 anthropic 分支字段）
// ─────────────────────────────────────────────────────────────────────────────

describe('writeCodexHome openai_chat 形态（litellm_proxy 通道，D-006）', () => {
  it('key=daemonApiKey / base_url=litellm_base_url / model=litellm_model_name', async () => {
    const home = newCodexHome();
    await writeCodexHome({
      codexHome: home,
      provider: openaiChatProvider(),
      daemonApiKey: 'sk-daemon-master-1',
    });

    const auth = readJson(home, 'auth.json');
    expect(auth.OPENAI_API_KEY).toBe('sk-daemon-master-1');

    const config = readFileSync(join(home, 'config.toml'), 'utf-8');
    expect(config).toBe(
      [
        'model = "usr-42-7"',
        'model_provider = "sillyhub"',
        '',
        '[model_providers.sillyhub]',
        'name = "SillyHub"',
        'base_url = "https://hub.example.com/api/daemon/llm-proxy"',
        'wire_api = "responses"',
        '',
      ].join('\n'),
    );
  });

  it('全程不引用 provider.api_key（master key 不出 backend；诱饵 key 不落盘）', async () => {
    const home = newCodexHome();
    // 诱饵：即使 payload 意外带上 anthropic 分支字段，openai_chat 产物也不得引用
    await writeCodexHome({
      codexHome: home,
      provider: openaiChatProvider({
        api_key: 'sk-decoy-never-use',
        base_url: 'https://decoy.example.com',
      }),
      daemonApiKey: 'sk-daemon-master-1',
    });
    const config = readFileSync(join(home, 'config.toml'), 'utf-8');
    const authRaw = readFileSync(join(home, 'auth.json'), 'utf-8');
    expect(config).not.toContain('sk-decoy-never-use');
    expect(config).not.toContain('decoy.example.com');
    expect(authRaw).not.toContain('sk-decoy-never-use');
    expect(authRaw).toContain('sk-daemon-master-1');
  });

  it('daemonApiKey=null → auth.json 不写，config.toml 照写（路由仍可诊断）', async () => {
    const home = newCodexHome();
    await writeCodexHome({
      codexHome: home,
      provider: openaiChatProvider(),
      daemonApiKey: null,
    });
    expect(existsSync(join(home, 'auth.json'))).toBe(false);
    const config = readFileSync(join(home, 'config.toml'), 'utf-8');
    expect(config).toContain('base_url = "https://hub.example.com/api/daemon/llm-proxy"');
    expect(config).toContain('model = "usr-42-7"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. 保守合并（托管段差量替换 / 非托管段保留）
// ─────────────────────────────────────────────────────────────────────────────

describe('writeCodexHome 保守合并（config.toml 差量替换）', () => {
  it('非托管段逐行保留（注释/未知顶层键/[projects.xxx]/兄弟 provider 表），托管段重写，根区键重排至首个表头前', async () => {
    const home = newCodexHome();
    // 预置：旧托管值 + 用户自定义内容（非托管段）
    writeFileSync(
      join(home, 'config.toml'),
      [
        '# 用户级注释',
        'model = "old-model"',
        'model_provider = "oldprov"',
        'verbose = true',
        '',
        '[model_providers.oldprov]',
        'name = "Old"',
        'base_url = "http://old.example/v1"',
        'wire_api = "responses"',
        '',
        '[model_providers.sillyhub]',
        'name = "Stale"',
        'base_url = "http://stale.example/v1"',
        'wire_api = "responses"',
        '',
        '[projects."my-project"]',
        'path = "C:\\\\work\\\\demo"',
        'trust = true',
        '',
      ].join('\n'),
      'utf-8',
    );

    await writeCodexHome({
      codexHome: home,
      provider: anthropicProvider({
        model: 'new-model',
        base_url: 'https://new.example.com',
      }),
      daemonApiKey: null,
    });

    const config = readFileSync(join(home, 'config.toml'), 'utf-8');
    expect(config).toBe(
      [
        '# 用户级注释',
        'verbose = true',
        '',
        'model = "new-model"',
        'model_provider = "sillyhub"',
        '',
        '[model_providers.sillyhub]',
        'name = "SillyHub"',
        'base_url = "https://new.example.com"',
        'wire_api = "responses"',
        '',
        '[model_providers.oldprov]',
        'name = "Old"',
        'base_url = "http://old.example/v1"',
        'wire_api = "responses"',
        '',
        '[projects."my-project"]',
        'path = "C:\\\\work\\\\demo"',
        'trust = true',
        '',
      ].join('\n'),
    );
    // 托管段旧值确已替换（不留 Stale/oldprov 残留于托管位）
    expect(config).not.toContain('Stale');
    expect(config).not.toContain('old-model');
  });

  it('auth.json 先读后写保留未知兄弟键，仅覆盖 OPENAI_API_KEY', async () => {
    const home = newCodexHome();
    writeFileSync(
      join(home, 'auth.json'),
      JSON.stringify({
        OPENAI_API_KEY: 'sk-old-value',
        tokens: { chatgpt: 't0' },
      }),
      'utf-8',
    );

    await writeCodexHome({
      codexHome: home,
      provider: anthropicProvider(),
      daemonApiKey: null,
    });

    const auth = readJson(home, 'auth.json');
    expect(auth.OPENAI_API_KEY).toBe('sk-ant-direct-123');
    expect(auth.tokens).toEqual({ chatgpt: 't0' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. 门槛（D-012：per-form 必需字段）+ absent 边界（零回归）
// ─────────────────────────────────────────────────────────────────────────────

describe('writeCodexHome 写盘门槛（D-012：缺失 warn + 零文件写入，不抛）', () => {
  it('anthropic 形态缺 api_key+base_url（必需字段一项都无）→ warn + 两文件零写入 + 正常返回', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const home = newCodexHome();
    await expect(
      writeCodexHome({
        codexHome: home,
        provider: anthropicProvider({
          api_key: undefined,
          base_url: undefined,
          model: 'glm-4.7',
        }),
        daemonApiKey: null,
      }),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      'codex_home_write_skipped_missing_fields',
      expect.objectContaining({
        api_format: 'anthropic',
        missing: ['api_key', 'base_url'],
      }),
    );
    expect(existsSync(join(home, 'auth.json'))).toBe(false);
    expect(existsSync(join(home, 'config.toml'))).toBe(false);
  });

  it('openai_chat 形态缺 litellm 两字段 → warn + 零写入；即使带 api_key/base_url 也不放行（判据不得用 anthropic 分支字段名）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const home = newCodexHome();
    await expect(
      writeCodexHome({
        codexHome: home,
        provider: openaiChatProvider({
          litellm_base_url: undefined,
          litellm_model_name: undefined,
          // 诱饵：anthropic 分支字段齐全也不满足 openai_chat 门槛
          api_key: 'sk-ant-direct-123',
          base_url: 'https://anthropic.example.com',
        }),
        daemonApiKey: 'sk-daemon-master-1',
      }),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      'codex_home_write_skipped_missing_fields',
      expect.objectContaining({
        api_format: 'openai_chat',
        missing: ['litellm_base_url', 'litellm_model_name'],
      }),
    );
    expect(existsSync(join(home, 'auth.json'))).toBe(false);
    expect(existsSync(join(home, 'config.toml'))).toBe(false);
  });

  it('必需字段「至少一项」即进入：openai_chat 仅 litellm_model_name 也写盘（base_url 行缺省不写）', async () => {
    const home = newCodexHome();
    await writeCodexHome({
      codexHome: home,
      provider: openaiChatProvider({ litellm_base_url: undefined }),
      daemonApiKey: 'sk-daemon-master-1',
    });
    const config = readFileSync(join(home, 'config.toml'), 'utf-8');
    expect(config).toContain('model = "usr-42-7"');
    expect(config).not.toContain('base_url =');
    expect(readJson(home, 'auth.json').OPENAI_API_KEY).toBe(
      'sk-daemon-master-1',
    );
  });
});

describe('writeCodexHome absent 边界（provider_config 整体缺省 → 不写不抛，零回归）', () => {
  it('provider=null → 无写入、无 warn、正常返回', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const home = newCodexHome();
    await expect(
      writeCodexHome({ codexHome: home, provider: null, daemonApiKey: null }),
    ).resolves.toBeUndefined();
    expect(existsSync(join(home, 'auth.json'))).toBe(false);
    expect(existsSync(join(home, 'config.toml'))).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('provider=undefined → 同（lease 不带 provider_config 键）', async () => {
    const home = newCodexHome();
    await expect(
      writeCodexHome({
        codexHome: home,
        provider: undefined,
        daemonApiKey: null,
      }),
    ).resolves.toBeUndefined();
    expect(existsSync(join(home, 'config.toml'))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. 写失败语义（Plan 约束 3：error + reject，交调用方跳 CODEX_HOME env）
// ─────────────────────────────────────────────────────────────────────────────

describe('writeCodexHome 写 IO 失败 → error + throw', () => {
  it('父目录不存在（codexHome 缺失，目录归调用方创建）→ console.error + reject，零文件', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const home = newCodexHome();
    const missingHome = join(home, 'no-such-parent', 'codex-home');

    await expect(
      writeCodexHome({
        codexHome: missingHome,
        provider: anthropicProvider(),
        daemonApiKey: null,
      }),
    ).rejects.toThrow();

    expect(errorSpy).toHaveBeenCalledWith(
      'codex_home_write_failed',
      expect.objectContaining({ codexHome: missingHome }),
    );
    // 错误日志载荷不含密钥明文（constraints：daemonApiKey/api_key 不入日志）
    const payload = errorSpy.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(JSON.stringify(payload)).not.toContain('sk-ant-direct-123');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. TOML 序列化最小完备转义（值含引号/反斜杠）
// ─────────────────────────────────────────────────────────────────────────────

describe('writeCodexHome TOML 转义（basic string）', () => {
  it('base_url/model 含双引号与反斜杠 → \\ \" 转义后仍为合法 TOML 字符串行', async () => {
    const home = newCodexHome();
    await writeCodexHome({
      codexHome: home,
      provider: anthropicProvider({
        base_url: 'http://127.0.0.1:18999/a"b\\c',
        model: 'mo"del',
      }),
      daemonApiKey: null,
    });
    const config = readFileSync(join(home, 'config.toml'), 'utf-8');
    expect(config).toContain('model = "mo\\"del"');
    expect(config).toContain(
      'base_url = "http://127.0.0.1:18999/a\\"b\\\\c"',
    );
  });
});

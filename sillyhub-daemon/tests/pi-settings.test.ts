// tests/pi-settings.test.ts
// change 2026-09-10-multi-provider-injection task-02：writePiDir 写盘行为覆盖。
//
// golden 事实源 = spike/b1b-auth.json + b1-models.json + b1-settings.json
// （spike B1 完整闭环证据，pi 0.81.1）：
//   - auth.json 官方形状 {"<providerKey>": {"type": "api_key", "key": ...}}
//     （b1-auth.json 的 {"apiKey": ...} 投影形状实测被拒，是负例勿用）
//   - models.json providers 段 {name, api: "openai-completions", baseUrl, models: [{id}]}
//   - settings.json {defaultProvider, defaultModel}
//
// 覆盖 design 接口定义 pi 段 + D-004（官方 auth 形状）/ D-005（文件层载体）/
// D-008（分层：官方端点形态零写入）/ D-011（per-session 目录）/
// R-04（env 层共存——auth.json > env 压制语义，spike Pi-3；模块 docstring 落位）/
// Plan 约束 1（Promise<void>）/ 约束 3（写失败 reject 交调用方跳 env 注入）。
// 不真起 pi 进程（端到端留 task-07 冒烟），仅断言文件内容。
//
// 用例矩阵（task-02 acceptance）：
//   - 自定义端点形态：三文件与 spike b1 系 golden 逐字段一致
//   - model 取值：default_fallback_model 优先，缺省回退 model 裸 id
//   - preserve unknown：auth.json 兄弟 provider 键 / models.json 兄弟 provider +
//     未知顶层键 + sillyhub 条目内未知字段（托管字段含旧值清除）/ settings.json
//     未知键，全部保留
//   - 门槛：base_url 空（官方端点形态）→ 零写入正常返回（不告警，env 层负责）；
//     api_format=openai_chat（禁配防御）→ warn 跳过；api_key 缺 → warn 跳过
//     （不写空 key）；model 缺 → warn 跳过（defaultModel/models 是 pi 侧唯一选型键）
//   - 损坏 JSON（非法 JSON / providers 非对象）→ warn 后按空对象重建
//   - 写 IO 失败 → console.error + reject，error 载荷不含 api_key 明文
//
// env 层共存语义（R-04，语义断言在 pi-settings.ts 模块 docstring 落位）：
// pi 官方 key 优先级 --api-key > auth.json > env > models.json 内联——文件层
// auth.json 值压制 env 同键值，两层并存无歧义（spike Pi-3 实证）；官方端点形态
// 本层零写入，对 env 层零干扰（D-008）。

import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writePiDir } from '../src/pi-settings.js';
import type { ProviderConfig } from '../src/types.js';

const { mkdtempSync, existsSync, rmSync, readFileSync, writeFileSync } = fs;

// ─────────────────────────────────────────────────────────────────────────────
// 临时 PI_CODING_AGENT_DIR 隔离（学 codex-settings.test.ts mkdtempSync 范式；
// 每用例独立目录 + afterEach recursive force 清理，不污染真实 ~/.pi/agent）。
// ─────────────────────────────────────────────────────────────────────────────

const tmpRoots: string[] = [];

/** 每用例新建独立 piDir（「目录由调用方 spawn 前创建」前提）。 */
function newPiDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sillyhub-pi-settings-'));
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

/** 读并 parse piDir 下 JSON 文件；调用方应先 existsSync 断言文件存在。 */
function readJson(dir: string, name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, name), 'utf-8')) as Record<
    string,
    unknown
  >;
}

/** 自定义端点形态 fixture（base_url 非空 = 唯一触发条件，api_format 缺省/anthropic 同路径）。 */
function piCustomProvider(
  overrides: Partial<ProviderConfig> = {},
): ProviderConfig {
  return {
    agent_kind: 'pi',
    api_key: 'sk-mock-123',
    base_url: 'http://127.0.0.1:18999/v1',
    model: 'mock-model',
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. 三文件 golden（spike b1 系逐字段）
// ─────────────────────────────────────────────────────────────────────────────

describe('writePiDir 自定义端点形态（golden=spike b1b-auth/b1-models/b1-settings）', () => {
  it('auth.json = {"sillyhub": {"type": "api_key", "key": api_key}}（官方形状，b1b 逐字段；b1 的 apiKey 形状是拒收负例）', async () => {
    const dir = newPiDir();
    await writePiDir({ piDir: dir, provider: piCustomProvider() });

    const auth = readJson(dir, 'auth.json');
    // golden b1b-auth.json：{"mockprov": {"type": "api_key", "key": "sk-mock-123"}}
    // ——provider 键换 sillyhub、key 换 lease 值，条目字段集逐字段一致。
    expect(auth).toEqual({
      sillyhub: { type: 'api_key', key: 'sk-mock-123' },
    });
    // 负例形状防御：不产出 {"apiKey": ...} 投影（pi 0.81.1 不认，spike B1 附）。
    expect(auth).not.toHaveProperty('apiKey');
    const sillyhub = auth.sillyhub as Record<string, unknown>;
    expect(sillyhub.type).toBe('api_key');
    expect(sillyhub.key).toBe('sk-mock-123');
  });

  it('models.json providers.sillyhub = {name, api:"openai-completions", baseUrl, models:[{id}]}（b1-models 逐字段）', async () => {
    const dir = newPiDir();
    await writePiDir({ piDir: dir, provider: piCustomProvider() });

    const models = readJson(dir, 'models.json');
    // golden b1-models.json：providers.<key> = {name, api, baseUrl, models:[{id}]}
    expect(models).toEqual({
      providers: {
        sillyhub: {
          name: 'SillyHub',
          api: 'openai-completions',
          baseUrl: 'http://127.0.0.1:18999/v1',
          models: [{ id: 'mock-model' }],
        },
      },
    });
  });

  it('settings.json = {defaultProvider:"sillyhub", defaultModel:裸 model id}（b1-settings 逐字段）', async () => {
    const dir = newPiDir();
    await writePiDir({ piDir: dir, provider: piCustomProvider() });

    const settings = readJson(dir, 'settings.json');
    // golden b1-settings.json：{"defaultProvider": "mockprov", "defaultModel": "mock-model"}
    expect(settings).toEqual({
      defaultProvider: 'sillyhub',
      defaultModel: 'mock-model',
    });
  });

  it('model 取 default_fallback_model（优先于 model，D-010 先例；taskcard「default_fallback_model 缺省回退 model」）', async () => {
    const dir = newPiDir();
    await writePiDir({
      piDir: dir,
      provider: piCustomProvider({
        model: 'plain-model',
        default_fallback_model: 'fallback-model',
      }),
    });
    const models = readJson(dir, 'models.json');
    const settings = readJson(dir, 'settings.json');
    expect(settings.defaultModel).toBe('fallback-model');
    expect(
      (
        (
          (models.providers as Record<string, unknown>).sillyhub as Record<
            string,
            unknown
          >
        ).models as Array<{ id: string }>
      ).map((m) => m.id),
    ).toEqual(['fallback-model']);
  });

  it('api_format 缺省与 anthropic 同路径（自定义端点判定只看 base_url）', async () => {
    const dir = newPiDir();
    await writePiDir({
      piDir: dir,
      provider: piCustomProvider({ api_format: undefined }),
    });
    expect(readJson(dir, 'settings.json').defaultProvider).toBe('sillyhub');
    expect(readJson(dir, 'auth.json').sillyhub).toEqual({
      type: 'api_key',
      key: 'sk-mock-123',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. preserve unknown（三文件先读后合并）
// ─────────────────────────────────────────────────────────────────────────────

describe('writePiDir preserve unknown（先读后合并，兄弟键/未知字段全保留）', () => {
  it('auth.json 兄弟 provider 键保留，仅 upsert sillyhub 条目', async () => {
    const dir = newPiDir();
    writeFileSync(
      join(dir, 'auth.json'),
      JSON.stringify({
        mockprov: { type: 'api_key', key: 'sk-old-mock' },
        otherprov: { type: 'api_key', key: 'sk-other-999' },
      }),
      'utf-8',
    );

    await writePiDir({ piDir: dir, provider: piCustomProvider() });

    const auth = readJson(dir, 'auth.json');
    expect(auth.sillyhub).toEqual({ type: 'api_key', key: 'sk-mock-123' });
    expect(auth.mockprov).toEqual({ type: 'api_key', key: 'sk-old-mock' });
    expect(auth.otherprov).toEqual({ type: 'api_key', key: 'sk-other-999' });
  });

  it('models.json 兄弟 provider + 未知顶层键 + sillyhub 条目内未知字段保留，托管字段差量替换（含旧 baseUrl 清除）', async () => {
    const dir = newPiDir();
    writeFileSync(
      join(dir, 'models.json'),
      JSON.stringify(
        {
          $schema: 'https://pi.example/schemas/models.json', // 未知顶层键
          providers: {
            mockprov: {
              name: 'MockProv',
              api: 'openai-completions',
              baseUrl: 'http://127.0.0.1:18999/v1',
              models: [{ id: 'mock-model' }],
            },
            sillyhub: {
              name: 'Stale Name',
              api: 'openai-completions',
              baseUrl: 'http://stale.example/v1', // 旧托管值必须被替换
              models: [{ id: 'stale-model' }, { id: 'extra-model' }],
              queryMode: 'think', // 条目内未知字段保留
            },
          },
        },
        null,
        2,
      ),
      'utf-8',
    );

    await writePiDir({
      piDir: dir,
      provider: piCustomProvider({ base_url: 'http://127.0.0.1:18999/v1' }),
    });

    const models = readJson(dir, 'models.json');
    expect(models.$schema).toBe('https://pi.example/schemas/models.json');
    const providers = models.providers as Record<string, unknown>;
    // 兄弟 provider 原样保留
    expect(providers.mockprov).toEqual({
      name: 'MockProv',
      api: 'openai-completions',
      baseUrl: 'http://127.0.0.1:18999/v1',
      models: [{ id: 'mock-model' }],
    });
    const sillyhub = providers.sillyhub as Record<string, unknown>;
    // 托管字段差量替换（旧值/旧 models 目录清除）
    expect(sillyhub.name).toBe('SillyHub');
    expect(sillyhub.baseUrl).toBe('http://127.0.0.1:18999/v1');
    expect(sillyhub.models).toEqual([{ id: 'mock-model' }]);
    expect(sillyhub.queryMode).toBe('think');
    const raw = readFileSync(join(dir, 'models.json'), 'utf-8');
    expect(raw).not.toContain('stale-model');
    expect(raw).not.toContain('stale.example');
  });

  it('settings.json 未知键保留，defaultProvider/defaultModel 覆盖', async () => {
    const dir = newPiDir();
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({
        defaultProvider: 'mockprov',
        defaultModel: 'old-model',
        theme: 'dark',
        shareEnabled: true,
      }),
      'utf-8',
    );

    await writePiDir({ piDir: dir, provider: piCustomProvider() });

    const settings = readJson(dir, 'settings.json');
    expect(settings.defaultProvider).toBe('sillyhub');
    expect(settings.defaultModel).toBe('mock-model');
    expect(settings.theme).toBe('dark');
    expect(settings.shareEnabled).toBe(true);
  });

  it('损坏 JSON（非法 JSON / providers 非对象）→ warn 后按空对象重建（per-session 托管目录语义）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dir = newPiDir();
    writeFileSync(join(dir, 'auth.json'), '{not json', 'utf-8');
    writeFileSync(
      join(dir, 'models.json'),
      JSON.stringify({ providers: 'oops-not-an-object' }),
      'utf-8',
    );

    await writePiDir({ piDir: dir, provider: piCustomProvider() });

    // 三文件仍写出、托管段完整；损坏段按空对象重建
    expect(readJson(dir, 'auth.json')).toEqual({
      sillyhub: { type: 'api_key', key: 'sk-mock-123' },
    });
    const models = readJson(dir, 'models.json');
    expect(
      (models.providers as Record<string, unknown>).sillyhub,
    ).toBeDefined();
    expect(warnSpy).toHaveBeenCalledWith(
      'pi_settings_parse_failed',
      expect.anything(),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'pi_settings_unexpected_shape',
      expect.objectContaining({ key: 'providers' }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. 门槛（D-008 分层 + 禁配防御 + 必需字段）
// ─────────────────────────────────────────────────────────────────────────────

describe('writePiDir 写盘门槛', () => {
  it('base_url 为空（官方端点形态）→ 三文件零写入、正常返回、不告警（env 层负责，D-008 分层）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dir = newPiDir();
    await expect(
      writePiDir({
        piDir: dir,
        provider: piCustomProvider({
          base_url: '',
          api_key: 'sk-official-777',
        }),
      }),
    ).resolves.toBeUndefined();

    expect(existsSync(join(dir, 'auth.json'))).toBe(false);
    expect(existsSync(join(dir, 'models.json'))).toBe(false);
    expect(existsSync(join(dir, 'settings.json'))).toBe(false);
    // 官方端点是设计内分派而非异常——静默跳过（区别于字段缺失的 warn 跳过）。
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('api_format=openai_chat（pi × openai_chat 禁配组合）→ warn 跳过，即使 base_url/api_key 齐备也不放行（防御性双保险；后端 422 归 task-05）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dir = newPiDir();
    await expect(
      writePiDir({
        piDir: dir,
        provider: piCustomProvider({
          api_format: 'openai_chat',
          // 诱饵：anthropic 分支字段齐全也不得经文件层注入（litellm 形态无上游 key）
          api_key: 'sk-decoy-openai-chat',
          base_url: 'https://decoy.example.com/v1',
        }),
      }),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      'pi_dir_write_skipped_openai_chat',
      expect.objectContaining({ piDir: dir }),
    );
    expect(existsSync(join(dir, 'auth.json'))).toBe(false);
    expect(existsSync(join(dir, 'models.json'))).toBe(false);
    expect(existsSync(join(dir, 'settings.json'))).toBe(false);
    // 诱饵 key 不落盘
    expect(
      existsSync(join(dir, 'auth.json')) ? readFileSync(join(dir, 'auth.json'), 'utf-8') : '',
    ).not.toContain('sk-decoy-openai-chat');
  });

  it('api_key 缺（base_url 非空）→ warn 跳过 + 零写入（不写空 key——空串会被 pi 当字面量打上游）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dir = newPiDir();
    await expect(
      writePiDir({
        piDir: dir,
        provider: piCustomProvider({ api_key: undefined }),
      }),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      'pi_dir_write_skipped_missing_fields',
      expect.objectContaining({ missing: ['api_key'] }),
    );
    expect(existsSync(join(dir, 'auth.json'))).toBe(false);
    expect(existsSync(join(dir, 'models.json'))).toBe(false);
    expect(existsSync(join(dir, 'settings.json'))).toBe(false);
  });

  it('api_key 空串同缺省（空串=未配置语义，且绝不产出 {"type":"api_key","key":""}）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dir = newPiDir();
    await writePiDir({
      piDir: dir,
      provider: piCustomProvider({ api_key: '' }),
    });
    expect(warnSpy).toHaveBeenCalledWith(
      'pi_dir_write_skipped_missing_fields',
      expect.objectContaining({ missing: ['api_key'] }),
    );
    expect(existsSync(join(dir, 'auth.json'))).toBe(false);
  });

  it('model 缺（default_fallback_model 与 model 皆无）→ warn 跳过（defaultModel/models 目录是 pi 侧唯一选型键，无 model 三文件不可用）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dir = newPiDir();
    await expect(
      writePiDir({
        piDir: dir,
        provider: piCustomProvider({
          model: undefined,
          default_fallback_model: undefined,
        }),
      }),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      'pi_dir_write_skipped_missing_fields',
      expect.objectContaining({ missing: ['model'] }),
    );
    expect(existsSync(join(dir, 'auth.json'))).toBe(false);
    expect(existsSync(join(dir, 'models.json'))).toBe(false);
    expect(existsSync(join(dir, 'settings.json'))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. 写 IO 失败语义（Plan 约束 3：error + reject，交调用方跳 PI env 注入）
// ─────────────────────────────────────────────────────────────────────────────

describe('writePiDir 写 IO 失败 → error + reject', () => {
  it('piDir 不存在（目录归调用方创建）→ console.error + reject，零文件', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dir = newPiDir();
    const missingDir = join(dir, 'no-such-parent', 'pi-dir');

    await expect(
      writePiDir({ piDir: missingDir, provider: piCustomProvider() }),
    ).rejects.toThrow();

    expect(errorSpy).toHaveBeenCalledWith(
      'pi_dir_write_failed',
      expect.objectContaining({ piDir: missingDir }),
    );
    // 错误日志载荷不含密钥明文（constraints：api_key 不入日志）
    const payload = errorSpy.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(JSON.stringify(payload)).not.toContain('sk-mock-123');
  });
});

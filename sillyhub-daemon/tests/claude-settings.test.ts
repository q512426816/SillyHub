// tests/claude-settings.test.ts
// task-13: applyClaudeSettings 写盘行为 + 白名单顶层键合并 + absent 不写文件（task-06 验收）。
//
// 覆盖 design §5.2 / §7（daemon 测试策略）/ D-008（白名单顶层键显式枚举）/
// D-007 brownfield（absent/null/仅 env → 不写文件，零回归）/ D-009（api_key 永不进 settings.json）。
// 不真起 claude 进程（spike-02 顶层键生效验留 verify 端到端），仅断言 settings.json 文件内容。
//
// 注：buildSettingsObject 为 task-06 文档约定「导出供 task-13 单测覆盖」的纯函数，但当前
// src/claude-settings.ts 未加 export 关键字（task-06 缺陷）。本 suite 经公开 API
// applyClaudeSettings（= buildSettingsObject + writeFile 薄封装）全覆盖其纯函数行为，
// 行为等价；导出缺失留 task-06 跟进。
//
// 用例矩阵（task-13 acceptance）：
//   - settings_config.attribution → 写 settings.json 顶层 attribution
//   - settings_config.enabledPlugins → 顶层合并
//   - settings_config.model / skipDangerousModePermissionPrompt → 顶层写入
//   - settings_config 多顶层键（attribution + model + skipDangerousModePermissionPrompt）同写
//   - settings_config=null/undefined/仅 env → 不写文件（existsSync false，零回归）
//   - provider_config=null/undefined → 不写文件
//   - env / api_key 永不进 settings.json（白名单安全断言）

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyClaudeSettings } from '../src/claude-settings.js';
import type { ProviderConfig } from '../src/types.js';

const { mkdtempSync, existsSync, rmSync, readFileSync } = fs;

// ─────────────────────────────────────────────────────────────────────────────
// 临时 CLAUDE_CONFIG_DIR 隔离（学 credential.test.ts:44 mkdtempSync 范式）。
// 不污染真实 CLAUDE_CONFIG_DIR（~/.sillyhub/daemon/claude-config，隔离目录）；
// afterAll rmSync recursive force 清掉整个 tmpDir。
// ─────────────────────────────────────────────────────────────────────────────

const tmpDir = mkdtempSync(join(tmpdir(), 'sillyhub-claude-settings-'));
const settingsPath = join(tmpDir, 'settings.json');

beforeEach(() => {
  // 每个用例独立：删遗留 settings.json（若无 force 跳过）保证用例间隔离。
  if (existsSync(settingsPath)) rmSync(settingsPath, { force: true });
});

afterAll(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

/** 读 settings.json 并 parse；调用方应先 existsSync 断言文件存在。 */
function readSettings(): Record<string, unknown> {
  return JSON.parse(readFileSync(settingsPath, 'utf-8'));
}

describe('applyClaudeSettings 白名单顶层键写盘（task-06）', () => {
  it('settings_config.attribution → 写入 settings.json 顶层 attribution（{commit:"",pr:"} 隐藏署名）', async () => {
    await applyClaudeSettings(
      {
        agent_kind: 'claude',
        settings_config: { attribution: { commit: '', pr: '' } },
      },
      tmpDir,
    );
    expect(existsSync(settingsPath)).toBe(true);
    const obj = readSettings();
    expect(obj.attribution).toEqual({ commit: '', pr: '' });
  });

  it('settings_config.enabledPlugins → 顶层合并进 settings.json', async () => {
    await applyClaudeSettings(
      {
        agent_kind: 'claude',
        settings_config: {
          enabledPlugins: { 'frontend-design': true, playwright: true },
        },
      },
      tmpDir,
    );
    expect(readSettings().enabledPlugins).toEqual({
      'frontend-design': true,
      playwright: true,
    });
  });

  it('settings_config.model → 顶层 model 写入', async () => {
    await applyClaudeSettings(
      { agent_kind: 'claude', settings_config: { model: 'claude-opus-4-8' } },
      tmpDir,
    );
    expect(readSettings().model).toBe('claude-opus-4-8');
  });

  it('settings_config.skipDangerousModePermissionPrompt → 顶层布尔写入', async () => {
    await applyClaudeSettings(
      {
        agent_kind: 'claude',
        settings_config: { skipDangerousModePermissionPrompt: true },
      },
      tmpDir,
    );
    expect(readSettings().skipDangerousModePermissionPrompt).toBe(true);
  });

  it('settings_config 多顶层键（attribution + model + skipDangerousModePermissionPrompt）同写', async () => {
    await applyClaudeSettings(
      {
        agent_kind: 'claude',
        settings_config: {
          attribution: { commit: '', pr: '' },
          model: 'glm-4.6',
          skipDangerousModePermissionPrompt: true,
        },
      },
      tmpDir,
    );
    const obj = readSettings();
    // 仅白名单 3 顶层键落盘（无 env / api_key 杂质）
    expect(Object.keys(obj).sort()).toEqual([
      'attribution',
      'model',
      'skipDangerousModePermissionPrompt',
    ]);
    expect(obj.attribution).toEqual({ commit: '', pr: '' });
    expect(obj.model).toBe('glm-4.6');
    expect(obj.skipDangerousModePermissionPrompt).toBe(true);
  });

  it("白名单外未知键（如 foo=bar）不写盘（显式枚举防未来泄漏）", async () => {
    await applyClaudeSettings(
      {
        agent_kind: 'claude',
        settings_config: {
          attribution: { commit: '', pr: '' },
          // 运行时防御：未来 settings_config 扩展未知键不应漏到 settings.json
          foo: 'bar',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as unknown as ProviderConfig['settings_config'],
      },
      tmpDir,
    );
    const obj = readSettings();
    expect(obj.attribution).toEqual({ commit: '', pr: '' });
    expect('foo' in obj).toBe(false);
    expect(Object.keys(obj)).toEqual(['attribution']);
  });
});

describe('applyClaudeSettings 安全断言（env / api_key 永不进 settings.json）', () => {
  it('settings_config.env 不出现在 settings.json（env 归 toEnv，D-007）', async () => {
    await applyClaudeSettings(
      {
        agent_kind: 'claude',
        settings_config: {
          env: { FOO: 'bar', ANTHROPIC_MODEL: 'should-not-leak' },
          attribution: { commit: '', pr: '' },
        },
      },
      tmpDir,
    );
    const obj = readSettings();
    // attribution 落盘，env 不落盘
    expect(obj.attribution).toEqual({ commit: '', pr: '' });
    expect('env' in obj).toBe(false);
    expect(obj.FOO).toBeUndefined();
    expect(obj.ANTHROPIC_MODEL).toBeUndefined();
  });

  it('settings.json 永不含 api_key（白名单天然排除，D-009 安全）', async () => {
    await applyClaudeSettings(
      {
        agent_kind: 'claude',
        api_key: 'sk-secret-never-leak',
        settings_config: { attribution: { commit: '', pr: '' } },
      },
      tmpDir,
    );
    const obj = readSettings();
    expect('api_key' in obj).toBe(false);
    // 序列化全文也不含明文密钥（双重保险）
    expect(JSON.stringify(obj)).not.toContain('sk-secret-never-leak');
  });
});

describe('applyClaudeSettings 零回归（absent 不写文件，D-007 brownfield）', () => {
  it('settings_config 缺省 → 不写文件（existsSync false）', async () => {
    await applyClaudeSettings({ agent_kind: 'claude' }, tmpDir);
    expect(existsSync(settingsPath)).toBe(false);
  });

  it('settings_config=null → 不写文件（运行时防御）', async () => {
    await applyClaudeSettings(
      {
        agent_kind: 'claude',
        settings_config: null as unknown as ProviderConfig['settings_config'],
      },
      tmpDir,
    );
    expect(existsSync(settingsPath)).toBe(false);
  });

  it('provider_config=null → 不写文件', async () => {
    await applyClaudeSettings(null, tmpDir);
    expect(existsSync(settingsPath)).toBe(false);
  });

  it('provider_config=undefined → 不写文件', async () => {
    await applyClaudeSettings(undefined, tmpDir);
    expect(existsSync(settingsPath)).toBe(false);
  });

  it('settings_config 仅含 env（无任一白名单顶层键）→ 不写文件（env 已由 toEnv 注入）', async () => {
    await applyClaudeSettings(
      {
        agent_kind: 'claude',
        settings_config: { env: { FOO: 'bar', ANTHROPIC_MODEL: 'x' } },
      },
      tmpDir,
    );
    expect(existsSync(settingsPath)).toBe(false);
  });

  it('settings_config 白名单键值全为 null → 视为未设置，不写文件', async () => {
    // buildSettingsObject 过滤 null/undefined；结果空对象 → applyClaudeSettings return 不写。
    await applyClaudeSettings(
      {
        agent_kind: 'claude',
        settings_config: {
          attribution: null,
          model: null,
          enabledPlugins: null,
        } as unknown as ProviderConfig['settings_config'],
      },
      tmpDir,
    );
    expect(existsSync(settingsPath)).toBe(false);
  });

  it('absent 场景不抛异常（best-effort，不阻断 spawn 主路径）', async () => {
    // 各种 absent 入参都不应抛（spawn 前调用点不容许抛错阻断）
    await expect(applyClaudeSettings(null, tmpDir)).resolves.toBeUndefined();
    await expect(applyClaudeSettings(undefined, tmpDir)).resolves.toBeUndefined();
    await expect(
      applyClaudeSettings({ agent_kind: 'claude' }, tmpDir),
    ).resolves.toBeUndefined();
    await expect(
      applyClaudeSettings(
        { agent_kind: 'claude', settings_config: { env: { X: '1' } } },
        tmpDir,
      ),
    ).resolves.toBeUndefined();
  });
});

describe('applyClaudeSettings 写盘语义', () => {
  it('写出文件是合法 JSON（2 空格缩进，可被 JSON.parse）', async () => {
    await applyClaudeSettings(
      {
        agent_kind: 'claude',
        settings_config: { attribution: { commit: '', pr: '' } },
      },
      tmpDir,
    );
    const raw = readFileSync(settingsPath, 'utf-8');
    // 合法 JSON
    expect(() => JSON.parse(raw)).not.toThrow();
    // 2 空格缩进（JSON.stringify(obj, null, 2) 产出）
    expect(raw).toContain('  "attribution"');
  });

  it('false / 空串等 falsy 合法值按 JSON 语义保留（不当作未设置）', async () => {
    await applyClaudeSettings(
      {
        agent_kind: 'claude',
        settings_config: {
          skipDangerousModePermissionPrompt: false,
          model: '',
        },
      },
      tmpDir,
    );
    // false / '' 经 buildSettingsObject 过滤逻辑（仅 undefined/null 过滤）应保留
    // 注：空串 model 在实际语义无意义，但 buildSettingsObject 不过滤 → 这里断言实际行为。
    const obj = readSettings();
    expect(obj.skipDangerousModePermissionPrompt).toBe(false);
    expect(obj.model).toBe('');
  });

  it('目标目录不存在时 best-effort 自建（mkdir recursive）', async () => {
    const deepDir = join(tmpDir, 'nested', 'config');
    await applyClaudeSettings(
      {
        agent_kind: 'claude',
        settings_config: { attribution: { commit: '', pr: '' } },
      },
      deepDir,
    );
    expect(existsSync(join(deepDir, 'settings.json'))).toBe(true);
    // 清理嵌套目录（afterAll 只删 tmpDir 顶层，这里文件已在其下，recursive force 会带走）
  });
});

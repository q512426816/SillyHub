// tests/sillyspec-tool-mapping.test.ts
// 2026-10-09-workspace-init-skill-gate task-02 / FR-01 / D-004@v1：
// SILLYSPEC_VALID_TOOLS 补 zcode（7 值对齐 sillyspec CLI v3.32.2 VALID_TOOLS）后，
// mapDetectedToSillyspecTools 同名交集映射的白名单守卫——
//   - zcode 放行（v3.32.2 前被剔除，zcode 端 .zcode/skills 拿不到技能）
//   - 非 sillyspec 工具名的 provider 过滤
//   - 全不支持 → 空数组（兜底 ['claude'] 在 runSillyspecInit 层，本函数纯映射不兜底）
//
// @module sillyspec-tool-mapping.test

import { describe, expect, it } from 'vitest';

import {
  SILLYSPEC_VALID_TOOLS,
  mapDetectedToSillyspecTools,
} from '../src/task-runner/index.js';

describe('SILLYSPEC_VALID_TOOLS 白名单（D-004@v1 对齐 CLI v3.32.2）', () => {
  it('7 值且含 zcode', () => {
    expect(SILLYSPEC_VALID_TOOLS.size).toBe(7);
    expect([...SILLYSPEC_VALID_TOOLS].sort()).toEqual(
      ['claude', 'codex', 'cursor', 'gemini', 'openclaw', 'opencode', 'zcode'].sort(),
    );
  });
});

describe('mapDetectedToSillyspecTools 同名交集（task-02 / FR-01）', () => {
  it('zcode 放行 + 非 sillyspec 工具名过滤', () => {
    expect(
      mapDetectedToSillyspecTools(['claude', 'zcode', 'copilot']),
    ).toEqual(['claude', 'zcode']);
  });

  it('全不支持（12 provider 中非同名的 5 个）→ 空数组', () => {
    expect(
      mapDetectedToSillyspecTools([
        'copilot',
        'hermes',
        'pi',
        'kimi',
        'kiro',
        'antigravity',
      ]),
    ).toEqual([]);
  });

  it('空数组 → 空数组（兜底 claude 在 runSillyspecInit 层，本函数不兜底）', () => {
    expect(mapDetectedToSillyspecTools([])).toEqual([]);
  });

  it('顺序：交集保持探测顺序（filter 语义，不去重——探测源 per-provider 唯一）', () => {
    expect(
      mapDetectedToSillyspecTools(['gemini', 'claude', 'codex']),
    ).toEqual(['gemini', 'claude', 'codex']);
  });
});

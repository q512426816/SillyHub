// tests/interactive/thinking-levels.test.ts
// 2026-09-14-session-thinking-level task-02（FR-02 / D-002@v1）：共享词表 +
// 映射矩阵纯函数单测（落点参照同目录 usage-ctx.test.ts 风格）。
//
// 覆盖（任务卡 acceptance 四类，R-05 矩阵兜底）：
//   1. 全组合矩阵：四引擎（claude/pi/codex/cursor）× 七档 28 格表驱动逐格断言
//      （期望值与 design FR-02 矩阵逐格一致；undefined = 不携带档位字段）；
//   2. 降级规则显式四例：claude minimal→low、claude off→undefined、
//      codex max→xhigh、codex off→undefined；
//   3. 非法输入：未知 provider（任意未注册串）→ undefined；"ultra"/空串/
//      大小写变体 → mapPlatformLevelToEngine undefined + isValidPlatformLevel
//      =false；
//   4. 词表锁定：THINKING_LEVELS 长度 7 且顺序 off→max（as const 七档，
//      防三端镜像词表漂移）。
//
// 注：daemon 为 NodeNext ESM，相对 import 必须带 .js 后缀。

import { describe, it, expect } from 'vitest';
import {
  THINKING_LEVELS,
  isValidPlatformLevel,
  mapPlatformLevelToEngine,
} from '../../src/interactive/thinking-levels.js';

// 全组合期望矩阵（28 格 = 4 引擎 × 7 档；与 design FR-02 逐格一致——
// 真机验证不符时同步改 src 矩阵与本表各一格，R-05）。
const EXPECTED: Record<string, Record<string, string | undefined>> = {
  // EffortLevel 五档（sdk.d.ts:1735）：off→不设、minimal→low 降级、其余直传。
  claude: {
    off: undefined,
    minimal: 'low',
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'max',
  },
  // rpc.md:281-295 七档：全直传（off=真关思考）。
  pi: {
    off: 'off',
    minimal: 'minimal',
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'max',
  },
  // 0.147 二进制枚举五档 minimal..xhigh：off→不设、max→xhigh 降级、其余直传。
  codex: {
    off: undefined,
    minimal: 'minimal',
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'xhigh',
  },
  // caps.thinking_level=false——CLI 无通道，七档全 undefined（矩阵逐格声明）。
  cursor: {
    off: undefined,
    minimal: undefined,
    low: undefined,
    medium: undefined,
    high: undefined,
    xhigh: undefined,
    max: undefined,
  },
};

describe('task-02 thinking-levels（FR-02 七档词表+映射矩阵单源）', () => {
  describe('1. 全组合矩阵：四引擎 × 七档 28 格表驱动', () => {
    for (const [provider, row] of Object.entries(EXPECTED)) {
      for (const level of THINKING_LEVELS) {
        it(`${provider} × ${level} → ${row[level] ?? 'undefined'}`, () => {
          expect(mapPlatformLevelToEngine(provider, level)).toBe(row[level]);
        });
      }
    }

    it('表驱动覆盖数为 4 引擎 × 7 档 = 28 格（防期望表缺行漏格）', () => {
      expect(Object.keys(EXPECTED)).toHaveLength(4);
      for (const row of Object.values(EXPECTED)) {
        expect(Object.keys(row)).toHaveLength(THINKING_LEVELS.length);
      }
    });
  });

  describe('2. 降级规则显式四例（FR-02：off→不设、minimal→low、max→xhigh）', () => {
    it('claude minimal → low（EffortLevel 五档无 minimal，降级）', () => {
      expect(mapPlatformLevelToEngine('claude', 'minimal')).toBe('low');
    });

    it('claude off → undefined（不设 effort = 引擎默认思考通常开，非真关——P2-11）', () => {
      expect(mapPlatformLevelToEngine('claude', 'off')).toBeUndefined();
    });

    it('codex max → xhigh（0.147 二进制枚举无 max，降级）', () => {
      expect(mapPlatformLevelToEngine('codex', 'max')).toBe('xhigh');
    });

    it('codex off → undefined（不设 reasoningEffort = 引擎默认，非真关）', () => {
      expect(mapPlatformLevelToEngine('codex', 'off')).toBeUndefined();
    });

    it('对照：pi off → "off" 直传（真关思考，与 claude/codex 的 undefined 语义不同）', () => {
      // off 语义差异锚（P2-11）：同为平台 off，pi 真关、claude/codex 不设=默认。
      expect(mapPlatformLevelToEngine('pi', 'off')).toBe('off');
    });
  });

  describe('3. 非法输入（未知 provider / 词表外档位）', () => {
    it('未知 provider（任意未注册串 + 空串）× 任意档位 → undefined（不猜测直传）', () => {
      for (const provider of ['openai', 'some-engine', 'claude-code', '']) {
        for (const level of THINKING_LEVELS) {
          expect(mapPlatformLevelToEngine(provider, level)).toBeUndefined();
        }
      }
    });

    it('"ultra" 等词表外档位 → 三引擎全 undefined + isValidPlatformLevel=false', () => {
      for (const bad of ['ultra', '', 'none', 'off ', 'HIGH', 'High', 'hIGH', '0', '低']) {
        expect(isValidPlatformLevel(bad)).toBe(false);
        // 已知引擎 × 非法档 → 矩阵落空 undefined（含 pi 不透传非法串）。
        expect(mapPlatformLevelToEngine('claude', bad)).toBeUndefined();
        expect(mapPlatformLevelToEngine('pi', bad)).toBeUndefined();
        expect(mapPlatformLevelToEngine('codex', bad)).toBeUndefined();
        expect(mapPlatformLevelToEngine('cursor', bad)).toBeUndefined();
      }
    });
  });

  describe('4. 词表锁定（防三端镜像词表漂移）', () => {
    it('THINKING_LEVELS 长度 7 且顺序 off→max 锁定（as const 七档）', () => {
      expect(THINKING_LEVELS).toHaveLength(7);
      expect([...THINKING_LEVELS]).toEqual([
        'off',
        'minimal',
        'low',
        'medium',
        'high',
        'xhigh',
        'max',
      ]);
    });

    it('isValidPlatformLevel 七档全 true（词表逐项守卫，窄化入口自洽）', () => {
      for (const level of THINKING_LEVELS) {
        expect(isValidPlatformLevel(level)).toBe(true);
      }
    });
  });
});

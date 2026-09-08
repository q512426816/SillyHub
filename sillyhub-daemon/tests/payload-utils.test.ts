/**
 * tests/payload-utils.test.ts —— task-04 轻重构①定向测试（design §5 Wave 1 / FR-05）。
 *
 * 覆盖 src/payload-utils.ts 统一鸭子读取器的边界语义（undefined / 类型不符 /
 * 默认值 / 数组），并断言两个原模块（session-manager/helpers.ts 的 strOf/numOf、
 * task-runner/payload.ts 的 pickStr/pickNum/pickStrList/pickBudgetUsageSnapshot）
 * 保留同名导出转发到同一实现（导出面不变 + 实现收敛，行为零变化）。
 */

import { describe, expect, it } from 'vitest';

import {
  numOf,
  pickBudgetUsageSnapshot,
  pickNum,
  pickStr,
  pickStrList,
  strWithDefault,
} from '../src/payload-utils.js';
import {
  numOf as numOfFromHelpers,
  strOf,
} from '../src/interactive/session-manager/helpers.js';
import * as payloadMod from '../src/task-runner/payload.js';
import * as payloadUtilsMod from '../src/payload-utils.js';

// ── 单值守卫读取（session-manager strOf/numOf 口径）────────────────────────

describe('payload-utils strWithDefault（strOf 核心）', () => {
  it('string 原样返回', () => {
    expect(strWithDefault('hello', 'X')).toBe('hello');
    expect(strWithDefault('', 'X')).toBe(''); // 空串是合法 string（与 pickStr 的非空守卫不同）
  });

  it('undefined / null / 非字符串 → 默认值', () => {
    expect(strWithDefault(undefined, 'X')).toBe('X');
    expect(strWithDefault(null, 'X')).toBe('X');
    expect(strWithDefault(123, 'X')).toBe('X');
    expect(strWithDefault(true, 'X')).toBe('X');
    expect(strWithDefault(['a'], 'X')).toBe('X');
    expect(strWithDefault({ a: 1 }, 'X')).toBe('X');
  });

  it('helpers.strOf 固定默认值 \'\'（转发到 strWithDefault）', () => {
    expect(strOf('ok')).toBe('ok');
    expect(strOf(undefined)).toBe('');
    expect(strOf(null)).toBe('');
    expect(strOf(42)).toBe('');
    expect(strOf([])).toBe('');
  });
});

describe('payload-utils numOf（bool 排除；非 number → undefined）', () => {
  it('number 原样返回（含 NaN/Infinity——typeof 守卫不做有限性过滤，口径与 pickNum 不同）', () => {
    expect(numOf(0)).toBe(0);
    expect(numOf(1.5)).toBe(1.5);
    expect(numOf(Number.NaN)).toBeNaN(); // 原 helpers.numOf 语义：NaN 是 number
    expect(numOf(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
  });

  it('boolean 排除（typeof true !== \'number\'）', () => {
    expect(numOf(true)).toBeUndefined();
    expect(numOf(false)).toBeUndefined();
  });

  it('undefined / null / string / array → undefined', () => {
    expect(numOf(undefined)).toBeUndefined();
    expect(numOf(null)).toBeUndefined();
    expect(numOf('3')).toBeUndefined();
    expect(numOf([3])).toBeUndefined();
  });

  it('helpers.numOf 转发到同一实现（导出面不变）', () => {
    expect(numOfFromHelpers).toBe(payloadUtilsMod.numOf);
    expect(numOfFromHelpers(7)).toBe(7);
    expect(numOfFromHelpers('7')).toBeUndefined();
  });
});

// ── 多键挑选（task-runner pickStr/pickNum 口径）────────────────────────────

describe('payload-utils pickStr（多键名兜底 + 非空守卫）', () => {
  it('首键命中原样返回', () => {
    expect(pickStr({ workspace_dir: '/w' }, 'workspace_dir')).toBe('/w');
  });

  it('camelCase 优先，miss 后回落 snake_case', () => {
    const obj = { platformConfig: 'a', platform_config: 'b' };
    expect(pickStr(obj, 'platformConfig', 'platform_config')).toBe('a');
    expect(pickStr({ platform_config: 'b' }, 'platformConfig', 'platform_config')).toBe('b');
  });

  it('空串 / 非字符串视为 miss（继续试后续键，全 miss → undefined）', () => {
    expect(pickStr({ a: '', b: 'hit' }, 'a', 'b')).toBe('hit');
    expect(pickStr({ a: '', b: 0 }, 'a', 'b')).toBeUndefined();
    expect(pickStr({ a: 1, b: true }, 'a', 'b')).toBeUndefined();
    expect(pickStr({}, 'a')).toBeUndefined();
  });
});

describe('payload-utils pickNum（有限 number 守卫）', () => {
  it('finite number 命中（0 合法）', () => {
    expect(pickNum({ max_retries: 0 }, 'max_retries')).toBe(0);
    expect(pickNum({ timeoutSec: 1.5 }, 'timeoutSec', 'timeout_sec')).toBe(1.5);
  });

  it('NaN / Infinity 视为 miss（Number.isFinite 守卫，与 numOf 口径不同）', () => {
    expect(pickNum({ a: Number.NaN }, 'a', 'b')).toBeUndefined();
    expect(pickNum({ a: Number.POSITIVE_INFINITY }, 'a')).toBeUndefined();
  });

  it('bool / string-number / undefined miss → 回落 / undefined', () => {
    expect(pickNum({ a: true, b: 3 }, 'a', 'b')).toBe(3);
    expect(pickNum({ a: '3' }, 'a')).toBeUndefined();
    expect(pickNum({} as Record<string, unknown>, 'a', 'b')).toBeUndefined();
  });
});

describe('payload-utils pickStrList（ctx 鸭子读 string[]）', () => {
  it('camelCase 命中，数组纯 string 原样返回', () => {
    expect(pickStrList({ mcpRefs: ['a', 'b'] } as never, 'mcpRefs', 'mcp_refs')).toEqual(['a', 'b']);
  });

  it('snake_case 回落命中', () => {
    expect(pickStrList({ effective_allowed_roots: ['/x'] } as never, 'effectiveAllowedRoots', 'effective_allowed_roots')).toEqual(['/x']);
  });

  it('非 string 元素 / 空串元素被过滤；过滤后空 → undefined', () => {
    expect(pickStrList({ list: ['a', 1, null, '', 'b'] } as never, 'list', 'list_snake')).toEqual(['a', 'b']);
    expect(pickStrList({ list: ['', 2] } as never, 'list', 'list_snake')).toBeUndefined();
    expect(pickStrList({ list: [] } as never, 'list', 'list_snake')).toBeUndefined();
  });

  it('非数组 / 缺失 → undefined', () => {
    expect(pickStrList({ list: 'a' } as never, 'list', 'list_snake')).toBeUndefined();
    expect(pickStrList({} as never, 'list', 'list_snake')).toBeUndefined();
  });

  it('纯函数：不修改入参', () => {
    const ctx = { list: ['a', 1] } as { list: unknown[] };
    pickStrList(ctx as never, 'list', 'list_snake');
    expect(ctx.list).toEqual(['a', 1]);
  });
});

describe('payload-utils pickBudgetUsageSnapshot（仅 input+output）', () => {
  it('undefined stats → 全 0', () => {
    expect(pickBudgetUsageSnapshot(undefined)).toEqual({ input_tokens: 0, output_tokens: 0 });
  });

  it('合法 number 原样提取（cache_* 不参与）', () => {
    expect(
      pickBudgetUsageSnapshot({
        input_tokens: 10,
        output_tokens: 20,
        cache_read_tokens: 99,
      }),
    ).toEqual({ input_tokens: 10, output_tokens: 20 });
  });

  it('缺失 / 非法 number → 0（NaN / Infinity / bool / string）', () => {
    expect(pickBudgetUsageSnapshot({})).toEqual({ input_tokens: 0, output_tokens: 0 });
    expect(pickBudgetUsageSnapshot({ input_tokens: Number.NaN })).toEqual({ input_tokens: 0, output_tokens: 0 });
    expect(pickBudgetUsageSnapshot({ input_tokens: true, output_tokens: '5' })).toEqual({
      input_tokens: 0,
      output_tokens: 0,
    });
  });
});

// ── 收敛断言：payload.ts 同名导出转发到 payload-utils 同一实现 ───────────────

describe('task-runner/payload.ts 同名导出收敛（对外导出面不变）', () => {
  it('pickStr / pickNum / pickStrList / pickBudgetUsageSnapshot 与 payload-utils 是同一函数', () => {
    expect(payloadMod.pickStr).toBe(payloadUtilsMod.pickStr);
    expect(payloadMod.pickNum).toBe(payloadUtilsMod.pickNum);
    expect(payloadMod.pickStrList).toBe(payloadUtilsMod.pickStrList);
    expect(payloadMod.pickBudgetUsageSnapshot).toBe(payloadUtilsMod.pickBudgetUsageSnapshot);
  });

  it('intersectAllowedRoots 仍由 payload.ts 自持（非同构重复，不收敛——语义回归确认）', () => {
    expect(typeof payloadMod.intersectAllowedRoots).toBe('function');
    expect(payloadMod.intersectAllowedRoots(undefined, ['/a'])).toEqual(['/a']);
    expect(payloadMod.intersectAllowedRoots(['/a', '/b'], ['/a', '/c'])).toEqual(['/a']);
  });
});

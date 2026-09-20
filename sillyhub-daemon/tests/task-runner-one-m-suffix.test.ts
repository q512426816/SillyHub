// tests/task-runner-one-m-suffix.test.ts
// ql-20260921-001-8a4d（24h 审查修复）：batch（task 型 agent run）spawn 的 --model 补缀单测。
//
// 背景：ade38ec37（ql-20260920-004）给 one_m 补 [1m] 时只覆盖 interactive 两路
// （injector 规则 3 env ANTHROPIC_MODEL / driver-factory options.model），batch 路径
// 把 backend 下发的裸 model 经 stream-json claude 分支拼成 CLI `--model` 旗标——
// 显式旗标优先级最高，压掉 env 档位 → 1M 供应商跑批量任务仍按默认 200k 窗口
// ~160k 提前自动压缩（原 bug 复发）。本修复在 task-runner buildArgs 单点补缀
//（batchModelWithOneM，kind 守卫与 applyClaudeSettings 调用点同款）。
//
// 用例矩阵（纯函数直测，范式同 tests/interactive/session-manager-one-m-suffix.test.ts）：
//   - claude kind + 角色映射 one_m=true → 追加 [1m]
//   - one_m=false/undefined、无映射、pc 缺省/null → 裸名原样
//   - 已带 [1m] → 幂等原样
//   - codex/pi kind → 不应用（[1m] 是 Claude Code 专属约定）
//   - agent_kind 缺省（undefined）→ 视为 claude 应用
//   - model undefined → 透传 undefined（adapter 侧跳过 --model）

import { describe, it, expect } from 'vitest';
import { batchModelWithOneM } from '../src/task-runner.js';
import type { ProviderConfig } from '../src/types.js';

describe('ql-20260921-001-8a4d batchModelWithOneM（batch --model 补 [1m]）', () => {
  const pc = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({
    agent_kind: 'claude',
    model_role_mappings: {
      sonnet: { model: 'glm-5.3', one_m: true },
      opus: { model: 'glm-5.3', one_m: true },
    },
    ...over,
  });

  it('claude kind + 映射 one_m=true → 主模型追加 [1m]', () => {
    expect(batchModelWithOneM('glm-5.3', pc())).toBe('glm-5.3[1m]');
  });

  it('one_m=false / undefined → 裸名原样', () => {
    const noTick: ProviderConfig = {
      agent_kind: 'claude',
      model_role_mappings: { sonnet: { model: 'glm-5.3', one_m: false } },
    };
    expect(batchModelWithOneM('glm-5.3', noTick)).toBe('glm-5.3');
    const undefTick: ProviderConfig = {
      agent_kind: 'claude',
      model_role_mappings: { sonnet: { model: 'glm-5.3', one_m: undefined } },
    };
    expect(batchModelWithOneM('glm-5.3', undefTick)).toBe('glm-5.3');
  });

  it('无 model_role_mappings / pc=null/undefined → 裸名原样', () => {
    expect(batchModelWithOneM('glm-5.3', { agent_kind: 'claude' })).toBe('glm-5.3');
    expect(batchModelWithOneM('glm-5.3', null)).toBe('glm-5.3');
    expect(batchModelWithOneM('glm-5.3', undefined)).toBe('glm-5.3');
  });

  it('已带 [1m] → 幂等原样（不叠双缀）', () => {
    expect(batchModelWithOneM('glm-5.3[1m]', pc())).toBe('glm-5.3[1m]');
  });

  it('codex / pi kind → 不应用（即便映射命中）', () => {
    expect(batchModelWithOneM('glm-5.3', pc({ agent_kind: 'codex' }))).toBe('glm-5.3');
    expect(batchModelWithOneM('glm-5.3', pc({ agent_kind: 'pi' }))).toBe('glm-5.3');
  });

  it('agent_kind 缺省（undefined）→ 视为 claude 应用', () => {
    const implicit: ProviderConfig = pc({ agent_kind: undefined as unknown as string });
    expect(batchModelWithOneM('glm-5.3', implicit)).toBe('glm-5.3[1m]');
  });

  it('model undefined → 透传 undefined（adapter 跳过 --model）', () => {
    expect(batchModelWithOneM(undefined, pc())).toBeUndefined();
    expect(batchModelWithOneM(undefined, null)).toBeUndefined();
  });
});

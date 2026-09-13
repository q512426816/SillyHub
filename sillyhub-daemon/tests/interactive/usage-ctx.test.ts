// tests/interactive/usage-ctx.test.ts
// 2026-09-13-ctx-usage-all-providers task-01（FR-05 / D-001@v1）：共享 ctx 派生
// helper 纯函数单测（落点参照同目录 provider-registry.test.ts 风格）。
//
// 覆盖矩阵（任务卡 acceptance 四类分支）：
//   1. ctxTokensFromNetInput 全缺 → undefined（不伪造 0，消费侧缺键即跳过）
//   2. 部分缺 → 缺失分量按 0 计求和（仅 input / 仅 cacheRead+cacheCreation /
//      缺任一分量三种缺位形态）
//   3. 正常三和非零值（claude / pi / cursor 同式）
//   4. 0 为有效数据不视作缺失（入参 0 参与求和，走非 undefined 分支）
//   5. ctxTokensFromGrossInput 毛值直取（number 原值返回 / undefined 直通 /
//      0 有效值不视作缺失）
//
// 注：daemon 为 NodeNext ESM，相对 import 必须带 .js 后缀。

import { describe, it, expect } from 'vitest';
import {
  ctxTokensFromNetInput,
  ctxTokensFromGrossInput,
} from '../../src/interactive/usage-ctx.js';

describe('task-01 usage-ctx helper（design「接口定义」/ FR-05 口径单源）', () => {
  describe('ctxTokensFromNetInput（净值三和：input + cacheRead + cacheCreation）', () => {
    it('1. 全缺 → undefined（不伪造 0，事件缺键即未知态）', () => {
      expect(
        ctxTokensFromNetInput(undefined, undefined, undefined),
      ).toBeUndefined();
      // 零参调用等价全缺（可选入参形态，cursor 缺字段路径）。
      expect(ctxTokensFromNetInput()).toBeUndefined();
    });

    it('2a. 仅 input → cache 两维缺失按 0 计，直取 input', () => {
      expect(ctxTokensFromNetInput(1234, undefined, undefined)).toBe(1234);
    });

    it('2b. 仅 cacheRead + cacheCreation → input 缺失按 0 计，两维求和', () => {
      expect(ctxTokensFromNetInput(undefined, 8704, 120)).toBe(8824);
    });

    it('2c. 缺任一分量 → 该分量按 0 计（三种缺位形态逐一验证）', () => {
      // 缺 input。
      expect(ctxTokensFromNetInput(undefined, 100, 200)).toBe(300);
      // 缺 cacheRead。
      expect(ctxTokensFromNetInput(500, undefined, 200)).toBe(700);
      // 缺 cacheCreation。
      expect(ctxTokensFromNetInput(500, 100, undefined)).toBe(600);
    });

    it('3. 正常三和非零值', () => {
      // fixture 锚点数值（design 背景：cursor turn1 6578+8704=15282）。
      expect(ctxTokensFromNetInput(6578, 8704, 0)).toBe(15282);
      // pi manual-success-turn 末次调用 ctx=1800 形态（三和非零）。
      expect(ctxTokensFromNetInput(600, 1000, 200)).toBe(1800);
    });

    it('4. 0 为有效数据不视作缺失（入参 0 参与求和，非 undefined 分支）', () => {
      // input=0 单独存在 → 派生结果 0 是真实值而非伪造（pi numOr0 归一后
      // 错误轮全零 usage 的形态；Grill D-1：全零是该轮真实用量事实，有意口径）。
      expect(ctxTokensFromNetInput(0, undefined, undefined)).toBe(0);
      // 三分量全零 → 0（全缺分支不触发——0 非 undefined）。
      expect(ctxTokensFromNetInput(0, 0, 0)).toBe(0);
      // 0 与非零混合正常参与求和。
      expect(ctxTokensFromNetInput(0, 300, 50)).toBe(350);
    });
  });

  describe('ctxTokensFromGrossInput（毛值直取：codex last.inputTokens）', () => {
    it('5a. number → 原值返回（毛值已含 cached+cacheWrite，不加分量）', () => {
      expect(ctxTokensFromGrossInput(15418)).toBe(15418);
    });

    it('5b. undefined → undefined 直通（不伪造 0，ctx 保持未知态）', () => {
      expect(ctxTokensFromGrossInput(undefined)).toBeUndefined();
    });

    it('5c. 0 为有效值不视作缺失', () => {
      expect(ctxTokensFromGrossInput(0)).toBe(0);
    });
  });
});

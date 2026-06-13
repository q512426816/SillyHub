// tests/_sanity.test.ts
// 验证测试脚手架可用：vitest 能跑 + helpers 可 import + 边界契约成立。

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { loadFixture, loadLines, FIXTURES_DIR } from './helpers';

describe('test scaffolding sanity', () => {
  it('FIXTURES_DIR points to an existing directory', () => {
    expect(existsSync(FIXTURES_DIR)).toBe(true);
  });

  it('loadFixture throws on missing fixture (not silent empty)', () => {
    expect(() => loadFixture('does/not/exist.jsonl')).toThrow(/fixture not found/);
    expect(() => loadLines('does/not/exist.jsonl')).toThrow(/fixture not found/);
  });
});

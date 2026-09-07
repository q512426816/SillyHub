// tests/agent-log/liveness/registry.test.ts
// task-01（2026-09-07-agent-liveness-states / FR-01 + D-003@v1）：daemon liveness
// 基座单测——format → deriver 注册表查询入口 getDeriver + 纯函数约束守护。
//
// 覆盖 task-01 acceptance 全项：
//   LV1 getDeriver 对未注册 format 返回 null——含 'zcode-model-io-jsonl'
//      （deriver 注册归 task-02，本任务注册表为空，语义即 L0 mtime 兜底 only）
//   LV2 任意未知 / 空串 format 同样返回 null（纯映射查询恒不抛、无占位分支）
//   LV3 源码纯度守护：读 types.ts / registry.ts 源文本的 import 行，断言不含
//      node:fs / RpcError / ws-client（纯类型 + 纯映射零副作用，与既有
//      agent-log/registry.ts 同构）
//
// 风格对齐 tests/agent-log/read-agent-log-messages.test.ts 的 AL7 registry
// 单测（同款 getAgentLogParser null 语义断言形态）；源码纯度守护用真实 fs
// 读源文件（零 vi.mock，与既有 fixture 风格一致）。只扫 import 行而非全文——
// 实现模块头注释会以中文提及这些词（声明"不 import"），全文匹配会误报。

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getDeriver } from '../../../src/agent-log/liveness/registry.js';

const REGISTRY_SRC = fileURLToPath(
  new URL('../../../src/agent-log/liveness/registry.ts', import.meta.url),
);
const TYPES_SRC = fileURLToPath(
  new URL('../../../src/agent-log/liveness/types.ts', import.meta.url),
);

/** 提取源文本中的 import 行（trim 后以 'import ' 开头；注释行以 '*' 开头不命中）。 */
function importLines(source: string): string[] {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('import '));
}

describe('agent-log liveness registry — getDeriver（task-01）', () => {
  it("LV1: 未注册 format 返回 null（task-02 后 zcode 已注册——换用尚未注册 format 验证 L0 only 语义）", () => {
    expect(getDeriver('dsh-session-jsonl-zstd')).toBeNull();
  });

  it('LV2: 任意未知 / 空串 format 返回 null，恒不抛异常', () => {
    expect(getDeriver('claude-transcript-jsonl')).toBeNull();
    expect(getDeriver('pi-transcript-jsonl')).toBeNull();
    expect(getDeriver('screenshot-png')).toBeNull();
    expect(getDeriver('')).toBeNull();
  });

  it('LV3: types.ts / registry.ts 的 import 行不含 node:fs / RpcError / ws-client（纯类型 + 纯映射零副作用）', async () => {
    for (const src of [TYPES_SRC, REGISTRY_SRC]) {
      const imports = importLines(await readFile(src, 'utf8'));
      for (const line of imports) {
        expect(line, `${src} 不应 import node:fs（文件 IO 是 tailer/handler 职责）`).not.toContain('node:fs');
        expect(line, `${src} 不应引用 RpcError（错误通道不进注册表）`).not.toContain('RpcError');
        expect(line, `${src} 不应 import ws-client`).not.toContain('ws-client');
      }
    }
  });
});

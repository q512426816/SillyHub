/**
 * tests/agent-log/liveness/derive-zcode.test.ts —— zcode model-io deriver 单测。
 *
 * task-02（2026-09-07-agent-liveness-states / FR-01）：E-03 实证规则的 fixture
 * 对拍——记录 type 仅 `model_io`（每行一次完整模型请求/响应对，字段
 * startedAt/completedAt/response{toolCalls}），无 CLI 交互层事件 → 永不产
 * blocked（R-01 无正向证据）。fixture 全部手写内联，零真实文件 IO。
 */
import { describe, expect, it } from 'vitest';

import { deriveZcodeModelIo } from '../../../src/agent-log/liveness/derive-zcode-model-io.js';
import { getDeriver } from '../../../src/agent-log/liveness/registry.js';

const NOW = Date.parse('2026-09-07T10:00:00Z');
/** QUIET_MS=120s：新鲜窗口内 working、窗外 idle（design §5.1 L1 zcode 行）。 */
const FRESH = NOW - 30_000;
const STALE = NOW - 300_000;

function line(extra: Record<string, unknown>): string {
  return JSON.stringify({ type: 'model_io', startedAt: 't', completedAt: new Date(FRESH).toISOString(), response: { finishReason: 'tool_use', toolCalls: [] }, ...extra });
}

describe('deriveZcodeModelIo', () => {
  it('末行 completedAt 新鲜 → working（last_event=model_io）', () => {
    const out = deriveZcodeModelIo({ tail: `${line({})}\n`, prev: null, now: NOW });
    expect(out.state).toBe('working');
    expect(out.evidence).toBe('last_event=model_io');
  });

  it('末行 response.toolCalls 非空且无后续行 → 工具执行中 working（mtime 静默也算）', () => {
    const staleToolLine = line({ completedAt: new Date(STALE).toISOString(), response: { finishReason: 'tool_use', toolCalls: [{ name: 'Bash' }] } });
    const out = deriveZcodeModelIo({ tail: `${staleToolLine}\n`, prev: null, now: NOW });
    expect(out.state).toBe('working');
    expect(out.evidence).toBe('toolcalls_pending');
  });

  it('超 QUIET_MS 无新事件且无未配对 toolCalls → idle', () => {
    const out = deriveZcodeModelIo({ tail: `${line({ completedAt: new Date(STALE).toISOString() })}\n`, prev: null, now: NOW });
    expect(out.state).toBe('idle');
    expect(out.evidence).toBe('quiet>120s');
  });

  it('坏行跳过：尾部多行时取最后一条可解析记录判定', () => {
    const good = line({});
    const out = deriveZcodeModelIo({ tail: `{"broken json\n${good}\nnot-json-at-all\n`, prev: null, now: NOW });
    expect(out.state).toBe('working');
  });

  it('空尾部 / 全坏行 → unknown（empty_tail，交 L0 语义由 tailer 兜底）', () => {
    expect(deriveZcodeModelIo({ tail: '', prev: null, now: NOW }).state).toBe('unknown');
    expect(deriveZcodeModelIo({ tail: 'garbage\n', prev: null, now: NOW }).state).toBe('unknown');
  });

  it('R-01 回归：全部场景永不产 blocked（E-03 证伪定稿）', () => {
    const scenarios = [
      `${line({})}\n`,
      `${line({ completedAt: new Date(STALE).toISOString(), response: { toolCalls: [{ name: 'Bash' }] } })}\n`,
      `${line({ completedAt: new Date(STALE).toISOString() })}\n`,
      '',
    ];
    for (const tail of scenarios) {
      expect(deriveZcodeModelIo({ tail, prev: null, now: NOW }).state).not.toBe('blocked');
    }
  });

  it('注册行生效：getDeriver("zcode-model-io-jsonl") 返回本 deriver（key 与落库串逐字一致）', () => {
    expect(getDeriver('zcode-model-io-jsonl')).toBe(deriveZcodeModelIo);
  });
});

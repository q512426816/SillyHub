// tests/interactive/golden/claude-events-golden.test.ts
// 2026-09-03-agent-provider-abstraction task-12：golden 三源对照（daemon 侧）。
//
// 三源（同一 fixture 驱动，快照文件入库防实现回归漂移）：
//   源1 golden-session.json        —— 真实形状 SDK 消息序列（双 turn / Task 子代理
//       depth 嵌套 / Edit structuredPatch / partial 流+override / 中途与终态 usage /
//       system/init，内容复用 task-03 三组 fixture 的帧拼接，脱敏）。
//   源2 golden-session.events.json —— ClaudeEventNormalizer 对源1 的完整事件流快照
//       （含 partial flush；R-01 验收锚：本文件 §1 逐帧锁定）。
//   源3 golden-session.legacy-extract.json —— backend _extract_sdk_messages 对源1
//       完整帧的展开行快照（旧链路语义锚；R-06 两份实现一致性：本文件 §3 以
//       task-03 对齐规则把源2 事件映射回旧轨行形，与源3 逐字段对照等价）。
//
// 覆盖（task-12 任务卡）：
//   §1 事件序列快照——is_partial/override/depth/usage.ctx_tokens/subtype 全字段逐帧断言；
//   §2 zod 契约——全部产出事件（含 partial）过 safeParseAgentEvent；
//   §3 旧链路联合语义对照——完整消息帧子集上「每 block 一事件」≡「1-2 条 flat 行」；
//   §4 partial→override→撤回链——同 segment：partial*（多段）→ override 完整内容，
//      override 后该 segment 无任何后续事件。
//
// 驱动协议（与快照生成时一致，见 golden-session.events.json 头注）：
//   假时钟每帧 +100ms；帧 4/26 处理后各推进 500ms（500ms 节流中途 flush）；
//   帧 22/37（result 终态）后 onTurnEnd()；末尾 dispose()。

import { describe, it, expect, afterEach, vi } from 'vitest';

import { ClaudeEventNormalizer } from '../../../src/interactive/claude-events.js';
import { safeParseAgentEvent } from '../../../src/agent-event-schema.js';
import type { AgentEvent } from '../../../src/types.js';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { loadFixture } from '../../helpers';

/** golden fixture 三件套（同目录）。 */
const GOLDEN_DIR = 'claude-sdk-messages';
const CONTENT_TYPES = new Set(['text', 'thinking', 'tool_use', 'tool_result']);

interface GoldenFrame {
  frame: number;
  partials: AgentEvent[];
  events: AgentEvent[];
}

interface GoldenEventsDoc {
  advance_after_frames: number[];
  advance_ms: number;
  turn_end_frames: number[];
  frames: GoldenFrame[];
}

interface LegacyRow {
  event_type?: string;
  content?: string;
  channel?: string;
  metadata?: Record<string, unknown>;
  usage?: Record<string, unknown>;
  session_id?: string;
  parent_tool_use_id?: string;
  subagent_type?: string;
  depth?: number;
  tool_kind?: string | null;
  tool_use_id?: string;
  edit_patch?: string;
  tc_payload?: Record<string, unknown>;
}

function loadSession(): SDKMessage[] {
  return JSON.parse(
    loadFixture(`${GOLDEN_DIR}/golden-session.json`),
  ) as SDKMessage[];
}

function loadEventsGolden(): GoldenEventsDoc {
  return JSON.parse(
    loadFixture(`${GOLDEN_DIR}/golden-session.events.json`),
  ) as GoldenEventsDoc;
}

function loadLegacyGolden(): Map<number, LegacyRow[]> {
  const doc = JSON.parse(
    loadFixture(`${GOLDEN_DIR}/golden-session.legacy-extract.json`),
  ) as { frames: Array<{ frame: number; rows: LegacyRow[] }> };
  return new Map(doc.frames.map((f) => [f.frame, f.rows]));
}

/** 按快照驱动协议跑 normalizer，产出逐帧 {partials, events} 实测流。 */
function driveNormalizer(
  msgs: SDKMessage[],
  advanceAfter: number[],
  advanceMs: number,
  turnEndFrames: number[],
): GoldenFrame[] {
  const partials: AgentEvent[] = [];
  let clock = 0;
  const norm = new ClaudeEventNormalizer({
    onPartialFlush: (ev) => partials.push(ev),
    now: () => clock,
  });
  const frames: GoldenFrame[] = [];
  msgs.forEach((msg, i) => {
    clock += 100;
    partials.length = 0;
    const events = norm.normalizeMessage(msg);
    if (advanceAfter.includes(i)) {
      vi.advanceTimersByTime(advanceMs);
    }
    frames.push({ frame: i, partials: [...partials], events });
    if (turnEndFrames.includes(i)) {
      norm.onTurnEnd();
    }
  });
  norm.dispose();
  return frames;
}

/** 深度排序键（JSON 语义化比较用——py 空格 vs js 紧凑的格式差异归一）。 */
function sortedDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortedDeep);
  if (v && typeof v === 'object') {
    const rec = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(rec).sort()) {
      out[k] = sortedDeep(rec[k]);
    }
    return out;
  }
  return v;
}

/**
 * 旧轨行语义化（canon）——把 golden-session.legacy-extract.json 行与事件映射行
 * 归一到可比形态：
 *   - tool_call 行：content 为 tc_payload JSON（快照已剥 timestamp 存对象），排序比较；
 *   - stdout [TOOL_USE] 行：args 部分可解析 JSON 时语义化（旧轨 py json.dumps 带
 *     空格 vs 新轨事件 content 为 JSON.stringify 紧凑格式——语义等价，格式差异
 *     见任务报告「已知格式级差异」；此处归一后比较）；
 *   - usage：SDK 全名（cache_read_input_tokens）→ 短名（cache_read_tokens，daemon.ts
 *     lift 层等价映射）；
 *   - edit_patch：解析后语义化比较（同上格式差异）。
 */
function canonRow(row: LegacyRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  out['event_type'] = row.event_type;
  out['channel'] = row.channel;
  if (row.channel === 'tool_call') {
    if (row.tc_payload !== undefined) {
      out['tc_payload'] = sortedDeep(row.tc_payload);
    }
  } else if (typeof row.content === 'string' && row.content.startsWith('[TOOL_USE] ')) {
    const m = row.content.match(/^\[TOOL_USE\] ([^:]+): ([\s\S]*)$/);
    if (m) {
      let argsPart = m[2]!;
      if (argsPart.startsWith('{') || argsPart.startsWith('[')) {
        try {
          argsPart = JSON.stringify(sortedDeep(JSON.parse(argsPart)));
        } catch {
          // 非 JSON（Bash command 优先展示分支）原样
        }
      }
      out['content'] = `[TOOL_USE] ${m[1]}: ${argsPart}`;
    } else {
      out['content'] = row.content;
    }
  } else {
    out['content'] = row.content ?? null;
  }
  if (row.usage && typeof row.usage === 'object') {
    const u = row.usage;
    const cu: Record<string, unknown> = {};
    if (u['input_tokens'] !== undefined) cu['input_tokens'] = u['input_tokens'];
    if (u['output_tokens'] !== undefined) cu['output_tokens'] = u['output_tokens'];
    const cr = u['cache_read_tokens'] ?? u['cache_read_input_tokens'];
    const cc = u['cache_creation_tokens'] ?? u['cache_creation_input_tokens'];
    if (cr !== undefined) cu['cache_read_tokens'] = cr;
    if (cc !== undefined) cu['cache_creation_tokens'] = cc;
    out['usage'] = cu;
  }
  for (const k of [
    'session_id',
    'parent_tool_use_id',
    'subagent_type',
    'depth',
    'tool_use_id',
    'tool_kind',
  ] as const) {
    const v = (row as Record<string, unknown>)[k];
    if (v !== undefined && v !== null) out[k] = v;
  }
  if (typeof row.edit_patch === 'string') {
    out['edit_patch_parsed'] = sortedDeep(JSON.parse(row.edit_patch));
  }
  if (row.metadata && typeof row.metadata === 'object') {
    out['metadata'] = sortedDeep(row.metadata);
  }
  return out;
}

/**
 * 事件 → 旧轨 flat 行映射（task-03 已验证的对齐规则）：
 *   text       → 1× [ASSISTANT] 行（metadata segmentId+isComplete）
 *   thinking   → 1× [THINKING] 行（metadata thinking+segmentId+isComplete）
 *   tool_use   → 2× [TOOL_USE] stdout 行 + tool_call tc_payload 行
 *   tool_result→ 1× [TOOL_RESULT] 行（tool_use_id/edit_patch）
 * override 事件 = 旧轨「完整行 + 尾随信号行」的合并（信号行是瞬时 SSE 语义，
 * 不落历史，映射侧只产完整行——任务卡口径）；归属三列注入每行；usage/session_id
 * 由调用方 stamp 到首行（service.py:3524-3544 stamp 语义）。
 */
function mapEventToLegacyRows(ev: AgentEvent): LegacyRow[] {
  const attribution: Record<string, unknown> = {};
  if (ev.parent_tool_use_id) attribution['parent_tool_use_id'] = ev.parent_tool_use_id;
  if (ev.subagent_type) attribution['subagent_type'] = ev.subagent_type;
  if (typeof ev.depth === 'number') attribution['depth'] = ev.depth;

  if (ev.type === 'text') {
    const row: LegacyRow = {
      event_type: 'text',
      content: `[ASSISTANT] ${ev.content}`,
      channel: 'stdout',
      ...attribution,
    };
    if (ev.segment_id) {
      row.metadata = { segmentId: ev.segment_id, isComplete: true };
    }
    return [row];
  }
  if (ev.type === 'thinking') {
    return [
      {
        event_type: 'text',
        content: `[THINKING] ${ev.content}`,
        channel: 'stdout',
        metadata: {
          thinking: true,
          segmentId: ev.segment_id,
          isComplete: true,
        },
        ...attribution,
      },
    ];
  }
  if (ev.type === 'tool_use') {
    // args：content 为归一化器 JSON.stringify 的入参原文（service.py:3618-3626
    // 旧轨同规则——command 优先展示，否则整体 JSON）。
    let inputObj: Record<string, unknown> = {};
    try {
      const parsed: unknown = ev.content ? JSON.parse(ev.content) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        inputObj = parsed as Record<string, unknown>;
      }
    } catch {
      // 解析失败退化空 args（旧轨 json.dumps 失败退化 "" 同口径）
    }
    const cmd =
      typeof inputObj['command'] === 'string' ? (inputObj['command'] as string) : '';
    const argsLine = cmd || ev.content;
    const toolKind =
      ev.metadata && typeof ev.metadata['tool_kind'] === 'string'
        ? (ev.metadata['tool_kind'] as string)
        : null;
    const tcPayload: Record<string, unknown> = {
      tool: ev.tool_name,
      args: inputObj,
      status: 'allowed',
      success: true,
    };
    if (ev.call_id) tcPayload['tool_use_id'] = ev.call_id;
    const tcRow: LegacyRow = {
      event_type: 'tool_use',
      channel: 'tool_call',
      tool_kind: toolKind,
      ...(ev.call_id ? { tool_use_id: ev.call_id } : {}),
      ...(Object.keys(tcPayload).length > 0 ? { tc_payload: tcPayload } : {}),
      ...attribution,
    };
    return [
      {
        event_type: 'tool_use',
        content: `[TOOL_USE] ${ev.tool_name}: ${argsLine}`.slice(0, 20000),
        channel: 'stdout',
        ...attribution,
      },
      tcRow,
    ];
  }
  if (ev.type === 'tool_result') {
    const row: LegacyRow = {
      event_type: 'tool_result',
      content: `[TOOL_RESULT] ${ev.content}`,
      channel: 'stdout',
      ...(ev.call_id ? { tool_use_id: ev.call_id } : {}),
      ...(ev.edit_patch ? { edit_patch: ev.edit_patch } : {}),
      ...attribution,
    };
    return [row];
  }
  return [];
}

afterEach(() => {
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// §1 事件序列快照（R-01 验收锚：fixture → normalizer ≡ golden events）
// ─────────────────────────────────────────────────────────────────────────────

describe('golden 事件序列快照', () => {
  it('逐帧 partials+events 与 golden-session.events.json 逐字段一致', () => {
    const golden = loadEventsGolden();
    const msgs = loadSession();
    expect(msgs.length).toBe(golden.frames.length);

    vi.useFakeTimers();
    const frames = driveNormalizer(
      msgs,
      golden.advance_after_frames,
      golden.advance_ms,
      golden.turn_end_frames,
    );
    vi.useRealTimers();

    expect(frames).toEqual(golden.frames);
  });

  it('关键语义锚点抽查（防快照整体替换掩盖字段级回归）', () => {
    const golden = loadEventsGolden();
    const byFrame = new Map(golden.frames.map((f) => [f.frame, f]));

    // 帧 0：system/init → status/session_started（subtype + session_id + metadata）。
    expect(byFrame.get(0)!.events[0]).toMatchObject({
      type: 'status',
      subtype: 'session_started',
      session_id: 'sess-sample-0003',
    });
    // 帧 4：节流中途 flush 的 thinking partial（无 usage——message_delta 未到）。
    expect(byFrame.get(4)!.partials[0]).toMatchObject({
      type: 'thinking',
      is_partial: true,
      segment_id: 'main:msg_t1_m1:thinking',
    });
    expect(byFrame.get(4)!.partials[0]!.usage).toBeUndefined();
    // 帧 7：message_stop 边界 flush 携带中途 usage（含 ctx_tokens，D-003/D-005）。
    expect(byFrame.get(7)!.partials[0]!.usage).toEqual({
      input_tokens: 100,
      output_tokens: 50,
      cache_read_tokens: 500,
      cache_creation_tokens: 0,
      ctx_tokens: 600,
    });
    // 帧 8：override 事件（D-004）——终态 usage（无 ctx）+ session_id + depth 0。
    expect(byFrame.get(8)!.events[0]).toMatchObject({
      override: true,
      depth: 0,
      usage: { input_tokens: 100, output_tokens: 50, cache_read_tokens: 500 },
      session_id: 'sess-sample-0003',
    });
    // 帧 15：轮级累计 usage（input 100+320 / output 50+120）+ ctx 重建 320+700+64。
    expect(byFrame.get(15)!.partials[0]!.usage).toEqual({
      input_tokens: 420,
      output_tokens: 170,
      cache_read_tokens: 700,
      cache_creation_tokens: 64,
      ctx_tokens: 1084,
    });
    // 帧 16：会话信号先行 + override 文本 + 双 tool_use；usage 盖章首条内容事件。
    const f16 = byFrame.get(16)!.events;
    expect(f16.map((e) => `${e.type}:${e.subtype ?? ''}`)).toEqual([
      'status:bash_status',
      'status:agent_task_status',
      'text:',
      'tool_use:',
      'tool_use:',
    ]);
    expect(f16[2]).toMatchObject({ override: true });
    expect(f16[2]!.usage).toEqual({
      input_tokens: 320,
      output_tokens: 120,
      cache_read_tokens: 700,
      cache_creation_tokens: 64,
    });
    expect(f16[4]).toMatchObject({ tool_name: 'Task', depth: 0 });
    // 帧 17：bash 终态配对（elapsed 由注入时钟确定性 = 100ms）。
    expect(byFrame.get(17)!.events[1]).toMatchObject({
      type: 'status',
      subtype: 'bash_status',
      metadata: { status: 'completed', exit_code: 0, elapsed_ms: 100 },
    });
    // 帧 18/34：子代理归属（depth 1）与嵌套孙代（depth 2）。
    expect(byFrame.get(18)!.events[0]).toMatchObject({
      parent_tool_use_id: 'toolu_task01',
      subagent_type: 'general-purpose',
      depth: 1,
    });
    expect(byFrame.get(34)!.events[0]).toMatchObject({
      parent_tool_use_id: 'toolu_task03',
      depth: 2,
    });
    // 帧 31：Edit structuredPatch → edit_patch JSON。
    expect(typeof byFrame.get(31)!.events[0]!.edit_patch).toBe('string');
    expect(JSON.parse(byFrame.get(31)!.events[0]!.edit_patch!)).toEqual(
      JSON.parse(byFrame.get(31)!.events[0]!.edit_patch!),
    );
    // 帧 36：turn 2 终态 usage 全字段。
    expect(byFrame.get(36)!.events[0]!.usage).toEqual({
      input_tokens: 2000,
      output_tokens: 60,
      cache_read_tokens: 8000,
      cache_creation_tokens: 512,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 zod 契约（全部产出事件过 safeParseAgentEvent）
// ─────────────────────────────────────────────────────────────────────────────

describe('golden 事件流 zod 契约', () => {
  it('快照内全部事件（含 partial）均通过 safeParseAgentEvent', () => {
    const golden = loadEventsGolden();
    const all: AgentEvent[] = [];
    for (const f of golden.frames) {
      all.push(...f.partials, ...f.events);
    }
    expect(all.length).toBeGreaterThan(0);
    for (const ev of all) {
      const parsed = safeParseAgentEvent(ev);
      if (!parsed.success) {
        expect(
          JSON.stringify(parsed.error.issues),
          `event failed zod: ${JSON.stringify(ev)}`,
        ).toBe('[]');
      }
      expect(parsed.success).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 旧链路联合语义对照（R-06：normalizer 事件 ≡ _extract_sdk_messages 展开行）
// ─────────────────────────────────────────────────────────────────────────────

describe('golden 旧链路联合语义对照', () => {
  it('完整消息帧子集：事件映射行 ≡ legacy-extract 快照行（逐字段）', () => {
    const golden = loadEventsGolden();
    const legacy = loadLegacyGolden();

    for (const [frame, rows] of legacy) {
      const f = golden.frames.find((g) => g.frame === frame)!;
      const contentEvents = f.events.filter((e) => CONTENT_TYPES.has(e.type));
      // usage/session_id stamp：帧内首条内容事件携带（service.py:3524-3544）。
      const firstEv = contentEvents.find((e) => e.usage || e.session_id);

      const mapped: LegacyRow[] = [];
      for (const ev of contentEvents) {
        const rowsOf = mapEventToLegacyRows(ev);
        if (ev === firstEv && rowsOf.length > 0) {
          if (ev.usage) rowsOf[0]!.usage = { ...ev.usage };
          if (ev.session_id) rowsOf[0]!.session_id = ev.session_id;
        }
        mapped.push(...rowsOf);
      }

      const mappedCanon = mapped.map(canonRow);
      const legacyCanon = rows.map(canonRow);
      expect(mappedCanon, `frame ${frame}`).toEqual(legacyCanon);
    }
  });

  it('legacy 快照覆盖面：三个 partial 段 + 全部完整内容帧都在锚定范围', () => {
    const legacy = loadLegacyGolden();
    // 双 turn 全部完整内容帧（fixture 帧序号，见 golden-session.json 头注）。
    expect([...legacy.keys()]).toEqual([
      8, 16, 17, 18, 19, 20, 21, 30, 31, 32, 33, 34, 35, 36,
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 partial→override→撤回链（D-004@v1：同 segment partial* → override 完整）
// ─────────────────────────────────────────────────────────────────────────────

describe('golden partial→override 撤回链', () => {
  it('同 segment：partial*（多段）先于 override，override 内容 = partial 拼接，其后无残留事件', () => {
    const golden = loadEventsGolden();
    // 按（帧序，帧内 partial 先于返回事件）合成总流。
    const stream: AgentEvent[] = [];
    for (const f of golden.frames) {
      stream.push(...f.partials, ...f.events);
    }
    const order = new Map<AgentEvent, number>();
    stream.forEach((ev, i) => order.set(ev, i));

    const segments = [
      'main:msg_t1_m1:thinking', // 节流中途 + 边界两段 partial（partial* 链）
      'main:msg_t1_m2:text', // 仅 message_stop 边界一段
      'main:msg_t2_m1:text', // turn 2：节流中途 + 边界两段
    ];
    for (const seg of segments) {
      const related = stream.filter((ev) => ev.segment_id === seg);
      const partials = related.filter((ev) => ev.is_partial === true);
      const overrides = related.filter((ev) => ev.override === true);
      expect(partials.length, `${seg} partial 段数`).toBeGreaterThanOrEqual(1);
      expect(overrides.length, `${seg} override 恰一条`).toBe(1);
      const overrideEv = overrides[0]!;
      const overrideIdx = order.get(overrideEv)!;
      // 全部 partial 严格先于 override；override 后该 segment 无任何事件。
      for (const p of partials) {
        expect(order.get(p)!, `${seg} partial 先于 override`).toBeLessThan(overrideIdx);
      }
      const lastIdx = Math.max(...related.map((ev) => order.get(ev)!));
      expect(lastIdx, `${seg} override 是该 segment 最后一个事件`).toBe(overrideIdx);
      // override 承载完整内容 = partial 分段拼接（撤回后半截渲染的完整性语义）。
      const joined = partials.map((p) => p.content).join('');
      expect(overrideEv.content, `${seg} override 内容 = partial 拼接`).toBe(joined);
      // override 事件自身不得再带 is_partial（撤回语义，非半截）。
      expect(overrideEv.is_partial).toBeUndefined();
    }
  });
});

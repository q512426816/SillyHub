/**
 * AgentEvent v2 的 zod 运行时校验 schema（zod v4）。
 *
 * 职责：与 src/types.ts 的 AgentEvent 接口一字段对齐的运行时校验，
 *       供信任边界（daemon 上报 / backend 落库前的形态校验 / golden 对照测试）
 *       做解析与防御。types.ts 保持纯类型文件（见其文件头约束），zod 一律落本文件。
 *
 * 出处：2026-09-03-agent-provider-abstraction task-01 / design.md §7。
 *
 * 行为约定：
 *   - 顶层未知键在 parse 时剥离（开放长尾一律进 metadata，顶层字段封闭枚举）；
 *   - type='status' 时 subtype 必填（superRefine 交叉校验，issue path 指向 ['subtype']）；
 *   - 字段集合与 AgentEvent 接口的一致性由 tests/agent-event-schema.test.ts
 *     （类型层 expectTypeOf + 运行时对象键断言）守护。
 */

import { z } from 'zod';

import type { AgentEvent } from './types.js';

/** type 字段合法值（与 types.ts AgentEventType 一字面对齐，顺序一致）。 */
const AGENT_EVENT_TYPES = [
  'text',
  'thinking',
  'tool_use',
  'tool_result',
  'status',
  'error',
  'turn_result',
  'complete',
] as const;

/** subtype 字段合法值（与 types.ts AgentStatusSubtype 一字面对齐，顺序一致）。
 * thinking_tokens 为 D-005@v1 契约补遗新增（task-03 双轨可见性对齐）。 */
const AGENT_STATUS_SUBTYPES = [
  'session_started',
  'bash_chunk',
  'bash_status',
  'plan_mode',
  'agent_task_status',
  'task_notification',
  'thinking_tokens',
] as const;

/** usage 子对象 schema（与 types.ts AgentEventUsage 对齐，字段全可选）。
 * ctx_tokens（上下文环分子）为 D-005@v1 契约补遗新增。 */
const agentEventUsageSchema = z.object({
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  cache_read_tokens: z.number().optional(),
  cache_creation_tokens: z.number().optional(),
  ctx_tokens: z.number().optional(),
});

/**
 * AgentEvent 运行时校验 schema（zod v4）。
 * z.infer 与 types.ts 的 AgentEvent 接口一字段一致（测试断言守护）。
 */
export const agentEventSchema = z
  .object({
    type: z.enum(AGENT_EVENT_TYPES),
    content: z.string(),
    subtype: z.enum(AGENT_STATUS_SUBTYPES).optional(),
    seq: z.number().optional(),
    tool_name: z.string().optional(),
    call_id: z.string().optional(),
    session_id: z.string().optional(),
    usage: agentEventUsageSchema.optional(),
    parent_tool_use_id: z.string().optional(),
    subagent_type: z.string().optional(),
    depth: z.number().optional(),
    segment_id: z.string().optional(),
    is_partial: z.boolean().optional(),
    override: z.boolean().optional(),
    edit_patch: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((ev, ctx) => {
    // 交叉字段校验：type='status' 时 subtype 必填（design.md §7）。
    // issue path 指向 ['subtype']，便于上层按路径定位报错字段。
    if (ev.type === 'status' && ev.subtype === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['subtype'],
        message: "type='status' 的事件必须携带 subtype（AgentStatusSubtype）",
      });
    }
  });

/** safeParseAgentEvent 的返回形态（success 分支 data 已收窄为 AgentEvent）。 */
export type SafeParseAgentEventResult =
  | { success: true; data: AgentEvent }
  | { success: false; error: z.ZodError };

/**
 * 解析并校验一条 AgentEvent（严格版）。
 *
 * 非法输入抛 zod v4 ZodError：.issues[] 各项含 path（字段路径）与 message；
 * 顶层未知键被剥离（不透传）。合法时返回收窄为 AgentEvent 的对象。
 */
export function parseAgentEvent(input: unknown): AgentEvent {
  return agentEventSchema.parse(input);
}

/**
 * 解析并校验一条 AgentEvent（安全版，不抛异常）。
 * 合法 → { success: true, data }；非法 → { success: false, error: ZodError }
 * （error.issues[] 各项含 path / message，可用于上层容错记录）。
 */
export function safeParseAgentEvent(input: unknown): SafeParseAgentEventResult {
  return agentEventSchema.safeParse(input);
}

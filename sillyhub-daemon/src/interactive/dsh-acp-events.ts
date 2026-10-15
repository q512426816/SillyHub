/**
 * dsh-acp-events.ts —— ACP session/update 通知 → AgentEvent 归一化器。
 *
 * 2026-10-15-dsh-engine-acp task-02（D-003 方案 A：自研 ACP 驱动，协议帧走
 * adapters/json-rpc.ts；本文件只做纯映射，spawn/握手/轮次归 dsh-acp-driver.ts）。
 *
 * 线格式事实源：dsh 仓库 packages/acp/acp/src/updates.ts（服务端实际产出的
 * SessionUpdate 结构）——
 *   agent_thought_chunk { messageId, content: {type:'text', text} }
 *   agent_message_chunk { messageId, content: {type:'text'|'image'|'resource_link', …} }
 *   tool_call           { toolCallId, title, kind, status:'in_progress', rawInput }
 *   tool_call_update    { toolCallId, status:'completed'|'failed', content:[{type:'content', content}] }
 *   usage_update        { used, size }
 * plans / modes / elicitation 为 ACP 明示 unsupported，不在此列；config_option_update
 * 等非本轮语义类型按未知类型安全忽略（dsh alpha 前向演进不炸）。
 *
 * 映射要点：
 * - image 块不产出事件——caps.multimodal=false（dsh ACP 图片依赖 durable
 *   attachment store + exact route，design R-08 保守降级），图片本就不进 dsh 会话；
 * - resource_link 保持 dsh 侧模型可见形态（方括号引用行）落 text；
 * - usage_update 用「usage-only 空事件」载体（type=text + content=''）——pi
 *   buildUsageEvent / codex usage_update 同款（session-manager _liftSessionUsage
 *   识别该形态）；ACP 只报上下文占用（used/size），映射 ctx_tokens=used，
 *   input/output 拆分 ACP 不提供，不编造。
 */

import type { AgentEvent } from '../types.js';

/** ACP session/update 通知的最小结构视图（宽容形状：未知键透传忽略）。 */
export interface AcpSessionUpdate {
  /** update 变体名（sessionUpdate 字段）。 */
  sessionUpdate: string;
  /** agent_message_chunk / agent_thought_chunk 的消息锚。 */
  messageId?: string;
  /** 消息/思考的内容块。 */
  content?: {
    type: string;
    text?: string;
    name?: string;
    uri?: string;
    [key: string]: unknown;
  };
  /** 工具生命周期 ID（tool_call / tool_call_update 配对键）。 */
  toolCallId?: string;
  /** 工具显示名（tool_call.title）。 */
  title?: string;
  kind?: string;
  status?: string;
  /** 工具入参（JSON 值或模型坏输出的原文）。 */
  rawInput?: unknown;
  /** usage_update：上下文占用分子。 */
  used?: number;
  /** usage_update：上下文窗口分母。 */
  size?: number;
  [key: string]: unknown;
}

/**
 * 归一化单条 session/update 通知为 0..n 条 AgentEvent。
 *
 * 纯函数：无 IO、无状态、不抛错——未知 sessionUpdate 类型返回 []（调用方
 * 继续消费后续通知流），畸形字段按缺省值处理（tool_result 无 content 产出
 * 空文本，保证 call_id 配对不悬空）。
 */
export function normalizeAcpUpdate(update: AcpSessionUpdate): AgentEvent[] {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      return agentMessageChunk(update);
    case 'agent_thought_chunk':
      return agentThoughtChunk(update);
    case 'tool_call':
      return toolCall(update);
    case 'tool_call_update':
      return toolCallUpdate(update);
    case 'usage_update':
      return usageUpdate(update);
    default:
      // 未知类型安全忽略（config_option_update / plan / current_mode_update /
      // dsh 未来新增变体）——前向兼容 alpha 演进。
      return [];
  }
}

function agentMessageChunk(update: AcpSessionUpdate): AgentEvent[] {
  const block = update.content;
  if (block === undefined) return [];
  if (block.type === 'text') {
    return [
      {
        type: 'text',
        content: block.text ?? '',
        metadata: { message_id: update.messageId },
      },
    ];
  }
  if (block.type === 'resource_link') {
    return [
      {
        type: 'text',
        content: `[resource_link] ${block.name ?? ''} ${block.uri ?? ''}`.trimEnd(),
        metadata: { message_id: update.messageId },
      },
    ];
  }
  // image 等非文本块：multimodal=false 口径下不产出（见文件头注释）。
  return [];
}

function agentThoughtChunk(update: AcpSessionUpdate): AgentEvent[] {
  const text = update.content?.text ?? '';
  // dsh 侧空文本 thought 不发（updates.ts:25-29），此处防御同语义。
  if (text.length === 0) return [];
  return [
    {
      type: 'thinking',
      content: text,
      metadata: { message_id: update.messageId },
    },
  ];
}

function toolCall(update: AcpSessionUpdate): AgentEvent[] {
  const rawInput = update.rawInput;
  // rawInput 可能是 JSON 值（对象/数组/原始类型）或模型坏输出的原文
  // （dsh parseToolArguments 的 opaque 保留分支）——原文非 JSON 时直接用字符串。
  const content =
    typeof rawInput === 'string' ? rawInput : JSON.stringify(rawInput ?? {});
  return [
    {
      type: 'tool_use',
      content,
      tool_name: update.title ?? '',
      call_id: update.toolCallId ?? '',
    },
  ];
}

function toolCallUpdate(update: AcpSessionUpdate): AgentEvent[] {
  const blocks = Array.isArray(update.content) ? update.content : [];
  const text = blocks
    .map((entry) => {
      const inner = (entry as { content?: { text?: string } }).content;
      return inner?.text ?? '';
    })
    .join('');
  const failed = update.status === 'failed';
  return [
    {
      type: 'tool_result',
      content: text,
      call_id: update.toolCallId ?? '',
      ...(failed ? { metadata: { tool_status: 'failed' } } : {}),
    },
  ];
}

function usageUpdate(update: AcpSessionUpdate): AgentEvent[] {
  const used = typeof update.used === 'number' ? update.used : 0;
  // usage-only 空事件载体（pi buildUsageEvent / codex usage_update 同款）；
  // ctx_tokens = ACP used（上下文占用快照），窗口分母 size 进元数据备查。
  const usage = { ctx_tokens: used };
  return [
    {
      type: 'text',
      content: '',
      usage,
      metadata: { status: 'usage_update', usage, context_size: update.size },
    },
  ];
}

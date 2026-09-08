/**
 * event-wire.ts —— AgentEvent → wire dict 转换收敛核心（单一实现源）。
 *
 * task-04 轻重构②（2026-09-07-arch-large-file-split / design §5 Wave 1 / FR-05 /
 * D-005@v3）：session-manager 包 events.ts 的 ``eventToReportDict``（submitMessages
 * 事件轨 dict）与 task-runner facade 的 ``_eventToMessages``（submitMessages message
 * dict 列表）此前平行维护同源的「事件字段 → wire dict」映射（event_type 键 +
 * 蛇形平铺 + session_id/call_id/usage 业务三列透传），收敛为本模块两个形态核心：
 *   - ``eventToReportWireDict(ev, seq)``：session-manager 事件轨（v2 一等字段蛇形
 *     平铺 + legacy ``event_type``/``type`` 双键；seq 补号由调用方 SessionManager 定）；
 *   - ``eventToSubmitMessages(ev)``：task-runner 渲染轨（1:N message dict，
 *     1:1 复现老 SERVER 路径 _format_conversation_log 格式）。
 *
 * 两核心共用 ``appendSessionWireColumns``（session_id/call_id/usage 三列 wire 映射，
 * 口径参数化：事件轨从一等字段透传，渲染轨从 metadata 容器守卫读取 + usage 浅拷贝）。
 *
 * 行为零变化：两消费方输出与收敛前逐字节等价（tests/event-wire.test.ts 用
 * golden 字面量 + 消费方一致性断言守护）。
 *
 * @module event-wire
 */

import type { AgentEvent } from './types.js';
import { classifyToolKind } from './tool-kind.js';
import { TOOL_RESULT_PREVIEW_MAX } from './task-runner/runner-types.js';

/**
 * AgentEvent 业务三列（session_id / call_id / usage）→ wire dict 透传（两轨共用）。
 *
 * 口径参数化（收敛前两处平行实现的差异，原样保留）：
 *   - ``'firstClass'``（事件轨 / eventToReportWireDict）：源 = 事件一等字段，
 *     undefined 省略、原值透传（call_id 先于 session_id，对齐 v2 平铺键序）；
 *   - ``'metadata'``（渲染轨 / eventToSubmitMessages）：源 = metadata 开放容器
 *     （stream-json 侧字段未提升一等），非空 string 守卫、usage 纯对象守卫 +
 *     浅拷贝（不与 metadata 共享可变引用）。
 */
function appendSessionWireColumns(
  dict: Record<string, unknown>,
  ev: AgentEvent,
  source: 'firstClass' | 'metadata',
): void {
  if (source === 'firstClass') {
    if (ev.call_id !== undefined) dict['call_id'] = ev.call_id;
    if (ev.session_id !== undefined) dict['session_id'] = ev.session_id;
    if (ev.usage !== undefined) dict['usage'] = ev.usage;
    return;
  }
  const md = ev.metadata ?? {};
  if (typeof md.session_id === 'string' && md.session_id) {
    dict['session_id'] = md.session_id;
  }
  if (typeof md.call_id === 'string' && md.call_id) {
    dict['call_id'] = md.call_id;
  }
  if (
    md.usage &&
    typeof md.usage === 'object' &&
    !Array.isArray(md.usage)
  ) {
    dict['usage'] = { ...(md.usage as Record<string, unknown>) };
  }
}

/**
 * task-08：AgentEvent → 上报消息 dict（submitMessages 事件轨核心；session-manager
 * events.ts eventToReportDict 委托）。
 *
 * v2 一等字段（parent 三列 / segment_id / edit_patch / usage / session_id /
 * is_partial / override / tool_name / call_id / subtype / depth / seq / metadata）
 * 蛇形命名平铺 dict 顶层，task-09 接线时直接包 ``{"kind":"agent_event",
 * "event": {...}}``；legacy 兼容键 ``event_type``（= type 别名）保留给
 * daemon dedupKeyFor / 旧消费轨（对齐 codex driver toAgentEvent 的双键形态）。
 * seq 缺号由 SessionManager 补（design §7：turn 内单调递增，_foldTurnUsage
 * turn 边界重置；事件自带 seq（provider 自产）则透传不覆盖）——本核心不判 seq，
 * 由调用方算好传入。
 */
export function eventToReportWireDict(
  ev: AgentEvent,
  seq: number,
): Record<string, unknown> {
  const dict: Record<string, unknown> = {
    event_type: ev.type,
    type: ev.type,
    content: ev.content,
    seq,
  };
  if (ev.subtype !== undefined) dict['subtype'] = ev.subtype;
  if (ev.tool_name !== undefined) dict['tool_name'] = ev.tool_name;
  appendSessionWireColumns(dict, ev, 'firstClass');
  if (ev.parent_tool_use_id !== undefined) {
    dict['parent_tool_use_id'] = ev.parent_tool_use_id;
  }
  if (ev.subagent_type !== undefined) dict['subagent_type'] = ev.subagent_type;
  if (ev.depth !== undefined) dict['depth'] = ev.depth;
  if (ev.segment_id !== undefined) dict['segment_id'] = ev.segment_id;
  if (ev.is_partial !== undefined) dict['is_partial'] = ev.is_partial;
  if (ev.override !== undefined) dict['override'] = ev.override;
  if (ev.edit_patch !== undefined) dict['edit_patch'] = ev.edit_patch;
  if (
    ev.metadata !== undefined &&
    Object.keys(ev.metadata as Record<string, unknown>).length > 0
  ) {
    dict['metadata'] = ev.metadata;
  }
  return dict;
}

/**
 * 把 AgentEvent IR 渲染成 server submit_messages 的 message dict 列表
 * （task-runner facade _eventToMessages 委托；task-04 轻重构②自 facade 原样搬移）。
 *
 * ql-20260616-005：1:1 复现老 SERVER 路径 _format_conversation_log 渲染规则
 * （commit be5448b 删除前 backend/app/modules/agent/adapters/claude_code.py:306-388），
 * 让前端 normalize.ts / agent-log-viewer.tsx 不动就能解析 [ASSISTANT]/[TOOL_USE]/
 * [TOOL_RESULT]/[SYSTEM:xxx]/[RESULT:success] 前缀，tool_use 同时产 stdout 文本
 * 行 + tool_call JSON 两类 message，前端 ToolCallCard 渲染照常工作。
 *
 * 1 个 event → 0/1/2 条 message：
 *   - text + status=running → 1 条 [SYSTEM:init] session started (stdout)
 *   - text + thinking       → 1 条 [THINKING] <preview 20000> (stdout)
 *   - text + 其他            → 1 条 [ASSISTANT] <content> (stdout)
 *   - tool_use              → 2 条：[TOOL_USE] Name: cmd (stdout) + JSON (tool_call)
 *   - tool_result           → 1 条 [TOOL_RESULT] <preview 100000> (stdout)
 *   - error                 → 1 条 [LEVEL] <content> (stderr)
 *   - complete              → 1 条 [RESULT:success] <text> duration=Xms turns=N (stdout)
 *
 * 业务字段（session_id/call_id/usage）注入到首条 message，backend submit_messages
 * 透传到 AgentRunLog.metadata / AgentRun.input_tokens（usage 实时回写，见 ql-004）。
 *
 * 返回 null：未知 event type 或所有 message 都被过滤。
 */
export function eventToSubmitMessages(
  ev: AgentEvent,
): Record<string, unknown>[] | null {
  const md = ev.metadata ?? {};
  const rawContent = ev.content ?? '';
  const messages: Record<string, unknown>[] = [];

  switch (ev.type) {
    case 'text': {
      const status = typeof md.status === 'string' ? md.status : '';
      const thinking = md.thinking === true;
      const isLog = md.log === true;
      const isStreaming = md.streaming === true;
      // ql-20260618-005：codex item/agentMessage/delta 流式 token —— 不加 [ASSISTANT]
      // 前缀，直接发原始 delta 文本。前端 chat 面板会逐字 append 拼"打字效果"。
      // 若加 [ASSISTANT] 前缀，每个 delta 都带前缀 → "[ASSISTANT] 我[ASSISTANT]  Cod"。
      // Agent 控制台日志会按原样展示每条 delta（无前缀），可读性也 OK（每条 = 一次推送）。
      if (isStreaming && rawContent) {
        messages.push({
          event_type: ev.type,
          content: rawContent,
          channel: 'stdout',
        });
        break;
      }
      // ql-20260617-006：stream_event/message_delta 产的 status='usage_update' 事件
      // content 为空但 metadata.usage 有真实累加值。透传给 backend submit_messages
      // 实时更新 AgentRun.input_tokens/output_tokens（不写日志，仅 usage 回写）。
      if (status === 'usage_update') {
        messages.push({
          event_type: ev.type,
          content: '',
          channel: 'stdout',
        });
        break;
      }
      // ql-20260617-008：parseSystem 把 init / status / api_retry 等所有 subtype 都
      // 产成 status='system' + content='session=xxx cwd=xxx ...'，渲染成
      // `[SYSTEM:<subtype>] <content>` 一行。日志完整性优先，不再丢弃任何 subtype。
      if (status === 'system') {
        const subtype = typeof md.subtype === 'string' && md.subtype ? md.subtype : 'unknown';
        messages.push({
          event_type: ev.type,
          content: `[SYSTEM:${subtype}] ${rawContent}`.slice(0, 2000),
          channel: 'stdout',
        });
        break;
      }
      // ql-20260617-008：parseLog 产 metadata.log=true + level + content=message。
      // 渲染成 `[LOG:<level>] <message>`，stderr 级别（warn/error）走 stderr channel。
      if (isLog) {
        const level = typeof md.level === 'string' && md.level ? md.level : 'info';
        const isErrLevel = level === 'error' || level === 'warn';
        messages.push({
          event_type: ev.type,
          content: `[LOG:${level}] ${rawContent}`.slice(0, 5000),
          channel: isErrLevel ? 'stderr' : 'stdout',
        });
        break;
      }
      // ql-20260616-005：空 content + 非 system/thinking 分支 → 丢弃（对齐老
      // _eventToMessage L744 「空 content + 无 metadata 业务字段 → 返回 null」语义）
      if (!rawContent && !thinking) {
        return null;
      }
      let line: string;
      if (thinking) {
        const preview =
          rawContent.length > 20000
            ? rawContent.slice(0, 20000) + '...'
            : rawContent;
        line = `[THINKING] ${preview}`;
      } else {
        line = `[ASSISTANT] ${rawContent}`;
      }
      messages.push({
        event_type: ev.type,
        content: line,
        channel: 'stdout',
      });
      break;
    }
    case 'tool_use': {
      const name =
        typeof md.tool_name === 'string' && md.tool_name
          ? md.tool_name
          : 'unknown';
      // task-17 / R-06：审批 decline 事件 → stdout 直接写中文理由（不渲染 [TOOL_USE]
      // 模板，让前端 / 日志一眼可见拒绝原因 + 越界路径）。accept 时 metadata 无 reason，
      // 走下面的标准 tool_use 渲染（[TOOL_USE] Name: ...）。
      if (md.approval_decision === 'decline') {
        const reason =
          typeof md.deny_reason === 'string' && md.deny_reason
            ? md.deny_reason
            : '审批拒绝（未知原因）';
        messages.push({
          event_type: ev.type,
          content: `[APPROVAL:DECLINE] ${name}\n${reason}`.slice(0, 5000),
          channel: 'stderr',
        });
        break;
      }
      const inputObj =
        md.tool_input &&
        typeof md.tool_input === 'object' &&
        !Array.isArray(md.tool_input)
          ? (md.tool_input as Record<string, unknown>)
          : {};
      // task-13 / D-002@v1：提取 tool_use_id（SDK tool_use block 的 id，toolu_xxx）。
      // stream-json.ts:645-654 把 block.id 存到 metadata.call_id（命名待后续修正），
      // 这里兼容三种字段名：
      //   1. md.tool_use_id（未来 adapter 命名修正后的标准字段）
      //   2. md.id（直接透传 SDK content_block.id）
      //   3. md.call_id（当前 stream-json.ts 实际存储位置，旧字段名）
      // 任一非空字符串即采用；全空 → ''（退化，前端 normalize 回退 ±3 窗口）。
      // 注：只把 id 注入 tool_call JSON（submit_messages 仅存 content/channel/usage，
      // 不保留 metadata 字段，故 stdout 不带 metadata，避免无效写入）。
      const toolUseId =
        (typeof md.tool_use_id === 'string' && md.tool_use_id) ||
        (typeof md.id === 'string' && md.id) ||
        (typeof md.call_id === 'string' && md.call_id) ||
        '';
      // stdout 文本行：[TOOL_USE] Name: <command> 或 [TOOL_USE] Name: {json}
      // 对齐老 _format_conversation_log L333-337
      const cmd = typeof inputObj.command === 'string' ? inputObj.command : '';
      let argsLine: string;
      if (cmd) {
        argsLine = cmd;
      } else {
        try {
          argsLine = JSON.stringify(inputObj);
        } catch {
          argsLine = '';
        }
      }
      const stdoutContent = `[TOOL_USE] ${name}: ${argsLine}`.slice(0, 20000);
      messages.push({
        event_type: ev.type,
        content: stdoutContent,
        channel: 'stdout',
      });
      // task-06 / FR-03：推导工具种类。stdout 文本行（上方 SemanticCategory=log）
      // 不带 tool_kind（C-02：log 不参与工具筛选维度）；仅 tool_call JSON 行带。
      // toolName 缺失或为 unknown 时 classifyToolKind 返回 null，条件展开省略字段
      // （C-01：tool_kind 与 event_type/content/channel 同级顶层，非 metadata）。
      const toolKind = classifyToolKind(
        typeof md.tool_name === 'string' && md.tool_name ? md.tool_name : null,
        inputObj,
      );
      // 额外发一条 tool_call channel 的 JSON，前端 parseToolCallContent 解析为
      // ToolCallCard。对齐老 _emit_stdout L749-757 的 tc_content 格式。
      // task-13：补 tool_use_id 字段（snake_case，对齐 Anthropic API 命名 + 与
      // backend run_sync/service.py 一致），让前端 normalize 全局配对（task-14）。
      const ts = new Date().toISOString();
      let tcContent: string;
      try {
        tcContent = JSON.stringify({
          tool: name,
          // tool_use_id 仅非空时携带（省略 vs null 均可让前端 hasOwnProperty
          // 判断"无 id"分支）。这里用条件展开省略字段，退化路径保持原形状。
          ...(toolUseId ? { tool_use_id: toolUseId } : {}),
          args: inputObj,
          timestamp: ts,
          status: 'allowed',
          success: true,
        });
      } catch {
        tcContent = JSON.stringify({
          tool: name,
          ...(toolUseId ? { tool_use_id: toolUseId } : {}),
          args: {},
          timestamp: ts,
          status: 'allowed',
          success: true,
        });
      }
      messages.push({
        event_type: ev.type,
        content: tcContent,
        channel: 'tool_call',
        ...(toolKind ? { tool_kind: toolKind } : {}),
      });
      break;
    }
    case 'tool_result': {
      // ql-20260709-001：放宽截断（3000→TOOL_RESULT_PREVIEW_MAX），超长追加
      // 中文标注，与 backend run_sync/service.py interactive 路径一致。
      const preview =
        rawContent.length > TOOL_RESULT_PREVIEW_MAX
          ? rawContent.slice(0, TOOL_RESULT_PREVIEW_MAX) +
            `\n...(输出过长，已截断，共 ${rawContent.length} 字符)`
          : rawContent;
      messages.push({
        event_type: ev.type,
        content: `[TOOL_RESULT] ${preview}`,
        channel: 'stdout',
      });
      break;
    }
    case 'error': {
      const level =
        typeof md.level === 'string' && md.level ? md.level : 'error';
      messages.push({
        event_type: ev.type,
        content: `[${level.toUpperCase()}] ${rawContent}`.slice(0, 5000),
        channel: 'stderr',
      });
      break;
    }
    case 'complete': {
      const stats =
        md.stats &&
        typeof md.stats === 'object' &&
        !Array.isArray(md.stats)
          ? (md.stats as Record<string, unknown>)
          : {};
      const durationMs =
        typeof stats.total_duration_ms === 'number'
          ? stats.total_duration_ms
          : null;
      const numTurns =
        typeof stats.num_turns === 'number' ? stats.num_turns : null;
      let line = '[RESULT:success]';
      const body = rawContent.trim();
      if (body) {
        line += ` ${body.slice(0, 50000)}`; // ql-20260626-001 放宽（原 3000 截断完整 result 总结）
      }
      if (durationMs !== null) line += ` duration=${durationMs}ms`;
      if (numTurns !== null) line += ` turns=${numTurns}`;
      messages.push({
        event_type: ev.type,
        content: line,
        channel: 'stdout',
      });
      break;
    }
    default: {
      // 未知 event type：丢弃，避免污染日志
      return null;
    }
  }

  if (messages.length === 0) return null;

  // 业务字段透传到首条 message（backend submit_messages 用于 usage 实时回写、
  // session_id 索引等）。call_id 仅 tool_use 类型有意义，写第一条即可。
  // task-04 轻重构②：三列映射与事件轨共用 appendSessionWireColumns（metadata 口径）。
  appendSessionWireColumns(messages[0]!, ev, 'metadata');
  return messages;
}

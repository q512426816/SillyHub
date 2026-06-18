/**
 * JsonRpcAdapter —— JSON-RPC 2.0 over stdio 的纯解析 adapter。
 *
 * 覆盖 provider：codex / hermes / kimi / kiro（共享同一套 method 名）。
 *
 * 协议特征（对照 Python json_rpc.py）：
 *   - 双向通信：daemon 发 request（initialize/thread/start/turn/start），
 *     子进程回 response；子进程主动推 notification 和 server request。
 *   - 三类入站消息（_handle_line L186-200 分支顺序）：
 *       1. response      (has id, no method)  —— daemon 之前 request 的回复
 *       2. server request (has id + method)   —— 子进程发起、需 daemon 应答
 *       3. notification  (no id, has method)  —— 单向通知
 *
 * 与 Python 版的关键差异（写在 JSDoc 防止误读）：
 *   - Python `parse_output` 只处理 notification，response 返回 None，
 *     server request 不进 parse_output（在 transport 层 auto-respond）。
 *   - Node 版 parse 统一处理三类（方案B：解析职责全在 adapter，I/O 全在
 *     TaskRunner）。server request 的「待应答 id」记录到实例字段，
 *     TaskRunner 轮询取出写 stdin。
 *   - response / turn/completed 也产出 event（携带 session_id / usage），
 *     Python 版丢弃（turn/completed）或返回 None。
 *
 * provider 差异说明：
 *   Python `_PROVIDER_COMMANDS` 显示 codex 用 `app-server --listen stdio://`
 *   子命令，hermes/kimi/kiro 无子命令——但这是 spawn 层差异（task-19），
 *   parse 层四 provider 共享 method 名，无分支（预留 mapMethodName 钩子）。
 *
 * IR 收敛决策（turn/started）：
 *   蓝图骨架曾用 `type:'status'`，但 task-02 的 AgentEventType 收敛为 5 元组
 *   （text/tool_use/tool_result/error/complete），注释明确 status 合入 text +
 *   metadata.status。task-06 stream-json 的 parseSystem 已如此实现。
 *   故本 adapter 的 turn/started 同样收敛为 `type:'text' + metadata.status:'running'`，
 *   不回头给 task-02 加 'status'（保持 IR 全局一致）。
 *
 * @see design.md §7.1 AgentEvent IR / §7.3 PROTOCOL_PROVIDERS json_rpc 条目 / §10 R-01 R-03
 */

import type { AgentEvent } from '../types.js';
import type { ProtocolAdapter } from './protocol-adapter.js';

/** JSON-RPC 2.0 四 provider 联合（工厂 task-11 会做 narrowing）。 */
export type JsonRpcProvider = 'codex' | 'hermes' | 'kimi' | 'kiro';

/**
 * 自动应答模板（对照 Python _handle_server_request L237-247 的 5 个 approval method）。
 * method 名逐字来自 Python，禁止改动。
 */
const APPROVAL_RESPONSES: Record<string, Record<string, unknown>> = {
  'item/commandExecution/requestApproval': { decision: 'accept' },
  execCommandApproval: { decision: 'accept' },
  'item/fileChange/requestApproval': { decision: 'accept' },
  applyPatchApproval: { decision: 'accept' },
  'mcpServer/elicitation/request': { action: 'accept', content: null, _meta: null },
};

/** server request 待应答条目（TaskRunner 取出后据此写 stdin）。 */
export interface PendingServerRequest {
  id: number | string;
  method: string;
  params: Record<string, unknown>;
  /** 预填应答模板（approval 类有，未知 method 为 null，TaskRunner 自决）。 */
  responseTemplate: Record<string, unknown> | null;
}

export class JsonRpcAdapter implements ProtocolAdapter {
  readonly provider: JsonRpcProvider;

  /** 待应答 server request（id → 完整条目），task-19 轮询消费。 */
  private readonly pendingMap = new Map<number | string, PendingServerRequest>();

  /**
   * ql-20260618-004：已通过 item/agentMessage/delta 流式输出过的 agentMessage itemId。
   * item/completed(agentMessage) 命中此集合时跳过完整文本，避免与 delta 重复。
   * 单 lease 一个实例（每个 task 一个新 adapter），状态隔离。
   */
  private readonly _streamedAgentMessageIds = new Set<string>();

  /**
   * ql-20260618-005：agentMessage/delta 字符缓冲。
   *
   * codex 每个 token 通常 1-5 字符，如果每条 delta 都 emit AgentEvent → TaskRunner
   * 串行 await submitMessages（HTTP POST + DB commit + Redis publish + SSE push），
   * 长 message 累积十几秒延迟，前端表现为「几个字几个字蹦」。节流：累积到
   * AGENT_MESSAGE_FLUSH_CHARS 字符或 AGENT_MESSAGE_FLUSH_MS 毫秒才 flush 一次。
   *
   * 与 stream-json.ts 的 _thinkingBuf 同模式（task-06 / ql-20260617-012）。
   * 残留 buffer 在 item/completed(agentMessage) / turn/completed / itemId 切换 时 flush。
   */
  private _agentMessageBuf = '';
  private _agentMessageBufItemId = '';
  private _agentMessageBufStartedAt = 0;
  private static readonly AGENT_MESSAGE_FLUSH_CHARS = 80;
  private static readonly AGENT_MESSAGE_FLUSH_MS = 120;

  constructor(provider: JsonRpcProvider) {
    this.provider = provider;
  }

  /**
   * ql-20260618-005：重置跨 lease 累积状态（对齐 StreamJsonAdapter.resetAccumulator）。
   * TaskRunner.runLease 步骤 4 / 重试循环每次 attempt 开始时调用。
   */
  resetAccumulator(): void {
    this._streamedAgentMessageIds.clear();
    this._agentMessageBuf = '';
    this._agentMessageBufItemId = '';
    this._agentMessageBufStartedAt = 0;
  }

  /**
   * 构造 spawn 子进程参数（不含 cmdPath）。
   *
   * ql-20260617-006：四 provider 启动命令差异（对照 Python _PROVIDER_COMMANDS）。
   *   - codex: `app-server --listen stdio://`（进入 JSON-RPC server 模式）
   *   - hermes/kimi/kiro: 暂无子命令（直接进入 stdio JSON-RPC）
   *
   * 缺失此实现时，task-runner.ts:394 退化为 `[]`，codex 无参数直接进入
   * 交互式 TUI → 检测到 stdin 非 terminal → 立即 exit 1 报
   * "Error: stdin is not a terminal"。
   *
   * 文档依据：
   *   - .sillyspec/changes/2026-06-09-daemon-agent-detection/tasks/task-05.md:67
   *   - .sillyspec/changes/archive/2026-06-14-2026-06-13-daemon-nodejs-rewrite/tasks/task-07.md:461
   *
   * @param _opts 预留（model / sessionId / resumeSessionId 当前不影响 codex 启动参数）
   */
  buildArgs(_opts?: {
    model?: string;
    sessionId?: string;
    resumeSessionId?: string;
    prompt?: string;
  }): string[] {
    if (this.provider === 'codex') {
      return ['app-server', '--listen', 'stdio://'];
    }
    return [];
  }

  /**
   * 构造 codex app-server 协议握手序列（ql-20260617-008）。
   *
   * 实测 codex app-server --listen stdio:// 启动后是被动 JSON-RPC 2.0 server，
   * daemon 必须按序发：
   *   1. initialize request → server 回 response（含 userAgent）
   *   2. notifications/initialized notification → server 推 remoteControl/status/changed
   *   3. thread/start request → server 回 response（含 result.thread.id）
   *
   * turn/start 不在本序列，因为它依赖 thread.id，由 buildTurnStart 单独构造，
   * TaskRunner 收到 thread/start response 后调用。
   *
   * 字段名严格按 codex app-server generate-json-schema：
   *   - initialize.params.clientInfo.{name,version}（不是 client，否则 -32600）
   *   - thread/start.params.cwd（spawn 工作目录）
   *
   * id 用 1/2 固定值（thread/start response 也用 id=2，TaskRunner 据此识别）。
   *
   * @param opts cwd / prompt（保留，当前握手不用）/ model（保留）
   */
  buildHandshake(opts: {
    cwd: string;
    prompt: string;
    model?: string;
  }): string[] {
    return [
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          clientInfo: { name: 'sillyhub-daemon', version: '0.1.0' },
        },
      }),
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'thread/start',
        params: { cwd: opts.cwd },
      }),
    ];
  }

  /**
   * 构造 turn/start JSON-RPC request（ql-20260617-008）。
   *
   * TaskRunner 在收到 id=2 的 response（thread/start reply）后调用本方法，
   * 从 response.result.thread.id 提取真实 threadId 注入到 turn/start params。
   *
   * 字段名严格按 codex schema：
   *   - params.threadId（camelCase，不是 thread_id，否则 -32600）
   *   - params.input: UserInput[]（codex 0.131 实测，ql-20260617-009 修正；旧 instructions 字段被 codex 拒绝）
   *   - params.model（可选，覆盖 ~/.codex/config.toml）
   *
   * @param opts threadId（thread/start response 拿到）/ prompt / model
   */
  buildTurnStart(opts: {
    threadId: string;
    prompt: string;
    model?: string;
  }): string {
    // ql-20260617-009：codex 0.131.0 turn/start 实测要求 `input` 字段（不是 instructions），
    // 类型为 UserInput[]，每个元素需 { type: 'text', text: string }。
    // 旧版用 instructions: [prompt] 会被 codex 拒绝为 -32600 missing field `input`。
    const params: Record<string, unknown> = {
      threadId: opts.threadId,
      input: [{ type: 'text', text: opts.prompt }],
    };
    if (opts.model) {
      params.model = opts.model;
    }
    return JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'turn/start',
      params,
    });
  }

  /**
   * 解析一行 JSON-RPC 2.0 消息，返回 0..N 个 AgentEvent。
   *
   * 三分支顺序严格对照 Python _handle_line L186-200：
   *   1. response       : has id && !has method
   *   2. server request : has id && has method
   *   3. notification   : !has id && has method
   *
   * 坏行（非 JSON / 非 object / 既无 id 又无 method）返回 null。
   */
  parse(line: string): AgentEvent[] | null {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return null; // B-07-8: 坏 JSON 不抛异常
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return null; // 非对象
    }
    const msg = raw as Record<string, unknown>;
    const hasId = Object.prototype.hasOwnProperty.call(msg, 'id');
    const hasMethod = Object.prototype.hasOwnProperty.call(msg, 'method');

    // B-07-7: id 为 null 属非法 request（JSON-RPC 规范 notification 不应带 id）
    if (hasId && msg.id === null) {
      return null;
    }

    // 分支 1：response（daemon 之前 request 的回复）
    if (hasId && !hasMethod) {
      return this.parseResponse(msg);
    }
    // 分支 2：server request（子进程发起，需应答）
    if (hasId && hasMethod) {
      return this.parseServerRequest(msg);
    }
    // 分支 3：notification（单向通知）
    if (!hasId && hasMethod) {
      return this.parseNotification(msg);
    }
    // 既无 id 又无 method：未识别（对照 Python L201 Unhandled）
    return null;
  }

  // -- 分支 1：response -----------------------------------------------

  private parseResponse(msg: Record<string, unknown>): AgentEvent[] | null {
    const id = msg.id as number | string;
    // 从待应答集合移除（若在）——request 是 daemon 发出的，正常不在 pendingMap
    // （pendingMap 只存 server request）。保留清理逻辑防漂移（B-07-3）。
    this.pendingMap.delete(id);

    // error response
    if (Object.prototype.hasOwnProperty.call(msg, 'error')) {
      const err = msg.error as Record<string, unknown> | undefined;
      const errMsg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as Record<string, unknown>).message)
          : 'unknown rpc error';
      const code =
        err && typeof err === 'object' && 'code' in err
          ? (err as Record<string, unknown>).code
          : -1;
      return [
        {
          type: 'error',
          content: errMsg,
          metadata: { rpc_error_code: code, rpc_id: id },
        },
      ];
    }

    // success response：提取 thread.id 作为 session_id（仅 turn/start reply 有用）。
    // ql-20260618-003：之前把 thread/start response 当作 'complete' 事件，
    // 会让前端 AgentLogViewer 显示 [complete] 而 task 实际未完成，且触发
    // stats 收集逻辑（无 stats，无害但语义错）。改为产出 'text' + status:'system'
    // 携带 session_id，让 TaskRunner 提取 session_id，但不冒充 task 完成。
    // turn 真正完成由 turn/completed notification 走 parseTurnCompleted。
    const result = (msg.result ?? {}) as Record<string, unknown>;
    const events: AgentEvent[] = [];

    const thread = result.thread as Record<string, unknown> | undefined;
    if (thread && typeof thread === 'object' && 'id' in thread) {
      events.push({
        type: 'text',
        content: '',
        metadata: {
          status: 'system',
          subtype: 'thread_started',
          session_id: String(thread.id),
          source: 'thread_response',
          rpc_id: id,
        },
      });
    }

    // 提取 usage（turn/start reply 可能带，对照 Python 三字段兜底）
    const usage = (result.usage ?? result.token_usage ?? result.tokens) as
      | Record<string, unknown>
      | undefined;
    if (usage && typeof usage === 'object') {
      events.push({
        type: 'text',
        content: '',
        metadata: {
          status: 'usage_update',
          usage,
          source: 'usage_response',
          rpc_id: id,
        },
      });
    }

    // 无 thread.id 也无 usage（如 initialize 的 capabilities response）→ null
    // 对照 Python parse_output L697-699：response 返回 None
    return events.length > 0 ? events : null;
  }

  // -- 分支 2：server request -----------------------------------------

  private parseServerRequest(msg: Record<string, unknown>): AgentEvent[] {
    const id = msg.id as number | string;
    const method = typeof msg.method === 'string' ? msg.method : '';
    const params = (msg.params ?? {}) as Record<string, unknown>;
    const template = APPROVAL_RESPONSES[method] ?? null;

    // 记录待应答（无论是否 approval，都登记让 TaskRunner 决策）
    const entry: PendingServerRequest = { id, method, params, responseTemplate: template };
    this.pendingMap.set(id, entry);

    if (template !== null) {
      // 已知 approval：产出 tool_use event，标记 auto_accept + response_template
      return [
        {
          type: 'tool_use',
          content: '',
          metadata: {
            kind: 'approval',
            auto_accept: true,
            rpc_id: id,
            rpc_method: method,
            response_template: template,
          },
        },
      ];
    }

    // 未知 server request：产出 error event 但仍登记 id（TaskRunner 可自定义应答）
    return [
      {
        type: 'error',
        content: `unhandled server request: ${method}`,
        metadata: { rpc_id: id, rpc_method: method, kind: 'unhandled_server_request' },
      },
    ];
  }

  // -- 分支 3：notification -------------------------------------------

  private parseNotification(msg: Record<string, unknown>): AgentEvent[] | null {
    const method = typeof msg.method === 'string' ? msg.method : '';
    const params = (msg.params ?? {}) as Record<string, unknown>;

    // provider method 名钩子（预留，当前 identity；未来 provider 分歧时扩展）
    const canonicalMethod = this.mapMethodName(method);

    if (canonicalMethod === 'item/completed') {
      return this.parseItemCompleted(params);
    }
    if (canonicalMethod === 'item/started') {
      return this.parseItemStarted(params);
    }
    if (canonicalMethod === 'item/agentMessage/delta') {
      // ql-20260618-004：codex 流式 delta —— agent message 推送过程中的增量文本。
      // 让 UI 实时看到 codex 在"打字"，避免推理模型 1-2 分钟思考期完全静默。
      // 与 item/completed(agentMessage) 配合：delta 先发完，completed 时 itemId 命中
      // _streamedAgentMessageIds 则跳过（避免重复展示完整文本）。
      return this.parseAgentMessageDelta(params);
    }
    if (canonicalMethod === 'turn/started') {
      // IR 收敛：status 合入 text + metadata.status（对齐 task-02/task-06）
      return [
        { type: 'text', content: '', metadata: { status: 'running', source: 'turn_started' } },
      ];
    }
    if (canonicalMethod === 'turn/completed') {
      // lifecycle 事件，编排层 task-19 监听 turn_done；parse 产出 complete event
      // 让 TaskRunner 知道 turn 结束（含 usage/error 提取）
      return this.parseTurnCompleted(params);
    }
    // 未知 notification：丢弃（对照 Python parse_output 未命中分支返回 None）
    return null;
  }

  private parseItemCompleted(params: Record<string, unknown>): AgentEvent[] | null {
    const item = params.item as Record<string, unknown> | undefined;
    if (!item || typeof item !== 'object') return null; // B-07-4
    const itemType = typeof item.type === 'string' ? item.type : '';
    const itemId = typeof item.id === 'string' ? item.id : '';

    if (itemType === 'agentMessage') {
      const text = typeof item.text === 'string' ? item.text : '';
      if (!text) return null; // 对照 Python L385 if text:
      // ql-20260618-005：先 flush 残留 buffer（item/completed 到达时 delta 可能
      // 还有未达阈值的尾部，必须先发出去再决定是否跳过 completed 文本）。
      const pendingFlush = this._flushAgentMessageBuf();
      // ql-20260618-004：若该 itemId 已通过 item/agentMessage/delta 流式输出，
      // 跳过 completed 的完整文本（delta 已实时拼出来，重复展示会刷新整段）。
      // 但 pendingFlush（残留 buffer）照发，否则丢尾部 token。
      if (itemId && this._streamedAgentMessageIds.has(itemId)) {
        this._streamedAgentMessageIds.delete(itemId); // 清掉，准备下一条 message
        return pendingFlush; // 可能 null（已全部 flush）或残留尾部
      }
      // 未走 delta 流式：返回完整文本（与 flush 一起拼，flush 通常为 null）
      if (pendingFlush) {
        return [...pendingFlush, { type: 'text', content: text, metadata: { call_id: itemId } }];
      }
      return [{ type: 'text', content: text, metadata: { call_id: itemId } }];
    }
    if (itemType === 'commandExecution') {
      const out = typeof item.aggregatedOutput === 'string' ? item.aggregatedOutput : '';
      return [
        {
          type: 'tool_result',
          content: out,
          metadata: { tool_name: 'exec_command', call_id: itemId },
        },
      ];
    }
    if (itemType === 'fileChange') {
      return [
        {
          type: 'tool_result',
          content: '',
          metadata: { tool_name: 'patch_apply', call_id: itemId },
        },
      ];
    }
    return null; // 未知 item.type
  }

  private parseItemStarted(params: Record<string, unknown>): AgentEvent[] | null {
    const item = params.item as Record<string, unknown> | undefined;
    if (!item || typeof item !== 'object') return null;
    const itemType = typeof item.type === 'string' ? item.type : '';
    const itemId = typeof item.id === 'string' ? item.id : '';

    // ql-20260618-004：codex reasoning item —— 推理模型思考阶段的事件。
    // item.summary 数组可能含 [{type:'summary_text', text:'...'}]（开启 reasoning_summary 时），
    // 也可能为空（默认）。无论哪种，发一条 thinking 事件让 UI 显示"思考中..."。
    // 完整 summary 文本提取后作为 content（空 summary 时 content 空，仅 metadata 标记）。
    if (itemType === 'reasoning') {
      const summary = Array.isArray(item.summary) ? item.summary : [];
      const parts: string[] = [];
      for (const s of summary) {
        if (s && typeof s === 'object' && 'text' in s) {
          const t = (s as Record<string, unknown>).text;
          if (typeof t === 'string' && t) parts.push(t);
        }
      }
      const content = parts.join('\n');
      return [
        {
          type: 'text',
          content,
          metadata: {
            thinking: true,
            call_id: itemId,
            source: 'reasoning_started',
          },
        },
      ];
    }
    if (itemType === 'commandExecution') {
      const cmd = typeof item.command === 'string' ? item.command : '';
      return [
        {
          type: 'tool_use',
          content: cmd,
          metadata: { tool_name: 'exec_command', call_id: itemId, tool_input: { command: cmd } },
        },
      ];
    }
    if (itemType === 'fileChange') {
      return [
        {
          type: 'tool_use',
          content: '',
          metadata: { tool_name: 'patch_apply', call_id: itemId },
        },
      ];
    }
    return null;
  }

  /**
   * ql-20260618-004 / ql-20260618-005：解析 codex 流式 delta 通知。
   *
   * codex 在生成 agentMessage 过程中会逐字推送 delta，让 UI 实时显示"打字"效果。
   * 完整文本在 item/completed(agentMessage) 时一次性给，但若已通过 delta 发出，
   * parseItemCompleted 会跳过（避免重复）。
   *
   * ql-20260618-005：加字符+时间双阈值节流。每个 token 通常 1-5 字符，若每条都
   * emit → 每条触发 TaskRunner.submitMessages 串行 HTTP POST，累积十几秒延迟。
   * 改为：累积到 AGENT_MESSAGE_FLUSH_CHARS 字符或 AGENT_MESSAGE_FLUSH_MS 毫秒才
   * flush 一次。itemId 变化时先 flush 旧 buffer（多 message 边界）。
   *
   * payload 结构：{ threadId, turnId, itemId, delta: string }
   */
  private parseAgentMessageDelta(params: Record<string, unknown>): AgentEvent[] | null {
    const delta = typeof params.delta === 'string' ? params.delta : '';
    if (!delta) return null;
    const itemId = typeof params.itemId === 'string' ? params.itemId : '';

    // itemId 变化 → 先 flush 旧 itemId 的 buffer（避免新旧 message 文本拼在一起）
    let preFlush: AgentEvent[] | null = null;
    if (
      itemId &&
      this._agentMessageBufItemId &&
      itemId !== this._agentMessageBufItemId
    ) {
      preFlush = this._flushAgentMessageBuf();
    }

    // 标记本 itemId 已流式输出（item/completed 据此跳过完整文本，避免重复）
    if (itemId) {
      this._streamedAgentMessageIds.add(itemId);
      // 首次入 buffer：记录 itemId + 起始时间
      if (this._agentMessageBuf === '') {
        this._agentMessageBufItemId = itemId;
        this._agentMessageBufStartedAt = Date.now();
      }
    }

    this._agentMessageBuf += delta;

    // 阈值检查：字符数或时间窗口任一达标即 flush
    const elapsed = Date.now() - this._agentMessageBufStartedAt;
    if (
      this._agentMessageBuf.length >= JsonRpcAdapter.AGENT_MESSAGE_FLUSH_CHARS ||
      elapsed >= JsonRpcAdapter.AGENT_MESSAGE_FLUSH_MS
    ) {
      const flushed = this._flushAgentMessageBuf();
      // 拼接 preFlush（旧 itemId 残留）+ 当前 flush
      if (preFlush && flushed) return [...preFlush, ...flushed];
      return preFlush ?? flushed;
    }

    // 未达阈值：仅返回 preFlush（若有），当前 delta 暂存 buffer
    return preFlush;
  }

  /**
   * ql-20260618-005：flush agentMessage/delta 缓冲。
   *
   * 返回 1 条 text event（content=累积的 delta 文本，metadata.streaming=true），
   * 或 null（buffer 为空）。副作用：清空 buffer + 重置 itemId/起始时间。
   */
  private _flushAgentMessageBuf(): AgentEvent[] | null {
    if (!this._agentMessageBuf) return null;
    const content = this._agentMessageBuf;
    const itemId = this._agentMessageBufItemId;
    this._agentMessageBuf = '';
    this._agentMessageBufItemId = '';
    this._agentMessageBufStartedAt = 0;
    return [
      {
        type: 'text',
        content,
        metadata: {
          call_id: itemId,
          source: 'agent_message_delta',
          streaming: true,
        },
      },
    ];
  }

  private parseTurnCompleted(params: Record<string, unknown>): AgentEvent[] | null {
    const turn = params.turn as Record<string, unknown> | undefined;
    if (!turn || typeof turn !== 'object') return null; // B-07-9
    const status = typeof turn.status === 'string' ? turn.status : '';
    const events: AgentEvent[] = [];

    // ql-20260618-005：turn 结束前 flush 残留 delta buffer（codex 异常退出 /
    // item/completed 漏发时，turn/completed 是最后兜底 flush 点，避免丢尾部）
    const pendingFlush = this._flushAgentMessageBuf();
    if (pendingFlush) {
      events.push(...pendingFlush);
    }

    if (status === 'failed') {
      const errObj = turn.error as Record<string, unknown> | undefined;
      const errMsg =
        errObj && typeof errObj === 'object' && 'message' in errObj
          ? String((errObj as Record<string, unknown>).message)
          : 'turn failed';
      events.push({
        type: 'error',
        content: errMsg,
        metadata: { source: 'turn_completed', turn_status: 'failed' },
      });
    }

    // usage 提取（对照 Python on_notification L368-372 三字段兜底）
    const usage = (turn.usage ?? turn.token_usage ?? turn.tokens) as
      | Record<string, unknown>
      | undefined;
    if (usage && typeof usage === 'object') {
      events.push({
        type: 'complete',
        content: '',
        metadata: { usage, source: 'turn_completed', turn_status: status },
      });
    } else {
      // 即使无 usage 也产出一个 complete 标记 turn 结束（方案B：编排层监听 turn_done）
      events.push({
        type: 'complete',
        content: '',
        metadata: { source: 'turn_completed', turn_status: status },
      });
    }
    return events;
  }

  /**
   * provider method 名映射钩子。当前 identity（四 provider 共享 method 名）。
   * 未来若 hermes/kimi/kiro 出现 method 名分歧，在此按 this.provider 分支。
   * 禁止臆造——必须有 fixture 证据才加分支（B-07-6）。
   */
  private mapMethodName(method: string): string {
    return method;
  }

  // -- TaskRunner 消费接口（task-19 调用） -----------------------------

  /** 取出所有待应答 server request（不消费，TaskRunner 应答后调 markResponded）。 */
  getPendingServerRequests(): readonly PendingServerRequest[] {
    return Array.from(this.pendingMap.values());
  }

  /** TaskRunner 写完 stdin 应答后调用，移除该 id。 */
  markResponded(id: number | string): void {
    this.pendingMap.delete(id);
  }
}

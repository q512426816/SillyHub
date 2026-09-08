/**
 * task-runner/render.ts —— 本地终端 echo / 观察日志渲染与行探测簇。
 *
 * task-03（2026-09-07-arch-large-file-split / D-004@v1）：原 task-runner.ts 的
 * renderAgentEvent / shortLeaseId / renderTaskBoundary / echoTaskBoundary /
 * _looksLike* / _extractSessionId / ECHO_MAX_LEN 原样搬移（零改写；
 * _looksLike* / _extractSessionId 包内导出供 spawn-stream 引用，不进 index
 * 公共面）。
 *
 * @module task-runner/render
 */

import type { AgentEvent } from '../types.js';

/**
 * 粗判一行是否是 control_request（含 '"control_request"' 字样）。
 * 真正的解析在 adapter.onControl 内（不同协议 JSON 字段略有差异）。
 */
export function _looksLikeControlRequest(line: string): boolean {
  return line.includes('"control_request"') || line.includes("'control_request'");
}

// ── 本地终端 echo（quick-chat 实时观察 agent 执行过程）──────────────────────────

/** 单条 echo 最大长度（超长截断，避免大 tool_input 刷屏）。 */
const ECHO_MAX_LEN = 2000;

/**
 * 把 AgentEvent 渲染成单行文本写入 stdout，供启动 daemon 的本地终端实时观察。
 *
 * 设计要点：
 *   - 用 process.stdout.write 直接写，不走 logger（logger 受 log_level 过滤，
 *     debug 级别默认不显示，违背「随时能看到」的诉求）。
 *   - daemon 是前台进程，stdout 跟着终端或重定向目标走，不污染 daemon.log
 *     （cli.ts 的日志文件目前没有重定向 stdout，echo 只活在终端）。
 *   - 业务逻辑（outputParts 累积 / submitMessages）与 echo 解耦，互不影响。
 *   - 单条消息超长截断到 ECHO_MAX_LEN，防止超长 tool_input 刷屏。
 *
 * 不是 TaskRunner 成员方法：纯函数 + leaseId 入参，便于单测独立验证。
 */
/**
 * 把 AgentEvent 渲染成单行文本（不含换行符）。
 *
 * ql-20260616-003：拆出纯函数 render，echo 和 terminal observer 写日志复用
 * 同一份渲染逻辑，保证本地 stdout 和观察日志文件内容字节一致。
 *
 * 渲染规则：
 *   - 前缀 `[task <leaseId前8位>]`，长 UUID 截短避免刷屏
 *   - text         → 直接拼 content（带可选 [status]）
 *   - tool_use     → [tool_use <name>] <input>
 *   - tool_result  → [tool_result <name>] <output>
 *   - error        → [<level>] <content>
 *   - complete     → [complete] usage=<json>（可选）
 *   - 单条超 ECHO_MAX_LEN 截断 + 标记
 */
export function renderAgentEvent(leaseId: string, ev: AgentEvent): string {
  const prefix = `[task ${shortLeaseId(leaseId)}]`;
  let line: string;
  switch (ev.type) {
    case 'text': {
      const status = typeof ev.metadata?.status === 'string' ? ev.metadata.status : '';
      line = status ? `${prefix} [${status}] ${ev.content}` : `${prefix} ${ev.content}`;
      break;
    }
    case 'tool_use': {
      const name = typeof ev.metadata?.tool_name === 'string' ? ev.metadata.tool_name : '<unknown>';
      const input = ev.content || '';
      line = `${prefix} [tool_use ${name}] ${input}`;
      break;
    }
    case 'tool_result': {
      const name = typeof ev.metadata?.tool_name === 'string' ? ev.metadata.tool_name : '';
      line = `${prefix} [tool_result${name ? ` ${name}` : ''}] ${ev.content}`;
      break;
    }
    case 'error': {
      const level = typeof ev.metadata?.level === 'string' ? ev.metadata.level : 'error';
      line = `${prefix} [${level}] ${ev.content}`;
      break;
    }
    case 'complete': {
      const usage = ev.metadata?.usage;
      const usageStr = usage && typeof usage === 'object'
        ? ` usage=${JSON.stringify(usage)}`
        : '';
      line = `${prefix} [complete]${usageStr}`;
      break;
    }
    default: {
      line = `${prefix} [${(ev as { type: string }).type}] ${ev.content}`;
    }
  }
  if (line.length > ECHO_MAX_LEN) {
    line = line.slice(0, ECHO_MAX_LEN) + '…<truncated>';
  }
  return line;
}

/** leaseId 取短显示（前 8 位），用于 echo 前缀，避免长 UUID 刷屏。 */
function shortLeaseId(leaseId: string): string {
  return leaseId.length > 12 ? leaseId.slice(0, 8) : leaseId;
}

/**
 * 渲染任务开始/结束边界行（不含换行符）。ql-20260616-003 拆出纯函数。
 *
 * start：`[task xxx] spawn: <cmd> <args...>`
 * end：  `[task xxx] done: status=<status> exit=<exitCode> error=<error>`
 */
export function renderTaskBoundary(
  leaseId: string,
  phase: 'start' | 'end',
  kv: { cmdPath?: string; args?: string[]; status?: string; exitCode?: number; error?: string },
): string {
  const prefix = `[task ${shortLeaseId(leaseId)}]`;
  if (phase === 'start') {
    const argStr = (kv.args ?? []).join(' ');
    const cmd = kv.cmdPath ?? '';
    return `${prefix} spawn: ${cmd} ${argStr}`;
  }
  const parts = [`status=${kv.status ?? '?'}`, `exit=${kv.exitCode ?? '?'}`];
  if (kv.error) {
    const e = kv.error.length > ECHO_MAX_LEN ? kv.error.slice(0, ECHO_MAX_LEN) + '…<truncated>' : kv.error;
    parts.push(`error=${e}`);
  }
  return `${prefix} done: ${parts.join(' ')}`;
}

/**
 * 任务边界写入 daemon 本地 stdout。包装 try/catch。
 */
export function echoTaskBoundary(
  leaseId: string,
  phase: 'start' | 'end',
  kv: { cmdPath?: string; args?: string[]; status?: string; exitCode?: number; error?: string },
): void {
  try {
    process.stdout.write(renderTaskBoundary(leaseId, phase, kv) + '\n');
  } catch {
    // ignore
  }
}

/**
 * 粗判一行是否是 claude stream-json 的 result 事件。
 *
 * ql-20260618-003：之前用 `line.includes('"result"')` 兜底太宽，会误命中
 * codex/json-rpc 的 response（`{"id":2,"result":{"thread":...}}` 也含 "result"
 * key），导致 thread/start response 被误判为终结行 → 提前 stdin.end() →
 * 后续 turn/start 写触发 ERR_STREAM_WRITE_AFTER_END。
 *
 * 修复：用正则只匹配 `"type":"result"`（容忍冒号两侧空格）。codex 的
 * turn/completed 通过 _looksLikeTurnCompleted 单独检测。
 */
export function _looksLikeResult(line: string): boolean {
  return /"type"\s*:\s*"result"/.test(line);
}

/**
 * ql-20260618-003：检测 codex/json-rpc 的 turn/completed 通知。
 *
 * codex 是被动 server，单 turn 完成后不会自动退出，需要 daemon 主动关闭
 * stdin 让其收尾。turn/completed notification 标志当前 turn 结束（含
 * status="completed" / "failed" / "cancelled"），是单次 lease 的安全收尾点。
 */
export function _looksLikeTurnCompleted(line: string): boolean {
  return /"method"\s*:\s*"turn\/completed"/.test(line);
}

/**
 * 从一行 JSON 文本里提取 session_id（若存在）。
 * 失败返回空串。
 */
export function _extractSessionId(line: string): string {
  // 优先 JSON.parse
  try {
    const obj = JSON.parse(line) as { session_id?: unknown; sessionId?: unknown };
    if (typeof obj.session_id === 'string') return obj.session_id;
    if (typeof obj.sessionId === 'string') return obj.sessionId;
  } catch {
    // 非 JSON 行，正则兜底
    const m = /"session_id"\s*:\s*"([^"]+)"/.exec(line);
    if (m && m[1]) return m[1];
  }
  return '';
}

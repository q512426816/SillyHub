"use client";

/**
 * 本地 agent 日志 API 封装（2026-08-23-platform-agent-log-ingest task-04 起；
 * 2026-08-23-agent-activity-sessions task-07 会话化改造）。
 *
 * - GET /api/agent-logs（query session_id）：sillyspec CLI（sillyhub-daemon /
 *   zcode）经 POST /api/agent-logs 上报落库的 agent 本机日志元信息列表，按
 *   last_seen_at DESC NULLS LAST 排序（design §3.2）。会话化后**仅**按会话
 *   关联拉取（D-004：workspace 级旧挂载已移除，workspace_id 过滤语义退役）。
 * - GET /api/agent-logs/{entry_id}/content：daemon 侧整文件读的**尾部文本**
 *   （后端按字节截断尾部 262144，truncated 标记；format 黑名单二进制 409
 *   中文文案由 ApiError.message 透出，design §3.3.5）。
 * - GET /api/agent-logs/{entry_id}/messages：daemon 侧归一化**对话消息**
 *   （KB 级摘要，task-05 对话化渲染用；design §7.2）。status 一律 200 分层
 *   返回——「RPC 成功≠解析成功」：仅 parsed 渲染对话流，unsupported /
 *   parse_error / too_large 由调用方静默回落 content 端点（D-003@v1）；
 *   before_seq 向前翻更早段切片。
 * - 类型一律取 api-types.ts 生成 schema（FR-05 / X-06：snake_case 字段
 *   原样访问，禁止手写同名接口）；query key 见 lib/query-keys.ts 的
 *   agentLogs 工厂（X-17）。
 */

import { apiFetch } from "@/lib/api";
import type { components } from "@/lib/api-types";

export type AgentLogListItem = components["schemas"]["AgentLogListItem"];
export type AgentLogListResponse = components["schemas"]["AgentLogListResponse"];
export type AgentLogContentResponse =
  components["schemas"]["AgentLogContentResponse"];
export type AgentLogMessagesResponse =
  components["schemas"]["AgentLogMessagesResponse"];

/** 会话关联条目单页拉取条数（design §3.2 limit 默认 20 上限 100，取 50）。 */
export const AGENT_LOG_CARD_LIMIT = 50;

/**
 * GET /api/agent-logs — 会话关联的本地 agent 日志列表（session_id 过滤）。
 *
 * @param sessionId 会话 id（必填；只回归属该会话的上报条目，越权 scope
 *   返回空列表同既有语义，不 403 不泄漏）。
 */
export async function listAgentLogs(
  sessionId: string,
): Promise<AgentLogListResponse> {
  return apiFetch<AgentLogListResponse>("/api/agent-logs", {
    query: { session_id: sessionId, limit: AGENT_LOG_CARD_LIMIT },
  });
}

/**
 * GET /api/agent-logs/{entry_id}/content — 日志内容尾部文本。
 *
 * 失败（409 二进制黑名单 / 404 无归属 / 504 机器离线或 RPC 超时）抛
 * ApiError，中文 message 由调用方直接展示。
 */
export async function readAgentLogContent(
  entryId: string,
): Promise<AgentLogContentResponse> {
  return apiFetch<AgentLogContentResponse>(
    `/api/agent-logs/${encodeURIComponent(entryId)}/content`,
  );
}

/**
 * GET /api/agent-logs/{entry_id}/messages — 归一化对话消息（design §7.2）。
 *
 * status 四值一律 200 返回（「RPC 成功≠解析成功」语义分层）：仅 parsed 由
 * 调用方渲染对话流，unsupported / parse_error / too_large 判定后静默回落
 * content 端点（D-003@v1）。失败（404 / 409 / 422 / 502 / 504）抛 ApiError
 * 交调用方处理，与 readAgentLogContent 同口径，本函数不吞错误。
 *
 * @param entryId 日志条目 id（路径段，encodeURIComponent 编码）。
 * @param beforeSeq 可选——返回该全局段序**之前**的更早切片（向前翻页键）；
 *   省略时返回最近窗口（最近 200 段）。
 */
export async function readAgentLogMessages(
  entryId: string,
  beforeSeq?: number,
): Promise<AgentLogMessagesResponse> {
  return apiFetch<AgentLogMessagesResponse>(
    `/api/agent-logs/${encodeURIComponent(entryId)}/messages`,
    { query: { before_seq: beforeSeq } },
  );
}

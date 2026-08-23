"use client";

/**
 * 本地 agent 日志 API 封装（2026-08-23-platform-agent-log-ingest task-04）。
 *
 * - GET /api/agent-logs：sillyspec CLI（sillyhub-daemon / zcode）经
 *   POST /api/agent-logs 上报落库的 agent 本机日志元信息列表，按
 *   last_seen_at DESC NULLS LAST 排序（design §3.2）；卡片
 *   （components/daemon/agent-log-card.tsx）挂在 SessionPanelPage 消息流
 *   下方，作会话排障线索（design §3.4）。
 * - 类型一律取 api-types.ts 生成 schema（FR-05 / X-06：snake_case 字段
 *   原样访问，禁止手写同名接口）；query key 见 lib/query-keys.ts 的
 *   agentLogs 工厂（X-17）。
 */

import { apiFetch } from "@/lib/api";
import type { components } from "@/lib/api-types";

export type AgentLogListItem = components["schemas"]["AgentLogListItem"];
export type AgentLogListResponse = components["schemas"]["AgentLogListResponse"];

/** 会话详情卡片单页拉取条数（design §3.2 limit 默认 20 上限 100，卡片区取 50）。 */
export const AGENT_LOG_CARD_LIMIT = 50;

/**
 * GET /api/agent-logs — 本地 agent 日志列表。
 *
 * @param workspaceId 可选工作区过滤；省略 = 当前鉴权 scope 全部（design §3.2：
 *   不在 scope 内不 403，返回空列表不泄漏）。
 */
export async function listAgentLogs(
  workspaceId?: string,
): Promise<AgentLogListResponse> {
  return apiFetch<AgentLogListResponse>("/api/agent-logs", {
    query: workspaceId
      ? { workspace_id: workspaceId, limit: AGENT_LOG_CARD_LIMIT }
      : { limit: AGENT_LOG_CARD_LIMIT },
  });
}

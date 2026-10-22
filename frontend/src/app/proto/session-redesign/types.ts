/**
 * 真实会话导出（staged session export）的类型声明 —— dev-only 预览用。
 *
 * 依据：2026-10-20-session-page-dsh-alignment / D-010（dev 预览路由渲染真实组件）/
 * D-014（静态快照由 dev 路由 SSR 固化）/ D-017（定稿原型必须由真实组件产出）。
 *
 * 数据来源：`frontend/.proto-staging/session-export.json`（用户提供的真实会话导出，
 * 3.3 MB，21 runs / 1271 logs；2026-10-21 迁出 public/ 免鉴权静态面，见
 * ./staged-session-export.ts）。本文件只声明**消费端形状**，不引入 node:fs 等
 * 服务端依赖——server loader（./staged-session-export.ts）与客户端视图
 * （./view.tsx，`import type`）共用同一份声明。
 *
 * 形状契约以导出文件为准（session / runs / logs 三段；logs 行即产品 DTO
 * `AgentRunLogEntry`，见 frontend/src/lib/agent.ts:66）。
 */
import type { AgentRunLogEntry } from "@/lib/agent";

/** 导出里的单条 run（= AgentRun 的只读子集，字段见导出 runs[]）。 */
export interface StagedRun {
  id: string;
  /** completed / failed / killed …（映射轮终态用 runTerminalTurnStatus）。 */
  status: string;
  model: string | null;
  started_at: string | null;
  finished_at: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  diff_summary: string | null;
  error_code: string | null;
}

/** 导出里的 session 段（= AgentSessionRead 的只读子集）。 */
export interface StagedSessionMeta {
  id: string;
  title: string | null;
  runtime_id: string | null;
  provider: string;
  status: string;
  created_at: string;
  last_active_at: string | null;
  turn_count: number;
  config_snapshot: {
    profile_name?: string | null;
    provider_name?: string | null;
    model?: string | null;
    engine?: string | null;
    machine_name?: string | null;
    agent_name?: string | null;
  } | null;
}

/** 导出文件整体形状（只声明本预览消费的字段，其余忽略）。 */
export interface StagedSessionExport {
  export_version: number;
  exported_at: string;
  session: StagedSessionMeta;
  runs: StagedRun[];
  logs: AgentRunLogEntry[];
  tasks?: unknown[];
  attachments?: unknown[];
  truncated?: boolean;
  dropped_rows?: number | null;
}

/**
 * Knowledge & Quicklog API client. Mirrors backend/app/modules/knowledge/schema.py.
 */
import { apiFetch } from "@/lib/api";
import type { components } from "@/lib/api-types";

// 类型从 OpenAPI 自动生成（@/lib/api-types，由 scripts/gen-api-types.mjs 产出），
// 消除手写类型漂移。后端 schema 来源：backend/app/modules/knowledge/schema.py。
export type KnowledgeEntry = components["schemas"]["KnowledgeEntry"];
export type KnowledgeList = components["schemas"]["KnowledgeList"];
export type QuicklogEntry = components["schemas"]["QuicklogEntry"];
export type QuicklogList = components["schemas"]["QuicklogList"];
// 写侧 DTO（task-05 / 2026-09-17-knowledge-precipitation，task-04 交付的生成类型）。
export type KnowledgeProposeIn = components["schemas"]["KnowledgeProposeIn"];
export type KnowledgeUpdateIn = components["schemas"]["KnowledgeUpdateIn"];
// 审核 DTO（task-06 同变更，task-04 交付的生成类型）。
export type KnowledgeMergeIn = components["schemas"]["KnowledgeMergeIn"];
export type MergePreviewOut = components["schemas"]["MergePreviewOut"];
export type KnowledgeMergeResult = components["schemas"]["KnowledgeMergeResult"];
// 蒸馏 DTO（task-08 消费，task-07 交付的生成类型）。
export type DistillDispatchIn = components["schemas"]["DistillDispatchIn"];
export type DistillTaskRead = components["schemas"]["DistillTaskRead"];
// quick 条目级 DTO（quick-2dba0118 沉淀弹层三修消费的生成类型）。
export type DistillQuickEntryOut = components["schemas"]["DistillQuickEntryOut"];
export type DistillQuickEntryList = components["schemas"]["DistillQuickEntryList"];

/**
 * filename 路径段编码：按 `/` 分段 encodeURIComponent 拼回，不整串编码。
 *
 * filename 已扩展为 knowledge/ 下相对路径（可含子目录段，如 decisions/daemon.md，
 * task-01），整串 encodeURIComponent 会把 `/` 编成 %2F 导致后端 {filename:path}
 * 通配路由无法按段匹配（design 接口定义的编码约定）。
 */
function encodeKnowledgeFilename(filename: string): string {
  return filename
    .split("/")
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

export async function listKnowledge(
  workspaceId: string,
): Promise<KnowledgeList> {
  return apiFetch<KnowledgeList>(
    `/api/workspaces/${workspaceId}/knowledge`,
  );
}

export async function getKnowledge(
  workspaceId: string,
  filename: string,
): Promise<KnowledgeEntry> {
  return apiFetch<KnowledgeEntry>(
    `/api/workspaces/${workspaceId}/knowledge/${encodeKnowledgeFilename(filename)}`,
  );
}

/**
 * 手工录入知识候选（task-05 / FR-02）：POST /knowledge/propose，后端写
 * knowledge/proposed/<slug>.md，响应复用 KnowledgeEntry。
 */
export async function proposeKnowledge(
  workspaceId: string,
  input: KnowledgeProposeIn,
): Promise<KnowledgeEntry> {
  return apiFetch<KnowledgeEntry>(
    `/api/workspaces/${workspaceId}/knowledge/propose`,
    {
      method: "POST",
      json: input,
      // 写请求显式超时（apiFetch 仅 GET 缺省 30s；对齐 lib/daemon/sessions.ts
      // inject 先例）：后端劣化挂起时调用方 catch 展示错误而不是永久 pending。
      timeoutMs: 30_000,
    },
  );
}

/**
 * 编辑知识条目（task-05 / FR-07）：PATCH /knowledge/entries/{filename}。
 *
 * 契约为**整文件正文替换**（KnowledgeUpdateIn.content，含 frontmatter）——
 * 调用方负责保持原文 frontmatter 段不动（entry-editor 只编辑正文并在提交时
 * 拼回原 frontmatter）；decisions zone 由后端返回 422（D-006）。
 */
export async function updateKnowledge(
  workspaceId: string,
  filename: string,
  input: KnowledgeUpdateIn,
): Promise<KnowledgeEntry> {
  return apiFetch<KnowledgeEntry>(
    `/api/workspaces/${workspaceId}/knowledge/entries/${encodeKnowledgeFilename(filename)}`,
    {
      method: "PATCH",
      json: input,
      timeoutMs: 30_000,
    },
  );
}

/**
 * 审核端点的 proposed 路径段：路由模板已含 `/proposed/` 前缀（router 侧再拼回
 * `proposed/{filename}` 交给 writer），而条目 filename 本身就是
 * `proposed/<slug>.md`（含前缀）——这里剥掉前缀只传 `<slug>.md`，避免拼成
 * `/proposed/proposed/<slug>.md`。
 */
function proposedPathSegment(filename: string): string {
  return encodeKnowledgeFilename(
    filename.startsWith("proposed/") ? filename.slice("proposed/".length) : filename,
  );
}

/**
 * 合并预览（task-06 / FR-05）：POST /knowledge/proposed/{filename}/preview-merge。
 *
 * dry-run 不落盘：后端返回将追加的段落文本与 INDEX 路由行，前端弹层直接渲染
 * （零拼接，防与 dry-run 漂移）；section_skipped / index_line_skipped 为
 * dupRe 幂等守卫命中标志（design Wave 3）。
 */
export async function previewMergeKnowledge(
  workspaceId: string,
  filename: string,
  input: KnowledgeMergeIn,
): Promise<MergePreviewOut> {
  return apiFetch<MergePreviewOut>(
    `/api/workspaces/${workspaceId}/knowledge/proposed/${proposedPathSegment(filename)}/preview-merge`,
    {
      method: "POST",
      json: input,
      timeoutMs: 30_000,
    },
  );
}

/**
 * 执行合并（task-06 / FR-05 / D-007@v1）：POST /knowledge/proposed/{filename}/merge。
 *
 * 两段式时序由后端保证（段一 updates 无冲突才段二删候选），前端单次调用不拆；
 * 并发写冲突时后端返回 409（AppError details 含 conflict/server_versions，
 * R-01 契约），调用方 catch ApiError.status === 409 提示刷新重试。
 */
export async function mergeKnowledge(
  workspaceId: string,
  filename: string,
  input: KnowledgeMergeIn,
): Promise<KnowledgeMergeResult> {
  return apiFetch<KnowledgeMergeResult>(
    `/api/workspaces/${workspaceId}/knowledge/proposed/${proposedPathSegment(filename)}/merge`,
    {
      method: "POST",
      json: input,
      timeoutMs: 30_000,
    },
  );
}

/**
 * 拒绝候选（task-06 / FR-05）：POST /knowledge/proposed/{filename}/reject。
 *
 * 响应 204 无正文（apiFetch 对空 body 返回 null），这里以 void 收口。
 */
export async function rejectKnowledge(
  workspaceId: string,
  filename: string,
): Promise<void> {
  await apiFetch<null>(
    `/api/workspaces/${workspaceId}/knowledge/proposed/${proposedPathSegment(filename)}/reject`,
    {
      method: "POST",
      timeoutMs: 30_000,
    },
  );
}

/**
 * 派发蒸馏任务（task-08 / FR-01 / FR-03 / D-002@v1；D-009/D-010 扩展）：
 * POST /knowledge/distill。
 *
 * 后端源校验（无记录会话 / 未归档变更 / ql 文件缺失 → 422）后创建
 * knowledge-distill 类 AgentRun 并 fire-and-forget 派发（daemon 离线时任务
 * 创建成功但立即收敛为 failed，经任务列表可见）；响应复用 DistillTaskRead
 * （创建时刻 pending；resume 被降级守卫改写时 mode/degraded_reason 为实际值）。
 *
 * D-009 续接分流：mode="resume" 仅会话源可选（原会话 inject/reopen 续接；
 * 引擎不支持 / 状态不可 reopen 自动降级 fresh 并记 degraded_reason）；
 * change/quick 无原会话概念，强制 fresh。D-010③ fresh 配置：
 * runtime_id（钉机器，优先于 agent_type）/ agent_type（provider）/
 * agent_profile_id / model，缺省回落 workspace.default_agent/default_model
 * （对齐 create_session 双入口）。quick 多选时 source_ref 传 list[str]。
 * 入参即生成版 DistillDispatchIn（禁手写窄化类型），调用方按 mode 组装。
 */
export async function dispatchDistill(
  workspaceId: string,
  input: DistillDispatchIn,
): Promise<DistillTaskRead> {
  return apiFetch<DistillTaskRead>(
    `/api/workspaces/${workspaceId}/knowledge/distill`,
    {
      method: "POST",
      json: input,
      timeoutMs: 30_000,
    },
  );
}

/**
 * 蒸馏任务列表（task-08）：GET /knowledge/distill/tasks。
 *
 * 该工作区全部 knowledge-distill 类任务按 created_at 倒序（含终态历史，
 * 进行中过滤归任务条渲染层）。除基础五字段外投影 mode / agent_session_id /
 * merged_to / degraded_reason（D-009/D-010）：merged_to 为「目标文件#小节标题」
 * 双键反链（未合并=null）；degraded_reason 为 resume 降级原因（未降级=null）；
 * 列表投影不含 error_code/错误信息（task-07 契约），失败原因前端不可区分，
 * 统一按「daemon 离线或执行中断」文案提示。已沉淀反链（弹层来源列表
 * 「已沉淀 ↗」标签）亦以本端点按 source_ref 匹配判定。
 */
export async function listDistillTasks(
  workspaceId: string,
): Promise<DistillTaskRead[]> {
  return apiFetch<DistillTaskRead[]>(
    `/api/workspaces/${workspaceId}/knowledge/distill/tasks`,
  );
}

/**
 * quicklog 条目级列表（quick-2dba0118 沉淀弹层三修之一）：GET
 * /knowledge/distill/quick-entries。
 *
 * quicklog 的真实形态是**单文件多条目**（QUICKLOG-*.md 内 `## <ql-id> | 日期 |
 * 标题` 节）——GET /quicklog 的文件级列表（listQuicklog）只返回文件，选不出
 * 具体条目（「只能选一个」的根因）。本端点投影条目视图（ref/title/date，
 * 按ref 倒序最新在前），蒸馏弹层 quick 源多选单位 = ref（source_ref list 元素，
 * 后端 dispatch 同根校验）。listQuicklog 及其文件语义消费者零改动。
 */
export async function listQuickEntries(
  workspaceId: string,
): Promise<DistillQuickEntryList> {
  return apiFetch<DistillQuickEntryList>(
    `/api/workspaces/${workspaceId}/knowledge/distill/quick-entries`,
  );
}

/**
 * 快速修复文件列表（D-010② quick 蒸馏来源）：GET /quicklog。
 *
 * 返回 ql 文件条目（filename 为 basename 如 ql-20260917-002-a5c0.md）；
 * 已沉淀反链亦需要本列表 + listDistillTasks 联合判定（弹层来源列表
 * 「已沉淀 ↗」标签，task-08 扩展）。quick-2dba0118 起 quick 蒸馏源多选
 * 改用条目级 listQuickEntries，本端点保留给文件语义消费者（零改动）。
 */
export async function listQuicklog(
  workspaceId: string,
): Promise<QuicklogList> {
  return apiFetch<QuicklogList>(
    `/api/workspaces/${workspaceId}/quicklog`,
  );
}

export async function getQuicklog(
  workspaceId: string,
  filename: string,
): Promise<QuicklogEntry> {
  return apiFetch<QuicklogEntry>(
    `/api/workspaces/${workspaceId}/quicklog/${encodeURIComponent(filename)}`,
  );
}

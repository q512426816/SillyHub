/**
 * Knowledge & Quicklog API client. Mirrors backend/app/modules/knowledge/schema.py.
 */
import { apiFetch } from "@/lib/api";
import type { components, operations } from "@/lib/api-types";

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
// 运营指标 DTO（task-04 / 2026-09-20-knowledge-effect-panel 消费，task-01 交付
// 的生成类型）。
export type KnowledgeStatsOut = components["schemas"]["KnowledgeStatsOut"];

// ── 知识图谱 DTO（task-05 / 2026-10-08-platform-knowledge-graph；后端三端点
// schema.py 为真相源，本组全部取自生成类型零手写）──────────────────────────────
// data 分型（五查询主链路 + summary/nodes 直通 + overview 组装）。
export type GraphNodeRef = components["schemas"]["GraphNodeRef"];
export type GraphEdge = components["schemas"]["GraphEdge"];
export type GraphHop = components["schemas"]["GraphHop"];
export type GraphNeighborsData = components["schemas"]["GraphNeighborsData"];
export type GraphPathData = components["schemas"]["GraphPathData"];
export type GraphDecisionRef = components["schemas"]["GraphDecisionRef"];
export type GraphRejectedRef = components["schemas"]["GraphRejectedRef"];
export type GraphImpactData = components["schemas"]["GraphImpactData"];
export type GraphOrphanItem = components["schemas"]["GraphOrphanItem"];
export type GraphOrphansData = components["schemas"]["GraphOrphansData"];
export type GraphDanglingItem = components["schemas"]["GraphDanglingItem"];
export type GraphDanglingData = components["schemas"]["GraphDanglingData"];
export type GraphCluster = components["schemas"]["GraphCluster"];
export type GraphSummary = components["schemas"]["GraphSummary"];
export type GraphOverviewData = components["schemas"]["GraphOverviewData"];
export type GraphNodesData = components["schemas"]["GraphNodesData"];
// 三端点响应信封（data 按 sub 分型联合 / overview / nodes）。
export type GraphQueryOut =
  components["schemas"]["GraphEnvelope_Union_GraphNeighborsData__GraphPathData__GraphImpactData__GraphOrphansData__GraphDanglingData__GraphSummary__GraphNodesData__"];
export type GraphOverviewOut =
  components["schemas"]["GraphEnvelope_GraphOverviewData_"];
export type GraphNodesOut = components["schemas"]["GraphEnvelope_GraphNodesData_"];
// reason 六稳定键与 sub 七值——后端是 Literal 别名（无独立 schema），从生成
// 信封 / 生成 operations 参数提取，保持零手写单一源。
export type GraphReason = NonNullable<GraphOverviewOut["reason"]>;
export type GraphSub =
  operations["get_knowledge_graph_query_api_workspaces__workspace_id__knowledge_graph_query_get"]["parameters"]["query"]["sub"];
// 全图 dump DTO（task-04 / 2026-10-09-knowledge-graph-fullmap / D-002@v1；后端
// schema.py GraphDump* 为真相源，生成类型零手写）。节点带 CLI 预计算确定性
// 布局坐标（x/y），stats 与 summary 同源聚合。
export type GraphDumpNode = components["schemas"]["GraphDumpNode"];
export type GraphDumpData = components["schemas"]["GraphDumpData"];
export type GraphDumpOut =
  components["schemas"]["GraphEnvelope_GraphDumpData_"];

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
 * 知识运营指标（task-04 / 2026-09-20-knowledge-effect-panel / FR-02 / FR-03 /
 * D-009 / D-008@v3）：GET /knowledge/stats。
 *
 * 后端实时聚合（条目全集 × {inject, fr-inject} 命中行）：覆盖率（+8 周趋势）/
 * 死条目（90 天零命中清单）/ 每任务命中密度 / 新知识生效速度 + 使用率榜全量
 * （per_task 为次/任务浮点原值，% 格式化为前端展示职责——ops-dashboard 的
 * formatPerTaskPct）+ 文件级计数（文件级 🔥 徽标数据源，task-05 消费）。
 * 未部署新 daemon 的端 hits 不上行，返回零值指标（前端空态「暂无使用数据」）。
 */
export async function getKnowledgeStats(
  workspaceId: string,
): Promise<KnowledgeStatsOut> {
  return apiFetch<KnowledgeStatsOut>(
    `/api/workspaces/${workspaceId}/knowledge/stats`,
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

/**
 * 知识治理信号（2026-09-27-knowledge-governance-cards 三层治理②层平台出口）：
 * GET /knowledge/governance——三类信号（rot 待复核/收件箱积压/伪域 auto-*）超阈才见人。
 * 类型本地声明（api-types.ts 带并行会话未提交改动、gen:types 守卫拦再生成——
 * 该会话落地后可切换 components["schemas"] 生成式，形状与 backend GovernanceOut 一致）。
 */
export type GovernanceSignal = {
  kind: string;
  title: string;
  count: number;
  detail: string;
  suggestion: string;
};

export type GovernanceOut = {
  healthy: boolean;
  signals: GovernanceSignal[];
  totals: Record<string, number>;
  /** v2（2026-09-27-governance-rpc-actions）：daemon-rpc=CLI 单源直采，local=回退计算 */
  source?: string;
  actions_available?: boolean;
};

export async function getKnowledgeGovernance(
  workspaceId: string,
): Promise<GovernanceOut> {
  return apiFetch<GovernanceOut>(
    `/api/workspaces/${workspaceId}/knowledge/governance`,
  );
}

/**
 * 治理动作执行（v2 ②，2026-09-27-governance-rpc-actions）：信号卡按钮 →
 * POST /knowledge/governance/actions → daemon 白名单执行（repair-paths / redomain）。
 */
export type GovernanceActionKind = "repair-paths" | "redomain";

export async function postKnowledgeGovernanceAction(
  workspaceId: string,
  body: { kind: GovernanceActionKind; from_domain?: string; to_domain?: string },
): Promise<{ output: string }> {
  return apiFetch<{ output: string }>(
    `/api/workspaces/${workspaceId}/knowledge/governance/actions`,
    { method: "POST", json: body },
  );
}

/**
 * 知识图查询（task-05 / 2026-10-08-platform-knowledge-graph / FR-01 / D-001@v2 /
 * D-007@v1）：GET /knowledge/graph/query。
 *
 * 五查询主链路（neighbors/path/impact/orphans/dangling）+ summary/nodes 兜底
 * 直通，数据经 daemon RPC 直采 CLI 单源真相（无本地回退）。HTTP 200 恒回信封：
 * available=false 时 data=null + reason 六稳定键，调用方按 available+reason
 * 分支不弹错；data 按 sub 分型（GraphNeighborsData 等联合），调用方收窄。
 * anchor/anchor2 走查询串编码（URLSearchParams 按段转义，`/` 含 %2F 对查询
 * 参数合法——与 encodeKnowledgeFilename 的路径段编码是两个面）。
 */
export interface KnowledgeGraphQueryParams {
  /** 锚点（neighbors/path 起点等；path 终点用 anchor2）。 */
  anchor?: string;
  /** path 查询终点。 */
  anchor2?: string;
  /** 边型过滤（枚举 ∪ all；缺省 all）。 */
  edges?: string;
  /** 遍历深度，钳 1-3（缺省 1）。 */
  depth?: number;
}

export async function getKnowledgeGraphQuery(
  workspaceId: string,
  sub: GraphSub,
  params?: KnowledgeGraphQueryParams,
): Promise<GraphQueryOut> {
  const qs = new URLSearchParams({ sub });
  if (params?.anchor !== undefined) qs.set("anchor", params.anchor);
  if (params?.anchor2 !== undefined) qs.set("anchor2", params.anchor2);
  if (params?.edges !== undefined) qs.set("edges", params.edges);
  if (params?.depth !== undefined) qs.set("depth", String(params.depth));
  // 超时对齐服务端 RPC 预算（2026-10-09 风险审查）：backend GRAPH_RPC_TIMEOUT=60s，
  // apiFetch GET 缺省 30s 会先于服务端判死 abort，大仓慢查询恒走错误分支。
  return apiFetch<GraphQueryOut>(
    `/api/workspaces/${workspaceId}/knowledge/graph/query?${qs.toString()}`,
    { timeoutMs: 90_000 },
  );
}

/**
 * 知识图总览（task-05 / D-008@v2）：GET /knowledge/graph/overview。
 *
 * 后端内部按序发 summary→orphans→dangling 三 RPC 逐条容错：summary 子块失败
 * 仅置 null（旧 CLI，前端 lite 面隐藏）；orphans/dangling_count 子块失败置
 * null（前端显示「—」）；全失败整信封 available=false（reason 分支）。图卡
 * （ops-dashboard）与图谱页共用同一 query key 共享缓存。
 */
export async function getKnowledgeGraphOverview(
  workspaceId: string,
): Promise<GraphOverviewOut> {
  // 超时对齐服务端 RPC 预算（2026-10-09 风险审查）：overview 内部按序发
  // summary→orphans→dangling 三 RPC（各 GRAPH_RPC_TIMEOUT=60s，最坏 180s），
  // apiFetch GET 缺省 30s 在大仓（全量建图秒级-分钟级）恒先 abort → 整页
  // 降级「暂不可用」；显式 200s 留超时余量，让服务端逐条容错语义生效。
  return apiFetch<GraphOverviewOut>(
    `/api/workspaces/${workspaceId}/knowledge/graph/overview`,
    { timeoutMs: 200_000 },
  );
}

/**
 * 知识图节点搜索（task-05 / D-005@v1）：GET /knowledge/graph/nodes。
 *
 * 锚点自动补全数据源（id/label 不区分大小写包含匹配）；旧 CLI 时信封
 * unavailable（data=null），调用方静默禁用补全不阻塞自由输入。search 后端
 * 校验 1-200 字符、limit 钳 1-50（缺省 20）。
 */
export async function getKnowledgeGraphNodes(
  workspaceId: string,
  search: string,
  limit?: number,
): Promise<GraphNodesOut> {
  const qs = new URLSearchParams({ search });
  if (limit !== undefined) qs.set("limit", String(limit));
  return apiFetch<GraphNodesOut>(
    `/api/workspaces/${workspaceId}/knowledge/graph/nodes?${qs.toString()}`,
  );
}

/**
 * 全图 dump（task-04 / 2026-10-09-knowledge-graph-fullmap / FR-03 / FR-04 /
 * D-002@v1）：GET /knowledge/graph/dump。
 *
 * CLI 离线预计算坐标的全量节点/边/聚合一次性下发（daemon 不裁剪），后端手动
 * gzip 压缩传输（浏览器 fetch 原生透明解压）。全量回包可达 MB 级——GET 缺省
 * 30s 超时不够，显式 timeoutMs 60s（大回包先例：仅此端点放宽）。HTTP 200 恒回
 * 信封：available=false（reason=upgrade_required 等）时 data=null，调用方按
 * available+reason 分支回退既有链路不弹错。
 */
export async function getKnowledgeGraphDump(
  workspaceId: string,
): Promise<GraphDumpOut> {
  return apiFetch<GraphDumpOut>(
    `/api/workspaces/${workspaceId}/knowledge/graph/dump`,
    { timeoutMs: 60_000 },
  );
}

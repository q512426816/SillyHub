/**
 * 会话输入联想数据源 hooks。
 *
 * 变更 2026-08-26-session-input-mention task-04（FR-01/FR-04，NFR-01）。
 * 变更 2026-08-28-session-ppm-task-binding task-06（FR-02/FR-05，D-001@v1 /
 *   D-002@v1 / X-06）：@ 联想新增「PPM 任务」「PPM 问题」两分组。
 *
 * 复用既有查询为联想浮层（task-02 session-mention-popover）供数：
 *   - 技能源：custom-skills.ts usePlatformSkillsManifest（与 workspace 无关，
 *     staleTime 内部已 5 分钟），manifest skills 用空数组兜底；
 *   - 变更源：changes.ts listChanges（location=active 活跃未归档）；
 *   - 快速修复源：quicklog.ts listQuicklogEntries；
 *   - PPM 任务源：ppm/task.ts listPersonalPlanTasks（status=["进行中"]，
 *     personal 端点按当前登录用户过滤，user_id 由后端从 token 注入）；
 *   - PPM 问题源：ppm/problem.ts listProblems（duty_user_id=当前登录用户 +
 *     status=["进行中"]，对齐 PPM「我的任务」口径）。
 *
 * 各路挂载即拉取（等价 prefetch）+ staleTime 5 分钟，输入过程零网络请求
 * （design §5 数据流 / R-6）。workspaceId 为空时变更/快速修复/PPM 查询
 * enabled=false 且 atEnabled=false（@ 联想整体禁用而非抛错；PPM 分组不单独
 * 放开，X-06——PPM 实体与工作区为软关联多对多，条目不按会话 workspace
 * 过滤，但门控沿用）；default 伪 change_key 与 placeholder 快速修复条目不进
 * 列表（对齐会话列表关联筛选惯例，session-list-panel.tsx 同款过滤）。
 *
 * PPM 状态口径（D-002@v1）：ppmScope 参数默认 "ongoing"（仅进行中），可切
 * "all"（全状态可关联）——状态维度进缓存键（queryKeys.mentionSources.ppm*），
 * 切开关即换键重新拉取。PPM 两路映射为 MentionPpmItem 归一形态（useMemo
 * 稳定引用——桥回流按元素身份比较，未记忆的新对象会触发回流环）。
 *
 * 注意：技能列表仅消费 name/description 等现有字段，不读取 invoke_name
 * （该类型字段 task-08 才加入，避免并行期类型冲突）。
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";
import { usePlatformSkillsManifest } from "./custom-skills";
import { listChanges, type ChangeList } from "./changes";
import { listQuicklogEntries, type QuicklogEntryList } from "./quicklog";
import { listPersonalPlanTasks } from "./ppm/task";
import { listProblems } from "./ppm/problem";
import type { PageResp, PlanTask, ProblemList } from "./ppm/types";
import { useSession } from "@/stores/session";
import type { MentionPpmItem } from "./session-mention";
import { queryKeys } from "./query-keys";

/** 联想数据源 staleTime：5 分钟（挂载 prefetch，输入零请求）。 */
const MENTION_SOURCES_STALE_TIME = 5 * 60_000;

/** 联想列表单页上限（对齐 session-list-panel 关联筛选下拉 pageSize=100 惯例）。 */
const MENTION_SOURCES_PAGE_SIZE = 100;

/** PPM 分组状态口径（D-002@v1）：ongoing=仅进行中（默认）/ all=全状态可关联。 */
export type PpmMentionScope = "ongoing" | "all";

/**
 * 过滤变更源 placeholder 条目。
 * default 是 CLI 伪 change_key（design §2），无真实变更行，联想与绑定均跳过。
 */
function filterMentionChanges(items: ChangeList["items"]): ChangeList["items"] {
  return items.filter((c) => c.change_key !== "default");
}

/** 过滤快速修复源占位条目（placeholder=true 的 QUICKLOG 占位行，客户端兜底）。 */
function filterMentionQuicklogs(
  items: QuicklogEntryList["items"],
): QuicklogEntryList["items"] {
  return items.filter((q) => !q.placeholder);
}

/** PlanTask → MentionPpmItem（任务标题取 content；空回退 id 短码）。 */
function toMentionPpmTask(t: PlanTask): MentionPpmItem {
  return {
    kind: "plan_task",
    id: t.id,
    title: t.content?.trim() || `任务 ${t.id.slice(0, 8)}`,
    projectName: t.project_name ?? null,
    subtitle: t.task_description ?? null,
  };
}

/** ProblemList → MentionPpmItem（问题标题取 pro_desc；空回退 id 短码）。 */
function toMentionPpmProblem(p: ProblemList): MentionPpmItem {
  return {
    kind: "problem",
    id: p.id,
    title: p.pro_desc?.trim() || `问题 ${p.id.slice(0, 8)}`,
    projectName: p.project_name ?? null,
    subtitle: p.func_name?.trim()
      ? [p.func_name.trim(), p.pro_type?.trim()].filter(Boolean).join(" · ")
      : (p.pro_type ?? null),
  };
}

/**
 * 会话输入联想数据源（/ 技能 + @ 变更/快速修复/PPM 任务/PPM 问题）。
 *
 * @param workspaceId 会话所属工作区 id；为空（""/null/undefined）时 @ 数据源
 *   禁用（零请求、atEnabled=false），/ 技能源不受影响
 * @param ppmScope PPM 分组状态口径（D-002@v1）：缺省 "ongoing" 仅进行中，
 *   "all" 全状态——进缓存键，切开关换键重拉（task-03 接线层持有开关状态）
 * @returns skills 技能摘要列表；changes 变更列表（已滤 default 伪条目）；
 *   quicklogs 快速修复列表（已滤 placeholder）；ppmTasks/ppmProblems PPM
 *   归一条目列表（标注 projectName）；atEnabled @ 联想是否可用
 */
export function useMentionSources(
  workspaceId: string | null | undefined,
  ppmScope: PpmMentionScope = "ongoing",
) {
  const wid =
    typeof workspaceId === "string" && workspaceId.length > 0 ? workspaceId : null;
  const atEnabled = wid !== null;

  // 当前登录用户（PPM 问题源 duty_user_id 过滤；任务走 personal 端点由后端
  // 从 token 注入，不依赖此值）。未登录（user=null）时问题源禁用——不传
  // duty_user_id 会退化为全量问题清单，宁可无分组不出错数据。
  const me = useSession((s) => s.user?.id ?? null);

  // 技能源：/ 联想与 workspace 无关，挂载即拉取（staleTime 5min 由
  // usePlatformSkillsManifest 内部设置，此处不重复覆盖）。
  const { manifest } = usePlatformSkillsManifest();

  // 变更源：location=active 服务端过滤活跃未归档（对齐关联筛选惯例）。
  const changesQuery = useQuery<ChangeList, ApiError>({
    queryKey: queryKeys.mentionSources.changes(wid),
    queryFn: () => listChanges(wid as string, {
      location: "active",
      pageSize: MENTION_SOURCES_PAGE_SIZE,
    }),
    enabled: atEnabled,
    staleTime: MENTION_SOURCES_STALE_TIME,
  });

  // 快速修复源：placeholder 过滤为客户端兜底（后端默认不返回占位行）。
  const quicklogsQuery = useQuery<QuicklogEntryList, ApiError>({
    queryKey: queryKeys.mentionSources.quicklogs(wid),
    queryFn: () =>
      listQuicklogEntries(wid as string, {
        page_size: MENTION_SOURCES_PAGE_SIZE,
      }),
    enabled: atEnabled,
    staleTime: MENTION_SOURCES_STALE_TIME,
  });

  // PPM 任务源：personal 端点按当前登录用户过滤；不按会话 workspace 过滤
  // 条目（软关联多对多），enabled 沿用 atEnabled（X-06 不单独放开）。
  const ppmStatusParam = ppmScope === "ongoing" ? ["进行中"] : undefined;
  const ppmTasksQuery = useQuery<PageResp<PlanTask>, ApiError>({
    queryKey: queryKeys.mentionSources.ppmTasks(ppmScope),
    queryFn: () =>
      listPersonalPlanTasks({
        status: ppmStatusParam,
        page: 1,
        page_size: MENTION_SOURCES_PAGE_SIZE,
      }),
    enabled: atEnabled,
    staleTime: MENTION_SOURCES_STALE_TIME,
  });

  // PPM 问题源：duty_user_id=当前用户 + status 过滤（对齐 PPM「我的任务」
  // 口径）；me 未就绪时禁用（防退化为全量问题清单）。
  const ppmProblemsQuery = useQuery<PageResp<ProblemList>, ApiError>({
    queryKey: queryKeys.mentionSources.ppmProblems(ppmScope),
    queryFn: () =>
      listProblems({
        duty_user_id: me ?? undefined,
        status: ppmStatusParam,
        page: 1,
        page_size: MENTION_SOURCES_PAGE_SIZE,
      }),
    enabled: atEnabled && me !== null,
    staleTime: MENTION_SOURCES_STALE_TIME,
  });

  // PPM 归一映射必须 useMemo 稳定引用：桥回流按元素身份比较（isSameMentionSources），
  // 裸 map 每渲染产新对象会触发「桥 effect → 父 setState」回流环。
  const ppmTasks = useMemo(
    () => (ppmTasksQuery.data?.items ?? []).map(toMentionPpmTask),
    [ppmTasksQuery.data],
  );
  const ppmProblems = useMemo(
    () => (ppmProblemsQuery.data?.items ?? []).map(toMentionPpmProblem),
    [ppmProblemsQuery.data],
  );

  return {
    skills: manifest?.skills ?? [],
    changes: filterMentionChanges(changesQuery.data?.items ?? []),
    quicklogs: filterMentionQuicklogs(quicklogsQuery.data?.items ?? []),
    ppmTasks,
    ppmProblems,
    atEnabled,
  };
}

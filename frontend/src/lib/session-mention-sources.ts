/**
 * 会话输入联想数据源 hooks。
 *
 * 变更 2026-08-26-session-input-mention task-04（FR-01/FR-04，NFR-01）。
 *
 * 复用三路既有查询为联想浮层（task-02 session-mention-popover）供数：
 *   - 技能源：custom-skills.ts usePlatformSkillsManifest（与 workspace 无关，
 *     staleTime 内部已 5 分钟），manifest skills 用空数组兜底；
 *   - 变更源：changes.ts listChanges（location=active 活跃未归档）；
 *   - 快速修复源：quicklog.ts listQuicklogEntries。
 *
 * 三路挂载即拉取（等价 prefetch）+ staleTime 5 分钟，输入过程零网络请求
 * （design §5 数据流 / R-6）。workspaceId 为空时变更与快速修复查询
 * enabled=false 且 atEnabled=false（@ 联想禁用而非抛错）；default 伪
 * change_key 与 placeholder 快速修复条目不进列表（对齐会话列表关联筛选
 * 惯例，session-list-panel.tsx 同款过滤）。
 *
 * 注意：技能列表仅消费 name/description 等现有字段，不读取 invoke_name
 * （该类型字段 task-08 才加入，避免并行期类型冲突）。
 */
import { useQuery } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";
import { usePlatformSkillsManifest } from "./custom-skills";
import { listChanges, type ChangeList } from "./changes";
import { listQuicklogEntries, type QuicklogEntryList } from "./quicklog";
import { queryKeys } from "./query-keys";

/** 联想数据源 staleTime：5 分钟（挂载 prefetch，输入零请求）。 */
const MENTION_SOURCES_STALE_TIME = 5 * 60_000;

/** 联想列表单页上限（对齐 session-list-panel 关联筛选下拉 pageSize=100 惯例）。 */
const MENTION_SOURCES_PAGE_SIZE = 100;

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

/**
 * 会话输入联想数据源（/ 技能 + @ 变更/快速修复）。
 *
 * @param workspaceId 会话所属工作区 id；为空（""/null/undefined）时 @ 数据源
 *   禁用（零请求、atEnabled=false），/ 技能源不受影响
 * @returns skills 技能摘要列表；changes 变更列表（已滤 default 伪条目）；
 *   quicklogs 快速修复列表（已滤 placeholder）；atEnabled @ 联想是否可用
 */
export function useMentionSources(workspaceId: string | null | undefined) {
  const wid =
    typeof workspaceId === "string" && workspaceId.length > 0 ? workspaceId : null;
  const atEnabled = wid !== null;

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

  return {
    skills: manifest?.skills ?? [],
    changes: filterMentionChanges(changesQuery.data?.items ?? []),
    quicklogs: filterMentionQuicklogs(quicklogsQuery.data?.items ?? []),
    atEnabled,
  };
}

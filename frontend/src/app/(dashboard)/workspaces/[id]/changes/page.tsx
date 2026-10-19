"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Checkbox, Drawer, Input, Pagination, Select } from "antd";

import { PageContainer } from "@/components/layout";
import {
  EmptyState,
  IssueRow,
  IssueRowHeader,
  PageHead,
  StateLabel,
  UnderlineNav,
  type StateLabelVariant,
} from "@/components/primer";
import { Button, buttonVariants } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { ChangeStepBadge } from "@/components/changes/change-step-badge";
import { ChangeActivityBadge } from "@/components/changes/change-activity-badge";
import { CommitTypeChip } from "@/components/changes/commit-type-chip";
import { PlatformSyncSection } from "@/components/changes/platform-sync-section";
import { QuicklogDrawer } from "@/components/changes/quicklog-drawer";
import { QuicklogTable } from "@/components/changes/quicklog-table";
import {
  DeleteChangeConfirm,
  canDeleteChange,
  useChangeDeleteAccess,
} from "@/components/delete-change-confirm";
import { ApiError } from "@/lib/api";
import type { components } from "@/lib/api-types";
import { listQuicklogEntries, type QuicklogEntryListItem } from "@/lib/quicklog";
import {
  deleteChange,
  listChanges,
  reparseChanges,
  type ChangeList,
  type ChangeReparseStats,
  type ChangeSummary,
  type ChangeWarning,
} from "@/lib/changes";
import { useNotify } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { getWorkspace, type Workspace } from "@/lib/workspaces";

interface Props {
  params: { id: string };
}

// 2026-10-07-hide-quicklog-tab：quick 通道已退役（CLI v3.30.0），「快速修复」tab
// 从栏内移除；quicklog 仍是合法 tab 值——?tab=quicklog 深链进存量只读视图
// （概览统计卡 / 详情关联卡入口依赖），仅不再常驻渲染。
const TABS = [
  { key: "active", label: "进行中" },
  { key: "archive", label: "已归档" },
] as const;

type ChangesTab = "active" | "archive" | "quicklog";

// ── 列表状态 URL 快照（2026-10-16-change-center-back-keeps-list-state）────────
// tab/页码/筛选原本只活在 useState——点行整页导航进详情后，详情页「变更列表」返回
// 入口客户端导航回无参 /changes，组件重挂载状态全丢（用户实证：已归档 tab/第 N 页
// 回不去）。本变更把全部查询状态同步进 URL（replaceState 快照，不产生历史条目），
// 挂载时从 URL 初始化——从详情返回（back 到带 query 的列表 URL）后状态恢复不依赖
// bfcache。UI 状态单一源仍是 useState，URL 只是恢复快照（挂载后不反向订阅）。

/** 防御解析正整数（URL 恢复用）：非数字/非正整数回退 fallback。 */
function parsePositiveInt(v: string | null, fallback: number): number {
  if (v === null) return fallback;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** 深链 tab 合法值（与 useState 初始化口径一致，非法回 active）。 */
function parseTab(v: string | null): ChangesTab {
  return v === "quicklog" || v === "archive" ? v : "active";
}

/**
 * 构造列表状态 querystring（写回用）：空值/默认值参数省略——默认状态 URL 干净。
 * 参数名固定：tab / search / stage / lineage / type / mine / sort / page / pageSize。
 * 导出供详情页返回测试钉两端参数名契约（back 目标 query ↔ 本页解析端）。
 */
export function buildChangesQuery(s: {
  tab: ChangesTab;
  search: string;
  stageFilter: string;
  lineageFilter: string;
  typeFilter: string;
  focusMine: boolean;
  sortDir: SortDir;
  page: number;
  pageSize: number;
}): string {
  const p = new URLSearchParams();
  if (s.tab !== "active") p.set("tab", s.tab);
  if (s.search) p.set("search", s.search);
  if (s.stageFilter) p.set("stage", s.stageFilter);
  if (s.lineageFilter) p.set("lineage", s.lineageFilter);
  if (s.typeFilter) p.set("type", s.typeFilter);
  if (s.focusMine) p.set("mine", "1");
  if (s.sortDir !== "updated_at_desc") p.set("sort", s.sortDir);
  if (s.page !== 1) p.set("page", String(s.page));
  if (s.pageSize !== 20) p.set("pageSize", String(s.pageSize));
  return p.toString();
}

// task-06 / design §7：待办徽标映射（替代死代码 GATE_LABELS）。
// 数据源 = ChangeSummary.pending_review（PG 镜像 _map 投影，task-03）+ status=blocked。
// 纯前端展示映射，后端 task-03 已统一投影为 4 个新取值（不再 need_* 兼容）。
export const PENDING_REVIEW_LABEL: Record<string, string> = {
  proposal_review: "待提案审核",
  plan_review: "待计划审核",
  human_test: "待人工测试",
  archive_confirm: "待归档确认",
};

const STAGE_OPTIONS = [
  { value: "", label: "全部阶段" },
  { value: "brainstorm", label: "需求分析" },
  { value: "plan", label: "规划" },
  { value: "execute", label: "执行" },
  { value: "verify", label: "验证" },
  { value: "archive", label: "归档" },
  // 2026-10-14-change-center-lineage-tag-and-filter：「轻量变更」（thin）选项
  // 移除——出身分类查询职责迁移至下方「分类」下拉（lineage 参数三分支精确口径，
  // 归档 thin 行 stage 翻 archived 后旧 current_stage=thin 精确匹配筛不出）。
] as const;

// 2026-10-14-change-center-lineage-tag-and-filter：出身分类筛选（lineage 参数）。
// 空值 = 全部分类不过滤；thin/full 与后端 _is_thin_lineage 三分支投影口径一致
// （筛「轻量变更」在已归档 tab 同样能命中归档兜底行）。
const LINEAGE_OPTIONS = [
  { value: "", label: "全部分类" },
  { value: "full", label: "完整变更" },
  { value: "thin", label: "轻量变更" },
] as const;

// 2026-10-18-change-list-type-filter：类型筛选（type 参数，conventional 前缀 +
// 原型旧值）。feat 后端等价命中旧值 feature（存量行不漏筛）；值集与后端
// _CHANGE_TYPE_FILTER_WHITELIST 对齐（前端仅列常用项，防止下拉过长）。
const TYPE_OPTIONS = [
  { value: "", label: "全部类型" },
  { value: "feat", label: "feat（功能）" },
  { value: "fix", label: "fix（修复）" },
  { value: "docs", label: "docs（文档）" },
  { value: "chore", label: "chore（杂务）" },
  { value: "test", label: "test（测试）" },
  { value: "refactor", label: "refactor（重构）" },
  { value: "perf", label: "perf（性能）" },
  { value: "build", label: "build（构建）" },
  { value: "style", label: "style（样式）" },
  { value: "prototype", label: "原型" },
] as const;

// ── 「执行」列（task-08 / FR-05 / D-004@v1，视觉对齐 prototype-change-center-
// usage.html 场景一 .exec-cell）──────────────────────────────────────────
// 与 quicklog-table.tsx 的同名列互为镜像实现（allowed_paths 不含公共模块文件，
// 不抽公共组件）；token/次数格式化 helper 复制自会话页 session-usage-bar.tsx
// 私有先例（同款写法），耗时/起止时间为本列新增。

/** 列表「执行」列用量摘要（api-types 生成，禁止手写）。 */
type UsageSummaryRead = components["schemas"]["UsageSummaryRead"];

/** token 数紧凑格式化（session-usage-bar formatTokensCompact 同款；ql-20260904-012
 * 单位统一 K/M 废除「万」）：>= 1M →「X.XM」；>= 1K →「X.XK」（一位小数）；K 以下原值直显。 */
export function formatTokensCompact(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** 请求次数千分位（计数语义不做 K/M 缩写，session-usage-bar 同款）。 */
export function formatCount(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString("en-US") : "0";
}

/** 耗时紧凑中文格式化（原型「3.6 小时 / 34 分钟」）：>= 1 小时一位小数，
 * 不足 1 小时取整分钟（不足 1 分钟按 1 分钟起步）；null/缺 →「—」。 */
export function formatDurationZh(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms >= 3_600_000) return `${(ms / 3_600_000).toFixed(1)} 小时`;
  return `${Math.max(1, Math.round(ms / 60_000))} 分钟`;
}

/** 相对时间（原型 issue-side 口径）：N 分钟/小时/天前；超 30 天回退完整日期。 */
function formatRelativeZh(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  const m = Math.floor(diffMs / 60_000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const day = Math.floor(h / 24);
  if (day <= 30) return `${day} 天前`;
  return d.toLocaleDateString("zh-CN");
}

/** 起止时间悬浮段格式（原型「08-28 10:12」）：本地时区 MM-DD HH:mm；
 * 畸形串防御性降级「—」（对齐 change-activity-badge 的畸形时间戳先例）。 */
function formatMmDdHm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * UsageExecCell —— 「执行」列单元格：紧凑两行（首行耗时 + 可选「进行中」
 * 小标记，次行 token 总量·次数），整格 title 悬浮起止时间（无值段显示
 * 「—」，进行中时结束段显示「进行中」）。
 *
 * usage 判空分两档：null（后端显式无关联执行，D-004@v1）→「—」占位；
 * undefined（字段整体缺失：旧后端响应 / mock 未带）→ 整格不渲染——对齐
 * 本页操作列先例（无权行不加「—」，避免与待办/负责人列占位叠加）。
 */
function UsageExecCell({
  usage,
  showTurns = false,
  compact = false,
}: {
  usage?: UsageSummaryRead | null;
  /** quicklog 列表次行追加「N 轮」（totals.num_turns），本页不启用。 */
  showTurns?: boolean;
  /** 2026-09-27 visual-align-2：右列单行模式（原型 .issue-side .cost 口径）。 */
  compact?: boolean;
}) {
  if (usage === undefined) return null;
  if (usage === null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  // 进行中 = started_at 有值且 finished_at 缺（R-05 时间三元组语义）
  const running = Boolean(usage.started_at) && !usage.finished_at;
  if (compact) {
    const tokenTotalC =
      usage.totals.input_tokens +
      usage.totals.output_tokens +
      usage.totals.cache_read_tokens +
      usage.totals.cache_creation_tokens;
    return (
      <span className="whitespace-nowrap">
        {formatTokensCompact(tokenTotalC)} tok · {formatCount(usage.totals.api_requests)} 次
      </span>
    );
  }
  // token 总量 = totals 四维之和（input + output + cache_read + cache_creation）
  const tokenTotal =
    usage.totals.input_tokens +
    usage.totals.output_tokens +
    usage.totals.cache_read_tokens +
    usage.totals.cache_creation_tokens;
  const counts = showTurns
    ? `${formatCount(usage.totals.api_requests)} 次 · ${formatCount(usage.totals.num_turns)} 轮`
    : `${formatCount(usage.totals.api_requests)} 次`;
  const title = `开始 ${
    usage.started_at ? formatMmDdHm(usage.started_at) : "—"
  } · 结束 ${
    usage.finished_at ? formatMmDdHm(usage.finished_at) : running ? "进行中" : "—"
  }`;
  return (
    <div className="whitespace-nowrap" title={title}>
      <div className="flex items-center gap-1">
        <span className="text-[11px] font-semibold tabular-nums text-foreground">
          {formatDurationZh(usage.duration_ms)}
        </span>
        {running && (
          <span className="rounded-full bg-brand-50 px-1.5 py-px text-[10px] font-medium text-brand-700">
            进行中
          </span>
        )}
      </div>
      <div className="text-[11px] tabular-nums text-muted-foreground">
        {`${formatTokensCompact(tokenTotal)} tok · ${counts}`}
      </div>
    </div>
  );
}

// 排序方向（task-06 / D-004）：默认最近活动优先。
type SortDir = "updated_at_desc" | "updated_at_asc";

// ── 智能轮询纯函数（task-06 / design §5 Phase 2.4 / Grill #2，导出供测试）──────
//
// 终态可测试定义：status === "archived" || location === "archive"（changes 表仅
// active/archived 两值，无 failed——失败语义在 steps 层由 7 值枚举承载）。

/** 单条变更终态判定（design §5 Phase 2.4）。 */
export function isTerminalChange(
  c: Pick<ChangeSummary, "status" | "location">,
): boolean {
  return c.status === "archived" || c.location === "archive";
}

/** 当前页存在任一非终态变更（停轮判定：全终态 → false；数据未到也不轮）。 */
export function hasActiveChanges(
  data: ChangesPageData | undefined,
): boolean {
  if (!data) return false;
  return data.items.some((c) => !isTerminalChange(c));
}

/** 列表轮询间隔（D-001@v1）：非终态存在 → 30s；全终态 / 无数据 → false 停轮。 */
export const CHANGES_POLL_INTERVAL_MS = 30_000;

// task-12（design §8.1）：活动停滞阈值（30min）——与上方 CHANGES_POLL_INTERVAL_MS
// 同属展示层常量，此处同点重导出供测试/消费方与轮询间隔一处取用；真值表与
// 防御解析实现在 change-activity-badge.tsx（徽标组件领地，避免页面↔组件循环依赖）。
export { ACTIVITY_STALE_MS } from "@/components/changes/change-activity-badge";

/** refetchInterval 决策函数（导出供单测两分支：非终态 30000 / 全终态 false）。 */
export function changesRefetchInterval(
  data: ChangesPageData | undefined,
): number | false {
  return hasActiveChanges(data) ? CHANGES_POLL_INTERVAL_MS : false;
}

/** 主 load 响应：变更分页 + 并发拉取的 workspace（原 Promise.all 装配，R-07 保持）。 */
type ChangesPageData = ChangeList & { workspace: Workspace };

export default function ChangesPage({ params }: Props) {
  const workspaceId = params.id;
  const queryClient = useQueryClient();
  // task-10（FR-07）：支持 ?tab=quicklog 初始 tab（变更详情页「关联的快速任务」跳转入口）；
  // ?search= 初始搜索词（quicklog 关联变更列跳转消费端，QA P2 修复）。
  // 2026-10-16-change-center-back-keeps-list-state：扩到全部查询状态从 URL 初始化
  // （page/pageSize/stage/lineage/mine/sort，防御解析回默认）——从详情返回/刷新后状态保持。
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<ChangesTab>(() => parseTab(searchParams.get("tab")));
  const [searchInput, setSearchInput] = useState(() => searchParams.get("search") ?? "");
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  // ql-20260818-004：「只看待我处理」下放为查询条件（仅进行中视图），默认不勾选
  const [focusMine, setFocusMine] = useState(() => searchParams.get("mine") === "1");
  // 2026-09-28-change-ux-detail-batch：平台同步处理区抽屉开关（常驻卡收进按钮）
  const [syncDrawerOpen, setSyncDrawerOpen] = useState(false);
  const [stageFilter, setStageFilter] = useState(() => {
    const v = searchParams.get("stage") ?? "";
    return STAGE_OPTIONS.some((o) => o.value === v) ? v : "";
  });
  // 2026-10-14-change-center-lineage-tag-and-filter：出身分类筛选（"" = 全部分类）
  const [lineageFilter, setLineageFilter] = useState(() => {
    const v = searchParams.get("lineage") ?? "";
    return LINEAGE_OPTIONS.some((o) => o.value === v) ? v : "";
  });
  // 2026-10-18-change-list-type-filter：类型筛选（"" = 全部类型；与出身分类正交）
  const [typeFilter, setTypeFilter] = useState(() => {
    const v = searchParams.get("type") ?? "";
    return TYPE_OPTIONS.some((o) => o.value === v) ? v : "";
  });
  const [sortDir, setSortDir] = useState<SortDir>(() =>
    searchParams.get("sort") === "updated_at_asc" ? "updated_at_asc" : "updated_at_desc",
  );
  const [page, setPage] = useState(() => parsePositiveInt(searchParams.get("page"), 1));
  const [pageSize, setPageSize] = useState(() => {
    const v = parsePositiveInt(searchParams.get("pageSize"), 20);
    return ([10, 20, 50, 100] as number[]).includes(v) ? v : 20;
  });
  const [reparsing, setReparsing] = useState(false);
  // task-07（design §6.3 / FR-05d）：受控删除弹层 target（null = 关闭，
  // 照 admin/users DeleteConfirm 受控范式），确认后关弹层 + deleteMutation。
  const [deleteTarget, setDeleteTarget] = useState<ChangeSummary | null>(null);
  // task-09（D-006）：quicklog 行点击打开详情抽屉
  const [quicklogSelected, setQuicklogSelected] =
    useState<QuicklogEntryListItem | null>(null);
  // reparse 错误横幅（主 load 错误改由 query 派生，见 listError）
  const [pageError, setPageError] = useState<string | null>(null);
  const [stats, setStats] = useState<ChangeReparseStats | null>(null);
  const [warnings, setWarnings] = useState<ChangeWarning[]>([]);

  // 状态 → URL 写回（2026-10-16-change-center-back-keeps-list-state）：原生
  // history.replaceState 快照——不新增历史条目、不触发 Next RSC 导航（UI 单一源仍是
  // useState，此处只写恢复快照）；目标与当前地址相同则跳过（挂载首跑零操作）。
  // 浏览器后退语义与改造前一致：列表内翻页本就不产生历史条目，后退仍离开列表。
  useEffect(() => {
    const qs = buildChangesQuery({
      tab,
      search,
      stageFilter,
      lineageFilter,
      typeFilter,
      focusMine,
      sortDir,
      page,
      pageSize,
    });
    const target =
      `/workspaces/${workspaceId}/changes` + (qs ? `?${qs}` : "");
    if (window.location.pathname + window.location.search !== target) {
      window.history.replaceState(window.history.state, "", target);
    }
  }, [tab, search, stageFilter, lineageFilter, typeFilter, focusMine, sortDir, page, pageSize, workspaceId]);

  // 主 load（task-06 / D-004@v1：裸 useEffect+useState 改 useQuery）。
  // queryKey = workspaceId + 全部请求参数（tab/search/stageFilter/sortDir/
  // pendingReviewOnly/page/pageSize），任一变化即新查询自动重取——请求参数与
  // 改造前逐项一致（R-07）。queryFn 保持原 Promise.all（listChanges 全参 +
  // getWorkspace，task-11 / 2026-07-10-remove-server-local-workspace-mode：平台
  // 统一 daemon-client 语义，前端不再校验 daemon 在线状态）。
  const changesQuery = useQuery({
    queryKey: [
      "changes",
      workspaceId,
      {
        location: tab,
        search,
        currentStage: stageFilter,
        lineage: lineageFilter,
        changeType: typeFilter,
        sort: sortDir,
        // D-007：进行中 + 聚焦 → 只看待我处理（pending_review 非空）
        pendingReviewOnly: tab === "active" && focusMine,
        page,
        pageSize,
      },
    ],
    queryFn: async (): Promise<ChangesPageData> => {
      const [resp, ws] = await Promise.all([
        listChanges(workspaceId, {
          location: tab,
          search: search || undefined,
          currentStage: stageFilter || undefined,
          lineage: lineageFilter || undefined,
          changeType: typeFilter || undefined,
          sort: sortDir,
          pendingReviewOnly: tab === "active" && focusMine,
          page,
          pageSize,
        }),
        getWorkspace(workspaceId),
      ]);
      return { ...resp, workspace: ws };
    },
    // task-08（D-001）：quicklog tab 不发变更列表请求（QuicklogTable 自带独立查询）
    enabled: tab !== "quicklog",
    // 分页/筛选切 key 时保留上一页数据渲染（改造前 items 不清空、不闪空表）
    placeholderData: keepPreviousData,
    // 智能轮询（D-001@v1）：当前页存在非终态变更 30s 刷新，全终态停轮；
    // refetchIntervalInBackground 默认 false = 页面不可见暂停；structuralSharing
    // 默认开——响应内容不变时引用相等，DataTable rowKey="id" 行不重渲染（R-04 不乱跳）。
    refetchInterval: (query) => changesRefetchInterval(query.state.data),
  });

  const items = changesQuery.data?.items ?? [];
  const total = changesQuery.data?.total ?? 0;
  const workspace = changesQuery.data?.workspace ?? null;

  // 页码超界钳回（2026-10-16-change-center-delete-back-keeps-state）：删除/并发变更
  // 使总数缩水后，URL 恢复的（或停留的）page 可能超过最后一页——真实响应页空时自动
  // 钳回 ceil(total/pageSize) 并重取。isPlaceholderData 守卫：keepPreviousData 下
  // placeholder 是上一页数据，不能用于判空。total=0（真空列表）与 page 未超界不动作
  // （空状态展示维持现状）；quicklog tab 主查询禁用，不参与。
  useEffect(() => {
    if (tab === "quicklog") return;
    if (!changesQuery.isSuccess || changesQuery.isPlaceholderData) return;
    const totalNow = changesQuery.data?.total ?? 0;
    const itemsNow = changesQuery.data?.items?.length ?? 0;
    if (itemsNow > 0 || totalNow <= 0 || page <= 1) return;
    const lastPage = Math.max(1, Math.ceil(totalNow / pageSize));
    if (page > lastPage) setPage(lastPage);
  }, [changesQuery.data, changesQuery.isSuccess, changesQuery.isPlaceholderData, tab, page, pageSize]);

  // ── 删除入口（task-07 / design §6.3 / FR-05d）──────────────────────────
  // 可见性启发式（owner 本人 / 平台管理员 / 工作区所有者）——仅控制按钮显隐，
  // 后端 DELETE 组合权限为权威（判漏 403 兜底走 onError toast）。
  const notify = useNotify();
  const deleteAccess = useChangeDeleteAccess(workspaceId);
  const deleteMutation = useMutation({
    mutationFn: (c: ChangeSummary) => deleteChange(workspaceId, c.id),
    onSuccess: async (_resp, c) => {
      notify.success(`变更 ${c.change_key} 已删除`);
      // ["changes", workspaceId] 前缀失效（列表/各 tab 分页同前缀全刷，页面
      // 既有范式 :276-278；location='deleted' 行不进 active/archive 两 tab，
      // 行从当前 tab 消失）。tab 计数 changesTabTotals 不在此前缀（对齐
      // reparse 既有语义，不额外失效）。
      await queryClient.invalidateQueries({
        queryKey: ["changes", workspaceId],
      });
    },
    onError: (err) => {
      // 403（无权限）/404（不存在）/409（已删幂等）统一中文 toast（errMessage
      // 取 ApiError.message，不白屏）
      notify.error(err, "删除变更失败");
    },
  });
  // loading = 挂起态（首载/切 key 无数据可显时转圈）；后台轮询与同参 refetch
  // 不闪 loading（antd spinner 会造成整表重渲染抖动，与 R-04 不乱跳目标相悖）
  const loading = changesQuery.isPending;
  // 主 load 错误语义保持（R-07）：ApiError 取 err.message，否则「加载变更列表失败」
  const listError = changesQuery.isError
    ? changesQuery.error instanceof ApiError
      ? changesQuery.error.message
      : "加载变更列表失败"
    : null;
  // 顶部红条取主 load 错误优先，其次 reparse 横幅错误（原 listError ?? pageError 就地表达式）
  const bannerError = listError ?? pageError;

  // tab 计数（进行中=不聚焦的总数 M；已归档=archive total），用于 tab 挂数量 + 副标题 M。
  // 独立 useQuery（key 不含 filter/聚焦）：filter/聚焦变化不重发，tab 计数稳定不被
  // 污染；不轮询、失败静默（非关键，与原 effect 的 catch 行为一致）。首次无值时
  // tab 不显示计数，请求完成后回填。
  const tabTotalsQuery = useQuery({
    queryKey: ["changesTabTotals", workspaceId],
    queryFn: async (): Promise<{
      active: number;
      archive: number;
      quicklog: number;
    }> => {
      // task-08（D-001）：第三 tab 计数=快速修复条目数；ql-20260820-008 起含空壳
      // 占位（与表格默认显示口径一致，计数不与列表脱节）
      const [a, b, q] = await Promise.all([
        listChanges(workspaceId, { location: "active", pageSize: 1 }),
        listChanges(workspaceId, { location: "archive", pageSize: 1 }),
        listQuicklogEntries(workspaceId, { include_placeholder: true, page_size: 1 }),
      ]);
      return { active: a.total, archive: b.total, quicklog: q.total };
    },
    retry: false,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });
  const tabTotals: { active?: number; archive?: number; quicklog?: number } =
    tabTotalsQuery.data ?? {};

  // 旧 load() 每次执行先清错误横幅：新数据到达时收敛 reparse 错误横幅（语义对齐）。
  useEffect(() => {
    setPageError(null);
  }, [changesQuery.dataUpdatedAt]);

  const handleSearchClick = () => {
    const noChange = searchInput === search && page === 1;
    setSearch(searchInput);
    setPage(1);
    // 参数未变（queryKey 不变，react-query 不会自动重取）→ 手动 refetch，保持
    // 旧「同参重查」行为
    if (noChange) void changesQuery.refetch();
  };

  const handleResetClick = () => {
    setSearchInput("");
    setSearch("");
    setStageFilter("");
    // 2026-10-14-change-center-lineage-tag-and-filter：分类筛选一并回默认
    setLineageFilter("");
    // 2026-10-18-change-list-type-filter：类型筛选一并回默认
    setTypeFilter("");
    // ql-20260818-004：聚焦下放查询条件后，重置一并回默认（不勾选）
    setFocusMine(false);
    setPage(1);
  };

  const handleTabChange = (newTab: ChangesTab) => {
    if (newTab === tab) return;
    setTab(newTab);
    setPage(1);
  };

  const toggleSort = () => {
    setSortDir((prev) =>
      prev === "updated_at_desc" ? "updated_at_asc" : "updated_at_desc",
    );
    setPage(1);
  };

  const handleReparse = async () => {
    setReparsing(true);
    setPageError(null);
    try {
      const resp = await reparseChanges(workspaceId);
      setStats(resp.stats);
      setWarnings(resp.warnings ?? []);
      // 旧 load() 只刷主列表（tabTotals 不随 reparse 刷新）：失效主列表 key 前缀
      // ["changes", workspaceId]（不含 changesTabTotals），等价替换且 await 语义一致
      await queryClient.invalidateQueries({
        queryKey: ["changes", workspaceId],
      });
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "重新解析失败");
    } finally {
      setReparsing(false);
    }
  };

  // 待办徽标（D-007 / design §7）：blocked 优先，否则 pending_review 投影；
  // primer StateLabel 承载（attention+clock=等待语义，error=阻塞），文本口径不变。
  const renderTodoBadge = (c: ChangeSummary): ReactNode => {
    if (c.status === "blocked") {
      return (
        <StateLabel variant="error">阻塞中</StateLabel>
      );
    }
    if (c.pending_review && PENDING_REVIEW_LABEL[c.pending_review]) {
      return (
        <StateLabel variant="attention" iconName="clock">
          {PENDING_REVIEW_LABEL[c.pending_review]}
        </StateLabel>
      );
    }
    return null;
  };

  // IssueRow 状态映射（FR-03 / design 第二层状态语义）：
  // 终态（archived/location=archive，isTerminalChange 同款双条件）→ merged 合并勾；
  // blocked → error；待办 → attention(clock)；其余进行中 → open 开圆。
  const changeRowState = (c: ChangeSummary): StateLabelVariant => {
    if (isTerminalChange(c)) return "merged";
    // 2026-09-27：轻量出身（后端 is_thin 投影，含 stage=thin 与 quick 分流）行图标=琥珀闪电。
    if (c.is_thin === true || c.current_stage === "thin") return "attention";
    if (c.status === "blocked") return "error";
    if (c.pending_review) return "attention";
    return "open";
  };

  // 负责人渲染（task-05 / FR-04，2026-08-16-change-owner-from-token →
  // 2026-10-13-change-owner-backfill）四态语义：
  // owner_name → 首字头像 + 名字文本（此前只显首字小圆，不悬浮认不出是谁）；
  // owner_id → ID 前 8 位 mono 文本；双空 → 兜底工作区所有者名字（reparse 主力
  // 路径建行 owner 恒空是历史大面积缺口的根因，新建行后端已兜底，存量行走此
  // 展示层兜底，title 标注兜底语义）；全链无值 → "—"。
  const renderOwner = (c: ChangeSummary): ReactNode => {
    if (c.owner_name) {
      return (
        <span
          title={`负责人 ${c.owner_name}`}
          className="flex items-center gap-1 whitespace-nowrap"
        >
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-primary"
            style={{ backgroundColor: "var(--color-brand-50)" }}
          >
            {c.owner_name.slice(0, 1).toUpperCase()}
          </span>
          <span className="text-xs text-foreground">{c.owner_name}</span>
        </span>
      );
    }
    if (c.owner_id) {
      return (
        <span
          title={`负责人 ${c.owner_id}`}
          className="whitespace-nowrap font-mono text-xs text-muted-foreground"
        >
          {c.owner_id.slice(0, 8)}
        </span>
      );
    }
    const fallbackName = workspace?.owner?.display_name;
    if (fallbackName) {
      return (
        <span
          title={`负责人未指派，默认工作区所有者 ${fallbackName}`}
          className="flex items-center gap-1 whitespace-nowrap"
        >
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-primary"
            style={{ backgroundColor: "var(--color-brand-50)" }}
          >
            {fallbackName.slice(0, 1).toUpperCase()}
          </span>
          <span className="text-xs text-muted-foreground">{fallbackName}</span>
        </span>
      );
    }
    return <span className="text-xs text-muted-foreground">—</span>;
  };

  // 单行渲染（2026-09-27 visual-align-2：对齐原型 issue-row 排版）：
  // 主行 = 标题 14px/600 链接色 + 待办胶囊；副行 = key mono 12px 灰 · 组件胶囊 · 活动徽标；
  // 右列 = 阶段胶囊 + 头像 + 消耗 mono + 相对时间（min-width 右对齐，原型 .issue-side 口径）。
  const renderChangeRow = (c: ChangeSummary): ReactNode => (
    <IssueRow
      key={c.id}
      state={changeRowState(c)}
      onClick={() => {
        // 行级导航保持 Link 语义：整行点击进详情（链接本身也保留可点）。
        window.location.assign(`/workspaces/${workspaceId}/changes/${c.id}`);
      }}
      title={
        <>
          <Link
            href={`/workspaces/${workspaceId}/changes/${c.id}`}
            prefetch={false}
            className="text-sm font-semibold leading-5 text-primary hover:underline"
            // 2026-09-28-audit-risk-fixes：阻冒泡——否则 Link 的客户端导航与行
            // onClick 的 location.assign 竞争（整页刷新胜出，SPA 切换失效）。
            onClick={(e) => e.stopPropagation()}
          >
            {c.title || c.change_key}
          </Link>
          {/* 2026-09-27-change-list-is-thin：轻量出身徽章（后端 is_thin 投影）——
              归档轻量行「轻量」与状态图标并存（对齐详情页双徽章口径）。
              2026-10-14-change-center-lineage-tag-and-filter：成对补「完整」中性
              徽章（!is_thin）——完整流程变更此前无标签，两类出身一眼可辨；
              is_thin 为后端投影必带 bool（缺省 False），undefined 防御归入完整。 */}
          {c.is_thin === true ? (
            <StateLabel variant="attention">轻量</StateLabel>
          ) : (
            <StateLabel variant="neutral">完整</StateLabel>
          )}
          {renderTodoBadge(c)}
          {/* 2026-09-28-change-list-description：变更描述行（proposal 动机段提取，
              后端回填）——title 归一化后常回退 key 派生名，此前行内只剩 change_key
              可辨。basis-full 让描述独占 flex-wrap 一行；truncate 单行截断，悬浮
              title 看全文；无描述（旧行/无动机段）零占位。
              2026-09-28-change-ux-detail-batch：补 min-w-0——flex 项默认
              min-width:auto，长文本 nowrap 撑破行宽、溢出覆盖右列阶段/时间与
              meta 行影响模块 chips（用户实证）；min-w-0 允许收缩，truncate 生效。 */}
          {c.description && (
            <span
              title={c.description}
              className="basis-full min-w-0 truncate text-xs font-normal text-muted-foreground"
            >
              {c.description}
            </span>
          )}
        </>
      }
      meta={
        <>
          <span className="font-mono text-xs text-muted-foreground">
            {c.change_key}
          </span>
          {/* 2026-10-18-change-list-type-filter：类型彩色标签（与详情页「类型」行
              同源 CommitTypeChip；无类型旧行零占位） */}
          {c.change_type && <CommitTypeChip type={c.change_type} />}
          {c.affected_components.length > 0 &&
            c.affected_components.map((comp) => (
              <span
                key={comp}
                className="rounded-full border px-1.5 font-mono text-xs leading-4 text-muted-foreground"
                style={{ borderColor: "hsl(var(--border))" }}
              >
                {comp}
              </span>
            ))}
          <ChangeActivityBadge
            currentStepStatus={c.step_progress?.current_step_status ?? null}
            lastPushedAt={c.last_pushed_at ?? null}
          />
        </>
      }
      right={
        <>
          <ChangeStepBadge
            stage={c.current_stage ?? "scan"}
            stepProgress={c.step_progress ?? null}
          />
          {renderOwner(c)}
          <span
            style={{ minWidth: 112 }}
            className="whitespace-nowrap text-right font-mono text-xs text-muted-foreground"
          >
            <UsageExecCell usage={c.usage} compact />
          </span>
          <span
            style={{ minWidth: 72 }}
            className="whitespace-nowrap text-right text-xs text-muted-foreground"
          >
            {formatRelativeZh(c.updated_at)}
          </span>
        </>
      }
      hoverActions={
        canDeleteChange(c, deleteAccess) ? (
          <Button
            size="sm"
            variant="ghost"
            data-testid="change-delete-entry"
            className="text-muted-foreground hover:text-destructive"
            // 2026-09-28-audit-risk-fixes：阻冒泡——否则点击冒泡到行 div 的
            // location.assign 整页导航，删除确认弹层被页面卸载吞掉（列表页删除
            // 入口实际不可用；workspace-card stopFooter 同款防护）。
            onClick={(e) => {
              e.stopPropagation();
              setDeleteTarget(c);
            }}
          >
            删除
          </Button>
        ) : null
      }
    />
  );

  // 副标题（task-06）：workspace 名 + 计数。
  // 聚焦时 N=total（当前待我处理），M=tabTotals.active（进行中总数，单独 useQuery 拉）。
  const renderSubtitle = (): ReactNode => {
    const wsName = workspace?.name ?? "—";
    if (tab === "quicklog") {
      // 存量口径（2026-09-25-change-center-thin-flow task-09）：quick 通道已退役，
      // 计数只含存量条目；新工作走变更列表「轻量变更」。
      const n = tabTotals.quicklog;
      return n !== undefined
        ? `${wsName} · ${n} 条存量快速修复记录（旧 quick 通道已退役）`
        : `${wsName} · 存量快速修复记录（旧 quick 通道已退役）`;
    }
    if (tab === "archive") {
      return `${wsName} · 已归档变更`;
    }
    const m = tabTotals.active;
    if (focusMine) {
      const n = total;
      if (m !== undefined) {
        return `${wsName} · ${n} 个变更正在等你处理（共 ${m} 个进行中）`;
      }
      // 首次未拉到 M 时降级（只显示 N）
      return `${wsName} · ${n} 个变更正在等你处理`;
    }
    return `${wsName} · 共 ${total} 个进行中`;
  };

  // 空状态（分场景，对齐原型 ③）
  // task-09 / FR-04a（D-001@v1）：删「+ 新建变更」入口后，进行中空态引导去会话页
  // （/workspaces/[id]/sessions），由 agent 在会话里自动立项并推进；「重新扫描」仍在
  // PageHeader 作全量兜底（FR-04c）。archive 空态不引导（归档无新建语义）。
  const sessionGuide = (
    <div className="mt-3 flex flex-col items-center gap-1.5">
      <span className="text-xs text-muted-foreground">
        还没有进行中的变更。去会话跟 agent 对话，描述你的需求，agent 会自动立项并推进。
      </span>
      <Link
        href={`/workspaces/${workspaceId}/sessions`}
        className={cn(buttonVariants({ variant: "default", size: "sm" }))}
      >
        去会话页
      </Link>
    </div>
  );
  const renderEmpty = (): ReactNode => {
    if (items.length > 0) return null;
    // 有 filter 无匹配 → 简短文案（不显示 CTA，避免误导）
    if (search || stageFilter || lineageFilter || typeFilter) {
      return (
        <div className="py-10 text-center text-xs text-muted-foreground">
          没有匹配的变更。
        </div>
      );
    }
    if (tab === "active" && focusMine) {
      return (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <div className="text-[15px] font-medium text-foreground">
            🎉 暂无待你处理的变更
          </div>
          <div className="text-xs text-muted-foreground">
            所有变更都在正常推进，或已全部处理完。
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setFocusMine(false)}
          >
            查看全部进行中
          </Button>
          {sessionGuide}
        </div>
      );
    }
    if (tab === "active" && !focusMine) {
      return (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <div className="text-[15px] font-medium text-foreground">
            当前没有进行中的变更
          </div>
          {sessionGuide}
        </div>
      );
    }
    // archive
    return (
      <div className="py-10 text-center text-[15px] font-medium text-foreground">
        还没有归档的变更
      </div>
    );
  };

  return (
    <PageContainer size="full">
      {/* 四层结构（FR-03 / 原型「变更中心」视图）：页头 → 工具条 → 状态 tab → 行式列表。
          2026-09-30-breadcrumb-dedupe-zh：页头不再渲染「工作区名 / 变更中心」页内
          面包屑——顶栏已有【工作区 > 变更中心】同位信息，页内重复。 */}
      <PageHead
        title="变更中心"
        subtitle={renderSubtitle()}
        actions={
          // FR-04c：删「+ 新建变更」后，「重新扫描」保留作全量兜底（含 scoped 不做删除的收敛）
          <Button
            size="sm"
            variant="outline"
            onClick={handleReparse}
            disabled={reparsing}
          >
            {reparsing ? "解析中…" : "重新扫描"}
          </Button>
        }
      />

      {bannerError && <ErrorBanner message={bannerError} />}

      {/* 条件区收敛（FR-03 / G-2）：reparse 结果与解析警告合并为单条可折叠 flash 条；
          无内容零占位。PlatformSyncSection 自渲染 null（无冲突时）。 */}
      {(stats || warnings.length > 0) && (
        <div className="flex flex-col gap-1.5 rounded-md border px-3 py-2 text-xs"
          style={{ borderColor: "hsl(var(--warning))", backgroundColor: "var(--semantic-warning-soft)" }}
        >
          {stats && (
            <div className="text-foreground">
              已重新扫描：解析 {stats.parsed}，新增 {stats.created} · 更新{" "}
              {stats.updated} · 删除 {stats.deleted}。
              {warnings.length > 0 && ` ${warnings.length} 个警告。`}
            </div>
          )}
          {warnings.length > 0 && (
            <details>
              <summary className="cursor-pointer text-warning">解析警告（{warnings.length}）</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-warning">
                {warnings.map((w, i) => (
                  <li key={i}>
                    <span className="font-mono">[{w.code}]</span>{" "}
                    {w.change_key ?? "—"}: {w.detail}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* 平台同步处理区（2026-09-04-conflict-resolve-entry task-09 / FR-01~05）：
          2026-09-28-change-ux-detail-batch（用户裁决）——自常驻卡收进工具条按钮
          （搜索/重置旁）+ 右侧抽屉承载：零冲突零 ghost 时整卡是常驻噪音；
          有未决冲突 / ghost 时仍应可达，按钮常驻。 */}
      <Drawer
        open={syncDrawerOpen}
        onClose={() => setSyncDrawerOpen(false)}
        title="平台同步"
        width={460}
        destroyOnHidden
      >
        <PlatformSyncSection workspaceId={workspaceId} drawerHint />
      </Drawer>

      {/* 工具条（FR-03）：一行式筛选——搜索/阶段/聚焦（进行中）+ 搜索/重置 */}
      {tab !== "quicklog" && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-2"
          style={{
            borderColor: "hsl(var(--border))",
            backgroundColor: "hsl(var(--muted))",
          }}
        >
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="搜索 Key / 标题 / 描述 / 组件…"
            allowClear
            onPressEnter={() => handleSearchClick()}
            className="w-64"
          />
          <Select
            aria-label="筛选阶段"
            value={stageFilter}
            onChange={(v) => setStageFilter(v ?? "")}
            className="w-36"
          >
            {STAGE_OPTIONS.map((opt) => (
              <Select.Option key={opt.value} value={opt.value}>
                {opt.label}
              </Select.Option>
            ))}
          </Select>
          {/* 2026-10-14-change-center-lineage-tag-and-filter：出身分类下拉
              （完整/轻量，lineage 参数三分支口径） */}
          <Select
            aria-label="筛选分类"
            value={lineageFilter}
            onChange={(v) => {
              setLineageFilter(v ?? "");
              setPage(1);
            }}
            className="w-32"
          >
            {LINEAGE_OPTIONS.map((opt) => (
              <Select.Option key={opt.value} value={opt.value}>
                {opt.label}
              </Select.Option>
            ))}
          </Select>
          {/* 2026-10-18-change-list-type-filter：类型下拉（conventional 前缀 +
              原型；feat 后端等价命中旧值 feature） */}
          <Select
            aria-label="筛选类型"
            value={typeFilter}
            onChange={(v) => {
              setTypeFilter(v ?? "");
              setPage(1);
            }}
            className="w-40"
          >
            {TYPE_OPTIONS.map((opt) => (
              <Select.Option key={opt.value} value={opt.value}>
                {opt.label}
              </Select.Option>
            ))}
          </Select>
          {tab === "active" && (
            <Checkbox
              checked={focusMine}
              onChange={(e) => {
                setFocusMine(e.target.checked);
                setPage(1);
              }}
            >
              只看待我处理
            </Checkbox>
          )}
          <div className="ml-auto flex items-center gap-2">
            {/* 2026-09-28-change-ux-detail-batch：平台同步入口（常驻卡收进抽屉） */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSyncDrawerOpen(true)}
            >
              平台同步
            </Button>
            <Button size="sm" onClick={handleSearchClick}>
              搜索
            </Button>
            <Button size="sm" variant="outline" onClick={handleResetClick}>
              重置
            </Button>
          </div>
        </div>
      )}

      {/* 状态 tab（FR-03 UnderlineNav）：计数实时联动；quicklog tab 已隐藏
          （2026-10-07-hide-quicklog-tab），存量视图经 ?tab=quicklog 深链进入 */}
      <UnderlineNav<ChangesTab>
        value={tab}
        onChange={handleTabChange}
        items={TABS.map((t) => ({
          key: t.key,
          label: t.label,
          counter: t.key === "active" ? tabTotals.active : tabTotals.archive,
        }))}
      />

      {/* task-08（D-001/FR-05）：快速修复 tab——独立查询区 + QuicklogTable */}
      {tab === "quicklog" && <QuicklogTable workspaceId={workspaceId} onSelect={setQuicklogSelected} />}

      {/* task-09（FR-06/D-006）：quicklog 条目详情抽屉 */}
      <QuicklogDrawer
        entry={quicklogSelected}
        workspaceId={workspaceId}
        onClose={() => setQuicklogSelected(null)}
      />

      {/* 行式列表（FR-03 antd Table 退役）：表头排序 + IssueRow 行 + EmptyState + 分页 */}
      {tab !== "quicklog" && (
        <>
          <div className="overflow-hidden rounded-lg border" style={{ borderColor: "hsl(var(--border))" }}>
            <IssueRowHeader
              title="变更"
              right={
                <button
                  type="button"
                  onClick={toggleSort}
                  className="inline-flex items-center gap-0.5 hover:underline"
                  title="点击切换升序/降序"
                >
                  更新时间
                  <span aria-hidden>{sortDir === "updated_at_desc" ? "↓" : "↑"}</span>
                </button>
              }
            />
            {loading ? (
              <div className="py-10 text-center text-xs text-muted-foreground">
                加载中…
              </div>
            ) : items.length === 0 ? (
              renderEmpty()
            ) : (
              <div className="divide-y" style={{ borderColor: "hsl(var(--border))" }}>
                {items.map((c) => renderChangeRow(c))}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between border-t pt-2" style={{ borderColor: "hsl(var(--border))" }}>
            <span className="text-xs text-muted-foreground">
              显示 {items.length} / {total} 条
            </span>
            <Pagination
              current={page}
              pageSize={pageSize}
              total={total}
              showSizeChanger
              pageSizeOptions={[10, 20, 50, 100]}
              showTotal={(t) => `共 ${t} 条`}
              onChange={(p, s) => {
                setPage(p);
                setPageSize(s);
              }}
            />
          </div>
        </>
      )}

      {/* task-07：删除确认弹层（受控 target，null = 关闭；确认先关弹层再
          deleteMutation——403/404/409 失败路径走 onError toast，不重开弹层） */}
      {deleteTarget && (
        <DeleteChangeConfirm
          target={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            const target = deleteTarget;
            setDeleteTarget(null);
            deleteMutation.mutate(target);
          }}
        />
      )}
    </PageContainer>
  );
}

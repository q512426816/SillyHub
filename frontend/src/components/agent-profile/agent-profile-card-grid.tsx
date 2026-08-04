"use client";

/**
 * AgentProfileCardGrid — 智能体档案卡片墙（搜索 + 三筛选 + 网格）。
 *
 * 变更 2026-08-04-agent-profile-ui-redesign task-03 / D-002。
 *
 * 全局页与工作区内页复用（design §5 P3 / §7.2 组件签名）：
 *  - 全局页（不传 workspaceId/scopedToWorkspace）：用 useMineAgentProfiles，
 *    数据 = 当前 actor 跨工作区可见全集（AgentProfileAggregatedItem[]）。
 *  - 工作区内页（传 workspaceId + scopedToWorkspace）：用 useWorkspaceAgentProfiles，
 *    数据 = 该 ws 可见档案（AgentProfileRead[]，结构兼容 AggregatedItem，workspace_name 缺省）。
 *
 * 数据源切换用两个内层 wrapper 组件分别调各自 hook（避免条件式 hook 调用）。
 *
 * 筛选（FRONTEND_PAGE_STYLE §3：选择型 onChange 即查，文本型按回车才查）：
 *  - 搜索：Input onPressEnter 回车触发，匹配 name 或 system_prompt（大小写不敏感）
 *  - 工作区 Select：选项从 profiles 的 workspace_name 去重派生；scopedToWorkspace=true 隐藏
 *  - 可见范围 Select：private/workspace/platform
 *  - 供应商 Select：选项从 profiles 的 provider 去重派生
 *
 * 网格：tailwind grid-cols-3 gap-4 对齐原型画面① repeat(3,1fr)（design §3 非目标：
 * 不做响应式移动端，固定 3 列）。
 * 空态：antd Empty。加载失败：红条 + 重新加载（FRONTEND_PAGE_STYLE §9）。
 *
 * 设计依据：tasks/task-03.md §implementation / design §7.2 / §10 R-02 /
 * FRONTEND_PAGE_STYLE.md §0/§3/§9。
 */
import { useMemo, useState } from "react";
import { Empty, Input, Select, Spin } from "antd";
import { SearchOutlined } from "@ant-design/icons";

import { AgentProfileCard } from "./agent-profile-card";
import { AgentProfilePreview } from "./agent-profile-preview";
import {
  VISIBILITY_LABEL,
  useMineAgentProfiles,
  useWorkspaceAgentProfiles,
  type AgentProfileAggregatedItem,
  type AgentProfileVisibility,
} from "@/lib/agent-profiles";
import type { ApiError } from "@/lib/api";

/**
 * 单个档案回调（编辑/复制/删除）。grid 自管「点卡片弹预览」；CRUD 回调由
 * 调用方（页面层 task-05）按需注入，缺省 no-op（grid 仍可独立用作只读展示）。
 */
export type AgentProfileHandler = (
  profile: AgentProfileAggregatedItem,
) => void;

/** 全部 visibility 选项（筛选下拉用）。 */
const VISIBILITY_OPTIONS: { value: AgentProfileVisibility; label: string }[] = [
  { value: "private", label: VISIBILITY_LABEL.private },
  { value: "workspace", label: VISIBILITY_LABEL.workspace },
  { value: "platform", label: VISIBILITY_LABEL.platform },
];

export interface AgentProfileCardGridProps {
  /**
   * 工作区 id。配合 scopedToWorkspace=true 走工作区内页数据源（useWorkspaceAgentProfiles）。
   * 不传或 scopedToWorkspace=false 走全局页数据源（useMineAgentProfiles）。
   */
  workspaceId?: string;
  /** 是否锁定到单工作区视图；true 时隐藏「工作区」筛选下拉。 */
  scopedToWorkspace?: boolean;
  /** 编辑回调（系统预置卡不会触发）。缺省 no-op。 */
  onEdit?: AgentProfileHandler;
  /** 复制回调（系统预置卡不会触发）。缺省 no-op。 */
  onCopy?: AgentProfileHandler;
  /** 删除回调（系统预置卡不会触发）。缺省 no-op。 */
  onDelete?: AgentProfileHandler;
}

/**
 * 顶层入口：按 props 选择数据源，渲染共享主体。
 * 全局页：<AgentProfileCardGrid />
 * ws 内页：<AgentProfileCardGrid workspaceId={wid} scopedToWorkspace />
 * 「点卡片弹预览」由本组件内部自管（AgentProfilePreview），CRUD 回调可选注入。
 */
export function AgentProfileCardGrid(props: AgentProfileCardGridProps) {
  const scoped = props.scopedToWorkspace === true && !!props.workspaceId;
  const handlers = {
    onEdit: props.onEdit,
    onCopy: props.onCopy,
    onDelete: props.onDelete,
  };
  if (scoped && props.workspaceId) {
    return (
      <WorkspaceScopedGrid workspaceId={props.workspaceId} {...handlers} />
    );
  }
  return <MineGrid {...handlers} />;
}

/* ────────────────────── 数据源 wrapper（各自调 hook，避免条件式 hook） ────────────────────── */

type GridHandlers = Pick<AgentProfileCardGridProps, "onEdit" | "onCopy" | "onDelete">;

function MineGrid(handlers: GridHandlers) {
  const { profiles, isLoading, isError, error, refetch } =
    useMineAgentProfiles();
  return (
    <CardGridBody
      profiles={profiles}
      loading={isLoading}
      error={isError ? error : null}
      scopedToWorkspace={false}
      onRetry={() => void refetch()}
      {...handlers}
    />
  );
}

function WorkspaceScopedGrid({
  workspaceId,
  ...handlers
}: { workspaceId: string } & GridHandlers) {
  const { profiles, isLoading, isError, error, refetch } =
    useWorkspaceAgentProfiles(workspaceId);
  // AgentProfileRead 结构兼容 AgentProfileAggregatedItem（workspace_name 可选缺省），
  // 直接透传给 CardGridBody / Card。
  return (
    <CardGridBody
      profiles={profiles as AgentProfileAggregatedItem[]}
      loading={isLoading}
      error={isError ? error : null}
      scopedToWorkspace={true}
      onRetry={() => void refetch()}
      {...handlers}
    />
  );
}

/* ────────────────────── 共享主体：筛选条 + 网格 + 状态 ────────────────────── */

interface CardGridBodyProps extends GridHandlers {
  profiles: AgentProfileAggregatedItem[];
  loading: boolean;
  error: ApiError | null;
  scopedToWorkspace: boolean;
  onRetry: () => void;
}

function CardGridBody({
  profiles,
  loading,
  error,
  scopedToWorkspace,
  onRetry,
  onEdit,
  onCopy,
  onDelete,
}: CardGridBodyProps) {
  // 文本搜索：live 输入 + 回车提交（FRONTEND_PAGE_STYLE §3：文本不每键查）。
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  // 三筛选：onChange 即时触发（选择型）。
  const [wsFilter, setWsFilter] = useState<string | undefined>(undefined);
  const [visFilter, setVisFilter] = useState<AgentProfileVisibility | undefined>(
    undefined,
  );
  const [providerFilter, setProviderFilter] = useState<string | undefined>(
    undefined,
  );
  // 预览弹窗：点卡片打开（自管，满足验收「点卡片弹预览」）。
  const [previewProfile, setPreviewProfile] =
    useState<AgentProfileAggregatedItem | null>(null);

  // 工作区选项：从 profiles 的 workspace_name 去重派生（仅非空项）。
  const workspaceOptions = useMemo(() => {
    const names = new Set<string>();
    for (const p of profiles) {
      if (p.workspace_name) names.add(p.workspace_name);
    }
    return Array.from(names)
      .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))
      .map((n) => ({ value: n, label: n }));
  }, [profiles]);

  // 供应商选项：从 profiles 的 provider 去重派生。
  const providerOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of profiles) {
      if (p.provider) set.add(p.provider);
    }
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b))
      .map((v) => ({ value: v, label: v }));
  }, [profiles]);

  // 过滤结果（搜索 + 三筛选可叠加）。
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return profiles.filter((p) => {
      if (q) {
        const hayName = (p.name ?? "").toLowerCase();
        const hayPrompt = (p.system_prompt ?? "").toLowerCase();
        if (!hayName.includes(q) && !hayPrompt.includes(q)) return false;
      }
      if (wsFilter && p.workspace_name !== wsFilter) return false;
      if (visFilter && p.visibility !== visFilter) return false;
      if (providerFilter && p.provider !== providerFilter) return false;
      return true;
    });
  }, [profiles, searchQuery, wsFilter, visFilter, providerFilter]);

  const commitSearch = () => setSearchQuery(searchInput);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spin />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
        加载档案失败：{error.message ?? "未知错误"}
        <button
          type="button"
          onClick={onRetry}
          className="ml-3 rounded border border-destructive/40 px-2 py-0.5 text-destructive hover:bg-red-100"
        >
          重新加载
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 筛选条（搜索 + 三下拉） */}
      <div className="flex flex-wrap items-center gap-2.5 rounded-[10px] border border-border bg-muted/40 p-2.5">
        <Input
          className="min-w-[200px] flex-1"
          size="middle"
          allowClear
          prefix={<SearchOutlined className="text-muted-foreground" />}
          placeholder="搜索档案名或系统提示词…（回车搜索）"
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
            // allowClear 的清空即时同步 query；其它情况等回车提交。
            if (e.target.value === "" && searchQuery !== "") {
              setSearchQuery("");
            }
          }}
          onPressEnter={commitSearch}
        />
        {!scopedToWorkspace && (
          <Select
            className="w-[160px]"
            size="middle"
            allowClear
            placeholder="工作区：全部"
            value={wsFilter}
            onChange={setWsFilter}
            options={workspaceOptions}
            notFoundContent="无匹配工作区"
          />
        )}
        <Select
          className="w-[130px]"
          size="middle"
          allowClear
          placeholder="可见范围：全部"
          value={visFilter}
          onChange={setVisFilter}
          options={VISIBILITY_OPTIONS}
        />
        <Select
          className="w-[140px]"
          size="middle"
          allowClear
          placeholder="供应商：全部"
          value={providerFilter}
          onChange={setProviderFilter}
          options={providerOptions}
          notFoundContent="无匹配供应商"
        />
      </div>

      {/* 结果计数 */}
      <div className="text-xs text-muted-foreground">
        共 {filtered.length} 个档案
        {filtered.length !== profiles.length
          ? `（已从 ${profiles.length} 个筛选）`
          : ""}
      </div>

      {/* 卡片网格 */}
      {filtered.length === 0 ? (
        <Empty
          description={
            profiles.length === 0 ? "暂无智能体档案" : "无匹配的档案"
          }
          className="py-16"
        />
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {filtered.map((p) => (
            <AgentProfileCard
              key={p.id}
              profile={p}
              onPreview={setPreviewProfile}
              onEdit={onEdit ?? noop}
              onCopy={onCopy ?? noop}
              onDelete={onDelete ?? noop}
            />
          ))}
        </div>
      )}

      {/* 预览弹窗（grid 自管，点卡片触发） */}
      <AgentProfilePreview
        profile={previewProfile}
        open={previewProfile != null}
        onClose={() => setPreviewProfile(null)}
      />
    </div>
  );
}

/** 缺省 no-op 回调（CRUD 未注入时用）。 */
function noop(_profile: AgentProfileAggregatedItem) {
  /* 由页面层注入真实处理（task-05） */
}

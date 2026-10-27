"use client";

import { useMemo, useState } from "react";
import { FolderGit2 } from "lucide-react";
import { Popover, Select } from "antd";

import { ChangeFileTree } from "@/components/change-file-tree";
import { WORKFLOW_STAGE_LABELS } from "@/components/changes/detail/change-stage-header";
import {
  ChangeProgressRow,
  type ChangeSummaryWithProgress,
} from "@/components/daemon/change-progress-row";
import {
  ChangeTotalProgressRing,
  pickLatestActive,
} from "@/components/daemon/change-total-progress-ring";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSessionChanges, type ChangeSummary } from "@/lib/changes";

/**
 * 会话页面悬浮变更文件面板（2026-10-13-session-change-files-hover task-04 /
 * FR-02~05 / D-001@v2：胶囊入口 + hover 下拉列表 + 点项开大弹窗）。
 *
 * - 胶囊入口非圆圈（用户 step5 修正），与待决策 pill 同组（SessionFloatingPillDock
 *   竖排停靠组，2026-10-16-session-pill-dock-drag）；无关联变更（含已归档）
 *   不渲染（FR-02 显隐）；
 * - 点击弹下拉分组列表（2026-10-16-session-pill-dock-drag 由 hover 改点击）：
 *   进行中置顶（轻量/全量徽标 + 阶段 + 时间），已归档默认折叠可展开（FR-03）；
 * - 点项开大弹窗（规格对齐 changes/detail/change-files-card.tsx：shadcn
 *   Dialog max-w-6xl × 85vh，Modal 形态不用 Drawer——FRONTEND_PAGE_STYLE §6），
 *   内嵌与变更文件页相同的 ChangeFileTree（key=changeId 切换重挂载），
 *   autoRefreshMs=15000 文件树实时刷新（D-004@v1）；头部 Select 可切换变更（FR-04）；
 * - 下拉/弹窗任一打开时数据层 15s 轮询（useSessionChanges active）。
 */
export interface SessionChangeFilesHoverProps {
  workspaceId: string;
  sessionId: string;
  /** 会话在跑（turnState.currentRunId != null）——进行中变更徽标呼吸提示 */
  running?: boolean;
  /**
   * 2026-10-16-session-decision-pill task-03：true 时不渲染自带 absolute 悬浮
   * 外壳（pointer-events-none 定位容器），内容裸输出由挂载方统一定位——
   * 2026-10-16-session-pill-dock-drag 起挂进 SessionFloatingPillDock 竖排
   * 停靠组。缺省 false 行为不变（旧消费方零回归）。
   */
  embedded?: boolean;
}

/**
 * 归档终态判定——对齐平台既有「终态可测试定义」双条件口径（changes/page.tsx:226
 * isTerminalChange、[cid]/page.tsx:68、mobile-change-detail.tsx:499 同源）。
 *
 * 平台侧「已归档」是两套独立信号（2026-10-13-session-changefiles-archive-gate
 * 用户实测反馈修正）：
 * - `status==='archived'`：CLI 归档进度上行 → ingest 落库 / 读时投影（设计明确
 *   「不动 location」——平台侧先到）；
 * - `location==='archive'`：reparse 扫描文件系统目录位置收敛（后到）。
 * 只认 location 单信号会把「status 已归档、location 未收敛」的变更误判进行中。
 */
export function isArchivedChange(c: Pick<ChangeSummary, "status" | "location">): boolean {
  return c.status === "archived" || c.location === "archive";
}

/** 进行中/归档分组（纯函数，测试导出；后端已按未归档优先+created_at desc 排序）。 */
export function splitByArchive(changes: ChangeSummary[]): {
  active: ChangeSummary[];
  archived: ChangeSummary[];
} {
  const active: ChangeSummary[] = [];
  const archived: ChangeSummary[] = [];
  for (const c of changes) {
    if (isArchivedChange(c)) archived.push(c);
    else active.push(c);
  }
  return { active, archived };
}

function stageLabel(c: ChangeSummary): string {
  if (isArchivedChange(c)) return "已归档";
  if (!c.current_stage) return "未开始";
  // 轻量变更进行中（flow start 后 current_stage='thin'）：原型口径「干活中」
  // ——WORKFLOW_STAGE_LABELS.thin 是「轻量变更」，直接映射会与 is_thin 徽标
  // 「轻量」拼出「轻量·轻量变更」重复（2026-10-13 用户实测反馈）。
  if (c.current_stage === "thin") return "干活中";
  return WORKFLOW_STAGE_LABELS[c.current_stage] ?? c.current_stage;
}

function shortTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SessionChangeFilesHover({
  workspaceId,
  sessionId,
  running = false,
  embedded = false,
}: SessionChangeFilesHoverProps) {
  // 受控 popover：点击展开/收起（2026-10-16-session-pill-dock-drag 由
  // hover 改点击），antd 只发 onOpenChange 事件，state 是唯一真相。
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [archiveExpanded, setArchiveExpanded] = useState(false);
  const [dialogChangeId, setDialogChangeId] = useState<string | null>(null);

  // FR-09（2026-10-27-ghost-spec-binding-fix，用户实测「打开还显示旧数据」）：
  // 打开沿立即 refetch——staleTime 窗口内的缓存旧值也强制拉新（interval 档位
  // 切换要等下一个 tick 才首跳，不能依赖）。下拉与详情弹窗两个打开入口都拉。
  const { data, refetch } = useSessionChanges(workspaceId, sessionId, {
    active: popoverOpen || dialogChangeId !== null,
  });

  const reopenWithFreshData = (open: boolean) => {
    setPopoverOpen(open);
    if (open) void refetch();
  };

  const { active, archived } = useMemo(() => splitByArchive(data ?? []), [data]);

  // 查询未就绪（undefined）或确无关联变更：不渲染入口，不占位（FR-02）。
  if (!data || data.length === 0) return null;

  const openDialog = (changeId: string) => {
    setPopoverOpen(false);
    setDialogChangeId(changeId);
    void refetch();
  };

  const renderItem = (c: ChangeSummary) => (
    <button
      key={c.id}
      type="button"
      onClick={() => openDialog(c.id)}
      data-testid={`session-change-item-${c.change_key}`}
      className="w-full rounded-md border border-transparent px-2.5 py-1.5 text-left transition-colors hover:border-brand-400 hover:bg-accent"
    >
      <div className="flex items-center gap-1.5">
        <span className="truncate text-xs font-medium">{c.change_key}</span>
        {!isArchivedChange(c) && (
          <span
            className={`shrink-0 rounded px-1 py-px text-[10px] font-semibold ${
              c.is_thin
                ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                : "bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300"
            }`}
          >
            {c.is_thin ? "轻量" : "全量"}
          </span>
        )}
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="rounded bg-emerald-50 px-1 py-px font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          {stageLabel(c)}
        </span>
        <span className="ml-auto">{shortTime(c.updated_at)}</span>
      </div>
      {/* task-10（FR-01~04）：非归档项内嵌进度行（全量 5 圈/轻量相位双分支；
          数据缺失组件自降级 null）。归档项不挂（D-009@v1 终态无信息量）。 */}
      {!isArchivedChange(c) && <ChangeProgressRow change={c as ChangeSummaryWithProgress} />}
    </button>
  );

  const popoverContent = (
    <div
      data-testid="session-change-popover"
      className="max-h-[60vh] w-80 overflow-auto p-1"
    >
      <div className="px-1.5 pb-1 text-[11px] font-semibold text-muted-foreground">
        进行中（{active.length}）
      </div>
      {active.map(renderItem)}
      {archived.length > 0 && (
        <>
          <button
            type="button"
            data-testid="session-change-archive-toggle"
            onClick={() => setArchiveExpanded((v) => !v)}
            className="mt-1.5 w-full rounded-md border border-dashed px-2.5 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:border-brand-400 hover:text-foreground"
          >
            {archiveExpanded ? "▾" : "▸"} 已归档（{archived.length}）
            {archiveExpanded ? "" : "— 点击展开"}
          </button>
          {archiveExpanded && archived.map(renderItem)}
        </>
      )}
    </div>
  );

  const selectOptions = data.map((c) => ({
    value: c.id,
    label: isArchivedChange(c)
      ? `${c.change_key}（已归档）`
      : `${c.change_key}（${c.is_thin ? "轻量" : "全量"}·${stageLabel(c)}）`,
  }));

  // embedded=true：内容裸输出（挂载方 flex 悬浮行统一定位）；false：自带
  // absolute 悬浮外壳（原行为，task-03 前唯一形态）。
  const content = (
    <div data-testid="session-change-files-hover">
      <Popover
        open={popoverOpen}
        onOpenChange={reopenWithFreshData}
        trigger="click"
        placement="topRight"
        content={popoverContent}
        styles={{ container: { padding: 4 } }}
      >
        <Button
          variant="outline"
          size="sm"
          // 玻璃效果（2026-10-27-mobile-chat-visual-round2 / 用户指定「变更/决策两块
          // 悬浮玻璃化」）：bg-card/75+blur-md 覆盖 outline 变体实底——pill 悬浮于
          // 聊天时间线上，背后消息滚动呈朦胧玻璃质感。
          className="gap-1.5 rounded-lg bg-card/75 shadow-sm backdrop-blur-md"
          aria-label="查看会话关联的变更文件"
        >
          <FolderGit2 className="h-3.5 w-3.5" aria-hidden />
          {/* 2026-10-25-session-tab-visual-unify：可见文案精简为「变更」两字
              （用户需求）；aria-label 保留完整语义供读屏。 */}
          变更
          <span
            data-testid="session-change-count"
            className={`rounded-full px-1.5 text-[10px] font-bold leading-4 text-white ${
              active.length > 0
                ? "bg-blue-600"
                : "bg-emerald-600"
            } ${running && active.length > 0 ? "animate-pulse" : ""}`}
          >
            {active.length}
          </span>
          {/* task-10（FR-05 / D-013@v1）：入口旁单个总进度圈——最新进行中一个
              （updated_at 显式重排选取），数据缺失环不渲染（按钮区不受影响）。 */}
          {(() => {
            const ringTarget = pickLatestActive(active as ChangeSummaryWithProgress[]);
            return ringTarget ? <ChangeTotalProgressRing change={ringTarget} /> : null;
          })()}
        </Button>
      </Popover>

      <Dialog
        open={dialogChangeId !== null}
        onOpenChange={(o) => {
          if (!o) setDialogChangeId(null);
        }}
      >
        <DialogContent className="flex h-[85vh] max-w-6xl flex-col gap-0 p-0">
          <DialogHeader className="flex flex-row items-center gap-3 space-y-0 border-b px-4 py-3">
            <DialogTitle className="text-sm">变更文件实时预览</DialogTitle>
            <Select
              size="small"
              value={dialogChangeId ?? undefined}
              onChange={(v: string) => setDialogChangeId(v)}
              options={selectOptions}
              className="min-w-0 max-w-[360px] flex-1"
              data-testid="session-change-select"
              // 2026-10-13 用户实测「下拉项选择不了」修复：radix Dialog modal 对
              // body 设 pointer-events:none（仅 DialogContent 内恢复），antd 下拉
              // 默认 portal 到 body → 选项点不动且点按触发弹窗 outside-close。
              // 挂进 DialogContent（role=dialog）内：pointer-events 恢复、层级随
              // 弹窗、radix 不计 outside（下拉交互不再误关弹窗）。
              getPopupContainer={(trigger) =>
                (trigger.closest('[role="dialog"]') as HTMLElement | null) ??
                document.body
              }
            />
            <DialogDescription className="shrink-0 text-[11px]">
              与变更文件页同组件 · 15 秒自动刷新
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
            {dialogChangeId && (
              <ChangeFileTree
                key={dialogChangeId}
                workspaceId={workspaceId}
                changeId={dialogChangeId}
                autoRefreshMs={15000}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );

  if (embedded) return content;
  return (
    <div className="pointer-events-none absolute bottom-20 right-4 z-40 flex justify-end print:hidden">
      <div className="pointer-events-auto">{content}</div>
    </div>
  );
}

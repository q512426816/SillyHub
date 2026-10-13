"use client";

import { useMemo, useState } from "react";
import { FolderGit2 } from "lucide-react";
import { Popover, Select } from "antd";

import { ChangeFileTree } from "@/components/change-file-tree";
import { WORKFLOW_STAGE_LABELS } from "@/components/changes/detail/change-stage-header";
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
 * - 胶囊入口非圆圈（用户 step5 修正），右下角悬浮于输入条上方；无关联变更
 *   （含已归档）不渲染（FR-02 显隐）；
 * - hover（或触屏点击）弹下拉分组列表：进行中置顶（轻量/全量徽标 + 阶段 +
 *   时间），已归档默认折叠可展开（FR-03）；
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
}

/** 进行中/归档分组（纯函数，测试导出；后端已按未归档优先+created_at desc 排序）。 */
export function splitByArchive(changes: ChangeSummary[]): {
  active: ChangeSummary[];
  archived: ChangeSummary[];
} {
  const active: ChangeSummary[] = [];
  const archived: ChangeSummary[] = [];
  for (const c of changes) {
    if (c.location === "archive") archived.push(c);
    else active.push(c);
  }
  return { active, archived };
}

function stageLabel(c: ChangeSummary): string {
  if (c.location === "archive") return "已归档";
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
}: SessionChangeFilesHoverProps) {
  // 受控 popover：hover 弹出移开收起，click 固定（触屏兜底），antd 只发
  // onOpenChange 事件，state 是唯一真相。
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [archiveExpanded, setArchiveExpanded] = useState(false);
  const [dialogChangeId, setDialogChangeId] = useState<string | null>(null);

  const { data } = useSessionChanges(workspaceId, sessionId, {
    active: popoverOpen || dialogChangeId !== null,
  });

  const { active, archived } = useMemo(() => splitByArchive(data ?? []), [data]);

  // 查询未就绪（undefined）或确无关联变更：不渲染入口，不占位（FR-02）。
  if (!data || data.length === 0) return null;

  const openDialog = (changeId: string) => {
    setPopoverOpen(false);
    setDialogChangeId(changeId);
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
        {c.location !== "archive" && (
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
    label:
      c.location === "archive"
        ? `${c.change_key}（已归档）`
        : `${c.change_key}（${c.is_thin ? "轻量" : "全量"}·${stageLabel(c)}）`,
  }));

  return (
    <div className="pointer-events-none absolute bottom-20 right-4 z-40 flex justify-end print:hidden">
      <div className="pointer-events-auto" data-testid="session-change-files-hover">
        <Popover
          open={popoverOpen}
          onOpenChange={setPopoverOpen}
          trigger={["hover", "click"]}
          placement="topRight"
          content={popoverContent}
          styles={{ container: { padding: 4 } }}
        >
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 rounded-lg shadow-sm"
            aria-label="悬浮查看会话关联的变更文件"
          >
            <FolderGit2 className="h-3.5 w-3.5" aria-hidden />
            变更文件
            <span
              data-testid="session-change-count"
              className={`rounded-full bg-emerald-600 px-1.5 text-[10px] font-bold leading-4 text-white ${
                running && active.length > 0 ? "animate-pulse" : ""
              }`}
            >
              {active.length}
            </span>
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
    </div>
  );
}

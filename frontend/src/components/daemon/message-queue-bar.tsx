"use client";

/**
 * MessageQueueBar —— 会话消息排队展示条（2026-08-21-session-message-queue task-02 起，
 * 2026-08-31-session-queue-ux task-08 按原型 prototype-session-queue-ux.html §① 重构增强）。
 *
 * 设计依据（changes/2026-08-31-session-queue-ux/design.md FR-04/FR-05/FR-06 + 原型 §①）：
 *   - 水平滚动 chips 栏：running / reconnecting 期间入队的消息在此排队可视化；
 *   - 每条显示 prompt 前 40 字摘要 + 附件数（D-004 附件排队，仅引用已落库 ids）；
 *   - 拖拽排序（FR-04 / D-006 HTML5 原生 DnD）：每条 chip 左侧 ⇅ 手柄（整 chip 可拖），
 *     dragover 按指针在目标条目前/后半区即时换位预览（仅改本地展示序 override，
 *     entries 真相仍归父级 useMessageQueue），松手（drop）顺序变化时上抛全量有序
 *     ids 调 onReorder 并复位 override，等父级 load 收敛（R-02 以服务端为准）；
 *     原位松手/拖出有效区不回调；sending 条目不参与拖拽；
 *   - ⚡ 立即发送（FR-05）：pending 与 failed 均渲染（sending 不可操作），
 *     title 两态——pending=「打断当前轮，立即发送这条」/ failed=「立即发送这条」，
 *     点击调 onDispatchNow；不本地造已打断/已发送态，收敛统一走 SSE/load（R-04）；
 *   - ✎ 重新编辑（FR-06）：队列行下方展开单条 inline 编辑浮层（说明行 + textarea
 *     + 取消/保存；trim 非空才可保存，后端 422 双保险）；failed 条目浮层说明
 *     「保存后转为等待中并尝试派发」；TASK_WAKEUP 前缀（[后台任务通知]）系统通知
 *     条目不渲染 ✎（D-009，后端 409 双保险）；展开查看态与编辑态互斥（开编辑收起展开）；
 *   - failed 条目红色语义边框（border/text-destructive）+ ↻ 重试/✕ 删除按钮
 *     （D-003 失败留队头，不自动重试，重试仅由用户点击触发）；
 *   - pending 条目提供 ✕ 删除；sending 条目转 spinner 不提供操作；
 *   - 队列满（entries.length >= max，D-002 默认 5）显示「队列已满（N/N）」；
 *   - 点击条目展开查看完整 displayPrompt（带附件标记行）与失败原因。
 *
 * 纯展示组件：不 fetch、不持队列真相、不引状态库；满员判断由父级传入的
 * entries/max 得出。三个新回调 onReorder / onEdit / onDispatchNow 均可选——
 * 未传时对应手柄/按钮不渲染（task-09 接线前 panel 既有挂载不受影响）。
 * 主题：品牌态用 brand-* 语义阶，错误态用 destructive 语义色；
 * 空队列返回 null（不渲染）。
 */

import { useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import {
  AlertTriangle,
  Clock,
  GripVertical,
  Pencil,
  RefreshCw,
  RotateCcw,
  X,
  Zap,
} from "lucide-react";
import { Button, Input, Tag, Tooltip } from "antd";

import { cn } from "@/lib/utils";
import type { QueueEntry } from "@/hooks/use-message-queue";

/** 摘要截断长度（design §3.2：prompt 前 40 字）。 */
const SUMMARY_LIMIT = 40;

/**
 * TASK_WAKEUP 系统通知条目 prompt 前缀（D-009）：该前缀条目由后端任务唤醒自动
 * 并入，不开放 ✎ 编辑（后端 409 双保险）。与
 * backend/app/modules/daemon/session/service.py 的 TASK_WAKEUP_PROMPT_PREFIX 同值
 * ——跨语言无法共享 import，改前缀需两侧同步。
 */
const TASK_WAKEUP_PROMPT_PREFIX = "[后台任务通知]";

/** 各投递状态的视觉元数据（chip 边框/底色 + 状态图标 + 中文文案）。 */
const STATUS_META: Record<
  QueueEntry["status"],
  { icon: typeof Clock; iconCls: string; chipCls: string; label: string }
> = {
  pending: {
    icon: Clock,
    iconCls: "text-muted-foreground",
    chipCls: "border-input bg-muted/50 text-muted-foreground",
    label: "等待中",
  },
  sending: {
    icon: RefreshCw,
    iconCls: "text-brand-600 animate-spin",
    chipCls: "border-brand-200 bg-brand-50/40 text-brand-700",
    label: "发送中",
  },
  failed: {
    icon: AlertTriangle,
    iconCls: "text-destructive",
    chipCls: "border-destructive bg-destructive/5 text-destructive",
    label: "发送失败",
  },
};

export interface MessageQueueBarProps {
  /** 排队条目（useMessageQueue.queue，含 pending/sending/failed）。 */
  entries: QueueEntry[];
  /** 删除条目（接 useMessageQueue.removeEntry）。 */
  onRemove: (id: string) => void;
  /** 重试失败条目（接 useMessageQueue.retryEntry）。 */
  onRetry: (id: string) => void;
  /** 队列上限（D-002 默认 5），仅用于满员提示文案（N/max），判断由父级渲染 entries 决定。 */
  max?: number;
  /**
   * 拖拽排序落定（FR-04）：参数为松手时条目的全量有序 id 列表（顺序较原序有变才回调）；
   * 未传时不渲染 ⇅ 拖拽手柄（chip 也不可拖）。
   */
  onReorder?: (ids: string[]) => void;
  /**
   * 立即发送（FR-05）：pending=打断当前轮优先派发该条，failed=直接派发；
   * 未传时不渲染 ⚡ 按钮。
   */
  onDispatchNow?: (id: string) => void;
  /**
   * 重新编辑（FR-06）：编辑浮层保存（已 trim 非空）时回调新文本；
   * 未传时不渲染 ✎ 按钮。
   */
  onEdit?: (id: string, prompt: string) => void;
}

export function MessageQueueBar({
  entries,
  onRemove,
  onRetry,
  max = 5,
  onReorder,
  onDispatchNow,
  onEdit,
}: MessageQueueBarProps) {
  /** 当前展开查看完整内容的条目 id（点击条目切换；单条展开即可）。 */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** 编辑浮层（✎ FR-06）：editingId=正在编辑的条目 id；draft=textarea 受控文本。 */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  /** 拖拽态（⇅ FR-04）：dragId=被拖条目；overId=当前拖过目标；orderIds=本地展示序 override。 */
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [orderIds, setOrderIds] = useState<string[] | null>(null);

  // 空队列不渲染（design §3.2；hooks 先于早返回，保证条件顺序合法）。
  if (entries.length === 0) return null;

  const byId = new Map(entries.map((entry) => [entry.id, entry] as const));
  // 拖拽即时预览只改本地展示序 override：orderIds 非空时按其排（entries 真相不动），
  // 中途新增/删除的条目按服务端相对位置兜底（新增追加尾部、已删自动过滤）。
  const displayEntries: QueueEntry[] = orderIds
    ? [
        ...orderIds
          .filter((id) => byId.has(id))
          .map((id) => byId.get(id) as QueueEntry),
        ...entries.filter((entry) => !orderIds.includes(entry.id)),
      ]
    : entries;
  // 正在编辑的条目（若编辑中被父级移除，浮层随之消失）。
  const editingEntry =
    editingId != null && byId.has(editingId) ? byId.get(editingId) : undefined;

  const isFull = entries.length >= max;

  /** dragstart：记录被拖条目并声明 move 语义（原型 .chip.dragging；setData 兼容 Firefox）。 */
  const handleDragStart = (e: ReactDragEvent<HTMLDivElement>, id: string) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };

  /** dragover：目标 chip 高亮 + 按指针在目标前/后半区即时换位（仅改本地展示序）。 */
  const handleDragOver = (
    e: ReactDragEvent<HTMLDivElement>,
    overEntry: QueueEntry,
  ) => {
    // sending 不可作为落点（不可操作既有不变式）；无拖拽/拖过自身不处理。
    if (!dragId || overEntry.id === dragId || overEntry.status === "sending") {
      return;
    }
    e.preventDefault(); // 允许 drop
    e.dataTransfer.dropEffect = "move";
    setOverId(overEntry.id);
    const rect = e.currentTarget.getBoundingClientRect();
    const after = e.clientX > rect.left + rect.width / 2;
    setOrderIds((prev) => {
      const base = prev ?? entries.map((entry) => entry.id);
      const next = base.filter((id) => id !== dragId);
      const overIdx = next.indexOf(overEntry.id);
      if (overIdx < 0) return prev; // 目标不在当前序（防御，理论上不达）
      next.splice(overIdx + (after ? 1 : 0), 0, dragId);
      return next;
    });
  };

  /**
   * drop（挂 chips 行容器，chip 的 drop 冒泡至此）：落定上抛全量有序 ids——
   * 仅顺序较原序有变才回调（原位松手/无效落点不触发，D-003）；态复位统一在 dragend。
   */
  const handleRowDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!onReorder || !dragId || !orderIds) return;
    const currentIds = displayEntries.map((entry) => entry.id);
    const originalIds = entries.map((entry) => entry.id);
    if (currentIds.join("\n") !== originalIds.join("\n")) {
      onReorder(currentIds);
    }
  };

  /** dragend：复位全部拖拽态（drop 落定/拖出取消后都会走到，幂等无残留高亮）。 */
  const handleDragEnd = () => {
    setDragId(null);
    setOverId(null);
    setOrderIds(null);
  };

  /** 打开编辑浮层（✎ FR-06）：收起查看展开（两态互斥），draft 预填原 prompt。 */
  const openEditor = (entry: QueueEntry) => {
    setExpandedId(null);
    setEditingId(entry.id);
    setDraft(entry.prompt);
  };

  /** 取消：丢弃 draft 关浮层，不回调。 */
  const closeEditor = () => {
    setEditingId(null);
    setDraft("");
  };

  /** 保存：trim 非空才可保存（按钮禁用 + 此处双保险），回调后关浮层。 */
  const saveEditor = () => {
    if (!editingEntry) return;
    const text = draft.trim();
    if (!text) return;
    onEdit?.(editingEntry.id, text);
    closeEditor();
  };

  return (
    <div className="shrink-0 border-t bg-card px-5 py-2">
      <div
        className="flex items-center gap-1.5 overflow-x-auto pb-0.5"
        onDrop={handleRowDrop}
      >
        {/* 队列计数标签（说明本行 chips 为排队消息）。 */}
        <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
          排队消息（{entries.length}）
        </span>

        {/* D-002：满员提示（antd Tag 预设 warning，经主题 token 取色）。 */}
        {isFull && (
          <Tag color="warning" className="!m-0 shrink-0 !text-[11px]">
            队列已满（{entries.length}/{max}）
          </Tag>
        )}

        {displayEntries.map((entry) => {
          const meta = STATUS_META[entry.status];
          const StatusIcon = meta.icon;
          const expanded = expandedId === entry.id;
          const summary =
            entry.prompt.length > SUMMARY_LIMIT
              ? `${entry.prompt.slice(0, SUMMARY_LIMIT)}…`
              : entry.prompt;
          // ⇅ 拖拽仅对可操作条目开放（sending 投递中不参与，D-003 既有不变式）。
          const canDrag = Boolean(onReorder) && entry.status !== "sending";
          const isDragging = dragId === entry.id;
          const isDropTarget =
            dragId != null && overId === entry.id && overId !== dragId;
          // TASK_WAKEUP 系统通知条目不开放 ✎ 编辑（D-009，后端 409 双保险）。
          const canEdit =
            Boolean(onEdit) &&
            entry.status !== "sending" &&
            !entry.prompt.startsWith(TASK_WAKEUP_PROMPT_PREFIX);

          return (
            <div
              key={entry.id}
              draggable={canDrag}
              onDragStart={
                canDrag ? (e) => handleDragStart(e, entry.id) : undefined
              }
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, entry)}
              className={cn(
                "shrink-0 rounded border px-2 py-1 text-[11px] leading-4",
                meta.chipCls,
                // 拖拽两态（原型 .chip.dragging / .chip.drop-target）。
                isDragging && "border-dashed opacity-35",
                isDropTarget && "border-brand-500 ring-1 ring-brand-500",
              )}
            >
              <div className="flex items-start gap-1">
                {/* ⇅ 拖拽手柄（FR-04）：整 chip 可拖，手柄作视觉锚点与排序提示。 */}
                {canDrag && (
                  <span
                    title="拖拽排序"
                    className="mt-0.5 shrink-0 cursor-grab select-none text-muted-foreground"
                  >
                    <GripVertical className="h-3 w-3" />
                  </span>
                )}

                {/* 点击条目主体：展开/收起完整 displayPrompt（design §3.2）。 */}
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : entry.id)}
                  aria-label={`${meta.label}，${expanded ? "收起" : "展开查看完整内容"}：${summary}`}
                  title={expanded ? "收起" : "展开查看完整内容"}
                  className="flex min-w-0 items-start gap-1.5 text-left"
                >
                  {entry.status === "failed" ? (
                    /* failed：悬停图标直接看失败原因（展开区亦有完整原因）。 */
                    <Tooltip
                      title={
                        entry.errorMsg ? `发送失败：${entry.errorMsg}` : "发送失败"
                      }
                    >
                      <AlertTriangle
                        className={cn("mt-0.5 h-3 w-3 shrink-0", meta.iconCls)}
                      />
                    </Tooltip>
                  ) : (
                    <StatusIcon
                      className={cn("mt-0.5 h-3 w-3 shrink-0", meta.iconCls)}
                    />
                  )}
                  <span
                    className={cn(
                      "min-w-0",
                      expanded
                        ? "max-w-[420px] whitespace-pre-wrap break-all"
                        : "max-w-[280px] truncate",
                    )}
                  >
                    {expanded ? entry.displayPrompt : summary}
                  </span>
                  {/* 附件数（D-004：折叠态显示；展开态 displayPrompt 已含附件标记行）。 */}
                  {!expanded && entry.attachmentIds.length > 0 && (
                    <Tooltip title={`含 ${entry.attachmentIds.length} 个附件`}>
                      <span className="mt-0.5 shrink-0 opacity-80">
                        📎 {entry.attachmentIds.length}
                      </span>
                    </Tooltip>
                  )}
                </button>

                {/* D-003：failed → 重试（仅用户触发）。 */}
                {entry.status === "failed" && (
                  <Tooltip title="重试发送">
                    <Button
                      type="text"
                      size="small"
                      icon={<RotateCcw className="h-3 w-3" />}
                      onClick={() => onRetry(entry.id)}
                      aria-label="重试发送该消息"
                      className="!h-5 !min-w-0 !w-5 !p-0"
                    />
                  </Tooltip>
                )}

                {/* FR-05 ⚡ 立即发送：pending=打断当前轮 / failed=直接派发；sending 不渲染。 */}
                {onDispatchNow && entry.status !== "sending" && (
                  <Tooltip
                    title={
                      entry.status === "pending"
                        ? "打断当前轮，立即发送这条"
                        : "立即发送这条"
                    }
                  >
                    <Button
                      type="text"
                      size="small"
                      icon={<Zap className="h-3 w-3 text-brand-600" />}
                      onClick={() => onDispatchNow(entry.id)}
                      aria-label={
                        entry.status === "pending"
                          ? "打断当前轮，立即发送这条"
                          : "立即发送这条"
                      }
                      className="!h-5 !min-w-0 !w-5 !p-0"
                    />
                  </Tooltip>
                )}

                {/* FR-06 ✎ 重新编辑：打开队列行下方的 inline 编辑浮层。 */}
                {canEdit && (
                  <Tooltip title="重新编辑">
                    <Button
                      type="text"
                      size="small"
                      icon={<Pencil className="h-3 w-3" />}
                      onClick={() => openEditor(entry)}
                      aria-label="重新编辑该消息"
                      className="!h-5 !min-w-0 !w-5 !p-0"
                    />
                  </Tooltip>
                )}

                {/* pending / failed → 删除；sending 投递中不可操作。 */}
                {entry.status !== "sending" && (
                  <Tooltip title="从队列移除">
                    <Button
                      type="text"
                      size="small"
                      icon={<X className="h-3 w-3" />}
                      onClick={() => onRemove(entry.id)}
                      aria-label="从队列移除该消息"
                      className="!h-5 !min-w-0 !w-5 !p-0"
                    />
                  </Tooltip>
                )}
              </div>

              {/* 展开态：失败原因完整展示（D-003 errorMsg）。 */}
              {expanded && entry.errorMsg && (
                <div className="mt-1 max-w-[440px] break-all text-destructive">
                  发送失败：{entry.errorMsg}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ✎ 编辑浮层（FR-06 / 原型 .edit-pop）：队列行下方单条展开，取消/保存右对齐。
          说明行含 failed 转等待中提示（对 pending 条目该句为一般性说明，不误导）。 */}
      {editingEntry && (
        <div className="mt-2 max-w-[560px] rounded-lg border border-border bg-muted/20 p-2.5">
          <div className="mb-1.5 text-[11px] leading-4 text-muted-foreground">
            重新编辑排队消息（附件与配置不变，仅改文本；失败条目保存后转为等待中并尝试派发）
          </div>
          <Input.TextArea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            aria-label="重新编辑排队消息文本"
            className="!text-[13px]"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button size="small" onClick={closeEditor}>
              取消
            </Button>
            <Button
              type="primary"
              size="small"
              disabled={!draft.trim()}
              onClick={saveEditor}
            >
              保存
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

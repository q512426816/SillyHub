"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { ArrowLeftRight } from "lucide-react";

import {
  WorkspaceCard,
  type WorkspaceCardDragHandleProps,
} from "@/components/workspace-card";
import { useNotify } from "@/lib/errors";
import {
  moveWorkspace,
  WORKSPACE_PAGE_SIZE,
  type Workspace,
} from "@/lib/workspaces";
import { cn } from "@/lib/utils";

/**
 * task-08 / 2026-09-14-workspace-drag-sort / FR-04 / FR-05：
 * 工作区列表拖拽排序网格（@dnd-kit DndContext + SortableContext，
 * rectSortingStrategy 适配 1/2/3 列响应式网格，D-002 分页网格不变）。
 *
 * 纯组件边界（D-014）：不持路由不拉数据——items/page/total 与翻页/刷新回调
 * 全部经 props，由 task-09 在 page.tsx 接线；move 后不在本地造卡/删卡，
 * 跨页移动经回调重取列表表现为「源页少一张、目标页多一张」。
 *
 * 交互（对照 prototype-workspace-drag-sort.html）：
 * - 页内拖放：dragEnd 按落位取前邻卡，一次 moveWorkspace 携 after_id=前邻卡 id
 *   （落位本页页首无前邻时改携 before_id=本页第一张），本地乐观重排、失败回滚
 *   并回调刷新（D-008 后写覆盖语义，不加乐观锁）。
 * - 边缘投放带（D-003@v2）：拖起时网格上下滑入两条虚线投放带（外置 droppable），
 *   drop/取消即收起；下带携 to=next_page_head、上带携 to=prev_page_tail，均带
 *   page_size=WORKSPACE_PAGE_SIZE——跨页锚点由服务端解析，客户端不算边界卡
 *   （D-012 / R-07）；第 1 页无上带、末页无下带（页信息经 props 传入）。
 * - 成功闭环：按响应 rank 换算目标页 floor(rank / WORKSPACE_PAGE_SIZE) 经
 *   onMoved 上抛（被拖卡 id + rank + 目标页）；被移动卡高亮 1.6s 自动消失
 *   （accent 主题 token 动画，见底部 wdg- <style>，禁硬编码 hex）。
 */

/** 透传给每张 WorkspaceCard 的额外 props（workspace 与手柄挂点由本网格注入）。 */
export type WorkspaceCardSlotProps = Omit<
  React.ComponentProps<typeof WorkspaceCard>,
  "workspace" | "dragHandleProps" | "dragHandleNode"
>;

/** 移动成功闭环事件（onMoved 上抛）：rank 为服务端返回的移动后全局序号。 */
export interface WorkspaceMovedEvent {
  /** 被移动工作区 id */
  id: string;
  /** 服务端响应 rank（默认视图全局序号） */
  rank: number;
  /** 目标页（0 基）= floor(rank / WORKSPACE_PAGE_SIZE)，父级据此翻页 + reload */
  page: number;
}

interface Props {
  /** 当前页工作区（顺序即页内排序；乐观更新期间本地顺序可短暂偏离） */
  items: Workspace[];
  /** 当前页码（0 基）——第 0 页不渲染上投放带 */
  page: number;
  /** 总条数（当前列表视图）——末页不渲染下投放带 */
  total: number;
  /**
   * 每张卡片的额外 props 组装器（page.tsx 透传 linkedProjects/boundDaemon/
   * daemonStatus/onChanged/onEditAlias/onActivate 等既有 props——必填，
   * WorkspaceCard 的 onChanged/onEditAlias 为必传项经由此供给）。
   */
  cardProps: (workspace: Workspace) => WorkspaceCardSlotProps;
  /**
   * 「移动到…」入口回调（task-09 接线弹窗）：传入时手柄下方渲染入口按钮；
   * 缺省不渲染。弹窗本体不属本组件。
   */
  onRequestMove?: (workspace: Workspace) => void;
  /**
   * 移动成功回调：页内/投放带 move 成功后上抛，父级据 page 翻页并重取列表。
   */
  onMoved?: (event: WorkspaceMovedEvent) => void;
  /** 移动失败回调（乐观已回滚）：父级可据此刷新收敛服务端真序。 */
  onMoveFailed?: (err: unknown) => void;
  /**
   * 禁用拖拽（筛选态，D-005@v2，task-09 接线）：手柄灰显禁拖（可见不隐藏）、
   * 投放带不出现。缺省可拖。
   */
  dragDisabled?: boolean;
  /** 根容器附加类名（透传布局间距等，网格本体类固定） */
  className?: string;
}

/** 投放带 droppable id（工作区 id 为 UUID，命名前缀防碰撞）。 */
const TOP_ZONE_ID = "wdg-zone-prev-page";
const BOTTOM_ZONE_ID = "wdg-zone-next-page";

/* ── 边缘投放带（外置 droppable）：仅拖拽期间按页边界条件渲染，drop/取消即卸载 ── */
function EdgeDropZone({
  id,
  label,
  visible,
}: {
  id: string;
  label: string;
  visible: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  if (!visible) return null;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "my-2.5 flex h-11 animate-sh-fade-in items-center justify-center rounded-lg border-2 border-dashed text-[13px] font-medium tracking-wide",
        isOver
          ? "border-brand-600 bg-brand-100 text-brand-700 ring-4 ring-brand-100"
          : "border-brand-300 bg-brand-50 text-brand-700",
      )}
    >
      {label}
    </div>
  );
}

/* ── 可排序卡片：包装层承载 setNodeRef/transform，WorkspaceCard 透传既有 props ── */
function SortableWorkspaceCard({
  workspace,
  slotProps,
  disabled,
  isMoved,
  onRequestMove,
}: {
  workspace: Workspace;
  slotProps: WorkspaceCardSlotProps;
  disabled: boolean;
  isMoved: boolean;
  onRequestMove?: (workspace: Workspace) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: workspace.id, disabled });

  // @dnd-kit/utilities 未直装（pnpm 严格 node_modules），手拼 translate3d
  // 等价 CSS.Transform.toString（sortable 变换无 scale 分量）。
  const dragStyle: React.CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition: transition ?? undefined,
  };

  // R-06：仅手柄承载 drag listeners（PPM ppm-sub-table 最左拖拽手柄列同款先例），
  // 卡体整卡点击进详情（onActivate）不受拖拽影响；禁用态灰显不隐藏（D-005@v2）。
  const handleProps: WorkspaceCardDragHandleProps = disabled
    ? { className: "cursor-not-allowed !opacity-40" }
    : { ref: setActivatorNodeRef, ...attributes, ...listeners };

  return (
    <div
      ref={setNodeRef}
      style={dragStyle}
      data-ws-id={workspace.id}
      className={cn(
        "relative",
        isDragging && "z-10 opacity-40",
        isMoved && "wdg-just-moved rounded-lg",
      )}
    >
      <WorkspaceCard
        workspace={workspace}
        {...slotProps}
        dragHandleProps={handleProps}
        dragHandleNode={
          onRequestMove ? (
            <button
              type="button"
              title="移动到指定页…"
              className="mt-0.5 flex h-6 w-5 cursor-pointer items-center justify-center rounded-l-md border border-r-0 border-border bg-card text-muted-foreground opacity-0 transition-opacity duration-100 group-hover/card:opacity-60 hover:!opacity-100 hover:text-brand-600 focus-visible:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onRequestMove(workspace);
              }}
            >
              <ArrowLeftRight className="h-3 w-3" aria-hidden />
            </button>
          ) : undefined
        }
      />
    </div>
  );
}

export function WorkspaceDragGrid({
  items,
  page,
  total,
  cardProps,
  onRequestMove,
  onMoved,
  onMoveFailed,
  dragDisabled = false,
  className,
}: Props) {
  const notify = useNotify();
  const gridRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [movedId, setMovedId] = useState<string | null>(null);
  // 乐观覆盖（render 期派生）：source 记录覆盖所基于的 items 引用，props 变化
  // （翻页 / 父级 reload）即自动失效回退 props 序，避免 effect 同步闪一帧旧序。
  const [override, setOverride] = useState<{
    source: Workspace[];
    items: Workspace[];
  } | null>(null);
  const order = override && override.source === items ? override.items : items;

  // 键盘无障碍走 dnd-kit 内置 KeyboardSensor（sortable 键盘坐标）；
  // 指针 4px 位移阈值避免手柄误触点击即起拖。
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const dragging = activeId !== null;
  // 页边界：第 1 页无上带 / 末页无下带（页信息经 props 传入）。
  const hasPrevPage = page > 0;
  const hasNextPage = (page + 1) * WORKSPACE_PAGE_SIZE < total;

  // 移动成功闭环：记录高亮 id + 按 rank 换算目标页上抛（D-003 / R-08）。
  const finishMove = useCallback(
    (id: string, rank: number) => {
      setMovedId(id);
      onMoved?.({
        id,
        rank,
        page: Math.floor(rank / WORKSPACE_PAGE_SIZE),
      });
    },
    [onMoved],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragCancel = useCallback(() => setActiveId(null), []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      // drop/取消即收起投放带（先复位，再走提交分支）。
      setActiveId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeWsId = String(active.id);
      const overId = String(over.id);

      // 边缘投放带：to 枚举由服务端解析跨页锚点（D-012），客户端不本地增删卡（D-014）。
      if (overId === TOP_ZONE_ID || overId === BOTTOM_ZONE_ID) {
        try {
          const resp = await moveWorkspace(activeWsId, {
            to: overId === TOP_ZONE_ID ? "prev_page_tail" : "next_page_head",
            page_size: WORKSPACE_PAGE_SIZE,
          });
          finishMove(activeWsId, resp.rank);
        } catch (err) {
          notify.error(err, "移动工作区失败");
          onMoveFailed?.(err);
        }
        return;
      }

      // 页内拖放：落位前邻卡 after_id；落位本页页首无前邻时改 before_id=本页第一张
      // （新序第二张 = 原页首卡）。恰发一次 moveWorkspace（FR-04）。
      const oldIndex = order.findIndex((w) => w.id === activeWsId);
      const newIndex = order.findIndex((w) => w.id === overId);
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
      const next = arrayMove(order, oldIndex, newIndex);
      const prevNeighbor = next[newIndex - 1];
      const headAnchor = next[1];
      const anchorBody = prevNeighbor
        ? { after_id: prevNeighbor.id }
        : headAnchor
          ? { before_id: headAnchor.id }
          : null;
      if (!anchorBody) return;
      setOverride({ source: order, items: next });
      try {
        const resp = await moveWorkspace(activeWsId, anchorBody);
        finishMove(activeWsId, resp.rank);
      } catch (err) {
        // 失败回滚乐观序（FR-04）+ 回调刷新收敛。
        setOverride(null);
        notify.error(err, "移动工作区失败");
        onMoveFailed?.(err);
      }
    },
    [finishMove, notify, onMoveFailed, order],
  );

  // 落位高亮（FR-05）：目标卡到位（跨页移动需等父级翻页刷新换页）后滚动入视野
  // 并闪 1.6s（wdg-flash，accent 主题 token 动画），到时自动清除。
  useEffect(() => {
    if (!movedId) return;
    if (!order.some((w) => w.id === movedId)) return;
    gridRef.current
      ?.querySelector<HTMLElement>(`[data-ws-id="${movedId}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = window.setTimeout(() => setMovedId(null), 1600);
    return () => window.clearTimeout(timer);
  }, [movedId, order]);

  return (
    <div className={className}>
      {/* 落位高亮 keyframes（wdg- 命名空间，色取 --color-accent 主题 token，
          禁硬编码 hex——floating-mascot 局部 <style> 同款先例）。 */}
      <style>{`
@keyframes wdg-flash{
  0%,60%{box-shadow:0 0 0 3px var(--color-accent),0 4px 14px color-mix(in srgb,var(--color-accent) 25%,transparent)}
  100%{box-shadow:0 0 0 0 transparent}
}
.wdg-just-moved{animation:wdg-flash 1.6s ease}
`}</style>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        // 投放带随拖起滑入会改变网格布局，拖拽期间持续重测 droppable 矩形。
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <EdgeDropZone
          id={TOP_ZONE_ID}
          label="▲ 拖到此处 → 移到上一页末尾"
          visible={dragging && hasPrevPage}
        />
        <SortableContext
          items={order.map((w) => w.id)}
          strategy={rectSortingStrategy}
        >
          <div
            ref={gridRef}
            className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
          >
            {order.map((w) => (
              <SortableWorkspaceCard
                key={w.id}
                workspace={w}
                slotProps={cardProps(w)}
                disabled={dragDisabled}
                isMoved={movedId === w.id}
                onRequestMove={onRequestMove}
              />
            ))}
          </div>
        </SortableContext>
        <EdgeDropZone
          id={BOTTOM_ZONE_ID}
          label="▼ 拖到此处 → 移到下一页开头"
          visible={dragging && hasNextPage}
        />
      </DndContext>
    </div>
  );
}

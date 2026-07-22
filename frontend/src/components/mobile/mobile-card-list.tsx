"use client";

import { useState, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, MoreVertical } from "lucide-react";

import { cn } from "@/lib/utils";
import { MobileActionMenu, type MobileAction } from "./mobile-action-menu";

// MobileAction 类型在此一并导出（design §7），方便消费方从 mobile-card-list 入口取。
export type { MobileAction } from "./mobile-action-menu";

/**
 * MobileCardList 分页参数（design §7 / D-008）。
 *
 * 对接现有 page/page_size 分页 —— **不用无限滚动**（D-008）。
 * onChange(newPage) 由页面触发数据重取（lib/*，不自写请求，D-003）。
 */
export interface MobileListPagination {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}

/**
 * MobileCardList — 通用移动卡片列表（design §5.5 / §7 / D-007 / D-008）。
 *
 * 全功能替代桌面 antd Table：卡片主体 + 动作集（MobileActionMenu）+ 可选批量选择
 * + 分页（page/page_size，非无限滚动）+ headerActions（创建/导出入口）。
 *
 * 关键约束：
 * - 泛型 `<T>`：items 由页面传入，renderCard 决定每条卡片外观（本组件不猜字段）。
 * - selectable：受控 selectedKeys/onSelectedKeysChange，批量栏由页面用 MobileBatchBar 组合（解耦）。
 * - actions：受控由页面声明（编辑/删除/执行/别名…），点击「⋯」经 MobileActionMenu（底部 ActionSheet）触发。
 * - 触摸 ≥ 44×44px、正文 ≥ 14px（R-04）。不复用桌面 components/layout/**（D-001 桌面零回归）。
 */
export interface MobileCardListProps<T> {
  /** 列表数据。 */
  items: T[];
  /** 单条卡片渲染（消费方决定字段布局）。 */
  renderCard: (item: T) => ReactNode;
  /** 点击卡片主体（进入详情）。不传则卡片不可点。 */
  onItemPress?: (item: T) => void;
  /** 卡片动作集工厂（返回空数组则该卡片不渲染「⋯」按钮）。 */
  actions?: (item: T) => MobileAction[];
  /** 开启批量选择模式（每条卡片左侧渲染选择框）。 */
  selectable?: boolean;
  /** 受控选中 key 列表。 */
  selectedKeys?: string[];
  /** 选中变化回调（增删一条 key）。 */
  onSelectedKeysChange?: (keys: string[]) => void;
  /** 分页配置（对接 page/page_size，非无限滚动）。 */
  pagination?: MobileListPagination;
  /** 顶部右侧动作区（如 MobileExportButton / 新建按钮 / MobileFilterDrawer 触发器）。 */
  headerActions?: ReactNode;
  /** 从 item 提取唯一 key，默认取 `item.id`。 */
  itemKey?: (item: T) => string;
  /** 空态文案，默认「暂无数据」。 */
  emptyText?: string;
}

/** 默认 key 提取：取 item.id（兼容大多数 DTO）。 */
function defaultKey<T>(item: T): string {
  const v = (item as { id?: unknown } | null | undefined)?.id;
  return v == null ? "" : String(v);
}

export function MobileCardList<T>(props: MobileCardListProps<T>) {
  const {
    items,
    renderCard,
    onItemPress,
    actions,
    selectable = false,
    selectedKeys = [],
    onSelectedKeysChange,
    pagination,
    headerActions,
    itemKey = defaultKey,
    emptyText = "暂无数据",
  } = props;

  // 当前打开动作集的条目（点击「⋯」赋值，触发动作或关闭后置空）。
  const [actionItem, setActionItem] = useState<T | null>(null);
  const selectedSet = new Set(selectedKeys);

  const toggleKey = (key: string) => {
    if (!onSelectedKeysChange) return;
    const next = new Set(selectedSet);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectedKeysChange(Array.from(next));
  };

  const totalPages = pagination
    ? Math.max(1, Math.ceil(pagination.total / Math.max(1, pagination.pageSize)))
    : 1;

  return (
    <div data-testid="mobile-card-list" className="flex flex-col gap-3">
      {headerActions !== undefined && (
        <div
          data-testid="mobile-card-list-header"
          className="flex flex-wrap items-center gap-2"
        >
          {headerActions}
        </div>
      )}

      {items.length === 0 ? (
        <div
          data-testid="mobile-card-list-empty"
          className="py-10 text-center text-[14px] text-muted-foreground"
        >
          {emptyText}
        </div>
      ) : (
        <ul
          data-testid="mobile-card-list-items"
          className="flex flex-col gap-2"
        >
          {items.map((item, idx) => {
            const keyFromItem = itemKey(item);
            const key = keyFromItem === "" ? String(idx) : keyFromItem;
            const isSelected = selectedSet.has(key);
            const itemActions = actions ? actions(item) : [];
            const hasActions = itemActions.length > 0;
            return (
              <li
                key={key}
                data-testid="mobile-card-item"
                className={cn(
                  "flex items-start gap-2 rounded-[var(--radius-lg)] border border-border bg-card p-3 shadow-[var(--shadow-sm)]",
                )}
              >
                {selectable && (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isSelected}
                    aria-label="选择该项"
                    data-testid={`mobile-card-select-${key}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleKey(key);
                    }}
                    className={cn(
                      "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border transition-colors",
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-transparent",
                    )}
                  >
                    {isSelected && <Check className="h-4 w-4" aria-hidden />}
                  </button>
                )}

                <div
                  className={cn(
                    "min-w-0 flex-1",
                    onItemPress && "cursor-pointer",
                  )}
                  role={onItemPress ? "button" : undefined}
                  onClick={() => onItemPress?.(item)}
                >
                  {renderCard(item)}
                </div>

                {hasActions && (
                  <button
                    type="button"
                    aria-label="更多操作"
                    data-testid={`mobile-card-actions-${key}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setActionItem(item);
                    }}
                    className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-muted-foreground transition-colors hover:bg-muted"
                  >
                    <MoreVertical className="h-5 w-5" aria-hidden />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {pagination && (
        <div
          data-testid="mobile-card-list-pagination"
          className="flex items-center justify-center gap-3 pt-1 text-[14px] text-foreground"
        >
          <button
            type="button"
            aria-label="上一页"
            data-testid="mobile-card-list-prev"
            disabled={pagination.page <= 1}
            onClick={() => pagination.onChange(pagination.page - 1)}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[var(--radius-sm)] text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>
          <span data-testid="mobile-card-list-page-info">
            第 {pagination.page}/{totalPages} 页（共 {pagination.total} 条）
          </span>
          <button
            type="button"
            aria-label="下一页"
            data-testid="mobile-card-list-next"
            disabled={pagination.page >= totalPages}
            onClick={() => pagination.onChange(pagination.page + 1)}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[var(--radius-sm)] text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>
        </div>
      )}

      {actions && (
        <MobileActionMenu
          open={actionItem !== null}
          actions={actionItem ? actions(actionItem) : []}
          onClose={() => setActionItem(null)}
        />
      )}
    </div>
  );
}

"use client";

import type { ReactNode } from "react";
import { Drawer } from "antd";
import { SlidersHorizontal } from "lucide-react";

/**
 * MobileFilterDrawer — 顶部按钮唤起的筛选抽屉（design §5.5 / §7）。
 *
 * 替代桌面 `grid-cols-4` 搜索区：手机端把筛选项收进抽屉，顶部只留一个「筛选」入口。
 *
 * - 受控开关：open / onOpenChange（由页面持有，便于与搜索栏联动）。
 * - 内置「筛选」触发按钮（也可放进 headerActions）；点击调 onOpenChange(true)。
 * - 底部「重置 / 确定」：确定 → onApply() + 关闭；重置 → onReset?.()（保留打开态供再筛选）。
 * - antd Drawer placement=right width=100%（手机全屏），wrapper max-w-480 居中（宽屏不拉伸）。
 * - 触摸 ≥ 44×44px、正文 ≥ 14px（R-04）。不复用桌面组件（D-001 桌面零回归）。
 */
export interface MobileFilterDrawerProps {
  /** 受控开关。 */
  open: boolean;
  /** 开关回调（触发按钮 / 确定 / 遮罩 / 关闭均经此）。 */
  onOpenChange: (open: boolean) => void;
  /** 抽屉内的筛选项（由页面填充 antd Form / 原生控件）。 */
  children: ReactNode;
  /** 应用筛选回调（点击「确定」时触发，随后自动关闭抽屉）。 */
  onApply: () => void;
  /** 可选重置回调（点击「重置」时触发，不关闭抽屉）。 */
  onReset?: () => void;
  /** 抽屉标题，默认「筛选」。 */
  title?: string;
  /** 触发按钮文案，默认「筛选」。 */
  triggerLabel?: string;
}

export function MobileFilterDrawer({
  open,
  onOpenChange,
  children,
  onApply,
  onReset,
  title = "筛选",
  triggerLabel = "筛选",
}: MobileFilterDrawerProps) {
  const close = () => onOpenChange(false);
  const handleApply = () => {
    onApply();
    close();
  };
  const handleReset = () => {
    onReset?.();
    // 重置后保留抽屉打开：用户可继续编辑或再次「确定」。
  };

  return (
    <>
      <button
        type="button"
        data-testid="mobile-filter-trigger"
        aria-label={triggerLabel}
        onClick={() => onOpenChange(true)}
        className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-border bg-card px-3 text-[14px] text-foreground transition-colors hover:bg-muted"
      >
        <SlidersHorizontal className="h-4 w-4" aria-hidden />
        {triggerLabel}
      </button>

      <Drawer
        open={open}
        placement="right"
        size="100%"
        title={<span className="text-base font-medium">{title}</span>}
        onClose={close}
        styles={{ wrapper: { maxWidth: 480, marginInline: "auto" } }}
        destroyOnHidden
        footer={
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="mobile-filter-reset"
              onClick={handleReset}
              disabled={!onReset}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-[var(--radius-md)] border border-border bg-card text-[14px] text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            >
              重置
            </button>
            <button
              type="button"
              data-testid="mobile-filter-apply"
              onClick={handleApply}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-[var(--radius-md)] bg-primary text-[14px] font-medium text-primary-foreground transition-colors hover:opacity-90"
            >
              确定
            </button>
          </div>
        }
      >
        <div data-testid="mobile-filter-body" className="text-[14px] text-foreground">
          {children}
        </div>
      </Drawer>
    </>
  );
}

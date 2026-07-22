"use client";

import type { ReactNode } from "react";
import { Drawer } from "antd";

import { cn } from "@/lib/utils";

/**
 * MobileDetailSheet — 全屏表单抽屉（design §5.5 / §7 / D-008）。
 *
 * 承载新建 / 编辑 / 别名 / 工作区创建绑定等全屏表单，替代桌面 antd Modal。
 *
 * - antd Drawer placement=right width=100%（手机全屏），wrapper max-w-480 居中。
 * - 顶栏：标题（左）+ 提交按钮「保存」（右，extra 槽）。关闭走 onClose（标题栏 X / 遮罩）。
 * - loading：提交按钮置灰 + 文案「保存中…」，防重复提交。
 * - children 为表单内容（由页面填充 antd Form），本组件不感知字段。
 * - 触摸 ≥ 44×44px、正文 ≥ 14px（R-04）。不复用桌面组件（D-001 桌面零回归）。
 */
export interface MobileDetailSheetProps {
  /** 受控开关。 */
  open: boolean;
  /** 顶栏标题（如 新建任务 / 编辑 / 设置别名）。 */
  title: string;
  /** 关闭回调（标题栏 X / 遮罩点击）。 */
  onClose: () => void;
  /** 表单内容。 */
  children: ReactNode;
  /** 提交回调（点击「保存」时触发）。 */
  onSubmit: () => void;
  /** 提交进行中：按钮置灰 + 文案「保存中…」。 */
  loading?: boolean;
  /** 提交按钮文案，默认「保存」。 */
  submitText?: string;
}

export function MobileDetailSheet({
  open,
  title,
  onClose,
  children,
  onSubmit,
  loading = false,
  submitText = "保存",
}: MobileDetailSheetProps) {
  return (
    <Drawer
      open={open}
      placement="right"
      size="100%"
      title={<span className="text-base font-medium text-foreground">{title}</span>}
      onClose={onClose}
      closable
      styles={{ wrapper: { maxWidth: 480, marginInline: "auto" } }}
      destroyOnHidden
      extra={
        <button
          type="button"
          data-testid="mobile-detail-sheet-submit"
          onClick={onSubmit}
          disabled={loading}
          aria-label={submitText}
          className={cn(
            "inline-flex min-h-[44px] items-center rounded-[var(--radius-md)] px-3 text-[14px] font-medium transition-colors",
            "bg-primary text-primary-foreground hover:opacity-90",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {loading ? "保存中…" : submitText}
        </button>
      }
    >
      <div data-testid="mobile-detail-sheet-body" className="text-[14px] text-foreground">
        {children}
      </div>
    </Drawer>
  );
}

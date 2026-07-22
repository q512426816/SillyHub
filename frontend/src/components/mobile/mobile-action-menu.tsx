"use client";

import { Drawer } from "antd";

import { cn } from "@/lib/utils";

/**
 * 移动端卡片动作（design §5.5 / §7 / D-008）。
 *
 * `actions: (item) => MobileAction[]` 由 MobileCardList 消费，本组件把这些动作
 * 渲染成底部 ActionSheet（antd Drawer placement=bottom）。点击动作 → onPress → 关闭。
 */
export interface MobileAction {
  /** 唯一 key（React 列表 key）。 */
  key: string;
  /** 中文文案（如 编辑 / 删除 / 执行 / 别名）。 */
  label: string;
  /** 危险动作（如删除）：红色文字。 */
  danger?: boolean;
  /** 点击回调；组件在调用后自动关闭 ActionSheet。 */
  onPress: () => void;
}

export interface MobileActionMenuProps {
  /** 受控开关。 */
  open: boolean;
  /** 待渲染的动作集（open=false 时可为空数组）。 */
  actions: MobileAction[];
  /** 关闭回调（点击遮罩 / 取消 / 触发动作后调用）。 */
  onClose: () => void;
  /** 可选标题，默认「操作」。 */
  title?: string;
}

/**
 * MobileActionMenu — 底部 ActionSheet。
 *
 * - antd Drawer placement=bottom，height=auto 贴合动作数量（D-008 全功能动作集入口）。
 * - 每个动作一行原生 button，min-h-[44px]（R-04 触摸热区），正文 14px（R-04）。
 * - danger 动作红色（text-destructive）。
 * - 底部「取消」按钮关闭（等价遮罩点击）。不依赖桌面组件（D-001 桌面零回归）。
 */
export function MobileActionMenu({
  open,
  actions,
  onClose,
  title = "操作",
}: MobileActionMenuProps) {
  return (
    <Drawer
      open={open}
      placement="bottom"
      onClose={onClose}
      title={<span className="text-[14px] font-medium">{title}</span>}
      closable={false}
      size="auto"
      styles={{
        wrapper: { maxWidth: 480, marginInline: "auto" },
        body: { padding: 8 },
      }}
      footer={
        <button
          type="button"
          data-testid="mobile-action-menu-cancel"
          onClick={onClose}
          className="flex min-h-[44px] w-full items-center justify-center rounded-[var(--radius-md)] bg-muted text-[14px] text-foreground transition-colors hover:bg-muted/80"
        >
          取消
        </button>
      }
    >
      <div
        data-testid="mobile-action-menu"
        className="flex flex-col gap-2"
        role="menu"
      >
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            role="menuitem"
            data-action-key={action.key}
            onClick={() => {
              action.onPress();
              onClose();
            }}
            className={cn(
              "flex min-h-[44px] w-full items-center rounded-[var(--radius-md)] bg-muted px-4 text-left text-[14px] transition-colors hover:bg-muted/80",
              action.danger
                ? "text-destructive"
                : "text-foreground",
            )}
          >
            {action.label}
          </button>
        ))}
      </div>
    </Drawer>
  );
}

"use client";

/**
 * FloatingContextMenu · 通用浮动右键菜单（2026-10-10-workspace-ref-intake task-03）。
 *
 * 从看板右键菜单先例抽离泛化（app/(dashboard)/ppm/kanban/_components/
 * kanban-task-context-menu.tsx:29-47 同模式）：
 * - 受控 open/x/y + items 透传渲染（调用方持有状态，菜单自身零业务语义）
 * - fixed 定位 + document 级 click/contextmenu/scroll（capture，兜内部滚动容器）
 *   /resize 关闭；监听随菜单关闭或卸载移除，无残留
 * - 视口 clamp：菜单右/下缘不溢出视口（估算菜单尺寸 + 最小边距）
 *
 * 品牌色走 brand-* 语义阶（hover 态随 html data-theme 换肤）；文案由调用方
 * 透传（items.label），组件不内置业务词。
 */

import { useEffect, type ReactNode } from "react";

/** 菜单项：key 供列表渲染，label 为展示文案，onSelect 点击回调（组件内自动关闭）。 */
export interface FloatingContextMenuItem {
  key: string;
  label: ReactNode;
  onSelect: () => void;
}

/** 视口 clamp 用的菜单尺寸粗估（px）——宽度按最窄可用菜单估，避免贴边溢出。 */
const ESTIMATED_MENU_WIDTH = 220;
const ESTIMATED_MENU_HEIGHT = 48;
/** clamp 最小边距（px），防菜单贴视口边缘。 */
const VIEWPORT_MARGIN = 8;

export interface FloatingContextMenuProps {
  /** 菜单开合（受控；false 时零渲染零监听）。 */
  open: boolean;
  /** 左上角 x（视口坐标，通常取 contextmenu event.clientX）。 */
  x: number;
  /** 左上角 y（视口坐标，通常取 contextmenu event.clientY）。 */
  y: number;
  /** 菜单项列表（单项为本期形态：调用方传一项即单项菜单）。 */
  items: FloatingContextMenuItem[];
  /** 关闭回调（document 级事件触发 / 菜单项点击后）。 */
  onClose: () => void;
}

export function FloatingContextMenu({
  open,
  x,
  y,
  items,
  onClose,
}: FloatingContextMenuProps) {
  // document 级关闭：点击 / 右键别处 / 滚动（capture 兜内部滚动）/ 视口缩放。
  useEffect(() => {
    if (!open) return;
    const hide = () => onClose();
    document.addEventListener("click", hide);
    document.addEventListener("contextmenu", hide);
    document.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("click", hide);
      document.removeEventListener("contextmenu", hide);
      document.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [open, onClose]);

  if (!open) return null;

  // 视口 clamp（右/下缘不溢出）。
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(x, window.innerWidth - ESTIMATED_MENU_WIDTH - VIEWPORT_MARGIN),
  );
  const top = Math.max(
    VIEWPORT_MARGIN,
    Math.min(y, window.innerHeight - ESTIMATED_MENU_HEIGHT - VIEWPORT_MARGIN),
  );

  return (
    <div
      role="menu"
      style={{ left, top }}
      className="fixed z-[9999] min-w-40 rounded-md border border-border bg-popover p-1 shadow-lg"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          className="block w-full truncate rounded px-2 py-1.5 text-left text-xs text-popover-foreground hover:bg-brand-50 hover:text-brand-700 dark:hover:bg-brand-600/20"
          onClick={() => {
            item.onSelect();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export default FloatingContextMenu;

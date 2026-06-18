"use client";

import { useState } from "react";

import {
  MENU_PERMISSION_GROUPS,
  MENU_SECTION_LABEL,
  MENU_SECTION_ORDER,
  type MenuPermissionGroup,
  type MenuSection,
} from "@/lib/menu-permissions";

interface AdminRolePermissionPickerProps {
  permissions: string[];
  onChange: (_next: string[]) => void;
  disabled?: boolean;
  className?: string;
}

export function AdminRolePermissionPicker({
  permissions,
  onChange,
  disabled = false,
  className,
}: AdminRolePermissionPickerProps) {
  // 防御性兜底：props.permissions 理论非可选，运行时若为 undefined 不崩
  const selected = permissions ?? [];
  // 默认全展开（与旧实现一致，避免破坏既有体验 / task-07 展开态断言）
  const [expandedMenus, setExpandedMenus] = useState<Set<string>>(
    () => new Set(MENU_PERMISSION_GROUPS.map((g) => g.menuKey)),
  );

  const toggleMenuExpanded = (menuKey: string) => {
    setExpandedMenus((prev) => {
      const next = new Set(prev);
      if (next.has(menuKey)) next.delete(menuKey);
      else next.add(menuKey);
      return next;
    });
  };

  const togglePermission = (key: string) => {
    if (disabled) return;
    if (selected.includes(key)) {
      onChange(selected.filter((p) => p !== key));
    } else {
      onChange([...selected, key]);
    }
  };

  const toggleMenuAll = (menu: MenuPermissionGroup) => {
    if (disabled) return;
    const keys = menu.permissions.map((p) => p.key);
    if (keys.length === 0) return;
    const allSelected = keys.every((k) => selected.includes(k));
    if (allSelected) {
      // 取消全选：严格只移除该 menu 的 key，保留其他 menu / 脏数据 key
      const removing = new Set(keys);
      onChange(selected.filter((p) => !removing.has(p)));
    } else {
      // 全选（含完全空选 + 部分选中）：合并 Set 去重
      const merged = new Set([...selected, ...keys]);
      onChange([...merged]);
    }
  };

  const renderMenu = (menu: MenuPermissionGroup) => {
    const keys = menu.permissions.map((p) => p.key);
    const selectedCount = keys.filter((k) => selected.includes(k)).length;
    const allSelected = keys.length > 0 && selectedCount === keys.length;
    const isIndeterminate =
      keys.length > 0 && selectedCount > 0 && !allSelected;
    const isExpanded = expandedMenus.has(menu.menuKey);
    const isAllCheckboxDisabled = disabled || keys.length === 0;

    const setIndeterminateRef = (el: HTMLInputElement | null) => {
      if (el) el.indeterminate = isIndeterminate;
    };

    return (
      <div
        key={menu.menuKey}
        className="rounded-md border border-border bg-card"
      >
        <div className="flex items-center gap-2 px-3 py-2">
          <button
            type="button"
            onClick={() => toggleMenuExpanded(menu.menuKey)}
            className="text-xs text-muted-foreground hover:text-foreground"
            aria-label={isExpanded ? "折叠" : "展开"}
          >
            {isExpanded ? "▼" : "▶"}
          </button>
          <label
            className={`flex flex-1 items-center gap-2 ${
              isAllCheckboxDisabled
                ? "cursor-not-allowed opacity-60"
                : "cursor-pointer"
            }`}
          >
            <input
              type="checkbox"
              checked={allSelected}
              ref={setIndeterminateRef}
              disabled={isAllCheckboxDisabled}
              onChange={() => toggleMenuAll(menu)}
              aria-label={`${menu.menuLabel} 全选`}
              className="h-3.5 w-3.5 rounded border border-input"
            />
            <span className="text-xs font-medium">{menu.menuLabel}</span>
            <span className="text-[11px] text-muted-foreground">
              （{selectedCount}/{keys.length}）
            </span>
          </label>
        </div>
        {isExpanded && (
          <div className="grid gap-1.5 border-t border-border bg-background/40 px-3 py-2 sm:grid-cols-2 lg:grid-cols-3">
            {menu.permissions.map((p) => {
              const checked = selected.includes(p.key);
              const inputId = `perm-${p.key.replace(/[^a-zA-Z0-9]/g, "-")}`;
              return (
                <label
                  key={p.key}
                  htmlFor={inputId}
                  className={`flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-[11px] transition-colors ${
                    checked
                      ? "bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
                >
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => togglePermission(p.key)}
                    aria-label={p.key}
                    className="mt-0.5 h-3 w-3 rounded border border-input"
                  />
                  <div className="flex flex-col">
                    <span className="font-medium text-foreground">
                      {p.name}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {p.key}
                    </span>
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`space-y-4 ${className ?? ""}`}>
      {MENU_SECTION_ORDER.map((section: MenuSection) => {
        // picker 过滤掉 alwaysVisible menu（这类 menu 后端无 permission 校验，
        // role 无权限可配，渲染出来只是空卡片）。
        const menus = MENU_PERMISSION_GROUPS.filter(
          (g) => g.section === section && !g.alwaysVisible,
        );
        if (menus.length === 0) return null;
        return (
          <section key={section} data-section={section}>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {MENU_SECTION_LABEL[section]}
            </div>
            <div className="space-y-2">{menus.map(renderMenu)}</div>
          </section>
        );
      })}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";

import {
  MENU_PERMISSION_GROUPS,
  MENU_SECTION_LABEL,
  MENU_SECTION_ORDER,
} from "@/lib/menu-permissions";

interface AdminRolePermissionPickerProps {
  permissions: string[];
  onChange: (_next: string[]) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * 2026-07-31-admin-roles-permission-modal task-02 / D-002：权限选择改「左树右权」
 * (transfer 风格)。左 = section/menu 树(带选中数 n/m + 高亮当前),右 = 当前 menu 的
 * 权限面板(全选/indeterminate + 权限列表)。高度固定 h-420,左右各自滚动,不再随 menu
 * 数垂直拉长。props 契约不变(permissions/onChange/disabled/className),复用既有
 * section/menu 数据源 + toggle 语义。
 */
export function AdminRolePermissionPicker({
  permissions,
  onChange,
  disabled = false,
  className,
}: AdminRolePermissionPickerProps) {
  const selected = permissions ?? [];

  // 过滤 pickerHidden 的 menu(同旧实现:这类 menu 与其他 menu 共享权限,role 无独立权限可配),
  // 按 MENU_SECTION_ORDER 分组。
  const sections = useMemo(
    () =>
      MENU_SECTION_ORDER.map((section) => ({
        section,
        menus: MENU_PERMISSION_GROUPS.filter(
          (g) => g.section === section && !g.pickerHidden,
        ),
      })).filter((s) => s.menus.length > 0),
    [],
  );

  // 默认选中第一个非 pickerHidden menu(右面板初始非空)。
  const firstMenuKey = sections[0]?.menus[0]?.menuKey ?? "";
  const [selectedMenuKey, setSelectedMenuKey] = useState<string>(firstMenuKey);
  const selectedMenu = useMemo(
    () => MENU_PERMISSION_GROUPS.find((g) => g.menuKey === selectedMenuKey),
    [selectedMenuKey],
  );

  const togglePermission = (key: string) => {
    if (disabled) return;
    if (selected.includes(key)) {
      onChange(selected.filter((p) => p !== key));
    } else {
      onChange([...selected, key]);
    }
  };

  const toggleMenuAll = (keys: string[]) => {
    if (disabled || keys.length === 0) return;
    const allSelected = keys.every((k) => selected.includes(k));
    if (allSelected) {
      const removing = new Set(keys);
      onChange(selected.filter((p) => !removing.has(p)));
    } else {
      onChange([...new Set([...selected, ...keys])]);
    }
  };

  return (
    <div
      className={`grid h-[420px] grid-cols-[200px_1fr] overflow-hidden rounded-md border border-border bg-card ${className ?? ""}`}
    >
      {/* 左树:section → menu(带选中数 n/m + 高亮当前) */}
      <div className="overflow-y-auto border-r border-border p-2">
        {sections.map(({ section, menus }) => (
          <div key={section} className="mb-2">
            <div className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {MENU_SECTION_LABEL[section]}
            </div>
            <div className="space-y-0.5">
              {menus.map((menu) => {
                const keys = menu.permissions.map((p) => p.key);
                const cnt = keys.filter((k) => selected.includes(k)).length;
                const isSel = menu.menuKey === selectedMenuKey;
                return (
                  <button
                    key={menu.menuKey}
                    type="button"
                    onClick={() => setSelectedMenuKey(menu.menuKey)}
                    className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs transition-colors ${
                      isSel
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-foreground hover:bg-muted"
                    }`}
                    aria-pressed={isSel}
                  >
                    <span className="truncate">{menu.menuLabel}</span>
                    <span
                      className={`ml-2 shrink-0 text-[10px] ${cnt > 0 ? "text-primary" : "text-muted-foreground"}`}
                    >
                      {cnt}/{keys.length}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* 右面板:当前 menu 的权限列表 + 全选 */}
      <div className="overflow-y-auto p-3">
        {selectedMenu ? (
          <RightPanel
            key={selectedMenu.menuKey}
            menuLabel={selectedMenu.menuLabel}
            menuPermissions={selectedMenu.permissions}
            selected={selected}
            disabled={disabled}
            onToggle={togglePermission}
            onToggleAll={toggleMenuAll}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            无可配权限
          </div>
        )}
      </div>
    </div>
  );
}

/** 右面板:menu 名 + 全选(indeterminate)+ 权限 checkbox 列表。 */
function RightPanel({
  menuLabel,
  menuPermissions,
  selected,
  disabled,
  onToggle,
  onToggleAll,
}: {
  menuLabel: string;
  menuPermissions: { key: string; name: string }[];
  selected: string[];
  disabled: boolean;
  onToggle: (_key: string) => void;
  onToggleAll: (_keys: string[]) => void;
}) {
  const keys = menuPermissions.map((p) => p.key);
  const selectedCount = keys.filter((k) => selected.includes(k)).length;
  const allSelected = keys.length > 0 && selectedCount === keys.length;
  const isIndeterminate =
    keys.length > 0 && selectedCount > 0 && !allSelected;

  const setIndeterminateRef = (el: HTMLInputElement | null) => {
    if (el) el.indeterminate = isIndeterminate;
  };

  return (
    <>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">{menuLabel}</span>
        <label
          className={`flex items-center gap-1.5 text-[11px] ${disabled || keys.length === 0 ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer text-primary"}`}
        >
          <input
            type="checkbox"
            checked={allSelected}
            ref={setIndeterminateRef}
            disabled={disabled || keys.length === 0}
            onChange={() => onToggleAll(keys)}
            aria-label={`${menuLabel} 全选`}
            className="h-3.5 w-3.5 rounded border border-input"
          />
          全选（{selectedCount}/{keys.length}）
        </label>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {menuPermissions.map((p) => {
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
                onChange={() => onToggle(p.key)}
                aria-label={p.key}
                className="mt-0.5 h-3 w-3 rounded border border-input"
              />
              <div className="flex flex-col">
                <span className="font-medium text-foreground">{p.name}</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {p.key}
                </span>
              </div>
            </label>
          );
        })}
      </div>
    </>
  );
}

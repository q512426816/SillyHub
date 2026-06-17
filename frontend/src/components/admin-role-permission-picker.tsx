"use client";

import { useState } from "react";

import {
  PERMISSION_GROUPS,
  type PermissionGroup,
} from "@/lib/admin";

interface AdminRolePermissionPickerProps {
  permissions: string[];
  onChange: (_next: string[]) => void;
  disabled?: boolean;
  className?: string;
}

const GROUP_LABEL: Record<PermissionGroup, string> = {
  PLATFORM: "平台",
  ADMIN: "管理（用户/组织/角色）",
  WORKSPACE: "Workspace",
  AGENT: "Agent / 代码 / 部署 / 工具",
  CHANGE: "变更",
  AUDIT: "审计",
};

export function AdminRolePermissionPicker({
  permissions,
  onChange,
  disabled = false,
  className,
}: AdminRolePermissionPickerProps) {
  const [expanded, setExpanded] = useState<Set<PermissionGroup>>(
    new Set(PERMISSION_GROUPS.map((g) => g.group)),
  );

  const toggleGroupExpanded = (g: PermissionGroup) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  };

  const togglePermission = (key: string) => {
    if (disabled) return;
    if (permissions.includes(key)) {
      onChange(permissions.filter((p) => p !== key));
    } else {
      onChange([...permissions, key]);
    }
  };

  const toggleGroupAll = (group: PermissionGroup, allKeys: string[]) => {
    if (disabled) return;
    const allSelected = allKeys.every((k) => permissions.includes(k));
    if (allSelected) {
      onChange(permissions.filter((p) => !allKeys.includes(p)));
    } else {
      const merged = new Set([...permissions, ...allKeys]);
      onChange([...merged]);
    }
  };

  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      {PERMISSION_GROUPS.map((g) => {
        const keys = g.permissions.map((p) => p.key);
        const selectedCount = keys.filter((k) => permissions.includes(k)).length;
        const allSelected = selectedCount === keys.length;
        const isExpanded = expanded.has(g.group);

        return (
          <div
            key={g.group}
            className="rounded-md border border-border bg-card"
          >
            <div className="flex items-center gap-2 px-3 py-2">
              <button
                type="button"
                onClick={() => toggleGroupExpanded(g.group)}
                className="text-xs text-muted-foreground hover:text-foreground"
                aria-label={isExpanded ? "折叠" : "展开"}
              >
                {isExpanded ? "▼" : "▶"}
              </button>
              <label className="flex flex-1 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  disabled={disabled}
                  onChange={() => toggleGroupAll(g.group, keys)}
                  className="h-3.5 w-3.5 rounded border border-input"
                />
                <span className="text-xs font-medium">
                  {GROUP_LABEL[g.group]}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  （{selectedCount}/{keys.length}）
                </span>
              </label>
            </div>
            {isExpanded && (
              <div className="grid gap-1.5 border-t border-border bg-background/40 px-3 py-2 sm:grid-cols-2 lg:grid-cols-3">
                {g.permissions.map((p) => {
                  const checked = permissions.includes(p.key);
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
      })}
    </div>
  );
}

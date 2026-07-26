"use client";

/**
 * change 2026-07-25-daemon-borrow-for-business task-12 / FR-01 / D-003@v1
 *
 * lender（开发人员）「共享我的 daemon」开关。
 *
 * 渲染在 lender 自己的工作区设置区（WorkspaceConfigCard「我的接入」下方），
 * 仅当 lender 已绑定 daemon（myBinding 存在）时有意义 —— 未绑定时由父级不渲染。
 *
 * 交互：勾选/取消勾选 → 调 ``setMyBindingShared(workspaceId, next)`` →
 * 成功后 ``onChanged()`` 通知父级刷新（父级重新 fetch myBinding 回填最新 shared）。
 * 失败显示行内错误，开关回滚到上一个值。
 *
 * 设计：复用前端样式系统（archive/2026-06-21-frontend-style-system）的卡片/按钮风格，
 * 开关用原生 input[type=checkbox] + tailwind 样式（与成员管理页 role 下拉同源朴素控件）。
 * 不引入新 UI 库组件，跨平台一致。
 */

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { ApiError } from "@/lib/api";
import { setMyBindingShared } from "@/lib/workspace-binding";

export interface SharedDaemonToggleProps {
  workspaceId: string;
  /** 当前 shared 状态（来自父级 myBinding.shared）。 */
  shared: boolean;
  /** lender 已绑定的 daemon 显示名（hostname/alias），用于说明文案。 */
  daemonLabel?: string | null;
  /** 共享状态变更成功后回调（父级刷新 myBinding）。 */
  onChanged: () => void;
}

export function SharedDaemonToggle({
  workspaceId,
  shared,
  daemonLabel,
  onChanged,
}: SharedDaemonToggleProps): JSX.Element {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(next: boolean): Promise<void> {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await setMyBindingShared(workspaceId, next);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "更新共享状态失败");
    } finally {
      setPending(false);
    }
  }

  const labelText = daemonLabel ? `共享「${daemonLabel}」` : "共享我的守护进程";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 text-xs">
          <input
            type="checkbox"
            role="switch"
            aria-checked={shared}
            data-testid="shared-daemon-toggle"
            checked={shared}
            disabled={pending}
            onChange={(e) => void handleChange(e.target.checked)}
            className="h-4 w-4 rounded border-input accent-primary disabled:opacity-50"
          />
          <span>{labelText}</span>
        </label>
        {shared ? (
          <Badge variant="success" className="text-[10px]">
            已共享
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px]">
            未共享
          </Badge>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        共享后，本工作区的业务/管理人员可借用此守护进程跑智能体（只读源码、产出方案回传），
        不会改动你的代码区。
      </p>
      {error && (
        <p className="text-[11px] text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

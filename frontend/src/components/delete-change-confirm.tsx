"use client";

/**
 * DeleteChangeConfirm — 变更删除受控确认弹层（task-07 /
 * 2026-08-29-change-delete-closure-and-spec-pull，design §6.3 / FR-05d）。
 *
 * 照 admin/users/page.tsx DeleteConfirm 受控确认范式（fixed overlay + 受控
 * target state，:89/:207-220/:589-614）：父组件持有 target（null = 关闭），
 * onConfirm 后由父组件关弹层并触发 useMutation（deleteChange），本组件零请求。
 *
 * 防呆（对照原型 prototype-delete-and-pull.html）：需输入「变更名末段」——
 * change_key 去掉 YYYY-MM-DD- 日期前缀后的段（changeKeyTail）完全相等才启用
 * 确认按钮（原型 placeholder=change-delete-closure-and-spec-pull）；取消不
 * 触发任何请求。
 *
 * 样式（CLAUDE.md 规则 20）：危险语义走主题 token——警示框 border/bg/text
 * destructive 阶、确认按钮 Button variant="destructive"（globals.css 两主题
 * --destructive 同源换肤），无品牌蓝/危险色硬编码，ai-native/blue 双主题适配。
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { fetchMe } from "@/lib/auth";
import { useSession } from "@/stores/session";

/**
 * 末段防呆期望值：change_key 去掉 YYYY-MM-DD- 日期前缀后的段
 * （原型 target.split('-').slice(3).join('-') 的日期前缀防御版：非日期前缀
 * key 原样返回，不误切前 3 段——quick 等非线性变更名无日期头）。
 */
export function changeKeyTail(changeKey: string): string {
  return /^\d{4}-\d{2}-\d{2}-/.test(changeKey)
    ? changeKey.split("-").slice(3).join("-")
    : changeKey;
}

/** 弹层目标：ChangeSummary 结构兼容（只消费 change_key / owner_name 两字段）。 */
export interface DeleteChangeTarget {
  change_key: string;
  owner_name?: string | null;
}

/** 删除入口可见性启发式的三要素（useChangeDeleteAccess 的返回形状）。 */
export interface ChangeDeleteAccess {
  /** 当前登录用户 id（session store；未登录为 null）。 */
  userId: string | null;
  /** 是否平台管理员（session store is_platform_admin）。 */
  isPlatformAdmin: boolean;
  /** 当前用户在本工作区的角色 key（fetchMe workspaces[].role_key；未知为 null）。 */
  workspaceRole: string | null;
}

/**
 * 删除入口可见性纯启发式（design §6.3 / FR-05d，task-07）：
 * owner 本人 / 平台管理员 / 工作区所有者（workspace_owner）三判其一直通。
 *
 * ⚠️ 仅为入口可见性（少给无权用户看按钮），不是权限判定——后端 DELETE 端点的
 * 组合权限（CHANGE_ARCHIVE OR owner）为权威，前端判漏时后端 403 兜底。
 */
export function canDeleteChange(
  change: { owner_id: string | null },
  access: ChangeDeleteAccess,
): boolean {
  if (access.isPlatformAdmin) return true;
  if (access.userId && change.owner_id === access.userId) return true;
  return access.workspaceRole === "workspace_owner";
}

/**
 * 删除入口可见性数据源 hook（桌面列表 / 详情 / 移动端三页共用，零复制实现）。
 *
 * - userId / isPlatformAdmin 取 session store（layout 已 fetchMe 维护）；
 * - workspaceRole 取 fetchMe().workspaces[].role_key（既有只读 API，只调用
 *   不改动），react-query 缓存（staleTime 5min）跨页面共享，未登录不发请求
 *   （enabled: Boolean(user)——无会话即无入口，也不浪费一次 /auth/me）；
 * - 请求失败静默降级 role=null（启发式收紧为 owner/平台管理员两判）。
 */
export function useChangeDeleteAccess(
  workspaceId: string,
): ChangeDeleteAccess {
  const user = useSession((s) => s.user);
  const meQuery = useQuery({
    queryKey: ["me", "workspaceRoles"],
    queryFn: () => fetchMe(),
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const workspaceRole =
    meQuery.data?.workspaces.find((w) => w.workspace_id === workspaceId)
      ?.role_key ?? null;
  return {
    userId: user?.id ?? null,
    isPlatformAdmin: Boolean(user?.is_platform_admin),
    workspaceRole,
  };
}

export interface DeleteChangeConfirmProps {
  /** 待删除目标（ChangeSummary 或 { change_key, owner_name }）。 */
  target: DeleteChangeTarget;
  /** 取消（父组件置 target=null 关闭；不触发任何请求）。 */
  onCancel: () => void;
  /** 确认删除（末段输入完全相等才可点；父组件关弹层 + 调 deleteChange）。 */
  onConfirm: () => void;
}

export function DeleteChangeConfirm({
  target,
  onCancel,
  onConfirm,
}: DeleteChangeConfirmProps) {
  const [confirmText, setConfirmText] = useState("");
  const tail = changeKeyTail(target.change_key);
  // 完全相等才启用（空串不启用——tail 恒非空，但防御空 key 不放行）
  const canConfirm = tail !== "" && confirmText === tail;

  return (
    <div
      data-testid="delete-change-confirm"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
    >
      <div className="w-96 rounded-md border bg-background p-5 shadow-lg">
        <h3 className="text-sm font-semibold">删除变更</h3>
        <p className="mt-2 break-all font-mono text-xs text-foreground">
          {target.change_key}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          负责人：{target.owner_name || "—"}
        </p>
        {/* 不可恢复警示（对照原型 .warn，danger 语义阶主题 token） */}
        <div className="mt-3 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          该操作不可恢复：变更将从变更中心移除，服务器镜像文件移入 30
          天备份区后自动过期。工作区全体成员将不再看到此变更。
        </div>
        <label
          htmlFor="delete-change-confirm-input"
          className="mt-3 block text-xs text-muted-foreground"
        >
          输入变更名末段以确认：
        </label>
        <input
          id="delete-change-confirm-input"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={tail}
          data-testid="delete-change-confirm-input"
          className="mt-1 h-8 w-full rounded border border-input bg-background px-2.5 font-mono text-sm focus:border-ring focus:outline-none"
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={!canConfirm}
            onClick={onConfirm}
          >
            确认删除
          </Button>
        </div>
      </div>
    </div>
  );
}

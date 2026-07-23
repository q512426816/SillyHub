"use client";

/**
 * 移动端「我的」页面（个人中心）—— gap-1 闭环。
 *
 * 之前 mobile-tab-bar「我的」href=/account，但 middleware matcher 不含 /account，
 * 手机点「我的」直接落桌面 web UI。现 matcher 加 /account → rewrite 到 /m/account，
 * 本页作为移动端个人中心（头像/昵称/角色/修改密码/退出登录）。
 *
 * 复用：useSession（user）+ lib/auth logout/changePassword（不另建认证，D-003）。
 * route-guard 白名单 MOBILE_WORKSPACE_WHITELIST 已含 /account，放行不要求 wsId。
 *
 * 密集入口区域：修改密码 + 系统设置 + 平台版本（参照桌面 account/page.tsx 修改密码
 * 和 settings/page.tsx 功能布局，移动端自绘卡片列表不复用桌面组件）。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "antd";
import { KeyOutlined, LogoutOutlined, SettingOutlined } from "@ant-design/icons";

import { changePassword, logout } from "@/lib/auth";
import { useSession } from "@/stores/session";

export default function MobileAccountPage() {
  const router = useRouter();
  const { user } = useSession();
  const [loading, setLoading] = useState(false);

  // 修改密码表单
  const [showPwdForm, setShowPwdForm] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState<string | null>(null);

  async function handleLogout() {
    setLoading(true);
    try {
      await logout();
    } finally {
      setLoading(false);
      // token 已清，主动回移动登录页（route-guard 也会拦截，这里即时跳转更顺滑）
      router.replace("/m/login");
    }
  }

  async function handleChangePassword() {
    if (!oldPassword || !newPassword) return;
    setPwdSaving(true);
    setPwdError(null);
    setPwdSuccess(null);
    try {
      await changePassword(oldPassword, newPassword);
      setPwdSuccess("密码已修改");
      setOldPassword("");
      setNewPassword("");
      setShowPwdForm(false);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "修改失败";
      if (/PASSWORD_INCORRECT/i.test(msg) || /旧密码错误/.test(msg)) {
        setPwdError("旧密码错误");
      } else {
        setPwdError(msg || "修改失败");
      }
    } finally {
      setPwdSaving(false);
    }
  }

  const displayName = user?.displayName || user?.email || "未登录";
  const initial = displayName.slice(0, 1).toUpperCase();

  return (
    <div className="flex min-h-[100dvh] flex-col bg-muted/30">
      {/* 头像 + 昵称 + 角色 */}
      <div className="flex items-center gap-4 bg-card p-6 pt-10 shadow-[var(--shadow-sm)]">
        <div
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary text-2xl font-semibold text-primary-foreground"
          aria-label="头像"
        >
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-medium text-foreground">
            {displayName}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {user?.is_platform_admin ? "平台管理员" : "成员"}
            {user?.email && user.email !== displayName ? ` · ${user.email}` : ""}
          </div>
        </div>
      </div>

      {/* 功能入口列表 */}
      <div className="flex flex-col gap-2 px-4 py-5">
        {/* 修改密码 */}
        <button
          type="button"
          onClick={() => setShowPwdForm(!showPwdForm)}
          className="flex min-h-[48px] items-center gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 text-left text-[14px] text-foreground shadow-[var(--shadow-sm)] transition hover:bg-muted/50 active:scale-[0.99]"
        >
          <KeyOutlined className="text-[16px] text-muted-foreground" />
          <span className="flex-1 font-medium">修改密码</span>
          <span className="text-[12px] text-muted-foreground">
            {showPwdForm ? "收起" : "设置"}
          </span>
        </button>

        {showPwdForm && (
          <div className="rounded-xl border border-border/60 bg-card p-4 shadow-[var(--shadow-sm)]">
            <div className="space-y-3">
              <input
                type="password"
                placeholder="旧密码"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-[14px] outline-none focus:border-primary"
              />
              <input
                type="password"
                placeholder="新密码（至少 8 位）"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-[14px] outline-none focus:border-primary"
              />
              {pwdError && (
                <p className="text-[13px] text-red-500">{pwdError}</p>
              )}
              {pwdSuccess && (
                <p className="text-[13px] text-emerald-600">{pwdSuccess}</p>
              )}
              <Button
                block
                size="large"
                type="primary"
                loading={pwdSaving}
                disabled={!oldPassword || !newPassword}
                onClick={() => void handleChangePassword()}
                className="!h-10 !min-h-[44px] !rounded-lg !text-[14px]"
              >
                确认修改
              </Button>
            </div>
          </div>
        )}

        {/* 系统设置 */}
        <button
          type="button"
          onClick={() => router.push("/m/workspaces")}
          className="flex min-h-[48px] items-center gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 text-left text-[14px] text-foreground shadow-[var(--shadow-sm)] transition hover:bg-muted/50 active:scale-[0.99]"
        >
          <SettingOutlined className="text-[16px] text-muted-foreground" />
          <span className="flex-1 font-medium">工作区设置</span>
          <span className="text-[12px] text-muted-foreground">跳转</span>
        </button>
      </div>

      {/* 版本信息 */}
      <div className="px-4 pb-2 text-center text-[12px] text-muted-foreground/60">
        v0.1.0 · SillyHub
      </div>

      {/* 退出登录 */}
      <div className="mt-auto p-6 pb-10">
        <Button
          block
          danger
          size="large"
          loading={loading}
          icon={<LogoutOutlined />}
          onClick={handleLogout}
          className="!h-12 !min-h-[44px] !rounded-lg !text-[14px]"
        >
          退出登录
        </Button>
      </div>
    </div>
  );
}

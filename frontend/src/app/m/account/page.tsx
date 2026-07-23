"use client";

/**
 * 移动端「我的」页面（个人中心）—— gap-1 闭环。
 *
 * 之前 mobile-tab-bar「我的」href=/account，但 middleware matcher 不含 /account，
 * 手机点「我的」直接落桌面 web UI。现 matcher 加 /account → rewrite 到 /m/account，
 * 本页作为移动端个人中心（头像/昵称/角色/退出登录）。
 *
 * 复用：useSession（user）+ lib/auth logout（不另建认证，D-003）。
 * route-guard 白名单 MOBILE_WORKSPACE_WHITELIST 已含 /account，放行不要求 wsId。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "antd";
import { LogoutOutlined } from "@ant-design/icons";

import { logout } from "@/lib/auth";
import { useSession } from "@/stores/session";

export default function MobileAccountPage() {
  const router = useRouter();
  const { user } = useSession();
  const [loading, setLoading] = useState(false);

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

      {/* 后续可扩展：修改密码 / 设置等入口 */}

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

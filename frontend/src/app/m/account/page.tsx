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
 * 头像上传（2026-09-10-account-avatar-upload task-08 / FR-04）：头像整块可点
 * 选图上传（相机角标提示），上传走 uploadFile(owner_type=user_avatar) +
 * updateMyAvatar 写回 store；有自定义头像时提供「恢复默认头像」小入口；
 * 上传中禁点、非图片/失败页内文案提示（触控目标 ≥44px 移动规范）。
 *
 * 密集入口区域：修改密码 + 系统设置 + 平台版本（参照桌面 account/page.tsx 修改密码
 * 和 settings/page.tsx 功能布局，移动端自绘卡片列表不复用桌面组件）。
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "antd";
import {
  CameraOutlined,
  KeyOutlined,
  LogoutOutlined,
  SettingOutlined,
} from "@ant-design/icons";

import { USER_AVATAR_OWNER_TYPE } from "@/components/group-chat/group-member-avatar";
import { useAvatarSrc } from "@/components/chat/use-avatar-src";
import { changePassword, logout, updateMyAvatar } from "@/lib/auth";
import { errMessage } from "@/lib/errors";
import { getFileDownloadUrl, uploadFile } from "@/lib/file/api";
import { useSession } from "@/stores/session";

export default function MobileAccountPage() {
  const router = useRouter();
  const user = useSession((s) => s.user);
  const [loading, setLoading] = useState(false);

  // 头像上传（2026-09-10-account-avatar-upload task-08）：整块可点选图，走
  // uploadFile(owner_type=user_avatar) → updateMyAvatar 写回 session store
  //（内部重跑 fetchMe），页面不自管 avatar 副本；上传/恢复中禁点防重复。
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const avatarSrc = useAvatarSrc(user?.avatar);

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

  // 选图处理：非图片直接提示（口径对齐 group-member-avatar 的 handleFile），
  // 图片则上传 → getFileDownloadUrl → updateMyAvatar（store 刷新后头像区自动重渲）。
  async function handleAvatarFile(files: FileList | null) {
    const file = files?.[0];
    if (avatarInputRef.current) avatarInputRef.current.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setAvatarError("头像仅支持图片文件，请重新选择");
      return;
    }
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      const resp = await uploadFile(file, {
        owner_type: USER_AVATAR_OWNER_TYPE,
      });
      await updateMyAvatar(getFileDownloadUrl(resp.id));
    } catch (err) {
      setAvatarError(errMessage(err, "头像上传失败，请稍后重试"));
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleResetAvatar() {
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      await updateMyAvatar(null);
    } catch (err) {
      setAvatarError(errMessage(err, "头像保存失败，请稍后重试"));
    } finally {
      setAvatarBusy(false);
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
      {/* 头像 + 昵称 + 角色（头像整块可点上传 + 相机角标，触控目标 h-16 w-16 ≥44px） */}
      <div className="flex flex-col bg-card p-6 pt-10 shadow-[var(--shadow-sm)]">
        <div className="flex items-center gap-4">
          <div className="relative shrink-0">
            <button
              type="button"
              aria-label="更换头像"
              title={avatarBusy ? "上传中…" : "更换头像"}
              disabled={avatarBusy}
              onClick={() => avatarInputRef.current?.click()}
              className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-primary text-2xl font-semibold text-primary-foreground transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {avatarSrc ? (
                /* eslint-disable-next-line @next/next/no-img-element -- blob objectURL/外链，非静态资源 */
                <img
                  src={avatarSrc}
                  alt={`${displayName}的头像`}
                  className="h-full w-full object-cover"
                />
              ) : (
                initial
              )}
            </button>
            {/* 相机角标：提示头像可更换 */}
            <span
              aria-hidden
              className="pointer-events-none absolute bottom-0 right-0 flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-white shadow-[var(--shadow-sm)]"
            >
              <CameraOutlined className="text-[12px]" />
            </span>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              hidden
              aria-label="我的头像（选择图片）"
              onChange={(e) => void handleAvatarFile(e.target.files)}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-medium text-foreground">
              {displayName}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {user?.is_platform_admin ? "平台管理员" : "成员"}
              {user?.email && user.email !== displayName
                ? ` · ${user.email}`
                : ""}
            </div>
            {/* 有自定义头像时提供恢复默认小入口（触控 ≥44px） */}
            {user?.avatar && (
              <button
                type="button"
                disabled={avatarBusy}
                onClick={() => void handleResetAvatar()}
                className="mt-2 inline-flex min-h-[44px] items-center rounded-lg border border-border/60 bg-card px-3 text-[13px] text-muted-foreground shadow-[var(--shadow-sm)] transition hover:bg-muted/50 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
              >
                恢复默认头像
              </button>
            )}
          </div>
        </div>
        {avatarError && (
          <p role="alert" className="mt-2 text-[13px] text-destructive">
            {avatarError}
          </p>
        )}
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

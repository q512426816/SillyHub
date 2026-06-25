"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type {
  OrganizationRead,
  RoleRead,
  UserCreateRequest,
  UserRead,
  UserUpdateRequest,
} from "@/lib/admin";

interface AdminUserDrawerProps {
  open: boolean;
  mode: "create" | "edit";
  user?: UserRead;
  onClose: () => void;
  onSubmit: (
    _body: UserCreateRequest | UserUpdateRequest,
  ) => Promise<void>;
  organizations: OrganizationRead[];
  roles: RoleRead[];
  canWrite: boolean;
  canLoginManage: boolean;
  currentUserId: string;
}

const inputCls =
  "h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AdminUserDrawer({
  open,
  mode,
  user,
  onClose,
  onSubmit,
  organizations,
  roles,
  canWrite,
  canLoginManage,
  currentUserId,
}: AdminUserDrawerProps) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [loginEnabled, setLoginEnabled] = useState(true);
  const [organizationIds, setOrganizationIds] = useState<string[]>([]);
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPassword("");
    if (mode === "edit" && user) {
      setUsername(user.username ?? "");
      setEmail(user.email ?? "");
      setDisplayName(user.display_name ?? "");
      setIsPlatformAdmin(user.is_platform_admin);
      setLoginEnabled(user.login_enabled);
      setOrganizationIds(user.organizations.map((o) => o.id));
      setRoleIds(user.roles.map((r) => r.id));
    } else {
      setUsername("");
      setEmail("");
      setDisplayName("");
      setIsPlatformAdmin(false);
      setLoginEnabled(true);
      setOrganizationIds([]);
      setRoleIds([]);
    }
  }, [open, mode, user]);

  if (!open) return null;

  const isSelf = !!user && user.id === currentUserId;
  const usernameValid = username.trim().length >= 3;
  const emailValid = email.trim() === "" || EMAIL_PATTERN.test(email);
  const passwordValid = mode === "edit" || password.length >= 8;
  const formValid = usernameValid && emailValid && passwordValid;

  const toggleOrg = (id: string) => {
    setOrganizationIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };
  const toggleRole = (id: string) => {
    setRoleIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleSubmit = async () => {
    if (!formValid || !canWrite || saving) return;
    setSaving(true);
    setError(null);
    try {
      if (mode === "create") {
        const body: UserCreateRequest = {
          username,
          email: email.trim() || null,
          password,
          is_platform_admin: isPlatformAdmin,
          login_enabled: loginEnabled,
        };
        if (displayName) body.display_name = displayName;
        if (organizationIds.length) body.organization_ids = organizationIds;
        if (roleIds.length) body.role_ids = roleIds;
        await onSubmit(body);
      } else if (user) {
        const body: UserUpdateRequest = {
          username: username !== user.username ? username : undefined,
          email:
            email !== (user.email ?? "")
              ? email.trim() || null
              : undefined,
          display_name: displayName || undefined,
          is_platform_admin: isPlatformAdmin,
          login_enabled: loginEnabled,
          organization_ids: organizationIds,
          role_ids: roleIds,
        };
        await onSubmit(body);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-[520px] flex-col border-l bg-background shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-medium">
            {mode === "create" ? "新建用户" : `编辑用户 ${user?.username}`}
            {isSelf && (
              <span className="ml-2 text-[11px] text-amber-600">
                （您正在编辑自己，部分操作受限）
              </span>
            )}
          </h3>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <div>
            <label className="text-[11px] text-muted-foreground">
              登录名 *
            </label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={!canWrite}
              aria-label="登录名"
              className={`mt-0.5 ${inputCls} ${
                !usernameValid && username ? "border-destructive" : ""
              }`}
            />
            {!usernameValid && username && (
              <p className="mt-1 text-[10px] text-destructive">
                登录名至少 3 位
              </p>
            )}
          </div>

          <div>
            <label className="text-[11px] text-muted-foreground">
              邮箱（可选）
            </label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={!canWrite}
              aria-label="邮箱"
              className={`mt-0.5 ${inputCls} ${
                email && !emailValid ? "border-destructive" : ""
              }`}
            />
            {email && !emailValid && (
              <p className="mt-1 text-[10px] text-destructive">
                邮箱格式不合法
              </p>
            )}
          </div>

          {mode === "create" && (
            <div>
              <label className="text-[11px] text-muted-foreground">
                密码（至少 8 位）
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={!canWrite}
                aria-label="密码"
                className={`mt-0.5 ${inputCls} ${
                  !passwordValid && password ? "border-destructive" : ""
                }`}
              />
              {!passwordValid && password && (
                <p className="mt-1 text-[10px] text-destructive">
                  密码至少 8 位
                </p>
              )}
            </div>
          )}

          <div>
            <label className="text-[11px] text-muted-foreground">
              显示名（可选）
            </label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={!canWrite}
              aria-label="显示名"
              maxLength={100}
              className={`mt-0.5 ${inputCls}`}
            />
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={isPlatformAdmin}
                onChange={(e) => setIsPlatformAdmin(e.target.checked)}
                disabled={
                  !canWrite ||
                  (isSelf && isPlatformAdmin)
                }
                aria-label="平台超级管理员"
                className="h-3.5 w-3.5 rounded border border-input"
              />
              <span>平台超级管理员</span>
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={loginEnabled}
                onChange={(e) => setLoginEnabled(e.target.checked)}
                disabled={!canLoginManage || (isSelf && !loginEnabled)}
                aria-label="允许登录"
                className="h-3.5 w-3.5 rounded border border-input"
              />
              <span>允许登录</span>
            </label>
          </div>
          {isSelf && (
            <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] text-amber-700">
              您正在编辑自己：不能取消自己的超管权限或禁用自己的登录。
            </p>
          )}

          <div>
            <label className="text-[11px] text-muted-foreground">
              组织（多选）
            </label>
            <div className="mt-1 max-h-32 overflow-y-auto rounded border bg-background p-2">
              {organizations.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  暂无可选组织
                </p>
              ) : (
                organizations.map((o) => (
                  <label
                    key={o.id}
                    className="flex cursor-pointer items-center gap-2 px-1 py-0.5 text-xs hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      checked={organizationIds.includes(o.id)}
                      onChange={() => toggleOrg(o.id)}
                      disabled={!canWrite}
                      aria-label={o.code}
                      className="h-3 w-3 rounded border border-input"
                    />
                    <span className="flex-1">{o.name}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {o.code}
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>

          <div>
            <label className="text-[11px] text-muted-foreground">
              角色（多选）
            </label>
            <div className="mt-1 max-h-32 overflow-y-auto rounded border bg-background p-2">
              {roles.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  暂无可选角色
                </p>
              ) : (
                roles.map((r) => (
                  <label
                    key={r.id}
                    className="flex cursor-pointer items-center gap-2 px-1 py-0.5 text-xs hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      checked={roleIds.includes(r.id)}
                      onChange={() => toggleRole(r.id)}
                      disabled={!canWrite}
                      className="h-3 w-3 rounded border border-input"
                    />
                    <span className="flex-1">{r.name}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {r.key}
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>

          {error && <p className="text-[11px] text-destructive">{error}</p>}
        </div>

        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t bg-background px-4 py-3">
          <Button variant="outline" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            disabled={!canWrite || !formValid || saving}
            onClick={() => void handleSubmit()}
          >
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AdminUserDrawer } from "@/components/admin-user-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  createUser,
  deleteUser,
  disableUserLogin,
  enableUserLogin,
  listOrganizations,
  listRoles,
  listUserAudit,
  listUserSessions,
  listUsers,
  resetUserPassword,
  revokeAllUserSessions,
  revokeUserSession,
  updateUser,
  type AuditLogRead,
  type OrganizationRead,
  type RoleRead,
  type UserCreateRequest,
  type UserRead,
  type UserSessionRead,
  type UserUpdateRequest,
} from "@/lib/admin";
import { useSession } from "@/stores/session";

type StatusFilter = "all" | "active" | "disabled";

interface DrawerState {
  open: boolean;
  mode: "create" | "edit";
  user?: UserRead;
}

const inputCls =
  "h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none";

export default function AdminUsersPage() {
  const { user: currentUser } = useSession();
  const canWrite = !!currentUser?.is_platform_admin ||
    !!currentUser?.permissions?.includes("user:write");
  const canLoginManage = !!currentUser?.is_platform_admin ||
    !!currentUser?.permissions?.includes("user:login:manage");
  const currentUserId = currentUser?.id ?? "";

  const [users, setUsers] = useState<UserRead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [drawer, setDrawer] = useState<DrawerState>({
    open: false,
    mode: "create",
  });
  const [confirmDelete, setConfirmDelete] = useState<UserRead | null>(null);
  const [resetTarget, setResetTarget] = useState<UserRead | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  const [organizations, setOrganizations] = useState<OrganizationRead[]>([]);
  const [roles, setRoles] = useState<RoleRead[]>([]);

  const [sessionsDrawer, setSessionsDrawer] = useState<UserRead | null>(null);
  const [auditDrawer, setAuditDrawer] = useState<UserRead | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Parameters<typeof listUsers>[0] = {};
      if (search) params.q = search;
      if (statusFilter !== "all") params.status = statusFilter;
      params.limit = 200;
      const resp = await listUsers(params);
      setUsers(resp.items);
      setTotal(resp.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        const [orgs, rolesResp] = await Promise.all([
          listOrganizations(),
          listRoles({ size: 200 }),
        ]);
        setOrganizations(orgs);
        setRoles(rolesResp.items);
      } catch {
        // ignore — drawer will show empty selects
      }
    })();
  }, []);

  const showToast = (ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 3000);
  };

  const handleSearchInput = (value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(value), 400);
  };

  const handleSubmit = async (
    body: UserCreateRequest | UserUpdateRequest,
  ) => {
    if (drawer.mode === "create") {
      const created = await createUser(body as UserCreateRequest);
      showToast(true, `用户 ${created.email} 已创建`);
    } else if (drawer.user) {
      const updated = await updateUser(drawer.user.id, body as UserUpdateRequest);
      showToast(true, `用户 ${updated.email} 已更新`);
    }
    setDrawer({ open: false, mode: "create" });
    await load();
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    try {
      await deleteUser(target.id);
      showToast(true, `用户 ${target.email} 已删除`);
      await load();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      let msg = "删除失败";
      if (code === "USER_CANNOT_DELETE_SELF") {
        msg = "不能删除自己";
      } else if (code === "LAST_PLATFORM_ADMIN") {
        msg = "不能删除最后一个平台超级管理员";
      } else if (err instanceof ApiError) {
        msg = err.message;
      }
      showToast(false, msg);
    }
  };

  const handleToggleLogin = async (u: UserRead) => {
    try {
      if (u.login_enabled) {
        await disableUserLogin(u.id);
        showToast(true, `已禁用 ${u.email} 的登录`);
      } else {
        await enableUserLogin(u.id);
        showToast(true, `已启用 ${u.email} 的登录`);
      }
      await load();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      let msg = "操作失败";
      if (code === "USER_CANNOT_DISABLE_SELF") {
        msg = "不能禁用自己的登录";
      } else if (err instanceof ApiError) {
        msg = err.message;
      }
      showToast(false, msg);
    }
  };

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="mt-0.5">用户管理</h1>
          <p className="text-xs text-muted-foreground">
            平台用户、登录权限、会话与审计
          </p>
        </div>
        <Button
          size="sm"
          disabled={!canWrite}
          onClick={() => setDrawer({ open: true, mode: "create" })}
          title={!canWrite ? "无 user:write 权限" : undefined}
        >
          + 新建用户
        </Button>
      </header>

      {toast && (
        <div
          className={`rounded border px-3 py-2 text-xs ${
            toast.ok
              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
              : "border-destructive/30 bg-red-50 text-destructive"
          }`}
        >
          {toast.text}
        </div>
      )}

      {error ? (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {error}
          <Button
            size="sm"
            variant="outline"
            className="ml-3"
            onClick={() => void load()}
          >
            重新加载
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={searchInput}
              onChange={(e) => handleSearchInput(e.target.value)}
              placeholder="搜索 email / 显示名…"
              className={`w-72 ${inputCls}`}
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className={`w-32 ${inputCls}`}
              aria-label="状态筛选"
            >
              <option value="all">全部状态</option>
              <option value="active">启用</option>
              <option value="disabled">禁用</option>
            </select>
            <span className="ml-auto text-xs text-muted-foreground">
              共 {total} 个用户
            </span>
          </div>

          <div className="overflow-x-auto rounded-md border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30 text-left text-xs">
                <tr>
                  <th className="px-3 py-2 font-medium">邮箱</th>
                  <th className="px-3 py-2 font-medium">显示名</th>
                  <th className="px-3 py-2 font-medium">角色</th>
                  <th className="px-3 py-2 font-medium">状态</th>
                  <th className="px-3 py-2 font-medium">最近登录</th>
                  <th className="px-3 py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-xs text-muted-foreground">
                      加载中…
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-xs text-muted-foreground">
                      暂无用户
                    </td>
                  </tr>
                ) : (
                  users.map((u) => {
                    const isSelf = u.id === currentUserId;
                    return (
                      <tr key={u.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-3 py-2 font-mono">
                          {u.email}
                          {u.is_platform_admin && (
                            <Badge variant="success" className="ml-2">超管</Badge>
                          )}
                          {isSelf && (
                            <span className="ml-2 text-[10px] text-amber-600">（自己）</span>
                          )}
                        </td>
                        <td className="px-3 py-2">{u.display_name ?? "—"}</td>
                        <td className="px-3 py-2">
                          {u.roles.length === 0 ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {u.roles.map((r) => (
                                <Badge key={r.id} variant="outline">{r.name}</Badge>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col gap-1">
                            <Badge variant={u.status === "active" ? "success" : "destructive"}>
                              {u.status === "active" ? "启用" : "禁用"}
                            </Badge>
                            {!u.login_enabled && (
                              <Badge variant="outline">登录已禁</Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {u.last_login_at ? fmtDate(u.last_login_at) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!canWrite}
                              onClick={() => setDrawer({ open: true, mode: "edit", user: u })}
                            >
                              编辑
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!canLoginManage || (isSelf && u.login_enabled)}
                              onClick={() => void handleToggleLogin(u)}
                              title={
                                isSelf && u.login_enabled
                                  ? "不能禁用自己的登录"
                                  : !canLoginManage
                                    ? "无 user:login:manage 权限"
                                    : undefined
                              }
                            >
                              {u.login_enabled ? "禁用登录" : "启用登录"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!canLoginManage}
                              onClick={() => setResetTarget(u)}
                            >
                              重置密码
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setSessionsDrawer(u)}
                            >
                              会话
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setAuditDrawer(u)}
                            >
                              审计
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={!canWrite || isSelf}
                              onClick={() => setConfirmDelete(u)}
                              title={isSelf ? "不能删除自己" : undefined}
                            >
                              删除
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <AdminUserDrawer
        open={drawer.open}
        mode={drawer.mode}
        user={drawer.user}
        onClose={() => setDrawer({ open: false, mode: "create" })}
        onSubmit={handleSubmit}
        organizations={organizations}
        roles={roles}
        canWrite={canWrite}
        canLoginManage={canLoginManage}
        currentUserId={currentUserId}
      />

      {confirmDelete && (
        <DeleteConfirm
          user={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void handleConfirmDelete()}
        />
      )}

      {resetTarget && (
        <ResetPasswordDialog
          user={resetTarget}
          onClose={() => setResetTarget(null)}
          onReset={async (customPassword) => {
            try {
              const resp = await resetUserPassword(
                resetTarget.id,
                customPassword ? { new_password: customPassword } : undefined,
              );
              showToast(true, `新密码已生成（仅本次显示）`);
              return resp.password;
            } catch (err) {
              const msg = err instanceof ApiError ? err.message : "重置失败";
              showToast(false, msg);
              throw err;
            }
          }}
        />
      )}

      {sessionsDrawer && (
        <SessionsDrawer
          user={sessionsDrawer}
          onClose={() => setSessionsDrawer(null)}
          onChanged={() => showToast(true, "操作成功")}
        />
      )}

      {auditDrawer && (
        <AuditDrawer
          user={auditDrawer}
          onClose={() => setAuditDrawer(null)}
        />
      )}
    </div>
  );
}

function DeleteConfirm({
  user,
  onCancel,
  onConfirm,
}: {
  user: UserRead;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-96 rounded-md border bg-background p-5 shadow-lg">
        <h3 className="text-sm font-semibold">确认删除用户？</h3>
        <p className="mt-2 text-xs text-muted-foreground">
          将删除用户 <span className="font-mono">{user.email}</span>。该操作不可恢复。
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>取消</Button>
          <Button variant="destructive" size="sm" onClick={onConfirm}>
            确认删除
          </Button>
        </div>
      </div>
    </div>
  );
}

function ResetPasswordDialog({
  user,
  onClose,
  onReset,
}: {
  user: UserRead;
  onClose: () => void;
  onReset: (_custom?: string) => Promise<string>;
}) {
  const [custom, setCustom] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const pwd = await onReset(useCustom && custom.length >= 8 ? custom : undefined);
      setResult(pwd);
      setCopied(false);
    } catch {
      setErr("重置失败");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-[440px] rounded-md border bg-background p-5 shadow-lg">
        <h3 className="text-sm font-semibold">重置 {user.email} 的密码</h3>
        {!result ? (
          <div className="mt-3 space-y-3">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={useCustom}
                onChange={(e) => setUseCustom(e.target.checked)}
                aria-label="自定义密码"
              />
              <span>自定义密码（不勾选则自动生成）</span>
            </label>
            {useCustom && (
              <div>
                <label className="text-[11px] text-muted-foreground">
                  新密码（至少 8 位）
                </label>
                <input
                  type="password"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  aria-label="新密码"
                  className={`mt-0.5 ${inputCls}`}
                />
                {custom.length > 0 && custom.length < 8 && (
                  <p className="mt-1 text-[10px] text-destructive">
                    密码至少 8 位
                  </p>
                )}
              </div>
            )}
            <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] text-amber-700">
              重置密码后会撤销该用户的所有会话，强制重新登录。
            </p>
            {err && <p className="text-[11px] text-destructive">{err}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>取消</Button>
              <Button
                size="sm"
                disabled={busy || (useCustom && custom.length < 8)}
                onClick={() => void submit()}
              >
                {busy ? "重置中…" : "确认重置"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              新密码（仅本次显示，请立即交给用户）：
            </p>
            <div className="flex items-center gap-2 rounded border bg-muted/30 px-2 py-1.5">
              <code className="flex-1 break-all font-mono text-sm">{result}</code>
              <Button size="sm" variant="outline" onClick={() => void copy()}>
                {copied ? "已复制" : "复制"}
              </Button>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={onClose}>关闭</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SessionsDrawer({
  user,
  onClose,
  onChanged,
}: {
  user: UserRead;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [sessions, setSessions] = useState<UserSessionRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const list = await listUserSessions(user.id);
      setSessions(list);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRevoke = async (sid: string) => {
    try {
      await revokeUserSession(user.id, sid);
      onChanged();
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "撤销失败");
    }
  };

  const handleRevokeAll = async () => {
    try {
      await revokeAllUserSessions(user.id);
      onChanged();
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "撤销失败");
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-[520px] flex-col border-l bg-background shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-medium">{user.email} 的会话</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {loading ? (
            <p className="text-center text-xs text-muted-foreground">加载中…</p>
          ) : err ? (
            <p className="text-[11px] text-destructive">{err}</p>
          ) : sessions.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground">无活动会话</p>
          ) : (
            sessions.map((s) => (
              <div key={s.id} className="rounded border bg-card px-3 py-2 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {s.ip ?? "—"}
                    </div>
                    <div className="text-muted-foreground">
                      UA: {s.user_agent ?? "—"}
                    </div>
                    <div className="text-muted-foreground">
                      创建: {fmtDate(s.created_at)}
                    </div>
                    {s.last_used_at && (
                      <div className="text-muted-foreground">
                        最近使用: {fmtDate(s.last_used_at)}
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleRevoke(s.id)}
                  >
                    撤销
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="sticky bottom-0 flex items-center justify-between border-t bg-background px-4 py-3">
          <span className="text-xs text-muted-foreground">
            共 {sessions.length} 个会话
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" onClick={() => void handleRevokeAll()}>
              撤销全部
            </Button>
            <Button size="sm" variant="outline" onClick={onClose}>关闭</Button>
          </div>
        </div>
      </div>
    </>
  );
}

function AuditDrawer({
  user,
  onClose,
}: {
  user: UserRead;
  onClose: () => void;
}) {
  const [logs, setLogs] = useState<AuditLogRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setErr(null);
      try {
        const list = await listUserAudit(user.id, { limit: 50 });
        setLogs(list);
      } catch (e) {
        setErr(e instanceof ApiError ? e.message : "加载失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [user.id]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-[560px] flex-col border-l bg-background shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-medium">{user.email} 的审计日志（近 50 条）</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-3">
          {loading ? (
            <p className="text-center text-xs text-muted-foreground">加载中…</p>
          ) : err ? (
            <p className="text-[11px] text-destructive">{err}</p>
          ) : logs.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground">无审计日志</p>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="rounded border bg-card px-2 py-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-mono">{log.action}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {fmtDate(log.created_at)}
                  </span>
                </div>
                {log.entity_type && (
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    {log.entity_type}
                    {log.entity_id ? ` / ${log.entity_id}` : ""}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        <div className="sticky bottom-0 flex justify-end border-t bg-background px-4 py-3">
          <Button size="sm" variant="outline" onClick={onClose}>关闭</Button>
        </div>
      </div>
    </>
  );
}

function fmtDate(s: string): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("zh-CN");
  } catch {
    return s;
  }
}

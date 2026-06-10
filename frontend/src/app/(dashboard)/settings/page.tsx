"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { getHealth, type HealthResponse } from "@/lib/health";
import {
  createUser,
  listSettings,
  listUserAudit,
  listUserSessions,
  listUsers,
  listUserWorkspaces,
  resetUserPassword,
  revokeAllSessions,
  revokeSession,
  updateSettings,
  type AuditLogRead,
  type RevokeAllResponse,
  type UserRead,
  type UserListResponse,
  type UserSessionRead,
  type UserWorkspaceRead,
} from "@/lib/settings";

type Tab = "workspace" | "users" | "agent" | "security" | "integrations";

const TABS: { key: Tab; label: string }[] = [
  { key: "workspace", label: "Workspace 信息" },
  { key: "users", label: "用户管理" },
  { key: "agent", label: "Agent 配置" },
  { key: "security", label: "安全策略" },
  { key: "integrations", label: "集成" },
];

const inputCls =
  "h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none";

/* ---------- Workspace Tab ---------- */

function WorkspaceTab({ dbStatus }: { dbStatus: HealthResponse | null }) {
  const [wsName, setWsName] = useState("");
  const [sillyspecPath, setSillyspecPath] = useState("");
  const [worktreeRoot, setWorktreeRoot] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const resp = await listSettings();
        const map = Object.fromEntries(resp.settings.map((s) => [s.key, s.value]));
        setWsName(map["workspace_name"] ?? "multi-agent-platform");
        setSillyspecPath(map["sillyspec_path"] ?? "");
        setWorktreeRoot(map["worktree_root"] ?? "");
      } catch {
        // Use defaults if API unavailable
        setWsName("multi-agent-platform");
      }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const payload: Record<string, string> = {};
      if (wsName) payload["workspace_name"] = wsName;
      if (sillyspecPath) payload["sillyspec_path"] = sillyspecPath;
      if (worktreeRoot) payload["worktree_root"] = worktreeRoot;
      await updateSettings(payload);
      setMessage({ ok: true, text: "保存成功" });
    } catch (err) {
      setMessage({
        ok: false,
        text: err instanceof ApiError ? err.message : "保存失败",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-md border bg-card p-4">
        <h3 className="text-xs font-medium text-muted-foreground">基本信息</h3>
        <div className="mt-3 space-y-2.5">
          <div>
            <label className="text-[11px] text-muted-foreground">Workspace 名称</label>
            <input value={wsName} onChange={(e) => setWsName(e.target.value)} className={`mt-0.5 ${inputCls}`} />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">SillySpec 路径</label>
            <input value={sillyspecPath} onChange={(e) => setSillyspecPath(e.target.value)} className={`mt-0.5 ${inputCls}`} />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">Worktree 根路径</label>
            <input value={worktreeRoot} onChange={(e) => setWorktreeRoot(e.target.value)} className={`mt-0.5 ${inputCls}`} />
          </div>
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "保存中…" : "保存设置"}
            </Button>
            {message && (
              <span className={`text-xs ${message.ok ? "text-emerald-600" : "text-destructive"}`}>
                {message.text}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-md border bg-card p-4">
        <h3 className="text-xs font-medium text-muted-foreground">数据库</h3>
        <div className="mt-3">
          <KVRow label="类型" value="PostgreSQL 16" />
          <KVRow label="Host" value={dbStatus ? "Connected" : "—"} />
          <KVRow label="版本" value={dbStatus?.version ?? "—"} />
          <div className="flex items-center justify-between py-1.5 text-xs">
            <span className="text-muted-foreground">连接状态</span>
            <Badge variant={dbStatus?.db === "ok" ? "success" : "destructive"}>
              {dbStatus?.db === "ok" ? "Connected" : "Disconnected"}
            </Badge>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Users Tab ---------- */

function UsersTab() {
  const [users, setUsers] = useState<UserRead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newName, setNewName] = useState("");
  const [newAdmin, setNewAdmin] = useState(false);
  const [creating, setCreating] = useState(false);

  // Detail drawer
  const [selectedUser, setSelectedUser] = useState<UserRead | null>(null);

  // Filters & pagination
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [sortBy, setSortBy] = useState("created_at");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setPageError(null);
    try {
      const resp = await listUsers({
        q: search || undefined,
        status: statusFilter || undefined,
        role: roleFilter || undefined,
        sort: sortBy,
        order: sortOrder,
        limit: pageSize,
        offset: page * pageSize,
      });
      setUsers(resp.items);
      setTotal(resp.total);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "加载用户列表失败");
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, roleFilter, sortBy, sortOrder, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    setCreating(true);
    setPageError(null);
    try {
      await createUser({
        email: newEmail,
        password: newPassword,
        display_name: newName || undefined,
        is_platform_admin: newAdmin,
      });
      setShowCreate(false);
      setNewEmail("");
      setNewPassword("");
      setNewName("");
      setNewAdmin(false);
      await load();
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "创建用户失败");
    } finally {
      setCreating(false);
    }
  };

  const toggleSort = (col: string) => {
    if (sortBy === col) {
      setSortOrder((o) => (o === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(col);
      setSortOrder("desc");
    }
    setPage(0);
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{total} 个用户</span>
        <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? "取消" : "+ 添加用户"}
        </Button>
      </div>

      {pageError && (
        <div className="mb-3 rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {pageError}
        </div>
      )}

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          className={`w-48 ${inputCls}`}
          placeholder="搜索邮箱/显示名…"
        />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
          className={inputCls}
          style={{ width: "auto" }}
        >
          <option value="">全部状态</option>
          <option value="active">已激活</option>
          <option value="disabled">已禁用</option>
        </select>
        <select
          value={roleFilter}
          onChange={(e) => { setRoleFilter(e.target.value); setPage(0); }}
          className={inputCls}
          style={{ width: "auto" }}
        >
          <option value="">全部角色</option>
          <option value="admin">Admin</option>
          <option value="user">User</option>
        </select>
      </div>

      {showCreate && (
        <div className="mb-3 rounded-md border bg-card p-3">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <div>
              <label className="text-[11px] text-muted-foreground">邮箱</label>
              <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className={`mt-0.5 ${inputCls}`} placeholder="user@example.com" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">密码</label>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={`mt-0.5 ${inputCls}`} placeholder="至少 8 位" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">显示名</label>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} className={`mt-0.5 ${inputCls}`} placeholder="可选" />
            </div>
            <div className="flex items-end gap-3">
              <label className="flex items-center gap-2 pb-1.5">
                <input type="checkbox" checked={newAdmin} onChange={(e) => setNewAdmin(e.target.checked)} className="h-3.5 w-3.5 rounded border border-input" />
                <span className="text-xs">管理员</span>
              </label>
              <Button size="sm" onClick={handleCreate} disabled={creating || !newEmail || !newPassword}>
                {creating ? "创建中…" : "确认创建"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <p className="py-8 text-center text-xs text-muted-foreground">加载中…</p>
      ) : (
        <>
          <div className="rounded-md border bg-card">
            <table>
              <thead>
                <tr>
                  <th className="cursor-pointer select-none" onClick={() => toggleSort("email")}>
                    邮箱 {sortBy === "email" ? (sortOrder === "desc" ? "↓" : "↑") : ""}
                  </th>
                  <th>显示名</th>
                  <th>角色</th>
                  <th>状态</th>
                  <th className="cursor-pointer select-none" onClick={() => toggleSort("last_login_at")}>
                    最后登录 {sortBy === "last_login_at" ? (sortOrder === "desc" ? "↓" : "↑") : ""}
                  </th>
                  <th className="text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedUser(u)}>
                    <td className="text-xs font-mono">{u.email}</td>
                    <td className="text-xs">{u.display_name ?? "—"}</td>
                    <td>
                      <Badge variant={u.is_platform_admin ? "default" : "outline"}>
                        {u.is_platform_admin ? "Admin" : "User"}
                      </Badge>
                    </td>
                    <td>
                      <Badge variant={u.status === "active" ? "success" : "destructive"}>
                        {u.status === "active" ? "已激活" : u.status}
                      </Badge>
                    </td>
                    <td className="text-[11px] text-muted-foreground">
                      {u.last_login_at ? new Date(u.last_login_at).toLocaleString("zh-CN") : "—"}
                    </td>
                    <td className="text-right">
                      <button
                        className="text-[11px] text-primary hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedUser(u);
                        }}
                      >
                        详情
                      </button>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-xs text-muted-foreground">
                      暂无用户
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                第 {page * pageSize + 1}-{Math.min((page + 1) * pageSize, total)} / {total}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  上一页
                </Button>
                <span className="flex items-center px-2">
                  {page + 1} / {totalPages}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* User detail drawer */}
      {selectedUser && (
        <UserDetailDrawer
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onRefresh={load}
        />
      )}
    </div>
  );
}

/* ---------- User Detail Drawer ---------- */

type DrawerTab = "info" | "workspaces" | "sessions" | "audit";

function UserDetailDrawer({
  user,
  onClose,
  onRefresh,
}: {
  user: UserRead;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [tab, setTab] = useState<DrawerTab>("info");
  const [sessions, setSessions] = useState<UserSessionRead[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRead[]>([]);
  const [loading, setLoading] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [workspaces, setWorkspaces] = useState<UserWorkspaceRead[]>([]);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);
  const [revokeMsg, setRevokeMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [forceChange, setForceChange] = useState(false);

  useEffect(() => {
    if (tab === "sessions") {
      setLoading(true);
      listUserSessions(user.id)
        .then(setSessions)
        .catch(() => {})
        .finally(() => setLoading(false));
    } else if (tab === "workspaces") {
      setLoading(true);
      listUserWorkspaces(user.id)
        .then(setWorkspaces)
        .catch(() => {})
        .finally(() => setLoading(false));
    } else if (tab === "audit") {
      setLoading(true);
      listUserAudit(user.id)
        .then(setAuditLogs)
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [tab, user.id]);

  const handleResetPassword = async () => {
    setResetting(true);
    setMessage(null);
    try {
      const res = await resetUserPassword(user.id, forceChange);
      setNewPw(res.plaintext_password);
      setMessage({ ok: true, text: "密码已重置，用户需重新登录" });
      setResetMode(false);
      setForceChange(false);
      onRefresh();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : "重置失败" });
    } finally {
      setResetting(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    setRevoking(sessionId);
    setRevokeMsg(null);
    try {
      await revokeSession(user.id, sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      setRevokeMsg({ ok: true, text: "会话已撤销" });
    } catch (err) {
      setRevokeMsg({
        ok: false,
        text: err instanceof ApiError ? err.message : "撤销失败",
      });
    } finally {
      setRevoking(null);
    }
  };

  const handleRevokeAllSessions = async () => {
    if (!confirm(`确定撤销 ${user.email} 的全部会话？用户将被迫重新登录。`)) return;
    setRevokingAll(true);
    setRevokeMsg(null);
    try {
      const result = await revokeAllSessions(user.id);
      setSessions([]);
      setRevokeMsg({ ok: true, text: `已撤销 ${result.revoked_count} 个会话` });
    } catch (err) {
      setRevokeMsg({
        ok: false,
        text: err instanceof ApiError ? err.message : "批量撤销失败",
      });
    } finally {
      setRevokingAll(false);
    }
  };

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      {/* Drawer */}
      <div className="fixed right-0 top-0 z-50 h-full w-96 overflow-y-auto border-l bg-background shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-medium">{user.email}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b">
          {(["info", "workspaces", "sessions", "audit"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 text-xs font-medium transition-colors ${
                tab === t
                  ? "border-b-2 border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {{ info: "基本信息", workspaces: "所属 Workspace", sessions: "会话", audit: "审计" }[t]}
            </button>
          ))}
        </div>

        <div className="p-4">
          {tab === "info" && (
            <div className="space-y-1.5">
              <KVRow label="邮箱" value={user.email} />
              <KVRow label="显示名" value={user.display_name ?? "—"} />
              <KVRow
                label="状态"
                value={user.status === "active" ? "已激活" : user.status}
              />
              <KVRow
                label="角色"
                value={user.is_platform_admin ? "Admin" : "User"}
              />
              <KVRow
                label="创建时间"
                value={new Date(user.created_at).toLocaleString("zh-CN")}
              />
              <KVRow
                label="最后登录"
                value={user.last_login_at
                  ? new Date(user.last_login_at).toLocaleString("zh-CN")
                  : "—"}
              />
              <div className="pt-3">
                {resetMode ? (
                  <div className="space-y-2">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={forceChange}
                        onChange={(e) => setForceChange(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border border-input"
                      />
                      <span className="text-xs text-muted-foreground">
                        强制下次登录时修改密码
                      </span>
                    </label>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={handleResetPassword}
                        disabled={resetting}
                      >
                        {resetting ? "重置中…" : "生成新密码"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setResetMode(false); setForceChange(false); }}
                      >
                        取消
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => { setResetMode(true); setNewPw(""); setMessage(null); }}
                  >
                    重置密码
                  </Button>
                )}
                {message && (
                  <p
                    className={`mt-2 text-xs ${
                      message.ok ? "text-emerald-600" : "text-destructive"
                    }`}
                  >
                    {message.text}
                  </p>
                )}
                {newPw && (
                  <div className="mt-2 rounded border bg-muted/50 px-3 py-2">
                    <p className="mb-1 text-xs font-medium text-muted-foreground">新密码</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-sm font-mono break-all">{newPw}</code>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigator.clipboard.writeText(newPw)}
                      >
                        复制
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "workspaces" && (
            loading ? (
              <p className="py-4 text-center text-xs text-muted-foreground">加载中…</p>
            ) : workspaces.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">该用户未加入任何 Workspace</p>
            ) : (
              <div className="space-y-2">
                {workspaces.map((ws) => (
                  <div key={ws.workspace_slug} className="rounded border bg-card p-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">{ws.workspace_name}</span>
                      <Badge variant="outline">{ws.role_name}</Badge>
                    </div>
                    <div className="mt-0.5 text-[11px] font-mono text-muted-foreground">
                      {ws.workspace_slug}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {tab === "sessions" && (
            loading ? (
              <p className="py-4 text-center text-xs text-muted-foreground">加载中…</p>
            ) : sessions.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">无活跃会话</p>
            ) : (
              <div className="space-y-2">
                {/* 撤销全部按钮 */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {sessions.length} 个活跃会话
                  </span>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => void handleRevokeAllSessions()}
                    disabled={revokingAll}
                  >
                    {revokingAll ? "撤销中…" : "撤销全部"}
                  </Button>
                </div>
                {revokeMsg && (
                  <p
                    className={`text-xs ${
                      revokeMsg.ok ? "text-emerald-600" : "text-destructive"
                    }`}
                  >
                    {revokeMsg.text}
                  </p>
                )}
                {sessions.map((s) => (
                  <div key={s.id} className="rounded border bg-card p-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="truncate font-mono text-muted-foreground">
                        {s.user_agent ?? "Unknown"}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleRevokeSession(s.id)}
                        disabled={revokingAll || revoking === s.id}
                        className="ml-2 h-6 px-2 text-[11px]"
                      >
                        {revoking === s.id ? "撤销中…" : "撤销"}
                      </Button>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{s.ip ?? "—"}</span>
                      <span>{new Date(s.created_at).toLocaleString("zh-CN")}</span>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {tab === "audit" && (
            loading ? (
              <p className="py-4 text-center text-xs text-muted-foreground">加载中…</p>
            ) : auditLogs.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">无审计记录</p>
            ) : (
              <div className="space-y-2">
                {auditLogs.map((a) => (
                  <div key={a.id} className="rounded border bg-card p-2.5">
                    <div className="text-xs font-medium">{a.action}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {new Date(a.timestamp).toLocaleString("zh-CN")}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </>
  );
}

function AgentConfigTab() {
  const [defaultAgent, setDefaultAgent] = useState("claude_code");
  const [maxConcurrent, setMaxConcurrent] = useState(4);
  const [timeout, setTimeout_] = useState(30);
  const [autoCleanup, setAutoCleanup] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const resp = await listSettings();
        const map = Object.fromEntries(resp.settings.map((s) => [s.key, s.value]));
        if (map["agent_default_type"]) setDefaultAgent(map["agent_default_type"]);
        if (map["agent_max_concurrent"]) setMaxConcurrent(Number(map["agent_max_concurrent"]));
        if (map["agent_default_timeout_min"]) setTimeout_(Number(map["agent_default_timeout_min"]));
        if (map["agent_auto_cleanup"]) setAutoCleanup(map["agent_auto_cleanup"] === "true");
      } catch {
        // Use defaults
      }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await updateSettings({
        agent_default_type: defaultAgent,
        agent_max_concurrent: String(maxConcurrent),
        agent_default_timeout_min: String(timeout),
        agent_auto_cleanup: String(autoCleanup),
      });
      setMessage({ ok: true, text: "保存成功" });
    } catch (err) {
      setMessage({
        ok: false,
        text: err instanceof ApiError ? err.message : "保存失败",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-md border bg-card p-4">
        <h3 className="text-xs font-medium text-muted-foreground">Agent 运行时配置</h3>
        <div className="mt-3 space-y-2.5">
          <div>
            <label className="text-[11px] text-muted-foreground">默认 Agent</label>
            <select value={defaultAgent} onChange={(e) => setDefaultAgent(e.target.value)} className={`mt-0.5 w-full ${inputCls}`}>
              <option value="claude_code">Claude Code</option>
              <option value="codex">Codex</option>
              <option value="cursor">Cursor</option>
              <option value="shell">Shell</option>
            </select>
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">最大并发 Agent Run</label>
            <input type="number" min={1} value={maxConcurrent} onChange={(e) => setMaxConcurrent(Number(e.target.value))} className={`mt-0.5 w-32 ${inputCls}`} />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">默认超时（分钟）</label>
            <input type="number" min={1} value={timeout} onChange={(e) => setTimeout_(Number(e.target.value))} className={`mt-0.5 w-32 ${inputCls}`} />
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={autoCleanup} onChange={(e) => setAutoCleanup(e.target.checked)} className="h-3.5 w-3.5 rounded border border-input" />
            <span className="text-xs">执行完成后自动清理 Worktree</span>
          </label>
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "保存中…" : "保存配置"}
            </Button>
            {message && (
              <span className={`text-xs ${message.ok ? "text-emerald-600" : "text-destructive"}`}>
                {message.text}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-md border bg-card p-4">
        <h3 className="text-xs font-medium text-muted-foreground">Spec Profile &amp; Agent 信息</h3>
        <div className="mt-3">
          <KVRow label="Profile 版本" value="0.1.0" />
          <KVRow label="默认 Agent 类型" value="claude_code" />
          <KVRow label="Spec 策略" value="platform-managed" />
          <KVRow label="Adapter" value="ClaudeCodeAdapter" />
          <div className="flex items-center justify-between border-b py-1.5 text-xs">
            <span className="text-muted-foreground">Profile 状态</span>
            <Badge variant="success">Active</Badge>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          以上为当前平台默认配置，后续版本支持自定义编辑。
        </p>
      </div>
    </div>
  );
}

/* ---------- Security Tab ---------- */

function SecurityTab() {
  const policies = [
    { title: "凭据加密", desc: "使用 libsodium secretbox", key: "security_credential_encryption" },
    { title: "高危操作审批", desc: "git_push_branch / create_pr 需人工审批", key: "security_high_risk_approval" },
    { title: "极端风险操作拦截", desc: "deploy / db_migration / git_merge / push_main", key: "security_extreme_risk_block" },
    { title: "日志脱敏", desc: "自动脱敏凭据和敏感信息", key: "security_log_desensitization" },
    { title: "Worktree 隔离", desc: "每 Run 独立 worktree + 临时 HOME", key: "security_worktree_isolation" },
  ];

  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const resp = await listSettings();
        const map: Record<string, boolean> = {};
        for (const s of resp.settings) {
          if (s.key.startsWith("security_")) {
            map[s.key] = s.value === "true";
          }
        }
        // Default all to enabled
        for (const p of policies) {
          if (!(p.key in map)) map[p.key] = true;
        }
        setEnabledMap(map);
      } catch {
        const map: Record<string, boolean> = {};
        for (const p of policies) map[p.key] = true;
        setEnabledMap(map);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggle = async (key: string) => {
    const next = !enabledMap[key];
    setToggling(key);
    try {
      await updateSettings({ [key]: String(next) });
      setEnabledMap((prev) => ({ ...prev, [key]: next }));
    } catch {
      // Revert on error
    } finally {
      setToggling(null);
    }
  };

  if (loading) return <p className="py-8 text-center text-xs text-muted-foreground">加载中…</p>;

  return (
    <div className="space-y-2">
      {policies.map((p) => (
        <div key={p.key} className="flex items-center justify-between rounded-md border bg-card px-4 py-3">
          <div>
            <p className="text-xs font-medium">{p.title}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{p.desc}</p>
          </div>
          <button
            onClick={() => void handleToggle(p.key)}
            disabled={toggling === p.key}
            className="cursor-pointer"
          >
            <Badge variant={enabledMap[p.key] ? "success" : "outline"}>
              {toggling === p.key ? "…" : enabledMap[p.key] ? "已启用" : "已禁用"}
            </Badge>
          </button>
        </div>
      ))}
    </div>
  );
}

/* ---------- Integrations Tab ---------- */

function IntegrationsTab() {
  const [integrations, setIntegrations] = useState<
    { name: string; key: string; connected: boolean }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const resp = await listSettings();
        const keys = ["integration_github", "integration_gitlab"];
        const list = keys.map((k) => {
          const s = resp.settings.find((s) => s.key === k);
          return {
            name: k.replace("integration_", "").replace(/^\w/, (c) => c.toUpperCase()),
            key: k,
            connected: s?.value === "true",
          };
        });
        setIntegrations(list);
      } catch {
        setIntegrations([
          { name: "GitHub", key: "integration_github", connected: false },
          { name: "GitLab", key: "integration_gitlab", connected: false },
        ]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleToggle = async (key: string) => {
    const current = integrations.find((i) => i.key === key);
    const next = !current?.connected;
    setToggling(key);
    try {
      await updateSettings({ [key]: String(next) });
      setIntegrations((prev) =>
        prev.map((i) => (i.key === key ? { ...i, connected: next } : i)),
      );
    } catch {
      // Revert
    } finally {
      setToggling(null);
    }
  };

  if (loading) return <p className="py-8 text-center text-xs text-muted-foreground">加载中…</p>;

  return (
    <div>
      <h3 className="mb-3 text-xs font-medium text-muted-foreground">已配置集成</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {integrations.map((ig) => (
          <div key={ig.key} className="flex items-center justify-between rounded-md border bg-card px-4 py-3">
            <div>
              <p className="text-xs font-medium">{ig.name}</p>
            </div>
            <button onClick={() => void handleToggle(ig.key)} disabled={toggling === ig.key}>
              <Badge variant={ig.connected ? "success" : "outline"}>
                {toggling === ig.key ? "切换中…" : ig.connected ? "已连接" : "未连接"}
              </Badge>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Helpers ---------- */

function KVRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b py-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

/* ---------- Main Page ---------- */

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("workspace");
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getHealth();
        if (!cancelled) setHealth(data);
      } catch {
        // keep null
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6">
      <header>
        <h1 className="mt-0.5">设置</h1>
        <p className="text-xs text-muted-foreground">平台配置、用户管理、安全策略</p>
      </header>

      <div className="flex gap-4 border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`border-b-2 pb-1.5 text-xs font-medium transition-colors ${
              tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "workspace" && <WorkspaceTab dbStatus={health} />}
      {tab === "users" && <UsersTab />}
      {tab === "agent" && <AgentConfigTab />}
      {tab === "security" && <SecurityTab />}
      {tab === "integrations" && <IntegrationsTab />}
    </div>
  );
}

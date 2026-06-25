"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Input, type TableProps, Tag } from "antd";

import { AdminRolePermissionPicker } from "@/components/admin-role-permission-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  PageContainer,
  PageHeader,
  SectionCard,
} from "@/components/layout";
import { ApiError } from "@/lib/api";
import {
  createRole,
  deleteRole,
  disableRole,
  enableRole,
  listRoleUsers,
  listRoles,
  updateRole,
  type RoleCreateRequest,
  type RoleRead,
  type RoleUpdateRequest,
  type RoleUserRead,
} from "@/lib/admin";
import { useSession } from "@/stores/session";

interface DrawerState {
  open: boolean;
  mode: "create" | "edit";
  role?: RoleRead;
}

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

// 查询条件外壳：垂直布局（标题在上，控件在下），对齐 admin/users / project-plans 的 Field。
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex w-full flex-col gap-1">
      <span className="text-xs leading-4 text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const inputCls =
  "h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none";
const textareaCls =
  "min-h-[80px] w-full rounded border border-input bg-background px-2.5 py-1.5 text-sm focus:border-ring focus:outline-none";

export default function AdminRolesPage() {
  const { user } = useSession();
  const canWrite = !!user?.is_platform_admin ||
    !!user?.permissions?.includes("role:write");

  const [roles, setRoles] = useState<RoleRead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const [drawer, setDrawer] = useState<DrawerState>({ open: false, mode: "create" });
  const [confirmDelete, setConfirmDelete] = useState<RoleRead | null>(null);
  const [usersDrawer, setUsersDrawer] = useState<RoleRead | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await listRoles({ search: search || undefined, page, size: pageSize });
      setRoles(resp.items);
      setTotal(resp.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [search, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  // 关键词输入纯受控：只更新输入态，不自动查询（点搜索/回车才触发）。
  const handleSearchInput = (value: string) => {
    setSearchInput(value);
  };

  // 顶部「搜索」按钮 / 输入框回车：用当前输入触发查询。
  // 条件不变时 setState 不会重建 load、不触发 useEffect → 手动 load() 强制刷新。
  const handleSearchClick = () => {
    const noChange = searchInput === search && page === 1;
    setSearch(searchInput);
    setPage(1);
    if (noChange) void load();
  };

  // 顶部「重置」按钮：清空关键词。
  const handleResetClick = () => {
    setSearchInput("");
    setSearch("");
    setPage(1);
  };

  const showToast = (ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 3000);
  };

  const handleToggleActive = async (role: RoleRead) => {
    try {
      if (role.is_active) {
        await disableRole(role.id);
        showToast(true, `角色 ${role.name} 已禁用`);
      } else {
        await enableRole(role.id);
        showToast(true, `角色 ${role.name} 已启用`);
      }
      await load();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "操作失败";
      showToast(false, msg);
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    try {
      await deleteRole(target.id);
      showToast(true, `角色 ${target.name} 已删除`);
      await load();
    } catch (err) {
      const details = err instanceof ApiError ? err.details : null;
      const count =
        (details as { user_count?: number } | null)?.user_count ?? null;
      const msg = count !== null
        ? `该角色已分配给 ${count} 个用户，无法删除`
        : err instanceof ApiError
          ? err.message
          : "删除失败";
      showToast(false, msg);
    }
  };

  const columns: TableProps<RoleRead>["columns"] = [
    { title: "Key", dataIndex: "key", key: "key", render: (v: string) => <span className="font-mono text-[11px]">{v}</span> },
    { title: "名称", dataIndex: "name", key: "name" },
    {
      title: "类型",
      dataIndex: "is_system",
      key: "type",
      render: (isSystem: boolean) =>
        isSystem ? <Tag>系统</Tag> : <Tag color="blue">自定义</Tag>,
    },
    {
      title: "状态",
      dataIndex: "is_active",
      key: "status",
      render: (isActive: boolean) =>
        isActive ? (
          <Tag color="success">启用</Tag>
        ) : (
          <Tag color="error">禁用</Tag>
        ),
    },
    {
      title: "用户",
      dataIndex: "user_count",
      key: "user_count",
      render: (_v: number, record: RoleRead) => (
        <button
          className="text-primary hover:underline"
          onClick={() => setUsersDrawer(record)}
          title="查看该角色下的用户"
        >
          {record.user_count} 用户
        </button>
      ),
    },
    {
      title: "权限",
      dataIndex: "permissions",
      key: "permissions",
      render: (perms: string[]) => renderPermissionsCell(perms),
    },
    {
      title: "操作",
      key: "actions",
      align: "right",
      render: (_v: unknown, record: RoleRead) => (
        <div className="flex items-center justify-end gap-2">
          <button
            className="text-[11px] text-primary hover:underline"
            onClick={() => setDrawer({ open: true, mode: "edit", role: record })}
          >
            编辑
          </button>
          <button
            className="text-[11px] text-primary hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground/40 disabled:no-underline"
            disabled={!canWrite || record.is_system}
            title={
              record.is_system
                ? "系统角色不可禁用"
                : !canWrite
                  ? "无 role:write 权限"
                  : undefined
            }
            onClick={() => void handleToggleActive(record)}
          >
            {record.is_active ? "禁用" : "启用"}
          </button>
          <button
            className="text-[11px] text-destructive hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground/40 disabled:no-underline"
            disabled={!canWrite || record.is_system || record.user_count > 0}
            title={
              record.is_system
                ? "系统角色不可删除"
                : record.user_count > 0
                  ? `该角色已分配给 ${record.user_count} 个用户`
                  : !canWrite
                    ? "无 role:write 权限"
                    : undefined
            }
            onClick={() => setConfirmDelete(record)}
          >
            删除
          </button>
        </div>
      ),
    },
  ];

  return (
    <PageContainer size="full">
      <PageHeader title="角色管理" subtitle="平台角色与权限管理" />
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

      <SectionCard bodyPadding="p-2">
        {/* 顶部操作按钮行（右对齐，对齐 admin/users / project-plans） */}
        <div className="mb-2 flex items-center justify-end gap-2">
          <Button size="sm" onClick={() => handleSearchClick()}>
            搜索
          </Button>
          <Button size="sm" variant="outline" onClick={() => handleResetClick()}>
            重置
          </Button>
          <span className="mx-1 h-6 w-px bg-border" aria-hidden />
          <Button
            size="sm"
            disabled={!canWrite}
            onClick={() => setDrawer({ open: true, mode: "create" })}
            title={!canWrite ? "无 role:write 权限" : undefined}
          >
            + 新建角色
          </Button>
        </div>
        {/* 搜索表单：grid-cols-4 垂直 Field */}
        <div className="grid w-full grid-cols-4 gap-3">
          <Field label="关键词">
            <Input
              value={searchInput}
              onChange={(e) => handleSearchInput(e.target.value)}
              placeholder="搜索 key / 名称…"
              allowClear
              onPressEnter={() => handleSearchClick()}
            />
          </Field>
        </div>
      </SectionCard>

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
        <DataTable<RoleRead>
          rowKey="id"
          columns={columns}
          dataSource={roles}
          loading={loading}
          size="small"
          bordered
          scroll={{ x: "max-content", y: "calc(100vh - 430px)" }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: PAGE_SIZE_OPTIONS,
            showTotal: (t) => `共 ${t} 个角色`,
            onChange: (p, s) => {
              setPage(p);
              setPageSize(s);
            },
          }}
          emptyText="暂无角色，点击右上角新建"
        />
      )}

      {drawer.open && (
        <RoleDrawer
          mode={drawer.mode}
          role={drawer.role}
          canWrite={canWrite}
          onClose={() => setDrawer({ open: false, mode: "create" })}
          onSaved={async (text) => {
            setDrawer({ open: false, mode: "create" });
            showToast(true, text);
            await load();
          }}
        />
      )}

      {confirmDelete && (
        <DeleteConfirm
          role={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void handleConfirmDelete()}
        />
      )}

      {usersDrawer && (
        <RoleUsersDrawer
          role={usersDrawer}
          onClose={() => setUsersDrawer(null)}
        />
      )}
    </PageContainer>
  );
}

function renderPermissionsCell(perms: string[]): React.ReactNode {
  if (perms.length === 0) return "—";
  const visible = perms.slice(0, 3);
  const extra = perms.length - visible.length;
  return (
    <span>
      {visible.join(", ")}
      {extra > 0 && <span className="ml-1 text-muted-foreground">+{extra} more</span>}
    </span>
  );
}

function RoleDrawer({
  mode,
  role,
  canWrite,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  role?: RoleRead;
  canWrite: boolean;
  onClose: () => void;
  onSaved: (_toast: string) => void;
}) {
  const isSystem = role?.is_system ?? false;
  const isReadonly = mode === "edit" && isSystem;

  const [key, setKey] = useState(role?.key ?? "");
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [permissionKeys, setPermissionKeys] = useState<string[]>(
    role?.permissions ?? [],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keyValid = KEY_PATTERN.test(key);
  const nameValid = name.trim().length > 0 && name.length <= 50;
  const permsValid = permissionKeys.length > 0;
  const formValid = mode === "edit"
    ? nameValid && (isReadonly || permsValid)
    : keyValid && nameValid && permsValid;

  const submit = async () => {
    if (!formValid || !canWrite) return;
    setSaving(true);
    setError(null);
    try {
      if (mode === "create") {
        const body: RoleCreateRequest = {
          key,
          name,
          permission_keys: permissionKeys,
        };
        if (description) body.description = description;
        await createRole(body);
        onSaved(`角色 ${name} 已创建`);
      } else if (role) {
        const body: RoleUpdateRequest = { name };
        if (description) body.description = description;
        if (!isReadonly) body.permission_keys = permissionKeys;
        await updateRole(role.id, body);
        onSaved(`角色 ${name} 已更新`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 h-full w-[560px] overflow-y-auto border-l bg-background shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-medium">
            {mode === "create" ? "新建角色" : `编辑角色 ${role?.key}`}
            {isReadonly && (
              <span className="ml-2 text-[11px] text-muted-foreground">
                （系统角色，仅可改描述）
              </span>
            )}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>
        <div className="space-y-3 p-4">
          <div>
            <label className="text-[11px] text-muted-foreground">Key（唯一标识）</label>
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              disabled={mode === "edit"}
              className={`mt-0.5 font-mono ${inputCls}`}
              placeholder="如 editor / viewer"
            />
            {mode === "create" && !keyValid && key && (
              <p className="mt-1 text-[10px] text-destructive">
                key 必须以小写字母开头，仅含小写字母/数字/下划线
              </p>
            )}
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">名称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canWrite}
              className={`mt-0.5 ${inputCls}`}
              maxLength={50}
            />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={`mt-0.5 ${textareaCls}`}
              maxLength={500}
            />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">
              权限（{permissionKeys.length} 项已选）
            </label>
            <div className="mt-1">
              <AdminRolePermissionPicker
                permissions={permissionKeys}
                onChange={setPermissionKeys}
                disabled={!canWrite || isReadonly}
              />
            </div>
          </div>
          {error && (
            <p className="text-[11px] text-destructive">{error}</p>
          )}
        </div>
        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t bg-background px-4 py-3">
          <Button variant="outline" size="sm" onClick={onClose}>取消</Button>
          <Button
            size="sm"
            disabled={!canWrite || !formValid || saving}
            onClick={() => void submit()}
          >
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </>
  );
}

function DeleteConfirm({
  role,
  onCancel,
  onConfirm,
}: {
  role: RoleRead;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-96 rounded-md border bg-background p-5 shadow-lg">
        <h3 className="text-sm font-semibold">确认删除角色？</h3>
        <p className="mt-2 text-xs text-muted-foreground">
          将删除角色 <span className="font-mono">{role.key}</span>（{role.name}）。
          该操作不可恢复。
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

function RoleUsersDrawer({
  role,
  onClose,
}: {
  role: RoleRead;
  onClose: () => void;
}) {
  const [users, setUsers] = useState<RoleUserRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const resp = await listRoleUsers(role.id);
        if (!cancelled) setUsers(resp.items);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "加载失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [role.id]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 h-full w-[640px] overflow-y-auto border-l bg-background shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h3 className="text-sm font-medium">
              角色 <span className="font-mono">{role.key}</span> 下的用户
            </h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {role.name} · 共 {new Set(users.map((u) => u.id)).size} 个用户（{users.length} 条绑定）
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>
        <div className="px-4 py-3">
          {loading ? (
            <p className="text-xs text-muted-foreground">加载中…</p>
          ) : error ? (
            <p className="text-[11px] text-destructive">{error}</p>
          ) : users.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              该角色暂无用户绑定（含平台级 + 工作区级）。
            </p>
          ) : (
            <RoleUsersTable users={users} />
          )}
        </div>
      </div>
    </>
  );
}

interface AggregatedRoleUser {
  id: string;
  email: string;
  display_name: string | null;
  is_platform_admin: boolean;
  status: string;
  login_enabled: boolean;
  has_platform: boolean;
  workspace_names: string[];
}

function aggregateUsers(users: RoleUserRead[]): AggregatedRoleUser[] {
  // 按 user.id 折叠：同用户在不同 workspace 的多条绑定合并为一行。
  const map = new Map<string, AggregatedRoleUser>();
  for (const u of users) {
    const existing = map.get(u.id);
    if (existing) {
      if (u.binding_type === "platform") existing.has_platform = true;
      if (u.binding_type === "workspace" && u.workspace_name) {
        if (!existing.workspace_names.includes(u.workspace_name)) {
          existing.workspace_names.push(u.workspace_name);
        }
      }
    } else {
      map.set(u.id, {
        id: u.id,
        email: u.email,
        display_name: u.display_name,
        is_platform_admin: u.is_platform_admin,
        status: u.status,
        login_enabled: u.login_enabled,
        has_platform: u.binding_type === "platform",
        workspace_names:
          u.binding_type === "workspace" && u.workspace_name
            ? [u.workspace_name]
            : [],
      });
    }
  }
  // 按邮箱排序保证稳定顺序
  return Array.from(map.values()).sort((a, b) => a.email.localeCompare(b.email));
}

function RoleUsersTable({ users }: { users: RoleUserRead[] }) {
  const aggregated = aggregateUsers(users);
  return (
    <>
      <table className="w-full text-left text-xs">
        <thead className="border-b text-[11px] text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5">邮箱</th>
            <th className="px-2 py-1.5">显示名</th>
            <th className="px-2 py-1.5">绑定类型</th>
            <th className="px-2 py-1.5">工作区</th>
            <th className="px-2 py-1.5">账号类型</th>
          </tr>
        </thead>
        <tbody>
          {aggregated.map((u) => {
            const wsCount = u.workspace_names.length;
            // 绑定类型徽标：平台 / 工作区 / 混合
            const bindingBadge =
              u.has_platform && wsCount > 0 ? (
                <div className="flex flex-wrap gap-1">
                  <Badge variant="default">平台级</Badge>
                  <Badge variant="outline">工作区级 ×{wsCount}</Badge>
                </div>
              ) : u.has_platform ? (
                <Badge variant="default">平台级</Badge>
              ) : (
                <Badge variant="outline">工作区级 ×{wsCount}</Badge>
              );
            return (
              <tr key={u.id} className="border-b last:border-0">
                <td className="px-2 py-1.5 font-mono text-[11px]">{u.email}</td>
                <td className="px-2 py-1.5">{u.display_name ?? "—"}</td>
                <td className="px-2 py-1.5">{bindingBadge}</td>
                <td className="px-2 py-1.5 text-[11px] align-top">
                  {wsCount === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      {u.workspace_names.map((name, idx) => (
                        <span
                          key={`${name}-${idx}`}
                          className="leading-tight"
                          title={name}
                        >
                          {name}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  {u.is_platform_admin ? (
                    <Badge variant="success">超管</Badge>
                  ) : u.login_enabled ? (
                    <Badge variant="success">普通</Badge>
                  ) : (
                    <Badge variant="destructive">禁止登录</Badge>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { AdminOrganizationTree } from "@/components/admin-organization-tree";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  createOrganization,
  deleteOrganization,
  disableOrganization,
  enableOrganization,
  listOrganizations,
  updateOrganization,
  type OrganizationDetail,
  type OrganizationRead,
  type OrganizationStatus,
} from "@/lib/admin";
import { useSession } from "@/stores/session";

interface DrawerState {
  open: boolean;
  mode: "create" | "edit";
  org?: OrganizationRead;
  parentId?: string | null;
}

const CODE_PATTERN = /^[a-z][a-z0-9_]*$/;
const inputCls =
  "h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none";
const textareaCls =
  "min-h-[80px] w-full rounded border border-input bg-background px-2.5 py-1.5 text-sm focus:border-ring focus:outline-none";

export default function AdminOrganizationsPage() {
  const { user } = useSession();
  const canWrite = !!user?.is_platform_admin ||
    !!user?.permissions?.includes("organization:write");

  const [orgs, setOrgs] = useState<OrganizationRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrganizationDetail | null>(null);
  const [drawer, setDrawer] = useState<DrawerState>({
    open: false,
    mode: "create",
  });
  const [confirmDelete, setConfirmDelete] = useState<OrganizationRead | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listOrganizations();
      setOrgs(list);
      setSelectedId((prev) =>
        prev && list.some((o) => o.id === prev) ? prev : (list[0]?.id ?? null),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void (async () => {
      try {
        const d = await fetchDetail(selectedId);
        setDetail(d);
      } catch {
        setDetail(null);
      }
    })();
  }, [selectedId, orgs]);

  const showToast = (ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 3000);
  };

  const handleToggleStatus = async (org: OrganizationRead) => {
    try {
      if (org.status === "active") {
        await disableOrganization(org.id);
        showToast(true, `组织 ${org.name} 已禁用`);
      } else {
        await enableOrganization(org.id);
        showToast(true, `组织 ${org.name} 已启用`);
      }
      await load();
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "操作失败");
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    try {
      await deleteOrganization(target.id);
      showToast(true, `组织 ${target.name} 已删除`);
      if (selectedId === target.id) setSelectedId(null);
      await load();
    } catch (err) {
      const details = err instanceof ApiError ? err.details : null;
      const code = err instanceof ApiError ? err.code : "";
      const childrenCount =
        (details as { children_count?: number } | null)?.children_count ?? null;
      const memberCount =
        (details as { member_count?: number } | null)?.member_count ?? null;
      let msg = "删除失败";
      if (code === "ORGANIZATION_HAS_CHILDREN" && childrenCount !== null) {
        msg = `该组织有 ${childrenCount} 个子组织，需先删除子组织`;
      } else if (code === "ORGANIZATION_IN_USE" && memberCount !== null) {
        msg = `该组织有 ${memberCount} 个关联用户，需先移除用户`;
      } else if (err instanceof ApiError) {
        msg = err.message;
      }
      showToast(false, msg);
    }
  };

  const selectedOrg = useMemo(
    () => orgs.find((o) => o.id === selectedId) ?? null,
    [orgs, selectedId],
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="mt-0.5">组织管理</h1>
          <p className="text-xs text-muted-foreground">树形组织结构、成员归属</p>
        </div>
        <Button
          size="sm"
          disabled={!canWrite}
          onClick={() =>
            setDrawer({ open: true, mode: "create", parentId: null })
          }
          title={!canWrite ? "无 organization:write 权限" : undefined}
        >
          + 新建顶级组织
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
        <div className="grid gap-4 md:grid-cols-[2fr_3fr]">
          <aside className="rounded-md border bg-card">
            <div className="border-b px-3 py-2">
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="搜索 name / code…"
                className={inputCls}
              />
            </div>
            {loading ? (
              <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                加载中…
              </p>
            ) : (
              <AdminOrganizationTree
                nodes={orgs}
                selectedId={selectedId}
                onSelect={setSelectedId}
                searchKeyword={searchInput}
              />
            )}
          </aside>

          <section className="rounded-md border bg-card">
            {!selectedOrg ? (
              <p className="px-3 py-12 text-center text-xs text-muted-foreground">
                请从左侧选择一个组织
              </p>
            ) : (
              <DetailPanel
                org={selectedOrg}
                detail={detail}
                canWrite={canWrite}
                onEdit={() =>
                  setDrawer({ open: true, mode: "edit", org: selectedOrg })
                }
                onCreateChild={() =>
                  setDrawer({
                    open: true,
                    mode: "create",
                    parentId: selectedOrg.id,
                  })
                }
                onToggleStatus={() => void handleToggleStatus(selectedOrg)}
                onDelete={() => setConfirmDelete(selectedOrg)}
              />
            )}
          </section>
        </div>
      )}

      {drawer.open && (
        <OrgDrawer
          mode={drawer.mode}
          org={drawer.org}
          initialParentId={drawer.parentId ?? null}
          canWrite={canWrite}
          allOrgs={orgs}
          onClose={() => setDrawer({ open: false, mode: "create" })}
          onSaved={async (text, newId) => {
            setDrawer({ open: false, mode: "create" });
            showToast(true, text);
            if (newId) setSelectedId(newId);
            await load();
          }}
        />
      )}

      {confirmDelete && (
        <DeleteConfirm
          org={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void handleConfirmDelete()}
        />
      )}
    </div>
  );
}

async function fetchDetail(id: string): Promise<OrganizationDetail> {
  const { getOrganization } = await import("@/lib/admin");
  return getOrganization(id);
}

function DetailPanel({
  org,
  detail,
  canWrite,
  onEdit,
  onCreateChild,
  onToggleStatus,
  onDelete,
}: {
  org: OrganizationRead;
  detail: OrganizationDetail | null;
  canWrite: boolean;
  onEdit: () => void;
  onCreateChild: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
}) {
  const children = detail?.children ?? [];
  return (
    <div>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">{org.name}</h2>
          <Badge variant={org.status === "active" ? "success" : "destructive"}>
            {org.status === "active" ? "启用" : "禁用"}
          </Badge>
          <span className="text-[11px] text-muted-foreground">
            {org.member_count} 成员 · {children.length} 子组织
          </span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={!canWrite} onClick={onCreateChild}>
            新建子组织
          </Button>
          <Button size="sm" variant="outline" disabled={!canWrite} onClick={onEdit}>
            编辑
          </Button>
          <Button size="sm" variant="outline" disabled={!canWrite} onClick={onToggleStatus}>
            {org.status === "active" ? "禁用" : "启用"}
          </Button>
          <Button size="sm" variant="destructive" disabled={!canWrite} onClick={onDelete}>
            删除
          </Button>
        </div>
      </div>
      <div className="px-4 py-3">
        <KVRow label="Code" value={org.code} />
        <KVRow label="描述" value={org.description ?? "—"} />
        <KVRow label="父组织" value={org.parent_id ?? "（顶级）"} />
        <KVRow label="排序" value={String(org.sort_order)} />
        <KVRow label="创建时间" value={fmtDate(org.created_at)} />
        <KVRow label="更新时间" value={fmtDate(org.updated_at)} />
        {children.length > 0 && (
          <div className="mt-3">
            <p className="text-[11px] text-muted-foreground">子组织</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {children.map((c) => (
                <Badge key={c.id} variant="outline">
                  {c.name}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function KVRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b py-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
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

function OrgDrawer({
  mode,
  org,
  initialParentId,
  canWrite,
  allOrgs,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  org?: OrganizationRead;
  initialParentId: string | null;
  canWrite: boolean;
  allOrgs: OrganizationRead[];
  onClose: () => void;
  onSaved: (_toast: string, _newId?: string) => void;
}) {
  const [name, setName] = useState(org?.name ?? "");
  const [code, setCode] = useState(org?.code ?? "");
  const [description, setDescription] = useState(org?.description ?? "");
  const [parentId, setParentId] = useState<string | null>(initialParentId);
  const [status, setStatus] = useState<OrganizationStatus>(org?.status ?? "active");
  const [sortOrder, setSortOrder] = useState<number>(org?.sort_order ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const forbiddenParentIds = useMemo(() => {
    if (mode !== "edit" || !org) return new Set<string>();
    const set = new Set<string>([org.id]);
    const queue = [org.id];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const o of allOrgs) {
        if (o.parent_id === cur && !set.has(o.id)) {
          set.add(o.id);
          queue.push(o.id);
        }
      }
    }
    return set;
  }, [mode, org, allOrgs]);

  const nameValid = name.trim().length > 0 && name.length <= 100;
  const codeValid = CODE_PATTERN.test(code);
  const parentValid = !parentId || !forbiddenParentIds.has(parentId);
  const formValid = nameValid && codeValid && parentValid;

  const submit = async () => {
    if (!formValid || !canWrite) return;
    setSaving(true);
    setError(null);
    try {
      if (mode === "create") {
        const created = await createOrganization({
          name,
          code,
          description: description || undefined,
          parent_id: parentId,
          sort_order: sortOrder,
        });
        onSaved(`组织 ${name} 已创建`, created.id);
      } else if (org) {
        const updated = await updateOrganization(org.id, {
          name,
          code,
          description: description || undefined,
          parent_id: parentId,
          sort_order: sortOrder,
        });
        // status change requires dedicated disable/enable endpoint
        void status;
        onSaved(`组织 ${name} 已更新`, updated.id);
      }
    } catch (err) {
      const details = err instanceof ApiError ? err.details : null;
      const code_ = err instanceof ApiError ? err.code : "";
      if (code_ === "ORGANIZATION_CODE_DUPLICATE") {
        setError(`code "${code}" 已存在`);
      } else if (code_ === "INVALID_TRANSITION") {
        setError("不能选择自身或后代作为父组织");
      } else if (
        code_ === "ORGANIZATION_PARENT_NOT_FOUND" ||
        code_ === "ORGANIZATION_NOT_FOUND"
      ) {
        setError("父组织不存在");
      } else {
        setError(
          (details as { message?: string } | null)?.message ??
            (err instanceof ApiError ? err.message : "保存失败"),
        );
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 h-full w-[480px] overflow-y-auto border-l bg-background shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-medium">
            {mode === "create" ? "新建组织" : `编辑组织 ${org?.code}`}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>
        <div className="space-y-3 p-4">
          <div>
            <label className="text-[11px] text-muted-foreground">名称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canWrite}
              className={`mt-0.5 ${inputCls}`}
              maxLength={100}
            />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">Code</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={mode === "edit" || !canWrite}
              className={`mt-0.5 font-mono ${inputCls}`}
            />
            {mode === "create" && !codeValid && code && (
              <p className="mt-1 text-[10px] text-destructive">
                code 必须以小写字母开头，仅含小写字母/数字/下划线
              </p>
            )}
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!canWrite}
              className={`mt-0.5 ${textareaCls}`}
              maxLength={500}
            />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">父组织</label>
            <select
              value={parentId ?? ""}
              onChange={(e) => setParentId(e.target.value || null)}
              disabled={!canWrite}
              className={`mt-0.5 ${inputCls}`}
            >
              <option value="">（顶级）</option>
              {allOrgs
                .filter((o) => !forbiddenParentIds.has(o.id))
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} ({o.code})
                  </option>
                ))}
            </select>
            {!parentValid && (
              <p className="mt-1 text-[10px] text-destructive">
                不能选择自身或后代作为父组织
              </p>
            )}
          </div>
          {mode === "edit" && (
            <div>
              <label className="text-[11px] text-muted-foreground">状态</label>
              <div className="mt-0.5 flex gap-3 text-xs">
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="status"
                    checked={status === "active"}
                    onChange={() => setStatus("active")}
                    disabled={!canWrite}
                  />
                  启用
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="status"
                    checked={status === "disabled"}
                    onChange={() => setStatus("disabled")}
                    disabled={!canWrite}
                  />
                  禁用
                </label>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                状态变更会调用专用 disable/enable 端点（关闭 Drawer 后使用详情按钮切换）
              </p>
            </div>
          )}
          <div>
            <label className="text-[11px] text-muted-foreground">排序</label>
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value))}
              disabled={!canWrite}
              className={`mt-0.5 w-24 ${inputCls}`}
            />
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
  org,
  onCancel,
  onConfirm,
}: {
  org: OrganizationRead;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-96 rounded-md border bg-background p-5 shadow-lg">
        <h3 className="text-sm font-semibold">确认删除组织？</h3>
        <p className="mt-2 text-xs text-muted-foreground">
          将删除组织 <span className="font-mono">{org.code}</span>（{org.name}）。
          该操作不可恢复，子组织和关联用户需先清空。
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

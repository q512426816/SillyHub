"use client";

/**
 * PpmProjectMembersTable — 项目成员管理组件(table + 自定义 Drawer 表单)。
 *
 * 对照源 dept_project_front `views/ppm/projectmember/{ProjectMemberForm,ProjectMemberListForm}.vue`:
 *  - 成员字段「姓名」用 PpmUserSelect(res="user"),onChange 联动回填
 *    user_name / depart_name / depart_id / phone(对照源 changeDepartAndPhone)
 *  - 成员字段「承担角色」用 PpmUserSelect(res="role", mode="multiple"),
 *    value=role.name,逗号拼接存 role_name(对照源 multiple-value-type="join")
 *  - 表格列显示承担角色(role_name 优先,缺失则原样展示 role_id → X-001 兼容)
 *  - 可选 projectId prop:传入则 list 带 pm_project_id 过滤 + 新增自动绑定(对照源
 *    ProjectMemberListForm queryParams.pmProjectId / addInitData.pmProjectId)
 *
 * 复用 W0 PpmUserSelect(task-01)+ lib/ppm API。不依赖 PpmResourceTable 的字段抽象
 * (其原生 select 不支持多选/自定义组件),自行渲染表单。
 *
 * 设计依据:.sillyspec/changes/2026-06-21-ppm-frontend-alignment/{design.md §7, tasks/task-03.md}
 * 决策:D-009@v1(角色 auth.Role,value=name)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Modal, Table, Tag, type TableProps } from "antd";

import { SectionCard } from "@/components/layout";
import { PpmUserSelect, type PpmSelectOption } from "@/components/ppm-user-select";
import { ApiError } from "@/lib/api";
import type { UserRead } from "@/lib/admin";
import {
  createProjectMember,
  deleteProjectMember,
  listSimpleProjects,
  pageProjectMembers,
  updateProjectMember,
} from "@/lib/ppm";
import type {
  ProjectMember,
  ProjectMemberCreate,
  ProjectMemberPageReq,
  ProjectMemberUpdate,
} from "@/lib/ppm";

// ── 类型 ──────────────────────────────────────────────────────────────────

export interface PpmProjectMembersTableProps {
  /**
   * 锁定项目 ID:传入则
   *  - 列表查询带 pm_project_id 过滤(只显示该项目成员)
   *  - 新增成员时自动绑定 pm_project_id,表单不显示项目选择
   * 不传=全量管理(project-members 平铺页面)。
   */
  projectId?: string;
  /** 是否允许写(隐藏新增/编辑/删除),默认 true。 */
  canWrite?: boolean;
  /** 外部触发刷新(key 变化即重载)。 */
  refreshKey?: unknown;
  /** 是否显示顶部工具栏(新增按钮 + 计数)。嵌入抽屉时可设 false。默认 true。 */
  showToolbar?: boolean;
  /**
   * 成员增删改成功后回调(task-07 / D-007)。
   * 供两级表父组件刷新 member_count;不传则无副作用(现状兼容)。
   */
  onChanged?: () => void;
  /**
   * 嵌入式紧凑模式(task-07 / G1):跳过 SectionCard 外壳,Table scroll 只 {x:"max-content"}
   * (去掉 calc(100vh-430px) 的 y,避免在展开区内产生视口高度滚动框)。
   * 保留新增成员按钮(showToolbar && canWrite 时)。两级表展开行用此模式;
   * 现有平铺页 / projects 抽屉不传,行为完全不变。
   */
  embedded?: boolean;
}

export type MemberForm = {
  id?: string;
  pm_project_id: string;
  user_id: string;
  user_name: string;
  depart_id: string;
  depart_name: string;
  phone: string;
  role_id: string;
  role_name: string;
};

const EMPTY_FORM: MemberForm = {
  pm_project_id: "",
  user_id: "",
  user_name: "",
  depart_id: "",
  depart_name: "",
  phone: "",
  role_id: "",
  role_name: "",
};

const inputCls =
  "h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none";
const readOnlyCls = `${inputCls} bg-muted text-muted-foreground`;

// ── 组件 ──────────────────────────────────────────────────────────────────

export function PpmProjectMembersTable(props: PpmProjectMembersTableProps) {
  const { projectId, canWrite = true, refreshKey, showToolbar = true, onChanged, embedded } = props;

  const [rows, setRows] = useState<ProjectMember[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  // 平铺模式(!projectId):pm_project_id UUID → 项目名 映射(后端 ProjectMemberResp 只回 UUID,无 project_name)。
  const [projectNameMap, setProjectNameMap] = useState<Record<string, string>>({});

  const [drawer, setDrawer] = useState<{
    open: boolean;
    mode: "create" | "edit";
    row?: ProjectMember;
  }>({ open: false, mode: "create" });
  const [confirmDelete, setConfirmDelete] = useState<ProjectMember | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  const showToast = useCallback((ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 服务端分页:page/page_size 变化走接口取对应页,不再一次全量拉本地 slice。
      const params: ProjectMemberPageReq = {
        page,
        page_size: pageSize,
        ...(projectId ? { pm_project_id: projectId } : {}),
      };
      // 平铺模式(!projectId)额外并行拉项目简单列表,建 id→project_name 映射
      // (后端 ProjectMemberResp 只回 pm_project_id UUID,需前端映射出项目名展示)。
      const [resp, projects] = await Promise.all([
        pageProjectMembers(params),
        projectId ? null : listSimpleProjects(),
      ]);
      setRows(resp.items);
      setTotal(resp.total);
      if (projects) {
        const map: Record<string, string> = {};
        for (const p of projects) {
          map[p.id] = p.project_name || p.id;
        }
        setProjectNameMap(map);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [projectId, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const handleSubmit = useCallback(
    async (form: MemberForm) => {
      if (drawer.mode === "create") {
        const body: ProjectMemberCreate = {
          pm_project_id: form.pm_project_id,
          user_id: form.user_id,
          user_name: form.user_name || null,
          depart_id: form.depart_id || null,
          depart_name: form.depart_name || null,
          phone: form.phone || null,
          role_id: form.role_id || null,
          role_name: form.role_name || null,
        };
        const created = await createProjectMember(body);
        showToast(true, `成员 ${created.user_name || created.user_id} 已创建`);
      } else if (drawer.row) {
        const body: ProjectMemberUpdate = {
          user_name: form.user_name || null,
          depart_id: form.depart_id || null,
          depart_name: form.depart_name || null,
          phone: form.phone || null,
          role_id: form.role_id || null,
          role_name: form.role_name || null,
        };
        const updated = await updateProjectMember(drawer.row.id, body);
        showToast(true, `成员 ${updated.user_name || updated.user_id} 已更新`);
      }
      setDrawer({ open: false, mode: "create" });
      await load();
      onChanged?.();
    },
    [drawer.mode, drawer.row, load, onChanged, showToast],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    try {
      await deleteProjectMember(target.id);
      showToast(true, `成员 ${target.user_name || target.user_id} 已删除`);
      await load();
      onChanged?.();
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "删除失败");
    }
  }, [confirmDelete, load, onChanged, showToast]);

  // ── 表格列 ──
  const columns: TableProps<ProjectMember>["columns"] = useMemo(() => {
    const cols: NonNullable<TableProps<ProjectMember>["columns"]> = [
      {
        title: "姓名",
        dataIndex: "user_name",
        key: "user_name",
        render: (v: unknown, row) =>
          v ? String(v) : <span className="text-xs text-muted-foreground">{row.user_id}</span>,
      },
      // 账号列(task-07 / D-004):登录账号 username,后端 LEFT JOIN users 补全,可空兜底「—」。
      {
        title: "账号",
        dataIndex: "username",
        key: "username",
        render: (v: unknown) =>
          v ? (
            String(v)
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      { title: "联系方式", dataIndex: "phone", key: "phone" },
      { title: "部门", dataIndex: "depart_name", key: "depart_name" },
      {
        title: "承担角色",
        key: "role",
        render: (_v, row) => {
          // X-001 兼容:role_name 优先(D-009 字符串),缺失则原样展示 role_id。
          const text = row.role_name || row.role_id;
          if (!text) {
            return <span className="text-xs text-muted-foreground">—</span>;
          }
          // 多角色逗号拼接 → 拆成多个 Badge 展示(D-003:统一 token 色)。
          const parts = String(text)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          return (
            <span className="flex flex-wrap gap-1">
              {parts.map((p, i) => (
                <Tag key={`${p}-${i}`}>{p}</Tag>
              ))}
            </span>
          );
        },
      },
    ];
    // 平铺模式(!projectId)首列补「所属项目」:后端 ProjectMemberResp 只回 pm_project_id UUID,
    // 用 projectNameMap 映射成项目名,缺失回退 ID(与姓名列兜底风格一致)。
    if (!projectId) {
      cols.unshift({
        title: "所属项目",
        dataIndex: "pm_project_id",
        key: "pm_project_id",
        render: (v: unknown) => {
          const id = String(v ?? "");
          const name = projectNameMap[id] || id;
          return name || <span className="text-xs text-muted-foreground">—</span>;
        },
      });
    }
    if (canWrite) {
      cols.push({
        title: "操作",
        key: "__actions",
        fixed: "right",
        width: 140,
        align: "center",
        render: (_v, row) => (
          <div className="flex justify-center gap-1">
            <Button
              size="small"
              type="link"
              onClick={() => setDrawer({ open: true, mode: "edit", row })}
            >
              编辑
            </Button>
            <Button
              size="small"
              type="link"
              danger
              onClick={() => setConfirmDelete(row)}
            >
              删除
            </Button>
          </div>
        ),
      });
    }
    return cols;
  }, [canWrite, projectId, projectNameMap]);

  // rows 已是服务端当前页数据(服务端分页,page/pageSize 变化走接口),无需本地 slice;total 来自分页响应。

  // 页面模式(showToolbar=true 且非 embedded):SectionCard + 顶部按钮右对齐 + Table bordered + scroll y。
  // 抽屉模式(showToolbar=false):保留原 flex 布局,无 SectionCard 无 scroll y。
  // 嵌入模式(embedded=true,G1):跳过 SectionCard,scroll 只 {x:"max-content"}(去掉 vh y),保留新增按钮。
  const body = (
    <>
      {showToolbar && canWrite && (
        <div className="mb-2 flex items-center justify-end gap-2">
          <Button
            type="primary"
            onClick={() => setDrawer({ open: true, mode: "create" })}
          >
            + 新增成员
          </Button>
        </div>
      )}

      {toast && (
        <div
          className={`mb-2 rounded border px-3 py-2 text-xs ${
            toast.ok
              ? "border-success/30 bg-success/10 text-success"
              : "border-destructive/30 bg-red-50 text-destructive"
          }`}
        >
          {toast.text}
        </div>
      )}

      {error ? (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {error}
          <Button className="ml-3" onClick={() => void load()}>
            重新加载
          </Button>
        </div>
      ) : (
        <Table<ProjectMember>
          rowKey={(row) => row.id}
          columns={columns}
          dataSource={rows}
          loading={loading}
          size="small"
          bordered={showToolbar}
          scroll={
            embedded
              ? { x: "max-content" }
              : showToolbar
                ? { x: "max-content", y: "calc(100vh - 430px)" }
                : { x: "max-content" }
          }
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, s) => {
              setPageSize(s);
              // pageSize 变化回到第 1 页,避免当前页越界取空。
              setPage(s !== pageSize ? 1 : p);
            },
          }}
          locale={{ emptyText: "暂无成员" }}
        />
      )}

      {drawer.open && (
        <MemberFormModal
          mode={drawer.mode}
          row={drawer.row}
          lockedProjectId={projectId}
          canWrite={canWrite}
          onClose={() => setDrawer({ open: false, mode: "create" })}
          onSubmit={handleSubmit}
        />
      )}

      {confirmDelete && (
        <DeleteMemberConfirm
          label={confirmDelete.user_name || confirmDelete.user_id}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void handleConfirmDelete()}
        />
      )}
    </>
  );

  if (embedded) {
    // G1:嵌入模式跳过 SectionCard 外壳,直接渲染 body(含新增按钮 + 紧凑表)。
    return <div className="flex flex-col gap-3">{body}</div>;
  }
  if (showToolbar) {
    return <SectionCard bodyPadding="p-2">{body}</SectionCard>;
  }
  return <div className="flex flex-col gap-3">{body}</div>;
}

// ── 成员表单 Drawer ──────────────────────────────────────────────────────

export function MemberFormModal({
  mode,
  row,
  lockedProjectId,
  canWrite,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  row?: ProjectMember;
  lockedProjectId?: string;
  canWrite: boolean;
  onClose: () => void;
  onSubmit: (form: MemberForm) => Promise<void>;
}) {
  const [form, setForm] = useState<MemberForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 用户下拉已加载的完整选项(含 raw UserRead),供 onChange 联动回填。
  const userOptionsRef = useRef<PpmSelectOption[]>([]);

  useEffect(() => {
    if (mode === "edit" && row) {
      setForm({
        id: row.id,
        pm_project_id: row.pm_project_id,
        user_id: row.user_id,
        user_name: row.user_name ?? "",
        depart_id: row.depart_id ?? "",
        depart_name: row.depart_name ?? "",
        phone: row.phone ?? "",
        role_id: row.role_id ?? "",
        role_name: row.role_name ?? "",
      });
    } else {
      // 新增:若锁定项目,自动带入 pm_project_id(对照源 addInitData.pmProjectId)。
      setForm({ ...EMPTY_FORM, pm_project_id: lockedProjectId ?? "" });
    }
    setError(null);
  }, [mode, row, lockedProjectId]);

  const setValue = <K extends keyof MemberForm>(key: K, value: MemberForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  // ── 选用户联动回填(对照源 changeDepartAndPhone)──
  // 本仓 UserRead 字段映射:display_name→user_name;organizations[0]→depart_name/depart_id;
  // 无 mobile 字段,phone 留空(源 item.mobile)。
  const handleUserChange = useCallback((value: string | string[] | null) => {
    const userId = Array.isArray(value) ? value[0] ?? "" : (value ?? "");
    setValue("user_id", userId);
    if (!userId) {
      setValue("user_name", "");
      setValue("depart_name", "");
      setValue("depart_id", "");
      setValue("phone", "");
      return;
    }
    const hit = userOptionsRef.current.find((o) => o.value === userId);
    const u = hit?.raw as UserRead | undefined;
    if (u) {
      setValue("user_name", u.display_name ?? "");
      const org = u.organizations?.[0];
      setValue("depart_name", org?.name ?? "");
      setValue("depart_id", org?.id ?? "");
      // 本仓 UserRead 无手机号字段,清空避免脏数据。
      setValue("phone", "");
    }
  }, []);

  // ── 角色多选 onChange(对照源 multiple-value-type="join")──
  // PpmUserSelect res="role" mode="multiple" 回传 string[](每个元素=role.name),
  // 逗号拼接存 role_name;role_id 旧字段留空(对齐 D-009 字符串化)。
  const handleRoleChange = useCallback((value: string | string[] | null) => {
    const arr = Array.isArray(value) ? value : value ? [value] : [];
    setValue("role_name", arr.join(","));
    setValue("role_id", "");
  }, []);

  // 编辑模式回填:role_name "a,b,c" → ["a","b","c"] 给多选。
  const roleValue = useMemo<string[]>(() => {
    if (!form.role_name) return [];
    return form.role_name
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }, [form.role_name]);

  const userValue = form.user_id || null;

  const requiredMissing = !form.user_id || !form.role_name;
  const formValid = !requiredMissing;

  const submit = async () => {
    if (!formValid || !canWrite || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const showProjectPicker = !lockedProjectId;

  return (
    <Modal
      open
      onCancel={onClose}
      title={mode === "create" ? "新增成员" : "编辑成员"}
      width={520}
      maskClosable={false}
      destroyOnClose
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onClose}>
            取消
          </Button>
          <Button
            type="primary"
            loading={saving}
            disabled={!canWrite || !formValid}
            onClick={() => void submit()}
          >
            保存
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
          {showProjectPicker && (
            <div>
              <span className="text-xs leading-4 text-muted-foreground">
                所属项目<span className="ml-0.5 text-destructive">*</span>
              </span>
              <PpmUserSelect
                res="project"
                value={form.pm_project_id || null}
                onChange={(v) =>
                  setValue("pm_project_id", (Array.isArray(v) ? v[0] : v) ?? "")
                }
                placeholder="请选择所属项目"
                disabled={!canWrite}
              />
            </div>
          )}

          <div>
            <span className="text-xs leading-4 text-muted-foreground">
              姓名<span className="ml-0.5 text-destructive">*</span>
            </span>
            <PpmUserSelect
              res="user"
              value={userValue}
              onChange={handleUserChange}
              onLoadedOptions={(opts) => {
                userOptionsRef.current = opts;
              }}
              placeholder="请选择成员"
              disabled={!canWrite}
            />
          </div>

          {/* 联动回填字段:只读展示(对照源逻辑,选用户后不可手填) */}
          <div>
            <span className="text-xs leading-4 text-muted-foreground">联系方式</span>
            <input
              value={form.phone}
              readOnly
              placeholder="选用户后自动回填"
              className={`mt-0.5 ${readOnlyCls}`}
            />
          </div>
          <div>
            <span className="text-xs leading-4 text-muted-foreground">部门</span>
            <input
              value={form.depart_name}
              readOnly
              placeholder="选用户后自动回填"
              className={`mt-0.5 ${readOnlyCls}`}
            />
          </div>

          <div>
            <span className="text-xs leading-4 text-muted-foreground">
              承担角色<span className="ml-0.5 text-destructive">*</span>
            </span>
            <PpmUserSelect
              res="role"
              mode="multiple"
              value={roleValue}
              onChange={handleRoleChange}
              placeholder="请选择角色(可多选)"
              disabled={!canWrite}
            />
          </div>

          {error && <p className="text-[11px] text-destructive">{error}</p>}
      </div>
    </Modal>
  );
}

// ── 删除确认 ──────────────────────────────────────────────────────────────

function DeleteMemberConfirm({
  label,
  onCancel,
  onConfirm,
}: {
  label: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open
      title="确认删除成员？"
      onCancel={onCancel}
      onOk={onConfirm}
      okText="确认删除"
      cancelText="取消"
      okButtonProps={{ danger: true }}
      maskClosable={false}
      destroyOnClose
    >
      <p className="mt-2 text-xs text-muted-foreground">
        将删除 <span className="font-mono">{label}</span>。该操作不可恢复。
      </p>
    </Modal>
  );
}

export default PpmProjectMembersTable;

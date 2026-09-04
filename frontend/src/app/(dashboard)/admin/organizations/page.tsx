"use client";

import { useCallback, useEffect, useMemo, useState, type Key, type ReactNode } from "react";
import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Tag,
  TreeSelect,
  type TableProps,
} from "antd";

import {
  DataTable,
  PageContainer,
  PageHeader,
  SectionCard,
} from "@/components/layout";
import { ApiError } from "@/lib/api";
import { useNotify } from "@/lib/errors";
import {
  createOrganization,
  deleteOrganization,
  disableOrganization,
  enableOrganization,
  listOrganizations,
  updateOrganization,
  type OrganizationCreateRequest,
  type OrganizationRead,
  type OrganizationUpdateRequest,
} from "@/lib/admin";
import { useSession } from "@/stores/session";

/**
 * 组织管理页（ql-20260903-012-7c69 全 antd 重构）。
 *
 * 样式依据 .sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md（§1 骨架四件套 /
 * §2 工具栏 / §3 搜索区 / §4 DataTable / §6 antd Modal 表单 / §8 删除确认 /
 * §9 antd message），布局参照 /admin/users 页。
 *
 * 组织层级用 antd Table 的 treeData（children 嵌套行）承载，替代旧版
 * 左树 + 右详情卡结构——管理页与其它 antd 表格页观感对齐，详情字段
 * （描述/成员/子组织数/排序/时间）全部成为表格列，不再需要选中态联动。
 */

interface ModalState {
  open: boolean;
  mode: "create" | "edit";
  /** edit 目标 / create 父组织预选（新建子组织入口） */
  org?: OrganizationRead;
  parentId?: string | null;
}

/** DataTable 树行：OrganizationRead + antd children 嵌套 */
interface OrgRow extends OrganizationRead {
  children?: OrgRow[];
}

type StatusFilter = "all" | "active" | "disabled";

const CODE_PATTERN = /^[a-z][a-z0-9_]*$/;

// 查询条件外壳：垂直布局（标题在上，控件在下），对齐 /admin/users 的 Field。
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex w-full flex-col gap-1">
      <span className="text-xs leading-4 text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** 平铺 OrganizationRead[]（parent_id）→ antd Table 树行；叶子不带 children 键 */
function buildRows(orgs: OrganizationRead[]): OrgRow[] {
  const byId = new Map<string, OrgRow>();
  for (const o of orgs) {
    byId.set(o.id, { ...o });
  }
  const roots: OrgRow[] = [];
  for (const o of orgs) {
    const node = byId.get(o.id)!;
    const parent = o.parent_id ? byId.get(o.parent_id) : undefined;
    if (parent) {
      parent.children = parent.children ?? [];
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/** 树行展开键：有 children 的行 id */
function parentKeys(rows: OrgRow[]): string[] {
  return rows.flatMap((r) =>
    r.children && r.children.length > 0
      ? [r.id, ...parentKeys(r.children)]
      : [],
  );
}

/** edit 模式父组织可选集排除自身 + 全部后代（防环） */
function forbiddenParentIds(
  orgs: OrganizationRead[],
  selfId: string,
): Set<string> {
  const set = new Set<string>([selfId]);
  const queue = [selfId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const o of orgs) {
      if (o.parent_id === cur && !set.has(o.id)) {
        set.add(o.id);
        queue.push(o.id);
      }
    }
  }
  return set;
}

function fmtDate(s: string): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 保存/删除失败的 ApiError → 中文提示（沿用旧版 code 映射） */
function orgErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback;
  const details = err.details as
    | { children_count?: number; member_count?: number }
    | null;
  switch (err.code) {
    case "ORGANIZATION_HAS_CHILDREN":
      return `该组织有 ${details?.children_count ?? "?"} 个子组织，需先删除子组织`;
    case "ORGANIZATION_IN_USE":
      return `该组织有 ${details?.member_count ?? "?"} 个关联用户，需先移除用户`;
    case "ORGANIZATION_CODE_DUPLICATE":
      return `code 已存在`;
    case "INVALID_TRANSITION":
      return "不能选择自身或后代作为父组织";
    case "ORGANIZATION_PARENT_NOT_FOUND":
    case "ORGANIZATION_NOT_FOUND":
      return "父组织不存在";
    default:
      return err.message;
  }
}

export default function AdminOrganizationsPage() {
  const user = useSession((s) => s.user);
  const canWrite =
    !!user?.is_platform_admin ||
    !!user?.permissions?.includes("organization:write");

  const notify = useNotify();

  const [orgs, setOrgs] = useState<OrganizationRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 关键词：输入态纯受控（回车/搜索按钮才应用），对齐规范 §3 查询触发规则
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [expandedKeys, setExpandedKeys] = useState<readonly Key[]>([]);
  const [modal, setModal] = useState<ModalState>({
    open: false,
    mode: "create",
  });
  const [deleteTarget, setDeleteTarget] = useState<OrganizationRead | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listOrganizations();
      setOrgs(list);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 客户端过滤（组织接口无关键词/状态参数，返回全量树）：命中的行 + 其全部祖先
  // （保留层级可展开导航），再重建树行。
  const filteredRows = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw && statusFilter === "all") return buildRows(orgs);
    const match = (o: OrganizationRead) =>
      (!kw || o.name.toLowerCase().includes(kw) || o.code.toLowerCase().includes(kw)) &&
      (statusFilter === "all" || o.status === statusFilter);
    const keep = new Set<string>();
    const byId = new Map(orgs.map((o) => [o.id, o]));
    for (const o of orgs) {
      if (!match(o)) continue;
      keep.add(o.id);
      let cur = o.parent_id ? byId.get(o.parent_id) : undefined;
      while (cur && !keep.has(cur.id)) {
        keep.add(cur.id);
        cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
      }
    }
    return buildRows(orgs.filter((o) => keep.has(o.id)));
  }, [orgs, search, statusFilter]);

  // 树行变化（数据加载/筛选）→ 默认全部展开；用户手动收起经
  // onExpandedRowsChange 写回，不触发本 effect（filteredRows 引用未变）。
  useEffect(() => {
    setExpandedKeys(parentKeys(filteredRows));
  }, [filteredRows]);

  const handleToggleStatus = async (org: OrganizationRead) => {
    try {
      if (org.status === "active") {
        await disableOrganization(org.id);
        notify.success(`组织 ${org.name} 已禁用`);
      } else {
        await enableOrganization(org.id);
        notify.success(`组织 ${org.name} 已启用`);
      }
      await load();
    } catch (err) {
      notify.error(orgErrorMessage(err, "操作失败"));
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await deleteOrganization(target.id);
      notify.success(`组织 ${target.name} 已删除`);
      await load();
    } catch (err) {
      notify.error(orgErrorMessage(err, "删除失败"));
    }
  };

  const handleFormSaved = async (
    body: OrganizationCreateRequest | OrganizationUpdateRequest,
    mode: "create" | "edit",
    targetId?: string,
  ) => {
    if (mode === "create") {
      const created = await createOrganization(body as OrganizationCreateRequest);
      notify.success(`组织 ${created.name} 已创建`);
    } else if (targetId) {
      const updated = await updateOrganization(
        targetId,
        body as OrganizationUpdateRequest,
      );
      notify.success(`组织 ${updated.name} 已更新`);
    }
    setModal({ open: false, mode: "create" });
    await load();
  };

  const columns: TableProps<OrgRow>["columns"] = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
      render: (v: string) => <span className="font-medium text-foreground">{v}</span>,
    },
    {
      title: "Code",
      dataIndex: "code",
      key: "code",
      render: (v: string) => <span className="font-mono text-xs">{v}</span>,
    },
    {
      title: "描述",
      dataIndex: "description",
      key: "description",
      render: (v: string | null) =>
        v ?? <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      align: "center",
      render: (_v: unknown, o: OrgRow) => (
        <Tag color={o.status === "active" ? "success" : "error"}>
          {o.status === "active" ? "启用" : "禁用"}
        </Tag>
      ),
    },
    {
      title: "成员",
      dataIndex: "member_count",
      key: "member_count",
      align: "center",
      width: 80,
    },
    {
      title: "子组织",
      dataIndex: "children_count",
      key: "children_count",
      align: "center",
      width: 90,
    },
    {
      title: "排序",
      dataIndex: "sort_order",
      key: "sort_order",
      align: "center",
      width: 80,
    },
    {
      title: "创建时间",
      dataIndex: "created_at",
      key: "created_at",
      render: (v: string) => (
        <span className="text-xs text-muted-foreground">{fmtDate(v)}</span>
      ),
    },
    {
      title: "操作",
      key: "actions",
      align: "center",
      render: (_v: unknown, o: OrgRow) => (
        <div className="flex justify-center gap-1">
          <Button
            type="link"
            size="small"
            disabled={!canWrite}
            onClick={() => setModal({ open: true, mode: "edit", org: o })}
          >
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            disabled={!canWrite}
            onClick={() =>
              setModal({ open: true, mode: "create", parentId: o.id })
            }
          >
            新建子组织
          </Button>
          <Button
            type="link"
            size="small"
            disabled={!canWrite}
            onClick={() => void handleToggleStatus(o)}
          >
            {o.status === "active" ? "禁用" : "启用"}
          </Button>
          <Button
            type="link"
            size="small"
            danger
            disabled={!canWrite}
            onClick={() => setDeleteTarget(o)}
          >
            删除
          </Button>
        </div>
      ),
    },
  ];

  return (
    <PageContainer size="full">
      <PageHeader title="组织管理" subtitle="平台组织树维护，用户与权限按组织归属" />
      {/* 查询条件卡（对齐 /admin/roles 结构：工具栏+搜索一张卡，表格独立一块，
          两块间距由 PageContainer 的 gap-4 提供） */}
      <SectionCard bodyPadding="p-2">
        {/* 顶部工具栏（规范 §2）：左=数据组(+ 新建组织) | 竖分隔 | 右=基础组(搜索/重置) */}
        <div className="mb-2 flex items-center justify-end gap-2">
          <Button
            type="primary"
            disabled={!canWrite}
            onClick={() => setModal({ open: true, mode: "create", parentId: null })}
            title={!canWrite ? "无 organization:write 权限" : undefined}
          >
            + 新建组织
          </Button>
          <span className="mx-1 h-6 w-px bg-border" aria-hidden />
          <Button type="primary" onClick={() => setSearch(searchInput)}>
            搜索
          </Button>
          <Button
            onClick={() => {
              setSearchInput("");
              setSearch("");
              setStatusFilter("all");
            }}
          >
            重置
          </Button>
        </div>
        {/* 搜索区（规范 §3 grid-cols-4 垂直 Field；选择型即查、文本回车/按钮才查） */}
        <div className="grid w-full grid-cols-4 gap-3">
          <Field label="关键词">
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="搜索 名称 / Code…"
              allowClear
              onPressEnter={() => setSearch(searchInput)}
            />
          </Field>
          <Field label="状态">
            <Select
              value={statusFilter}
              onChange={(v) => setStatusFilter(v)}
              className="w-full"
              options={[
                { value: "all", label: "全部状态" },
                { value: "active", label: "启用" },
                { value: "disabled", label: "禁用" },
              ]}
            />
          </Field>
        </div>
      </SectionCard>

      {error ? (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {error}
          <Button className="ml-3" onClick={() => void load()}>
            重新加载
          </Button>
        </div>
      ) : (
        <>
          {/* 不传 scroll.x（规范 §4 的 max-content 是多列宽表惯例）：本表 9 列可压缩，
              max-content 会坚持内容自然宽度，容器不足即出横向滚动条（ql-20260903-013）；
              无横滚也无需 fixed 列。 */}
          <DataTable<OrgRow>
            rowKey="id"
            columns={columns}
            dataSource={filteredRows}
            loading={loading}
            size="small"
            bordered
            pagination={false}
            emptyText="暂无组织"
            expandable={{
              expandedRowKeys: expandedKeys,
              onExpandedRowsChange: (rows) => setExpandedKeys(rows),
            }}
          />
        </>
      )}

      {modal.open && (
        <OrgFormModal
          mode={modal.mode}
          org={modal.org}
          initialParentId={modal.parentId ?? null}
          canWrite={canWrite}
          allOrgs={orgs}
          onClose={() => setModal({ open: false, mode: "create" })}
          onSaved={handleFormSaved}
        />
      )}

      <Modal
        open={!!deleteTarget}
        title="确认删除组织？"
        onCancel={() => setDeleteTarget(null)}
        onOk={() => void handleConfirmDelete()}
        okText="确认删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        maskClosable={false}
        destroyOnClose
      >
        <p className="mt-2 text-xs text-muted-foreground">
          将删除组织{" "}
          <span className="font-mono">{deleteTarget?.code}</span>
          （{deleteTarget?.name}）。该操作不可恢复，子组织和关联用户需先清空。
        </p>
      </Modal>
    </PageContainer>
  );
}

/** 新建/编辑组织弹窗（规范 §6：antd Modal + Form vertical，非 Drawer） */
function OrgFormModal({
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
  onSaved: (
    _body: OrganizationCreateRequest | OrganizationUpdateRequest,
    _mode: "create" | "edit",
    _targetId?: string,
  ) => Promise<void>;
}) {
  const [formInst] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const { message } = App.useApp();

  // edit 模式禁选自身 + 后代（防环），树数据与表格共用 buildRows 的平铺结构
  const treeData = useMemo(() => {
    const forbidden = mode === "edit" && org ? forbiddenParentIds(allOrgs, org.id) : null;
    const toNodes = (rows: OrgRow[]): TreeSelectNode[] =>
      rows
        .filter((r) => !forbidden?.has(r.id))
        .map((r) => ({
          title: `${r.name}（${r.code}）`,
          value: r.id,
          children: r.children && r.children.length > 0 ? toNodes(r.children) : undefined,
        }));
    return toNodes(buildRows(allOrgs));
  }, [mode, org, allOrgs]);

  const submit = async () => {
    const values = await formInst.validateFields();
    if (!canWrite) return;
    setSaving(true);
    try {
      await onSaved(
        {
          name: values.name,
          code: values.code,
          description: values.description || undefined,
          parent_id: values.parent_id ?? null,
          sort_order: values.sort_order ?? 0,
        },
        mode,
        org?.id,
      );
    } catch (err) {
      message.error(orgErrorMessage(err, "保存失败"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onCancel={onClose}
      title={mode === "create" ? "新建组织" : `编辑组织 ${org?.code}`}
      width={520}
      maskClosable={false}
      destroyOnClose
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            loading={saving}
            disabled={!canWrite}
            onClick={() => void submit()}
          >
            保存
          </Button>
        </div>
      }
    >
      <Form
        form={formInst}
        layout="vertical"
        preserve={false}
        initialValues={{
          name: org?.name ?? "",
          code: org?.code ?? "",
          description: org?.description ?? "",
          parent_id: org?.parent_id ?? initialParentId,
          sort_order: org?.sort_order ?? 0,
        }}
      >
        <Form.Item
          name="name"
          label="名称"
          rules={[
            { required: true, message: "请输入组织名称" },
            { max: 100, message: "名称最长 100 字符" },
          ]}
        >
          <Input maxLength={100} disabled={!canWrite} placeholder="如：研发部" />
        </Form.Item>
        <Form.Item
          name="code"
          label="Code"
          rules={[
            { required: true, message: "请输入 code" },
            { pattern: CODE_PATTERN, message: "小写字母开头，仅含小写字母/数字/下划线" },
          ]}
        >
          <Input
            className="font-mono"
            disabled={mode === "edit" || !canWrite}
            placeholder="如：dev"
          />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea
            rows={3}
            maxLength={500}
            disabled={!canWrite}
            placeholder="选填"
          />
        </Form.Item>
        <Form.Item name="parent_id" label="父组织">
          <TreeSelect
            treeData={treeData}
            treeDefaultExpandAll
            allowClear
            disabled={!canWrite}
            placeholder="（顶级）"
          />
        </Form.Item>
        <Form.Item name="sort_order" label="排序">
          <InputNumber className="w-24" disabled={!canWrite} />
        </Form.Item>
        <p className="text-[11px] text-muted-foreground">
          状态变更走列表行内「禁用 / 启用」按钮（专用端点）。
        </p>
      </Form>
    </Modal>
  );
}

/** TreeSelect 树节点（antd TreeDataNode 子集） */
interface TreeSelectNode {
  title: string;
  value: string;
  children?: TreeSelectNode[];
}

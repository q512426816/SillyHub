"use client";

/**
 * 计划节点模板 (PlanNode) 页面 — 按 has_module 条件展开二层/三层。
 *
 * 数据模型 (对齐源 dept_project_front plannode):
 *   PlanNode (模板) ─┬─ PlanNodeDetail (模板明细)
 *                    └─ PlanNodeModule (执行模块)
 *
 * 展开结构 (plan-node-module-restructure / D-001/D-002@v1):
 *   has_module=false → 模板 → 明细 (二层,明细挂 plan_node_id)
 *   has_module=true  → 模板 → 模块 → 明细 (三层,明细挂 module_id)
 *
 * 走 lib/ppm/plan.ts:listPlanNodes / listPlanNodeDetails(nodeId, moduleId?) /
 * listPlanNodeModules + CRUD。设计依据:design.md §5.3 + tasks/task-06/07/08。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  Switch,
  Table,
  type TableProps,
  Tag,
  message,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";

import { Button } from "@/components/ui/button";
import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
import {
  PpmDictSelect,
  getPpmDictLabel,
  type PpmDictType,
} from "@/components/ppm-dict-select";
import { PpmUserSelect } from "@/components/ppm-user-select";
import {
  PpmSubTable,
  type PpmSubEditableColumn,
  type PpmSubTableRow,
} from "@/components/ppm-sub-table";
import { ApiError } from "@/lib/api";
import {
  fmtDate,
  createPlanNode,
  createPlanNodeDetailTpl,
  createPlanNodeModule,
  deletePlanNode,
  deletePlanNodeDetailTpl,
  deletePlanNodeModule,
  listPlanNodeDetails,
  listPlanNodeModules,
  listPlanNodes,
  updatePlanNode,
  updatePlanNodeDetailTpl,
  updatePlanNodeModule,
  type PlanNode,
  type PlanNodeDetail,
  type PlanNodeDetailCreate,
  type PlanNodeDetailUpdate,
  type PlanNodeModule,
} from "@/lib/ppm";

const PROJECT_TYPE_DICT: PpmDictType = "project_type";

interface DrawerState {
  open: boolean;
  mode: "create" | "edit";
  node?: PlanNode;
}

export default function PlanNodesPage() {
  const [nodes, setNodes] = useState<PlanNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerState>({
    open: false,
    mode: "create",
  });
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setNodes(await listPlanNodes({ page: 1, page_size: 200 }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const showToast = (ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 3000);
  };

  const handleSaveNode = async (form: {
    overall_stage: string;
    project_type: string | null;
    no: number | null;
    has_module: boolean;
  }) => {
    if (drawer.mode === "create") {
      // create:has_module 必传 (PlanNodeCreate);新建时定,保存后不可改 (D-001)
      const created = await createPlanNode(form);
      showToast(true, `模板 ${created.overall_stage} 已创建`);
    } else if (drawer.node) {
      // edit:has_module 不可改,PlanNodeUpdate 不含此字段 (后端亦强制忽略)
      const { has_module: _ignored, ...updateBody } = form;
      void _ignored;
      await updatePlanNode(drawer.node.id, updateBody);
      showToast(true, "模板已更新");
    }
    setDrawer({ open: false, mode: "create" });
    await load();
  };

  const handleDeleteNode = async (node: PlanNode) => {
    if (!confirm(`删除模板「${node.overall_stage}」?此操作不可恢复。`)) return;
    try {
      await deletePlanNode(node.id);
      showToast(true, "已删除");
      await load();
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "删除失败");
    }
  };

  const columns: TableProps<PlanNode>["columns"] = [
    { title: "编号", dataIndex: "no", key: "no", width: 70 },
    {
      title: "总阶段",
      dataIndex: "overall_stage",
      key: "overall_stage",
      render: (v: string) => <span className="font-medium">{v}</span>,
    },
    {
      title: "项目类型",
      dataIndex: "project_type",
      key: "project_type",
      render: (v: string | null) => {
        const label = getPpmDictLabel(PROJECT_TYPE_DICT, v);
        return label ? (
          <Tag>{label}</Tag>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        );
      },
    },
    {
      title: "是否有模块",
      dataIndex: "has_module",
      key: "has_module",
      width: 110,
      align: "center",
      render: (v: boolean) =>
        v ? <Tag color="blue">有</Tag> : <Tag>无</Tag>,
    },
    {
      title: "操作",
      key: "actions",
      align: "center",
      width: 140,
      render: (_v: unknown, n: PlanNode) => (
        <div className="flex justify-center whitespace-nowrap gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDrawer({ open: true, mode: "edit", node: n })}
          >
            编辑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-red-600 hover:text-red-700"
            onClick={() => void handleDeleteNode(n)}
          >
            删除
          </Button>
        </div>
      ),
    },
  ];

  return (
    <PageContainer size="full">
      <PageHeader
        title="计划节点模板"
        subtitle="新建时选择是否有模块:无模块→模板→明细(二层);有模块→模板→模块→明细(三层)"
      />

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
        {/* 顶部按钮行:右对齐(新建模板) */}
        <div className="mb-2 flex items-center justify-end gap-2">
          <Button
            size="sm"
            onClick={() => setDrawer({ open: true, mode: "create" })}
          >
            + 新建模板
          </Button>
        </div>

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
          <Table<PlanNode>
            rowKey="id"
            columns={columns}
            dataSource={nodes}
            loading={loading}
            size="small"
            bordered
            pagination={false}
            locale={{ emptyText: "暂无模板" }}
            rowClassName={(_row: PlanNode, idx: number) =>
              idx % 2 === 1 ? "bg-muted/40" : ""
            }
            scroll={{ x: "max-content", y: "calc(100vh - 430px)" }}
            expandable={{
              expandedRowRender: (node) => (
                <PlanNodeChildren
                  key={node.id}
                  node={node}
                  onChanged={() => void load()}
                />
              ),
            }}
          />
        )}
      </SectionCard>

      {drawer.open && (
        <NodeFormDrawer
          mode={drawer.mode}
          node={drawer.node}
          onClose={() => setDrawer({ open: false, mode: "create" })}
          onSubmit={(v) => void handleSaveNode(v)}
        />
      )}
    </PageContainer>
  );
}

// ---------------------------------------------------------------------------
// 模板展开区:按 has_module 条件渲染 (二层明细 / 三层模块)
// ---------------------------------------------------------------------------

function PlanNodeChildren({
  node,
  onChanged,
}: {
  node: PlanNode;
  onChanged: () => void;
}) {
  return (
    <div className="bg-muted/20 p-3">
      {node.has_module ? (
        // 三层:模板 → 模块 → 明细 (明细挂 module_id,D-002)
        <ModulesSubTable node={node} onChanged={onChanged} />
      ) : (
        // 二层:模板 → 明细 (明细挂 plan_node_id)
        <DetailsSubTable node={node} onChanged={onChanged} />
      )}
    </div>
  );
}

// ── 明细子表:整表行内编辑(对齐源 NodeDetailForm.vue) ───────────────────────

/** 草稿行类型:已存在明细带真实 id;新增行用临时 __tempId 作 rowKey。 */
interface DetailDraftRow extends PpmSubTableRow {
  id: string; // 已存在=真实 id;新增=`new-${n}` 临时键
  plan_node_id?: string | null;
  module_id?: string | null;
  detailed_stage: string | null;
  task_theme: string | null;
  task_description: string | null;
  requirements: string | null;
  role_name: string | null;
  achievement: string | null;
  overall_stage: string | null;
}

/** 明细行内编辑列定义(对齐源 NodeDetailForm 字段顺序)。
 * 列宽总和控制在容器宽度内,避免 textarea 撑高/水平滚动导致布局错乱。 */
const DETAIL_COLUMNS: PpmSubEditableColumn<DetailDraftRow>[] = [
  { name: "detailed_stage", label: "详细阶段", width: 90, placeholder: "详细阶段" },
  { name: "task_theme", label: "任务主题", width: 100, placeholder: "任务主题" },
  {
    name: "task_description",
    label: "任务描述",
    editType: "textarea",
    width: 140,
    placeholder: "任务描述",
  },
  { name: "requirements", label: "要求与注意事项", width: 120, placeholder: "要求与注意事项" },
  { name: "role_name", label: "角色名称", width: 80, placeholder: "角色名称" },
  { name: "achievement", label: "成果", width: 90, placeholder: "成果" },
  { name: "overall_stage", label: "总体阶段", width: 90, placeholder: "总体阶段" },
];

function DetailsSubTable({
  node,
  moduleId,
  onChanged,
}: {
  node: PlanNode;
  /** 三层模式:该明细所属模块 id (挂 module_id);二层模式:undefined (挂 plan_node_id)。 */
  moduleId?: string;
  onChanged: () => void;
}) {
  const [draftRows, setDraftRows] = useState<DetailDraftRow[]>([]);
  const [original, setOriginal] = useState<DetailDraftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newSeq, setNewSeq] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      // moduleId 指定 → 按模块过滤 (三层);不传 → 该模板全部明细 (二层)
      const list: PlanNodeDetail[] = await listPlanNodeDetails(node.id, moduleId);
      const rows: DetailDraftRow[] = list.map((d) => ({
        id: d.id,
        plan_node_id: d.plan_node_id,
        module_id: d.module_id,
        detailed_stage: d.detailed_stage,
        task_theme: d.task_theme,
        task_description: d.task_description,
        requirements: d.requirements,
        role_name: d.role_name,
        achievement: d.achievement,
        overall_stage: d.overall_stage,
      }));
      setDraftRows(rows);
      setOriginal(rows);
      setNewSeq(0);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [node.id, moduleId]);

  useEffect(() => {
    void load();
  }, [load]);

  const newRowFactory = useCallback((): DetailDraftRow => {
    setNewSeq((n) => n + 1);
    const seq = newSeq + 1;
    return {
      id: `new-${seq}-${Date.now()}`,
      plan_node_id: node.id,
      // 三层挂 moduleId;二层为 null (归属由后端 plan_node_id 决定)
      module_id: moduleId ?? null,
      detailed_stage: null,
      task_theme: null,
      task_description: null,
      requirements: null,
      role_name: null,
      achievement: null,
      overall_stage: null,
    };
  }, [node.id, moduleId, newSeq]);

  const isDirty = useMemo(() => {
    if (draftRows.length !== original.length) return true;
    const origMap = new Map(original.map((r) => [r.id, r]));
    for (const r of draftRows) {
      const o = origMap.get(r.id);
      if (!o) return true;
      for (const col of DETAIL_COLUMNS) {
        if ((o[col.name] ?? null) !== (r[col.name] ?? null)) return true;
      }
    }
    return false;
  }, [draftRows, original]);

  const handleSave = async () => {
    setSaving(true);
    setErr(null);
    try {
      const origMap = new Map(original.map((r) => [r.id, r]));
      const draftIds = new Set(draftRows.map((r) => r.id));

      // 1) 删除:原列表里有,draft 里没有的
      const toDelete = original.filter((r) => !draftIds.has(r.id));
      // 2) 更新:有真实 id 且字段有变 (行内编辑不改 module_id 归属)
      const toUpdate = draftRows.filter((r) => {
        if (r.id.startsWith("new-")) return false;
        const o = origMap.get(r.id);
        if (!o) return false;
        return DETAIL_COLUMNS.some(
          (c) => (o[c.name] ?? null) !== (r[c.name] ?? null),
        );
      });
      // 3) 新增:临时 id
      const toCreate = draftRows.filter((r) => r.id.startsWith("new-"));

      for (const r of toDelete) {
        await deletePlanNodeDetailTpl(r.id);
      }
      for (const r of toUpdate) {
        const body: PlanNodeDetailUpdate = {
          detailed_stage: r.detailed_stage ?? null,
          task_theme: r.task_theme ?? null,
          task_description: r.task_description ?? null,
          requirements: r.requirements ?? null,
          role_name: r.role_name ?? null,
          achievement: r.achievement ?? null,
          overall_stage: r.overall_stage ?? null,
        };
        await updatePlanNodeDetailTpl(r.id, body);
      }
      for (const r of toCreate) {
        const body: PlanNodeDetailCreate = {
          plan_node_id: node.id,
          // 三层挂 moduleId;二层为 null (design §5.1)
          module_id: moduleId ?? null,
          detailed_stage: r.detailed_stage ?? null,
          task_theme: r.task_theme ?? null,
          task_description: r.task_description ?? null,
          requirements: r.requirements ?? null,
          role_name: r.role_name ?? null,
          achievement: r.achievement ?? null,
          overall_stage: r.overall_stage ?? null,
        };
        await createPlanNodeDetailTpl(body);
      }

      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium">
          {moduleId ? "模块明细" : "模板明细"}
        </h3>
        <div className="flex items-center gap-2">
          {isDirty && (
            <span className="text-[11px] text-amber-600">有未保存修改</span>
          )}
          <Button
            size="sm"
            disabled={saving || !isDirty}
            onClick={() => void handleSave()}
          >
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
      {err && <p className="mb-2 text-[11px] text-destructive">{err}</p>}
      <PpmSubTable<DetailDraftRow>
        editable
        masterRows={draftRows}
        columns={DETAIL_COLUMNS}
        onChange={setDraftRows}
        newRowFactory={newRowFactory}
        canAddRemove
        tableProps={{ loading, scroll: { x: 790 } }}
      />
      <p className="mt-1 text-[11px] text-muted-foreground">
        整表行内编辑,修改后点击「保存」批量提交。
      </p>
    </div>
  );
}

// ── 模块子表 (三层:模块行展开 → 该模块明细) ───────────────────────────────

function ModulesSubTable({
  node,
  onChanged,
}: {
  node: PlanNode;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<PlanNodeModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<PlanNodeModule | "new" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      setItems(await listPlanNodeModules(node.id));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [node.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async (id: string) => {
    if (!confirm("删除该模块?")) return;
    try {
      await deletePlanNodeModule(id);
      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "删除失败");
    }
  };

  const columns: TableProps<PlanNodeModule>["columns"] = [
    { title: "模块名", dataIndex: "module_name", key: "module_name" },
    {
      title: "计划工时",
      dataIndex: "plan_workload",
      key: "plan_workload",
      width: 110,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "计划开始",
      dataIndex: "plan_begin_time",
      key: "plan_begin_time",
      width: 120,
      render: (v: string | null) => fmtDate(v),
    },
    {
      title: "计划完成",
      dataIndex: "plan_complete_time",
      key: "plan_complete_time",
      width: 120,
      render: (v: string | null) => fmtDate(v),
    },
    {
      title: "操作",
      key: "actions",
      align: "center",
      width: 140,
      render: (_v: unknown, m: PlanNodeModule) => (
        <div className="flex justify-center whitespace-nowrap gap-1">
          <Button size="sm" variant="ghost" onClick={() => setEditing(m)}>
            编辑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-red-600 hover:text-red-700"
            onClick={() => void handleDelete(m.id)}
          >
            删除
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="rounded border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium">模块</h3>
        <Button size="sm" onClick={() => setEditing("new")}>
          + 新增
        </Button>
      </div>
      {err && <p className="mb-2 text-[11px] text-destructive">{err}</p>}
      <Table<PlanNodeModule>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={items}
        columns={columns}
        pagination={false}
        rowClassName={(_row: PlanNodeModule, idx: number) =>
          idx % 2 === 1 ? "bg-muted/40" : ""
        }
        locale={{ emptyText: "暂无模块" }}
        scroll={{ x: 790 }}
        // 三层:模块行展开 → 该模块下的明细 (挂 module_id,D-002)
        expandable={{
          expandedRowRender: (m) => (
            <DetailsSubTable
              node={node}
              moduleId={m.id}
              onChanged={onChanged}
            />
          ),
        }}
      />
      {editing && (
        <ModuleFormDrawer
          planNodeId={node.id}
          module={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 表单抽屉 (antd Form 化,task-08)
// ---------------------------------------------------------------------------

interface NodeFormValues {
  overall_stage: string;
  project_type?: string | null;
  no?: number | null;
  has_module: boolean;
}

function NodeFormDrawer({
  mode,
  node,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  node?: PlanNode;
  onClose: () => void;
  onSubmit: (_v: {
    overall_stage: string;
    project_type: string | null;
    no: number | null;
    has_module: boolean;
  }) => void;
}) {
  const [form] = Form.useForm<NodeFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode === "edit" && node) {
      form.setFieldsValue({
        overall_stage: node.overall_stage,
        project_type: node.project_type,
        no: node.no,
        has_module: node.has_module,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ has_module: false });
    }
  }, [mode, node, form]);

  const submit = async () => {
    let values: NodeFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // 校验失败,Form.Item 自动显示错误
    }
    setBusy(true);
    try {
      onSubmit({
        overall_stage: values.overall_stage.trim(),
        project_type: values.project_type ?? null,
        no: values.no ?? null,
        has_module: values.has_module,
      });
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "提交失败");
      setBusy(false);
    }
  };

  return (
    <Drawer
      title={mode === "create" ? "新建模板" : "编辑模板"}
      open
      onClose={onClose}
      width={460}
      destroyOnClose
      maskClosable={false}
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void submit()}>
            {busy ? "保存中…" : "保存"}
          </Button>
        </div>
      }
    >
      {contextHolder}
      <Form<NodeFormValues>
        form={form}
        layout="vertical"
        requiredMark
        initialValues={{ has_module: false }}
      >
        <Form.Item
          label="总阶段"
          name="overall_stage"
          rules={[{ required: true, message: "请输入总阶段" }]}
        >
          <Input placeholder="请输入总阶段" />
        </Form.Item>
        <Form.Item label="项目类型" name="project_type">
          <PpmDictSelect
            type={PROJECT_TYPE_DICT}
            placeholder="请选择项目类型"
          />
        </Form.Item>
        <Form.Item label="编号" name="no">
          <InputNumber style={{ width: "100%" }} placeholder="请输入编号" />
        </Form.Item>
        <Form.Item
          label="是否有模块"
          name="has_module"
          valuePropName="checked"
          tooltip="新建时确定,保存后不可修改。有模块→模板→模块→明细(三层);无模块→模板→明细(二层)"
        >
          <Switch
            disabled={mode === "edit"}
            checkedChildren="有"
            unCheckedChildren="无"
          />
        </Form.Item>
      </Form>
    </Drawer>
  );
}

interface ModuleFormValues {
  module_name?: string;
  plan_workload?: string;
  plan_begin_time?: Dayjs | null;
  plan_complete_time?: Dayjs | null;
  duty_user_id?: string | null;
}

function ModuleFormDrawer({
  planNodeId,
  module,
  onClose,
  onSaved,
}: {
  planNodeId: string;
  module: PlanNodeModule | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm<ModuleFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (module) {
      form.setFieldsValue({
        module_name: module.module_name ?? "",
        plan_workload: module.plan_workload ?? "",
        plan_begin_time: module.plan_begin_time ? dayjs(module.plan_begin_time) : null,
        plan_complete_time: module.plan_complete_time
          ? dayjs(module.plan_complete_time)
          : null,
        duty_user_id: module.duty_user_id,
      });
    } else {
      form.resetFields();
    }
  }, [module, form]);

  const submit = async () => {
    let values: ModuleFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setBusy(true);
    try {
      // plan_workload 后端为 String (前端直传,不解析数值);日期 Dayjs→ISO。
      const body = {
        module_name: values.module_name || null,
        plan_workload: values.plan_workload || null,
        plan_begin_time: values.plan_begin_time
          ? values.plan_begin_time.toISOString()
          : null,
        plan_complete_time: values.plan_complete_time
          ? values.plan_complete_time.toISOString()
          : null,
        duty_user_id: values.duty_user_id || null,
      };
      if (module) {
        await updatePlanNodeModule(module.id, body);
      } else {
        await createPlanNodeModule({ plan_node_id: planNodeId, ...body });
      }
      onSaved();
    } catch (e) {
      messageApi.error(e instanceof ApiError ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      title={module ? "编辑模块" : "新增模块"}
      open
      onClose={onClose}
      width={480}
      destroyOnClose
      maskClosable={false}
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void submit()}>
            {busy ? "保存中…" : "保存"}
          </Button>
        </div>
      }
    >
      {contextHolder}
      <Form<ModuleFormValues> form={form} layout="vertical">
        <Form.Item label="模块名" name="module_name">
          <Input placeholder="请输入模块名" />
        </Form.Item>
        <Form.Item label="计划工时" name="plan_workload">
          <Input placeholder="请输入计划工时" />
        </Form.Item>
        <Form.Item label="计划开始" name="plan_begin_time">
          <DatePicker style={{ width: "100%" }} placeholder="选择计划开始" />
        </Form.Item>
        <Form.Item label="计划完成" name="plan_complete_time">
          <DatePicker style={{ width: "100%" }} placeholder="选择计划完成" />
        </Form.Item>
        <Form.Item label="责任人" name="duty_user_id">
          <PpmUserSelect
            res="projectMember"
            placeholder="请选择责任人"
          />
        </Form.Item>
      </Form>
    </Drawer>
  );
}

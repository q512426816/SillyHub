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
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Switch,
  Table,
  type TableProps,
  Tag,
  message,
} from "antd";

import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
import {
  PpmDictSelect,
  getPpmDictLabel,
  type PpmDictType,
} from "@/components/ppm-dict-select";
import {
  PpmSubTable,
  type PpmSubEditableColumn,
  type PpmSubTableRow,
} from "@/components/ppm-sub-table";
import { ApiError } from "@/lib/api";
import {
  createPlanNode,
  createPlanNodeDetailTpl,
  deletePlanNode,
  deletePlanNodeDetailTpl,
  listPlanNodeDetails,
  listPlanNodes,
  updatePlanNode,
  updatePlanNodeDetailTpl,
  type PlanNode,
  type PlanNodeDetail,
  type PlanNodeDetailCreate,
  type PlanNodeDetailUpdate,
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
      setNodes(
        await listPlanNodes({ page: 1, page_size: 200, order_by: "no", order: "asc" }),
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
      // v3: has_module 编辑时可改 (D-001 取消),正常透传
      await updatePlanNode(drawer.node.id, form);
      showToast(true, "模板已更新");
    }
    setDrawer({ open: false, mode: "create" });
    await load();
  };

  const handleDeleteNode = async (node: PlanNode) => {
    Modal.confirm({
      title: `删除模板「${node.overall_stage}」?`,
      content: "此操作不可恢复。",
      okText: "确认删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      maskClosable: false,
      onOk: async () => {
        try {
          await deletePlanNode(node.id);
          showToast(true, "已删除");
          await load();
        } catch (err) {
          showToast(false, err instanceof ApiError ? err.message : "删除失败");
        }
      },
    });
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
            size="small"
            type="link"
            onClick={() => setDrawer({ open: true, mode: "edit", node: n })}
          >
            编辑
          </Button>
          <Button
            size="small"
            type="link"
            danger
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
              ? "border-success/30 bg-success/10 text-success"
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
            type="primary"
            onClick={() => setDrawer({ open: true, mode: "create" })}
          >
            + 新建模板
          </Button>
        </div>

        {error ? (
          <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
            {error}
            <Button
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
  // v2(2026-07-16):has_module 仅作记录,不驱动展开结构;
  // 无论是否有模块,计划节点模板页展开统一只显示模板明细一个子表(二层,挂 plan_node_id)。
  return (
    <div className="bg-muted/20 p-3">
      <DetailsSubTable node={node} onChanged={onChanged} />
    </div>
  );
}

// ── 明细子表:整表行内编辑(对齐源 NodeDetailForm.vue) ───────────────────────

/** 草稿行类型:已存在明细带真实 id;新增行用临时 __tempId 作 rowKey。 */
interface DetailDraftRow extends PpmSubTableRow {
  id: string; // 已存在=真实 id;新增=`new-${n}` 临时键
  plan_node_id?: string | null;
  module_id?: string | null;
  no: string | null; // 序号(拖拽排序后按 index+1 重算,保存时持久化)
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
        no: d.no,
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
      no: null,
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
      // 2) 更新:有真实 id 且字段有变(含序号 no —— 拖拽改顺序也要持久化)
      const toUpdate = draftRows.filter((r) => {
        if (r.id.startsWith("new-")) return false;
        const o = origMap.get(r.id);
        if (!o) return false;
        return (
          DETAIL_COLUMNS.some((c) => (o[c.name] ?? null) !== (r[c.name] ?? null)) ||
          (o.no ?? null) !== (r.no ?? null)
        );
      });
      // 3) 新增:临时 id
      const toCreate = draftRows.filter((r) => r.id.startsWith("new-"));

      for (const r of toDelete) {
        await deletePlanNodeDetailTpl(r.id);
      }
      for (const r of toUpdate) {
        const body: PlanNodeDetailUpdate = {
          no: r.no ?? null,
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
          no: r.no ?? null,
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
            <span className="text-[11px] text-destructive">有未保存修改</span>
          )}
          <Button
            type="primary"
            loading={saving}
            disabled={!isDirty}
            onClick={() => void handleSave()}
          >
            保存
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
        dragSort
        tableProps={{ loading, scroll: { x: 860 } }}
      />
      <p className="mt-1 text-[11px] text-muted-foreground">
        整表行内编辑,修改后点击「保存」批量提交。
      </p>
    </div>
  );
}

// v2(2026-07-16):模块子表已从计划节点模板页移除(has_module 仅记录,展开统一只显示明细)。
// 模块 CRUD 仍在 milestone-details 等页保留(PlanNodeModule 表/后端端点零回归)。

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
    <Modal
      title={mode === "create" ? "新建模板" : "编辑模板"}
      open
      onCancel={onClose}
      width={460}
      destroyOnClose
      maskClosable={false}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>
            取消
          </Button>
          <Button type="primary" loading={busy} onClick={() => void submit()}>
            保存
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
          tooltip="记录字段:标记模板是否按模块组织(当前展开统一显示明细,编辑可改)"
        >
          <Switch checkedChildren="有" unCheckedChildren="无" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

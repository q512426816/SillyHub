"use client";

/**
 * 计划节点模板 (PlanNode) 页面 — 三层嵌套 (模板 → 明细 → 模块)。
 *
 * 数据模型 (对齐源 dept_project_front plannode):
 *   PlanNode (模板) ─┬─ PlanNodeDetail (模板明细)
 *                    └─ PlanNodeModule (执行模块,plan_node_id 指向 PlanNode)
 *
 * UI 结构 (AntD Table expand 嵌套):
 *   第 1 层 模板列表 — overall_stage / project_type / no,行内可编辑
 *   第 2 层 expand 模板行 → 明细子表 (整表行内编辑,PpmSubTable)
 *   第 3 层 expand 模板行 → 模块子表 (抽屉表单 + 责任人 PpmUserSelect)
 *
 * 模块在数据层挂在 PlanNode 下 (非 PlanNodeDetail),
 * 故"明细"和"模块"作为同一模板展开区内的两个并列子表呈现。
 *
 * 走 lib/ppm/plan.ts:listPlanNodes / listPlanNodeDetails /
 * listPlanNodeModules + CRUD。设计依据:tasks/task-06.md + 源
 * views/ppm/plannode/index.vue (主表 expand NodeDetailList) +
 * components/NodeDetailList.vue。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Table, type TableProps, Tag } from "antd";

import { Button } from "@/components/ui/button";
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

const inputCls =
  "h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none";

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
  }) => {
    if (drawer.mode === "create") {
      const created = await createPlanNode(form);
      showToast(true, `模板 ${created.overall_stage} 已创建`);
    } else if (drawer.node) {
      await updatePlanNode(drawer.node.id, form);
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
      title: "操作",
      key: "actions",
      align: "right",
      render: (_v: unknown, n: PlanNode) => (
        <div className="flex justify-end gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDrawer({ open: true, mode: "edit", node: n })}
          >
            编辑
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => void handleDeleteNode(n)}
          >
            删除
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="mt-0.5">计划节点模板</h1>
          <p className="text-xs text-muted-foreground">
            模板 → 模板明细 → 执行模块(展开行查看明细与模块)
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setDrawer({ open: true, mode: "create" })}
        >
          + 新建模板
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
        <Table<PlanNode>
          rowKey="id"
          columns={columns}
          dataSource={nodes}
          loading={loading}
          size="small"
          pagination={false}
          locale={{ emptyText: "暂无模板" }}
          scroll={{ x: "max-content" }}
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

      {drawer.open && (
        <NodeFormDrawer
          mode={drawer.mode}
          node={drawer.node}
          onClose={() => setDrawer({ open: false, mode: "create" })}
          onSubmit={(v) => void handleSaveNode(v)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 模板展开区:明细子表 (第 2 层) + 模块子表 (第 3 层)
// ---------------------------------------------------------------------------

function PlanNodeChildren({
  node,
  onChanged,
}: {
  node: PlanNode;
  onChanged: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 bg-muted/20 p-3">
      <DetailsSubTable node={node} onChanged={onChanged} />
      <ModulesSubTable node={node} onChanged={onChanged} />
    </div>
  );
}

// ── 明细子表:整表行内编辑(对齐源 NodeDetailForm.vue) ───────────────────────

/** 草稿行类型:已存在明细带真实 id;新增行用临时 __tempId 作 rowKey。 */
interface DetailDraftRow extends PpmSubTableRow {
  id: string; // 已存在=真实 id;新增=`new-${n}` 临时键
  plan_node_id?: string | null;
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
  { name: "detailed_stage", label: "详细阶段", width: 120, placeholder: "详细阶段" },
  { name: "task_theme", label: "任务主题", width: 120, placeholder: "任务主题" },
  {
    name: "task_description",
    label: "任务描述",
    editType: "textarea",
    width: 180,
    placeholder: "任务描述",
  },
  { name: "requirements", label: "要求与注意事项", width: 160, placeholder: "要求与注意事项" },
  { name: "role_name", label: "角色名称", width: 100, placeholder: "角色名称" },
  { name: "achievement", label: "成果", width: 120, placeholder: "成果" },
  { name: "overall_stage", label: "总体阶段", width: 120, placeholder: "总体阶段" },
];

function DetailsSubTable({
  node,
  onChanged,
}: {
  node: PlanNode;
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
      const list: PlanNodeDetail[] = await listPlanNodeDetails(node.id);
      const rows: DetailDraftRow[] = list.map((d) => ({
        id: d.id,
        plan_node_id: d.plan_node_id,
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
  }, [node.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const newRowFactory = useCallback((): DetailDraftRow => {
    setNewSeq((n) => n + 1);
    const seq = newSeq + 1;
    return {
      id: `new-${seq}-${Date.now()}`,
      plan_node_id: node.id,
      detailed_stage: null,
      task_theme: null,
      task_description: null,
      requirements: null,
      role_name: null,
      achievement: null,
      overall_stage: null,
    };
  }, [node.id, newSeq]);

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
      // 2) 更新:有真实 id 且字段有变
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
        <h3 className="text-sm font-medium">模板明细</h3>
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
        tableProps={{ loading }}
      />
      <p className="mt-1 text-[11px] text-muted-foreground">
        整表行内编辑,修改后点击「保存」批量提交。
      </p>
    </div>
  );
}

// ── 模块子表:抽屉表单 + 责任人 PpmUserSelect ────────────────────────────────

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
      align: "right",
      render: (_v: unknown, m: PlanNodeModule) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="outline" onClick={() => setEditing(m)}>
            编辑
          </Button>
          <Button
            size="sm"
            variant="destructive"
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
        locale={{ emptyText: "暂无模块" }}
        scroll={{ x: "max-content" }}
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
// 表单抽屉
// ---------------------------------------------------------------------------

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
  }) => void;
}) {
  const [overallStage, setOverallStage] = useState(node?.overall_stage ?? "");
  const [projectType, setProjectType] = useState(node?.project_type ?? null);
  const [no, setNo] = useState<string>(node?.no != null ? String(node.no) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    setBusy(true);
    setErr(null);
    try {
      onSubmit({
        overall_stage: overallStage.trim(),
        project_type: projectType ?? null,
        no: no.trim() ? Number(no) : null,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "提交失败");
      setBusy(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-[460px] flex-col border-l bg-background shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-medium">
            {mode === "create" ? "新建模板" : "编辑模板"}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <Field label="总阶段 *">
            <input
              value={overallStage}
              onChange={(e) => setOverallStage(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="项目类型">
            <PpmDictSelect
              type={PROJECT_TYPE_DICT}
              value={projectType}
              onChange={(v) => setProjectType(typeof v === "string" ? v : null)}
              placeholder="请选择项目类型"
            />
          </Field>
          <Field label="编号">
            <input
              type="number"
              value={no}
              onChange={(e) => setNo(e.target.value)}
              className={inputCls}
            />
          </Field>
          {err && <p className="text-[11px] text-destructive">{err}</p>}
        </div>
        <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-background px-4 py-3">
          <Button size="sm" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            disabled={busy || !overallStage.trim()}
            onClick={submit}
          >
            {busy ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </>
  );
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
  const [moduleName, setModuleName] = useState(module?.module_name ?? "");
  const [planWorkload, setPlanWorkload] = useState(module?.plan_workload ?? "");
  const [planBegin, setPlanBegin] = useState(module?.plan_begin_time ?? "");
  const [planComplete, setPlanComplete] = useState(
    module?.plan_complete_time ?? "",
  );
  const [dutyUserId, setDutyUserId] = useState(module?.duty_user_id ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const body = {
        module_name: moduleName || null,
        plan_workload: planWorkload || null,
        plan_begin_time: planBegin || null,
        plan_complete_time: planComplete || null,
        duty_user_id: dutyUserId || null,
      };
      if (module) {
        await updatePlanNodeModule(module.id, body);
      } else {
        await createPlanNodeModule({ plan_node_id: planNodeId, ...body });
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-[480px] flex-col border-l bg-background shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-medium">
            {module ? "编辑模块" : "新增模块"}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <Field label="模块名">
            <input value={moduleName} onChange={(e) => setModuleName(e.target.value)} className={inputCls} />
          </Field>
          <Field label="计划工时">
            <input value={planWorkload} onChange={(e) => setPlanWorkload(e.target.value)} className={inputCls} />
          </Field>
          <Field label="计划开始">
            <input value={planBegin} onChange={(e) => setPlanBegin(e.target.value)} placeholder="YYYY-MM-DD" className={inputCls} />
          </Field>
          <Field label="计划完成">
            <input value={planComplete} onChange={(e) => setPlanComplete(e.target.value)} placeholder="YYYY-MM-DD" className={inputCls} />
          </Field>
          <Field label="责任人">
            <PpmUserSelect
              res="projectMember"
              value={dutyUserId}
              onChange={(v) =>
                setDutyUserId(typeof v === "string" ? v : null)
              }
              placeholder="请选择责任人"
            />
          </Field>
          {err && <p className="text-[11px] text-destructive">{err}</p>}
        </div>
        <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-background px-4 py-3">
          <Button size="sm" variant="outline" onClick={onClose}>取消</Button>
          <Button size="sm" disabled={busy} onClick={() => void submit()}>
            {busy ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-[11px] text-muted-foreground">{label}</label>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

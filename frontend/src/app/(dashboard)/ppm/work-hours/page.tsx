"use client";

/**
 * 工时录入页面 (task-12 / FR-06)。
 *
 * 功能:
 *  - 列表分页 (work-hour/page),支持日期范围 / 项目 / 类型筛选。
 *  - 新建/编辑/删除工时记录。
 *  - 顶部快捷跳转「工时统计」。
 *
 * 依赖:lib/ppm/task (work-hour API) + lib/ppm/project (项目下拉) + stores/session。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Table, type TableProps } from "antd";

import { Button } from "@/components/ui/button";
import { PpmUserSelect } from "@/components/ppm-user-select";
import { ApiError } from "@/lib/api";
import {
  createWorkHour,
  deleteWorkHour,
  listWorkHours,
  updateWorkHour,
} from "@/lib/ppm/task";
import { listSimpleProjects } from "@/lib/ppm/project";
import type {
  ProjectSimpleItem,
  WorkHour,
  WorkHourCreate,
  WorkHourPageReq,
  WorkHourUpdate,
} from "@/lib/ppm/types";
import { useSession } from "@/stores/session";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  Toast,
  fmtDay,
  inputCls,
  today,
  useToast,
} from "../shared";

const TYPE_OPTIONS = [
  { value: 0, label: "常规" },
  { value: 1, label: "加班" },
  { value: 2, label: "调休" },
];

function typeLabel(t: number): string {
  return TYPE_OPTIONS.find((o) => o.value === t)?.label ?? String(t);
}

interface DrawerState {
  open: boolean;
  mode: "create" | "edit";
  item?: WorkHour;
}

export default function WorkHoursPage() {
  const { user: currentUser } = useSession();
  const { toast, showToast } = useToast();

  const [rows, setRows] = useState<WorkHour[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [projectFilter, setProjectFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");

  const [projects, setProjects] = useState<ProjectSimpleItem[]>([]);

  const [drawer, setDrawer] = useState<DrawerState>({
    open: false,
    mode: "create",
  });
  const [confirmDelete, setConfirmDelete] = useState<WorkHour | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const list = await listSimpleProjects();
        setProjects(list ?? []);
      } catch (e) {
        console.error("[ppm/work-hours] load projects failed", e);
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: WorkHourPageReq = { page, page_size: pageSize };
      if (startDate) params.work_date_start = startDate;
      if (endDate) params.work_date_end = endDate;
      if (projectFilter) params.project_id = projectFilter;
      if (typeFilter) params.type = Number(typeFilter);
      const resp = await listWorkHours(params);
      setRows(resp.items);
      setTotal(resp.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, startDate, endDate, projectFilter, typeFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const resetFilters = () => {
    setStartDate("");
    setEndDate("");
    setProjectFilter("");
    setTypeFilter("");
    setPage(1);
  };

  const handleSave = async (body: WorkHourCreate | WorkHourUpdate) => {
    if (drawer.mode === "create") {
      await createWorkHour(body as WorkHourCreate);
      showToast(true, "工时已录入");
    } else if (drawer.item) {
      await updateWorkHour(drawer.item.id, body as WorkHourUpdate);
      showToast(true, "工时已更新");
    }
    setDrawer({ open: false, mode: "create" });
    await load();
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    try {
      await deleteWorkHour(target.id);
      showToast(true, "工时已删除");
      await load();
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "删除失败");
    }
  };

  const columns: TableProps<WorkHour>["columns"] = useMemo(
    () => [
      {
        title: "日期",
        dataIndex: "work_date",
        key: "work_date",
        render: (v: string) => fmtDay(v),
      },
      {
        title: "项目",
        key: "project",
        render: (_v, r: WorkHour) => {
          const p = projects.find((x) => x.id === r.project_id);
          return p?.project_name ?? r.project_id;
        },
      },
      {
        title: "工时(h)",
        dataIndex: "hours",
        key: "hours",
        align: "right",
        render: (v: number) => (
          <span className="font-mono">{Number(v).toFixed(1)}</span>
        ),
      },
      {
        title: "类型",
        dataIndex: "type",
        key: "type",
        render: (v: number) => typeLabel(v),
      },
      {
        title: "说明",
        dataIndex: "description",
        key: "description",
        ellipsis: true,
        render: (v: string | null) => v ?? "—",
      },
      {
        title: "操作",
        key: "actions",
        align: "right",
        render: (_v, r: WorkHour) => (
          <div className="flex justify-end gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDrawer({ open: true, mode: "edit", item: r })}
            >
              编辑
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setConfirmDelete(r)}
            >
              删除
            </Button>
          </div>
        ),
      },
    ],
    [projects],
  );

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="mt-0.5">工时录入</h1>
          <p className="text-xs text-muted-foreground">
            按日期 / 项目 / 类型记录工时
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              window.location.href = "/ppm/work-hour-statistics";
            }}
          >
            工时统计 →
          </Button>
          <Button size="sm" onClick={() => setDrawer({ open: true, mode: "create" })}>
            + 录入工时
          </Button>
        </div>
      </header>

      <Toast toast={toast} />

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
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPage(1);
              }}
              className={`${inputCls} w-40`}
              aria-label="开始日期"
            />
            <span className="text-xs text-muted-foreground">至</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPage(1);
              }}
              className={`${inputCls} w-40`}
              aria-label="结束日期"
            />
            <select
              value={projectFilter}
              onChange={(e) => {
                setProjectFilter(e.target.value);
                setPage(1);
              }}
              className={`w-48 ${inputCls}`}
              aria-label="项目筛选"
            >
              <option value="">全部项目</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.project_name ?? p.id}
                </option>
              ))}
            </select>
            <select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setPage(1);
              }}
              className={`w-28 ${inputCls}`}
              aria-label="类型筛选"
            >
              <option value="">全部类型</option>
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={String(o.value)}>
                  {o.label}
                </option>
              ))}
            </select>
            <Button size="sm" variant="outline" onClick={resetFilters}>
              清除筛选
            </Button>
            <span className="ml-auto text-xs text-muted-foreground">
              共 {total} 条 · 合计{" "}
              {rows.reduce((s, r) => s + Number(r.hours ?? 0), 0).toFixed(1)}h（当前页）
            </span>
          </div>

          <Table<WorkHour>
            rowKey="id"
            columns={columns}
            dataSource={rows}
            loading={loading}
            size="small"
            scroll={{ x: "max-content" }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              pageSizeOptions: PAGE_SIZE_OPTIONS,
              showTotal: (t) => `共 ${t} 条`,
              onChange: (p, s) => {
                setPage(p);
                setPageSize(s);
              },
            }}
            locale={{ emptyText: "暂无工时记录" }}
          />
        </>
      )}

      {drawer.open && (
        <WorkHourDrawer
          state={drawer}
          projects={projects}
          currentUserId={currentUser?.id ?? ""}
          onClose={() => setDrawer({ open: false, mode: "create" })}
          onSubmit={handleSave}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="w-96 rounded-md border bg-background p-5 shadow-lg">
            <h3 className="text-sm font-semibold">确认删除工时记录？</h3>
            <p className="mt-2 text-xs text-muted-foreground">
              将删除 {fmtDay(confirmDelete.work_date)} 的工时记录,该操作不可恢复。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDelete(null)}
              >
                取消
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void handleDelete()}
              >
                确认删除
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WorkHourDrawer({
  state,
  projects,
  currentUserId,
  onClose,
  onSubmit,
}: {
  state: DrawerState;
  projects: ProjectSimpleItem[];
  currentUserId: string;
  onClose: () => void;
  onSubmit: (_body: WorkHourCreate | WorkHourUpdate) => Promise<void>;
}) {
  const editing = state.item;
  const [workDate, setWorkDate] = useState(
    editing?.work_date ? editing.work_date.slice(0, 10) : today(),
  );
  const [projectId, setProjectId] = useState(editing?.project_id ?? "");
  const [hours, setHours] = useState(
    editing ? String(editing.hours) : "",
  );
  const [type, setType] = useState(editing?.type ?? 0);
  const [description, setDescription] = useState(editing?.description ?? "");
  const [userId, setUserId] = useState(editing?.user_id ?? currentUserId);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!projectId) {
      setErr("请选择项目");
      return;
    }
    const h = Number(hours);
    if (Number.isNaN(h) || h <= 0) {
      setErr("请填写有效的工时数值");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const body: WorkHourCreate | WorkHourUpdate = {
        project_id: projectId,
        work_date: workDate,
        hours: h,
        type,
        description: description || null,
        user_id: userId,
      };
      await onSubmit(body);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-[460px] rounded-md border bg-background p-5 shadow-lg">
        <h3 className="text-sm font-semibold">
          {state.mode === "create" ? "录入工时" : "编辑工时"}
        </h3>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-muted-foreground">日期 *</label>
            <input
              type="date"
              value={workDate}
              onChange={(e) => setWorkDate(e.target.value)}
              className={`mt-0.5 ${inputCls}`}
            />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">工时(h) *</label>
            <input
              type="number"
              min={0}
              step={0.5}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className={`mt-0.5 ${inputCls}`}
            />
          </div>
          <div className="col-span-2">
            <label className="text-[11px] text-muted-foreground">项目 *</label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className={`mt-0.5 ${inputCls}`}
            >
              <option value="">请选择</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.project_name ?? p.id}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">类型</label>
            <select
              value={type}
              onChange={(e) => setType(Number(e.target.value))}
              className={`mt-0.5 ${inputCls}`}
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-[11px] text-muted-foreground">录入人</label>
            <div className="mt-0.5">
              <PpmUserSelect
                res="user"
                value={userId}
                onChange={(v) => setUserId((v as string | null) ?? "")}
                placeholder="请选择录入人"
              />
            </div>
          </div>
          <div className="col-span-2">
            <label className="text-[11px] text-muted-foreground">说明</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="mt-0.5 w-full rounded border border-input bg-background px-2.5 py-1.5 text-sm focus:border-ring focus:outline-none"
            />
          </div>
        </div>
        {err && <p className="mt-2 text-[11px] text-destructive">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void submit()}>
            {busy ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </div>
  );
}

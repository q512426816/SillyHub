"use client";

/**
 * PpmProjectMembersGroupTable — 项目→成员 两级展开表组件。
 *
 * 一级表 = 项目级 antd Table(消费 pageProjectMemberSummary 真分页聚合);
 * 展开行 = 内嵌 <PpmProjectMembersTable projectId embedded onChanged={load} />
 * (复用锁定模式成员子表,embedded 紧凑模式去 vh scroll,G1;onChanged 刷新 member_count)。
 * 页头「+ 添加项目成员」= 跨项目全局新增(复用 MemberFormDrawer,lockedProjectId=undefined
 * 显示项目选择)。
 *
 * 设计依据:.sillyspec/changes/2026-07-15-project-members-rebuild/design.md §7.5;
 * 原型:prototype-project-members-rebuild.html(两级表布局);
 * 决策:D-002(成员展开行懒加载)/D-003/D-006(复用成员表)/D-007(onChanged 刷新 member_count)。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Input, Select, Table, type TableProps, Tag } from "antd";

import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusKind } from "@/components/ui/status-badge";
import { ApiError } from "@/lib/api";
import {
  createProjectMember,
  pageProjectMemberSummary,
} from "@/lib/ppm";
import type {
  ProjectMemberCreate,
  ProjectMemberSummaryItem,
  ProjectMemberSummaryPageReq,
} from "@/lib/ppm";
import {
  MemberFormDrawer,
  PpmProjectMembersTable,
  type MemberForm,
} from "@/components/ppm-project-members-table";

// ── 枚举(对齐 projects 页,不擅自改它;value = DB code 1/2/3) ───────────────
// D-003/D-004:类型 antd Tag 分类色(blue/cyan/default);状态 StatusBadge 语义(statusKind)。
// type: 1=研发 / 2=实施 / 3=运维;status: 1=进行中 / 2=已完成 / 3=已暂停。
const PROJECT_TYPE_OPTIONS: {
  label: string;
  value: string;
  color: "blue" | "cyan" | "default";
}[] = [
  { label: "研发项目", value: "1", color: "blue" },
  { label: "实施项目", value: "2", color: "cyan" },
  { label: "运维项目", value: "3", color: "default" },
];
const PROJECT_STATUS_OPTIONS: {
  label: string;
  value: string;
  statusKind: StatusKind;
}[] = [
  { label: "进行中", value: "1", statusKind: "info" },
  { label: "已完成", value: "2", statusKind: "success" },
  { label: "已暂停", value: "3", statusKind: "warning" },
];

const TYPE_BY_CODE = new Map(PROJECT_TYPE_OPTIONS.map((o) => [o.value, o]));
const STATUS_BY_CODE = new Map(PROJECT_STATUS_OPTIONS.map((o) => [o.value, o]));

// 搜索表单(6 维:项目名/状态/类型/负责人/成员姓名·账号/角色)。
type SearchForm = {
  project_name: string;
  project_status: string;
  project_type: string;
  owner_name: string;
  member_keyword: string;
  role_name: string;
};

const EMPTY_SEARCH: SearchForm = {
  project_name: "",
  project_status: "",
  project_type: "",
  owner_name: "",
  member_keyword: "",
  role_name: "",
};

// ── 组件 ──────────────────────────────────────────────────────────────────

export function PpmProjectMembersGroupTable() {
  const [rows, setRows] = useState<ProjectMemberSummaryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState<SearchForm>(EMPTY_SEARCH);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // 展开行 keys(受控,翻页时清空,接受重置——G6 默认行为可接受)。
  const [expandedRowKeys, setExpandedRowKeys] = useState<React.Key[]>([]);
  // 全局新增抽屉。
  const [globalAddOpen, setGlobalAddOpen] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const showToast = useCallback((ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: ProjectMemberSummaryPageReq = { page, page_size: pageSize };
      // 仅带非空搜索条件。
      if (search.project_name) params.project_name = search.project_name;
      if (search.project_status) params.project_status = search.project_status;
      if (search.project_type) params.project_type = search.project_type;
      if (search.owner_name) params.owner_name = search.owner_name;
      if (search.member_keyword)
        params.member_keyword = search.member_keyword;
      if (search.role_name) params.role_name = search.role_name;
      const resp = await pageProjectMemberSummary(params);
      setRows(resp.items);
      setTotal(resp.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search]);

  useEffect(() => {
    void load();
  }, [load]);

  // 全局跨项目新增提交(D-007:成功后 load 刷新 member_count)。
  const handleGlobalSubmit = useCallback(
    async (form: MemberForm) => {
      setGlobalError(null);
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
      setGlobalAddOpen(false);
      showToast(true, `成员 ${created.user_name || created.user_id} 已创建`);
      await load();
    },
    [load, showToast],
  );

  const onSearch = () => {
    setPage(1);
    setExpandedRowKeys([]);
    void load();
  };
  const onReset = () => {
    setSearch(EMPTY_SEARCH);
    setPage(1);
    setExpandedRowKeys([]);
  };

  // ── 一级表列 ──
  const columns: TableProps<ProjectMemberSummaryItem>["columns"] = useMemo(
    () => [
      {
        title: "项目名称",
        dataIndex: "project_name",
        key: "project_name",
        render: (v: unknown, row) => {
          const name = v ? String(v) : "";
          if (name) return name;
          // None 兜底:项目编号 → id。
          const fallback = row.project_code || row.id;
          return (
            <span className="text-xs text-muted-foreground">{fallback}</span>
          );
        },
      },
      { title: "项目编号", dataIndex: "project_code", key: "project_code" },
      {
        title: "负责人",
        dataIndex: "owner_name",
        key: "owner_name",
        render: (v: unknown) =>
          v ? (
            String(v)
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        title: "成员数",
        dataIndex: "member_count",
        key: "member_count",
        width: 90,
        align: "center" as const,
      },
      {
        title: "项目状态",
        dataIndex: "project_status",
        key: "project_status",
        width: 110,
        render: (v: unknown) => {
          const opt = STATUS_BY_CODE.get(String(v ?? ""));
          if (!opt) {
            return <span className="text-xs text-muted-foreground">—</span>;
          }
          return <StatusBadge kind={opt.statusKind}>{opt.label}</StatusBadge>;
        },
      },
      {
        title: "项目类型",
        dataIndex: "project_type",
        key: "project_type",
        width: 110,
        render: (v: unknown) => {
          const opt = TYPE_BY_CODE.get(String(v ?? ""));
          if (!opt) {
            return <span className="text-xs text-muted-foreground">—</span>;
          }
          return <Tag color={opt.color}>{opt.label}</Tag>;
        },
      },
      {
        title: "更新时间",
        dataIndex: "updated_at",
        key: "updated_at",
        width: 170,
        render: (v: unknown) => (v ? String(v).slice(0, 19) : "—"),
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-3">
      {/* 顶部:全局跨项目新增 */}
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" onClick={() => setGlobalAddOpen(true)}>
          + 添加项目成员
        </Button>
      </div>

      {/* 搜索区(6 维) */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="text-[11px] text-muted-foreground">项目名称</label>
          <Input
            size="small"
            allowClear
            value={search.project_name}
            onChange={(e) =>
              setSearch((s) => ({ ...s, project_name: e.target.value }))
            }
            placeholder="项目名称"
          />
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground">项目状态</label>
          <Select
            size="small"
            allowClear
            className="w-full"
            value={search.project_status || undefined}
            onChange={(v) =>
              setSearch((s) => ({
                ...s,
                project_status: v ?? "",
              }))
            }
            placeholder="项目状态"
            options={PROJECT_STATUS_OPTIONS.map((o) => ({
              label: o.label,
              value: o.value,
            }))}
          />
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground">项目类型</label>
          <Select
            size="small"
            allowClear
            className="w-full"
            value={search.project_type || undefined}
            onChange={(v) =>
              setSearch((s) => ({ ...s, project_type: v ?? "" }))
            }
            placeholder="项目类型"
            options={PROJECT_TYPE_OPTIONS.map((o) => ({
              label: o.label,
              value: o.value,
            }))}
          />
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground">负责人</label>
          <Input
            size="small"
            allowClear
            value={search.owner_name}
            onChange={(e) =>
              setSearch((s) => ({ ...s, owner_name: e.target.value }))
            }
            placeholder="负责人"
          />
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground">
            成员姓名 / 账号
          </label>
          <Input
            size="small"
            allowClear
            value={search.member_keyword}
            onChange={(e) =>
              setSearch((s) => ({ ...s, member_keyword: e.target.value }))
            }
            placeholder="成员姓名 / 账号"
          />
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground">角色</label>
          <Input
            size="small"
            allowClear
            value={search.role_name}
            onChange={(e) =>
              setSearch((s) => ({ ...s, role_name: e.target.value }))
            }
            placeholder="承担角色"
          />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onReset}>
          重置
        </Button>
        <Button size="sm" onClick={onSearch}>
          查询
        </Button>
      </div>

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
        <Table<ProjectMemberSummaryItem>
          rowKey={(row) => row.id}
          columns={columns}
          dataSource={rows}
          loading={loading}
          size="small"
          bordered
          scroll={{ x: "max-content" }}
          expandable={{
            expandedRowKeys,
            onExpandedRowsChange: (keys) =>
              setExpandedRowKeys([...keys]),
            // 展开行懒加载成员子表:embedded 紧凑模式(G1),onChanged=load 刷新 member_count。
            expandedRowRender: (record) => (
              <PpmProjectMembersTable
                projectId={record.id}
                embedded
                onChanged={() => void load()}
              />
            ),
          }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (t) => `共 ${t} 个项目`,
            onChange: (p, s) => {
              setPage(p);
              setPageSize(s);
              setExpandedRowKeys([]);
            },
          }}
          locale={{ emptyText: "暂无项目" }}
        />
      )}

      {/* 全局跨项目新增:lockedProjectId=undefined → 显示项目选择 */}
      {globalAddOpen && (
        <MemberFormDrawer
          mode="create"
          lockedProjectId={undefined}
          canWrite
          onClose={() => setGlobalAddOpen(false)}
          onSubmit={async (form) => {
            try {
              await handleGlobalSubmit(form);
            } catch (err) {
              setGlobalError(
                err instanceof ApiError ? err.message : "保存失败",
              );
            }
          }}
        />
      )}

      {globalError && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {globalError}
        </div>
      )}
    </div>
  );
}

export default PpmProjectMembersGroupTable;

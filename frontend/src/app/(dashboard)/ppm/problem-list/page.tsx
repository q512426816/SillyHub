"use client";

/**
 * 问题清单 (ProblemList) 列表页 — 对齐源 dept_project_front problemlist/index.vue。
 *
 * 6 态表单分发(对照源 6 个 .vue):
 *  - status=1 已保存:creator → 编辑(ListForm)/ 删除 / 提交审核
 *  - status=2 审核中:now_handle_user → 审核(ListAuditForm)
 *  - status=3 处置中:duty_user → 开始(ListStartForm)/ 完成处置(ListDoneForm)/ 变更
 *  - status=6 待验证:audit_user → 验证关闭(ListCloseForm)
 *  - status=4/5 终态
 *  - 任意:详情(ListDetailForm)
 *
 * 列表字段 + 操作按钮显隐规则逐条对齐源 index.vue 操作列 v-if。
 *
 * 设计依据:.sillyspec/changes/2026-06-21-ppm-frontend-alignment/design.md §7
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Table, type TableProps, Tag } from "antd";

import { matchAnyUser } from "@/components/ppm-status-actions";
import {
  PROBLEM_STATUS_COLOR,
  PROBLEM_STATUS_TEXT,
  PROBLEM_TYPE_TEXT,
} from "@/components/ppm-status-actions";
import { ApiError } from "@/lib/api";
import { deleteProblem, listProblems } from "@/lib/ppm";
import type { ProblemList } from "@/lib/ppm";
import { useSession } from "@/stores/session";
import { ProblemDrawer, type ProblemDrawerMode } from "./_problem-drawer";

export default function ProblemListPage() {
  const { user: currentUser } = useSession();
  const currentUserId = currentUser?.id ?? "";

  const [items, setItems] = useState<ProblemList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 搜索栏(对照源 queryParams,本仓后端未全支持复杂过滤,仅做关键字本地过滤)
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([
    "1",
    "2",
    "3",
    "6",
  ]);

  const [drawer, setDrawer] = useState<{
    open: boolean;
    mode: ProblemDrawerMode;
    problem?: ProblemList;
  }>({ open: false, mode: "create" });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listProblems({ page: 1, page_size: 100 }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return items.filter((p) => {
      if (statusFilter.length > 0 && !statusFilter.includes(p.status)) {
        return false;
      }
      if (!kw) return true;
      const hay = [
        p.project_name,
        p.model_name,
        p.pro_desc,
        p.func_name,
        p.duty_user_name,
        p.find_by,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(kw);
    });
  }, [items, keyword, statusFilter]);

  const openDrawer = (
    mode: ProblemDrawerMode,
    problem?: ProblemList,
  ) => {
    setDrawer({ open: true, mode, problem });
  };

  const handleDelete = async (p: ProblemList) => {
    if (p.status !== "1") return;
    if (!confirm("删除该问题清单?")) return;
    try {
      await deleteProblem(p.id);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "删除失败");
    }
  };

  const columns: TableProps<ProblemList>["columns"] = [
    {
      title: "责任人",
      dataIndex: "duty_user_name",
      key: "duty_user_name",
      width: 100,
      fixed: "left",
      render: (v: string | null, p: ProblemList) =>
        v ?? (p.duty_user_id ? p.duty_user_id : "待指派"),
    },
    {
      title: "项目",
      dataIndex: "project_name",
      key: "project_name",
      width: 150,
      render: (v: string | null, p: ProblemList) => v ?? p.project_id ?? "—",
    },
    {
      title: "模块名称",
      dataIndex: "model_name",
      key: "model_name",
      width: 120,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "问题描述",
      dataIndex: "pro_desc",
      key: "pro_desc",
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "功能名称",
      dataIndex: "func_name",
      key: "func_name",
      width: 120,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "问题类型",
      dataIndex: "pro_type",
      key: "pro_type",
      width: 100,
      render: (v: string | null) =>
        v ? (
          <Tag>{PROBLEM_TYPE_TEXT[v] ?? v}</Tag>
        ) : (
          <span style={{ color: "rgba(0,0,0,0.45)" }}>—</span>
        ),
    },
    {
      title: "紧急",
      dataIndex: "is_urgent",
      key: "is_urgent",
      width: 70,
      render: (v: string | null) =>
        v === "1" || v === "是" ? <Tag color="red">急</Tag> : "否",
    },
    {
      title: "发现人",
      dataIndex: "find_by",
      key: "find_by",
      width: 100,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "发现日期",
      dataIndex: "find_time",
      key: "find_time",
      width: 120,
      render: (v: string | null) =>
        v ? v.slice(0, 10) : <span style={{ color: "rgba(0,0,0,0.45)" }}>—</span>,
    },
    {
      title: "工作量(人/天)",
      dataIndex: "work_load",
      key: "work_load",
      width: 130,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "计划起止",
      key: "plan",
      width: 200,
      render: (_v: unknown, p: ProblemList) =>
        `${p.plan_start_time?.slice(0, 10) ?? "?"} ~ ${p.plan_end_time?.slice(0, 10) ?? "?"}`,
    },
    {
      title: "当前处理人",
      dataIndex: "now_handle_user_name",
      key: "now_handle_user_name",
      width: 120,
      render: (v: string | null, p: ProblemList) =>
        v ?? (p.now_handle_user ? p.now_handle_user : "待指派"),
    },
    {
      title: "状态",
      key: "status",
      width: 100,
      fixed: "right",
      render: (_v: unknown, p: ProblemList) => {
        const display = p.effective_status === "7" ? "7" : p.status;
        return (
          <Tag color={PROBLEM_STATUS_COLOR[display] ?? "default"}>
            {PROBLEM_STATUS_TEXT[display] ?? display}
          </Tag>
        );
      },
    },
    {
      title: "操作",
      key: "actions",
      align: "right",
      width: 280,
      fixed: "right",
      render: (_v: unknown, p: ProblemList) => {
        const isNowHandler = matchAnyUser(
          [p.now_handle_user],
          currentUserId,
        );
        const isCreator = matchAnyUser(
          [(p as ProblemList & { creator_id?: string }).creator_id],
          currentUserId,
        );
        const isDuty = matchAnyUser([p.duty_user_id], currentUserId);
        const isAuditor = matchAnyUser([p.audit_user_id], currentUserId);
        return (
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 4 }}>
            {/* 审核:status=2 + now_handle_user(源 openAuditForm) */}
            {p.status === "2" && isNowHandler && (
              <Button size="small" type="primary" onClick={() => openDrawer("audit", p)}>
                审核
              </Button>
            )}
            {/* 变更:status=3 + creator/duty(源 openChangeForm) */}
            {p.status === "3" && (isCreator || isDuty) && (
              <Button size="small" onClick={() => openDrawer("edit", p)}>
                变更
              </Button>
            )}
            {/* 编辑:status=1 + creator(源 openForm update) */}
            {p.status === "1" && isCreator && (
              <Button size="small" type="primary" onClick={() => openDrawer("edit", p)}>
                编辑
              </Button>
            )}
            {/* 开始处置:status=3 + duty(源 startTask) */}
            {p.status === "3" && isDuty && !p.handle_info && (
              <Button
                size="small"
                onClick={() => openDrawer("start", p)}
              >
                开始
              </Button>
            )}
            {/* 完成处置:status=3 + duty(源 doneTask) */}
            {p.status === "3" && isDuty && !!p.handle_info && (
              <Button
                size="small"
                type="primary"
                onClick={() => openDrawer("done", p)}
              >
                处置
              </Button>
            )}
            {/* 验证关闭:status=6 + audit_user(源 closeTask) */}
            {p.status === "6" && isAuditor && (
              <Button size="small" type="primary" onClick={() => openDrawer("close", p)}>
                验证并关闭
              </Button>
            )}
            {/* 详情:任意(源 openDetailForm) */}
            <Button size="small" onClick={() => openDrawer("detail", p)}>
              详情
            </Button>
            {/* 删除:status=1 + creator(源 handleDelete) */}
            {p.status === "1" && isCreator && (
              <Button size="small" danger onClick={() => void handleDelete(p)}>
                删除
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-6 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="mt-0.5">问题清单</h1>
          <p className="text-xs text-muted-foreground">
            问题审批流:已保存→审核中→处置中→待验证→已关闭;bug 跳过部门经理
          </p>
        </div>
        <Button type="primary" onClick={() => openDrawer("create")}>
          + 新建问题
        </Button>
      </header>

      {/* 搜索栏(对照源 index.vue queryParams) */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
        }}
      >
        <input
          className="h-8 min-w-[200px] rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none"
          placeholder="项目/模块/描述/功能/责任人/发现人"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <select
          className="h-8 rounded border border-input bg-background px-2 text-sm"
          multiple={false}
          value={statusFilter.length === 1 ? statusFilter[0] : ""}
          onChange={(e) => {
            const v = e.target.value;
            setStatusFilter(v ? [v] : []);
          }}
        >
          <option value="">全部状态</option>
          {(["1", "2", "3", "6", "4", "5", "7"] as const).map((s) => (
            <option key={s} value={s}>
              {PROBLEM_STATUS_TEXT[s] ?? s}
            </option>
          ))}
        </select>
        <Button onClick={() => setKeyword("")}>
          重置
        </Button>
      </div>

      {error ? (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {error}
          <Button
            size="small"
            className="ml-3"
            onClick={() => void load()}
          >
            重新加载
          </Button>
        </div>
      ) : (
        <Table<ProblemList>
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          loading={loading}
          size="small"
          scroll={{ x: "max-content" }}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          locale={{ emptyText: "暂无问题" }}
        />
      )}

      <ProblemDrawer
        open={drawer.open}
        mode={drawer.mode}
        problem={drawer.problem}
        onClose={() => setDrawer({ open: false, mode: "create" })}
        onSaved={() => {
          setDrawer({ open: false, mode: "create" });
          void load();
        }}
      />
    </div>
  );
}

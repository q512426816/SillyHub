"use client";

/**
 * 问题变更 (ProblemChange) 列表页。
 *
 * 问题变更状态 (简化,不走完整 4 节点):
 * - status=1 审核中
 * - status=2 已完成(变更生效,源问题清单标记变更中解除)
 * - status=3 已作废
 *
 * 操作(对齐源 problemchange/index.vue):
 * - status=1:编辑(ChangeForm update)/ 审核(ChangeAuditForm)/ 删除
 * - status=2/3:详情(ChangeDetailForm)
 *
 * 设计依据:.sillyspec/changes/2026-06-21-ppm-frontend-alignment/design.md §7
 */
import { useCallback, useEffect, useState } from "react";
import { Button, Drawer, Table, type TableProps, Tag } from "antd";

import { PROBLEM_CHANGE_STATUS_TEXT } from "@/components/ppm-status-actions";
import { ApiError } from "@/lib/api";
import {
  deleteProblemChange,
  listProblemChanges,
  type ProblemChange,
} from "@/lib/ppm";
import {
  ChangeAuditForm,
  ChangeDetailForm,
  ChangeEditForm,
} from "./_forms";

const STATUS_COLOR: Record<string, string> = {
  "1": "processing",
  "2": "success",
  "3": "default",
};

type DrawerMode =
  | { kind: "edit"; change: ProblemChange }
  | { kind: "detail"; change: ProblemChange }
  | { kind: "audit"; change: ProblemChange };

export default function ProblemChangesPage() {
  const [items, setItems] = useState<ProblemChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerMode | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listProblemChanges({ page: 1, page_size: 100 }));
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

  const handleDelete = async (c: ProblemChange) => {
    if (c.status !== "1") {
      showToast(false, "仅审核中状态可删除");
      return;
    }
    if (!confirm("删除该问题变更?")) return;
    try {
      await deleteProblemChange(c.id);
      showToast(true, "已删除");
      await load();
    } catch (err) {
      showToast(false, err instanceof ApiError ? err.message : "删除失败");
    }
  };

  const columns: TableProps<ProblemChange>["columns"] = [
    {
      title: "源问题",
      dataIndex: "resource_id",
      key: "resource_id",
      render: (v: string, c: ProblemChange) => (
        <div className="text-xs">
          <div className="font-mono">{v}</div>
          <div className="text-muted-foreground">{c.project_name ?? "—"}</div>
        </div>
      ),
    },
    {
      title: "变更内容",
      dataIndex: "pro_desc",
      key: "pro_desc",
      render: (v: string | null) => (
        <span className="line-clamp-2 max-w-md">{v ?? "—"}</span>
      ),
    },
    {
      title: "变更原因",
      dataIndex: "change_reason",
      key: "change_reason",
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "责任人",
      dataIndex: "duty_user_name",
      key: "duty_user_name",
      render: (v: string | null, c: ProblemChange) =>
        v ?? (c.duty_user_id ? c.duty_user_id : "待指派"),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      render: (v: string) => (
        <Tag color={STATUS_COLOR[v] ?? "default"}>
          {PROBLEM_CHANGE_STATUS_TEXT[v] ?? v}
        </Tag>
      ),
    },
    {
      title: "操作",
      key: "actions",
      align: "right",
      render: (_v: unknown, c: ProblemChange) => (
        <div className="flex justify-end gap-1">
          <Button
            size="small"
            onClick={() => setDrawer({ kind: "detail", change: c })}
          >
            详情
          </Button>
          {c.status === "1" && (
            <>
              <Button
                size="small"
                onClick={() => setDrawer({ kind: "edit", change: c })}
              >
                编辑
              </Button>
              <Button
                size="small"
                type="primary"
                onClick={() => setDrawer({ kind: "audit", change: c })}
              >
                审核
              </Button>
              <Button
                size="small"
                danger
                onClick={() => void handleDelete(c)}
              >
                删除
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="mt-0.5">问题变更</h1>
          <p className="text-xs text-muted-foreground">
            问题清单的变更申请:审核中 → 已完成 / 已作废
          </p>
        </div>
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
            size="small"
            className="ml-3"
            onClick={() => void load()}
          >
            重新加载
          </Button>
        </div>
      ) : (
        <Table<ProblemChange>
          rowKey="id"
          columns={columns}
          dataSource={items}
          loading={loading}
          size="small"
          pagination={false}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: "暂无问题变更" }}
        />
      )}

      <Drawer
        open={drawer !== null}
        title={
          drawer ? DRAWER_TITLE[drawer.kind] : ""
        }
        width={720}
        onClose={() => setDrawer(null)}
        destroyOnClose
        maskClosable={false}
      >
        {drawer?.kind === "edit" && (
          <ChangeEditForm
            change={drawer.change}
            onSuccess={() => {
              setDrawer(null);
              void load();
            }}
            onCancel={() => setDrawer(null)}
          />
        )}
        {drawer?.kind === "detail" && (
          <ChangeDetailForm
            change={drawer.change}
            onCancel={() => setDrawer(null)}
          />
        )}
        {drawer?.kind === "audit" && (
          <ChangeAuditForm
            changeId={drawer.change.id}
            onSuccess={() => {
              setDrawer(null);
              void load();
            }}
            onCancel={() => setDrawer(null)}
          />
        )}
      </Drawer>
    </div>
  );
}

const DRAWER_TITLE: Record<DrawerMode["kind"], string> = {
  edit: "编辑问题变更",
  detail: "问题变更详情",
  audit: "审核问题变更",
};

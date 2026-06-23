"use client";

/**
 * 问题变更 (ProblemChange) 列表页 — 对齐 project-plans 风格。
 *
 * 状态:
 *  - status=1 审核中
 *  - status=2 已完成
 *  - status=3 已作废
 *
 * 操作:
 *  - status=1 + now_handle_user 归属:审核 / 删除
 *  - 任意:详情
 *
 * 后端 GET /problem-change 仅分页(无筛选 Query),本页拉 200 条做本地过滤
 * + 客户端分页展示。查询条件变化回到第 1 页,关键字按 Enter/搜索按钮提交。
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  DatePicker,
  Drawer,
  Input,
  Select,
  Table,
  type TableProps,
  Tag,
} from "antd";
import type { Dayjs } from "dayjs";

import { Button } from "@/components/ui/button";
import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
import {
  matchAnyUser,
  PROBLEM_CHANGE_STATUS_TEXT,
} from "@/components/ppm-status-actions";
import { ApiError } from "@/lib/api";
import {
  deleteProblemChange,
  exportProblemChanges,
  listProblemChanges,
  type ProblemChange,
} from "@/lib/ppm";
import { useSession } from "@/stores/session";
import { ChangeAuditForm, ChangeDetailForm } from "./_forms";

const { RangePicker } = DatePicker;

const STATUS_COLOR: Record<string, string> = {
  "1": "processing",
  "2": "success",
  "3": "default",
};

const STATUS_OPTIONS = [
  { label: PROBLEM_CHANGE_STATUS_TEXT["1"] ?? "审核中", value: "1" },
  { label: PROBLEM_CHANGE_STATUS_TEXT["2"] ?? "已完成", value: "2" },
  { label: PROBLEM_CHANGE_STATUS_TEXT["3"] ?? "已作废", value: "3" },
];

type DrawerMode =
  | { kind: "detail"; change: ProblemChange }
  | { kind: "audit"; change: ProblemChange };

const DRAWER_TITLE: Record<DrawerMode["kind"], string> = {
  detail: "问题变更详情",
  audit: "审核问题变更",
};

export default function ProblemChangesPage() {
  const { user: currentUser } = useSession();
  const currentUserId = currentUser?.id ?? "";

  const [items, setItems] = useState<ProblemChange[]>([]);
  const [total, setTotal] = useState(0);
  const [current, setCurrent] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerMode | null>(null);
  const [exporting, setExporting] = useState(false);

  // 搜索栏:keywordInput 仅受控显示,回车/搜索按钮才同步到 keyword 触发查询
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(
    null,
  );
  // 搜索触发计数器:点搜索/回车就 +1,即使 keyword 没变也强制 useEffect 触发查询
  const [searchNonce, setSearchNonce] = useState(0);

  const load = useCallback(
    async (opts: { page?: number; page_size?: number } = {}) => {
      const page = opts.page ?? current;
      const page_size = opts.page_size ?? pageSize;
      setLoading(true);
      setError(null);
      try {
        const resp = await listProblemChanges({
          page,
          page_size,
          keyword: keyword || undefined,
          status: statusFilter.length > 0 ? statusFilter : undefined,
          created_at_start: dateRange?.[0]?.startOf("day")?.toISOString(),
          created_at_end: dateRange?.[1]?.endOf("day")?.toISOString(),
        });
        setItems(resp.items);
        setTotal(resp.total);
        setCurrent(page);
        setPageSize(page_size);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "加载失败");
      } finally {
        setLoading(false);
      }
    },
    [
      current,
      pageSize,
      keyword,
      statusFilter,
      dateRange,
    ],
  );

  // 首屏 + 过滤条件变化 + 搜索按钮点击 → 回到第 1 页重拉。
  // keywordInput 不触发(只在 commit 时改 keyword + bump searchNonce)。
  // searchNonce 兜底:keyword 未变(如条件没动直接点搜索)也能强制触发查询。
  useEffect(() => {
    void load({ page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, statusFilter, dateRange, searchNonce]);

  const commitKeyword = () => {
    setKeyword(keywordInput);
    setSearchNonce((n) => n + 1);
  };

  const resetFilters = () => {
    setKeywordInput("");
    setKeyword("");
    setStatusFilter([]);
    setDateRange(null);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportProblemChanges();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async (c: ProblemChange) => {
    if (c.status !== "1") return;
    if (!confirm("删除该问题变更?")) return;
    try {
      await deleteProblemChange(c.id);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "删除失败");
    }
  };

  const columns: TableProps<ProblemChange>["columns"] = [
    {
      title: "源问题",
      dataIndex: "resource_id",
      key: "resource_id",
      width: 200,
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
      width: 200,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "责任人",
      dataIndex: "duty_user_name",
      key: "duty_user_name",
      width: 120,
      render: (v: string | null, c: ProblemChange) =>
        v ?? (c.duty_user_id ? c.duty_user_id : "待指派"),
    },
    {
      title: "当前处理人",
      dataIndex: "now_handle_user_name",
      key: "now_handle_user_name",
      width: 120,
      render: (v: string | null, c: ProblemChange) =>
        v ?? (c.now_handle_user ? c.now_handle_user : "—"),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      fixed: "right",
      render: (v: string) => (
        <Tag color={STATUS_COLOR[v] ?? "default"}>
          {PROBLEM_CHANGE_STATUS_TEXT[v] ?? v}
        </Tag>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: "max-content",
      fixed: "right",
      render: (_v: unknown, c: ProblemChange) => {
        const isHandler = matchAnyUser([c.now_handle_user], currentUserId);
        return (
          <div className="flex whitespace-nowrap gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDrawer({ kind: "detail", change: c })}
            >
              详情
            </Button>
            {c.status === "1" && (
              <>
                <Button
                  size="sm"
                  disabled={!isHandler}
                  title={isHandler ? undefined : "仅当前处理人可审核"}
                  onClick={() => setDrawer({ kind: "audit", change: c })}
                >
                  审核
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={!isHandler}
                  title={isHandler ? undefined : "仅当前处理人可删除"}
                  onClick={() => void handleDelete(c)}
                >
                  删除
                </Button>
              </>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <PageContainer size="full">
      <PageHeader
        title="问题变更"
        subtitle="问题清单的变更申请:审核中 → 已完成 / 已作废"
      />

      <SectionCard bodyPadding="p-2">
        {/* 顶部按钮行:右对齐(搜索 | 重置 | 分隔 | 导出) */}
        <div className="mb-2 flex items-center justify-end gap-2">
          <Button size="sm" onClick={commitKeyword}>
            搜索
          </Button>
          <Button size="sm" variant="outline" onClick={resetFilters}>
            重置
          </Button>
          <span className="mx-1 h-6 w-px bg-border" aria-hidden />
          <Button
            size="sm"
            variant="outline"
            disabled={exporting}
            onClick={() => void handleExport()}
          >
            {exporting ? "导出中…" : "导出"}
          </Button>
        </div>

        {/* 查询条件:垂直 grid-cols-4 */}
        <div className="grid w-full grid-cols-4 gap-3">
          <Field label="关键字">
            <Input
              allowClear
              placeholder="项目/模块/变更内容/原因(回车查询)"
              value={keywordInput}
              onChange={(e) => {
                const v = e.target.value;
                setKeywordInput(v);
                if (!v) setKeyword("");
              }}
              onPressEnter={commitKeyword}
            />
          </Field>
          <Field label="状态">
            <Select<string[]>
              mode="multiple"
              allowClear
              className="w-full"
              placeholder="状态(可多选)"
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v as string[]);
                setSearchNonce((n) => n + 1);
              }}
              options={STATUS_OPTIONS}
            />
          </Field>
          <Field label="创建时间">
            <RangePicker
              className="w-full"
              value={dateRange as [Dayjs, Dayjs] | null}
              onChange={(v) =>
                setDateRange(v as [Dayjs | null, Dayjs | null] | null)
              }
              placeholder={["创建开始", "创建结束"]}
            />
          </Field>
          <div className="self-end text-right text-xs text-muted-foreground">
            共 {total} 条
          </div>
        </div>
      </SectionCard>

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
        <Table<ProblemChange>
          rowKey="id"
          columns={columns}
          dataSource={items}
          loading={loading}
          size="small"
          bordered
          scroll={{ x: "max-content", y: "calc(100vh - 430px)" }}
          pagination={{
            current,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: ["10", "20", "50", "100"],
            showTotal: (t: number) => `共 ${t} 条`,
            onChange: (page: number, size: number) => void load({ page, page_size: size }),
          }}
          locale={{ emptyText: "暂无问题变更" }}
        />
      )}

      <Drawer
        open={drawer !== null}
        title={drawer ? DRAWER_TITLE[drawer.kind] : ""}
        width={720}
        onClose={() => setDrawer(null)}
        destroyOnClose
        maskClosable={false}
      >
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
    </PageContainer>
  );
}

/**
 * 查询条件外壳:垂直布局(标题在上,控件在下),对齐 project-plans 风格。
 */
function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex w-full flex-col gap-1">
      <span className="text-xs leading-4 text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

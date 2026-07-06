"use client";

/**
 * task-20 / D-006@v1：daemon filesystem-policy 审计页 UI。
 *
 * 依据文档:
 *   - .sillyspec/changes/2026-07-02-daemon-filesystem-policy/tasks/task-20.md
 *   - design.md §7.3（GET policy-audit 端点）+ §7.4（AuditLogRead 字段）
 *   - prototype-policy-audit.html（线框布局：统计概览 + 筛选 + 列表 + 分页）
 *
 * 布局对齐 prototype-policy-audit.html：
 *   - 统计概览（ALLOW/DENY 计数 + 涉及 Agent 种类 + 最新一条距今）
 *   - 筛选区（decision/provider/tool/path/时间范围）
 *   - 记录列表（Antd Table，DENY 红 / ALLOW 绿 Tag）
 *   - 分页（limit/offset，共 N 条 · 第 X 页）
 *
 * ── workspaceId 来源（设计偏差，需明确记录）─────────────────────────────────
 * 后端 GET /api/daemon/workspaces/{wid}/runtimes/{rid}/policy-audit 路径段强制
 * 要求 workspace_id（UUID）。但 daemon runtime 跨 workspace（DaemonRuntimeRead
 * 无 workspace_id 字段，design §8「不改 DaemonRuntime」），audit 日志的
 * workspace_id 是 daemon 上报时 best-effort 填充（design §7.4 可空）。
 *
 * task-21 入口（runtimes/page.tsx 的「审计日志」按钮）固定跳转
 * /runtimes/{id}/audit，不带 wid。本页从 URL ?wid=<workspace_id> 取 workspace
 * 来源：
 *   - 有 wid → 正常调 usePolicyAudit(ws, rt, params) 取数
 *   - 无 wid → enabled=false，展示缺失提示（DENY 拦截越界写入本应可见，但路由
 *     设计要求 wid，缺则不可用）。建议后续 task 在后端新增
 *     GET /daemon/runtimes/{rid}/policy-audit（无 wid 别名，service.query 已
 *     支持 workspace_id=None 不过滤）。
 *
 * 此偏差在 task-20 allowed_paths 内无法通过改后端路由解决，故前端守卫 + 提示。
 */
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  Button,
  DatePicker,
  Form,
  Input,
  Select,
  Table,
  Tag,
  type TableProps,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";

import { ApiError } from "@/lib/api";
import {
  usePolicyAuditByRuntime,
  type AuditDecision,
  type AuditLogRead,
  type FetchPolicyAuditParams,
} from "@/lib/daemon-audit";

const PAGE_SIZE = 50;

/** 筛选表单值（受控）：Antd Form 字段名对齐 backend Query 参数名。 */
interface FilterFormValues {
  decision?: AuditDecision | "" ;
  provider?: string;
  tool?: string;
  path?: string;
  range?: [Dayjs, Dayjs];
}

/** ISO 时间格式化（展示列）：YYYY-MM-DD HH:mm:ss 本地时间。 */
function fmtLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 相对时间（最新一条距今），对齐 prototype「~15s」文案。 */
function fmtRelative(iso: string | null): string {
  if (!iso) return "无记录";
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "—";
  const diff = Date.now() - ts;
  if (diff < 30_000) return "刚刚";
  if (diff < 60_000) return `${Math.floor(diff / 1000)} 秒前`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

export default function AuditPage() {
  const params = useParams<{ id: string }>();
  const runtimeId = params.id;
  const [form] = Form.useForm<FilterFormValues>();
  // 已提交的筛选值（Form 只在点「查询」时同步到这里，触发 hook 重取）。
  const [applied, setApplied] = useState<FilterFormValues>({});
  const [page, setPage] = useState(0);

  const hookParams = useMemo<FetchPolicyAuditParams>(() => {
    const p: FetchPolicyAuditParams = {
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    };
    if (applied.decision) p.decision = applied.decision;
    if (applied.provider && applied.provider.trim()) p.provider = applied.provider.trim();
    if (applied.tool && applied.tool.trim()) p.tool = applied.tool.trim();
    if (applied.path && applied.path.trim()) p.path = applied.path.trim();
    if (applied.range && applied.range.length === 2) {
      p.since = applied.range[0].toISOString();
      p.until = applied.range[1].toISOString();
    }
    return p;
  }, [applied, page]);

  // wid 缺失 → enabled=false，不发请求（避免 422）。见文件顶部设计偏差。
  const { items, total, isLoading, isError, error, refetch } = usePolicyAuditByRuntime(
    runtimeId,
    hookParams,
    { enabled: !!runtimeId },
  );

  // 统计概览：基于当前结果集做客户端聚合（无独立聚合端点）。
  const stats = useMemo(() => {
    const allow = items.filter((it) => it.decision === "ALLOW").length;
    const deny = items.filter((it) => it.decision === "DENY").length;
    const providers = new Set(items.map((it) => it.provider).filter(Boolean));
    const latestIso = items
      .map((it) => it.created_at)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
    return { allow, deny, providers: providers.size, latest: latestIso ?? null };
  }, [items]);

  const columns: TableProps<AuditLogRead>["columns"] = [
    {
      title: "时间",
      dataIndex: "created_at",
      key: "created_at",
      width: 180,
      render: (v: string) => (
        <span className="font-mono text-xs text-muted-foreground">{fmtLocal(v)}</span>
      ),
    },
    {
      title: "决策",
      dataIndex: "decision",
      key: "decision",
      width: 90,
      // 中文回显：ALLOW→放行 / DENY→拒绝（保留红绿 Tag 区分，对齐 CLAUDE.md 中文优先约定）。
      render: (v: string) => (
        <Tag color={v === "DENY" ? "error" : "success"}>
          {v === "DENY" ? "拒绝" : "放行"}
        </Tag>
      ),
    },
    {
      title: "Agent",
      dataIndex: "provider",
      key: "provider",
      width: 110,
      render: (v: string) => <span className="text-xs">{v || "—"}</span>,
    },
    {
      title: "Tool",
      dataIndex: "tool",
      key: "tool",
      width: 120,
      render: (v: string) => <span className="font-mono text-xs">{v || "—"}</span>,
    },
    {
      title: "目标路径",
      dataIndex: "path",
      key: "path",
      render: (v: string) => (
        <span className="break-all font-mono text-xs text-foreground">{v}</span>
      ),
    },
    {
      title: "原因 / 拒绝理由",
      dataIndex: "reason",
      key: "reason",
      // reason 字段 DENY 时为 daemon buildDenyReason 产出的多行中文长文
      // （含 Agent / 目标路径 / 原因），需 whitespace-pre-line 才能按 \n 正常换行；
      // ALLOW 时为空串 → 显示「—」。
      render: (v: string) => (
        <span
          className={
            v
              ? "whitespace-pre-line break-words text-xs text-destructive"
              : "text-xs text-muted-foreground"
          }
        >
          {v || "—"}
        </span>
      ),
    },
  ];

  const handleFinish = (values: FilterFormValues) => {
    setPage(0);
    setApplied(values);
  };

  const handleReset = () => {
    form.resetFields();
    setPage(0);
    setApplied({});
  };

  // 总页数（limit 至少为 1 防除零）
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-5 px-6 py-6">
      <header className="min-w-0">
        <p className="text-[11px] font-semibold uppercase text-muted-foreground">
          守护进程运行时
        </p>
        <h1 className="mt-1">策略审计日志</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          查看该运行时的文件系统写决策记录（ALLOW 放行 / DENY 拒绝越界写入）。
        </p>
      </header>

      {/* 统计概览（对齐 prototype-policy-audit.html 顶部 stats 区） */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="放行 ALLOW" value={String(stats.allow)} tone="allow" />
        <StatCard label="拒绝 DENY" value={String(stats.deny)} tone="deny" />
        <StatCard label="涉及 Agent 种类" value={String(stats.providers)} tone="neutral" />
        <StatCard label="最新一条距今" value={fmtRelative(stats.latest)} tone="neutral" />
      </section>


      {isError && (
        <div className="flex items-start gap-2 rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          <span>{error instanceof ApiError ? error.message : "加载审计记录失败"}</span>
        </div>
      )}

      {/* 筛选区（Antd Form，对齐 prototype filter-row） */}
      <section className="rounded-md border bg-card p-4">
        <Form
          form={form}
          layout="vertical"
          onFinish={handleFinish}
          onReset={handleReset}
        >
          <div className="flex flex-wrap items-end gap-3">
            <Form.Item label="决策" name="decision" className="mb-0 w-[150px]">
              <Select
                allowClear
                placeholder="全部"
                options={[
                  { value: "ALLOW", label: "ALLOW 放行" },
                  { value: "DENY", label: "DENY 拒绝" },
                ]}
              />
            </Form.Item>
            <Form.Item label="Agent 种类" name="provider" className="mb-0 w-[150px]">
              <Input allowClear placeholder="如 claude" />
            </Form.Item>
            <Form.Item label="Tool" name="tool" className="mb-0 w-[150px]">
              <Input allowClear placeholder="如 Write" />
            </Form.Item>
            <Form.Item label="路径包含" name="path" className="mb-0 w-[200px]">
              <Input allowClear placeholder="如 E:\\Temp" />
            </Form.Item>
            <Form.Item label="时间范围" name="range" className="mb-0 flex-1 min-w-[280px]">
              <DatePicker.RangePicker showTime style={{ width: "100%" }} />
            </Form.Item>
            <div className="flex gap-2">
              <Button type="primary" htmlType="submit">
                查询
              </Button>
              <Button htmlType="reset">重置</Button>
              <Button onClick={() => void refetch()}>刷新</Button>
            </div>
          </div>
        </Form>
      </section>

      {/* 记录列表（Antd Table） */}
      <section className="rounded-md border bg-card p-4">
        <Table<AuditLogRead>
          rowKey="id"
          columns={columns}
          dataSource={items}
          loading={isLoading}
          pagination={false}
          size="small"
          scroll={{ x: 900 }}
          locale={{ emptyText: "暂无审计记录" }}
        />
        {/* 分页器（对齐 prototype：共 N 条 · 第 X / Y 页） */}
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            共 {total} 条 · 第 {page + 1} / {totalPages} 页
          </span>
          <div className="flex items-center gap-1.5">
            <Button size="small" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              上一页
            </Button>
            <Button
              size="small"
              disabled={(page + 1) * PAGE_SIZE >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}

/** 统计小卡片（对齐 prototype stats .stat.allow/.deny/.neutral 配色）。 */
function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "allow" | "deny" | "neutral";
}) {
  const toneCls = {
    allow: "border-emerald-200 bg-emerald-50 text-emerald-700",
    deny: "border-rose-200 bg-rose-50 text-rose-700",
    neutral: "border-slate-200 bg-white text-slate-700",
  }[tone];
  return (
    <div className={`flex min-h-[88px] flex-col justify-center rounded-md border px-4 py-3 ${toneCls}`}>
      <p className="text-2xl font-semibold leading-none">{value}</p>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

// 显式引入 dayjs 仅供类型推断占位（Form/DatePicker 已自带实例），避免 tree-shake 误删。
void dayjs;

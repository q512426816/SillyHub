"use client";

/**
 * 服务器信息页 /admin/server-status（2026-10-14-admin-server-status task-02）。
 *
 * 恢复 2026-07-24 死代码清理删除的服务器运行状态看板（原首页 ServerStatusCard +
 * HealthCard），落位系统管理组（D-005@v1 方案 A，用户亲选）。
 *
 * 设计依据：
 * - requirements FR-02 / D-002@v2（用户亲选内容口径）——三组卡片：
 *   ①服务器性能（CPU/内存/磁盘 antd Progress，阈值着色 <80 主题默认 /
 *     80–90 warning / ≥90 exception，色阶走 antd status 语义零手写 hex）
 *   ②业务统计（任务/项目/里程碑/用户四格）
 *   ③依赖与版本（/api/health 的 PostgreSQL/Redis 连接徽标 + 版本/环境/服务器时间）
 * - 5s 轮询自动刷新（useEffect setInterval，卸载 clearInterval）+ 立即刷新按钮；
 * - 失败降级（FR-02）：403/网络/超时渲染 Alert 错误条（§9 语义语义），保留既有
 *   数据不清空、5s 后自动重试；401 由全局拦截跳登录（frontend/src/lib/api.ts:250-256），
 *   非页内承接面；
 * - 样式遵守 FRONTEND_PAGE_STYLE.md §1 骨架（PageContainer/PageHeader/SectionCard）
 *   + §0.5 多主题铁律（antd 色经 status 语义/ConfigProvider token，tailwind 布局）；
 * - 原型：.sillyspec/changes/2026-10-14-admin-server-status/prototype-admin-server-status.html。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Progress, theme } from "antd";
import { ReloadOutlined } from "@ant-design/icons";

import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
import {
  getHealth,
  getSystemStatus,
  type HealthResponse,
  type SystemStatusResponse,
} from "@/lib/health";

const REFRESH_INTERVAL_MS = 5000;

function formatClock(d: Date): string {
  return d.toLocaleTimeString("zh-CN", { hour12: false });
}

/* ---------- 性能行 ---------- */

function PerfRow({
  label,
  percent,
  detail,
}: {
  label: string;
  percent: number;
  detail: string;
}) {
  const { token } = theme.useToken();
  // 阈值着色：<80 主题 primary 默认；80–90 琥珀（warning token，运行时主题值
  // 非硬编码 hex——antd Progress 无 warning status，经 useToken 取语义色）；
  // ≥90 exception（antd 内置红）。
  const status = percent >= 90 ? ("exception" as const) : ("normal" as const);
  const strokeColor =
    percent < 90 && percent >= 80 ? token.colorWarning : undefined;
  return (
    <div className="mb-4 last:mb-0">
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {detail} · <span className="font-semibold text-foreground">{percent}%</span>
        </span>
      </div>
      <Progress
        percent={percent}
        showInfo={false}
        status={status}
        strokeColor={strokeColor}
        size="small"
      />
    </div>
  );
}

/* ---------- 统计格 ---------- */

function StatCell({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-lg border bg-gradient-to-b from-brand-50 to-transparent p-3 text-center">
      <div className="text-2xl font-bold tabular-nums text-brand-700">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

/* ---------- 依赖/元信息行 ---------- */

function KvRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b py-2 text-xs last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{children}</span>
    </div>
  );
}

function DepBadge({ ok, okText, downText }: { ok: boolean; okText: string; downText: string }) {
  return <Badge status={ok ? "success" : "error"} text={ok ? okText : downText} />;
}

/* ---------- 页面 ---------- */

export default function ServerStatusPage() {
  const [status, setStatus] = useState<SystemStatusResponse | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [nextStatus, nextHealth] = await Promise.all([
        getSystemStatus(),
        getHealth(),
      ]);
      setStatus(nextStatus);
      setHealth(nextHealth);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      // 403/网络/超时降级：保留既有数据仅提示，下一轮自动重试；
      // 401 由全局拦截处理（单飞刷新或跳登录），不落入本分支语义。
      setError(err instanceof Error ? err.message : "服务器状态获取失败");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    timerRef.current = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [refresh]);

  return (
    <PageContainer>
      <PageHeader
        title="服务器信息"
        subtitle="服务器性能、业务统计与依赖状态，每 5 秒自动刷新"
        actions={
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {lastUpdated ? `上次更新 ${formatClock(lastUpdated)}` : "加载中…"}
            </span>
            <Button
              size="small"
              icon={<ReloadOutlined spin={refreshing} />}
              onClick={() => void refresh()}
              disabled={refreshing}
            >
              立即刷新
            </Button>
          </div>
        }
      />

      {error && (
        <Alert
          type="error"
          showIcon
          title="服务器状态获取失败"
          description={`${error}——将自动重试；若持续失败请检查「服务器状态查看」权限分配。`}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="服务器性能">
          {status ? (
            <div className="pt-1">
              <PerfRow
                label="CPU 使用率"
                percent={Math.round(status.cpu_percent)}
                detail=""
              />
              <PerfRow
                label="内存"
                percent={Math.round(status.memory_percent)}
                detail={`${status.memory_used_mb} MB / ${status.memory_total_mb} MB`}
              />
              <PerfRow
                label="磁盘（/）"
                percent={Math.round(status.disk_percent)}
                detail={`${status.disk_used_gb} GB / ${status.disk_total_gb} GB`}
              />
            </div>
          ) : (
            <p className="py-8 text-center text-xs text-muted-foreground">
              {error ? "暂无性能数据" : "加载中…"}
            </p>
          )}
        </SectionCard>

        <SectionCard title="业务统计">
          {status ? (
            <div className="grid grid-cols-4 gap-2.5">
              <StatCell value={status.tasks} label="任务" />
              <StatCell value={status.projects} label="项目" />
              <StatCell value={status.milestones} label="里程碑" />
              <StatCell value={status.users} label="用户" />
            </div>
          ) : (
            <p className="py-8 text-center text-xs text-muted-foreground">
              {error ? "暂无统计数据" : "加载中…"}
            </p>
          )}
        </SectionCard>

        <SectionCard title="依赖与版本" className="lg:col-span-2">
          {health ? (
            <div>
              <KvRow label="PostgreSQL">
                <DepBadge
                  ok={health.db === "ok"}
                  okText={`已连接 · v${health.version}`}
                  downText="未连接"
                />
              </KvRow>
              <KvRow label="Redis">
                <DepBadge
                  ok={health.redis === "ok"}
                  okText="已连接"
                  downText="未连接"
                />
              </KvRow>
              <KvRow label="后端版本">
                {health.version}（{health.commit_sha.slice(0, 7)}）
              </KvRow>
              <KvRow label="运行环境">{health.environment}</KvRow>
              <KvRow label="服务器时间（UTC）">
                {status?.server_time ?? "—"}
              </KvRow>
            </div>
          ) : (
            <p className="py-8 text-center text-xs text-muted-foreground">
              {error ? "暂无依赖信息" : "加载中…"}
            </p>
          )}
        </SectionCard>
      </div>
    </PageContainer>
  );
}

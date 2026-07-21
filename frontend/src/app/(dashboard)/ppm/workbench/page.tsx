"use client";

/**
 * 个人工作台页面 (task-08 / FR-01 / D-001@v1)。
 *
 * 三栏聚合当前登录人数据:
 *  - 左栏: ProfileSummaryCard(个人信息) + TodoListPanel(我的待办) + MessagePlaceholder
 *  - 中栏: PersonalMetricStrip(本月指标, 固定 month) + WorkbenchTaskTable(我的任务, 自包含 fetch+筛选 ql-005)
 *  - 右栏: WorkCalendarPanel(工作日历) + QuickEntryGrid(快捷入口)
 *
 * 数据装配: 沿用 apiFetch + useEffect; 四块数据(profile/summary/calendar) 各独立 try/catch + loading/error。
 * 任务表自包含 (WorkbenchTaskTable 内部 fetch + 筛选 toolbar), 不再由 page 装配 tasks (ql-005)。
 * 指标固定「本月」(range 切换【本周/本月/全部】已移至任务查询区, ql-005)。
 *
 * /ppm 默认落地仍 redirect /ppm/projects, 本文件不涉及该 redirect。
 */
import { useCallback, useEffect, useState } from "react";
import dayjs from "dayjs";

import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
import { ApiError } from "@/lib/api";
import {
  fetchWorkbenchCalendar,
  fetchWorkbenchProfile,
  fetchWorkbenchSummary,
} from "@/lib/ppm/workbench";
import type {
  WorkbenchCalendar,
  WorkbenchProfile,
  WorkbenchSummary,
} from "@/lib/ppm/types";

import { MessagePlaceholder } from "./_components/message-placeholder";
import { PersonalMetricStrip, type MetricRange } from "./_components/personal-metric-strip";
import { ProfileSummaryCard } from "./_components/profile-summary-card";
import { QuickEntryGrid } from "./_components/quick-entry-grid";
import { TodoListPanel } from "./_components/todo-list-panel";
import { WorkCalendarPanel } from "./_components/work-calendar-panel";
import { WorkbenchTaskTable } from "./_components/workbench-task-table";

/** 单区块加载状态: 独立 loading/error + 数据。各栏互不影响(design §9)。 */
interface BlockState<T> {
  loading: boolean;
  error: string | null;
  data: T | null;
}

function initialBlock<T>(): BlockState<T> {
  return { loading: true, error: null, data: null };
}

export default function WorkbenchPage() {
  const [profile, setProfile] = useState<BlockState<WorkbenchProfile>>(
    initialBlock(),
  );
  const [summary, setSummary] = useState<BlockState<WorkbenchSummary>>(
    initialBlock(),
  );
  // 指标统计范围(默认本月,ql-20260721-002):本周/本月/全部,切换重载 summary。
  const [summaryRange, setSummaryRange] = useState<MetricRange>("month");
  const [calendar, setCalendar] = useState<BlockState<WorkbenchCalendar>>(
    initialBlock(),
  );
  // 工作日历当前月份(可切换,默认当月)。
  const [calendarMonth, setCalendarMonth] = useState<string>(() =>
    dayjs().format("YYYY-MM"),
  );

  const loadProfile = useCallback(async () => {
    setProfile((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchWorkbenchProfile();
      setProfile({ loading: false, error: null, data });
    } catch (err) {
      setProfile({
        loading: false,
        error: err instanceof ApiError ? err.message : "加载个人信息失败",
        data: null,
      });
    }
  }, []);

  // 指标范围切换(ql-20260720-004):range 变更重载 summary
  const loadSummary = useCallback(async () => {
    setSummary((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchWorkbenchSummary(summaryRange);
      setSummary({ loading: false, error: null, data });
    } catch (err) {
      setSummary({
        loading: false,
        error: err instanceof ApiError ? err.message : "加载指标失败",
        data: null,
      });
    }
  }, [summaryRange]);

  const loadCalendar = useCallback(async () => {
    setCalendar((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchWorkbenchCalendar(calendarMonth);
      setCalendar({ loading: false, error: null, data });
    } catch (err) {
      setCalendar({
        loading: false,
        error: err instanceof ApiError ? err.message : "加载日历失败",
        data: null,
      });
    }
  }, [calendarMonth]);

  const handleCalendarMonthChange = useCallback((month: string) => {
    setCalendarMonth(month);
  }, []);

  // 首屏: profile + summary(任务表自包含, 不在此装配)
  useEffect(() => {
    void loadProfile();
    void loadSummary();
  }, [loadProfile, loadSummary]);

  // 日历跟随 calendarMonth
  useEffect(() => {
    void loadCalendar();
  }, [loadCalendar]);

  return (
    <PageContainer size="full">
      <PageHeader title="个人工作台" subtitle="我的任务 / 本月指标 / 工作日历" />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-10">
        {/* ========== 左栏 stack ========== */}
        <div className="flex flex-col gap-5 lg:col-span-2">
          {profile.loading || profile.error ? (
            <BlockCard
              title="个人信息"
              loading={profile.loading}
              error={profile.error}
              onRetry={loadProfile}
            />
          ) : (
            <ProfileSummaryCard profile={profile.data} />
          )}

          {summary.loading || summary.error ? (
            <BlockCard
              title="我的待办"
              loading={summary.loading}
              error={summary.error}
              onRetry={loadSummary}
            />
          ) : (
            <TodoListPanel todos={summary.data?.todos ?? null} />
          )}

          <MessagePlaceholder />
        </div>

        {/* ========== 中栏 stack ========== */}
        <div className="flex flex-col gap-5 lg:col-span-6">
          {summary.loading || summary.error ? (
            <BlockCard
              title="本月指标"
              loading={summary.loading}
              error={summary.error}
              onRetry={loadSummary}
            />
          ) : (
            <PersonalMetricStrip
              metrics={summary.data?.metrics ?? null}
              range={summaryRange}
              onRangeChange={setSummaryRange}
            />
          )}

          {/* 我的任务: 自包含 fetch + 筛选(ql-005); 执行后回调刷 summary */}
          <SectionCard title="我的任务" bodyPadding="p-4">
            <WorkbenchTaskTable onChanged={() => void loadSummary()} />
          </SectionCard>
        </div>

        {/* ========== 右栏 stack ========== */}
        <div className="flex flex-col gap-5 lg:col-span-2">
          {calendar.data ? (
            <WorkCalendarPanel
              calendar={calendar.data}
              loading={calendar.loading}
              month={calendarMonth}
              onMonthChange={handleCalendarMonthChange}
            />
          ) : (
            <BlockCard
              title="工作日历"
              loading={calendar.loading}
              error={calendar.error}
              onRetry={loadCalendar}
            />
          )}

          <QuickEntryGrid />
        </div>
      </div>
    </PageContainer>
  );
}

/**
 * 区块兜底卡片: loading/error 态用骨架/错误条替代真实组件(design §9)。
 */
function BlockCard({
  title,
  loading,
  error,
  onRetry,
}: {
  title: string;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <SectionCard title={title} bodyPadding="p-4">
      {loading ? (
        <div className="text-xs text-muted-foreground animate-pulse">
          加载中…
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-xs text-destructive">{error}</span>
          <button
            type="button"
            onClick={() => void onRetry()}
            className="text-xs text-blue-600 hover:underline"
          >
            重新加载
          </button>
        </div>
      )}
    </SectionCard>
  );
}

"use client";

/**
 * 个人工作台页面 (task-08 / FR-01~02 / D-001~005)。
 *
 * 三栏聚合(目标)用户数据:
 *  - 左栏: ProfileSummaryCard(个人信息 + 切换用户) + TodoListPanel(我的待办, 自带分页) + MessagePlaceholder
 *  - 中栏: PersonalMetricStrip(本月指标) + WorkbenchTaskTable(我的任务, 自包含 fetch+筛选)
 *  - 右栏: WorkCalendarPanel(工作日历) + QuickEntryGrid(快捷入口)
 *
 * 切换用户(FR-02): 经理 ‖ super_admin(profile.can_view_others)可在个人信息卡切换
 * 查看他人工作台。targetUserId(null=我自己)透传给 profile/summary/calendar/todos/
 * 任务表全部 fetch;查看他人时顶部提示条 + [返回我自己]。切换后整页以目标用户返回
 * (用户强调硬约束:工作台内查询接口均按 target 取数)。
 *
 * 数据装配: apiFetch + useEffect; profile/summary/calendar 各独立 try/catch + loading/error。
 */
import { useCallback, useEffect, useState } from "react";
import dayjs from "dayjs";

import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
import { ApiError } from "@/lib/api";
import {
  fetchWorkbenchCalendar,
  fetchWorkbenchProfile,
  fetchWorkbenchSummary,
  fetchWorkbenchSwitchableUsers,
} from "@/lib/ppm/workbench";
import type {
  WorkbenchCalendar,
  WorkbenchProfile,
  WorkbenchSummary,
  WorkbenchSwitchableUser,
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

  // 切换用户(FR-02):null=我自己;否则为目标用户 id。
  const [targetUserId, setTargetUserId] = useState<string | null>(null);
  // 可切换用户列表(登录人可见集;非经理/非超管为空)。
  const [switchableUsers, setSwitchableUsers] = useState<WorkbenchSwitchableUser[]>(
    [],
  );

  const loadProfile = useCallback(async () => {
    setProfile((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchWorkbenchProfile(targetUserId);
      setProfile({ loading: false, error: null, data });
    } catch (err) {
      setProfile({
        loading: false,
        error: err instanceof ApiError ? err.message : "加载个人信息失败",
        data: null,
      });
    }
  }, [targetUserId]);

  // 指标范围切换(ql-20260720-004):range 变更重载 summary
  const loadSummary = useCallback(async () => {
    setSummary((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchWorkbenchSummary(summaryRange, targetUserId);
      setSummary({ loading: false, error: null, data });
    } catch (err) {
      setSummary({
        loading: false,
        error: err instanceof ApiError ? err.message : "加载指标失败",
        data: null,
      });
    }
  }, [summaryRange, targetUserId]);

  const loadCalendar = useCallback(async () => {
    setCalendar((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchWorkbenchCalendar(calendarMonth, targetUserId);
      setCalendar({ loading: false, error: null, data });
    } catch (err) {
      setCalendar({
        loading: false,
        error: err instanceof ApiError ? err.message : "加载日历失败",
        data: null,
      });
    }
  }, [calendarMonth, targetUserId]);

  const handleCalendarMonthChange = useCallback((month: string) => {
    setCalendarMonth(month);
  }, []);

  // 首屏: profile + summary + 可切换用户(任务表/待办自包含)
  useEffect(() => {
    void loadProfile();
    void loadSummary();
  }, [loadProfile, loadSummary]);

  // 日历跟随 calendarMonth / targetUserId
  useEffect(() => {
    void loadCalendar();
  }, [loadCalendar]);

  // 可切换用户列表(一次拉;不随 target 变,仅登录人能力相关)
  useEffect(() => {
    void fetchWorkbenchSwitchableUsers()
      .then(setSwitchableUsers)
      .catch(() => {
        // 忽略: 切换入口缺失不影响工作台
      });
  }, []);

  // can_view_others 始终反映登录人(后端 profile.can_view_others = actor 能力)
  const canViewOthers = profile.data?.can_view_others ?? false;
  const isViewingOther = targetUserId !== null;

  return (
    <PageContainer size="full">
      <PageHeader title="个人工作台" subtitle="我的任务 / 本月指标 / 工作日历" />

      {/* 切换查看他人时提示条 */}
      {isViewingOther ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <span>
            正在查看「{profile.data?.display_name ?? "他人"}」的工作台
          </span>
          <button
            type="button"
            onClick={() => setTargetUserId(null)}
            className="rounded border border-amber-400 bg-white px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
          >
            返回我自己
          </button>
        </div>
      ) : null}

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
            <ProfileSummaryCard
              profile={profile.data}
              canViewOthers={canViewOthers}
              switchableUsers={switchableUsers}
              targetUserId={targetUserId}
              onSwitchUser={setTargetUserId}
            />
          )}

          {/* 我的待办: 自包含 fetch + 分页(默认 10 条/页),跟随 target */}
          <TodoListPanel targetUserId={targetUserId} />

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

          {/* 我的任务: 自包含 fetch + 筛选(ql-005); 执行后回调刷 summary;跟随 target */}
          <SectionCard title="我的任务" bodyPadding="p-4">
            <WorkbenchTaskTable
              targetUserId={targetUserId}
              onChanged={() => void loadSummary()}
            />
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

"use client";

/**
 * 个人工作台页面 (task-08 / FR-01 / D-001@v1)。
 *
 * 三栏聚合当前登录人数据,8 个子组件接入(task-09~11 已实现):
 *  - 左栏:ProfileSummaryCard(个人信息) + TodoListPanel(我的待办) + MessagePlaceholder(消息通知占位)
 *  - 中栏:PersonalMetricStrip(本月指标) + WorkbenchTaskTable(我的任务)
 *  - 右栏:WorkCalendarPanel(本月日历) + QuickEntryGrid(快捷入口) + RuleNotePanel(规则说明)
 *
 * 数据装配:沿用 apiFetch + useEffect(design §3 明确不引入 react-query);
 *          四块数据(profile/summary/calendar/tasks)各独立 try/catch + loading/error,
 *          某一栏失败不阻断其它栏(design §9 回退策略)。
 *
 * 任务表数据走 /api/ppm/personal-task-plan/page(后端按 token 注入的 user_id 过滤当前
 * 登录人,前端 listPersonalPlanTasks 签名为 Omit<PlanTaskPageReq,"user_id">,故无需
 * 再传 user_id);WorkbenchTaskTable 当日完成(execute-plan submit)成功后回调 reloadTasks
 * 重载任务列表(只重载 tasks,不牵动 profile/summary/calendar 三块)。
 *
 * /ppm 默认落地仍 redirect /ppm/projects(D-001@v1:工作台作 /ppm/workbench
 * 独立入口,不抢 /ppm 默认落地),本文件不涉及该 redirect。
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
import { listPersonalPlanTasks } from "@/lib/ppm/task";
import type { PlanTask } from "@/lib/ppm/types";
import type {
  WorkbenchCalendar,
  WorkbenchProfile,
  WorkbenchSummary,
} from "@/lib/ppm/types";

import { MessagePlaceholder } from "./_components/message-placeholder";
import { PersonalMetricStrip } from "./_components/personal-metric-strip";
import { ProfileSummaryCard } from "./_components/profile-summary-card";
import { QuickEntryGrid } from "./_components/quick-entry-grid";
import { RuleNotePanel } from "./_components/rule-note-panel";
import { TodoListPanel } from "./_components/todo-list-panel";
import { WorkCalendarPanel } from "./_components/work-calendar-panel";
import { WorkbenchTaskTable } from "./_components/workbench-task-table";

/** 任务表默认分页大小(原型只看当页,不做翻页器)。 */
const DEFAULT_PAGE_SIZE = 50;

/** 单区块加载状态:独立 loading/error + 数据。各栏互不影响(design §9)。 */
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
  const [calendar, setCalendar] = useState<BlockState<WorkbenchCalendar>>(
    initialBlock(),
  );
  // 任务表:走 personal-task-plan(后端按当前登录人过滤),独立 loading。
  const [tasks, setTasks] = useState<PlanTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState<boolean>(true);

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

  const loadSummary = useCallback(async () => {
    setSummary((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchWorkbenchSummary("month");
      setSummary({ loading: false, error: null, data });
    } catch (err) {
      setSummary({
        loading: false,
        error: err instanceof ApiError ? err.message : "加载指标失败",
        data: null,
      });
    }
  }, []);

  const loadCalendar = useCallback(async () => {
    setCalendar((s) => ({ ...s, loading: true, error: null }));
    try {
      const yearMonth = dayjs().format("YYYY-MM");
      const data = await fetchWorkbenchCalendar(yearMonth);
      setCalendar({ loading: false, error: null, data });
    } catch (err) {
      setCalendar({
        loading: false,
        error: err instanceof ApiError ? err.message : "加载日历失败",
        data: null,
      });
    }
  }, []);

  const loadTasks = useCallback(async () => {
    setTasksLoading(true);
    try {
      // personal-task-plan/page 后端从 token 注入 user_id 过滤,前端无需也不允许传 user_id
      // (listPersonalPlanTasks 签名为 Omit<PlanTaskPageReq,"user_id">)。
      const page = await listPersonalPlanTasks({
        page: 1,
        page_size: DEFAULT_PAGE_SIZE,
      });
      setTasks(page.items ?? []);
    } catch {
      // 任务表失败不阻断其它栏;失败置空表 + 关 loading,WorkbenchTaskTable 渲染空态。
      setTasks([]);
    } finally {
      setTasksLoading(false);
    }
  }, []);

  // 首屏:四块并行装配(各独立 catch,任一失败不阻断其它栏)。
  useEffect(() => {
    void loadProfile();
    void loadSummary();
    void loadCalendar();
    void loadTasks();
  }, [loadProfile, loadSummary, loadCalendar, loadTasks]);

  return (
    <PageContainer size="full">
      <PageHeader
        title="个人工作台"
        subtitle="我的任务 / 本月指标 / 工作日历"
      />

      {/* 三栏:左窄 / 中宽 / 右中 (原型布局,移动端退化为单列) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* ========== 左栏 stack ========== */}
        <div className="flex flex-col gap-4 lg:col-span-3">
          {/* 个人信息卡(profile 独立 loading/error,失败给重试) */}
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

          {/* 我的待办(todos 来自 summary;loading/error 走 BlockCard 兜底,成功交组件渲染) */}
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

          {/* 消息通知占位(D-007@v1:本期不建后端) */}
          <MessagePlaceholder />
        </div>

        {/* ========== 中栏 stack ========== */}
        <div className="flex flex-col gap-4 lg:col-span-6">
          {/* 本月指标(metrics 来自 summary;loading/error 兜底,成功交组件) */}
          {summary.loading || summary.error ? (
            <BlockCard
              title="本月指标"
              loading={summary.loading}
              error={summary.error}
              onRetry={loadSummary}
            />
          ) : (
            <PersonalMetricStrip metrics={summary.data?.metrics ?? null} />
          )}

          {/* 我的任务(personal-task-plan,独立 fetch;操作完成回调 reloadTasks 只重载本表) */}
          <SectionCard title="我的任务" bodyPadding="p-4">
            <WorkbenchTaskTable
              tasks={tasks}
              loading={tasksLoading}
              onChanged={loadTasks}
            />
          </SectionCard>
        </div>

        {/* ========== 右栏 stack ========== */}
        <div className="flex flex-col gap-4 lg:col-span-3">
          {/* 本月日历(calendar 独立 loading/error) */}
          {calendar.loading || calendar.error ? (
            <BlockCard
              title="工作日历"
              loading={calendar.loading}
              error={calendar.error}
              onRetry={loadCalendar}
            />
          ) : (
            <WorkCalendarPanel calendar={calendar.data} />
          )}

          {/* 快捷入口(静态,无数据依赖) */}
          <QuickEntryGrid />

          {/* 规则说明(静态文本) */}
          <RuleNotePanel />
        </div>
      </div>
    </PageContainer>
  );
}

/**
 * 区块兜底卡片:loading/error 态用骨架/错误条替代真实组件(design §9)。
 *
 * 仅在三态切换期(loading 或 error)使用;数据就绪后由父组件直接渲染对应子组件。
 * loading → 骨架文案;error → 错误条 + 重新加载(不阻断其它栏)。
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

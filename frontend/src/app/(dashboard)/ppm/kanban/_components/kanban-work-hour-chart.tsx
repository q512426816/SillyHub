"use client";

/**
 * KanbanWorkHourChart — 矩阵看板的工时联动图。
 *
 * 两态:
 *  - 默认(未选中人员):全员工时柱状图(stat-by-user,按 execute_user_id 聚合)
 *  - 选中某人员:该人员的**项目工时分布**饼图(按 project 维度)
 *
 * 数据策略:
 *  - 全员柱图:statWorkHoursByUser(start/end),key=execute_user_id → username
 *  - 单人饼图:后端 stat-by-project 不支持 user_id 过滤,故在前端把该人员
 *    当前矩阵中的任务(已有 project_id + estimate_hours)按 project 聚合,
 *    作为该人员的"项目工时分布"。这符合"看板上的工时"语义(estimate),
 *    不依赖额外 API。
 *
 * ECharts 组件经 components/charts/ 动态包装(ssr:false)。
 */
import { useEffect, useMemo, useState } from "react";
import { Button, Empty, message, Spin } from "antd";

import { statWorkHoursByUser } from "@/lib/ppm/task";
import type {
  KanbanTaskCard,
  KanbanUserColumn,
  ProjectSimpleItem,
  WorkHourStatResponse,
} from "@/lib/ppm/types";
import {
  WorkHourBarChart,
  WorkHourPieChart,
} from "@/components/charts";
import type { BarRow } from "@/lib/ppm/aggregations";

export interface KanbanWorkHourChartProps {
  /** 日期范围(YYYY-MM-DD)。 */
  startDate: string;
  endDate: string;
  /** 全员人员列表(供柱图显示 username + 查找选中人员姓名)。 */
  users: KanbanUserColumn[];
  /** 项目列表(供单人饼图显示 project_name)。 */
  projects: ProjectSimpleItem[];
  /** 当前矩阵里的任务(供单人饼图按 project 聚合 estimate_hours)。 */
  tasks: KanbanTaskCard[];
  /** 外部受控的选中人员 ID。null=显示全员柱图。 */
  selectedUserId: string | null;
  onClearSelect?: () => void;
}

export function KanbanWorkHourChart({
  startDate,
  endDate,
  users,
  projects,
  tasks,
  selectedUserId,
  onClearSelect,
}: KanbanWorkHourChartProps) {
  const [byUser, setByUser] = useState<WorkHourStatResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // 全员工时(by-user),范围变化时拉
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    statWorkHoursByUser({ start_date: startDate, end_date: endDate })
      .then((r) => {
        if (!cancelled) setByUser(r);
      })
      .catch((err) => {
        if (!cancelled) {
          setByUser(null);
          message.error(
            err instanceof Error ? err.message : "加载工时统计失败",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate]);

  const userNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users) m.set(u.user_id, u.username ?? u.user_id);
    return m;
  }, [users]);

  const projectNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) m.set(p.id, p.project_name ?? p.id);
    return m;
  }, [projects]);

  // 柱图行:全员 by-user
  const barRows: BarRow[] = useMemo(() => {
    if (!byUser) return [];
    return byUser.items
      .map((it) => ({
        name: userNameById.get(it.key) ?? it.key,
        total_hours: it.total_hours,
      }))
      .sort((a, b) => b.total_hours - a.total_hours);
  }, [byUser, userNameById]);

  // 饼图行:选中人员的任务按 project 聚合 estimate_hours
  const { pieRows, pieTotal } = useMemo(() => {
    if (!selectedUserId) return { pieRows: [] as BarRow[], pieTotal: 0 };
    const m = new Map<string, number>();
    let total = 0;
    for (const t of tasks) {
      if (t.user_id !== selectedUserId) continue;
      if (!t.project_id) continue;
      const hrs = t.estimate_hours ?? 0;
      m.set(t.project_id, (m.get(t.project_id) ?? 0) + hrs);
      total += hrs;
    }
    const rows: BarRow[] = [];
    for (const [pid, hrs] of m) {
      rows.push({
        name: projectNameById.get(pid) ?? pid,
        total_hours: hrs,
      });
    }
    rows.sort((a, b) => b.total_hours - a.total_hours);
    return { pieRows: rows, pieTotal: total };
  }, [selectedUserId, tasks, projectNameById]);

  const selectedName = selectedUserId
    ? (userNameById.get(selectedUserId) ?? selectedUserId)
    : null;

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-background p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">
          {selectedUserId ? (
            <>
              <span className="text-primary">{selectedName}</span>
              <span className="ml-1 text-muted-foreground">
                的项目工时分布
              </span>
            </>
          ) : (
            "全员工时"
          )}
        </span>
        {selectedUserId && onClearSelect && (
          <Button size="small" type="link" onClick={onClearSelect}>
            返回全员
          </Button>
        )}
      </div>

      <div className="flex-1">
        {selectedUserId ? (
          pieRows.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={`${selectedName} 在此区间暂无项目工时`}
            />
          ) : (
            <WorkHourPieChart rows={pieRows} totalHours={pieTotal} height={260} />
          )
        ) : loading ? (
          <div className="flex h-40 items-center justify-center">
            <Spin size="small" />
          </div>
        ) : barRows.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="此区间暂无工时数据"
          />
        ) : (
          <WorkHourBarChart rows={barRows} height={260} />
        )}
      </div>
    </div>
  );
}

export default KanbanWorkHourChart;

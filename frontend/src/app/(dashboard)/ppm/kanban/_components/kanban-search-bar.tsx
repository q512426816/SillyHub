"use client";

/**
 * KanbanSearchBar — 看板查询条件(对齐 project-plans grid-cols-4 Field 风格)。
 *
 * 字段(对应源 searchForm):
 *  - 人员多选(PpmUserSelect res=projectMember)→ store.filters.user_ids
 *  - 状态筛选(未开始/进行中/已完成)→ store.filters.status
 *  - 项目筛选(PpmUserSelect res=project)→ store.filters.project_id
 *  - 关键词输入 → store.filters.keyword
 *  - 顶部按钮:重置
 *
 * 任一筛选变化即 setFilters + 触发 store.fetchUsers/fetchTasks。
 */
import { Button, Input, Select } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";

import { PpmUserSelect } from "@/components/ppm-user-select";
import { useKanbanStore } from "@/stores/kanban";

const STATUS_OPTIONS = [
  { label: "全部", value: "" },
  { label: "未开始", value: "未开始" },
  { label: "进行中", value: "进行中" },
  { label: "已完成", value: "已完成" },
];

/** 查询条件外壳:垂直布局(标题在上,控件在下),对齐 project-plans 风格。 */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex w-full flex-col gap-1">
      <span className="text-xs leading-4 text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export function KanbanSearchBar() {
  const filters = useKanbanStore((s) => s.filters);
  const setFilters = useKanbanStore((s) => s.setFilters);
  const resetFilters = useKanbanStore((s) => s.resetFilters);
  const fetchUsers = useKanbanStore((s) => s.fetchUsers);
  const fetchTasks = useKanbanStore((s) => s.fetchTasks);

  // 任一筛选变化 → 更新 store + 重新拉数据(对齐源 applyFilters + refreshData)
  const applyAndRefresh = async () => {
    await Promise.all([fetchUsers(), fetchTasks()]).catch(() => {});
  };

  const onUsersChange = async (v: string | string[] | null) => {
    setFilters({ user_ids: Array.isArray(v) ? v : v ? [v] : [] });
    await applyAndRefresh();
  };

  const onStatusChange = async (v: string) => {
    setFilters({ status: v || undefined });
    await applyAndRefresh();
  };

  const onProjectChange = async (v: string | string[] | null) => {
    const id = Array.isArray(v) ? v[0] ?? undefined : (v ?? undefined);
    setFilters({ project_id: id });
    await applyAndRefresh();
  };

  const onKeywordChange = (v: string) => setFilters({ keyword: v || undefined });

  const onSearch = async () => {
    await applyAndRefresh();
  };

  const onReset = async () => {
    resetFilters();
    await Promise.all([fetchUsers(), fetchTasks()]).catch(() => {});
  };

  return (
    <div>
      {/* 顶部重置按钮 */}
      <div className="mb-2 flex items-center justify-end gap-2">
        <Button onClick={onReset}>重置</Button>
      </div>

      {/* 查询条件:grid-cols-4 垂直 Field,任一变化即查 */}
      <div className="grid w-full grid-cols-4 gap-3">
        <Field label="人员">
          <PpmUserSelect
            res="projectMember"
            mode="multiple"
            placeholder="筛选人员"
            value={filters.user_ids ?? []}
            onChange={onUsersChange}
            allowClear
            style={{ width: "100%" }}
          />
        </Field>
        <Field label="状态">
          <Select
            className="w-full"
            placeholder="状态"
            value={filters.status ?? ""}
            onChange={onStatusChange}
            options={STATUS_OPTIONS}
            allowClear
          />
        </Field>
        <Field label="所属项目">
          <PpmUserSelect
            res="project"
            placeholder="所属项目"
            value={filters.project_id ?? null}
            onChange={onProjectChange}
            allowClear
            style={{ width: "100%" }}
          />
        </Field>
        <Field label="任务关键词">
          <Input
            className="w-full"
            allowClear
            prefix={<SearchOutlined />}
            placeholder="任务关键词"
            value={filters.keyword ?? ""}
            onChange={(e) => onKeywordChange(e.target.value)}
            onPressEnter={onSearch}
          />
        </Field>
      </div>
    </div>
  );
}

export default KanbanSearchBar;

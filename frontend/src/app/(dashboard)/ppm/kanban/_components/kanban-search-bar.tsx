"use client";

/**
 * KanbanSearchBar — 对齐源 `SearchBar.vue`。
 *
 * 字段(对应源 searchForm):
 *  - 人员多选(PpmUserSelect res=projectMember)→ store.filters.user_ids
 *  - 状态筛选(未开始/进行中/已完成)→ store.filters.status
 *  - 项目筛选(PpmUserSelect res=project)→ store.filters.project_id
 *  - 关键词输入 → store.filters.keyword
 *  - 重置按钮
 *  - 「新建任务」按钮(对齐源 task-kanban 顶部新建入口)
 *
 * 任一筛选变化即 setFilters + 触发 store.fetchUsers/fetchTasks。
 *
 * 注:源用 el-collapse 区分移动端;本仓统一一行 flex-wrap,AntD Select 自带响应式,
 *    移动端会自然换行,够用且简洁。
 */
import { Button, DatePicker, Input, Select } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";

import { PpmUserSelect } from "@/components/ppm-user-select";
import { useKanbanStore } from "@/stores/kanban";

const STATUS_OPTIONS = [
  { label: "全部", value: "" },
  { label: "未开始", value: "未开始" },
  { label: "进行中", value: "进行中" },
  { label: "已完成", value: "已完成" },
];

export function KanbanSearchBar({
  onCreateTask,
}: {
  onCreateTask: () => void;
}) {
  const filters = useKanbanStore((s) => s.filters);
  const setFilters = useKanbanStore((s) => s.setFilters);
  const resetFilters = useKanbanStore((s) => s.resetFilters);
  const fetchUsers = useKanbanStore((s) => s.fetchUsers);
  const fetchTasks = useKanbanStore((s) => s.fetchTasks);

  // 任一筛选变化 → 更新 store + 重新拉数据(对齐源 applyFilters + refreshData)
  // 失败时 store 内已 message.error,这里吞掉避免 unhandled rejection。
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

  // 日期范围筛选 (两重维度之日期维度) — 按 deadline/截止日期过滤
  const dateValue: [Dayjs | null, Dayjs | null] | null = (() => {
    if (!filters.start_date && !filters.end_date) return null;
    return [
      filters.start_date ? dayjs(filters.start_date) : null,
      filters.end_date ? dayjs(filters.end_date) : null,
    ];
  })();

  const onDateChange = async (
    range: [Dayjs | null, Dayjs | null] | null,
  ) => {
    setFilters({
      start_date: range?.[0]?.format("YYYY-MM-DD") ?? undefined,
      end_date: range?.[1]?.format("YYYY-MM-DD") ?? undefined,
    });
    await applyAndRefresh();
  };

  const onSearch = async () => {
    await applyAndRefresh();
  };

  const onReset = async () => {
    resetFilters();
    await Promise.all([fetchUsers(), fetchTasks()]).catch(() => {});
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-background px-4 py-3">
      <div className="w-56">
        <PpmUserSelect
          res="projectMember"
          mode="multiple"
          placeholder="筛选人员"
          value={filters.user_ids ?? []}
          onChange={onUsersChange}
          allowClear
        />
      </div>

      <Select
        className="w-36"
        placeholder="状态"
        value={filters.status ?? ""}
        onChange={onStatusChange}
        options={STATUS_OPTIONS}
        allowClear
      />

      <div className="w-48">
        <PpmUserSelect
          res="project"
          placeholder="所属项目"
          value={filters.project_id ?? null}
          onChange={onProjectChange}
          allowClear
        />
      </div>

      <Input
        className="w-48"
        allowClear
        prefix={<SearchOutlined />}
        placeholder="任务关键词"
        value={filters.keyword ?? ""}
        onChange={(e) => onKeywordChange(e.target.value)}
        onPressEnter={onSearch}
      />

      <DatePicker.RangePicker
        className="w-64"
        allowClear
        placeholder={["截止开始", "截止结束"]}
        value={dateValue ?? undefined}
        onChange={(range) =>
          onDateChange(
            range as [Dayjs | null, Dayjs | null] | null,
          )
        }
      />

      <Button onClick={onReset}>重置</Button>

      <div className="ml-auto">
        <Button type="primary" onClick={onCreateTask}>
          新建任务
        </Button>
      </div>
    </div>
  );
}

export default KanbanSearchBar;

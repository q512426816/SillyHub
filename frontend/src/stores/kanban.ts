/**
 * 看板 Zustand store — 对齐源 dept_project_front `store/modules/ppm.ts`。
 *
 * State:
 *  - users: 人员列 (KanbanUserColumn[])
 *  - tasks: 任务卡片 (KanbanTaskCard[])
 *  - filters: 筛选条件 (user_ids / status / project_id / keyword / group_by_org)
 *  - loading
 *
 * Actions:
 *  - fetchUsers / fetchTasks: 按 filters 拉取(对齐源 store.fetchUsers/fetchTasks)
 *  - assignTask: 跨列拖拽 → assignKanbanTask + 成功后刷新
 *  - reorderTasks: 同列拖拽 → reorderKanbanTasks + 成功后刷新
 *  - createTask / deleteTask: 任务 CRUD + 刷新
 *  - setFilters / resetFilters / reset
 *
 * 注:源 Pinia 的 selectedUserIds 用于顶部人员筛选;本仓用 filters.user_ids
 *    表达同一语义(SearchBar 多选人员 → 过滤可见列)。
 */
import { create } from "zustand";

import {
  assignKanbanTask,
  createKanbanTask,
  deleteKanbanTask,
  listKanbanTasks,
  listKanbanUsers,
  reorderKanbanTasks,
} from "@/lib/ppm/kanban";
import type {
  KanbanQueryReq,
  KanbanTaskAssignReq,
  KanbanTaskCreateReq,
  KanbanTaskReorderReq,
  KanbanUserColumn,
} from "@/lib/ppm/types";
import type { KanbanUsersResult } from "@/lib/ppm/kanban";

/** 看板筛选条件(对齐源 KanbanFilters + selectedUserIds 合并表达)。 */
export interface KanbanFilters {
  user_ids?: string[];
  status?: string;
  project_id?: string;
  keyword?: string;
  group_by_org?: boolean;
}

interface KanbanState {
  users: KanbanUserColumn[];
  tasks: import("@/lib/ppm/types").KanbanTaskCard[];
  filters: KanbanFilters;
  loading: boolean;

  fetchUsers: () => Promise<KanbanUserColumn[]>;
  fetchTasks: () => Promise<import("@/lib/ppm/types").KanbanTaskCard[]>;
  assignTask: (req: KanbanTaskAssignReq) => Promise<void>;
  reorderTasks: (req: KanbanTaskReorderReq) => Promise<void>;
  createTask: (req: KanbanTaskCreateReq) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  setFilters: (partial: Partial<KanbanFilters>) => void;
  resetFilters: () => void;
  reset: () => void;
}

/** 把 KanbanFilters 映射为 API KanbanQueryReq(undefined 字段省略)。 */
function toQuery(f: KanbanFilters): KanbanQueryReq {
  const q: KanbanQueryReq = {};
  if (f.user_ids && f.user_ids.length > 0) q.user_ids = f.user_ids;
  if (f.status) q.status = f.status;
  if (f.project_id) q.project_id = f.project_id;
  if (f.keyword) q.keyword = f.keyword;
  if (f.group_by_org) q.group_by_org = true;
  return q;
}

/** 把 (possibly grouped) usersResp 拍平成 KanbanUserColumn[](store 只存平铺)。 */
function flattenUsers(resp: KanbanUsersResult): KanbanUserColumn[] {
  if (!Array.isArray(resp)) return [];
  if (resp.length === 0) return [];
  // 通过判断首元素是否含 members 字段区分 OrgGroup[] / UserColumn[]
  const first = resp[0] as Partial<{ members: unknown }> & KanbanUserColumn;
  if (first && "members" in first && Array.isArray(first.members)) {
    const groups = resp as unknown as { members: KanbanUserColumn[] }[];
    return groups.flatMap((g) => g.members);
  }
  return resp as KanbanUserColumn[];
}

export const useKanbanStore = create<KanbanState>((set, get) => ({
  users: [],
  tasks: [],
  filters: {},
  loading: false,

  async fetchUsers() {
    set({ loading: true });
    try {
      const resp = await listKanbanUsers(toQuery(get().filters));
      const users = flattenUsers(resp);
      set({ users });
      return users;
    } finally {
      set({ loading: false });
    }
  },

  async fetchTasks() {
    set({ loading: true });
    try {
      const f = get().filters;
      const tasks = await listKanbanTasks({
        user_ids: f.user_ids,
        status: f.status,
        project_id: f.project_id,
        keyword: f.keyword,
      });
      set({ tasks });
      return tasks;
    } finally {
      set({ loading: false });
    }
  },

  async assignTask(req) {
    await assignKanbanTask(req);
    await Promise.all([get().fetchTasks(), get().fetchUsers()]);
  },

  async reorderTasks(req) {
    await reorderKanbanTasks(req);
    await get().fetchTasks();
  },

  async createTask(req) {
    await createKanbanTask(req);
    await Promise.all([get().fetchTasks(), get().fetchUsers()]);
  },

  async deleteTask(taskId) {
    await deleteKanbanTask(taskId);
    await Promise.all([get().fetchTasks(), get().fetchUsers()]);
  },

  setFilters(partial) {
    set((s) => ({ filters: { ...s.filters, ...partial } }));
  },

  resetFilters() {
    set({ filters: {} });
  },

  reset() {
    set({ users: [], tasks: [], filters: {}, loading: false });
  },
}));

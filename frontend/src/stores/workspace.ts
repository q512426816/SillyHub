/**
 * 工作区上下文缓存 store（非 persist）。
 *
 * 设计依据（task-01）：
 *   - design.md §7 接口定义：CurrentWorkspace / WorkspaceStore
 *   - 用户硬约束：URL 是真相源，store 仅叠加缓存；刷新后由
 *     lib/use-workspace-context.ts（task-04）从 URL 重建。
 *   - 避免使用 persist：localStorage 与 URL 派生状态不同步会引发闪烁/不一致。
 *
 * 与 stores/session.ts 的关键差异：本 store 不包装 persist 中间件，
 * 也没有 name / partialize / onRehydrateStorage 配置。
 */
import { create } from "zustand";

/** 当前工作区上下文对象（缓存值，URL 才是真相源）。 */
export interface CurrentWorkspace {
  id: string;
  name: string;
  /** 绑定的 daemon 实例 id；未绑定为 null。 */
  daemon_id: string | null;
  /** daemon 是否在线（聚合数据源由 task-03 workspace-daemon-status 提供）。 */
  daemon_online: boolean;
  /** 工作区根路径；可选。 */
  root_path?: string | null;
}

/** workspace store 的状态与动作签名（design §7）。 */
export interface WorkspaceStore {
  current: CurrentWorkspace | null;
  setCurrent: (_ws: CurrentWorkspace | null) => void;
  clear: () => void;
}

/**
 * useWorkspaceStore — 工作区上下文缓存。
 *
 * 初始 current 为 null；setCurrent 写入/清空；clear 重置为 null。
 * 非 persist：纯内存状态，不读写 localStorage。
 */
export const useWorkspaceStore = create<WorkspaceStore>()((set) => ({
  current: null,
  setCurrent: (ws) => set({ current: ws }),
  clear: () => set({ current: null }),
}));

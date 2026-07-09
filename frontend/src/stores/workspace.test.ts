// tests/stores/workspace.test.ts
// task-01 / FR-01 / D-002：工作区上下文缓存 store 单测。
//
// 依据：
//   - .sillyspec/.../2026-07-09-workspace-prioritization/tasks/task-01.md
//   - design.md §7 接口定义（CurrentWorkspace / WorkspaceStore）
//
// 覆盖：
//   1. 初始 current === null
//   2. setCurrent(ws) 写入完整工作区对象（5 字段）
//   3. setCurrent(null) 清空
//   4. clear() 重置为 null
//   5. setCurrent 仅传部分字段仍能被外部读取（root_path 可选）
//   6. 非 persist：不读取 localStorage（无 hydration，纯内存）

import { describe, it, expect, beforeEach } from "vitest";

// 直接引用 store 模块（不经过 zustand persist 持久化层）
import { useWorkspaceStore, type CurrentWorkspace } from "@/stores/workspace";

// sample 工作区对象，含全部 5 个字段
const SAMPLE: CurrentWorkspace = {
  id: "ws-1",
  name: "demo-workspace",
  daemon_id: "daemon-abc",
  daemon_online: true,
  root_path: "/home/user/demo",
};

// 仅必填字段（root_path 可选）
const MINIMAL: CurrentWorkspace = {
  id: "ws-2",
  name: "minimal",
  daemon_id: null,
  daemon_online: false,
};

describe("task-01: workspace 上下文 store", () => {
  beforeEach(() => {
    // 每个用例前重置，避免跨用例污染（zustand 全局单例）
    useWorkspaceStore.getState().clear();
    // 清空 localStorage，确保 store 不从中读取
    window.localStorage.clear();
  });

  it("初始 current === null", () => {
    expect(useWorkspaceStore.getState().current).toBeNull();
  });

  it("setCurrent 写入完整工作区对象（5 字段）", () => {
    useWorkspaceStore.getState().setCurrent(SAMPLE);
    expect(useWorkspaceStore.getState().current).toEqual(SAMPLE);
    expect(useWorkspaceStore.getState().current?.id).toBe("ws-1");
    expect(useWorkspaceStore.getState().current?.daemon_online).toBe(true);
    expect(useWorkspaceStore.getState().current?.root_path).toBe(
      "/home/user/demo",
    );
  });

  it("setCurrent 支持 root_path 可选（仅必填字段）", () => {
    useWorkspaceStore.getState().setCurrent(MINIMAL);
    expect(useWorkspaceStore.getState().current).toEqual(MINIMAL);
    expect(useWorkspaceStore.getState().current?.root_path).toBeUndefined();
  });

  it("setCurrent(null) 清空 current", () => {
    useWorkspaceStore.getState().setCurrent(SAMPLE);
    useWorkspaceStore.getState().setCurrent(null);
    expect(useWorkspaceStore.getState().current).toBeNull();
  });

  it("clear() 重置 current 为 null", () => {
    useWorkspaceStore.getState().setCurrent(SAMPLE);
    useWorkspaceStore.getState().clear();
    expect(useWorkspaceStore.getState().current).toBeNull();
  });

  it("非 persist：不会把 current 写入 localStorage", () => {
    useWorkspaceStore.getState().setCurrent(SAMPLE);
    // 触发一次状态读取，确保同步执行路径走完
    expect(useWorkspaceStore.getState().current).not.toBeNull();
    // 非 persist store 不应向 localStorage 写任何键
    expect(window.localStorage.length).toBe(0);
  });

  it("非 persist：新模块实例不从 localStorage 恢复（刷新后由 use-workspace-context 重建）", () => {
    // 先写入一个伪造的持久化键，模拟其他 store 残留
    window.localStorage.setItem("multi-agent-platform.workspace", JSON.stringify(SAMPLE));
    // store 初始仍为 null（不读 localStorage）
    expect(useWorkspaceStore.getState().current).toBeNull();
  });

  it("useWorkspaceStore 是 zustand store（含 getState/setState/subscribe）", () => {
    expect(typeof useWorkspaceStore.getState).toBe("function");
    expect(typeof useWorkspaceStore.setState).toBe("function");
    expect(typeof useWorkspaceStore.subscribe).toBe("function");
  });
});

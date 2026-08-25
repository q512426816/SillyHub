/**
 * 悬浮会话壳层 store 动作机单测（task-04 / design §3）。
 *
 * 覆盖：开/最小化/恢复/关闭两分支（无会话全清 vs 有会话保活）/切选中清预会话/
 * startPreSession 携带页面上下文/preSessionCreated 切真会话。R6 边界由类型
 * 与实现保证（store 无会话内部状态字段）。
 */
import { beforeEach, describe, expect, it } from "vitest";

import { useFloatingSessionStore } from "@/stores/floating-session";

describe("useFloatingSessionStore", () => {
  beforeEach(() => {
    useFloatingSessionStore.setState({
      open: false,
      minimized: false,
      sessionId: null,
      preContext: null,
      pageContext: null,
      autoNewPending: false,
    });
  });

  it("openDrawer 展开并清除最小化", () => {
    useFloatingSessionStore.getState().minimize();
    useFloatingSessionStore.getState().openDrawer();
    const s = useFloatingSessionStore.getState();
    expect(s.open).toBe(true);
    expect(s.minimized).toBe(false);
  });

  it("minimize 保留 sessionId（保活语义）", () => {
    useFloatingSessionStore.getState().selectSession("s-1");
    useFloatingSessionStore.getState().minimize();
    const s = useFloatingSessionStore.getState();
    expect(s.open).toBe(false);
    expect(s.minimized).toBe(true);
    expect(s.sessionId).toBe("s-1");
  });

  it("restore 从胶囊恢复展开", () => {
    useFloatingSessionStore.getState().minimize();
    useFloatingSessionStore.getState().restore();
    const s = useFloatingSessionStore.getState();
    expect(s.open).toBe(true);
    expect(s.minimized).toBe(false);
  });

  it("closeDrawer 无会话全清（含预会话与页面上下文）", () => {
    useFloatingSessionStore.getState().startPreSession(
      { runtimeId: "rt-1", workspaceId: null },
      { page_key: "ppm_project", project_id: "p-1" },
    );
    useFloatingSessionStore.getState().closeDrawer();
    const s = useFloatingSessionStore.getState();
    expect(s.open).toBe(false);
    expect(s.minimized).toBe(false);
    expect(s.preContext).toBeNull();
    expect(s.pageContext).toBeNull();
  });

  it("closeDrawer 有会话等同最小化（连接保活）", () => {
    useFloatingSessionStore.getState().selectSession("s-1");
    useFloatingSessionStore.getState().closeDrawer();
    const s = useFloatingSessionStore.getState();
    expect(s.open).toBe(false);
    expect(s.minimized).toBe(true);
    expect(s.sessionId).toBe("s-1");
  });

  it("selectSession 切中清预会话并展开", () => {
    useFloatingSessionStore.getState().startPreSession({
      runtimeId: "rt-1",
      workspaceId: null,
    });
    useFloatingSessionStore.getState().selectSession("s-2");
    const s = useFloatingSessionStore.getState();
    expect(s.sessionId).toBe("s-2");
    expect(s.preContext).toBeNull();
    expect(s.open).toBe(true);
  });

  it("startPreSession 清选中并携带页面上下文", () => {
    useFloatingSessionStore.getState().selectSession("s-old");
    useFloatingSessionStore.getState().startPreSession(
      { runtimeId: "rt-9", workspaceId: "ws-1" },
      { page_key: "ppm_project", project_id: "p-9" },
    );
    const s = useFloatingSessionStore.getState();
    expect(s.sessionId).toBeNull();
    expect(s.preContext).toEqual({ runtimeId: "rt-9", workspaceId: "ws-1" });
    expect(s.pageContext).toEqual({ page_key: "ppm_project", project_id: "p-9" });
    expect(s.open).toBe(true);
  });

  it("preSessionCreated 切真会话并清预会话态", () => {
    useFloatingSessionStore.getState().startPreSession({
      runtimeId: "rt-1",
      workspaceId: null,
    });
    useFloatingSessionStore.getState().preSessionCreated("s-new");
    const s = useFloatingSessionStore.getState();
    expect(s.sessionId).toBe("s-new");
    expect(s.preContext).toBeNull();
    // 页面上下文保留（追问轮不再上送，仅创建轮消费——宿主据此展示来源）。
    expect(s.open).toBe(true);
  });

  it("requestNewSession 挂起自动新建并携带页面上下文", () => {
    useFloatingSessionStore.getState().requestNewSession({
      page_key: "ppm_project",
      project_id: "p-1",
    });
    const s = useFloatingSessionStore.getState();
    expect(s.open).toBe(true);
    expect(s.autoNewPending).toBe(true);
    expect(s.sessionId).toBeNull();
    expect(s.preContext).toBeNull();
    expect(s.pageContext).toEqual({ page_key: "ppm_project", project_id: "p-1" });
  });

  it("closeDrawer 无会话时同时清自动新建挂起位", () => {
    useFloatingSessionStore.getState().requestNewSession({
      page_key: "ppm_project",
      project_id: "p-2",
    });
    useFloatingSessionStore.getState().closeDrawer();
    expect(useFloatingSessionStore.getState().autoNewPending).toBe(false);
  });
});

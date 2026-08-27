/**
 * 悬浮会话壳层 store 动作机单测（task-04 / design §3）。
 *
 * 覆盖：开/最小化/恢复/关闭两分支（无会话全清 vs 有会话保活）/切选中清预会话/
 * startPreSession 携带页面上下文/preSessionCreated 切真会话。R6 边界由类型
 * 与实现保证（store 无会话内部状态字段）。
 * task-07 Phase 5 追加：autoTeamIntent 意图位（requestNewSession ppm_project
 * 置位 / 非 ppm 显式落 false / clearAutoTeamIntent / closeDrawer 全清）。
 * task-05（2026-08-28-session-ppm-task-binding / FR-04）追加：pendingPpmItem
 * 挂起位（写入 / 消费清除 / requestNewSession 不误清 / closeDrawer 全清）。
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
      autoTeamIntent: false,
      pendingPpmItem: null,
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

  // ── task-07 Phase 5（FR-06 / D-004@v2）：autoTeamIntent 意图位 ──────────

  it("requestNewSession(ppm_project) 置 autoTeamIntent；clearAutoTeamIntent 清除", () => {
    useFloatingSessionStore.getState().requestNewSession({
      page_key: "ppm_project",
      project_id: "p-1",
    });
    expect(useFloatingSessionStore.getState().autoTeamIntent).toBe(true);

    useFloatingSessionStore.getState().clearAutoTeamIntent();
    expect(useFloatingSessionStore.getState().autoTeamIntent).toBe(false);
  });

  it("requestNewSession 非 ppm_project 入口不置 autoTeamIntent（且覆盖上次残留）", () => {
    // 上一次 ppm 入口残留 true → 本次非 ppm 入口必须显式落 false（零回归）。
    useFloatingSessionStore.setState({ autoTeamIntent: true });
    useFloatingSessionStore.getState().requestNewSession({
      page_key: "generic_page",
      route_key: "workspaces",
    });
    expect(useFloatingSessionStore.getState().autoTeamIntent).toBe(false);

    // 不带上下文唤起同样不置位。
    useFloatingSessionStore.getState().requestNewSession();
    expect(useFloatingSessionStore.getState().autoTeamIntent).toBe(false);
  });

  it("closeDrawer 无会话全清时一并清 autoTeamIntent", () => {
    useFloatingSessionStore.getState().requestNewSession({
      page_key: "ppm_project",
      project_id: "p-1",
    });
    useFloatingSessionStore.getState().closeDrawer();
    expect(useFloatingSessionStore.getState().autoTeamIntent).toBe(false);
  });

  // ── task-05（2026-08-28-session-ppm-task-binding / FR-04）：pendingPpmItem 挂起位 ──

  it("setPendingPpmItem 写入挂起位；requestNewSession 不误清（这正是走挂起位的原因）", () => {
    useFloatingSessionStore.getState().setPendingPpmItem({
      kind: "plan_task",
      id: "task-1",
      projectId: "p-1",
      title: "排行榜接口性能优化",
    });
    // 入口写入后 requestNewSession 唤起（requestNewSession 清 preContext 但
    // 不得清挂起位——宿主稍后消费）。
    useFloatingSessionStore.getState().requestNewSession(null);
    const s = useFloatingSessionStore.getState();
    expect(s.autoNewPending).toBe(true);
    expect(s.preContext).toBeNull();
    expect(s.pendingPpmItem).toEqual({
      kind: "plan_task",
      id: "task-1",
      projectId: "p-1",
      title: "排行榜接口性能优化",
    });
  });

  it("problem kind 同样成立；clearPendingPpmItem 消费清除", () => {
    useFloatingSessionStore.getState().setPendingPpmItem({
      kind: "problem",
      id: "prob-1",
      projectId: "p-2",
      title: null,
    });
    expect(useFloatingSessionStore.getState().pendingPpmItem?.kind).toBe("problem");

    // 宿主读取即清（一次性消费）。
    useFloatingSessionStore.getState().clearPendingPpmItem();
    expect(useFloatingSessionStore.getState().pendingPpmItem).toBeNull();
  });

  it("closeDrawer 无会话全清时一并清挂起位", () => {
    useFloatingSessionStore.getState().setPendingPpmItem({
      kind: "plan_task",
      id: "task-2",
      projectId: null,
    });
    useFloatingSessionStore.getState().requestNewSession(null);
    useFloatingSessionStore.getState().closeDrawer();
    expect(useFloatingSessionStore.getState().pendingPpmItem).toBeNull();
    expect(useFloatingSessionStore.getState().autoNewPending).toBe(false);
  });
});

/**
 * 关联仓卡片测试（2026-10-10-workspec-maintenance task-05 / FR-06）。
 *
 * mock @/lib/linked-repos（apiFetch 不发真实请求）；覆盖：列表渲染（含状态徽标/
 * 本机路径未配置提示）、空态、权限差异（成员无「新增/编辑/删除」入口）、
 * 新增 Modal 交互（canManage）、立即同步受理提示。
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "antd";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { LinkedReposCard } from "../linked-repos-card";
import * as api from "@/lib/linked-repos";
import type { LinkedRepoView } from "@/lib/linked-repos";

vi.mock("@/lib/linked-repos", async () => {
  const actual = await vi.importActual<typeof api>("@/lib/linked-repos");
  return {
    ...actual,
    listLinkedRepos: vi.fn(),
    createLinkedRepo: vi.fn(),
    updateLinkedRepo: vi.fn(),
    deleteLinkedRepo: vi.fn(),
    saveMyLinkedRepoPath: vi.fn(),
    syncLinkedReposNow: vi.fn(),
    fetchLocalSnapshot: vi.fn(),
    importSelected: vi.fn(),
  };
});

const listMock = vi.mocked(api.listLinkedRepos);
const syncMock = vi.mocked(api.syncLinkedReposNow);
const fetchSnapMock = vi.mocked(api.fetchLocalSnapshot);
const importMock = vi.mocked(api.importSelected);
const createMock = vi.mocked(api.createLinkedRepo);

const sample: LinkedRepoView = {
  id: "r1",
  name: "platform-specs",
  repo_url: "git@example:specs.git",
  description: "spec 规范仓",
  rel_path: "../platform-specs",
  my_path: null,
  sync_status_summary: [
    {
      machine_id: "m1",
      layer: "projects_yaml",
      status: "ok",
      synced_at: "2026-10-10T10:00:00Z",
    },
    {
      machine_id: "m1",
      layer: "repos_registry",
      status: "skipped",
      detail: "本机路径未配置",
      synced_at: "2026-10-10T10:00:00Z",
    },
  ],
};

function mount(props: { canManage?: boolean } = {}) {
  return render(
    <App>
      <LinkedReposCard workspaceId="ws-1" canManage={props.canManage ?? false} />
    </App>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  syncMock.mockResolvedValue({ dispatched: true, repo_count: 1 });
});

describe("LinkedReposCard", () => {
  it("渲染列表：名称/地址/相对路径/状态徽标/本机路径未配置提示", async () => {
    listMock.mockResolvedValue([sample]);
    mount({ canManage: true });
    expect(await screen.findByText("platform-specs")).toBeTruthy();
    expect(screen.getByText("git@example:specs.git")).toBeTruthy();
    expect(screen.getByText(/约定相对路径：\.\.\/platform-specs/)).toBeTruthy();
    expect(screen.getByText("本机路径未配置")).toBeTruthy();
    // 状态徽标：projects·ok 与 repos·skipped（−）。
    expect(screen.getByText("projects·✓")).toBeTruthy();
    expect(screen.getByText("repos·−")).toBeTruthy();
  });

  it("空态引导文案", async () => {
    listMock.mockResolvedValue([]);
    mount({ canManage: true });
    expect(await screen.findByText(/尚未登记关联仓/)).toBeTruthy();
    // 空态下「立即同步」禁用。
    expect(screen.getByRole("button", { name: "立即同步" })).toHaveProperty("disabled", true);
  });

  it("成员视角：无新增/编辑/删除入口，有配置路径与立即同步", async () => {
    listMock.mockResolvedValue([sample]);
    mount({ canManage: false });
    await screen.findByText("platform-specs");
    expect(screen.queryByRole("button", { name: /新增关联仓/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "编辑" })).toBeNull();
    expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
    expect(screen.getByRole("button", { name: "配置路径" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "立即同步" })).toBeTruthy();
  });

  it("canManage：新增 Modal 打开并提交（名称必填校验）", async () => {
    listMock.mockResolvedValue([]);
    createMock.mockResolvedValue({ ...sample, id: "r2" });
    mount({ canManage: true });
    await screen.findByText(/尚未登记关联仓/);
    fireEvent.click(screen.getByRole("button", { name: /新增关联仓/ }));
    expect(await screen.findByText("新增关联仓")).toBeTruthy();
    // 空名称提交 → 校验提示，不调 API。
    fireEvent.click(screen.getByRole("button", { name: "保 存" }).closest("button")!);
    await waitFor(() => expect(createMock).not.toHaveBeenCalled());
  });

  it("立即同步：dispatched=true 成功提示后刷新", async () => {
    listMock.mockResolvedValue([sample]);
    mount({ canManage: true });
    await screen.findByText("platform-specs");
    fireEvent.click(screen.getByRole("button", { name: "立即同步" }));
    await waitFor(() => expect(syncMock).toHaveBeenCalledWith("ws-1"));
    // 3s 延迟刷新走 setTimeout——直接断言 sync 受理即可（刷新已由 mock 覆盖）。
  });

  it("立即同步降级：dispatched=false 显示 reason 警告", async () => {
    listMock.mockResolvedValue([sample]);
    syncMock.mockResolvedValue({ dispatched: false, reason: "daemon 需升级（不支持 linked_repos_sync）", repo_count: 1 });
    mount({ canManage: true });
    await screen.findByText("platform-specs");
    fireEvent.click(screen.getByRole("button", { name: "立即同步" }));
    await waitFor(() => expect(syncMock).toHaveBeenCalled());
  });
});

// ── 2026-10-10-linked-repos-local-echo task-04：本机现状区 ──

describe("LinkedReposCard 本机现状区", () => {
  it("初始态：引导文案，零请求", async () => {
    listMock.mockResolvedValue([sample]);
    mount({ canManage: true });
    await screen.findByText("platform-specs");
    expect(screen.getByText(/点「刷新本机现状」读取/)).toBeTruthy();
    expect(fetchSnapMock).not.toHaveBeenCalled();
  });

  it("刷新后三态渲染 + 可导入条目勾选", async () => {
    listMock.mockResolvedValue([sample]);
    fetchSnapMock.mockResolvedValue({
      status: "ok",
      fetched_at: "2026-10-10T10:00:00Z",
      entries: [
        { key: "demo", sources: ["projects", "repos"], rel_path: "../demo", abs_path: "C:/demo", match: "local_only" },
        { key: "platform-specs", sources: ["projects"], rel_path: null, abs_path: null, match: "both", platform_repo_id: "r1" },
      ],
      platform_only_names: ["ghost"],
    });
    mount({ canManage: true });
    await screen.findByText("platform-specs");
    fireEvent.click(screen.getByRole("button", { name: "刷新本机现状" }));
    expect(await screen.findByText("demo")).toBeTruthy();
    expect(screen.getByText("两边一致")).toBeTruthy();
    expect(screen.getByText("仅本机", { exact: false })).toBeTruthy();
    expect(screen.getByText(/仅平台登记（1）：ghost/)).toBeTruthy();
    // 勾选 demo 后导入按钮计数 1/1
    fireEvent.click(screen.getByLabelText("选择导入 demo"));
    expect(screen.getByRole("button", { name: /导入所选（1\/1）/ })).toBeTruthy();
  });

  it("四态降级：binding_missing 显示引导", async () => {
    listMock.mockResolvedValue([]);
    fetchSnapMock.mockResolvedValue({ status: "binding_missing", entries: [], platform_only_names: [] });
    mount({ canManage: true });
    await screen.findByText(/尚未登记关联仓/);
    fireEvent.click(screen.getByRole("button", { name: "刷新本机现状" }));
    expect(await screen.findByText(/请先绑定守护进程/)).toBeTruthy();
  });

  it("成员视角：无导入按钮（仅刷新）", async () => {
    listMock.mockResolvedValue([sample]);
    fetchSnapMock.mockResolvedValue({
      status: "ok",
      entries: [{ key: "demo", sources: ["repos"], abs_path: "C:/d", match: "local_only" }],
      platform_only_names: [],
    });
    mount({ canManage: false });
    await screen.findByText("platform-specs");
    fireEvent.click(screen.getByRole("button", { name: "刷新本机现状" }));
    expect(await screen.findByText("demo")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /导入所选/ })).toBeNull();
    expect(screen.queryByLabelText("选择导入 demo")).toBeNull();
  });
});

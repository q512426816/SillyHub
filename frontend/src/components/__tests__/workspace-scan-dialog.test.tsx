/**
 * WorkspaceScanDialog slug 字段测试（ql-20260826-007-8666）。
 *
 * 契约：
 *  - slug 输入框默认从工作区名称实时派生（与后端 schema.slugify 同规则：
 *    非字母数字折叠连字符、去首尾、小写；「My Project!!」→「my-project」）
 *  - 手动编辑后脱离跟随——再改名称 slug 保持手输值
 *  - 提交体带最终 slug；名称与 slug 均空时提交体省略 slug（后端派生兜底）
 */
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceScanDialog } from "@/components/workspace-scan-dialog";

const daemonApi = vi.hoisted(() => ({ listDaemonInstances: vi.fn() }));
const workspacesApi = vi.hoisted(() => ({ createWorkspace: vi.fn() }));
const notify = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>(
    "@/lib/daemon",
  );
  return { ...actual, listDaemonInstances: daemonApi.listDaemonInstances };
});

vi.mock("@/lib/workspaces", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces")>(
    "@/lib/workspaces",
  );
  return { ...actual, createWorkspace: workspacesApi.createWorkspace };
});

// useNotify 依赖 antd App 上下文，这里直接换纯函数实现。
vi.mock("@/lib/errors", async () => {
  const actual = await vi.importActual<typeof import("@/lib/errors")>(
    "@/lib/errors",
  );
  return { ...actual, useNotify: () => notify };
});

// 路径选择器是远程目录选择控件，与本测试关注的 slug 行为无关，mock 成纯输入框。
vi.mock("@/components/workspace-path-picker", () => ({
  WorkspacePathPicker: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (v: string) => void;
  }) => (
    <input
      aria-label="工作区路径"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

function makeCreatedWorkspace() {
  return {
    id: "ws-1",
    name: "n",
    slug: "s",
    root_path: "/r",
    status: "active",
    creation_notice: null,
  };
}

async function renderDialogAndFillBase() {
  render(<WorkspaceScanDialog onCreated={vi.fn()} onCancel={vi.fn()} />);
  // 守护进程下拉（唯一常驻 combobox）等实例加载出选项后选中 d1，
  // 再填路径 → 名称/slug/类型字段出现
  const daemonSelect = screen.getByRole("combobox");
  await waitFor(() =>
    expect((daemonSelect as HTMLSelectElement).options.length).toBeGreaterThan(
      1,
    ),
  );
  fireEvent.change(daemonSelect, { target: { value: "d1" } });
  fireEvent.change(screen.getByLabelText("工作区路径"), {
    target: { value: "C:\\repo\\demo" },
  });
}

describe("WorkspaceScanDialog slug 字段", () => {
  beforeEach(() => {
    daemonApi.listDaemonInstances.mockResolvedValue([
      {
        id: "d1",
        hostname: "host-a",
        display_alias: null,
        status: "online",
        providers: [{ provider: "claude_code" }],
      },
    ]);
    workspacesApi.createWorkspace.mockResolvedValue(makeCreatedWorkspace());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("slug 默认从名称实时派生（同后端 slugify 规则）", async () => {
    await renderDialogAndFillBase();
    const slugInput = screen.getByLabelText("slug（创建后不可修改）", {
      selector: "input",
    });
    // 名称未填 → slug 为空（不预填 "workspace" 兜底）
    expect(slugInput).toHaveValue("");

    fireEvent.change(screen.getByLabelText("工作区名称"), {
      target: { value: "My Project!!" },
    });
    expect(slugInput).toHaveValue("my-project");

    fireEvent.change(screen.getByLabelText("工作区名称"), {
      target: { value: "订单模块" },
    });
    // 纯中文名称无 ASCII 字母数字 → 兜底 "workspace"（与后端一致）；
    // 混入 ASCII 的「订单 模块 v2」则派生为 "v2"
    expect(slugInput).toHaveValue("workspace");
  });

  it("手动编辑后脱离跟随：再改名称 slug 保持手输值", async () => {
    await renderDialogAndFillBase();
    fireEvent.change(screen.getByLabelText("工作区名称"), {
      target: { value: "My Project" },
    });
    const slugInput = screen.getByLabelText("slug（创建后不可修改）", {
      selector: "input",
    });
    fireEvent.change(slugInput, { target: { value: "custom-slug" } });

    fireEvent.change(screen.getByLabelText("工作区名称"), {
      target: { value: "Another Name" },
    });
    expect(slugInput).toHaveValue("custom-slug");
  });

  it("名称与 slug 均空时提交体省略 slug 字段（后端派生兜底）", async () => {
    await renderDialogAndFillBase();
    const typeSelect = screen.getByLabelText("工作区类型");
    fireEvent.change(typeSelect, { target: { value: "other" } });

    fireEvent.click(screen.getByRole("button", { name: "创建工作区" }));
    await waitFor(() =>
      expect(workspacesApi.createWorkspace).toHaveBeenCalled(),
    );
    expect(workspacesApi.createWorkspace).toHaveBeenCalledWith(
      expect.not.objectContaining({ slug: expect.anything() }),
    );
  });

  it("填名称后提交体带派生 slug；手输值优先", async () => {
    await renderDialogAndFillBase();
    const typeSelect = screen.getByLabelText("工作区类型");
    fireEvent.change(typeSelect, { target: { value: "other" } });

    fireEvent.change(screen.getByLabelText("工作区名称"), {
      target: { value: "My Project" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建工作区" }));
    await waitFor(() =>
      expect(workspacesApi.createWorkspace).toHaveBeenCalled(),
    );
    expect(workspacesApi.createWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "my-project" }),
    );
  });

  it("手动改过的 slug 原样进提交体", async () => {
    await renderDialogAndFillBase();
    const typeSelect = screen.getByLabelText("工作区类型");
    fireEvent.change(typeSelect, { target: { value: "other" } });

    fireEvent.change(screen.getByLabelText("工作区名称"), {
      target: { value: "My Project" },
    });
    fireEvent.change(
      screen.getByLabelText("slug（创建后不可修改）"),
      { target: { value: "custom-slug" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "创建工作区" }));
    await waitFor(() =>
      expect(workspacesApi.createWorkspace).toHaveBeenCalled(),
    );
    expect(workspacesApi.createWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "custom-slug" }),
    );
  });
});

// ql-20260702：WorkspaceCard 结构回归测试。
//
// 覆盖工作区卡片 UI 优化点（变更 2026-07-02 quick）：
//   - 别名优先作标题，原名同行补显；无别名回退 name 且不显示「原名」；
//   - 创建于与最后扫描合并到同一行容器（不再各占一行）；
//   - daemon-client 路径来源去重：卡片头 Badge 已移除，值只在卡片体出现 1 次；
//   - owner=null 不崩；owner.display_name 优先作为负责人显示名；
//   - 详情/关系为带 href 的链接，复用 buttonVariants 统一按钮风格。

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { WorkspaceCard } from "@/components/workspace-card";
import type { Workspace } from "@/lib/workspaces";

function mkWorkspace(o: Partial<Workspace> & { id: string }): Workspace {
  return {
    id: o.id,
    name: o.name ?? "my-project",
    display_alias: o.display_alias ?? null,
    slug: o.slug ?? "my-project",
    root_path: o.root_path ?? "/srv/my-project",
    path_source: o.path_source ?? "server-local",
    daemon_runtime_id: o.daemon_runtime_id ?? null,
    status: o.status ?? "active",
    component_key: o.component_key ?? null,
    type: o.type ?? null,
    role: o.role ?? null,
    repo_url: o.repo_url ?? null,
    default_branch: o.default_branch ?? null,
    default_agent: o.default_agent ?? null,
    default_model: o.default_model ?? null,
    tech_stack: o.tech_stack ?? [],
    build_command: o.build_command ?? null,
    test_command: o.test_command ?? null,
    source_yaml_path: o.source_yaml_path ?? null,
    created_by: o.created_by ?? null,
    created_at: o.created_at ?? "2026-06-28T04:29:26Z",
    updated_at: o.updated_at ?? "2026-06-28T04:29:26Z",
    last_scanned_at: o.last_scanned_at ?? "2026-06-28T04:29:26Z",
    deleted_at: o.deleted_at ?? null,
    owner: o.owner ?? null,
  };
}

describe("WorkspaceCard 结构 (ql-20260702)", () => {
  it("别名优先作标题，原名与标题同处一行", () => {
    render(
      <WorkspaceCard
        workspace={mkWorkspace({
          id: "ws-1",
          name: "orig-name",
          display_alias: "展示名",
        })}
        onChanged={() => {}}
        onEditAlias={() => {}}
      />,
    );
    expect(screen.getByText("展示名")).toBeInTheDocument();
    const heading = screen.getByRole("heading", { level: 3 });
    const originSpan = screen.getByText(/orig-name/);
    // 标题与原名共享同一标题行容器（合并到一行）。
    expect(heading.parentElement).toContainElement(originSpan);
  });

  it("无别名时标题回退 name，且不显示「原名」", () => {
    render(
      <WorkspaceCard
        workspace={mkWorkspace({ id: "ws-2", name: "only-name", display_alias: null })}
        onChanged={() => {}}
        onEditAlias={() => {}}
      />,
    );
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("only-name");
    expect(screen.queryByText(/原名/)).toBeNull();
  });

  it("创建于与最后扫描合并到同一行容器", () => {
    render(
      <WorkspaceCard
        workspace={mkWorkspace({ id: "ws-3" })}
        onChanged={() => {}}
        onEditAlias={() => {}}
      />,
    );
    const created = screen.getByText(/创建于/);
    const scanned = screen.getByText(/最后扫描/);
    expect(created.parentElement).toBe(scanned.parentElement);
  });

  it("daemon-client：路径来源值只在卡片体出现一次（卡片头去重）", () => {
    render(
      <WorkspaceCard
        workspace={mkWorkspace({
          id: "ws-4",
          path_source: "daemon-client",
          daemon_runtime_id: "rt-1",
        })}
        boundRuntime={null}
        onChanged={() => {}}
        onEditAlias={() => {}}
      />,
    );
    // 卡片头的路径来源 Badge 已移除 → 「本机守护进程路径」整卡只 1 处。
    expect(screen.getAllByText("本机守护进程路径")).toHaveLength(1);
    expect(screen.getAllByText("路径来源")).toHaveLength(1);
  });

  it("server-local：不渲染路径来源标签", () => {
    render(
      <WorkspaceCard
        workspace={mkWorkspace({ id: "ws-5", path_source: "server-local" })}
        onChanged={() => {}}
        onEditAlias={() => {}}
      />,
    );
    expect(screen.queryByText("路径来源")).toBeNull();
  });

  it("owner=null 不崩，且不渲染负责人行", () => {
    render(
      <WorkspaceCard
        workspace={mkWorkspace({ id: "ws-6", owner: null })}
        onChanged={() => {}}
        onEditAlias={() => {}}
      />,
    );
    expect(screen.queryByText(/负责人/)).toBeNull();
  });

  it("owner 有 display_name 时优先显示用户名称", () => {
    render(
      <WorkspaceCard
        workspace={mkWorkspace({
          id: "ws-7",
          owner: { user_id: "u1", email: "a@b.com", display_name: "张三" },
        })}
        onChanged={() => {}}
        onEditAlias={() => {}}
      />,
    );
    expect(screen.getByText(/张三/)).toBeInTheDocument();
  });

  it("详情与关系为带正确 href 的链接", () => {
    render(
      <WorkspaceCard
        workspace={mkWorkspace({ id: "ws-8" })}
        onChanged={() => {}}
        onEditAlias={() => {}}
      />,
    );
    expect(screen.getByRole("link", { name: "详情" })).toHaveAttribute(
      "href",
      "/workspaces/ws-8",
    );
    expect(screen.getByRole("link", { name: "关系" })).toHaveAttribute(
      "href",
      "/workspaces/ws-8/components",
    );
  });
});

// ql-20260702：WorkspaceCard 结构回归测试。
//
// 覆盖工作区卡片 UI 优化点（变更 2026-07-02 quick）：
//   - 别名优先作标题，原名同行补显；无别名回退 name 且不显示「原名」；
//   - 创建于与最后扫描合并到同一行容器（不再各占一行）；
//   - daemon-client 路径来源去重：卡片头 Badge 已移除，值只在卡片体出现 1 次；
//   - owner=null 不崩；owner.display_name 优先作为负责人显示名；
//   - 详情/关系为带 href 的链接，复用 buttonVariants 统一按钮风格。

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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

  // 遗留 1（daemon-entity-binding）：daemon_runtime_id=NULL 的新工作区，
  // 卡片按 daemon 实体展示绑定（hostname/display_alias + provider 徽标）。
  it("daemon-client + boundDaemon：按 daemon 实体展示 hostname 与 provider 徽标", () => {
    render(
      <WorkspaceCard
        workspace={mkWorkspace({
          id: "ws-9",
          path_source: "daemon-client",
          daemon_runtime_id: null,
        })}
        boundDaemon={{
          id: "inst-1",
          hostname: "dev-host",
          display_alias: null,
          status: "online",
          providers: [
            { provider: "claude", status: "online" },
            { provider: "codex", status: "online" },
          ],
        }}
        onChanged={() => {}}
        onEditAlias={() => {}}
      />,
    );
    expect(screen.getByText("dev-host")).toBeInTheDocument();
    // 两个 provider 徽标都渲染。
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
  });
});

// task-07（2026-07-09-workspace-prioritization）：列表页改造为选择器后，
// 卡片新增 daemon 状态徽标（三态，对齐原型画面①）+ 整卡 onActivate 分流。
describe("WorkspaceCard daemon 徽标 + 整卡点击 (task-07)", () => {
  it("daemonStatus=online：渲染绿色「守护在线」徽标", () => {
    render(
      <WorkspaceCard
        workspace={mkWorkspace({ id: "ws-on" })}
        daemonStatus="online"
        onChanged={() => {}}
        onEditAlias={() => {}}
      />,
    );
    expect(screen.getByText("守护在线")).toBeInTheDocument();
    expect(screen.queryByText("未绑定")).not.toBeInTheDocument();
  });

  it("daemonStatus=offline：渲染红色「守护离线」徽标", () => {
    render(
      <WorkspaceCard
        workspace={mkWorkspace({ id: "ws-off" })}
        daemonStatus="offline"
        onChanged={() => {}}
        onEditAlias={() => {}}
      />,
    );
    expect(screen.getByText("守护离线")).toBeInTheDocument();
  });

  it("daemonStatus=unbound：渲染黄色「未绑定」徽标 + 配置提示行", () => {
    render(
      <WorkspaceCard
        workspace={mkWorkspace({ id: "ws-unbound" })}
        daemonStatus="unbound"
        onChanged={() => {}}
        onEditAlias={() => {}}
      />,
    );
    expect(screen.getByText("未绑定")).toBeInTheDocument();
    // 未绑定提示行（原型画面①），引导点击配置
    expect(screen.getByText(/需先配置守护进程/)).toBeInTheDocument();
  });

  it("不传 daemonStatus：不渲染 daemon 徽标（兼容旧调用方）", () => {
    render(
      <WorkspaceCard
        workspace={mkWorkspace({ id: "ws-none" })}
        onChanged={() => {}}
        onEditAlias={() => {}}
      />,
    );
    expect(screen.queryByText("守护在线")).not.toBeInTheDocument();
    expect(screen.queryByText("守护离线")).not.toBeInTheDocument();
    expect(screen.queryByText("未绑定")).not.toBeInTheDocument();
  });

  it("传 onActivate：卡片整张可点击 → 点击卡片体触发 onActivate", () => {
    const onActivate = vi.fn();
    render(
      <WorkspaceCard
        workspace={mkWorkspace({ id: "ws-act" })}
        daemonStatus="unbound"
        onChanged={() => {}}
        onEditAlias={() => {}}
        onActivate={onActivate}
      />,
    );
    // 点击卡片 header（卡片体内，非 footer）→ 触发 onActivate
    fireEvent.click(screen.getByRole("heading", { level: 3 }));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("footer 按钮（详情/别名）点击不误触 onActivate（stopPropagation）", () => {
    const onActivate = vi.fn();
    render(
      <WorkspaceCard
        workspace={mkWorkspace({ id: "ws-stop" })}
        daemonStatus="online"
        onChanged={() => {}}
        onEditAlias={() => {}}
        onActivate={onActivate}
      />,
    );
    // 点击 footer 内的「详情」链接 → 不触发卡片 onActivate
    fireEvent.click(screen.getByRole("link", { name: "详情" }));
    expect(onActivate).not.toHaveBeenCalled();
    // 点击 footer 内「别名」按钮 → 同样不触发
    fireEvent.click(screen.getByRole("button", { name: "别名" }));
    expect(onActivate).not.toHaveBeenCalled();
  });
});

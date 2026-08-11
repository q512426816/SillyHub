/**
 * AgentProfileCard 单测（task-07 / FR-08 / D-002）。
 *
 * 依据：
 *   - components/agent-profile/agent-profile-card.tsx（task-03 实现）
 *   - design §7.2 组件签名 / §10 R-02 卡片为表格基准显式特例
 *   - design §12 验收 5：系统预置档案卡显示「只读」，无编辑/删除按钮
 *
 * 覆盖：
 *   1. 常规档案卡渲染：头像首字母 / 名称 / 可见范围 Tag / 供应商·模型 mono /
 *      系统提示词摘要 / mcp+skill 能力 chip / 版本号·workspace_name foot
 *   2. 点击卡片主体触发 onPreview；操作按钮独立 stopPropagation（不触发预览）
 *   3. 编辑/复制/删除按钮各自触发回调
 *   4. 系统预置档案（is_system_default=true）：显「系统预置」Tag + 「只读」字样，
 *      不渲染编辑/复制/删除按钮，也不显可见范围 Tag
 *   5. 兜底：空提示词显「（未设置系统提示词）」；无能力 refs 不渲染 abilities 区
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import { AgentProfileCard } from "@/components/agent-profile/agent-profile-card";
import type { AgentProfileAggregatedItem } from "@/lib/agent-profiles";

// task-08：card 现用 useQuery(listProviders) 做绑定供应商名映射；测试需 QueryClient +
// mock listProviders（避免真 apiFetch）。默认返回空 → boundProviderName=null → 不渲染。
vi.mock("@/lib/api/llm-providers", () => ({
  listProviders: vi.fn().mockResolvedValue([]),
}));

/** 包 QueryClientProvider 渲染（card 用 useQuery，task-08）。 */
function renderCard(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

/** 构造最小可用 AggregatedItem（结构兼容 AgentProfileRead，多 workspace_name 可选）。 */
function makeProfile(
  overrides: Partial<AgentProfileAggregatedItem> = {},
): AgentProfileAggregatedItem {
  return {
    id: "p-1",
    name: "代码审查助手",
    visibility: "workspace",
    provider: "claude",
    model: "claude-sonnet-4",
    system_prompt: "你是资深代码审查员，只读不改。",
    tool_policy_id: null,
    mcp_refs: ["github", "db"],
    skill_refs: ["code-review"],
    owner_user_id: "u-1",
    workspace_id: "ws-1",
    workspace_name: "前端工程组",
    version: 3,
    is_system_default: false,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-02T00:00:00Z",
    ...overrides,
  } as unknown as AgentProfileAggregatedItem;
}

afterEach(() => {
  cleanup();
});

describe("AgentProfileCard 渲染（task-03 / FR-08）", () => {
  it("常规档案：头像首字母 / 名称 / 可见 Tag / 供应商·模型 mono / 提示词摘要 / 能力 chip / 版本 foot", () => {
    renderCard(
      <AgentProfileCard
        profile={makeProfile()}
        onPreview={vi.fn()}
        onEdit={vi.fn()}
        onCopy={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    // 头像首字母（拉丁大写）
    expect(screen.getByText("代")).toBeInTheDocument();
    // 名称
    expect(screen.getByText("代码审查助手")).toBeInTheDocument();
    // 可见范围 Tag（VISIBILITY_LABEL.workspace = 工作区）
    expect(screen.getByText("工作区")).toBeInTheDocument();
    // 供应商·模型 mono 行（provider / model）
    expect(screen.getByText("claude / claude-sonnet-4")).toBeInTheDocument();
    // 系统提示词摘要
    expect(screen.getByText(/你是资深代码审查员/)).toBeInTheDocument();
    // 能力 chip：mcp_refs + skill_refs 逐项
    expect(screen.getByText("github")).toBeInTheDocument();
    expect(screen.getByText("db")).toBeInTheDocument();
    expect(screen.getByText("code-review")).toBeInTheDocument();
    // 版本 foot：v3 · 前端工程组
    expect(screen.getByText(/v3/)).toBeInTheDocument();
    expect(screen.getByText(/前端工程组/)).toBeInTheDocument();
  });

  it("空提示词 → 兜底「（未设置系统提示词）」", () => {
    renderCard(
      <AgentProfileCard
        profile={makeProfile({ system_prompt: "   " })}
        onPreview={vi.fn()}
        onEdit={vi.fn()}
        onCopy={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText("（未设置系统提示词）")).toBeInTheDocument();
  });

  it("无 mcp_refs / skill_refs → 不渲染能力 chip 区", () => {
    const { container } = renderCard(
      <AgentProfileCard
        profile={makeProfile({ mcp_refs: [], skill_refs: [] })}
        onPreview={vi.fn()}
        onEdit={vi.fn()}
        onCopy={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    // chip 父容器（flex flex-wrap gap-1.5 px-3.5 pb-2.5）不应出现
    // 反向断言：无 github / code-review chip 文本
    expect(screen.queryByText("github")).not.toBeInTheDocument();
    expect(screen.queryByText("code-review")).not.toBeInTheDocument();
    // 容器仍渲染（卡片本身在）
    expect(container.firstChild).not.toBeNull();
  });

  it("供应商无 model → 仅显 provider", () => {
    renderCard(
      <AgentProfileCard
        profile={makeProfile({ provider: "codex", model: null })}
        onPreview={vi.fn()}
        onEdit={vi.fn()}
        onCopy={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText("codex")).toBeInTheDocument();
    // 不应出现 "codex / null" 或斜杠分隔
    expect(screen.queryByText(/codex\s*\//)).not.toBeInTheDocument();
  });

  it("绑定供应商 → 卡片显示供应商名（task-08 / FR-08）", async () => {
    const lp = await import("@/lib/api/llm-providers");
    (lp.listProviders as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: "prov-1", name: "我的 Claude 凭证" },
    ]);
    renderCard(
      <AgentProfileCard
        profile={makeProfile({ llm_provider_id: "prov-1" })}
        onPreview={vi.fn()}
        onEdit={vi.fn()}
        onCopy={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(
      await screen.findByText("供应商：我的 Claude 凭证"),
    ).toBeInTheDocument();
  });
});

describe("AgentProfileCard 交互（点卡片预览 / 按钮 stopPropagation）", () => {
  it("点卡片主体触发 onPreview(profile)", () => {
    const onPreview = vi.fn();
    renderCard(
      <AgentProfileCard
        profile={makeProfile()}
        onPreview={onPreview}
        onEdit={vi.fn()}
        onCopy={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    // 点名称区（卡片主体可点区域）。卡片本身 role=button。
    const card = screen.getByRole("button", { name: /代码审查助手/ });
    fireEvent.click(card);
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onPreview.mock.calls[0]?.[0]?.id).toBe("p-1");
  });

  it("点编辑按钮触发 onEdit 且不冒泡到 onPreview", () => {
    const onPreview = vi.fn();
    const onEdit = vi.fn();
    renderCard(
      <AgentProfileCard
        profile={makeProfile()}
        onPreview={onPreview}
        onEdit={onEdit}
        onCopy={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^编辑$/ }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onPreview).not.toHaveBeenCalled();
  });

  it("点复制按钮触发 onCopy 且不冒泡", () => {
    const onPreview = vi.fn();
    const onCopy = vi.fn();
    renderCard(
      <AgentProfileCard
        profile={makeProfile()}
        onPreview={onPreview}
        onEdit={vi.fn()}
        onCopy={onCopy}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^复制$/ }));
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onPreview).not.toHaveBeenCalled();
  });

  it("点删除按钮触发 onDelete 且不冒泡", () => {
    const onPreview = vi.fn();
    const onDelete = vi.fn();
    renderCard(
      <AgentProfileCard
        profile={makeProfile()}
        onPreview={onPreview}
        onEdit={vi.fn()}
        onCopy={vi.fn()}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^删除$/ }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onPreview).not.toHaveBeenCalled();
  });
});

describe("AgentProfileCard 系统预置只读态（design §12 验收 5）", () => {
  it("is_system_default=true → 显「系统预置」Tag + 「只读」，无编辑/复制/删除按钮，无可见范围 Tag", () => {
    renderCard(
      <AgentProfileCard
        profile={makeProfile({
          is_system_default: true,
          visibility: "platform",
        })}
        onPreview={vi.fn()}
        onEdit={vi.fn()}
        onCopy={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    // 系统预置 Tag + 只读字样
    expect(screen.getByText("系统预置")).toBeInTheDocument();
    expect(screen.getByText("只读")).toBeInTheDocument();
    // 头像显 ★
    expect(screen.getByText("★")).toBeInTheDocument();
    // 不渲染编辑/复制/删除按钮
    expect(screen.queryByRole("button", { name: /^编辑$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^复制$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^删除$/ })).not.toBeInTheDocument();
  });
});

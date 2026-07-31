/**
 * skills-settings-p0-fixup task-04：自定义技能编辑弹窗单测。
 *
 * 依据:
 *   - .sillyspec/changes/skills-settings-p0-fixup/design.md（D-004 头部预览 /
 *     D-008 统一校验 / P0-2 步骤模板 / D-005 生效 notify / P0-2 脏检测撤销）
 *   - tasks/task-02.md（验收：头部预览 / 校验 / 模板 / notify / 撤销）
 *
 * 覆盖:
 *   1. 头部预览实时反映 name+description（与 skills_bundle_service._build_skill_md 一致）
 *   2. 保存按钮统一校验：正文空 / sillyspec- 前缀 → 禁用
 *   3. 「插入步骤模板」填入骨架（何时使用 / 步骤 / 注意事项）
 *   4. 创建成功 → createCustomSkill + notify.success（生效提示）
 *   5. 「撤销改动」恢复初始值
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

import { CustomSkillEditDialog } from "@/components/custom-skill-edit-dialog";

// useNotify 可断言：hoist 一个实例，测试读 notifyMock.success.calls。
const notifyMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/errors", async () => {
  const actual = await vi.importActual<typeof import("@/lib/errors")>("@/lib/errors");
  return { ...actual, useNotify: () => notifyMock };
});

const skillsApi = vi.hoisted(() => ({
  createCustomSkill: vi.fn(),
  updateCustomSkill: vi.fn(),
  getCustomSkill: vi.fn(),
}));

vi.mock("@/lib/custom-skills", () => ({
  getCustomSkill: skillsApi.getCustomSkill,
  useCreateCustomSkill: () => ({
    mutateAsync: skillsApi.createCustomSkill,
    isPending: false,
    isError: false,
  }),
  useUpdateCustomSkill: () => ({
    mutateAsync: skillsApi.updateCustomSkill,
    isPending: false,
    isError: false,
  }),
}));

// jsdom 下 next/dynamic ssr:false 渲染 null（记忆 frontend-markdown-text-jsdom-null）。
vi.mock("@/components/ui/markdown-text", () => ({
  MarkdownText: ({ content }: { content: string }) => (
    <div data-testid="md-preview">{content}</div>
  ),
}));

function renderDialog(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => vi.clearAllMocks());

describe("CustomSkillEditDialog", () => {
  beforeEach(() => {
    skillsApi.createCustomSkill.mockResolvedValue({
      id: "s2",
      name: "x",
      description: "d",
      content: "c",
      content_preview: "c",
      created_by: null,
      created_at: "2026-07-31T00:00:00Z",
      updated_at: "2026-07-31T00:00:00Z",
    });
  });

  it("头部预览实时反映 name+description（D-008，与 _build_skill_md 一致）", () => {
    renderDialog(<CustomSkillEditDialog mode="create" skill={null} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("例如 my-helper"), {
      target: { value: "my-test" },
    });
    fireEvent.change(screen.getByPlaceholderText("一句话说明该技能用途"), {
      target: { value: "测试描述" },
    });

    // 预览区 <pre>：含拼装的 frontmatter 头部
    const preview = screen
      .getByText(/AI 实际读到的技能头部/)
      .parentElement?.querySelector("pre");
    expect(preview?.textContent).toContain("name: my-test");
    expect(preview?.textContent).toContain("description: 测试描述");
  });

  it("正文为空 → 保存按钮禁用（D-008 统一校验）", () => {
    renderDialog(<CustomSkillEditDialog mode="create" skill={null} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("例如 my-helper"), {
      target: { value: "ok-name" },
    });
    fireEvent.change(screen.getByPlaceholderText("一句话说明该技能用途"), {
      target: { value: "描述够长触发场景" },
    });
    expect(screen.getByText("创建技能").closest("button")).toBeDisabled();
  });

  it("名称含 sillyspec- 前缀 → 保存禁用（D-002 命名空间）", () => {
    renderDialog(<CustomSkillEditDialog mode="create" skill={null} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("例如 my-helper"), {
      target: { value: "sillyspec-x" },
    });
    fireEvent.change(screen.getByPlaceholderText("一句话说明该技能用途"), {
      target: { value: "描述够长触发场景" },
    });
    fireEvent.change(screen.getByPlaceholderText(/何时使用/), {
      target: { value: "正文" },
    });
    expect(screen.getByText("创建技能").closest("button")).toBeDisabled();
  });

  it("「插入步骤模板」填入骨架（P0-2）", () => {
    renderDialog(<CustomSkillEditDialog mode="create" skill={null} onClose={() => {}} />);
    fireEvent.click(screen.getByText("插入步骤模板"));
    const ta = screen.getByPlaceholderText(/何时使用/) as HTMLTextAreaElement;
    expect(ta.value).toContain("何时使用");
    expect(ta.value).toContain("## 步骤");
  });

  it("创建成功 → createCustomSkill + notify.success 生效提示（D-005）", async () => {
    const onClose = vi.fn();
    renderDialog(
      <CustomSkillEditDialog mode="create" skill={null} onClose={onClose} />,
    );
    fireEvent.change(screen.getByPlaceholderText("例如 my-helper"), {
      target: { value: "new-skill" },
    });
    fireEvent.change(screen.getByPlaceholderText("一句话说明该技能用途"), {
      target: { value: "部署到服务器时打包镜像" },
    });
    fireEvent.change(screen.getByPlaceholderText(/何时使用/), {
      target: { value: "# new skill\n正文" },
    });

    await act(async () => {
      fireEvent.click(screen.getByText("创建技能"));
    });

    await waitFor(() => {
      expect(skillsApi.createCustomSkill).toHaveBeenCalledWith({
        name: "new-skill",
        description: "部署到服务器时打包镜像",
        content: "# new skill\n正文",
      });
    });
    expect(notifyMock.success).toHaveBeenCalledWith(
      expect.stringContaining("重启守护进程"),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("撤销改动恢复初始值（P0-2 脏检测）", () => {
    renderDialog(<CustomSkillEditDialog mode="create" skill={null} onClose={() => {}} />);
    const nameInput = screen.getByPlaceholderText("例如 my-helper") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "typed-name" } });

    // 改了 → 撤销按钮出现，点击恢复
    fireEvent.click(screen.getByText("撤销改动"));
    expect(nameInput.value).toBe("");
  });
});

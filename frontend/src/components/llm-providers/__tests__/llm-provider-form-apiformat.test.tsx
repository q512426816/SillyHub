/**
 * task-07（2026-08-08-llm-provider-openai-format）：API 格式下拉单测（task-05 / D-001@v1）。
 *
 * 覆盖：默认 anthropic 字段齐全；切 OpenAI Chat 隐藏认证字段/角色映射/默认兜底（D-006 单模型），
 * env 块保留；切回 Anthropic 重新出现；提交 values.api_format 随下拉；点 opencode_zen_openai
 * 预设驱动 api_format=openai_chat。纯组件测（onSubmit mock），无 next/dynamic 依赖。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { LlmProviderForm } from "@/components/llm-providers/llm-provider-form";

/**
 * 按 element.value 定位 select（绕开 getByDisplayValue 对 React controlled <select>
 * 在 jsdom 的 selectedOptions 匹配不稳问题——直接读 .value 更可靠）。
 */
const getSelectByValue = (value: string): HTMLSelectElement =>
  screen.getAllByRole("combobox").find(
    (s) => (s as HTMLSelectElement).value === value,
  ) as HTMLSelectElement;

describe("LlmProviderForm — API 格式下拉（task-05 / D-001@v1）", () => {
  it("默认 anthropic：认证字段/角色映射/默认兜底可见（3 个 combobox + task-12 多模态下拉 = 4）", () => {
    render(<LlmProviderForm mode="create" onSubmit={vi.fn()} onCancel={vi.fn()} />);
    // Agent 种类 + API 格式 + 认证字段 = 3 个 select
    expect(screen.getAllByRole("combobox")).toHaveLength(4);
    expect(screen.getByText("模型角色映射")).toBeInTheDocument();
    expect(screen.getByText("默认兜底模型（可选）")).toBeInTheDocument();
  });

  it("切到 OpenAI Chat → 隐藏认证字段/角色映射/默认兜底（D-006）；env 块保留（2 combobox + 多模态 = 3）", () => {
    render(<LlmProviderForm mode="create" onSubmit={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(getSelectByValue("anthropic"), {
      target: { value: "openai_chat" },
    });
    expect(screen.getAllByRole("combobox")).toHaveLength(3);
    expect(screen.queryByText("模型角色映射")).not.toBeInTheDocument();
    expect(screen.queryByText("默认兜底模型（可选）")).not.toBeInTheDocument();
    // 认证字段 option 随 select 整块移除
    expect(
      screen.queryByText("ANTHROPIC_AUTH_TOKEN（默认，中转站常用）"),
    ).not.toBeInTheDocument();
    // env 块保留（openai 仍可配自定义环境变量）
    expect(screen.getByText("自定义环境变量（可选，高级）")).toBeInTheDocument();
  });

  it("切 OpenAI 再切回 Anthropic → 三块重新出现", () => {
    render(<LlmProviderForm mode="create" onSubmit={vi.fn()} onCancel={vi.fn()} />);
    const sel = getSelectByValue("anthropic");
    fireEvent.change(sel, { target: { value: "openai_chat" } });
    fireEvent.change(sel, { target: { value: "anthropic" } });
    expect(screen.getByText("模型角色映射")).toBeInTheDocument();
    // task-12：+1 多模态下拉（4 = 3 既有 + multimodal）。
    expect(screen.getAllByRole("combobox")).toHaveLength(4);
  });

  it("OpenAI 模式提交 → values.api_format === 'openai_chat'", async () => {
    const onSubmit = vi.fn();
    render(<LlmProviderForm mode="create" onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.change(getSelectByValue("anthropic"), {
      target: { value: "openai_chat" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Kimi 中转/), {
      target: { value: "Zen" },
    });
    fireEvent.change(screen.getByPlaceholderText("sk-***"), {
      target: { value: "sk-x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建供应商" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]!.api_format).toBe("openai_chat");
  });

  it("默认 anthropic 提交 → values.api_format === 'anthropic'", async () => {
    const onSubmit = vi.fn();
    render(<LlmProviderForm mode="create" onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/Kimi 中转/), {
      target: { value: "A" },
    });
    fireEvent.change(screen.getByPlaceholderText("sk-***"), {
      target: { value: "sk-x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建供应商" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]!.api_format).toBe("anthropic");
  });

  it("点 opencode_zen_openai 预设 → api_format 切到 openai_chat + 角色映射隐藏", () => {
    render(<LlmProviderForm mode="create" onSubmit={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(
      screen.getByRole("button", { name: /OpenCode Zen \(OpenAI\)/ }),
    );
    expect(getSelectByValue("openai_chat")).toBeTruthy();
    expect(screen.queryByText("模型角色映射")).not.toBeInTheDocument();
  });
});

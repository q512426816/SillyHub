/**
 * task-11：LlmProviderForm 组件单测。
 *
 * 覆盖：
 *   1. 新建模式：填名称 + api_key + base_url → 提交 → onSubmit 收到 LlmProviderFormValues
 *      （含角色映射嵌套、extra_env、agent_kind 固定 claude）。
 *   2. 编辑模式：initial 预填名称 / base_url / 角色映射；api_key 密码框为空（不明文回显）。
 *   3. 编辑模式 api_key 留空 → onSubmit values.api_key === ""（交给 formToUpdate 决定不进 body）。
 *   4. 角色映射表格 + env 编辑器输入落到 values。
 *
 * 纯组件测，不调真实 API（onSubmit 是 mock）；无 next/dynamic，无需 vi.mock markdown。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { LlmProviderForm } from "@/components/llm-providers/llm-provider-form";
import type { LlmProviderRead } from "@/lib/api/llm-providers";

const INITIAL: LlmProviderRead = {
  id: "p-1",
  user_id: "u-1",
  name: "Claude 官方",
  agent_kind: "claude",
  base_url: "https://api.anthropic.com",
  model: null,
  notes: "官方账号",
  website_url: "https://anthropic.com",
  auth_field: "ANTHROPIC_API_KEY",
  api_format: "anthropic",
  multimodal: "auto",
  model_role_mappings: {
    opus: { display: "Opus", model: "claude-opus-4-8", one_m: true },
  },
  default_fallback_model: "claude-opus-4-8",
  extra_env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
  is_default: true,
  api_key_masked: "sk-1...abcd",
  created_at: "2026-07-25T10:00:00Z",
  updated_at: "2026-07-25T10:00:00Z",
};

describe("LlmProviderForm — 新建模式", () => {
  it("填必填项提交 → onSubmit 收到正确表单值（agent_kind 固定 claude）", async () => {
    const onSubmit = vi.fn();
    render(
      <LlmProviderForm
        mode="create"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.change(
      screen.getByPlaceholderText(/Kimi 中转 \/ 公司专用账号/),
      { target: { value: "Kimi 中转" } },
    );
    fireEvent.change(screen.getByPlaceholderText("sk-***"), {
      target: { value: "sk-secret-1234" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/https:\/\/api\.anthropic\.com/),
      { target: { value: "https://api.moonshot.cn/anthropic" } },
    );

    fireEvent.click(screen.getByRole("button", { name: "创建供应商" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const values = onSubmit.mock.calls[0]![0]!;
    expect(values.name).toBe("Kimi 中转");
    expect(values.api_key).toBe("sk-secret-1234");
    expect(values.base_url).toBe("https://api.moonshot.cn/anthropic");
    expect(values.agent_kind).toBe("claude");
    expect(values.auth_field).toBe("ANTHROPIC_AUTH_TOKEN"); // 默认值
    // 4 行角色映射 + 空 extra_env 结构存在
    expect(values.model_role_mappings).toHaveProperty("sonnet");
    expect(values.model_role_mappings).toHaveProperty("opus");
    expect(values.model_role_mappings).toHaveProperty("fable");
    expect(values.model_role_mappings).toHaveProperty("haiku");
    expect(values.extra_env).toEqual({});
  });

  it("名称或 api_key 未填 → 提交按钮 disabled", () => {
    const onSubmit = vi.fn();
    render(
      <LlmProviderForm mode="create" onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    const submit = screen.getByRole("button", { name: "创建供应商" });
    expect(submit).toBeDisabled();
  });

  it("角色映射表格 + env 编辑器输入落到 values", async () => {
    const onSubmit = vi.fn();
    render(
      <LlmProviderForm mode="create" onSubmit={onSubmit} onCancel={vi.fn()} />,
    );

    // 必填项
    fireEvent.change(
      screen.getByPlaceholderText(/Kimi 中转 \/ 公司专用账号/),
      { target: { value: "中转" } },
    );
    fireEvent.change(screen.getByPlaceholderText("sk-***"), {
      target: { value: "sk-x" },
    });

    // Sonnet 实际模型（placeholder 含 kimi-k2 / claude-sonnet-5）
    fireEvent.change(
      screen.getByPlaceholderText(/kimi-k2 \/ claude-sonnet-5/),
      { target: { value: "kimi-k2" } },
    );

    // env 第一行（默认有一空行）
    fireEvent.change(
      screen.getByPlaceholderText(/变量名/),
      { target: { value: "API_TIMEOUT_MS" } },
    );
    fireEvent.change(
      screen.getByPlaceholderText(/值（如 3000000）/),
      { target: { value: "3000000" } },
    );

    fireEvent.click(screen.getByRole("button", { name: "创建供应商" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const values = onSubmit.mock.calls[0]![0]!;
    expect(values.model_role_mappings.sonnet).toMatchObject({ model: "kimi-k2" });
    expect(values.extra_env).toEqual({ API_TIMEOUT_MS: "3000000" });
  });
});

describe("LlmProviderForm — 编辑模式", () => {
  it("initial 预填名称/base_url/角色映射；api_key 密码框为空（不明文回显）", () => {
    render(
      <LlmProviderForm
        mode="edit"
        initial={INITIAL}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const nameInput = screen.getByPlaceholderText(
      /Kimi 中转 \/ 公司专用账号/,
    ) as HTMLInputElement;
    expect(nameInput.value).toBe("Claude 官方");

    const baseUrlInput = screen.getByPlaceholderText(
      /https:\/\/api\.anthropic\.com/,
    ) as HTMLInputElement;
    expect(baseUrlInput.value).toBe("https://api.anthropic.com");

    // api_key 编辑模式占位 = 保持原密钥不变，且输入框为空
    const apiKeyInput = screen.getByPlaceholderText("保持原密钥不变") as HTMLInputElement;
    expect(apiKeyInput.value).toBe("");
    expect(apiKeyInput.type).toBe("password");

    // opus 行模型从 initial 预填
    const opusInput = screen.getByPlaceholderText(
      /deepseek-v4-pro \/ claude-opus-4-8/,
    ) as HTMLInputElement;
    expect(opusInput.value).toBe("claude-opus-4-8");
  });

  it("编辑留空 api_key → values.api_key === ''（formToUpdate 据此不进 PATCH body）", async () => {
    const onSubmit = vi.fn();
    render(
      <LlmProviderForm
        mode="edit"
        initial={INITIAL}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    // 直接提交（名称已预填，编辑模式 api_key 非必填）
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const values = onSubmit.mock.calls[0]![0]!;
    expect(values.api_key).toBe("");
    // 预填的映射回传
    expect(values.model_role_mappings.opus).toMatchObject({
      model: "claude-opus-4-8",
      one_m: true,
    });
    expect(values.extra_env).toEqual({
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    });
  });

  it("取消按钮触发 onCancel", () => {
    const onCancel = vi.fn();
    render(
      <LlmProviderForm
        mode="edit"
        initial={INITIAL}
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

// ── 预设选择器（task-07 / D-001）──────────────────────────────────────────────
// 注：task 卡称「7 家（含 Kimi=moonshot）」，但 cc-switch detect 不含 api.moonshot.cn
// （通用 Kimi 无套餐用量端点），本实现据 detect 现实标 6 家（Kimi=moonshot 不标）。
// 故 💰 标记数为 6，非卡的 7（详见 task-05/10 说明）。
describe("LlmProviderForm — 预设选择器（task-07 / D-001）", () => {
  it("点「Kimi For Coding」预设 → 预填 name/base_url/兜底模型/官网/角色映射，api_key 仍空", () => {
    render(<LlmProviderForm mode="create" onSubmit={vi.fn()} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Kimi For Coding/ }));

    expect(
      (screen.getByPlaceholderText(/Kimi 中转/) as HTMLInputElement).value,
    ).toBe("Kimi For Coding");
    expect(
      (screen.getByPlaceholderText(/https:\/\/api\.anthropic\.com/) as HTMLInputElement)
        .value,
    ).toBe("https://api.kimi.com/coding/");
    // 默认兜底模型（在折叠的「高级选项」内，jsdom 仍可查询）
    expect(
      (screen.getByPlaceholderText(/未映射的角色都走这个模型/) as HTMLInputElement)
        .value,
    ).toBe("kimi-for-coding");
    // 官网链接
    expect(
      (screen.getByPlaceholderText(/方便日后查账/) as HTMLInputElement).value,
    ).toBe("https://www.kimi.com/code/");
    // 角色映射：default_model 套用到 sonnet（照 handleAutoFill 范式）
    expect(
      (screen.getByPlaceholderText(/kimi-k2 \/ claude-sonnet-5/) as HTMLInputElement)
        .value,
    ).toBe("kimi-for-coding");
    // api_key 始终留空（永不预填明文 token）
    expect(
      (screen.getByPlaceholderText("sk-***") as HTMLInputElement).value,
    ).toBe("");
  });

  it("点「＋自定义」→ 重置为空表单", () => {
    render(<LlmProviderForm mode="create" onSubmit={vi.fn()} onCancel={vi.fn()} />);
    // 先套用预设填入
    fireEvent.click(screen.getByRole("button", { name: /Kimi For Coding/ }));
    expect(
      (screen.getByPlaceholderText(/Kimi 中转/) as HTMLInputElement).value,
    ).toBe("Kimi For Coding");
    // 再点「＋自定义」重置
    fireEvent.click(screen.getByRole("button", { name: /＋自定义/ }));
    expect(
      (screen.getByPlaceholderText(/Kimi 中转/) as HTMLInputElement).value,
    ).toBe("");
    expect(
      (screen.getByPlaceholderText(/https:\/\/api\.anthropic\.com/) as HTMLInputElement)
        .value,
    ).toBe("");
  });

  it("💰 可查用量标记仅出现在 6 家支持用量的预设按钮上", () => {
    render(<LlmProviderForm mode="create" onSubmit={vi.fn()} onCancel={vi.fn()} />);
    // 6 家：DeepSeek / 硅基流动 / OpenRouter / Kimi For Coding / 智谱 GLM / MiniMax
    // （Anthropic 官方 / Kimi=moonshot / 百炼 / Bailian For Coding 不带）
    expect(screen.getAllByTitle("支持余额查询")).toHaveLength(6);
  });

  it("编辑模式不渲染预设选择器（避免覆盖既有配置）", () => {
    render(
      <LlmProviderForm mode="edit" initial={INITIAL} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /＋自定义/ })).toBeNull();
    expect(screen.queryAllByTitle("支持余额查询")).toHaveLength(0);
  });
});

/**
 * task-14：LlmProviderForm 扩展单测（task-09 全局获取+一键设置 / task-10 配置 JSON 面板）。
 *
 * 三组用例（design §6.1 / §6.2 / §7）：
 *   1. 配置 JSON 面板：5 开关 toggle 增删 settings_config 键（env 空则 delete env）；
 *      格式化按钮把压缩 JSON 转两空格缩进；应用通用配置浅合并 env+enabledPlugins 预设；
 *      JSON 非法输入不崩（输入保留 + 提交时 settings_config 落 null）。
 *   2. 一键设置（D-002）：预填 sonnet model 非空 → 点「一键设置」→ 提交 values 的
 *      sonnet/opus/fable/haiku 4 角色 model 全等于该第一非空值。
 *   3. 全局获取（D-001/D-003）：点「获取模型列表」→ fetchProviderModels 发 POST →
 *      4 角色 ModelInputWithFetch 切到下拉态（出现 4 个「选择模型」触发钮）。
 *
 * fetch 全程 mock（apiFetch 内部走 globalThis.fetch），不打真实网络。表单无 next/dynamic，
 * 无需 markdown vi.mock。jsdom 下 <details> 折叠态子节点仍可被 testing-library 查询
 * （既有 llm-provider-form.test.tsx 已验证），故不强制展开。
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { LlmProviderForm } from "@/components/llm-providers/llm-provider-form";
import type { LlmProviderRead } from "@/lib/api/llm-providers";

// ── fetch harness（仿 lib/api/__tests__/llm-providers.test.ts mockFetch）────────

function mockFetchOnce(body: unknown, status = 200) {
  const bodyStr = JSON.stringify(body);
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => bodyStr,
    json: async () => body,
  } as unknown as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const EDIT_INITIAL: LlmProviderRead = {
  id: "p-1",
  user_id: "u-1",
  name: "Claude 官方",
  agent_kind: "claude",
  base_url: "https://api.anthropic.com",
  model: null,
  notes: null,
  website_url: null,
  auth_field: "ANTHROPIC_API_KEY",
  api_format: "anthropic",
  multimodal: "auto",
  model_role_mappings: null,
  default_fallback_model: null,
  extra_env: null,
  is_default: false,
  api_key_masked: "sk-1...abcd",
  created_at: "2026-07-25T10:00:00Z",
  updated_at: "2026-07-25T10:00:00Z",
};

// 配置 JSON 面板的 JsonEditor textarea（aria-label="JSON 编辑器"）。
const jsonTextarea = (): HTMLTextAreaElement =>
  screen.getByLabelText("JSON 编辑器") as HTMLTextAreaElement;

const openConfigPanel = (): void => {
  // 配置 JSON details 的 summary（区别于「高级选项」details）。
  fireEvent.click(screen.getByText(/配置 JSON（高级 env/));
};

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── 配置 JSON 面板（task-10 / D-005/D-008）──────────────────────────────────

describe("LlmProviderForm — 配置 JSON 面板 5 开关 toggle（task-10 / D-008）", () => {
  it("隐藏 AI 署名 → settings_config.attribution={commit:'',pr:''}；取消 → 删除 attribution", () => {
    render(
      <LlmProviderForm mode="create" onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    openConfigPanel();

    fireEvent.click(screen.getByRole("checkbox", { name: "隐藏 AI 署名" }));
    expect(jsonTextarea().value).toContain('"attribution"');
    expect(jsonTextarea().value).toContain('"commit": ""');
    expect(jsonTextarea().value).toContain('"pr": ""');

    // 取消勾选 → attribution 键删除
    fireEvent.click(screen.getByRole("checkbox", { name: "隐藏 AI 署名" }));
    expect(jsonTextarea().value).not.toContain('"attribution"');
  });

  it("Teammates → env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS='1'；取消 → env 空则 delete env", () => {
    render(
      <LlmProviderForm mode="create" onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    openConfigPanel();

    fireEvent.click(screen.getByRole("checkbox", { name: "Teammates 模式" }));
    expect(jsonTextarea().value).toContain('"env"');
    expect(jsonTextarea().value).toContain(
      '"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"',
    );

    // 取消 → env 子对象空 → delete env（保持 JSON 干净）
    fireEvent.click(screen.getByRole("checkbox", { name: "Teammates 模式" }));
    expect(jsonTextarea().value).not.toContain('"env"');
  });

  it("启用 Tool Search → env.ENABLE_TOOL_SEARCH='true'", () => {
    render(
      <LlmProviderForm mode="create" onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    openConfigPanel();

    fireEvent.click(screen.getByRole("checkbox", { name: "启用 Tool Search" }));
    expect(jsonTextarea().value).toContain('"ENABLE_TOOL_SEARCH": "true"');
  });

  it("最大强度思考 → env.CLAUDE_CODE_EFFORT_LEVEL='max'", () => {
    render(
      <LlmProviderForm mode="create" onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    openConfigPanel();

    fireEvent.click(screen.getByRole("checkbox", { name: "最大强度思考" }));
    expect(jsonTextarea().value).toContain('"CLAUDE_CODE_EFFORT_LEVEL": "max"');
  });

  it("禁用自动升级 → env.DISABLE_AUTOUPDATER='1'", () => {
    render(
      <LlmProviderForm mode="create" onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    openConfigPanel();

    fireEvent.click(screen.getByRole("checkbox", { name: "禁用自动升级" }));
    expect(jsonTextarea().value).toContain('"DISABLE_AUTOUPDATER": "1"');
  });

  it("多开关叠加 → 全部键同存于 settings_config.env", () => {
    render(
      <LlmProviderForm mode="create" onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    openConfigPanel();

    fireEvent.click(screen.getByRole("checkbox", { name: "Teammates 模式" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "启用 Tool Search" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "最大强度思考" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "禁用自动升级" }));

    const parsed = JSON.parse(jsonTextarea().value);
    expect(parsed.env).toEqual({
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      ENABLE_TOOL_SEARCH: "true",
      CLAUDE_CODE_EFFORT_LEVEL: "max",
      DISABLE_AUTOUPDATER: "1",
    });
    // 顶层 attribution 不应出现（未勾选隐藏署名）
    expect(parsed.attribution).toBeUndefined();
  });
});

describe("LlmProviderForm — 配置 JSON 面板 格式化 / 应用预设（task-10）", () => {
  it("格式化按钮 → 压缩 JSON 转两空格缩进", () => {
    render(
      <LlmProviderForm mode="create" onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    openConfigPanel();

    fireEvent.change(jsonTextarea(), { target: { value: '{"a":1}' } });
    fireEvent.click(screen.getByRole("button", { name: "格式化" }));
    expect(jsonTextarea().value).toBe('{\n  "a": 1\n}');
  });

  it("应用通用配置 → 浅合并 env（3 键）+ enabledPlugins（2 键）预设", () => {
    render(
      <LlmProviderForm mode="create" onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    openConfigPanel();

    fireEvent.click(screen.getByRole("button", { name: /应用通用配置/ }));
    const parsed = JSON.parse(jsonTextarea().value);
    expect(parsed.env).toMatchObject({
      API_TIMEOUT_MS: "3000000",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      ENABLE_TOOL_SEARCH: "true",
    });
    expect(parsed.enabledPlugins).toMatchObject({
      "frontend-design": true,
      playwright: true,
    });
  });

  it("应用通用配置 → 用户已有同键值胜出（浅合并：current 覆盖 preset）", () => {
    render(
      <LlmProviderForm mode="create" onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    openConfigPanel();

    // 先手填一个用户值
    fireEvent.change(jsonTextarea(), {
      target: { value: '{"env":{"API_TIMEOUT_MS":"9999"}}' },
    });
    fireEvent.click(screen.getByRole("button", { name: /应用通用配置/ }));
    const parsed = JSON.parse(jsonTextarea().value);
    // 用户值胜出
    expect(parsed.env.API_TIMEOUT_MS).toBe("9999");
    // 预设补齐缺失键
    expect(parsed.env.ENABLE_TOOL_SEARCH).toBe("true");
    expect(parsed.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe("1");
  });
});

describe("LlmProviderForm — JSON 非法容错（task-10 容错铁律）", () => {
  it("textarea 输入非法 JSON → 不崩 + 输入保留 + 行内提示「JSON 非法」", () => {
    render(
      <LlmProviderForm mode="create" onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    openConfigPanel();

    const ta = jsonTextarea();
    fireEvent.change(ta, { target: { value: "{not valid json" } });
    // 输入保留（onChange 不丢用户输入）
    expect(jsonTextarea().value).toBe("{not valid json");
    // 组件仍渲染（不崩）—— 行内校验提示出现
    expect(screen.getByText(/JSON 非法/)).toBeInTheDocument();
  });

  it("JSON 非法时点格式化 → 静默不崩（不抛错、不丢输入）", () => {
    render(
      <LlmProviderForm mode="create" onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    openConfigPanel();

    fireEvent.change(jsonTextarea(), { target: { value: "{broken" } });
    fireEvent.click(screen.getByRole("button", { name: "格式化" }));
    // 非法 JSON 格式化静默：输入保留、组件不崩
    expect(jsonTextarea().value).toBe("{broken");
  });

  it("JSON 非法 → 提交时 settings_config 落 null（schema 语义：null=未配置）", async () => {
    const onSubmit = vi.fn();
    render(
      <LlmProviderForm mode="create" onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    openConfigPanel();

    // 故意输入非法 JSON
    fireEvent.change(jsonTextarea(), { target: { value: "{not json" } });

    // 填必填项后提交（名称 + api_key）
    fireEvent.change(screen.getByPlaceholderText(/Kimi 中转 \/ 公司专用账号/), {
      target: { value: "中转" },
    });
    fireEvent.change(screen.getByPlaceholderText("sk-***"), {
      target: { value: "sk-x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建供应商" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const values = onSubmit.mock.calls[0]![0]!;
    expect(values.settings_config).toBeNull();
  });
});

// ── 一键设置（task-09 / D-002）──────────────────────────────────────────────

describe("LlmProviderForm — 一键设置填全部 4 角色（task-09 / D-002）", () => {
  it("预填 sonnet model → 点一键设置 → 提交 4 角色 model 全等于该值", async () => {
    const onSubmit = vi.fn();
    render(
      <LlmProviderForm mode="create" onSubmit={onSubmit} onCancel={vi.fn()} />,
    );

    // 必填项
    fireEvent.change(screen.getByPlaceholderText(/Kimi 中转 \/ 公司专用账号/), {
      target: { value: "中转" },
    });
    fireEvent.change(screen.getByPlaceholderText("sk-***"), {
      target: { value: "sk-x" },
    });

    // sonnet 模型手填（placeholder 含 kimi-k2 / claude-sonnet-5）
    fireEvent.change(
      screen.getByPlaceholderText(/kimi-k2 \/ claude-sonnet-5/),
      { target: { value: "kimi-k2" } },
    );

    // 一键设置按钮：默认（4 角色全空时）禁用，预填 sonnet 后可用
    const autoBtn = screen.getByRole("button", { name: /一键设置/ });
    expect(autoBtn).not.toBeDisabled();
    fireEvent.click(autoBtn);

    // 提交
    fireEvent.click(screen.getByRole("button", { name: "创建供应商" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    const values = onSubmit.mock.calls[0]![0]!;
    expect(values.model_role_mappings.sonnet.model).toBe("kimi-k2");
    expect(values.model_role_mappings.opus.model).toBe("kimi-k2");
    expect(values.model_role_mappings.fable.model).toBe("kimi-k2");
    expect(values.model_role_mappings.haiku.model).toBe("kimi-k2");
  });

  it("4 角色 model 全空 → 一键设置按钮禁用（D-002 全空以禁用承载）", () => {
    render(
      <LlmProviderForm mode="create" onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /一键设置/ })).toBeDisabled();
  });

  it("取第一非空：sonnet 空但 opus 有值 → 填 opus 的值到全部 4 角色", async () => {
    const onSubmit = vi.fn();
    render(
      <LlmProviderForm mode="create" onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    fireEvent.change(screen.getByPlaceholderText(/Kimi 中转 \/ 公司专用账号/), {
      target: { value: "中转" },
    });
    fireEvent.change(screen.getByPlaceholderText("sk-***"), {
      target: { value: "sk-x" },
    });
    // sonnet 留空，opus 填 deepseek-v4-pro
    fireEvent.change(
      screen.getByPlaceholderText(/deepseek-v4-pro \/ claude-opus-4-8/),
      { target: { value: "deepseek-v4-pro" } },
    );

    fireEvent.click(screen.getByRole("button", { name: /一键设置/ }));
    fireEvent.click(screen.getByRole("button", { name: "创建供应商" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    const values = onSubmit.mock.calls[0]![0]!;
    expect(values.model_role_mappings.sonnet.model).toBe("deepseek-v4-pro");
    expect(values.model_role_mappings.opus.model).toBe("deepseek-v4-pro");
    expect(values.model_role_mappings.fable.model).toBe("deepseek-v4-pro");
    expect(values.model_role_mappings.haiku.model).toBe("deepseek-v4-pro");
  });
});

// ── 全局获取模型列表（task-09 / D-001/D-003）─────────────────────────────────

describe("LlmProviderForm — 全局获取模型列表（task-09 / D-001/D-003）", () => {
  it("新建态：填 base_url+api_key → 点「获取模型列表」→ 发 POST fetch-models → 4 角色切到下拉态", async () => {
    const fetchMock = mockFetchOnce({
      models: [
        { id: "kimi-k2", owned_by: "moonshot" },
        { id: "claude-sonnet-5", owned_by: "anthropic" },
      ],
    });

    render(
      <LlmProviderForm mode="create" onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );

    // 新建态 handleFetch 要求 base_url + api_key 非空
    fireEvent.change(screen.getByPlaceholderText(/Kimi 中转 \/ 公司专用账号/), {
      target: { value: "中转" },
    });
    fireEvent.change(screen.getByPlaceholderText("sk-***"), {
      target: { value: "sk-secret" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/https:\/\/api\.anthropic\.com/),
      { target: { value: "https://api.moonshot.cn/anthropic" } },
    );

    // 点全局「获取模型列表」按钮（区别于每个角色行的同 aria-label 获取钮：
    // 全局钮的可见文本是 "获取模型列表"，角色行钮仅图标无文本）
    const globalFetchBtn = screen
      .getByText("获取模型列表")
      .closest("button") as HTMLButtonElement;
    fireEvent.click(globalFetchBtn);

    // fetch 被调用，POST 到 /api/llm-providers/fetch-models，body 双形态带 base_url+api_key
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/api/llm-providers/fetch-models");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.base_url).toBe("https://api.moonshot.cn/anthropic");
    expect(body.api_key).toBe("sk-secret");

    // 4 角色 ModelInputWithFetch 切到态1（下拉）：出现 4 个「选择模型」触发钮
    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: "选择模型" }),
      ).toHaveLength(4);
    });
  });

  it("编辑态：点「获取模型列表」→ fetch body 带 provider_id（后端解密 key）", async () => {
    const fetchMock = mockFetchOnce({
      models: [{ id: "claude-sonnet-5", owned_by: "anthropic" }],
    });

    render(
      <LlmProviderForm
        mode="edit"
        initial={EDIT_INITIAL}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const globalFetchBtn = screen
      .getByText("获取模型列表")
      .closest("button") as HTMLButtonElement;
    fireEvent.click(globalFetchBtn);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.provider_id).toBe("p-1");
    // 编辑态不传明文凭证
    expect(body.api_key).toBeUndefined();
    expect(body.base_url).toBeUndefined();

    // 切到下拉态
    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: "选择模型" }),
      ).toHaveLength(4);
    });
  });

  it("上游返回空模型列表 → 出现错误提示，不切下拉态（无「选择模型」钮）", async () => {
    mockFetchOnce({ models: [] });

    render(
      <LlmProviderForm
        mode="edit"
        initial={EDIT_INITIAL}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByText("获取模型列表").closest("button") as HTMLButtonElement,
    );

    // 空列表错误提示出现（不崩）
    await waitFor(() => {
      expect(
        screen.getByText(/未开放|空模型列表|失败/),
      ).toBeInTheDocument();
    });
    // 无下拉触发钮（态1 未进入）
    expect(screen.queryByRole("button", { name: "选择模型" })).toBeNull();
  });
});

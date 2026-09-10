/**
 * task-11：LlmProviderForm 组件单测。
 *
 * 覆盖：
 *   1. 新建模式：填名称 + api_key + base_url → 提交 → onSubmit 收到 LlmProviderFormValues
 *      （含角色映射嵌套、extra_env、agent_kind 固定 claude）。
 *   2. 编辑模式：initial 预填名称 / base_url / 角色映射；api_key 密码框为空（不明文回显）。
 *   3. 编辑模式 api_key 留空 → onSubmit values.api_key === ""（交给 formToUpdate 决定不进 body）。
 *   4. 角色映射表格 + env 编辑器输入落到 values。
 *   5. agent_kind=pi（task-07 / D-002@v1）：pi 选项可选且提交透传、认证字段泛化为
 *      可输入 env 名（ZAI_API_KEY）+ pattern 即时校验拦非法值、claude 路径零回归；
 *      另经 formToCreate 断言 lib 组装层产出的 POST body（pi/claude 两侧）。
 *   6. agent_kind=codex（task-06 / FR-05）：选项放开可提交、编辑态回填、
 *      pi→codex 切换 auth_field 归一。
 *   7. pi × openai_chat 禁选（task-06 / D-012 连带声明）：pi 时 openai_chat
 *      disabled + 提示、切 pi 归一 api_format、存量行兜底报错文案与后端 422
 *      逐字一致、codex×openai_chat 不受限、pi baseUrl 自定义端点语义提示。
 *
 * 纯组件测，不调真实 API（onSubmit 是 mock）；无 next/dynamic，无需 vi.mock markdown。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { LlmProviderForm } from "@/components/llm-providers/llm-provider-form";
import {
  formToCreate,
  type LlmProviderRead,
} from "@/lib/api/llm-providers";

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
  it("填必填项提交 → onSubmit 收到正确表单值（agent_kind 缺省 claude）", async () => {
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
    // lib 组装层零回归（task-07 扩 allowed_paths 后补）：缺省 claude 经 formToCreate
    // 产出的 POST body agent_kind 仍为 "claude"、auth_field 为缺省两选项之一。
    const body = formToCreate(values);
    expect(body.agent_kind).toBe("claude");
    expect(body.auth_field).toBe("ANTHROPIC_AUTH_TOKEN");
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

// ── 字段 ↔ 配置 JSON 联动（ql-20260823-007）──────────────────────────────────
// 结构化字段（base_url / 兜底模型 / 角色模型 / 认证字段）变更时，settings_config.env
// 同名键跟随更新，避免 JSON 里的过期值（历史预设空占位等）静默覆盖结构化字段——
// 曾致真实 api_key 被 `ANTHROPIC_AUTH_TOKEN: ""` 盖掉 → 会话 "Not logged in"。
describe("LlmProviderForm — 字段 ↔ settings_config.env 联动（ql-20260823-007）", () => {
  /** 编辑态 initial：模拟历史存量行——settings_config 带空 token 占位（预设旧版预填）。 */
  const WITH_ENV: LlmProviderRead = {
    ...INITIAL,
    base_url: "https://open.bigmodel.cn/api/anthropic",
    auth_field: "ANTHROPIC_AUTH_TOKEN",
    settings_config: {
      env: {
        ANTHROPIC_BASE_URL: "https://open.bigmodel.cn/api/anthropic",
        ANTHROPIC_AUTH_TOKEN: "", // 历史空占位（事故根因形态）
        ANTHROPIC_MODEL: "glm-5.1",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.1",
      },
    },
  };

  const getJson = (): string =>
    (screen.getByLabelText("JSON 编辑器") as HTMLTextAreaElement).value;

  it("改 base_url 字段 → env.ANTHROPIC_BASE_URL 跟随；env 无该键时不凭空创建", () => {
    render(<LlmProviderForm mode="edit" initial={WITH_ENV} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(
      screen.getByPlaceholderText(/https:\/\/api\.anthropic\.com/),
      { target: { value: "https://api.deepseek.com/anthropic" } },
    );
    const cfg = JSON.parse(getJson()) as {
      env: Record<string, string>;
    };
    expect(cfg.env.ANTHROPIC_BASE_URL).toBe("https://api.deepseek.com/anthropic");
    // 其它键（含空占位）不被联动误伤
    expect(cfg.env.ANTHROPIC_MODEL).toBe("glm-5.1");
    expect(cfg.env.ANTHROPIC_AUTH_TOKEN).toBe("");
  });

  it("切认证字段 → env 旧认证键空占位被删除（不再进提交体）", () => {
    render(<LlmProviderForm mode="edit" initial={WITH_ENV} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(
      screen.getByDisplayValue("ANTHROPIC_AUTH_TOKEN（默认，中转站常用）"),
      { target: { value: "ANTHROPIC_API_KEY" } },
    );
    const cfg = JSON.parse(getJson()) as {
      env: Record<string, string>;
    };
    expect(cfg.env).not.toHaveProperty("ANTHROPIC_AUTH_TOKEN");
    // 空占位直接删（无值不迁移新键）
    expect(cfg.env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(cfg.env.ANTHROPIC_MODEL).toBe("glm-5.1");
  });

  it("改兜底模型 / 角色模型 → env.ANTHROPIC_MODEL / 角色键跟随；清空字段 → 删键", () => {
    render(<LlmProviderForm mode="edit" initial={WITH_ENV} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    // 兜底模型（INITIAL.default_fallback_model=claude-opus-4-8 预填）
    fireEvent.change(
      screen.getByPlaceholderText(/未映射的角色都走这个模型/),
      { target: { value: "glm-5.3" } },
    );
    // sonnet 角色模型（INITIAL 无 sonnet 映射 → 空输入框）
    fireEvent.change(
      screen.getByPlaceholderText(/kimi-k2 \/ claude-sonnet-5/),
      { target: { value: "glm-5.3" } },
    );
    let cfg = JSON.parse(getJson()) as { env: Record<string, string> };
    expect(cfg.env.ANTHROPIC_MODEL).toBe("glm-5.3");
    expect(cfg.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("glm-5.3");
    // 清空兜底模型 → 删除 env 同名键（结构化字段是真相源）
    fireEvent.change(
      screen.getByPlaceholderText(/未映射的角色都走这个模型/),
      { target: { value: "" } },
    );
    cfg = JSON.parse(getJson()) as { env: Record<string, string> };
    expect(cfg.env).not.toHaveProperty("ANTHROPIC_MODEL");
  });

  it("env 无同名键时字段变更不创建键；JSON 非法时联动静默不崩", () => {
    const noEnvKey: LlmProviderRead = { ...INITIAL, settings_config: { env: {} } };
    render(
      <LlmProviderForm mode="edit" initial={noEnvKey} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    fireEvent.change(
      screen.getByPlaceholderText(/https:\/\/api\.anthropic\.com/),
      { target: { value: "https://x.example.com" } },
    );
    expect(JSON.parse(getJson())).toEqual({ env: {} }); // 未凭空创建

    // JSON 非法（用户手打到一半）：字段联动不崩、不丢输入
    fireEvent.change(screen.getByLabelText("JSON 编辑器"), {
      target: { value: "{ not valid json" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/https:\/\/api\.anthropic\.com/),
      { target: { value: "https://y.example.com" } },
    );
    expect(getJson()).toBe("{ not valid json");
  });
});

// ── agent_kind=pi 启用 + 认证字段泛化输入（task-07 / D-002@v1）──────────────
// design §5.2：pi 凭证行的 auth_field 为任意合法 env 变量名（pattern
// ^[A-Z][A-Z0-9_]*$，与 backend task-04 同款）；claude 侧两选项下拉与 env 改名
// 联动零回归。
describe("LlmProviderForm — agent_kind=pi（task-07 / D-002@v1）", () => {
  /** 把 Agent 种类下拉切到 pi（新建缺省 claude → pi）。 */
  const switchToPi = (): void => {
    fireEvent.change(screen.getByDisplayValue("Claude Code"), {
      target: { value: "pi" },
    });
  };

  it("pi 选项不再 disabled，切换后提交 values.agent_kind='pi'", async () => {
    const onSubmit = vi.fn();
    render(<LlmProviderForm mode="create" onSubmit={onSubmit} onCancel={vi.fn()} />);

    const kindSelect = screen.getByDisplayValue("Claude Code") as HTMLSelectElement;
    const piOption = kindSelect.querySelector(
      'option[value="pi"]',
    ) as HTMLOptionElement;
    expect(piOption.disabled).toBe(false);
    expect(piOption.textContent).toBe("Pi"); // 不再带「（即将支持）」后缀

    fireEvent.change(kindSelect, { target: { value: "pi" } });
    expect(kindSelect.value).toBe("pi");

    fireEvent.change(
      screen.getByPlaceholderText(/Kimi 中转 \/ 公司专用账号/),
      { target: { value: "Pi 独立凭证" } },
    );
    fireEvent.change(screen.getByPlaceholderText("sk-***"), {
      target: { value: "sk-pi-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建供应商" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const values = onSubmit.mock.calls[0]![0]!;
    expect(values.agent_kind).toBe("pi");
  });

  it("pi 时认证字段泛化为可输入 env 名，ZAI_API_KEY 随 payload 透传", async () => {
    const onSubmit = vi.fn();
    render(<LlmProviderForm mode="create" onSubmit={onSubmit} onCancel={vi.fn()} />);

    switchToPi();
    // claude 固定两选项下拉不再渲染
    expect(
      screen.queryByDisplayValue("ANTHROPIC_AUTH_TOKEN（默认，中转站常用）"),
    ).toBeNull();

    const authInput = screen.getByPlaceholderText(/ZAI_API_KEY/) as HTMLInputElement;
    expect(authInput.value).toBe("ANTHROPIC_AUTH_TOKEN"); // 承接 claude 缺省
    fireEvent.change(authInput, { target: { value: "ZAI_API_KEY" } });

    fireEvent.change(
      screen.getByPlaceholderText(/Kimi 中转 \/ 公司专用账号/),
      { target: { value: "Pi 独立凭证" } },
    );
    fireEvent.change(screen.getByPlaceholderText("sk-***"), {
      target: { value: "sk-pi-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建供应商" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const values = onSubmit.mock.calls[0]![0]!;
    expect(values.agent_kind).toBe("pi");
    expect(values.auth_field).toBe("ZAI_API_KEY");
    // lib 组装层（design §6 llm-providers.ts 行，execute 期曾在此吞 pi）：pi 表单经
    // formToCreate 产出的 POST body agent_kind==='pi' 且 auth_field 为所填 env 名
    // （backend task-04 已放开 env 名 pattern；createProvider 把该 body 原样 json 透传）。
    const body = formToCreate(values);
    expect(body.agent_kind).toBe("pi");
    expect(body.auth_field).toBe("ZAI_API_KEY");
  });

  it("pi 非法 env 名（小写 / 含空格）被即时校验拦下且不可提交", () => {
    const onSubmit = vi.fn();
    render(<LlmProviderForm mode="create" onSubmit={onSubmit} onCancel={vi.fn()} />);

    switchToPi();
    fireEvent.change(
      screen.getByPlaceholderText(/Kimi 中转 \/ 公司专用账号/),
      { target: { value: "Pi 独立凭证" } },
    );
    fireEvent.change(screen.getByPlaceholderText("sk-***"), {
      target: { value: "sk-pi-key" },
    });
    // 必填齐 → 提交本可用；认证字段非法才是唯一拦截项
    expect(screen.getByRole("button", { name: "创建供应商" })).toBeEnabled();

    // 小写开头非法
    fireEvent.change(screen.getByPlaceholderText(/ZAI_API_KEY/), {
      target: { value: "zai_api_key" },
    });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "创建供应商" })).toBeDisabled();

    // 含空格同样非法（不吞值，用户可见可改）
    fireEvent.change(screen.getByPlaceholderText(/ZAI_API_KEY/), {
      target: { value: "ZAI API_KEY" },
    });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "创建供应商" })).toBeDisabled();

    // 修正为合法值后恢复可提交
    fireEvent.change(screen.getByPlaceholderText(/ZAI_API_KEY/), {
      target: { value: "ZAI_API_KEY" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "创建供应商" })).toBeEnabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("claude 路径零回归：认证字段仍是既有两选项下拉，gemini 仍 disabled 占位（codex 已启用）", () => {
    render(<LlmProviderForm mode="create" onSubmit={vi.fn()} onCancel={vi.fn()} />);

    // 固定下拉仍在且缺省 ANTHROPIC_AUTH_TOKEN
    expect(
      screen.getByDisplayValue("ANTHROPIC_AUTH_TOKEN（默认，中转站常用）"),
    ).toBeTruthy();
    // pi 自由输入不渲染
    expect(screen.queryByPlaceholderText(/ZAI_API_KEY/)).toBeNull();

    const kindSelect = screen.getByDisplayValue("Claude Code") as HTMLSelectElement;
    // task-06 起 codex 启用（凭证走 daemon CODEX_HOME 文件注入）；仅 gemini 占位。
    expect(
      (kindSelect.querySelector('option[value="codex"]') as HTMLOptionElement)
        .disabled,
    ).toBe(false);
    expect(
      (kindSelect.querySelector('option[value="gemini"]') as HTMLOptionElement)
        .disabled,
    ).toBe(true);
  });
});

// ── agent_kind=codex 启用（multi-provider-injection task-06 / FR-05）────────
// D-005/D-006：codex 凭证经 daemon per-session CODEX_HOME 文件注入（写盘器
// task-01），不经 env auth_field；agent_kind 词表 backend task-05 已增 codex
// （仅 Create），前端表单跟进放开选项。
describe("LlmProviderForm — agent_kind=codex（task-06 / FR-05）", () => {
  /** 把 Agent 种类下拉切到 codex（新建缺省 claude → codex）。 */
  const switchToCodex = (): void => {
    fireEvent.change(screen.getByDisplayValue("Claude Code"), {
      target: { value: "codex" },
    });
  };

  it("codex 选项不再 disabled（标签无「即将支持」后缀），切换后提交 values.agent_kind='codex'", async () => {
    const onSubmit = vi.fn();
    render(<LlmProviderForm mode="create" onSubmit={onSubmit} onCancel={vi.fn()} />);

    const kindSelect = screen.getByDisplayValue("Claude Code") as HTMLSelectElement;
    const codexOption = kindSelect.querySelector(
      'option[value="codex"]',
    ) as HTMLOptionElement;
    expect(codexOption.disabled).toBe(false);
    expect(codexOption.textContent).toBe("Codex"); // 照 pi 先例：启用后不带后缀

    fireEvent.change(kindSelect, { target: { value: "codex" } });
    expect(kindSelect.value).toBe("codex");

    fireEvent.change(
      screen.getByPlaceholderText(/Kimi 中转 \/ 公司专用账号/),
      { target: { value: "Codex 官方号" } },
    );
    fireEvent.change(screen.getByPlaceholderText("sk-***"), {
      target: { value: "sk-codex-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建供应商" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const values = onSubmit.mock.calls[0]![0]!;
    expect(values.agent_kind).toBe("codex");
    // lib 组装层：formToCreate 产出的 POST body agent_kind 透传 codex
    const body = formToCreate(values);
    expect(body.agent_kind).toBe("codex");
  });

  it("编辑态 initial.agent_kind='codex' 回填 codex（未知值仍归一 claude 的边界不回归）", async () => {
    const onSubmit = vi.fn();
    render(
      <LlmProviderForm
        mode="edit"
        initial={{ ...INITIAL, agent_kind: "codex", name: "Codex 行" }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    const kindSelect = screen.getByDisplayValue("Codex") as HTMLSelectElement;
    expect(kindSelect.value).toBe("codex");

    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]!.agent_kind).toBe("codex");
  });

  it("从 pi（自由 env 名）切到 codex → auth_field 归一回缺省（下拉不出无匹配空值）", () => {
    render(<LlmProviderForm mode="create" onSubmit={vi.fn()} onCancel={vi.fn()} />);
    // 先切 pi 填自由 env 名
    fireEvent.change(screen.getByDisplayValue("Claude Code"), {
      target: { value: "pi" },
    });
    fireEvent.change(screen.getByPlaceholderText(/ZAI_API_KEY/), {
      target: { value: "ZAI_API_KEY" },
    });
    // 切 codex：认证字段块按 claude 形态渲染（codex 不消费 auth_field），
    // pi 自由输入值不在两选项内 → 归一回缺省（照切 claude 同款先例）。
    fireEvent.change(screen.getByDisplayValue("Pi"), {
      target: { value: "codex" },
    });
    expect(
      screen.getByDisplayValue("ANTHROPIC_AUTH_TOKEN（默认，中转站常用）"),
    ).toBeTruthy();
  });
});

// ── pi × openai_chat 禁选（task-06 / FR-05 / D-012 连带声明）────────────────
// 与 backend 422 逐字对齐（schema._forbid_pi_openai_chat / service.update）：
// pi env 层不带端点、文件层 models.json 仅 anthropic 形态直连，openai_chat
// 通道对 pi 无消费方。codex/claude × openai_chat 不受限。
describe("LlmProviderForm — pi × openai_chat 禁选（task-06 / FR-05）", () => {
  it("pi 选中时 openai_chat 选项 disabled + 禁配提示可见；anthropic 仍可选", () => {
    render(<LlmProviderForm mode="create" onSubmit={vi.fn()} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByDisplayValue("Claude Code"), {
      target: { value: "pi" },
    });

    const formatSelect = screen.getAllByRole("combobox").find(
      (s) => (s as HTMLSelectElement).value === "anthropic",
    ) as HTMLSelectElement;
    const openaiOption = formatSelect.querySelector(
      'option[value="openai_chat"]',
    ) as HTMLOptionElement;
    const anthropicOption = formatSelect.querySelector(
      'option[value="anthropic"]',
    ) as HTMLOptionElement;
    expect(openaiOption.disabled).toBe(true);
    expect(anthropicOption.disabled).toBe(false);
    // 禁配说明（与后端 422 文案对齐的原因部分）
    expect(
      screen.getByText(/pi 供应商不支持 openai_chat API 格式（两层注入均不生效）/),
    ).toBeTruthy();
  });

  it("openai_chat 状态下切到 pi → api_format 归一回 anthropic（照 authField 归一先例）", () => {
    render(<LlmProviderForm mode="create" onSubmit={vi.fn()} onCancel={vi.fn()} />);

    // 先切 OpenAI Chat（claude 允许）
    const formatSelect = screen.getAllByRole("combobox").find(
      (s) => (s as HTMLSelectElement).value === "anthropic",
    ) as HTMLSelectElement;
    fireEvent.change(formatSelect, { target: { value: "openai_chat" } });

    // 切 pi → 归一回 anthropic，不出「选中着 disabled 项」的悬挂态
    fireEvent.change(screen.getByDisplayValue("Claude Code"), {
      target: { value: "pi" },
    });
    const after = screen.getAllByRole("combobox").find(
      (s) => (s as HTMLSelectElement).value === "anthropic",
    ) as HTMLSelectElement;
    expect(after).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull(); // 归一后无报错态
  });

  it("存量 pi×openai_chat 行进编辑态（绕过下拉的路径）→ 报错文案与后端 422 逐字一致且提交被拦", async () => {
    const onSubmit = vi.fn();
    render(
      <LlmProviderForm
        mode="edit"
        initial={{ ...INITIAL, agent_kind: "pi", api_format: "openai_chat" }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    // 兜底报错可见（提交前校验拦绕过）
    expect(screen.getByRole("alert").textContent).toBe(
      "pi 供应商不支持 openai_chat API 格式（两层注入均不生效），请改用 anthropic 格式或选择 codex/claude 供应商",
    );
    // 名称已预填（编辑态 api_key 非必填）→ 禁配才是唯一拦截项
    expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();

    // 切回 anthropic → 恢复可提交，payload api_format=anthropic
    const formatSelect = screen.getAllByRole("combobox").find(
      (s) => (s as HTMLSelectElement).value === "openai_chat",
    ) as HTMLSelectElement;
    fireEvent.change(formatSelect, { target: { value: "anthropic" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]!.api_format).toBe("anthropic");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("claude/codex × openai_chat 不受限：openai_chat 选项可正常选择与提交", async () => {
    const onSubmit = vi.fn();
    render(<LlmProviderForm mode="create" onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByDisplayValue("Claude Code"), {
      target: { value: "codex" },
    });
    const formatSelect = screen.getAllByRole("combobox").find(
      (s) => (s as HTMLSelectElement).value === "anthropic",
    ) as HTMLSelectElement;
    const openaiOption = formatSelect.querySelector(
      'option[value="openai_chat"]',
    ) as HTMLOptionElement;
    expect(openaiOption.disabled).toBe(false);
    expect(screen.queryByText(/pi 供应商不支持/)).toBeNull(); // pi 禁配提示不出现在 codex 下

    fireEvent.change(formatSelect, { target: { value: "openai_chat" } });
    fireEvent.change(
      screen.getByPlaceholderText(/Kimi 中转 \/ 公司专用账号/),
      { target: { value: "Codex LiteLLM 通道" } },
    );
    fireEvent.change(screen.getByPlaceholderText("sk-***"), {
      target: { value: "sk-x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建供应商" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const values = onSubmit.mock.calls[0]![0]!;
    expect(values.agent_kind).toBe("codex");
    expect(values.api_format).toBe("openai_chat");
  });

  it("pi 时 baseUrl 提示明示自定义端点语义（填=文件层三文件，空=官方端点 env 层）", () => {
    render(<LlmProviderForm mode="create" onSubmit={vi.fn()} onCancel={vi.fn()} />);
    // claude 下不出现 pi 专属提示
    expect(screen.queryByText(/自定义端点/)).toBeNull();

    fireEvent.change(screen.getByDisplayValue("Claude Code"), {
      target: { value: "pi" },
    });
    expect(
      screen.getByText(/auth\.json \/ models\.json \/ settings\.json 三文件/),
    ).toBeTruthy();
    expect(screen.getByText(/留空=官方端点/)).toBeTruthy();
  });
});

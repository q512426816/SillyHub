/**
 * task-11：LlmProviderSection 列表单测（task-09 / D-006）。
 *
 * 覆盖：
 *   1. 进页面自动对可查用量的供应商查一次（UsageFooter 挂载即查），不可查的不查；
 *   2. 💰 可查用量徽标仅出现在可查供应商行；
 *   3. 不可查供应商行展示中性文案「该供应商暂不支持余额查询」；
 *   4. ql-20260820-006：启动/停止（set-default）入口已移除，列表只做纯 CRUD。
 *
 * vi.mock 整个 api 模块（listProviders / queryUsage / detectUsageProvider 等），不打真实
 * 网络。LlmProviderSection 用 useNotify → 需在 <AntdProviders>（含 antd <App>）内渲染。
 *
 * 注：task 卡的「查余额按钮手动刷新」由 UsageFooter 内置刷新图标承载（紧贴数据更直观，
 * 自动查使独立按钮冗余）—— 见 usage-footer.test.tsx 的 keep-last-good 用例覆盖手动刷新。
 */
import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { AntdProviders } from "@/components/antd-providers";
import { LlmProviderSection } from "@/components/llm-providers/llm-provider-list";

vi.mock("@/lib/api/llm-providers", () => ({
  listProviders: vi.fn(),
  queryUsage: vi.fn(),
  detectUsageProvider: vi.fn(),
  createProvider: vi.fn(),
  deleteProvider: vi.fn(),
  updateProvider: vi.fn(),
  formToCreate: vi.fn(),
  formToUpdate: vi.fn(),
}));

import {
  listProviders,
  queryUsage,
  detectUsageProvider,
  type LlmProviderRead,
} from "@/lib/api/llm-providers";

const mockedList = listProviders as ReturnType<typeof vi.fn>;
const mockedQueryUsage = queryUsage as ReturnType<typeof vi.fn>;
const mockedDetect = detectUsageProvider as ReturnType<typeof vi.fn>;

const baseProvider = (over: Partial<LlmProviderRead>): LlmProviderRead => ({
  id: "p-x",
  user_id: "u-1",
  name: "供应商",
  agent_kind: "claude",
  base_url: null,
  model: null,
  notes: null,
  website_url: null,
  auth_field: "ANTHROPIC_AUTH_TOKEN",
  api_format: "anthropic",
  model_role_mappings: null,
  default_fallback_model: null,
  extra_env: null,
  settings_config: null,
  is_default: false,
  api_key_masked: "sk-x...abcd",
  created_at: "2026-07-28T10:00:00Z",
  updated_at: "2026-07-28T10:00:00Z",
  ...over,
});

const DETECTABLE = baseProvider({
  id: "p-deepseek",
  name: "DeepSeek 测试",
  base_url: "https://api.deepseek.com/anthropic",
});
const NON_DETECTABLE = baseProvider({
  id: "p-anthropic",
  name: "Anthropic 官方",
  base_url: "https://api.anthropic.com",
});

describe("LlmProviderSection — 用量挂载 + 自动查（task-09 / D-006）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedList.mockResolvedValue([DETECTABLE, NON_DETECTABLE]);
    // detect：含 deepseek → balance；其余（anthropic）→ null
    mockedDetect.mockImplementation((url: string | null) =>
      (url ?? "").includes("deepseek") ? "balance" : null,
    );
    mockedQueryUsage.mockResolvedValue({
      success: true,
      data: [{ plan_name: "CNY", remaining: 10, total: null, used: null, unit: "CNY" }],
    });
  });

  it("进页面自动对可查供应商查一次用量，不可查的不查", async () => {
    render(
      <AntdProviders>
        <LlmProviderSection />
      </AntdProviders>,
    );

    // 可查供应商（DeepSeek）被查
    await waitFor(() => expect(mockedQueryUsage).toHaveBeenCalledWith("p-deepseek"));
    // 不可查供应商（Anthropic）不被查（detect=null → footer 静态文案，不发请求）
    expect(mockedQueryUsage).not.toHaveBeenCalledWith("p-anthropic");
  });

  it("💰 可查用量徽标仅出现在可查供应商行", async () => {
    render(
      <AntdProviders>
        <LlmProviderSection />
      </AntdProviders>,
    );

    await waitFor(() =>
      expect(screen.getByText("DeepSeek 测试")).toBeInTheDocument(),
    );
    // 仅 DeepSeek 行带「支持余额查询」徽标
    expect(screen.getAllByTitle("支持余额查询")).toHaveLength(1);
  });

  it("不可查供应商行展示中性文案「该供应商暂不支持余额查询」", async () => {
    render(
      <AntdProviders>
        <LlmProviderSection />
      </AntdProviders>,
    );

    expect(
      await screen.findByText("该供应商暂不支持余额查询"),
    ).toBeInTheDocument();
  });

  it("列表行不再渲染启动/停止按钮（ql-20260820-006，供应商生效改 /sessions 会话级选择）", async () => {
    render(
      <AntdProviders>
        <LlmProviderSection />
      </AntdProviders>,
    );

    await screen.findByText("DeepSeek 测试");
    expect(screen.queryByRole("button", { name: /启动/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /停止/ })).toBeNull();
  });
});

// task-06 openai 徽标（set-default 启动流程已随 ql-20260820-006 移除）
describe("LlmProviderSection — openai 格式徽标（task-06）", () => {
  const OPENAI_PROVIDER = baseProvider({
    id: "p-openai",
    name: "Zen OpenAI",
    api_format: "openai_chat",
    base_url: "https://opencode.ai/zen/v1/chat/completions",
  });
  const ANTHROPIC_PROVIDER = baseProvider({
    id: "p-anthropic",
    name: "Anthropic 官方",
    api_format: "anthropic",
    base_url: "https://api.anthropic.com",
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockedList.mockResolvedValue([OPENAI_PROVIDER, ANTHROPIC_PROVIDER]);
    mockedDetect.mockReturnValue(null);
    mockedQueryUsage.mockResolvedValue({ success: true, data: [] });
  });

  it("openai 格式行渲染 OpenAI 徽标，anthropic 行无该徽标", async () => {
    render(
      <AntdProviders>
        <LlmProviderSection />
      </AntdProviders>,
    );
    await screen.findByText("Zen OpenAI");
    expect(
      screen.getAllByTitle("OpenAI 格式（经 LiteLLM 网关消费）"),
    ).toHaveLength(1);
  });
});

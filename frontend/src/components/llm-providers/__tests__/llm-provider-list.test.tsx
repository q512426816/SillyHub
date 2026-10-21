/**
 * task-11：LlmProviderSection 列表单测（task-09 / D-006）。
 *
 * 覆盖：
 *   1. 进页面自动对可查用量的供应商查一次（UsageFooter 挂载即查），不可查的不查；
 *   2. 💰 可查用量徽标仅出现在可查供应商行；
 *   3. 不可查供应商行展示中性文案「该供应商暂不支持余额查询」；
 *   4. 2026-10-21-provider-set-default-ui：恢复「设为默认/取消默认」入口（默认行
 *      徽标 + 对称操作 + 探测失败不刷新）；旧「启动/停止」文案不再出现。
 *
 * vi.mock 整个 api 模块（listProviders / queryUsage / detectUsageProvider 等），不打真实
 * 网络。LlmProviderSection 用 useNotify → 需在 <AntdProviders>（含 antd <App>）内渲染。
 *
 * 注：task 卡的「查余额按钮手动刷新」由 UsageFooter 内置刷新图标承载（紧贴数据更直观，
 * 自动查使独立按钮冗余）—— 见 usage-footer.test.tsx 的 keep-last-good 用例覆盖手动刷新。
 */
import { beforeEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AntdProviders } from "@/components/antd-providers";
import { LlmProviderSection } from "@/components/llm-providers/llm-provider-list";

vi.mock("@/lib/api/llm-providers", () => ({
  listProviders: vi.fn(),
  queryUsage: vi.fn(),
  detectUsageProvider: vi.fn(),
  createProvider: vi.fn(),
  deleteProvider: vi.fn(),
  updateProvider: vi.fn(),
  setDefaultProvider: vi.fn(),
  unsetDefaultProvider: vi.fn(),
  formToCreate: vi.fn(),
  formToUpdate: vi.fn(),
}));

import {
  listProviders,
  queryUsage,
  detectUsageProvider,
  setDefaultProvider,
  unsetDefaultProvider,
  type LlmProviderRead,
} from "@/lib/api/llm-providers";

const mockedList = listProviders as ReturnType<typeof vi.fn>;
const mockedQueryUsage = queryUsage as ReturnType<typeof vi.fn>;
const mockedDetect = detectUsageProvider as ReturnType<typeof vi.fn>;
const mockedSetDefault = setDefaultProvider as ReturnType<typeof vi.fn>;
const mockedUnsetDefault = unsetDefaultProvider as ReturnType<typeof vi.fn>;

const baseProvider = (over: Partial<LlmProviderRead>): LlmProviderRead => ({
  id: "p-x",
  user_id: "u-1",
  name: "供应商",
  agent_kinds: ["claude"],
  base_url: null,
  models: [],
  notes: null,
  website_url: null,
  auth_field: "ANTHROPIC_AUTH_TOKEN",
  api_format: "anthropic",
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

  it("列表行不再渲染启动/停止按钮（2026-10-21 恢复的入口统一叫「设为默认/取消默认」）", async () => {
    render(
      <AntdProviders>
        <LlmProviderSection />
      </AntdProviders>,
    );

    await screen.findByText("DeepSeek 测试");
    expect(screen.queryByRole("button", { name: /启动/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /停止/ })).toBeNull();
    // 新入口（FR-01）：非默认行渲染「设为默认」。
    expect(screen.getAllByRole("button", { name: "设为默认" })).toHaveLength(2);
  });
});

// 2026-10-21-provider-set-default-ui：设为默认/取消默认交互（FR-01/02）。
describe("LlmProviderSection — 设为默认 / 取消默认（2026-10-21-provider-set-default-ui）", () => {
  const DEFAULTED = baseProvider({
    id: "p-default",
    name: "默认供应商",
    base_url: "https://api.deepseek.com/anthropic",
    is_default: true,
  });
  const PLAIN = baseProvider({
    id: "p-plain",
    name: "普通供应商",
    base_url: "https://api.kimi.com/anthropic",
    is_default: false,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockedList.mockResolvedValue([DEFAULTED, PLAIN]);
    mockedDetect.mockReturnValue(null);
    mockedQueryUsage.mockResolvedValue({ success: true, data: [] });
  });

  it("默认行显示「默认」徽标与「取消默认」，非默认行显示「设为默认」（FR-01 场景）", async () => {
    render(
      <AntdProviders>
        <LlmProviderSection />
      </AntdProviders>,
    );

    await screen.findByText("默认供应商");
    expect(screen.getByText("默认")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "取消默认" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "设为默认" })).toHaveLength(1);
  });

  it("设为默认成功 → 调 API + toast「已设为默认，新会话生效」+ 刷新列表（FR-01 主路径）", async () => {
    mockedSetDefault.mockResolvedValue({
      switched: true,
      affected_sessions: 0,
      error: null,
    });
    render(
      <AntdProviders>
        <LlmProviderSection />
      </AntdProviders>,
    );

    await screen.findByText("普通供应商");
    fireEvent.click(screen.getByRole("button", { name: "设为默认" }));

    await waitFor(() => expect(mockedSetDefault).toHaveBeenCalledWith("p-plain"));
    expect(await screen.findByText("已设为默认，新会话生效")).toBeInTheDocument();
    // 操作后 reload 列表（初始 load + 操作后共 ≥2 次）。
    await waitFor(() => expect(mockedList.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("凭证探测失败（switched=false）→ toast 后端 error 且不刷新（FR-01 探测失败场景）", async () => {
    mockedSetDefault.mockResolvedValue({
      switched: false,
      affected_sessions: 0,
      error: "凭证无效：401",
    });
    render(
      <AntdProviders>
        <LlmProviderSection />
      </AntdProviders>,
    );

    await screen.findByText("普通供应商");
    const callsBefore = mockedList.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "设为默认" }));

    expect(await screen.findByText(/凭证无效：401/)).toBeInTheDocument();
    // 状态不变：不 reload（探测失败未置位）。
    expect(mockedList.mock.calls.length).toBe(callsBefore);
    expect(screen.queryByText("已设为默认，新会话生效")).toBeNull();
  });

  it("取消默认成功 → 调 API + toast + 刷新（FR-01 取消场景）", async () => {
    mockedUnsetDefault.mockResolvedValue({
      switched: true,
      affected_sessions: 0,
      error: null,
    });
    render(
      <AntdProviders>
        <LlmProviderSection />
      </AntdProviders>,
    );

    await screen.findByText("默认供应商");
    fireEvent.click(screen.getByRole("button", { name: "取消默认" }));

    await waitFor(() => expect(mockedUnsetDefault).toHaveBeenCalledWith("p-default"));
    expect(await screen.findByText(/已取消默认/)).toBeInTheDocument();
    await waitFor(() => expect(mockedList.mock.calls.length).toBeGreaterThanOrEqual(2));
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

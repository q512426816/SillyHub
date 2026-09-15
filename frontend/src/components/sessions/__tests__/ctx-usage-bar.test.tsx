// task-15（2026-08-14-sessions-portal / FR-08 / D-009@v1 / D-014@v1）：
// CtxUsageRing + QuotaPill 单元测试。
//
// 覆盖：
//   - 分母三级降级链（one_m→1000K / 常量 200K / 无分母只显示累计）；
//   - 阈值变色（50 / 80 边界，≥50 黄 ≥80 红）；
//   - 点击详情浮层（占比 / 已用总量 / 口径说明——2026-08-27-session-token-
//     usage-fix task-08 起为「最近一次模型调用」新口径文案）；
//   - usedTokens={null} 未知态（task-09 / FR-01 / D-003：中心「—」不算百分比，
//     历史会话 / 旧 daemon 不上报 ctx 的渲染分支）；
//   - quota 正常窗口渲染、低剩余变色、reset 时间格式化；
//   - quick-e4d0551f（2026-09-15 用户要求）：QuotaPill 全供应商聚合 + 30s 轮询——
//     智谱走 quota 端点 / Kimi·MiniMax·DeepSeek·硅基·OpenRouter 走 usage 端点、
//     不可查供应商不发起请求、providerId=null（本机默认）照常聚合、多家排序
//     （会话供应商优先 + 等N家）、30s 到点重查、瞬时失败 keep-last-good、
//     鉴权失效（is_valid=false）清除条目、usage tier 归一纯函数 mapUsageTiersToViews；
//   - 2026-09-14-session-ctx-compact task-06（FR-06 / FR-07）：环浮层「压缩
//     上下文」按钮三分支——caps.compact=false（cursor）/未提供 onCompact 不
//     渲染；claude/pi/codex 渲染 + 点击上抛；compactDisabled 禁用态 + tooltip。
//
// mock：@/lib/api/llm-providers 的 listProviders / getProviderQuota / queryUsage
// （detectUsageProvider 用真实实现——base_url 子串判定是纯函数，与后端逐字一致）。
// QuotaPill 内部经 react-query 拉供应商列表，用例以 QueryClientProvider 包裹
// （retry:false / gcTime:0 / refetchInterval:false，对齐 session-list-panel 惯例）。
// jsdom 已知坑：antd Popover 内容经 portal 挂 body，断言用 await screen.findByText；
// 本组件无 MarkdownText/dynamic 依赖，无需 mock。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  CtxUsageRing,
  QuotaPill,
  CtxUsageBar,
  resolveCtxWindowTokens,
  formatQuotaResetTime,
  mapUsageTiersToViews,
  QUOTA_REFRESH_INTERVAL_MS,
  QUOTA_HOVER_REFRESH_DELAY_MS,
  ONE_M_CTX_WINDOW_TOKENS,
  DEFAULT_CTX_WINDOW_TOKENS,
  FALLBACK_CTX_WINDOW_TOKENS,
} from "../ctx-usage-bar";
import {
  getProviderQuota,
  listProviders,
  queryUsage,
} from "@/lib/api/llm-providers";
import type {
  LlmProviderQuotaResponse,
  LlmProviderRead,
  UsageResult,
} from "@/lib/api/llm-providers";

vi.mock("@/lib/api/llm-providers", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/api/llm-providers")
  >()),
  listProviders: vi.fn(),
  getProviderQuota: vi.fn(),
  queryUsage: vi.fn(),
}));

const mockListProviders = vi.mocked(listProviders);
const mockGetProviderQuota = vi.mocked(getProviderQuota);
const mockQueryUsage = vi.mocked(queryUsage);

function quotaResp(
  quota: LlmProviderQuotaResponse["quota"],
): LlmProviderQuotaResponse {
  return { quota };
}

/** 供应商 fixture：缺省为智谱（bigmodel.cn → token_plan + quota 端点分支）。 */
function provider(over: Partial<LlmProviderRead> = {}): LlmProviderRead {
  return {
    id: "p-zhipu",
    user_id: "u-1",
    name: "智谱GLM",
    agent_kind: "pi",
    base_url: "https://open.bigmodel.cn/api/anthropic",
    model: null,
    notes: null,
    website_url: null,
    auth_field: "ZAI_API_KEY",
    api_format: "anthropic",
    model_role_mappings: null,
    default_fallback_model: null,
    extra_env: null,
    is_default: false,
    multimodal: "auto",
    api_key_masked: null,
    created_at: "2026-09-15T00:00:00",
    updated_at: "2026-09-15T00:00:00",
    ...over,
  };
}

/** QuotaPill 用例统一包裹（react-query 依赖 QueryClientProvider）。 */
function renderPill(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchInterval: false },
      mutations: { retry: false },
    },
  });
  const utils = render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
  return {
    ...utils,
    // RTL rerender 替换整棵树——自动补回 Provider，调用方传裸组件即可。
    rerender: (next: React.ReactElement) =>
      utils.rerender(
        <QueryClientProvider client={client}>{next}</QueryClientProvider>,
      ),
  };
}

beforeEach(() => {
  mockListProviders.mockReset();
  mockGetProviderQuota.mockReset();
  mockQueryUsage.mockReset();
  // 缺省无可查供应商 → QuotaPill 整体不渲染（CtxUsageRing 用例不受额度 mock 影响）。
  mockListProviders.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

// ── resolveCtxWindowTokens：分母四级解析链（D-014@v1 + ql-20260831-002 覆盖层）──

describe("resolveCtxWindowTokens（分母四级解析链）", () => {
  it("第 0 级：会话覆盖（windowOverride）最优先——压过 one_m 与常量表", () => {
    expect(resolveCtxWindowTokens(256_000, { model: "glm-4.6", one_m: true }, null)).toBe(
      256_000,
    );
    expect(resolveCtxWindowTokens(512_000, { model: "glm-4.6" }, null)).toBe(512_000);
  });

  it("第 1 级：role mapping one_m=true → 1M（供应商配置派生）", () => {
    expect(
      resolveCtxWindowTokens(null, { model: "glm-4.6", one_m: true }, null),
    ).toBe(ONE_M_CTX_WINDOW_TOKENS);
  });

  it("第 2 级：有模型名（常量表命中或默认）→ 200K", () => {
    expect(resolveCtxWindowTokens(null, { model: "glm-4.6" }, null)).toBe(
      DEFAULT_CTX_WINDOW_TOKENS,
    );
    // role mapping 无 model，回退 default_fallback_model
    expect(resolveCtxWindowTokens(null, null, "claude-sonnet-4-5")).toBe(
      DEFAULT_CTX_WINDOW_TOKENS,
    );
  });

  it("第 3 级：无 one_m 也无模型名 → 兜底 1M（本地模型读不到窗口大小不为空）", () => {
    expect(resolveCtxWindowTokens(null, null, null)).toBe(FALLBACK_CTX_WINDOW_TOKENS);
    expect(resolveCtxWindowTokens(null, {}, "  ")).toBe(FALLBACK_CTX_WINDOW_TOKENS);
  });

  it("非法覆盖值（0/负数/NaN）忽略，落回自动链", () => {
    expect(resolveCtxWindowTokens(0, { model: "glm-4.6" }, null)).toBe(
      DEFAULT_CTX_WINDOW_TOKENS,
    );
    expect(resolveCtxWindowTokens(-5, null, null)).toBe(FALLBACK_CTX_WINDOW_TOKENS);
    expect(resolveCtxWindowTokens(Number.NaN, null, null)).toBe(
      FALLBACK_CTX_WINDOW_TOKENS,
    );
  });
});

// ── CtxUsageRing：环渲染 / 阈值变色 / 详情浮层 ────────────────────────────

describe("CtxUsageRing", () => {
  it("显示占比百分比：100K / 200K = 50%", () => {
    renderPill(
      <CtxUsageRing usedTokens={100_000} roleMapping={{ model: "glm-4.6" }} />,
    );
    expect(screen.getByTestId("ctx-ring").textContent).toContain("50%");
  });

  it("阈值边界：≥50% 变黄（text-warning）", () => {
    const { rerender } = render(
      <CtxUsageRing usedTokens={100_000} roleMapping={{ model: "glm-4.6" }} />,
    );
    expect(screen.getByTestId("ctx-ring").className).toContain("text-warning");
    // 49% 仍为默认主色
    rerender(
      <CtxUsageRing usedTokens={98_000} roleMapping={{ model: "glm-4.6" }} />,
    );
    expect(screen.getByTestId("ctx-ring").className).toContain("text-primary");
  });

  it("阈值边界：≥80% 变红（text-error），超量封顶 100%", () => {
    renderPill(
      <CtxUsageRing usedTokens={160_000} roleMapping={{ model: "glm-4.6" }} />,
    );
    const ring = screen.getByTestId("ctx-ring");
    expect(ring.textContent).toContain("80%");
    expect(ring.className).toContain("text-error");
  });

  it("超量封顶：用量超过分母显示 100% 不溢出", () => {
    renderPill(
      <CtxUsageRing usedTokens={999_999} roleMapping={{ model: "glm-4.6" }} />,
    );
    expect(screen.getByTestId("ctx-ring").textContent).toContain("100%");
  });

  it("第 1 级分母：one_m=true 按 1000K 计（500K → 50%）", () => {
    renderPill(
      <CtxUsageRing
        usedTokens={500_000}
        roleMapping={{ model: "glm-4.6", one_m: true }}
      />,
    );
    expect(screen.getByTestId("ctx-ring").textContent).toContain("50%");
  });

  it("第 3 级分母：无派生来源兜底 1M，按占比显示（ql-20260831-002 不再无分母）", () => {
    renderPill(<CtxUsageBar usedTokens={12_345} />);
    const ring = screen.getByTestId("ctx-ring");
    // 12,345 / 1,000,000 = 1.2% → 中心取整 1%
    expect(ring.textContent).toContain("1%");
  });

  it("会话覆盖分母：200K 模型手动指定 400K → 占比按覆盖值计算", () => {
    renderPill(
      <CtxUsageRing
        usedTokens={100_000}
        roleMapping={{ model: "glm-4.6" }}
        windowOverride={400_000}
      />,
    );
    expect(screen.getByTestId("ctx-ring").textContent).toContain("25%");
  });

  it("点击环显示详情浮层（占比 / 已用总量 / 口径说明）", async () => {
    renderPill(
      <CtxUsageRing usedTokens={100_000} roleMapping={{ model: "glm-4.6" }} />,
    );
    fireEvent.click(screen.getByTestId("ctx-ring"));
    expect(await screen.findByText("上下文窗口用量")).toBeInTheDocument();
    expect(await screen.findByText("50.0%")).toBeInTheDocument();
    expect(screen.getByText("100.0K / 200.0K")).toBeInTheDocument();
    // 口径说明——task-08（2026-08-27-session-token-usage-fix FR-01）改新口径：
    // 分子=最近一次模型调用的提示词大小（含缓存命中部分），不再是会话累计求和。
    expect(
      screen.getByText(/最近一次模型调用的提示词大小（含缓存命中部分）/),
    ).toBeInTheDocument();
  });

  // task-09（2026-08-27-session-token-usage-fix / FR-01 / D-003）：
  // 分子未知（历史会话 / 旧 daemon 不上报 ctx）→ 环未知态——中心「—」、
  // 不算百分比（旧类型 Σ=0 口径会显示 0.0%，X-09 即为此坑）。
  it("usedTokens={null}（有分母）→ 环中心「—」、无百分比、浮层「用量占比 未知」与已用分子「—」", async () => {
    renderPill(
      <CtxUsageRing usedTokens={null} roleMapping={{ model: "glm-4.6" }} />,
    );
    const ring = screen.getByTestId("ctx-ring");
    expect(ring).toHaveTextContent("—");
    expect(ring.textContent).not.toContain("%");
    // title 含未知文案（悬浮提示不显示 0.0%）
    expect(ring).toHaveAttribute(
      "title",
      "上下文用量未知（暂无本次调用量数据）",
    );

    fireEvent.click(ring);
    expect(await screen.findByText("上下文窗口用量")).toBeInTheDocument();
    // 浮层：用量占比 = 未知（非 0.0%）；已用分子 = 「—」，分母照常派生 200K。
    expect(screen.getByText("未知")).toBeInTheDocument();
    expect(screen.getByText("— / 200.0K")).toBeInTheDocument();
    expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
  });

  // ql-20260831-002：环浮层窗口总量编辑器（onWindowOverrideChange 存在才渲染）。
  it("无 onWindowOverrideChange → 浮层不渲染编辑器（只读展示）", async () => {
    renderPill(<CtxUsageRing usedTokens={100_000} roleMapping={{ model: "glm-4.6" }} />);
    fireEvent.click(screen.getByTestId("ctx-ring"));
    expect(await screen.findByText("上下文窗口用量")).toBeInTheDocument();
    expect(screen.queryByTestId("ctx-window-editor")).not.toBeInTheDocument();
  });

  it("编辑器保存 → onWindowOverrideChange 上抛显式值；「恢复默认」仅覆盖态可见", async () => {
    const onChange = vi.fn();
    renderPill(
      <CtxUsageRing
        usedTokens={100_000}
        roleMapping={{ model: "glm-4.6" }}
        onWindowOverrideChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("ctx-ring"));
    const editor = await screen.findByTestId("ctx-window-editor");
    expect(editor).toBeInTheDocument();
    // 无覆盖 → 不渲染「恢复默认」
    expect(screen.queryByTestId("ctx-window-reset")).not.toBeInTheDocument();

    // 改值后保存 → 上抛 400000
    const input = screen.getByLabelText("上下文窗口总量");
    fireEvent.change(input, { target: { value: "400000" } });
    fireEvent.click(screen.getByTestId("ctx-window-save"));
    expect(onChange).toHaveBeenCalledWith(400000);

    // 覆盖态 → 恢复默认按钮出现，点击上抛 null
    renderPill(
      <CtxUsageRing
        usedTokens={100_000}
        roleMapping={{ model: "glm-4.6" }}
        windowOverride={400_000}
        onWindowOverrideChange={onChange}
      />,
    );
    const secondRing = screen.getAllByTestId("ctx-ring")[1];
    expect(secondRing).toBeDefined();
    fireEvent.click(secondRing!);
    expect(await screen.findByTestId("ctx-window-reset")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("ctx-window-reset"));
    expect(onChange).toHaveBeenCalledWith(null);

    // 覆盖态浮层「已用 / 总量」带（手动）标记
    expect(await screen.findByText("100.0K / 400.0K（手动）")).toBeInTheDocument();
  });
});

// ── formatQuotaResetTime：reset 时间格式化 ────────────────────────────────

describe("formatQuotaResetTime", () => {
  it("ISO8601 → MM-DD HH:mm（本地时区）", () => {
    const iso = "2026-08-15T10:30:00";
    expect(formatQuotaResetTime(iso)).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("空值 → 空串；无法解析 → 原样返回（不编造）", () => {
    expect(formatQuotaResetTime(null)).toBe("");
    expect(formatQuotaResetTime(undefined)).toBe("");
    expect(formatQuotaResetTime("not-a-date")).toBe("not-a-date");
  });
});

// ── mapUsageTiersToViews：usage tier → 统一额度视图（纯函数）──────────────

describe("mapUsageTiersToViews", () => {
  it("token_plan → 百分比视图（remaining → leftPct，extra → reset）", () => {
    const views = mapUsageTiersToViews([
      {
        plan_name: "Kimi·5小时窗",
        unit: "%",
        total: 100,
        used: 30,
        remaining: 70,
        extra: "2026-08-15T18:00:00",
      },
    ]);
    expect(views[0]).toEqual({
      label: "Kimi·5小时窗",
      leftPct: 70,
      balance: null,
      reset: "2026-08-15T18:00:00",
    });
  });

  it("balance → 金额视图（remaining/total/unit 搬运，无 reset）", () => {
    const views = mapUsageTiersToViews([
      { plan_name: null, unit: "USD", total: 50, used: 20, remaining: 30 },
    ]);
    expect(views[0]).toEqual({
      label: "余额",
      leftPct: null,
      balance: { remaining: 30, total: 50, unit: "USD" },
      reset: null,
    });
  });
});

// ── 刷新策略常量（quick-7fd9ce7f 用户要求锚定：默认 5 分钟 + 悬浮 2 秒）────

describe("QuotaPill 刷新策略常量", () => {
  it("默认轮询间隔 5 分钟、悬浮立即刷新延时 2 秒", () => {
    expect(QUOTA_REFRESH_INTERVAL_MS).toBe(5 * 60_000);
    expect(QUOTA_HOVER_REFRESH_DELAY_MS).toBe(2_000);
  });
});

// ── QuotaPill：全供应商聚合 + 30s 轮询（quick-e4d0551f）──────────────────

describe("QuotaPill", () => {
  it("无可查用量供应商 → 整体不渲染，不发起任何额度查询", async () => {
    mockListProviders.mockResolvedValue([
      provider({ id: "p-anth", name: "Anthropic", base_url: "https://api.anthropic.com" }),
    ]);
    const { container } = renderPill(<QuotaPill providerId="p-anth" />);
    await waitFor(() => expect(mockListProviders).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(mockGetProviderQuota).not.toHaveBeenCalled();
    expect(mockQueryUsage).not.toHaveBeenCalled();
  });

  it("供应商列表拉取失败 → 静默不渲染（弱依赖 R-05）", async () => {
    mockListProviders.mockRejectedValue(new Error("network"));
    const { container } = renderPill(<QuotaPill providerId="p-zhipu" />);
    await waitFor(() => expect(mockListProviders).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("providerId=null（本机默认）→ 照常聚合展示全部可查供应商额度", async () => {
    mockListProviders.mockResolvedValue([provider()]);
    mockGetProviderQuota.mockResolvedValue(
      quotaResp({
        model: "glm-4.7",
        windows: [{ label: "5小时窗", left: 80, reset: null }],
      }),
    );
    renderPill(<QuotaPill providerId={null} />);
    expect(await screen.findByTestId("quota-pill")).toHaveTextContent("80%");
  });

  it("有可查供应商但暂时无数据（quota=null）→ 灰字提示，不渲染胶囊", async () => {
    mockListProviders.mockResolvedValue([provider()]);
    mockGetProviderQuota.mockResolvedValue(quotaResp(null));
    renderPill(<QuotaPill providerId="p-zhipu" />);
    expect(await screen.findByTestId("quota-empty-hint")).toHaveTextContent(
      "暂无供应商额度信息",
    );
    expect(screen.queryByTestId("quota-pill")).not.toBeInTheDocument();
  });

  it("智谱 quota 正常 → 渲染模型名 + 各窗口剩余 + 重置时间", async () => {
    mockListProviders.mockResolvedValue([provider()]);
    mockGetProviderQuota.mockResolvedValue(
      quotaResp({
        model: "glm-4.7",
        windows: [
          { label: "5小时窗", left: 80, reset: "2026-08-15T18:00:00" },
          { label: "周限额", left: 40, reset: "2026-08-17T00:00:00" },
        ],
      }),
    );
    renderPill(<QuotaPill providerId="p-zhipu" />);
    const pill = await screen.findByTestId("quota-pill");
    expect(pill).toHaveTextContent("glm-4.7");
    expect(pill).toHaveTextContent("5小时窗剩");
    expect(pill).toHaveTextContent("80%");
    expect(pill).toHaveTextContent("周限额剩");
    expect(pill).toHaveTextContent("40%");
    expect(pill.textContent).toMatch(/⏱ \d{2}-\d{2} \d{2}:\d{2} 重置/);
  });

  it("低剩余变色：≤20% 红 / ≤50% 黄 / 正常无色", async () => {
    mockListProviders.mockResolvedValue([provider()]);
    mockGetProviderQuota.mockResolvedValue(
      quotaResp({
        model: "glm-4.7",
        windows: [
          { label: "5小时窗", left: 80, reset: null },
          { label: "低", left: 50, reset: null },
          { label: "危", left: 20, reset: null },
        ],
      }),
    );
    renderPill(<QuotaPill providerId="p-zhipu" />);
    await screen.findByTestId("quota-pill");
    const spans = screen
      .getByTestId("quota-pill")
      .querySelectorAll("span[class]");
    const byText = (t: string) =>
      Array.from(spans).find((s) => s.textContent === t);
    expect(byText("80%")?.className).toBe("");
    expect(byText("50%")?.className).toContain("text-warning");
    expect(byText("20%")?.className).toContain("text-error");
  });

  it("聚合全部可查供应商：智谱走 quota 端点、Kimi 走 usage 端点、不可查的不请求；会话供应商排胶囊第一位 + 等N家", async () => {
    mockListProviders.mockResolvedValue([
      provider(),
      provider({
        id: "p-kimi",
        name: "Kimi",
        base_url: "https://api.kimi.com/v1",
        model: "kimi-k2",
      }),
      provider({
        id: "p-anth",
        name: "Anthropic",
        base_url: "https://api.anthropic.com",
      }),
    ]);
    mockGetProviderQuota.mockResolvedValue(
      quotaResp({
        model: "glm-4.7",
        windows: [{ label: "5小时窗", left: 80, reset: "2026-08-15T18:00:00" }],
      }),
    );
    mockQueryUsage.mockResolvedValue({
      success: true,
      data: [
        {
          plan_name: "Kimi·5小时窗",
          unit: "%",
          total: 100,
          used: 30,
          remaining: 70,
          extra: "2026-08-15T18:00:00",
        },
      ],
    } satisfies UsageResult);
    renderPill(<QuotaPill providerId="p-kimi" />);
    const pill = await screen.findByTestId("quota-pill");
    // 会话供应商（Kimi）排第一位：model 名 + 其套餐窗口。
    expect(pill).toHaveTextContent("kimi-k2");
    expect(pill).toHaveTextContent("Kimi·5小时窗剩");
    expect(pill).toHaveTextContent("70%");
    expect(pill).toHaveTextContent("等1家");
    // 端点分流：智谱只查 quota、Kimi 只查 usage、Anthropic（不可查）不查。
    expect(mockGetProviderQuota).toHaveBeenCalledTimes(1);
    expect(mockGetProviderQuota).toHaveBeenCalledWith("p-zhipu");
    expect(mockQueryUsage).toHaveBeenCalledTimes(1);
    expect(mockQueryUsage).toHaveBeenCalledWith("p-kimi");

    // 浮层：按供应商分节展示两家 + 刷新说明。
    fireEvent.click(pill);
    expect(await screen.findByText("模型剩余额度")).toBeInTheDocument();
    const detail = screen.getByText("模型剩余额度").parentElement!;
    expect(detail.textContent).toContain("智谱GLM · glm-4.7");
    expect(detail.textContent).toContain("Kimi · kimi-k2");
    expect(screen.getByText("5小时窗 剩余")).toBeInTheDocument();
    expect(detail.textContent).toContain("每 5 分钟自动刷新");
    expect(detail.textContent).toContain("悬浮 2 秒立即刷新");
  });

  it("余额类供应商（DeepSeek）：浮层显示金额（¥/$）而非百分比", async () => {
    mockListProviders.mockResolvedValue([
      provider({ id: "p-ds", name: "DeepSeek", base_url: "https://api.deepseek.com" }),
    ]);
    mockQueryUsage.mockResolvedValue({
      success: true,
      data: [
        { plan_name: "CNY", unit: "CNY", total: 100, used: 60, remaining: 40 },
      ],
    } satisfies UsageResult);
    renderPill(<QuotaPill providerId="p-ds" />);
    const pill = await screen.findByTestId("quota-pill");
    // 余额类无百分比窗口 → 胶囊面只显示供应商名（明细在浮层）。
    expect(pill).toHaveTextContent("DeepSeek");
    expect(pill).not.toHaveTextContent("剩");
    fireEvent.click(pill);
    expect(await screen.findByText("CNY 剩余")).toBeInTheDocument();
    expect(screen.getByText("¥40 / 共 ¥100")).toBeInTheDocument();
  });

  it("点击胶囊显示各窗口详情浮层（百分比低量红显 + 重置时间）", async () => {
    mockListProviders.mockResolvedValue([provider()]);
    mockGetProviderQuota.mockResolvedValue(
      quotaResp({
        model: "glm-4.7",
        windows: [{ label: "5小时窗", left: 18, reset: "2026-08-15T18:00:00" }],
      }),
    );
    renderPill(<QuotaPill providerId="p-zhipu" />);
    fireEvent.click(await screen.findByTestId("quota-pill"));
    expect(await screen.findByText("模型剩余额度")).toBeInTheDocument();
    expect(screen.getByText("5小时窗 剩余")).toBeInTheDocument();
    // 胶囊本体 + 详情浮层各一处（18% ≤20 在浮层内为红色强调）
    const pcts = screen.getAllByText("18%");
    expect(pcts.length).toBeGreaterThanOrEqual(1);
    expect(
      pcts.some((el) => el.className.includes("text-error")),
    ).toBe(true);
    expect(
      screen.getAllByText(/\d{2}-\d{2} \d{2}:\d{2} 重置/).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("定时轮询（默认 5 分钟）：到点自动重查；瞬时失败（quota=null 弱依赖降级）保留上次数据", async () => {
    // 只 fake timer API，不 fake Date/performance（对齐 workspace-config-card 惯例）。
    vi.useFakeTimers({
      toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"],
    });
    mockListProviders.mockResolvedValue([provider()]);
    mockGetProviderQuota
      .mockResolvedValueOnce(
        quotaResp({
          model: "glm-4.7",
          windows: [{ label: "5小时窗", left: 80, reset: null }],
        }),
      )
      .mockResolvedValue(quotaResp(null)); // 后续轮询上游降级
    renderPill(<QuotaPill providerId="p-zhipu" />);
    // flush microtask：列表加载 + 首查落 entries。
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByTestId("quota-pill")).toHaveTextContent("80%");
    expect(mockGetProviderQuota).toHaveBeenCalledTimes(1);

    // 快进轮询间隔（常量驱动，默认 5 分钟）→ 第二次轮询（quota=null 弱依赖降级）。
    await vi.advanceTimersByTimeAsync(QUOTA_REFRESH_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockGetProviderQuota).toHaveBeenCalledTimes(2);
    // keep-last-good：仍显示上次成功数据，不清空面板。
    expect(screen.getByTestId("quota-pill")).toHaveTextContent("80%");

    // 再快进一个间隔 → 第三次轮询照常发生。
    await vi.advanceTimersByTimeAsync(QUOTA_REFRESH_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockGetProviderQuota).toHaveBeenCalledTimes(3);
  });

  it("悬浮满 2 秒 → 立即刷新一次；不足 2 秒离开 → 取消不刷新；悬浮再久不重复触发", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"],
    });
    mockListProviders.mockResolvedValue([provider()]);
    mockGetProviderQuota.mockResolvedValue(
      quotaResp({
        model: "glm-4.7",
        windows: [{ label: "5小时窗", left: 80, reset: null }],
      }),
    );
    renderPill(<QuotaPill providerId="p-zhipu" />);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockGetProviderQuota).toHaveBeenCalledTimes(1); // 挂载首查
    const pill = screen.getByTestId("quota-pill");

    // 悬浮 1.5s 后离开 → 未满 2s，取消，不触发额外查询。
    fireEvent.mouseEnter(pill);
    await vi.advanceTimersByTimeAsync(1_500);
    fireEvent.mouseLeave(pill);
    await vi.advanceTimersByTimeAsync(QUOTA_HOVER_REFRESH_DELAY_MS);
    expect(mockGetProviderQuota).toHaveBeenCalledTimes(1);

    // 再悬浮：满 2s → 立即刷新一次（不等 5 分钟轮询）。
    fireEvent.mouseEnter(pill);
    await vi.advanceTimersByTimeAsync(QUOTA_HOVER_REFRESH_DELAY_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockGetProviderQuota).toHaveBeenCalledTimes(2);

    // 继续悬浮（推进远超 2s）→ 单次悬浮最多触发一次，不重复。
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockGetProviderQuota).toHaveBeenCalledTimes(2);
    fireEvent.mouseLeave(pill);
  });

  it("usage 鉴权失效（is_valid=false）为确定性失败 → 清除该家条目", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"],
    });
    mockListProviders.mockResolvedValue([
      provider({ id: "p-kimi", name: "Kimi", base_url: "https://api.kimi.com" }),
    ]);
    mockQueryUsage
      .mockResolvedValueOnce({
        success: true,
        data: [
          {
            plan_name: "Kimi·5小时窗",
            unit: "%",
            total: 100,
            used: 30,
            remaining: 70,
            extra: null,
          },
        ],
      })
      .mockResolvedValue({
        success: false,
        data: [{ is_valid: false, invalid_message: "鉴权失败" }],
        error: null,
      } satisfies UsageResult);
    renderPill(<QuotaPill providerId="p-kimi" />);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByTestId("quota-pill")).toHaveTextContent("70%");

    // 30s 后轮询拿到 is_valid=false → 条目被清除（不留陈旧假数据），回落灰字提示。
    await vi.advanceTimersByTimeAsync(QUOTA_REFRESH_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByTestId("quota-empty-hint")).toHaveTextContent(
      "暂无供应商额度信息",
    );
    expect(screen.queryByTestId("quota-pill")).not.toBeInTheDocument();
  });
});

// ── CtxUsageBar：caps ctx_usage 门控（2026-09-13-ctx-usage-all-providers
//    task-07 / FR-06）──────────────────────────────────────────────────────

describe("CtxUsageBar（caps 门控）", () => {
  it("provider 为未知引擎名（命中 getProviderCaps 回退 ctx_usage=false）→ 环不渲染、QuotaPill 照常", async () => {
    // 虚构引擎名：provider-caps.ts 为 @generated 纯常量表（未知回退全 false），
    // 直接用真实模块即可，无需 mock（task-07 约束）。
    mockListProviders.mockResolvedValue([provider()]);
    mockGetProviderQuota.mockResolvedValue(
      quotaResp({
        model: "glm-4.7",
        windows: [{ label: "5小时窗", left: 80, reset: null }],
      }),
    );
    renderPill(
      <CtxUsageBar
        usedTokens={100_000}
        roleMapping={{ model: "glm-4.6" }}
        providerId="p-zhipu"
        provider="no-ctx-engine"
      />,
    );
    expect(screen.queryByTestId("ctx-ring")).not.toBeInTheDocument();
    // 门控只决定环渲染与否，额度胶囊照常挂载查询
    expect(await screen.findByTestId("quota-pill")).toBeInTheDocument();
  });

  it("现有引擎名（claude，ctx_usage=true）→ 照常渲染环并显示百分比", () => {
    renderPill(
      <CtxUsageBar
        usedTokens={100_000}
        roleMapping={{ model: "glm-4.6" }}
        provider="claude"
      />,
    );
    expect(screen.getByTestId("ctx-ring").textContent).toContain("50%");
  });

  it("不传 provider（undefined）→ 旁路门控照常渲染环（本机默认供应商等场景）", () => {
    renderPill(<CtxUsageBar usedTokens={12_345} />);
    // 12,345 / 兜底 1M → 中心取整 1%（与上方既有用例同形态，显式锚定旁路语义）
    expect(screen.getByTestId("ctx-ring").textContent).toContain("1%");
  });
});

// ── CtxUsageBar：环浮层「压缩上下文」按钮（2026-09-14-session-ctx-compact
//    task-06 / FR-06 / FR-07 / D-002@v1：caps.compact 门控 / 禁用态 / 点击上抛）──

describe("CtxUsageBar（compact 压缩按钮）", () => {
  it("caps.compact=false（cursor）→ 即便提供 onCompact 也不渲染按钮行", async () => {
    // provider-caps.ts 为 @generated 纯常量表（cursor compact=false），真实模块
    // 直查，无需 mock（对齐上方 caps 门控用例约束）。
    renderPill(
      <CtxUsageBar
        usedTokens={100_000}
        provider="cursor"
        onCompact={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("ctx-ring"));
    expect(await screen.findByText("上下文窗口用量")).toBeInTheDocument();
    expect(screen.queryByTestId("ctx-compact-btn")).not.toBeInTheDocument();
    expect(screen.queryByText("压缩上下文")).not.toBeInTheDocument();
  });

  it("未提供 onCompact（预会话 :2722 挂载形态）→ 不渲染按钮（引擎有能力也不渲染）", async () => {
    renderPill(<CtxUsageBar usedTokens={100_000} provider="claude" />);
    fireEvent.click(screen.getByTestId("ctx-ring"));
    expect(await screen.findByText("上下文窗口用量")).toBeInTheDocument();
    expect(screen.queryByTestId("ctx-compact-btn")).not.toBeInTheDocument();
  });

  it("provider=null（本机默认，引擎未知）→ 默认拒绝不渲染按钮（与环 null 旁路相反）", async () => {
    renderPill(<CtxUsageBar usedTokens={12_345} onCompact={() => {}} />);
    // 环本体照常渲染（ctx_usage 门控 null 旁路），但浮层压缩按钮不渲染。
    expect(screen.getByTestId("ctx-ring").textContent).toContain("1%");
    fireEvent.click(screen.getByTestId("ctx-ring"));
    expect(await screen.findByText("上下文窗口用量")).toBeInTheDocument();
    expect(screen.queryByTestId("ctx-compact-btn")).not.toBeInTheDocument();
  });

  it.each(["claude", "pi", "codex"])(
    "caps.compact=true（%s）+ onCompact → 渲染按钮，点击上抛 onCompact",
    async (engine) => {
      const onCompact = vi.fn();
      renderPill(
        <CtxUsageBar
          usedTokens={100_000}
          provider={engine}
          onCompact={onCompact}
        />,
      );
      fireEvent.click(screen.getByTestId("ctx-ring"));
      const btn = await screen.findByTestId("ctx-compact-btn");
      expect(btn).toHaveTextContent("压缩上下文");
      expect(btn).toBeEnabled();
      fireEvent.click(btn);
      expect(onCompact).toHaveBeenCalledTimes(1);
    },
  );

  it("compactDisabled=true → 按钮禁用 + 缺省禁用文案；compactTooltip 覆盖；禁用点击不上抛", async () => {
    const onCompact = vi.fn();
    const { rerender } = renderPill(
      <CtxUsageBar
        usedTokens={100_000}
        provider="claude"
        onCompact={onCompact}
        compactDisabled
      />,
    );
    fireEvent.click(screen.getByTestId("ctx-ring"));
    const btn = await screen.findByTestId("ctx-compact-btn");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "轮运行中，暂不能压缩");
    // 禁用态点击不触发回调（父层 compactDisabled=running 防与进行中轮并发）
    fireEvent.click(btn);
    expect(onCompact).not.toHaveBeenCalled();

    // 自定义 compactTooltip 覆盖缺省文案
    rerender(
      <CtxUsageBar
        usedTokens={100_000}
        provider="claude"
        onCompact={onCompact}
        compactDisabled
        compactTooltip="压缩轮已在运行"
      />,
    );
    expect(await screen.findByTestId("ctx-compact-btn")).toHaveAttribute(
      "title",
      "压缩轮已在运行",
    );
  });

  it("compactDisabled=false → 按钮可用且不带禁用 title（tooltip 仅禁用态呈现）", async () => {
    renderPill(
      <CtxUsageBar
        usedTokens={100_000}
        provider="pi"
        onCompact={() => {}}
        compactDisabled={false}
      />,
    );
    fireEvent.click(screen.getByTestId("ctx-ring"));
    const btn = await screen.findByTestId("ctx-compact-btn");
    expect(btn).toBeEnabled();
    expect(btn).not.toHaveAttribute("title");
  });
});

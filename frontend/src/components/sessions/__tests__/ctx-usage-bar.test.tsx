// task-15（2026-08-14-sessions-portal / FR-08 / D-009@v1 / D-014@v1）：
// CtxUsageRing + QuotaPill 单元测试。
//
// 覆盖：
//   - 分母三级降级链（one_m→1000k / 常量 200k / 无分母只显示累计）；
//   - 阈值变色（50 / 80 边界，≥50 黄 ≥80 红）；
//   - 点击详情浮层（占比 / 已用总量 / 口径说明）；
//   - quota=null 不渲染胶囊（灰字提示）、正常窗口渲染、低剩余变色、
//     reset 时间格式化、供应商切换重新拉取、失败静默降级。
//
// mock：额度接口 mock @/lib/api/llm-providers 的 getProviderQuota（不真调后端）。
// jsdom 已知坑：antd Popover 内容经 portal 挂 body，断言用 await screen.findByText；
// 本组件无 MarkdownText/dynamic 依赖，无需 mock。

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import {
  CtxUsageRing,
  QuotaPill,
  CtxUsageBar,
  resolveCtxWindowTokens,
  formatQuotaResetTime,
  ONE_M_CTX_WINDOW_TOKENS,
  DEFAULT_CTX_WINDOW_TOKENS,
} from "../ctx-usage-bar";
import { getProviderQuota } from "@/lib/api/llm-providers";
import type { LlmProviderQuotaResponse } from "@/lib/api/llm-providers";

vi.mock("@/lib/api/llm-providers", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/api/llm-providers")
  >()),
  getProviderQuota: vi.fn(),
}));

const mockGetProviderQuota = vi.mocked(getProviderQuota);

function quotaResp(
  quota: LlmProviderQuotaResponse["quota"],
): LlmProviderQuotaResponse {
  return { quota };
}

beforeEach(() => {
  mockGetProviderQuota.mockReset();
});

// ── resolveCtxWindowTokens：分母三级降级链（D-014@v1 / spike-01）──────────

describe("resolveCtxWindowTokens（分母三级降级链）", () => {
  it("第 1 级：role mapping one_m=true → 1000k（供应商配置派生）", () => {
    expect(
      resolveCtxWindowTokens({ model: "glm-4.6", one_m: true }, null),
    ).toBe(ONE_M_CTX_WINDOW_TOKENS);
  });

  it("第 2 级：有模型名（常量表命中或默认）→ 200k", () => {
    expect(resolveCtxWindowTokens({ model: "glm-4.6" }, null)).toBe(
      DEFAULT_CTX_WINDOW_TOKENS,
    );
    // role mapping 无 model，回退 default_fallback_model
    expect(resolveCtxWindowTokens(null, "claude-sonnet-4-5")).toBe(
      DEFAULT_CTX_WINDOW_TOKENS,
    );
  });

  it("第 3 级：无 one_m 也无模型名 → null（只显示累计 token）", () => {
    expect(resolveCtxWindowTokens(null, null)).toBeNull();
    expect(resolveCtxWindowTokens({}, "  ")).toBeNull();
  });
});

// ── CtxUsageRing：环渲染 / 阈值变色 / 详情浮层 ────────────────────────────

describe("CtxUsageRing", () => {
  it("显示占比百分比：100k / 200k = 50%", () => {
    render(
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
    render(
      <CtxUsageRing usedTokens={160_000} roleMapping={{ model: "glm-4.6" }} />,
    );
    const ring = screen.getByTestId("ctx-ring");
    expect(ring.textContent).toContain("80%");
    expect(ring.className).toContain("text-error");
  });

  it("超量封顶：用量超过分母显示 100% 不溢出", () => {
    render(
      <CtxUsageRing usedTokens={999_999} roleMapping={{ model: "glm-4.6" }} />,
    );
    expect(screen.getByTestId("ctx-ring").textContent).toContain("100%");
  });

  it("第 1 级分母：one_m=true 按 1000k 计（500k → 50%）", () => {
    render(
      <CtxUsageRing
        usedTokens={500_000}
        roleMapping={{ model: "glm-4.6", one_m: true }}
      />,
    );
    expect(screen.getByTestId("ctx-ring").textContent).toContain("50%");
  });

  it("第 3 级分母：无分母只显示累计 token，不显示百分比", () => {
    render(<CtxUsageBar usedTokens={12_345} />);
    const ring = screen.getByTestId("ctx-ring");
    expect(ring.textContent).toContain("12.3k");
    expect(ring.textContent).not.toContain("%");
  });

  it("点击环显示详情浮层（占比 / 已用总量 / 口径说明）", async () => {
    render(
      <CtxUsageRing usedTokens={100_000} roleMapping={{ model: "glm-4.6" }} />,
    );
    fireEvent.click(screen.getByTestId("ctx-ring"));
    expect(await screen.findByText("上下文窗口用量")).toBeInTheDocument();
    expect(await screen.findByText("50.0%")).toBeInTheDocument();
    expect(screen.getByText("100.0k / 200.0k")).toBeInTheDocument();
    // 口径说明（R-06：展示标注口径）
    expect(
      screen.getByText(/当前会话累计 token（含系统提示与历史轮次）/),
    ).toBeInTheDocument();
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

// ── QuotaPill：null 不渲染 / 窗口渲染 / 低剩余变色 / 联动刷新 ──────────────

describe("QuotaPill", () => {
  it("无供应商 id（本机默认）→ 整体不渲染", () => {
    const { container } = render(<QuotaPill providerId={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(mockGetProviderQuota).not.toHaveBeenCalled();
  });

  it("quota=null → 不渲染胶囊，显示灰字提示（原型口径）", async () => {
    mockGetProviderQuota.mockResolvedValue(quotaResp(null));
    render(<QuotaPill providerId="p-1" />);
    expect(await screen.findByTestId("quota-empty-hint")).toHaveTextContent(
      "该供应商未提供额度信息",
    );
    expect(screen.queryByTestId("quota-pill")).not.toBeInTheDocument();
  });

  it("接口失败 → 静默降级为灰字提示（不报错不渲染胶囊）", async () => {
    mockGetProviderQuota.mockRejectedValue(new Error("network"));
    render(<QuotaPill providerId="p-1" />);
    expect(await screen.findByTestId("quota-empty-hint")).toBeInTheDocument();
    expect(screen.queryByTestId("quota-pill")).not.toBeInTheDocument();
  });

  it("quota 正常 → 渲染模型名 + 各窗口剩余 + 重置时间", async () => {
    mockGetProviderQuota.mockResolvedValue(
      quotaResp({
        model: "glm-4.7",
        windows: [
          { label: "5小时窗", left: 80, reset: "2026-08-15T18:00:00" },
          { label: "周限额", left: 40, reset: "2026-08-17T00:00:00" },
        ],
      }),
    );
    render(<QuotaPill providerId="p-1" />);
    const pill = await screen.findByTestId("quota-pill");
    expect(pill).toHaveTextContent("glm-4.7");
    expect(pill).toHaveTextContent("5小时窗剩");
    expect(pill).toHaveTextContent("80%");
    expect(pill).toHaveTextContent("周限额剩");
    expect(pill).toHaveTextContent("40%");
    expect(pill.textContent).toMatch(/⏱ \d{2}-\d{2} \d{2}:\d{2} 重置/);
  });

  it("低剩余变色：≤20% 红 / ≤50% 黄 / 正常无色", async () => {
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
    render(<QuotaPill providerId="p-1" />);
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

  it("供应商变化 → 按新 id 重新拉取（低频，无轮询）", async () => {
    mockGetProviderQuota.mockResolvedValue(quotaResp(null));
    const { rerender } = render(<QuotaPill providerId="p-1" />);
    await screen.findByTestId("quota-empty-hint");
    rerender(<QuotaPill providerId="p-2" />);
    await waitFor(() => {
      expect(mockGetProviderQuota).toHaveBeenCalledWith("p-2");
    });
    expect(mockGetProviderQuota).toHaveBeenCalledTimes(2);
  });

  it("点击胶囊显示各窗口详情浮层", async () => {
    mockGetProviderQuota.mockResolvedValue(
      quotaResp({
        model: "glm-4.7",
        windows: [{ label: "5小时窗", left: 18, reset: "2026-08-15T18:00:00" }],
      }),
    );
    render(<QuotaPill providerId="p-1" />);
    fireEvent.click(await screen.findByTestId("quota-pill"));
    expect(
      await screen.findByText("模型剩余额度 · glm-4.7"),
    ).toBeInTheDocument();
    expect(screen.getByText("5小时窗 剩余")).toBeInTheDocument();
    // 胶囊本体 + 详情浮层各一处（18% ≤20 在浮层内为红色强调）
    const pcts = screen.getAllByText("18%");
    expect(pcts.length).toBeGreaterThanOrEqual(1);
    expect(
      pcts.some((el) => el.className.includes("text-error")),
    ).toBe(true);
    // 重置时间在胶囊（⏱ 前缀）与浮层各一处
    expect(
      screen.getAllByText(/\d{2}-\d{2} \d{2}:\d{2} 重置/).length,
    ).toBeGreaterThanOrEqual(1);
  });
});

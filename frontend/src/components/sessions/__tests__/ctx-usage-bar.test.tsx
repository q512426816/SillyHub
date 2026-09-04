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
  FALLBACK_CTX_WINDOW_TOKENS,
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

  it("第 1 级分母：one_m=true 按 1000K 计（500K → 50%）", () => {
    render(
      <CtxUsageRing
        usedTokens={500_000}
        roleMapping={{ model: "glm-4.6", one_m: true }}
      />,
    );
    expect(screen.getByTestId("ctx-ring").textContent).toContain("50%");
  });

  it("第 3 级分母：无派生来源兜底 1M，按占比显示（ql-20260831-002 不再无分母）", () => {
    render(<CtxUsageBar usedTokens={12_345} />);
    const ring = screen.getByTestId("ctx-ring");
    // 12,345 / 1,000,000 = 1.2% → 中心取整 1%
    expect(ring.textContent).toContain("1%");
  });

  it("会话覆盖分母：200K 模型手动指定 400K → 占比按覆盖值计算", () => {
    render(
      <CtxUsageRing
        usedTokens={100_000}
        roleMapping={{ model: "glm-4.6" }}
        windowOverride={400_000}
      />,
    );
    expect(screen.getByTestId("ctx-ring").textContent).toContain("25%");
  });

  it("点击环显示详情浮层（占比 / 已用总量 / 口径说明）", async () => {
    render(
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
    render(
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
    render(<CtxUsageRing usedTokens={100_000} roleMapping={{ model: "glm-4.6" }} />);
    fireEvent.click(screen.getByTestId("ctx-ring"));
    expect(await screen.findByText("上下文窗口用量")).toBeInTheDocument();
    expect(screen.queryByTestId("ctx-window-editor")).not.toBeInTheDocument();
  });

  it("编辑器保存 → onWindowOverrideChange 上抛显式值；「恢复默认」仅覆盖态可见", async () => {
    const onChange = vi.fn();
    render(
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
    render(
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

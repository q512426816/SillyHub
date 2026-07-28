/**
 * task-11：UsageFooter 组件单测（task-08 / D-005/D-010）。
 *
 * 覆盖四状态 + keep-last-good：
 *   1. 成功 + 多 tier → 逐条渲染 plan_name / 剩余 / 已用 / 进度条；
 *   2. is_valid=false → 翻红 + invalid_message；
 *   3. 瞬时失败（queryUsage reject）10 分钟内保留上次成功值（不翻红，stale 提示）；
 *   4. 不支持用量（detect=null）→ 中性文案「该供应商暂不支持余额查询」，全文无 cc-switch 字样；
 *   5. 瞬时失败且无上次值 → 错误提示。
 *
 * vi.mock 整个 api 模块（queryUsage + detectUsageProvider），不打真实网络；footer 无
 * next/dynamic，无需 markdown vi.mock。
 */
import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { UsageFooter } from "@/components/llm-providers/usage-footer";

vi.mock("@/lib/api/llm-providers", () => ({
  detectUsageProvider: vi.fn(),
  queryUsage: vi.fn(),
}));

// mock 后再 import（拿 mock 引用，便于 per-test 配置）。
import { detectUsageProvider, queryUsage } from "@/lib/api/llm-providers";

const mockedDetect = detectUsageProvider as ReturnType<typeof vi.fn>;
const mockedQueryUsage = queryUsage as ReturnType<typeof vi.fn>;

describe("UsageFooter — 四状态 + keep-last-good（task-08 / D-005）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("成功多 tier → 逐条渲染 plan_name / 剩余 / 已用", async () => {
    mockedDetect.mockReturnValue("token_plan");
    mockedQueryUsage.mockResolvedValue({
      success: true,
      data: [
        { plan_name: "5小时窗", total: 100, used: 50, remaining: 50, unit: "%" },
        { plan_name: "周限额", total: 100, used: 20, remaining: 80, unit: "%" },
      ],
    });

    render(<UsageFooter providerId="p-1" baseUrl="https://api.kimi.com/coding/" />);

    expect(await screen.findByText("5小时窗")).toBeInTheDocument();
    expect(screen.getByText("周限额")).toBeInTheDocument();
    // 数值：剩余 50% / 剩余 80%
    expect(screen.getByText(/剩余 50%/)).toBeInTheDocument();
    expect(screen.getByText(/剩余 80%/)).toBeInTheDocument();
    expect(mockedQueryUsage).toHaveBeenCalledTimes(1);
    expect(mockedQueryUsage).toHaveBeenCalledWith("p-1");
  });

  it("is_valid=false → 翻红 + invalid_message", async () => {
    mockedDetect.mockReturnValue("balance");
    mockedQueryUsage.mockResolvedValue({
      success: false,
      data: [{ is_valid: false, invalid_message: "鉴权失败，请检查 API Key" }],
    });

    render(<UsageFooter providerId="p-1" baseUrl="https://api.deepseek.com/anthropic" />);

    expect(await screen.findByText("鉴权失败，请检查 API Key")).toBeInTheDocument();
    // 翻红分支：文案带 destructive 样式（role=alert 的 AlertCircle 容器）
    expect(document.querySelector(".text-destructive")).not.toBeNull();
  });

  it("瞬时失败 10min 内保留上次成功值（不翻红 + stale 提示）", async () => {
    mockedDetect.mockReturnValue("balance");
    // 首次挂载：成功（建立 lastGood）
    mockedQueryUsage.mockResolvedValueOnce({
      success: true,
      data: [{ plan_name: "CNY", remaining: 99, total: null, used: null, unit: "CNY" }],
    });

    render(<UsageFooter providerId="p-1" baseUrl="https://api.deepseek.com/anthropic" />);
    expect(await screen.findByText("CNY")).toBeInTheDocument();

    // 手动刷新：瞬时失败 → 保留上次值 + stale 提示（不翻红）
    mockedQueryUsage.mockRejectedValueOnce(new Error("网络瞬时中断"));
    fireEvent.click(screen.getByRole("button", { name: "刷新用量" }));

    await waitFor(() => {
      expect(screen.getByText("CNY")).toBeInTheDocument(); // 仍是上次成功值
    });
    expect(screen.getByText(/网络异常，暂用上次成功结果/)).toBeInTheDocument();
    // 不翻红（无 invalid_message）
    expect(screen.queryByText(/鉴权失败/)).toBeNull();
  });

  it("不支持用量 → 中性文案「该供应商暂不支持余额查询」，无 cc-switch 字样，不发请求", () => {
    mockedDetect.mockReturnValue(null);

    render(<UsageFooter providerId="p-1" baseUrl="https://api.anthropic.com" />);

    expect(screen.getByText("该供应商暂不支持余额查询")).toBeInTheDocument();
    expect(mockedQueryUsage).not.toHaveBeenCalled();
    // D-010：对外文案无 cc-switch 字样
    expect(document.body.textContent ?? "").not.toContain("cc-switch");
  });

  it("瞬时失败且无上次值 → 错误提示（不保留、不翻红）", async () => {
    mockedDetect.mockReturnValue("balance");
    mockedQueryUsage.mockRejectedValueOnce(new Error("查询用量上游超时"));

    render(<UsageFooter providerId="p-1" baseUrl="https://api.deepseek.com/anthropic" />);

    expect(await screen.findByText("查询用量上游超时")).toBeInTheDocument();
    // 无 tier 数据
    expect(screen.queryByText(/剩余 \d+%/)).toBeNull();
  });
});

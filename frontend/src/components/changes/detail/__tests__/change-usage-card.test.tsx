// task-07（2026-08-30-change-center-usage-stats / FR-05 / D-007@v1）：执行用量卡
// 组件测试，范式照 detail/__tests__/change-sessions-card.test.tsx——部分 mock 两个
// lib 数据源（getChangeUsage / getQuicklogUsage），render 包 QueryClientProvider
//（retry: false 保证错误态一次落定）。
//
// 覆盖：①摘要行数字/命中率渲染（万级 token / 千分位 / 耗时格式化）②命中率分母
// 0 →「—」（汇总级 + 模型行级同公式）③时间三元组「进行中」标记（started 有值
// finished 缺，耗时照显示已累计值）④kind=quicklog 分派 getQuicklogUsage（调用
// 次数与参数，getChangeUsage 不被调）⑤折叠/展开交互 + 「未记录」灰桶 + 两 kind
// 口径注脚 ⑥error →「暂无用量数据」静默不 throw ⑦无执行边界态引导文案。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ChangeUsageCard,
  type ChangeUsageCardProps,
} from "@/components/changes/detail/change-usage-card";
import type { ChangeUsageRead } from "@/lib/changes";

const mocks = vi.hoisted(() => ({
  getChangeUsage: vi.fn(),
  getQuicklogUsage: vi.fn(),
}));

// 部分 mock：仅替换本卡两个数据源，其余导出保持真实实现。
vi.mock("@/lib/changes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/changes")>()),
  getChangeUsage: mocks.getChangeUsage,
}));
vi.mock("@/lib/quicklog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/quicklog")>()),
  getQuicklogUsage: mocks.getQuicklogUsage,
}));

const START = "2026-08-28T02:12:00Z";
const END = "2026-08-30T07:40:00Z";

/** 与组件同口径的紧凑时间期望值（本地时区，测试在任何 TZ 下均确定）。 */
function compactTime(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

function usageOf(overrides: Partial<ChangeUsageRead> = {}): ChangeUsageRead {
  return {
    started_at: START,
    finished_at: END,
    duration_ms: 12_960_000, // 3.6 小时
    totals: {
      input_tokens: 384_000, // 38.4 万
      output_tokens: 6_204, // 6,204
      cache_read_tokens: 4_210_000, // 421.0 万
      cache_creation_tokens: 261_000, // 26.1 万
      api_requests: 214,
      num_turns: 96,
    },
    by_model: [
      {
        model: "glm-4.7",
        input_tokens: 310_000,
        output_tokens: 5_100,
        cache_read_tokens: 3_460_000,
        cache_creation_tokens: 208_000,
        api_requests: 172,
      },
      {
        model: "glm-4.7-air",
        input_tokens: 74_000,
        output_tokens: 1_104,
        cache_read_tokens: 750_000,
        cache_creation_tokens: 53_000,
        api_requests: 42,
      },
    ],
    ...overrides,
  };
}

function renderCard(props: Partial<ChangeUsageCardProps> = {}) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchInterval: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <ChangeUsageCard kind="change" workspaceId="ws-1" refKey="ch-7" {...props} />
    </QueryClientProvider>,
  );
}

describe("ChangeUsageCard（task-07）", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("摘要行渲染时间三元组/耗时/轮次/四维 token/请求次数/命中率（万级与千分位口径）", async () => {
    mocks.getChangeUsage.mockResolvedValue(usageOf());
    renderCard();

    // 等查询落定后再逐项断言（时间紧凑格式 + 耗时 3.6 小时 + 轮次/请求千分位直显）。
    expect(await screen.findByText("3.6 小时")).toBeInTheDocument();
    expect(screen.getByText(compactTime(START))).toBeInTheDocument();
    expect(screen.getByText(compactTime(END))).toBeInTheDocument();
    expect(screen.getByText("96")).toBeInTheDocument();
    expect(screen.getByText("38.4 万")).toBeInTheDocument();
    expect(screen.getByText("6,204")).toBeInTheDocument();
    expect(screen.getByText("421.0 万")).toBeInTheDocument();
    expect(screen.getByText("26.1 万")).toBeInTheDocument();
    expect(screen.getByText("214")).toBeInTheDocument();
    // 命中率 = 4210000 / (4210000 + 384000) = 91.6%（一位小数）。
    expect(screen.getByText("91.6%")).toBeInTheDocument();

    // kind=change 分派 getChangeUsage（workspaceId + refKey 透传）。
    await waitFor(() =>
      expect(mocks.getChangeUsage).toHaveBeenCalledWith("ws-1", "ch-7"),
    );
    expect(mocks.getQuicklogUsage).not.toHaveBeenCalled();
  });

  it("命中率分母 0（输入与缓存读取均为 0）→ 汇总级与模型行级均显示「—」", async () => {
    mocks.getChangeUsage.mockResolvedValue(
      usageOf({
        totals: {
          input_tokens: 0,
          output_tokens: 5_000,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          api_requests: 7,
          num_turns: 3,
        },
        by_model: [
          {
            model: "glm-4.7",
            input_tokens: 0,
            output_tokens: 500,
            cache_read_tokens: 0,
            cache_creation_tokens: 0,
            api_requests: 2,
          },
        ],
      }),
    );
    renderCard();

    // 折叠态：时间三元组齐全，唯一的「—」是汇总级命中率。
    await screen.findByText("7");
    expect(screen.getAllByText("—")).toHaveLength(1);

    // 展开后：模型行级命中率同公式 → 第二个「—」。
    fireEvent.click(screen.getByRole("button", { name: "按模型明细" }));
    expect(await screen.findAllByText("—")).toHaveLength(2);
  });

  it("进行中标记：started_at 有值且 finished_at 缺 →「进行中」，耗时照显示已累计值", async () => {
    mocks.getChangeUsage.mockResolvedValue(
      usageOf({ finished_at: null, duration_ms: 6_480_000 }), // 1.8 小时
    );
    renderCard();

    expect(await screen.findByText("进行中")).toBeInTheDocument();
    expect(screen.getByText("1.8 小时")).toBeInTheDocument();
    expect(screen.getByText(compactTime(START))).toBeInTheDocument();
    // 结束缺 →「—」（muted 灰显，不编造时间）。
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("kind=quicklog 分派 getQuicklogUsage（参数透传，getChangeUsage 不被调）+ quicklog 口径注脚", async () => {
    mocks.getQuicklogUsage.mockResolvedValue(usageOf());
    renderCard({ kind: "quicklog", refKey: "ql-20260830-007" });

    await waitFor(() => {
      expect(mocks.getQuicklogUsage).toHaveBeenCalledTimes(1);
      expect(mocks.getQuicklogUsage).toHaveBeenCalledWith("ws-1", "ql-20260830-007");
    });
    expect(mocks.getChangeUsage).not.toHaveBeenCalled();

    // 展开后注脚按 kind 分叉：quicklog 声明统计关联会话内全部执行。
    fireEvent.click(await screen.findByRole("button", { name: "按模型明细" }));
    expect(
      await screen.findByText(/统计关联会话内全部执行（快速修复经会话绑定关联）/),
    ).toBeInTheDocument();
  });

  it("折叠/展开交互：默认收起，切换后渲染按模型明细（含「未记录」灰桶）与 change 口径注脚", async () => {
    mocks.getChangeUsage.mockResolvedValue(
      usageOf({
        by_model: [
          ...usageOf().by_model,
          {
            model: "未记录",
            input_tokens: 0,
            output_tokens: 0,
            cache_read_tokens: 0,
            cache_creation_tokens: 0,
            api_requests: 0,
          },
        ],
      }),
    );
    renderCard();

    // 默认收起：明细行与注脚不渲染。
    const toggle = await screen.findByRole("button", { name: "按模型明细" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("glm-4.7")).not.toBeInTheDocument();

    // 展开：模型行 +「未记录」兜底桶（灰阶 tag 恒末位，行级数字渲染）+ change 注脚。
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("glm-4.7")).toBeInTheDocument();
    expect(screen.getByText("glm-4.7-air")).toBeInTheDocument();
    expect(screen.getByText("未记录")).toBeInTheDocument();
    expect(screen.getByText("172")).toBeInTheDocument(); // glm-4.7 行请求次数
    expect(
      screen.getByText(
        /统计平台派发执行与关联会话执行，按执行去重合并；会话服务多个变更时消耗在各变更分别显示；已删除会话的执行仍计入；耗时为纯执行时长累加/,
      ),
    ).toBeInTheDocument();

    // 再点收起：明细隐藏。
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("glm-4.7")).not.toBeInTheDocument();
  });

  it("取数失败/404 → 渲染「暂无用量数据」边界态，不 throw", async () => {
    mocks.getChangeUsage.mockRejectedValue(new Error("404 Not Found"));
    renderCard();

    expect(await screen.findByText("暂无用量数据")).toBeInTheDocument();
    // 降级态不渲染摘要行与折叠入口。
    expect(screen.queryByTestId("change-usage-card")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "按模型明细" })).not.toBeInTheDocument();
  });

  it("无执行边界态（三元组全 None + totals 全 0）→ 引导文案，无进行中标记与折叠入口", async () => {
    mocks.getChangeUsage.mockResolvedValue(
      usageOf({
        started_at: null,
        finished_at: null,
        duration_ms: null,
        totals: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          api_requests: 0,
          num_turns: 0,
        },
        by_model: [],
      }),
    );
    renderCard();

    expect(
      await screen.findByText("尚无关联执行——派发执行或在会话中绑定后，这里会出现统计"),
    ).toBeInTheDocument();
    expect(screen.queryByText("进行中")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "按模型明细" })).not.toBeInTheDocument();
  });
});

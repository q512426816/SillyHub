// task-03（2026-08-29-session-usage-stats）：SessionUsageBar 组件级验证。
//
// 覆盖验收（对照任务卡 implementation + design §测试与验收）：
//   ① 摘要行六项渲染：五指标（万级缩写 / 万以下千分位）+ 命中率百分比
//     （D-003 口径 cache_read/(cache_read+input)）；首载 loading 静默不渲染；
//     （ql-20260830-013-14b3 小型化改版后指标名收敛为悬浮提示；ql-20260830-014-74f5
//     改 antd Tooltip，触发元素带 aria-label，标签断言走 getByLabelText/queryByLabelText，
//     数值断言不变）；
//   ② 命中率分母 0（全 0 会话）→「—」，by_model 空无明细切换按钮；
//   ③ 折叠交互：初始明细表不渲染，点「按模型明细」后渲染模型行（含
//     「未记录（旧轮次）」灰阶 tag）+ 口径脚注；
//   ④ refreshSignal 递增触发重取（getSessionUsage 调用计数断言）；
//   ⑤ 拉取失败静默：不抛错、不渲染关键数字（用量条辅助信息不阻断会话）。
//
// 整个测试不包 QueryClientProvider——dialog 渲染路径零 react-query 约束
// （design R-04），组件 useEffect 自取数不依赖 Provider。
// mock 结构与 session-suspended-display.test.tsx 同款（@/lib/daemon 实际模块
// + getSessionUsage 覆写；stores/session 与 fetch-sse 防 daemon.ts 真实建连噪声）。

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

// fetch-sse 全 mock（daemon.ts import 侧依赖，防真实连接）。
const sseMock = vi.hoisted(() => ({ fetchSse: vi.fn() }));
vi.mock("@/lib/fetch-sse", () => ({ fetchSse: sseMock.fetchSse }));

// zustand session store mock：useSession(selector) 与 useSession.getState() 双形态。
const sessionStoreMock = vi.hoisted(() => ({
  state: {
    accessToken: "test-token" as string | null,
    refreshToken: "refresh-token",
    hydrated: true,
  },
}));
vi.mock("@/stores/session", () => ({
  useSession: Object.assign(
    (sel: (s: unknown) => unknown) => sel(sessionStoreMock.state),
    { getState: () => sessionStoreMock.state },
  ),
}));

// @/lib/daemon：实际模块 + getSessionUsage 覆写（本组件唯一数据源）。
const daemonMock = vi.hoisted(() => ({ getSessionUsage: vi.fn() }));
vi.mock("@/lib/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/lib/daemon")>("@/lib/daemon");
  return { ...actual, getSessionUsage: daemonMock.getSessionUsage };
});

import { SessionUsageBar } from "../session-usage-bar";
import type { SessionUsageRead } from "@/lib/daemon";

/* ────────────────────── 共用工具 ────────────────────── */

/** 冲刷 useEffect 取数 promise 链（全 microtask，无需真计时）。 */
async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await act(async () => {});
  }
}

/** 多桶数据（原型场景一形态）：两个明细模型 + 「未记录」兜底桶。 */
function multiBucketUsage(): SessionUsageRead {
  return {
    totals: {
      model: "totals",
      input_tokens: 15_200,
      output_tokens: 11_522,
      cache_read_tokens: 643_300,
      cache_creation_tokens: 43_000,
      api_requests: 128,
    },
    by_model: [
      {
        model: "glm-4.7",
        input_tokens: 9_800,
        output_tokens: 7_120,
        cache_read_tokens: 421_533,
        cache_creation_tokens: 26_400,
        api_requests: 102,
      },
      {
        model: "glm-4.7-air",
        input_tokens: 2_400,
        output_tokens: 1_522,
        cache_read_tokens: 71_767,
        cache_creation_tokens: 4_600,
        api_requests: 26,
      },
      {
        model: "未记录",
        input_tokens: 3_000,
        output_tokens: 2_880,
        cache_read_tokens: 150_000,
        cache_creation_tokens: 12_000,
        api_requests: 0,
      },
    ],
  };
}

/** 全 0 空会话（原型边界态：五指标全 0，命中率分母 0）。 */
function zeroUsage(): SessionUsageRead {
  return {
    totals: {
      model: "totals",
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      api_requests: 0,
    },
    by_model: [],
  };
}

beforeEach(() => {
  daemonMock.getSessionUsage.mockReset();
  daemonMock.getSessionUsage.mockResolvedValue(zeroUsage());
});

/* ────────────────────── ① 摘要行六项 ────────────────────── */

describe("SessionUsageBar 摘要行（task-03 / FR-02 / D-003）", () => {
  it("六项 aria-label + 数值：万级缩写、千分位、命中率百分比（97.7%）；首载 loading 静默不渲染", async () => {
    daemonMock.getSessionUsage.mockResolvedValue(multiBucketUsage());
    render(<SessionUsageBar sessionId="s-1" />);
    // 首载静默：promise 未 resolve 前整体不渲染（无 loading 占位）
    expect(screen.queryByLabelText("输入")).toBeNull();
    await flush();

    // 六项指标名（图标化后经 antd Tooltip 悬浮提示暴露，触发元素带 aria-label）
    for (const label of ["输入", "输出", "缓存读取", "缓存写入", "请求次数", "缓存命中率"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    // 数值：万级缩写（>= 1 万 → X.X 万）
    expect(screen.getByText("1.5 万")).toBeInTheDocument(); // 15,200
    expect(screen.getByText("1.2 万")).toBeInTheDocument(); // 11,522
    expect(screen.getByText("64.3 万")).toBeInTheDocument(); // 643,300
    expect(screen.getByText("4.3 万")).toBeInTheDocument(); // 43,000
    // 请求次数原数直显
    expect(screen.getByText("128")).toBeInTheDocument();
    // 命中率：643,300 / (643,300 + 15,200) = 97.7%
    expect(screen.getByText("97.7%")).toBeInTheDocument();
    expect(daemonMock.getSessionUsage).toHaveBeenCalledWith("s-1");
  });
});

/* ────────────────────── ② 分母 0 ────────────────────── */

describe("SessionUsageBar 命中率分母 0（task-03 / D-003）", () => {
  it("全 0 会话：命中率「—」、五指标 0、by_model 空不渲染切换按钮", async () => {
    daemonMock.getSessionUsage.mockResolvedValue(zeroUsage());
    render(<SessionUsageBar sessionId="s-1" />);
    await flush();

    expect(screen.getByText("—")).toBeInTheDocument();
    // 五项数值全 0（输入/输出/缓存读取/缓存写入/请求次数）
    expect(screen.getAllByText("0")).toHaveLength(5);
    // by_model 空 → 无「按模型明细」切换按钮
    expect(screen.queryByRole("button", { name: /按模型明细/ })).toBeNull();
  });
});

/* ────────────────────── ③ 折叠交互 ────────────────────── */

describe("SessionUsageBar 折叠明细（task-03 / D-002）", () => {
  it("初始明细表不渲染；点「按模型明细」后渲染模型行（含「未记录（旧轮次）」）与口径脚注", async () => {
    daemonMock.getSessionUsage.mockResolvedValue(multiBucketUsage());
    render(<SessionUsageBar sessionId="s-1" />);
    await flush();

    // 初始折叠：明细行 / 脚注不渲染（摘要行常驻）
    expect(screen.queryByText("glm-4.7")).toBeNull();
    expect(screen.queryByText("未记录（旧轮次）")).toBeNull();
    expect(screen.queryByText(/数据随每轮结束刷新/)).toBeNull();
    expect(screen.getByText("97.7%")).toBeInTheDocument();

    // 展开：by_model 非空才渲染切换按钮
    const toggle = screen.getByRole("button", { name: /按模型明细/ });
    fireEvent.click(toggle);

    // 模型行（正常模型 + 「未记录（旧轮次）」兜底桶）
    expect(screen.getByText("glm-4.7")).toBeInTheDocument();
    expect(screen.getByText("glm-4.7-air")).toBeInTheDocument();
    expect(screen.getByText("未记录（旧轮次）")).toBeInTheDocument();
    // 明细数值：万以下千分位直显 + 行级命中率（98.0% / 96.8% 为明细行独有值）
    expect(screen.getByText("9,800")).toBeInTheDocument();
    expect(screen.getByText("3,000")).toBeInTheDocument();
    expect(screen.getByText("98.0%")).toBeInTheDocument(); // 150,000 / 153,000
    expect(screen.getByText("96.8%")).toBeInTheDocument(); // 71,767 / 74,167
    // 口径脚注
    expect(screen.getByText(/口径：命中率 = 缓存读取 ÷（缓存读取 \+ 输入）/)).toBeInTheDocument();
    expect(screen.getByText(/请求次数无来源按 0 计/)).toBeInTheDocument();
    expect(screen.getByText(/数据随每轮结束刷新/)).toBeInTheDocument();

    // 再点一次收起
    fireEvent.click(toggle);
    expect(screen.queryByText("glm-4.7")).toBeNull();
  });
});

/* ────────────────────── ④ refreshSignal 重取 ────────────────────── */

describe("SessionUsageBar refreshSignal 重取（task-03 / R-04，零 QueryClientProvider）", () => {
  it("rerender 传 refreshSignal+1 → getSessionUsage 调用次数递增；挂载不包 Provider", async () => {
    daemonMock.getSessionUsage.mockResolvedValue(multiBucketUsage());
    // 直接裸渲染（无 QueryClientProvider）——dialog 零 react-query 约束
    const view = render(<SessionUsageBar sessionId="s-1" refreshSignal={0} />);
    await flush();
    expect(daemonMock.getSessionUsage).toHaveBeenCalledTimes(1);
    expect(daemonMock.getSessionUsage).toHaveBeenCalledWith("s-1");

    // 每次构造新元素字面量（同引用会命中 React bail-out，对齐既有测试惯例）
    view.rerender(<SessionUsageBar sessionId="s-1" refreshSignal={1} />);
    await flush();
    expect(daemonMock.getSessionUsage).toHaveBeenCalledTimes(2);
    expect(daemonMock.getSessionUsage).toHaveBeenLastCalledWith("s-1");
  });
});

/* ────────────────────── ⑤ 错误静默 ────────────────────── */

describe("SessionUsageBar 拉取失败静默（task-03）", () => {
  it("mockRejectedValue：不抛错、条不渲染（关键数字缺失）", async () => {
    daemonMock.getSessionUsage.mockRejectedValue(new Error("boom"));
    render(<SessionUsageBar sessionId="s-1" />);
    await flush();

    // 无 loading 占位、无错误横幅、无关键数字——整体不渲染
    expect(screen.queryByLabelText("输入")).toBeNull();
    expect(screen.queryByLabelText("缓存命中率")).toBeNull();
    expect(screen.queryByText("97.7%")).toBeNull();
    expect(screen.queryByText("0")).toBeNull();
    expect(daemonMock.getSessionUsage).toHaveBeenCalledTimes(1);
  });
});

/**
 * 快速修复 tab 组件测试（task-08 / FR-05 / FR-08 / D-001 / D-007）。
 *
 * 覆盖：
 *   1. 4 态状态徽标映射（completed 绿/in_progress 蓝/partial_done 黄/stale 红）
 *   2. 空壳默认显示开关（默认勾选；后端 include_placeholder 参数透传）
 *   3. 轮询纯函数两分支：in_progress|stale 存在 → 30000；全终态 → false
 *   4. 列渲染：负责人 enrich 名 / 影响模块「—」降级 / 关联变更链接
 *   5. 筛选交互：状态切换触发带 status 参数的请求
 *   6. 空态分场景（默认无记录引导 / 有筛选无匹配短文案）
 *   7. placeholder 条目标记渲染（空壳占位斜体）
 *   8. 「执行」列三态（task-08 / D-004@v1）：完整 usage 两行摘要 + 悬浮起止
 *      时间 / 进行中标记（started_at 有值且 finished_at 缺）/ usage null →「—」
 *
 * mock 范式照 changes page.test：vi.mock @/lib/quicklog + QueryClientProvider。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuicklogTable } from "@/components/changes/quicklog-table";
import type { components } from "@/lib/api-types";
import { quicklogPollInterval, type QuicklogEntryListItem } from "@/lib/quicklog";

const mocks = vi.hoisted(() => ({
  listQuicklogEntries: vi.fn(),
}));

vi.mock("@/lib/quicklog", async () => {
  const actual = await vi.importActual<typeof import("@/lib/quicklog")>(
    "@/lib/quicklog",
  );
  return { ...actual, listQuicklogEntries: mocks.listQuicklogEntries };
});

function makeEntry(overrides: Partial<QuicklogEntryListItem> = {}): QuicklogEntryListItem {
  return {
    ql_id: "ql-20260817-001-abcd",
    timestamp: "2026-08-17T01:30:00Z",
    title: "修侧栏宽度塌陷",
    status: "completed",
    status_note: null,
    placeholder: false,
    author_raw: "qinyi",
    author_name: "秦毅",
    owner_name: null,
    linked_changes: [],
    files: [],
    affected_modules: [],
    source: "file",
    // task-08：默认无关联执行（后端显式 None 形态）
    usage: null,
    ...overrides,
  };
}

/** 「执行」列用量摘要（api-types 生成，禁止手写）。 */
type UsageSummaryRead = components["schemas"]["UsageSummaryRead"];

/** 默认四维和 = 4.86M tok（4,860,000 → 4.9M 一位小数）/ 214 次 / 9 轮，耗时 3.6 小时
 * ——数字形态对齐原型场景二第一行的同构放大版（ql-20260904-012 起单位 K/M）。 */
function makeUsage(
  usage: Partial<UsageSummaryRead> = {},
  totals: Partial<UsageSummaryRead["totals"]> = {},
): UsageSummaryRead {
  return {
    started_at: "2026-08-28T02:12:00Z",
    finished_at: "2026-08-30T07:40:00Z",
    duration_ms: 12_960_000, // 3.6 小时
    totals: {
      input_tokens: 4_000_000,
      output_tokens: 460_000,
      cache_read_tokens: 300_000,
      cache_creation_tokens: 100_000,
      api_requests: 214,
      num_turns: 9,
      ...totals,
    },
    ...usage,
  };
}

/** 镜像组件 formatMmDdHm（本地时区 MM-DD HH:mm），悬浮 title 断言用。 */
function mmddhm(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderTable() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchInterval: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <QuicklogTable workspaceId="ws-1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.listQuicklogEntries.mockReset();
});

afterEach(cleanup);

describe("QuicklogTable", () => {
  it("渲染 4 态状态徽标 + enrich 负责人 + 模块「—」降级", async () => {
    mocks.listQuicklogEntries.mockResolvedValue({
      items: [
        makeEntry({ ql_id: "a", status: "completed" }),
        makeEntry({ ql_id: "b", status: "in_progress", author_name: null }),
        makeEntry({ ql_id: "c", status: "partial_done" }),
        makeEntry({ ql_id: "d", status: "stale" }),
      ],
      total: 4,
    });
    renderTable();

    expect(await screen.findByText("已完成")).toBeTruthy();
    expect(screen.getByText("进行中")).toBeTruthy();
    expect(screen.getByText("已暂存")).toBeTruthy();
    expect(screen.getByText("疑似中断")).toBeTruthy();
    // enrich 命中显示 display_name；未命中回退 author_raw
    expect(screen.getAllByText("秦毅").length).toBe(3); // a/c/d 三行 enrich 命中
    expect(screen.getAllByText("qinyi").length).toBe(1); // b 行 author_name=null 回退
    // 模块空列表降级「—」（R-06）
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("负责人列 owner_name 优先，None 回退 author 链兜底（ql-20260818-006）", async () => {
    mocks.listQuicklogEntries.mockResolvedValue({
      items: [
        // 关联变更 owner 解析命中 → 优先显示（author_name 不再展示）
        makeEntry({ ql_id: "o1", owner_name: "王负责人", author_name: "秦毅" }),
      ],
      total: 1,
    });
    renderTable();
    expect(await screen.findByText("王负责人")).toBeTruthy();
    expect(screen.queryByText("秦毅")).toBeNull(); // o1 不再显示 author_name
  });

  it("owner None 回退链：author_name → author_raw（兜底顺序）", async () => {
    mocks.listQuicklogEntries.mockResolvedValue({
      items: [
        makeEntry({ ql_id: "f1", owner_name: null }),
        makeEntry({ ql_id: "f2", owner_name: null, author_name: null }),
      ],
      total: 2,
    });
    renderTable();
    // f1 author_name=秦毅；f2 回退 author_raw=qinyi
    expect(await screen.findByText("秦毅")).toBeTruthy();
    expect(screen.getByText("qinyi")).toBeTruthy();
  });

  it("列表默认带 include_placeholder=true（空壳默认显示，ql-20260820-008）", async () => {
    mocks.listQuicklogEntries.mockResolvedValue({ items: [], total: 0 });
    renderTable();
    await waitFor(() =>
      expect(mocks.listQuicklogEntries).toHaveBeenCalled(),
    );
    const firstCall = mocks.listQuicklogEntries.mock.calls[0];
    expect(firstCall).toBeDefined();
    const params = firstCall?.[1];
    expect(params?.include_placeholder).toBe(true);
  });

  it("取消勾选「显示空壳占位」→ 后续请求不带 include_placeholder（回到隐藏口径）", async () => {
    mocks.listQuicklogEntries.mockResolvedValue({ items: [], total: 0 });
    renderTable();
    const cb = await screen.findByRole("checkbox");
    fireEvent.click(cb); // 默认勾选 → 点击即取消
    await waitFor(() => {
      const calls = mocks.listQuicklogEntries.mock.calls;
      const withoutPlaceholder = calls.some(
        (c) => c[1]?.include_placeholder === undefined,
      );
      expect(withoutPlaceholder).toBe(true);
    });
  });

  it("状态筛选切换 → 带 status 参数请求", async () => {
    mocks.listQuicklogEntries.mockResolvedValue({ items: [], total: 0 });
    renderTable();
    // 打开状态下拉（antd Select）选「已完成」
    await screen.findByText("全部状态");
    fireEvent.mouseDown(screen.getByText("全部状态"));
    const option = await waitFor(() => screen.getByText("已完成", { selector: ".ant-select-item-option-content" }));
    fireEvent.click(option);
    await waitFor(() => {
      const calls = mocks.listQuicklogEntries.mock.calls;
      expect(
        calls.some((c) => (c[1]?.status as string | undefined) === "completed"),
      ).toBe(true);
    });
  });

  it("placeholder 条目渲染斜体占位标题", async () => {
    mocks.listQuicklogEntries.mockResolvedValue({
      items: [makeEntry({ ql_id: "p1", placeholder: true, title: "(quick 任务)" })],
      total: 1,
    });
    renderTable();
    expect(await screen.findByText("（空壳占位）")).toBeTruthy();
    // 原始占位标题不直接渲染
    expect(screen.queryByText("(quick 任务)")).toBeNull();
  });

  it("关联变更列渲染链接（跳变更中心搜索）", async () => {
    mocks.listQuicklogEntries.mockResolvedValue({
      items: [
        makeEntry({
          ql_id: "l1",
          linked_changes: ["2026-08-16-change-center-quick-tab"],
        }),
      ],
      total: 1,
    });
    renderTable();
    const link = await screen.findByText("2026-08-16-change-center-quick-tab");
    expect(link.getAttribute("href")).toContain(
      "/workspaces/ws-1/changes?search=2026-08-16-change-center-quick-tab",
    );
  });

  it("空态：无记录引导文案；有筛选时短文案", async () => {
    mocks.listQuicklogEntries.mockResolvedValue({ items: [], total: 0 });
    renderTable();
    expect(await screen.findByText("还没有快速修复记录")).toBeTruthy();

    // 触发一次带 search 的查询（输入回车）
    const input = screen.getByPlaceholderText("搜索标题 / 正文全文…");
    fireEvent.change(input, { target: { value: "不存在的词" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(
        mocks.listQuicklogEntries.mock.calls.some((c) => c[1]?.search === "不存在的词"),
      ).toBe(true),
    );
    // mock 仍返回空 → 有筛选空态短文案
    await waitFor(() => screen.findByText("没有匹配的快速修复记录。"), { timeout: 3000 });
  });
});

describe("QuicklogTable 执行列（task-08 / FR-05 / D-004@v1）", () => {
  it("完整 usage：耗时 + token·次·轮 两行 + 悬浮起止时间", async () => {
    mocks.listQuicklogEntries.mockResolvedValue({
      items: [makeEntry({ ql_id: "u1", usage: makeUsage() })],
      total: 1,
    });
    renderTable();
    // 首行耗时：>= 1 小时一位小数（12,960,000ms → 3.6 小时）
    expect(await screen.findByText("3.6 小时")).toBeTruthy();
    // 次行：token 总量（四维之和 4,860,000 → 4.9M，K/M 一位小数）· 次数千分位 · 轮数
    expect(screen.getByText("4.9M tok · 214 次 · 9 轮")).toBeTruthy();
    // 整格 title 悬浮起止时间（本地时区 MM-DD HH:mm，镜像组件口径）
    expect(
      screen.getByTitle(
        `开始 ${mmddhm("2026-08-28T02:12:00Z")} · 结束 ${mmddhm("2026-08-30T07:40:00Z")}`,
      ),
    ).toBeTruthy();
    // finished_at 有值 → 无进行中标记
    expect(screen.queryByText("进行中")).toBeNull();
  });

  it("进行中：started_at 有值且 finished_at 缺 → 耗时后「进行中」小标记", async () => {
    mocks.listQuicklogEntries.mockResolvedValue({
      items: [
        // status 用 completed（终态），确保「进行中」只来自执行列标记
        makeEntry({
          ql_id: "u2",
          usage: makeUsage(
            { started_at: "2026-08-30T06:02:00Z", finished_at: null, duration_ms: 2_040_000 },
            { api_requests: 28, num_turns: 4 },
          ),
        }),
      ],
      total: 1,
    });
    renderTable();
    // 不足 1 小时取整分钟（2,040,000ms → 34 分钟）
    expect(await screen.findByText("34 分钟")).toBeTruthy();
    expect(screen.getByText("进行中")).toBeTruthy();
    // 悬浮结束段显示「进行中」
    expect(
      screen.getByTitle(`开始 ${mmddhm("2026-08-30T06:02:00Z")} · 结束 进行中`),
    ).toBeTruthy();
  });

  it("usage null → 执行列「—」降级", async () => {
    mocks.listQuicklogEntries.mockResolvedValue({
      items: [
        // 影响模块/关联变更均有值，确保全表唯一「—」来自执行列降级
        makeEntry({
          ql_id: "u3",
          affected_modules: ["frontend"],
          linked_changes: ["2026-08-30-demo-change"],
        }),
      ],
      total: 1,
    });
    renderTable();
    await screen.findByText("修侧栏宽度塌陷");
    expect(screen.getAllByText("—")).toHaveLength(1);
  });
});

describe("quicklogPollInterval（轮询纯函数 FR-05）", () => {
  it("存在 in_progress → 30000", () => {
    expect(
      quicklogPollInterval([makeEntry({ status: "completed" }), makeEntry({ status: "in_progress" })]),
    ).toBe(30000);
  });

  it("存在 stale → 30000", () => {
    expect(quicklogPollInterval([makeEntry({ status: "stale" })])).toBe(30000);
  });

  it("全终态 → false 停轮", () => {
    expect(
      quicklogPollInterval([
        makeEntry({ status: "completed" }),
        makeEntry({ status: "partial_done" }),
      ]),
    ).toBe(false);
  });

  it("空列表 → false", () => {
    expect(quicklogPollInterval([])).toBe(false);
  });
});

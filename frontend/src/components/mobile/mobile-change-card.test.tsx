/**
 * task-05 · MobileChangeCard 单测（2026-08-26-mobile-workspace-page design §5.3 / §7 / FR-03；
 * task-02 / 2026-09-16-mobile-changes-parity 扩充信息行用例）。
 *
 * 覆盖卡片契约：
 *  - 待办徽标三态映射（对齐桌面 renderTodoBadge）：
 *    blocked → 「阻塞中」 / pending_review 命中 → PENDING_REVIEW_LABEL 映射文案 /
 *    否则空占位 —（槽位内断言，与新增负责人/用量「—」占位区分）；
 *  - 活动徽标（task-02；task-08 补停滞态）：ChangeActivityBadge 真组件挂载
 *    （空闲/进行中/停滞三态真值表，FR-02）；
 *  - 元信息行（task-02）：负责人三态（owner_name / owner_id 前 8 位 mono / 「—」）+
 *    影响组件（join 展示 / 空数组整段省略）；
 *  - 执行用量行（task-02）：usage 两档判空（undefined 整行不渲染 / null 「—」）+
 *    有值（耗时 + token·次）+ 进行中 pill（started_at 有且 finished_at 缺）；
 *  - 阶段徽标：ChangeStepBadge 渲染 stage 中文标签 + stepProgress 副行（step x/y）；
 *  - 相对时间：updated_at 经 formatRelativeTime 渲染（5 分钟前 → 「5 分钟前」）；
 *  - 变更名：title 优先展示、title 空降级 change_key；
 *  - 整卡可点 → onClick 回调触发一次。
 *
 * 不 mock 映射/时间函数：组件 import 真实 PENDING_REVIEW_LABEL（桌面页导出）与
 * formatRelativeTime / formatTokensCompact / formatDurationZh（task-01 桌面页导出），
 * 直接锁「复用而非复制」契约。
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { MobileChangeCard } from "@/components/mobile/mobile-change-card";
import type { ChangeSummary } from "@/lib/changes";

/** 桌面同源用量摘要类型（ChangeSummary.usage 去 null/undefined）。 */
type UsageSummary = NonNullable<ChangeSummary["usage"]>;

function makeChange(overrides: Partial<ChangeSummary> = {}): ChangeSummary {
  return {
    id: "c1",
    change_key: "2026-08-26-mobile-workspace-page",
    title: "工作区移动端页面",
    status: "in_progress",
    location: "active",
    change_type: null,
    affected_components: [],
    owner_id: null,
    current_stage: "execute",
    pending_review: null,
    step_progress: null,
    owner_name: null,
    last_pushed_at: null,
    // task-02：usage 两档判空显式声明——缺省 undefined（整行不渲染），
    // 用例按需覆写 null（「—」占位）或 makeUsage()（有值渲染）。
    usage: undefined,
    // 5 分钟前 → formatRelativeTime「< 1h」分支稳定输出「5 分钟前」
    updated_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    ...overrides,
  };
}

/** 用量摘要 fixture：token 四维之和 1,234,567 → 「1.2M」；156 次；3.6 小时。 */
function makeUsage(overrides: Partial<UsageSummary> = {}): UsageSummary {
  return {
    started_at: "2026-09-16T10:00:00Z",
    finished_at: "2026-09-16T11:00:00Z",
    duration_ms: 12_960_000, // 3.6 小时
    totals: {
      input_tokens: 600_000,
      output_tokens: 500_000,
      cache_read_tokens: 100_000,
      cache_creation_tokens: 34_567,
      api_requests: 156,
      num_turns: 12,
    },
    ...overrides,
  };
}

describe("MobileChangeCard 待办徽标三态（对齐桌面 renderTodoBadge）", () => {
  it("status=blocked → 「阻塞中」error 徽标", () => {
    render(
      <MobileChangeCard
        change={makeChange({ status: "blocked" })}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByText("阻塞中")).toBeInTheDocument();
  });

  it("pending_review 命中映射（plan_review → 待计划审核）", () => {
    render(
      <MobileChangeCard
        change={makeChange({ pending_review: "plan_review" })}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByText("待计划审核")).toBeInTheDocument();
  });

  it("无 blocked 且无 pending_review → 空占位 —（todo 槽位内，与负责人/用量占位区分）", () => {
    render(<MobileChangeCard change={makeChange()} onClick={vi.fn()} />);
    expect(
      within(screen.getByTestId("mobile-change-todo-badge")).getByText("—"),
    ).toBeInTheDocument();
    expect(screen.queryByText("阻塞中")).not.toBeInTheDocument();
  });
});

describe("MobileChangeCard 活动徽标（task-02 · ChangeActivityBadge 真组件挂载）", () => {
  it("step_progress 缺失（current_step_status=null）→ 空闲态徽标挂载", () => {
    render(<MobileChangeCard change={makeChange()} onClick={vi.fn()} />);
    const badge = screen.getByTestId("activity-idle");
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toBe("空闲");
  });

  it("current_step_status=active + 最近信号 → 进行中徽标挂载（props 同源透传）", () => {
    render(
      <MobileChangeCard
        change={makeChange({
          step_progress: {
            step_total: 5,
            steps_completed: 2,
            current_step_name: "task-02",
            current_step_status: "active",
            current_step_desc: null,
          },
          last_pushed_at: new Date(Date.now() - 2 * 60_000).toISOString(),
        })}
        onClick={vi.fn()}
      />,
    );
    const badge = screen.getByTestId("activity-active");
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain("进行中");
    expect(badge.textContent).toContain("2 分钟前");
  });

  // task-08（FR-02）：真值表第三态补齐——active 但最后信号超 30min 阈值（ACTIVITY_STALE_MS）
  it("current_step_status=active 但最后信号 > 30min → 「停滞」徽标挂载（activity-stale）", () => {
    render(
      <MobileChangeCard
        change={makeChange({
          step_progress: {
            step_total: 5,
            steps_completed: 2,
            current_step_name: "task-02",
            current_step_status: "active",
            current_step_desc: null,
          },
          last_pushed_at: new Date(Date.now() - 45 * 60_000).toISOString(),
        })}
        onClick={vi.fn()}
      />,
    );
    const badge = screen.getByTestId("activity-stale");
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toBe("停滞 · 最后信号 45 分钟前");
  });
});

describe("MobileChangeCard 元信息行（task-02 · 负责人三态 + 影响组件）", () => {
  const metaRow = () => screen.getByTestId("mobile-change-meta-row");

  it("owner_name 非空 → 用户名（前景色，非 mono）", () => {
    render(
      <MobileChangeCard
        change={makeChange({ owner_name: "qinyi" })}
        onClick={vi.fn()}
      />,
    );
    const owner = within(metaRow()).getByText("qinyi");
    expect(owner).toBeInTheDocument();
    expect(owner.className).toContain("text-foreground");
    expect(owner.className).not.toContain("font-mono");
  });

  it("owner_name 空且 owner_id 有值 → 前 8 位 mono 降级（对齐桌面 renderOwner）", () => {
    render(
      <MobileChangeCard
        change={makeChange({ owner_id: "11111111-2222-3333-4444-555555555555" })}
        onClick={vi.fn()}
      />,
    );
    const owner = within(metaRow()).getByText("11111111");
    expect(owner).toBeInTheDocument();
    expect(owner.className).toContain("font-mono");
    // 不展示完整 UUID
    expect(
      within(metaRow()).queryByText("11111111-2222-3333-4444-555555555555"),
    ).not.toBeInTheDocument();
  });

  it("owner_name / owner_id 双空 → 元信息行内「—」占位", () => {
    render(<MobileChangeCard change={makeChange()} onClick={vi.fn()} />);
    expect(within(metaRow()).getByText("—")).toBeInTheDocument();
    expect(metaRow().textContent).toContain("负责人");
  });

  it("affected_components 非空 → join(\", \") 单行展示", () => {
    render(
      <MobileChangeCard
        change={makeChange({
          affected_components: ["frontend/sessions", "daemon/api"],
        })}
        onClick={vi.fn()}
      />,
    );
    // getByText 只匹配元素直接文本节点：标签段「影响 」与值段（子 span）分别断言
    expect(within(metaRow()).getByText(/影响/)).toBeInTheDocument();
    expect(
      within(metaRow()).getByText("frontend/sessions, daemon/api"),
    ).toBeInTheDocument();
  });

  it("affected_components 空数组 → 「影响」整段省略不占行", () => {
    render(<MobileChangeCard change={makeChange()} onClick={vi.fn()} />);
    expect(within(metaRow()).queryByText(/影响/)).not.toBeInTheDocument();
  });
});

describe("MobileChangeCard 执行用量行（task-02 · usage 两档判空 + 进行中 pill）", () => {
  const usageRow = () => screen.getByTestId("mobile-change-usage-row");

  it("usage undefined（字段缺失）→ 整行不渲染", () => {
    render(
      <MobileChangeCard
        change={makeChange({ usage: undefined })}
        onClick={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId("mobile-change-usage-row"),
    ).not.toBeInTheDocument();
  });

  it("usage null（显式无关联执行）→ 分隔行内「—」占位", () => {
    render(
      <MobileChangeCard change={makeChange({ usage: null })} onClick={vi.fn()} />,
    );
    expect(usageRow().textContent).toBe("—");
  });

  it("usage 有值 → 耗时 + 四维 token 之和 · 次数（已结束无 pill）", () => {
    render(
      <MobileChangeCard
        change={makeChange({ usage: makeUsage() })}
        onClick={vi.fn()}
      />,
    );
    expect(within(usageRow()).getByText("3.6 小时")).toBeInTheDocument();
    // 600K + 500K + 100K + 34,567 = 1,234,567 → formatTokensCompact「1.2M」
    expect(within(usageRow()).getByText("1.2M tok · 156 次")).toBeInTheDocument();
    expect(within(usageRow()).queryByText("进行中")).not.toBeInTheDocument();
  });

  it("started_at 有值且 finished_at 缺 → 「进行中」pill（R-05 时间三元组）", () => {
    render(
      <MobileChangeCard
        change={makeChange({ usage: makeUsage({ finished_at: null }) })}
        onClick={vi.fn()}
      />,
    );
    expect(within(usageRow()).getByText("进行中")).toBeInTheDocument();
    expect(usageRow().className).toContain("border-dashed");
  });
});

describe("MobileChangeCard 阶段徽标（ChangeStepBadge 复用）", () => {
  it("渲染 stage 中文标签（execute → 执行）", () => {
    render(<MobileChangeCard change={makeChange()} onClick={vi.fn()} />);
    expect(screen.getByText("执行")).toBeInTheDocument();
  });

  it("step_progress 非空 → 渲染 step x/y 副行", () => {
    render(
      <MobileChangeCard
        change={makeChange({
          step_progress: {
            step_total: 5,
            steps_completed: 2,
            current_step_name: "task-03",
            current_step_status: "active",
            current_step_desc: null,
          },
        })}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByTestId("step-sub-row")).toBeInTheDocument();
    expect(screen.getByText("step 2/5")).toBeInTheDocument();
  });

  it("current_stage 缺省 → 降级 scan 标签（与桌面列降级口径一致）", () => {
    render(
      <MobileChangeCard
        change={makeChange({ current_stage: null })}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByText("扫描")).toBeInTheDocument();
  });
});

describe("MobileChangeCard 状态图标容器（quick-a4939946 视觉升级）", () => {
  it("默认（进行中）→ GitBranch + primary 语义色容器", () => {
    const { container } = render(
      <MobileChangeCard change={makeChange()} onClick={vi.fn()} />,
    );
    const card = screen.getByTestId("mobile-change-card");
    expect(card.className).toContain("gap-3");
    expect(card.className).toContain("p-3.5");
    // 左侧图标容器：语义色描边 + 淡底（primary 分支）
    const iconBox = container.querySelector(
      "span.border-primary\\/25",
    ) as HTMLElement | null;
    expect(iconBox).not.toBeNull();
    expect(iconBox?.className).toContain("h-10 w-10");
    // svg（lucide GitBranch）渲染在容器内
    expect(iconBox?.querySelector("svg")).not.toBeNull();
  });

  it("status=blocked → destructive 语义色容器", () => {
    const { container } = render(
      <MobileChangeCard
        change={makeChange({ status: "blocked" })}
        onClick={vi.fn()}
      />,
    );
    expect(
      container.querySelector("span.border-destructive\\/25"),
    ).not.toBeNull();
  });

  it("status=archived → success 语义色容器", () => {
    const { container } = render(
      <MobileChangeCard
        change={makeChange({ status: "archived" })}
        onClick={vi.fn()}
      />,
    );
    expect(
      container.querySelector("span.border-success\\/25"),
    ).not.toBeNull();
  });
});

describe("MobileChangeCard 相对时间与变更名", () => {
  it("updated_at 5 分钟前 → 「5 分钟前」", () => {
    render(<MobileChangeCard change={makeChange()} onClick={vi.fn()} />);
    expect(screen.getByText("5 分钟前")).toBeInTheDocument();
  });

  it("title 优先展示变更名，change_key 作副行", () => {
    render(<MobileChangeCard change={makeChange()} onClick={vi.fn()} />);
    expect(screen.getByText("工作区移动端页面")).toBeInTheDocument();
    expect(screen.getByText("2026-08-26-mobile-workspace-page")).toBeInTheDocument();
  });

  it("title 为空 → 变更名降级 change_key", () => {
    render(
      <MobileChangeCard
        change={makeChange({ title: null })}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByText("2026-08-26-mobile-workspace-page")).toBeInTheDocument();
  });
});

describe("MobileChangeCard 点击", () => {
  it("整卡可点 → onClick 触发一次", () => {
    const onClick = vi.fn();
    render(<MobileChangeCard change={makeChange()} onClick={onClick} />);
    fireEvent.click(
      screen.getByRole("button", { name: "打开变更 工作区移动端页面" }),
    );
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

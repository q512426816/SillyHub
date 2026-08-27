/**
 * task-05 · MobileChangeCard 单测（2026-08-26-mobile-workspace-page design §5.3 / §7 / FR-03）。
 *
 * 覆盖卡片契约：
 *  - 待办徽标三态映射（对齐桌面 renderTodoBadge）：
 *    blocked → 「阻塞中」 / pending_review 命中 → PENDING_REVIEW_LABEL 映射文案 /
 *    否则空占位 —；
 *  - 阶段徽标：ChangeStepBadge 渲染 stage 中文标签 + stepProgress 副行（step x/y）；
 *  - 相对时间：updated_at 经 formatRelativeTime 渲染（5 分钟前 → 「5 分钟前」）；
 *  - 变更名：title 优先展示、title 空降级 change_key；
 *  - 整卡可点 → onClick 回调触发一次。
 *
 * 不 mock 映射/时间函数：组件 import 真实 PENDING_REVIEW_LABEL（桌面页导出）与
 * formatRelativeTime，直接锁「复用而非复制」契约。
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { MobileChangeCard } from "@/components/mobile/mobile-change-card";
import type { ChangeSummary } from "@/lib/changes";

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
    // 5 分钟前 → formatRelativeTime「< 1h」分支稳定输出「5 分钟前」
    updated_at: new Date(Date.now() - 5 * 60_000).toISOString(),
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

  it("无 blocked 且无 pending_review → 空占位 —", () => {
    render(<MobileChangeCard change={makeChange()} onClick={vi.fn()} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("阻塞中")).not.toBeInTheDocument();
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

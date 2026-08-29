/**
 * task-12（2026-08-29-change-delete-closure-and-spec-pull / FR-09 / D-007@v1）：
 * ChangeActivityBadge 活动徽标组件测试（design §8.1 真值表前端半）。
 *
 * 覆盖 task 验收：
 *   - 三态真值表 f(current_step_status, last_pushed_at 年龄)：
 *       active 且 ≤30min → 「进行中 · x 分钟前」（brand 脉动点）
 *       active 且 >30min → 灰「停滞 · 最后信号 x 分钟前」（只陈述事实，R-12）
 *       waiting / null → 空闲态显示最后活动时间
 *   - 年龄阈值边界：恰好 30min（含）→ 进行中；30min+1s → 停滞
 *   - last_pushed_at 防御解析（ISO_LIKE_RE 白名单范式，对齐 change-step-timeline
 *     formatStepTime :75-102）：畸形串回退显示原文不炸组件；null 回退占位
 *   - 纯函数 resolveActivity / lastSignalFromSteps / parseIsoLikeMs 直接断言
 *
 * 范式参照 change-step-badge.test.tsx：纯 render + screen 断言；
 * 组件暴露 now 注入位，边界用例免 fake timer。
 */
import { render, screen } from "@testing-library/react";

import {
  ACTIVITY_STALE_MS,
  ChangeActivityBadge,
  ChangeLastSignal,
  formatAge,
  lastSignalFromSteps,
  parseIsoLikeMs,
  resolveActivity,
} from "@/components/changes/change-activity-badge";

/** 固定时钟（UTC 正午），所有年龄由 lastPushedAt 与 NOW 差值决定，零 flake。 */
const NOW = new Date("2026-08-29T12:00:00Z").getTime();

/** NOW - ms 的 ISO 串（Z 后缀绝对时间，不受测试机时区影响）。 */
function ago(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

describe("ChangeActivityBadge 真值表三态（design §8.1）", () => {
  it("active 且最后信号 ≤30min → 「进行中 · x 分钟前」（brand 脉动点，真实信号驱动）", () => {
    render(
      <ChangeActivityBadge
        currentStepStatus="active"
        lastPushedAt={ago(5 * 60_000)}
        now={NOW}
      />,
    );
    const badge = screen.getByTestId("activity-active");
    expect(badge).toHaveTextContent("进行中 · 5 分钟前");
    // 既有蓝色脉动点语义保留：brand 阶 + animate-pulse（FRONTEND_PAGE_STYLE §0.5）
    const dot = badge.querySelector("span[aria-hidden]");
    expect(dot?.className).toContain("animate-pulse");
    expect(dot?.className).toContain("bg-brand-600");
    // title 悬停保留 ISO 原文（对齐 StepTime title=completed_at 惯例）
    expect(badge).toHaveAttribute("title", ago(5 * 60_000));
  });

  it("边界：恰好 30min（含）→ 仍为进行中", () => {
    render(
      <ChangeActivityBadge
        currentStepStatus="active"
        lastPushedAt={ago(ACTIVITY_STALE_MS)}
        now={NOW}
      />,
    );
    expect(screen.getByTestId("activity-active")).toHaveTextContent(
      "进行中 · 30 分钟前",
    );
  });

  it("边界：30min + 1s → 停滞", () => {
    render(
      <ChangeActivityBadge
        currentStepStatus="active"
        lastPushedAt={ago(ACTIVITY_STALE_MS + 1_000)}
        now={NOW}
      />,
    );
    expect(screen.getByTestId("activity-stale")).toBeInTheDocument();
  });

  it("active 且 >30min → 灰「停滞 · 最后信号 x 分钟前」（只陈述事实不断言挂死，R-12）", () => {
    render(
      <ChangeActivityBadge
        currentStepStatus="active"
        lastPushedAt={ago(2 * 3_600_000)}
        now={NOW}
      />,
    );
    const badge = screen.getByTestId("activity-stale");
    expect(badge).toHaveTextContent("停滞 · 最后信号 2 小时前");
    // 灰点（非 brand、非脉动）
    const dot = badge.querySelector("span[aria-hidden]");
    expect(dot?.className).toContain("bg-muted-foreground");
    expect(dot?.className).not.toContain("animate-pulse");
    // R-12：文案不得断言挂死/没在跑
    expect(badge.textContent).not.toMatch(/挂死|没在跑|卡死|异常终止/);
  });

  it("waiting → 空闲态，显示最后活动时间", () => {
    render(
      <ChangeActivityBadge
        currentStepStatus="waiting"
        lastPushedAt={ago(3 * 3_600_000)}
        now={NOW}
      />,
    );
    expect(screen.getByTestId("activity-idle")).toHaveTextContent(
      "空闲 · 最后活动 3 小时前",
    );
  });

  it("current_step_status=null（step_progress 缺失）→ 空闲态", () => {
    render(
      <ChangeActivityBadge
        currentStepStatus={null}
        lastPushedAt={ago(10 * 60_000)}
        now={NOW}
      />,
    );
    expect(screen.getByTestId("activity-idle")).toHaveTextContent(
      "空闲 · 最后活动 10 分钟前",
    );
  });
});

describe("last_pushed_at 防御解析（ISO_LIKE_RE 白名单 + 回退）", () => {
  it("active + 畸形串 → 不炸组件，保持「进行中」不陈述年龄，title 保留原文", () => {
    render(
      <ChangeActivityBadge
        currentStepStatus="active"
        lastPushedAt="not-a-date-|||garbage"
        now={NOW}
      />,
    );
    const badge = screen.getByTestId("activity-active");
    expect(badge).toHaveTextContent("进行中");
    // 无法计算年龄 → 不给「x 分钟前」时间性断言
    expect(badge.textContent).not.toMatch(/分钟前|小时前|天前/);
    expect(badge).toHaveAttribute("title", "not-a-date-|||garbage");
  });

  it("waiting + 畸形串 → 空闲态回退显示原文（不抛错）", () => {
    render(
      <ChangeActivityBadge
        currentStepStatus="waiting"
        lastPushedAt="2026-08-29 某个下午"
        now={NOW}
      />,
    );
    expect(screen.getByTestId("activity-idle")).toHaveTextContent(
      "空闲 · 最后活动 2026-08-29 某个下午",
    );
  });

  it("active + null → 「进行中」无年龄断言，无 title", () => {
    render(
      <ChangeActivityBadge currentStepStatus="active" lastPushedAt={null} now={NOW} />,
    );
    const badge = screen.getByTestId("activity-active");
    expect(badge).toHaveTextContent("进行中");
    expect(badge.textContent).not.toMatch(/分钟前|小时前/);
    expect(badge).not.toHaveAttribute("title");
  });

  it("waiting + null → 空闲无时间后缀（占位，不炸）", () => {
    render(
      <ChangeActivityBadge currentStepStatus="waiting" lastPushedAt={null} now={NOW} />,
    );
    expect(screen.getByTestId("activity-idle")).toHaveTextContent("空闲");
  });

  it("parseIsoLikeMs：ISO 白名单命中 → epoch；畸形 / 越界月日 → null", () => {
    expect(parseIsoLikeMs("2026-08-29T12:00:00Z")).toBe(
      new Date("2026-08-29T12:00:00Z").getTime(),
    );
    // 微秒截毫秒 + 偏移规范化（对齐 formatStepTime 重写规则）
    expect(parseIsoLikeMs("2026-08-29T12:00:00.123456+00:00")).toBe(
      new Date("2026-08-29T12:00:00.123Z").getTime(),
    );
    // 空格分隔 + 无秒 + 无时区（CLI 端 isoformat 常见形状）
    expect(parseIsoLikeMs("2026-08-29 12:00")).toBe(
      new Date("2026-08-29T12:00:00Z").getTime(),
    );
    expect(parseIsoLikeMs("garbage")).toBeNull();
    expect(parseIsoLikeMs("2026-13-40T99:99:99Z")).toBeNull();
    expect(parseIsoLikeMs("")).toBeNull();
  });

  it("resolveActivity 纯函数：负年龄（时钟偏移/未来信号）钳为进行中不炸", () => {
    const r = resolveActivity("active", ago(0), NOW - 60_000);
    expect(r.state).toBe("active");
    // 展示层 formatAge 负值钳「刚刚」
    expect(formatAge(-5_000)).toBe("刚刚");
  });

  it("formatAge 分档：刚刚 / 分钟 / 小时 / 天", () => {
    expect(formatAge(30_000)).toBe("刚刚");
    expect(formatAge(59_000)).toBe("刚刚");
    expect(formatAge(60_000)).toBe("1 分钟前");
    expect(formatAge(3_540_000)).toBe("59 分钟前");
    expect(formatAge(3_600_000)).toBe("1 小时前");
    expect(formatAge(86_400_000)).toBe("1 天前");
  });
});

describe("ChangeLastSignal（详情页「最后信号」行）", () => {
  it("有信号 → 「最后信号：x 分钟前」，title 保留原文", () => {
    render(
      <ChangeLastSignal lastPushedAt={ago(7 * 60_000)} now={NOW} />,
    );
    const line = screen.getByTestId("change-last-signal");
    expect(line).toHaveTextContent("最后信号：7 分钟前");
    expect(line).toHaveAttribute("title", ago(7 * 60_000));
  });

  it("null / undefined → 不渲染（降级，零噪音）", () => {
    const { container } = render(
      <ChangeLastSignal lastPushedAt={null} now={NOW} />,
    );
    expect(container.firstChild).toBeNull();
    const { container: c2 } = render(<ChangeLastSignal now={NOW} />);
    expect(c2.firstChild).toBeNull();
  });

  it("畸形串 → 回退显示原文，不炸", () => {
    render(<ChangeLastSignal lastPushedAt="|||oops|||" now={NOW} />);
    expect(screen.getByTestId("change-last-signal")).toHaveTextContent(
      "最后信号：|||oops|||",
    );
  });
});

describe("lastSignalFromSteps（steps 明细最大 completed_at 派生）", () => {
  it("多条 completed_at → 取最大（最近推送时点），null 条目跳过", () => {
    const steps = [
      { completed_at: "2026-08-29T03:00:00Z" },
      { completed_at: null },
      { completed_at: "2026-08-29T05:00:00Z" },
    ];
    expect(lastSignalFromSteps(steps)).toBe("2026-08-29T05:00:00Z");
  });

  it("全部无 completed_at → null", () => {
    expect(
      lastSignalFromSteps([{ completed_at: null }, { completed_at: null }]),
    ).toBeNull();
  });

  it("steps null / undefined / 空数组 → null", () => {
    expect(lastSignalFromSteps(null)).toBeNull();
    expect(lastSignalFromSteps(undefined)).toBeNull();
    expect(lastSignalFromSteps([])).toBeNull();
  });

  it("全部畸形 → 回退最后一条原文（防御，不炸不猜）", () => {
    expect(
      lastSignalFromSteps([
        { completed_at: "bad-1" },
        { completed_at: "bad-2" },
      ]),
    ).toBe("bad-2");
  });
});

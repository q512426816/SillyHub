import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  ChangeTotalProgressRing,
  computeTotalRatio,
  pickLatestActive,
  type TotalProgressChange,
} from "@/components/daemon/change-total-progress-ring";

// ── 测试数据构造 ──────────────────────────────────────────────────────────
// TotalProgressChange 是本组件的手写最小结构视图（api-types 生成版
// ChangeSummary 待 task-11 gen:types；task-10 悬浮框接线时结构子类型兼容）。

function thinFlow(partial: Partial<NonNullable<TotalProgressChange["thin_flow"]>> = {}) {
  // as 断言收口：默认对象已含全字段（生成物 ThinFlowProgress 全必填——backend
  // pydantic 无 default），Partial 展开后 TS 无法静态证明完整性。
  return {
    phase: "executing",
    approved: true,
    autopilot: false,
    adopted_from: null,
    tasks_total: 0,
    tasks_done: 0,
    substeps_done: 0,
    substeps_total: 8,
    upgraded: false,
    ...partial,
  } as NonNullable<TotalProgressChange["thin_flow"]>;
}

function stepProgress(
  step_total: number,
  steps_completed: number,
): NonNullable<TotalProgressChange["step_progress"]> {
  return { step_total, steps_completed };
}

function changeLike(partial: Partial<TotalProgressChange>): TotalProgressChange {
  return {
    change_key: "2026-10-26-demo-change",
    updated_at: "2026-10-26T12:00:00Z",
    is_thin: false,
    step_progress: null,
    thin_flow: null,
    ...partial,
  };
}

// ── computeTotalRatio（口径函数单源，design FR-05）────────────────────────

describe("computeTotalRatio（全量口径：steps_completed/step_total）", () => {
  it("非 thin 变更按 step_progress 步数比计算", () => {
    const c = changeLike({ step_progress: stepProgress(24, 10) });
    expect(computeTotalRatio(c)).toBeCloseTo(10 / 24, 5);
  });

  it("step_progress 缺失（旧数据/六表未上行）→ null（环不渲染，FR-07 降级）", () => {
    expect(computeTotalRatio(changeLike({ step_progress: null }))).toBeNull();
  });

  it("step_total=0（除零防御）→ null", () => {
    expect(computeTotalRatio(changeLike({ step_progress: stepProgress(0, 0) }))).toBeNull();
  });

  it("steps_completed 超过 step_total（异常数据）→ 钳制 1，不出 >100%", () => {
    const c = changeLike({ step_progress: stepProgress(24, 30) });
    expect(computeTotalRatio(c)).toBe(1);
  });
});

describe("computeTotalRatio（轻量口径：相位加权，design 接口定义）", () => {
  it("spec 相位 → 0.1", () => {
    const c = changeLike({ is_thin: true, thin_flow: thinFlow({ phase: "spec" }) });
    expect(computeTotalRatio(c)).toBeCloseTo(0.1, 5);
  });

  it("awaiting_approval 相位 → 0.15", () => {
    const c = changeLike({
      is_thin: true,
      thin_flow: thinFlow({ phase: "awaiting_approval" }),
    });
    expect(computeTotalRatio(c)).toBeCloseTo(0.15, 5);
  });

  it("executing 相位 → 0.33 + 0.34×tasks_done/tasks_total", () => {
    const c = changeLike({
      is_thin: true,
      thin_flow: thinFlow({ phase: "executing", tasks_done: 2, tasks_total: 5 }),
    });
    expect(computeTotalRatio(c)).toBeCloseTo(0.33 + 0.34 * (2 / 5), 5);
  });

  it("executing tasks_total=0 → 分母 max(,1) 兜底，不除零（盲区口径）", () => {
    const c = changeLike({
      is_thin: true,
      thin_flow: thinFlow({ phase: "executing", tasks_done: 0, tasks_total: 0 }),
    });
    expect(computeTotalRatio(c)).toBeCloseTo(0.33, 5);
  });

  it("closing 相位 → 0.67 + 0.33×substeps_done/8", () => {
    const c = changeLike({
      is_thin: true,
      thin_flow: thinFlow({ phase: "closing", substeps_done: 4 }),
    });
    expect(computeTotalRatio(c)).toBeCloseTo(0.67 + 0.33 * (4 / 8), 5);
  });

  it("is_thin 但 thin_flow 缺失（旧 daemon 无新键）→ null（环不渲染）", () => {
    expect(computeTotalRatio(changeLike({ is_thin: true, thin_flow: null }))).toBeNull();
  });

  it("未知 phase（backend 归一枚举外透传值）→ null", () => {
    const c = changeLike({ is_thin: true, thin_flow: thinFlow({ phase: "weird" }) });
    expect(computeTotalRatio(c)).toBeNull();
  });

  it("升厚（thin_flow.upgraded）→ 切全量口径读 step_progress（FR-04 分支优先级单源）", () => {
    const c = changeLike({
      is_thin: true,
      thin_flow: thinFlow({ phase: "executing", upgraded: true }),
      step_progress: stepProgress(24, 10),
    });
    expect(computeTotalRatio(c)).toBeCloseTo(10 / 24, 5);
  });

  it("executing 加权超 1（异常勾选数据）→ 钳制 1", () => {
    const c = changeLike({
      is_thin: true,
      thin_flow: thinFlow({ phase: "executing", tasks_done: 5, tasks_total: 2 }),
    });
    expect(computeTotalRatio(c)).toBe(1);
  });
});

// ── pickLatestActive（updated_at 显式重排选取，D-013@v1 / 盲区#6）────────

describe("pickLatestActive（updated_at 显式重排，禁用后端列表序）", () => {
  // 后端列表序 = 未归档优先 + created_at desc（session-change-files-hover.tsx:63
  // 注释）——构造「created 晚（后端排前）但 updated_at 早」与相反的 A/B 对，
  // 证明取首项 ≠ updated_at 最新，必须显式重排（D-013@v1）。
  const createdLateUpdatedEarly = changeLike({
    change_key: "2026-10-25-a",
    updated_at: "2026-10-26T10:00:00Z",
  });
  const createdEarlyUpdatedLate = changeLike({
    change_key: "2026-10-20-b",
    updated_at: "2026-10-26T12:00:00Z",
  });

  it("后端序取首不成立的场景：选 updated_at 最新（与输入顺序无关）", () => {
    expect(pickLatestActive([createdLateUpdatedEarly, createdEarlyUpdatedLate])).toBe(
      createdEarlyUpdatedLate,
    );
    expect(pickLatestActive([createdEarlyUpdatedLate, createdLateUpdatedEarly])).toBe(
      createdEarlyUpdatedLate,
    );
  });

  it("并列 updated_at 回退 change_key 码点序（结果与输入顺序无关，盲区#6）", () => {
    const keyB = changeLike({ change_key: "2026-10-26-b", updated_at: "2026-10-26T12:00:00Z" });
    const keyA = changeLike({ change_key: "2026-10-26-a", updated_at: "2026-10-26T12:00:00Z" });
    expect(pickLatestActive([keyB, keyA])).toBe(keyA);
    expect(pickLatestActive([keyA, keyB])).toBe(keyA);
  });

  it("空数组 → null", () => {
    expect(pickLatestActive([])).toBeNull();
  });

  it("updated_at 非法串（数据异常）排最后，不 NaN 崩溃", () => {
    const bad = changeLike({ change_key: "2026-10-26-bad", updated_at: "not-a-date" });
    const good = changeLike({ change_key: "2026-10-26-good", updated_at: "2026-01-01T00:00:00Z" });
    expect(pickLatestActive([bad, good])).toBe(good);
  });
});

// ── ChangeTotalProgressRing（组件渲染）────────────────────────────────────

describe("ChangeTotalProgressRing（入口总进度圈渲染）", () => {
  it("全量口径渲染：环容器 + 中心百分比文字 + aria-label 文本化（R-05）", () => {
    const c = changeLike({ step_progress: stepProgress(24, 10) });
    render(<ChangeTotalProgressRing change={c} />);
    // 10/24 = 41.67% → round 42
    expect(screen.getByTestId("change-total-progress-ring")).toBeTruthy();
    expect(screen.getByTestId("change-total-progress-ring-percent").textContent).toBe("42%");
    expect(screen.getByRole("img", { name: "变更总进度 42%" })).toBeTruthy();
  });

  it("进度弧 stroke-dasharray 按比值填充圆周（2πr×ratio）", () => {
    const c = changeLike({ step_progress: stepProgress(24, 10) });
    render(<ChangeTotalProgressRing change={c} />);
    const arc = screen.getByTestId("change-total-progress-ring-arc");
    const dash = Number(arc.getAttribute("stroke-dasharray")!.split(" ")[0]);
    expect(dash).toBeCloseTo(2 * Math.PI * 10 * (10 / 24), 3);
  });

  it("轻量口径渲染：executing 相位 2/5 任务 → 47%", () => {
    const c = changeLike({
      is_thin: true,
      thin_flow: thinFlow({ phase: "executing", tasks_done: 2, tasks_total: 5 }),
    });
    render(<ChangeTotalProgressRing change={c} />);
    // 0.33 + 0.34×0.4 = 0.466 → round 47
    expect(screen.getByTestId("change-total-progress-ring-percent").textContent).toBe("47%");
  });

  it("ratio null（数据缺失）→ 不渲染（FR-05 降级，入口按钮区不受影响）", () => {
    const c = changeLike({ is_thin: true, thin_flow: null, step_progress: null });
    const { container } = render(<ChangeTotalProgressRing change={c} />);
    expect(container.innerHTML).toBe("");
    expect(screen.queryByTestId("change-total-progress-ring")).toBeNull();
  });
});

/**
 * isThinLineageChange 单测（2026-09-27-thin-display-fix / 评审 F2 补强）。
 * 覆盖三分支 + 时间窗负向（历史 quick/历史非标 steps 不误标）。
 * 实测数据锚：归档 thin（hover-polish）= archived + feature + 3 条全 archive steps；
 * 标准变更（observation-events）steps 含 plan/execute。
 */
import { describe, expect, it } from "vitest";

import { isThinLineageChange } from "@/lib/thin-lineage";

const AFTER_LIVE = "2026-09-26T10:00:00Z";
const BEFORE_LIVE = "2026-09-20T10:00:00Z";

describe("isThinLineageChange 三分支命中矩阵", () => {
  it("分支①：active 期 stage=thin 命中（时间窗内）", () => {
    expect(
      isThinLineageChange({ current_stage: "thin", created_at: AFTER_LIVE }),
    ).toBe(true);
  });

  it("分支②：平台 quick 分流（quick + 窗内）命中；窗外历史 quick 不命中", () => {
    expect(
      isThinLineageChange({
        change_type: "quick",
        created_at: AFTER_LIVE,
      }),
    ).toBe(true);
    expect(
      isThinLineageChange({
        change_type: "quick",
        created_at: BEFORE_LIVE,
      }),
    ).toBe(false);
  });

  it("分支③：归档 flow-thin（archived + feature + steps 全 archive）命中——实测样本形态", () => {
    expect(
      isThinLineageChange({
        current_stage: "archived",
        change_type: "feature",
        created_at: AFTER_LIVE,
        steps: [
          { stage: "archive" },
          { stage: "archive" },
          { stage: "archive" },
        ],
      }),
    ).toBe(true);
  });

  it("负向：标准变更（steps 含 plan/execute 痕迹）不命中", () => {
    expect(
      isThinLineageChange({
        current_stage: "archived",
        change_type: "feature",
        created_at: AFTER_LIVE,
        steps: [
          { stage: "archive" },
          { stage: "plan" },
          { stage: "execute" },
        ],
      }),
    ).toBe(false);
  });

  it("负向：无 steps 的早期标准变更不命中（steps.length>0 守卫）", () => {
    expect(
      isThinLineageChange({
        current_stage: "brainstorm",
        change_type: "feature",
        created_at: AFTER_LIVE,
        steps: [],
      }),
    ).toBe(false);
  });

  it("负向：窗外非标 steps（历史数据）不命中——时间窗双保险（评审 F1）", () => {
    expect(
      isThinLineageChange({
        current_stage: "archived",
        change_type: "feature",
        created_at: BEFORE_LIVE,
        steps: [{ stage: "archive" }],
      }),
    ).toBe(false);
  });
});

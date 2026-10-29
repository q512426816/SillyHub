/**
 * 2026-10-29-edit-diff-stat-badge（FR-03）：diffStatFromPatch 纯函数——
 * structuredPatch JSON → {added, removed} 统计（跑马灯条目 / 进度视图工具行
 * 的 diff stat 徽标数据源）。口径与 parseStructuredPatch 严格同源（同一解析
 * 器数行，徽标数与展开区行级 diff 永不矛盾）；解析失败 / 空 hunks / 零改动
 * → null（调用方不渲染，不伪造不估数）。
 */
import { describe, expect, it } from "vitest";

import { diffStatFromPatch } from "@/components/agent-log/tool-diff";

/** 单 hunk structuredPatch JSON 构造器（hunks 形状与 SDK 透传一致）。 */
function patchOf(lines: string[]): string {
  return JSON.stringify([{ oldStart: 1, newStart: 1, lines }]);
}

describe("2026-10-29-edit-diff-stat-badge: diffStatFromPatch 多 hunk 累计与行前缀计数", () => {
  it("单 hunk：按行前缀计数（ctx 不计、- 计删、+ 计增、\\ 跳过）", () => {
    const patch = patchOf([
      " 上下文行",
      "-删除行1",
      "-删除行2",
      "+新增行1",
      "\\ No newline at end of file",
    ]);
    expect(diffStatFromPatch(patch)).toEqual({ added: 1, removed: 2 });
  });

  it("多 hunk 累计：两 hunk 各 +2 -1 → {added:4, removed:2}", () => {
    const patch = JSON.stringify([
      { oldStart: 10, newStart: 10, lines: ["-a", "+b", "+c"] },
      { oldStart: 50, newStart: 52, lines: ["-d", "+e", "+f"] },
    ]);
    expect(diffStatFromPatch(patch)).toEqual({ added: 4, removed: 2 });
  });

  it("纯新增（Write 新建文件形态）：removed=0，added=行数", () => {
    const patch = patchOf(["+第一行", "+第二行", "+第三行"]);
    expect(diffStatFromPatch(patch)).toEqual({ added: 3, removed: 0 });
  });

  it("纯删除：added=0，removed=行数", () => {
    const patch = patchOf(["-旧1", "-旧2"]);
    expect(diffStatFromPatch(patch)).toEqual({ added: 0, removed: 2 });
  });
});

describe("2026-10-29-edit-diff-stat-badge: 非法 JSON / 空 hunks / 零改动返回 null", () => {
  it("非法 JSON → null", () => {
    expect(diffStatFromPatch("{not-json")).toBeNull();
  });

  it("空 hunks 数组 → null", () => {
    expect(diffStatFromPatch("[]")).toBeNull();
  });

  it("hunk 形状不符（缺 oldStart）→ null", () => {
    expect(diffStatFromPatch(JSON.stringify([{ newStart: 1, lines: ["+x"] }]))).toBeNull();
  });

  it("全上下文行零改动 0/0 → null（无信息不显示）", () => {
    expect(diffStatFromPatch(patchOf([" 不变1", " 不变2"]))).toBeNull();
  });

  it("空字符串 → null", () => {
    expect(diffStatFromPatch("")).toBeNull();
  });
});

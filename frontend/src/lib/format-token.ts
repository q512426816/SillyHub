// frontend/src/lib/format-token.ts
//
// task-16 / FR-11：token 数字格式化工具。
//
// 依据：
//   - .sillyspec/changes/2026-06-22-agent-run-pipeline-fix/task-16.md §TDD + §边界处理
//   - design.md §5.5（边界：1234 → 1.2k）
//   - requirements.md FR-11（agent-run 日志面板可见 input/output token 消耗）
//
// 规则：
//   - null / undefined → "—"（run 未开始或 daemon 尚未回写 usage）
//   - 0 → "0"（确认零消耗，与 null 区分）
//   - 1 ≤ n < 1000 → 原值（如 "847"）
//   - 1000 ≤ n < 1_000_000 → "X.Xk"（1 位小数）
//   - ≥ 1_000_000 → "X.XM"（1 位小数）

/**
 * 把 token 数格式化为紧凑展示字符串。
 *
 * @param n token 数量（number | null | undefined）
 * @returns 紧凑字符串（如 "847" / "1.2k" / "1.5M" / "—"）
 */
export function formatTokenCount(
  n: number | null | undefined,
): string {
  if (n == null) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

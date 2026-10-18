/**
 * git conventional 前缀类型标签（2026-10-18-change-type-git-conventional 抽公共件）。
 *
 * 类型值来自 flow-state.yaml commit_type（权威，回填/CLI 写入）；未知类型走中性
 * 配色显示原值。旧枚举 feature 语义等同 feat，显示层等价映射（数据不动）。
 * 消费方：变更详情页概览侧栏「类型」行、变更中心列表行 meta 行（两处同源同款）。
 */

const COMMIT_TYPE_STYLES: Record<string, string> = {
  feat: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  fix: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
  docs: "border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  refactor: "border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-400",
  test: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  perf: "border-cyan-500/40 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  build: "border-orange-500/40 bg-orange-500/10 text-orange-600 dark:text-orange-400",
  ci: "border-teal-500/40 bg-teal-500/10 text-teal-600 dark:text-teal-400",
  chore: "border-slate-500/40 bg-slate-500/10 text-slate-600 dark:text-slate-400",
  style: "border-pink-500/40 bg-pink-500/10 text-pink-600 dark:text-pink-400",
};

const COMMIT_TYPE_DISPLAY: Record<string, string> = {
  feature: "feat", // 旧枚举语义等价映射（仅显示层）
};

export function CommitTypeChip({ type }: { type: string }) {
  const display = COMMIT_TYPE_DISPLAY[type] ?? type;
  const cls = COMMIT_TYPE_STYLES[display] ?? "border-border bg-muted text-muted-foreground";
  return (
    <span
      data-testid="commit-type-chip"
      className={`inline-flex h-5 shrink-0 items-center rounded border px-1.5 font-mono text-[10px] font-semibold ${cls}`}
    >
      {display}
    </span>
  );
}

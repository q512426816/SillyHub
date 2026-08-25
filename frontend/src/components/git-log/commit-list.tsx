"use client";

/**
 * task-06：Git 日志提交列表（@tanstack/react-virtual 固定行高虚拟滚动）。
 *
 * - 行结构（原型列宽）：[泳道图列 148px] + message（截断省略）+ 作者 + 短哈希
 *   （monospace，accent 色——info 语义档即各主题 accent 青，D-003@v2）+
 *   refs 标签（branch=brand 底 / remote=muted 底 / tag=success 边框 /
 *   head=primary 实底白字）+ 时间（toLocaleString("zh-CN")）；
 * - 左列由 CommitGraph 绝对定位覆盖（z-0），行内容 z-[1] 接管点击与 hover
 *   （hover brand-50、选中态、文字可选中）；
 * - 虚拟行高固定 36px（COMMIT_ROW_HEIGHT，与泳道 laneY 共用）；
 * - 「加载更多」按钮由 page 持有（has_more 分页），本组件只负责行渲染。
 *
 * 依据：tasks/task-06.md、design.md §5.4 / §7.4、prototype-workspace-git-log.html。
 */

import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import type { GitLogCommitItem, GitLogRefItem } from "@/lib/git-log";
import { cn } from "@/lib/utils";
import { CommitGraph, COMMIT_ROW_HEIGHT, GRAPH_WIDTH } from "./commit-graph";

/** refs 标签样式映射（kind → 主题 token 类；原型 .ref 形态，36px 行内紧凑徽标）。 */
export const REF_BADGE_CLASS: Record<GitLogRefItem["kind"], string> = {
  branch: "bg-brand-100 text-brand-700",
  remote: "bg-muted text-muted-foreground",
  tag: "border border-success bg-success/10 text-success",
  head: "bg-primary font-semibold text-primary-foreground",
};

/** refs 标签组（commit 行与详情 Drawer 共用）。 */
export function RefBadges({ refs }: { refs: GitLogRefItem[] }) {
  if (refs.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <>
      {refs.map((r) => (
        <span
          key={`${r.kind}:${r.name}`}
          className={cn(
            "max-w-24 truncate rounded px-1.5 text-[11px] leading-4",
            REF_BADGE_CLASS[r.kind],
          )}
          title={r.name}
        >
          {r.kind === "head" ? "HEAD" : r.name}
        </span>
      ))}
    </>
  );
}

/** 作者时间格式化（zh-CN；CI 环境可能缺 ICU 数据，测试不断言具体格式）。 */
function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("zh-CN");
}

function CommitRow({
  commit,
  selected,
  onSelect,
}: {
  commit: GitLogCommitItem;
  selected: boolean;
  onSelect: (commit: GitLogCommitItem) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      data-testid={`commit-row-${commit.short}`}
      className={cn(
        "relative z-[1] flex h-9 cursor-pointer select-text items-center border-b border-border text-sm transition-colors",
        selected ? "bg-brand-50" : "hover:bg-brand-50",
      )}
      onClick={() => onSelect(commit)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(commit);
        }
      }}
    >
      {/* 泳道图占位列（SVG 覆盖层 pointer-events-none，见 CommitGraph） */}
      <div className="flex-none" style={{ width: GRAPH_WIDTH }} />
      <div className="min-w-0 flex-1 pr-3">
        <span className="block truncate text-foreground" title={commit.message}>
          {commit.message}
        </span>
      </div>
      <div
        className="w-[150px] flex-none truncate text-muted-foreground"
        title={commit.author_name}
      >
        {commit.author_name}
      </div>
      <div className="w-[86px] flex-none font-mono text-xs text-info">
        {commit.short}
      </div>
      <div className="flex w-[210px] flex-none items-center gap-1 overflow-hidden">
        <RefBadges refs={commit.refs} />
      </div>
      <div className="w-[160px] flex-none pr-4 text-right text-xs text-muted-foreground">
        {formatTime(commit.author_date)}
      </div>
    </div>
  );
}

/** 列表头（固定列宽与行对齐）。 */
function CommitListHeader() {
  return (
    <div className="flex h-9 items-center border-b border-border bg-muted/50 text-xs font-medium text-muted-foreground">
      <div
        className="flex-none text-center"
        style={{ width: GRAPH_WIDTH }}
      >
        图形
      </div>
      <div className="min-w-0 flex-1 pr-3">提交信息</div>
      <div className="w-[150px] flex-none">作者</div>
      <div className="w-[86px] flex-none">哈希</div>
      <div className="w-[210px] flex-none">分支 / 标签</div>
      <div className="w-[160px] flex-none pr-4 text-right">提交时间</div>
    </div>
  );
}

export interface CommitListProps {
  /** 已加载的提交窗口（新→旧序；空列表由 page 渲染空态，不进本组件）。 */
  commits: GitLogCommitItem[];
  selectedSha: string | null;
  onSelectCommit: (commit: GitLogCommitItem) => void;
}

/** 虚拟滚动提交列表 + 左列泳道图。 */
export function CommitList({
  commits,
  selectedSha,
  onSelectCommit,
}: CommitListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: commits.length,
    getScrollElement: () => scrollRef.current,
    // 固定行高 36px（与泳道 laneY 的行距一致，无需动态测量）
    estimateSize: () => COMMIT_ROW_HEIGHT,
    overscan: 10,
  });

  const virtualItems = virtualizer.getVirtualItems();
  // 可视区（±overscan）的全局绝对序集合：泳道图据此只绘可视行（R-05 视口重绘）
  const visibleSeqs = useMemo(
    () => new Set(virtualItems.map((v) => commits[v.index]?.seq ?? v.index)),
    [virtualItems, commits],
  );
  const totalSize = virtualizer.getTotalSize();

  return (
    <div data-testid="git-log-commit-list">
      <CommitListHeader />
      <div
        ref={scrollRef}
        className="relative max-h-[560px] overflow-y-auto"
        data-testid="git-log-scroll"
      >
        <CommitGraph
          commits={commits}
          visibleSeqs={visibleSeqs}
          height={totalSize}
        />
        <div className="relative" style={{ height: totalSize }}>
          {virtualItems.map((v) => {
            const commit = commits[v.index];
            if (!commit) return null;
            return (
              <div
                key={commit.hash}
                className="absolute left-0 top-0 w-full"
                style={{
                  height: v.size,
                  transform: `translateY(${v.start}px)`,
                }}
              >
                <CommitRow
                  commit={commit}
                  selected={selectedSha === commit.hash}
                  onSelect={onSelectCommit}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

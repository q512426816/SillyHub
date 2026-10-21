"use client";

/**
 * 轮级「文件变更卡」（File changes card）—— 纯展示组件（形态原型，桩数据）。
 *
 * 形态对标 deepseek-harness 会话页的 「已编辑 8 个文件 +230 −8」 折叠卡：
 *   折叠 = 一行（28px）——文件图标 + 「已编辑 N 个文件」 + 右对齐 +adds/−dels + 箭头；
 *   展开 = 文件行表（每行 24px）——路径（截断/可点/键盘可达）+ 命令行徽标 +
 *   +X −Y（等宽 tabular-nums）+ 「改N次」。
 *
 * 依据：
 * - `.sillyspec/changes/2026-10-20-session-page-dsh-alignment/design.md`
 *   线 C（文件变更卡 1b）/ D-023：逐文件 +/− 以 git 快照为准，`edit_patch` 只做归因，
 *   命令行/脚本改动由快照补全；`truncated`（超时）时只报文件数、行级统计不可信；
 *   共享工作区恒提示「可能含并行会话改动」。
 * - 字阶/墨色与既有密集会话 UI 对齐：过程行 11.5px + muted-foreground/80
 *   （turn-segment-views.tsx:687/808）、表格数字 `font-mono tabular-nums`
 *   （trajectory-view.tsx:341）。
 *
 * task-11（2026-10-20-session-page-dsh-alignment 线 C「1b 第三段」）：补真实数据面的
 * 三种形态（数据由 `turn-file-changes.ts` 的纯映射 `toFileChangesCardProps` 产出）：
 *   ① `binary` 行——numstat 对二进制是 0/0，行级 +/− 显示破折号，不显示「+0 −0」；
 *   ② `truncated`（快照 partial）——既有「（部分）」+ 行级破折号不变；
 *   ③ **降级形态** `degraded`（`capability="tool_only"` / 无快照 / 采集失败）——
 *      折叠头「仅工具编辑」+ 一行说明；**不渲染任何文件行**（禁伪造 files），
 *      也**绝不**出现「本轮无改动」（design E6/E8：没有快照 ≠ 没有改动）。
 *
 * 约束：
 * - **props only**：无 fetch / store / context / 副作用，totals 由 `files` 现算；
 * - **只用语义 token**（bg-card / border-border / text-foreground / text-muted-foreground /
 *   text-success / text-error / bg-muted），三主题随 html[data-theme] 自动换肤，
 *   本文件零 hex/rgb/hsl 字面量；
 * - `files.length === 0` 且非降级态不渲染（不占位、不出空卡，对应 design E6
 *   `null → 省略卡片`）；
 * - 展开列表限高内滚（max 10 行 ≈ 240px），100 文件不把正文顶走。
 */

import { useId, useState } from "react";
import type { KeyboardEvent } from "react";
import { ChevronRight, FileDiff } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * 快照能力档（design「文件变更卡 DTO」）：`full` = daemon 上报了工作区快照；
 * `tool_only` = 老 daemon 无快照能力 → 卡片降级为「仅工具编辑」。
 * 前端只看这个字段、不看快照字段是否存在（E6/E8）。
 */
export type FileChangesCapability = "full" | "tool_only";

export interface ChangedFile {
  path: string;
  adds: number;
  dels: number;
  edits: number;
  /** tool = Edit/Write 补丁归因；shell = 命令行/脚本改动（来自 git 快照）。 */
  source: "tool" | "shell";
  /**
   * 二进制文件（`git diff --numstat` 报 0/0 且 `binary:true`）——行级 +/− 显示破折号。
   * 缺省/false = 文本文件，按 adds/dels 正常展示。
   */
  binary?: boolean;
  /**
   * `source="tool"` 时本轮命中该文件的编辑工具名（Edit / Write …），仅作行内提示，
   * 不参与计数（计数走 `edits`）。command 归因的行不带。
   */
  editToolNames?: string[];
}

export interface FileChangesCardProps {
  files: ChangedFile[];
  /** 轮次号，如 16 → 头部显示「第 16 轮」 */
  turnNo?: number;
  /** 初始展开（非受控；后续由卡内 state 管） */
  startExpanded?: boolean;
  /** 共享工作区 → 头部下方恒显「可能含并行会话改动」 */
  sharedWorkspace?: boolean;
  /** 快照超时/截断 → 头部「（部分）」，行级 +/− 显示为 — */
  truncated?: boolean;
  /**
   * 该轮快照能力档（`full` = 有工作区快照；`tool_only` = 老 daemon 无快照能力）。
   * 仅作 `data-*` 标注与降级形态的语义来源，判定在 `toFileChangesCardProps` 完成。
   */
  capability?: FileChangesCapability;
  /**
   * 降级形态（`capability="tool_only"` / 无快照 / 采集失败）：折叠头「仅工具编辑」+
   * 一行说明，无文件行。**不显示任何「无改动」字样**（E6/E8：没快照 ≠ 没改动）。
   */
  degraded?: boolean;
  onOpenFile?: (path: string) => void;
  className?: string;
}

/**
 * 拖选文本松开鼠标会补发 click（ql-20260825-011 同款守卫）：行内路径是可选中文本，
 * 选中复制时不应把行当成点击、误触发 onOpenFile。
 */
function hasActiveTextSelection(): boolean {
  if (typeof window === "undefined") return false;
  const selection = window.getSelection();
  return selection != null && !selection.isCollapsed && selection.toString().length > 0;
}

function isActivationKey(event: KeyboardEvent<HTMLElement>): boolean {
  return event.key === "Enter" || event.key === " " || event.key === "Spacebar";
}

export function FileChangesCard({
  files,
  turnNo,
  startExpanded = false,
  sharedWorkspace = false,
  truncated = false,
  capability,
  degraded = false,
  onOpenFile,
  className,
}: FileChangesCardProps) {
  const [expanded, setExpanded] = useState(startExpanded);
  // aria-controls 需要稳定 id：useId 会带冒号（合法但选择器里要转义），先剥掉。
  const listId = `file-changes-${useId().replace(/:/g, "")}`;

  const totalAdds = files.reduce((sum, file) => sum + file.adds, 0);
  const totalDels = files.reduce((sum, file) => sum + file.dels, 0);

  // 空态零渲染（design E6：无快照字段 → 省略卡片，不出「0 个文件」空壳）。
  // 降级态是**有话说**的形态（显式提示缺快照能力），文件行恒空但卡照出。
  if (files.length === 0 && !degraded) return null;

  const openFile = (path: string) => {
    if (hasActiveTextSelection()) return;
    onOpenFile?.(path);
  };

  // 行级统计不可信：快照超时/截断（partial）或二进制文件（numstat 0/0）。
  const noLineStats = truncated || degraded;

  return (
    <div
      data-testid="file-changes-card"
      data-expanded={expanded ? "true" : "false"}
      data-truncated={truncated ? "true" : "false"}
      data-degraded={degraded ? "true" : "false"}
      data-capability={capability ?? (degraded ? "tool_only" : "full")}
      className={cn(
        "overflow-hidden rounded-md border border-border bg-card text-[12px]",
        className,
      )}
    >
      {/* 头部（折叠态即整卡）：28px 单行。有文件行时整行可点开合（aria-expanded 供
          读屏）；降级态无行可开，头部退化为非交互行（不撒谎给读屏一个可展开控件）。 */}
      {(() => {
        const headerContent = (
          <>
            <FileDiff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex min-w-0 items-center gap-1">
              <span className="shrink-0 font-medium text-foreground">
                {degraded ? "仅工具编辑" : `已编辑 ${files.length} 个文件`}
              </span>
              {truncated && (
                <span className="shrink-0 text-[11px] text-muted-foreground">（部分）</span>
              )}
            </span>
            {turnNo != null && (
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/80">
                第 {turnNo} 轮
              </span>
            )}
            <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[11.5px] tabular-nums">
              {noLineStats ? (
                // 没有可信行级统计：不拿 0 或半截 numstat 冒充总数（design E3 partial）。
                <span
                  className="text-muted-foreground"
                  title={
                    degraded
                      ? "daemon 未上报工作区快照：无行级统计"
                      : "快照超时：只有文件数可靠"
                  }
                >
                  —
                </span>
              ) : (
                <>
                  <span className="text-success">+{totalAdds}</span>
                  <span className="text-error">−{totalDels}</span>
                </>
              )}
            </span>
            {files.length > 0 && (
              <ChevronRight
                aria-hidden
                className={cn(
                  "h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-150",
                  expanded && "rotate-90",
                )}
              />
            )}
          </>
        );
        return files.length > 0 ? (
          <button
            type="button"
            data-testid="file-changes-header"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => {
              if (hasActiveTextSelection()) return; // 选中「已编辑 8 个文件」复制时不折叠
              setExpanded((value) => !value);
            }}
            className={cn(
              "flex h-7 w-full items-center gap-1.5 px-2 text-left transition-colors",
              "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            )}
          >
            {headerContent}
          </button>
        ) : (
          <div
            data-testid="file-changes-header"
            aria-label="仅工具编辑（daemon 未上报工作区快照）"
            className="flex h-7 w-full items-center gap-1.5 px-2 text-left"
          >
            {headerContent}
          </div>
        );
      })()}

      {/* 降级说明行（恒显，折叠态也显）：说清「卡里没有工作区改动」的原因是缺能力，
          而不是本轮没改动——design E6/E8 的硬约束。 */}
      {degraded && (
        <p className="px-2 pb-1 text-[11px] leading-[1.4] text-muted-foreground/80">
          daemon 未上报工作区快照，本卡只含 Edit/Write 工具编辑
        </p>
      )}

      {/* 共享工作区提示：恒显（折叠态也显），否则「可能含并行会话改动」只在展开时可见，
          正好在最容易误读总数的场景失效。 */}
      {sharedWorkspace && (
        <p className="px-2 pb-1 text-[11px] leading-[1.4] text-muted-foreground/80">
          共享工作区，可能含并行会话改动
        </p>
      )}

      {expanded && (
        <div
          id={listId}
          data-testid="file-changes-list"
          className="max-h-[240px] overflow-y-auto border-t border-border/60 py-0.5"
        >
          {files.map((file, index) => (
            <div
              key={`${file.path}#${index}`}
              role="button"
              tabIndex={0}
              data-testid="file-changes-row"
              data-path={file.path}
              data-source={file.source}
              aria-label={`打开 ${file.path}`}
              title={file.path}
              onClick={() => openFile(file.path)}
              onKeyDown={(event) => {
                if (!isActivationKey(event)) return;
                event.preventDefault();
                openFile(file.path);
              }}
              className={cn(
                "group flex h-6 cursor-pointer items-center gap-2 px-2",
                "hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              )}
            >
              {/* 路径不吃 flex-1：短路径时归因徽标紧跟文件名，而不是被甩到数字列旁边。 */}
              <span className="min-w-0 shrink truncate font-mono text-[11.5px] text-muted-foreground group-hover:text-foreground group-hover:underline">
                {file.path}
              </span>
              {file.source === "shell" && (
                <span
                  className="shrink-0 rounded border border-border bg-muted/60 px-1 py-px text-[10px] leading-none text-muted-foreground"
                  title="命令行/脚本改动（git 快照归因）"
                >
                  命令行
                </span>
              )}
              <span className="ml-auto flex shrink-0 items-center gap-2">
                <span className="w-[68px] shrink-0 text-right font-mono text-[11.5px] tabular-nums">
                  {truncated || file.binary ? (
                    // 快照超时/截断，或二进制文件（numstat 恒 0/0）——「+0 −0」是假精确。
                    <span
                      className="text-muted-foreground"
                      title={
                        file.binary
                          ? "二进制文件：无行级行数统计"
                          : "快照超时：无行级统计"
                      }
                    >
                      —
                    </span>
                  ) : (
                    <>
                      <span className={file.adds > 0 ? "text-success" : "text-muted-foreground/50"}>
                        +{file.adds}
                      </span>{" "}
                      <span className={file.dels > 0 ? "text-error" : "text-muted-foreground/50"}>
                        −{file.dels}
                      </span>
                    </>
                  )}
                </span>
                {/* edits<=0（命令行归因的行没有「编辑次数」概念）不出「改0次」——
                    0 会被读成「没改过」，而行本身就在改动清单里。 */}
                {file.edits > 0 && (
                  <span
                    data-testid="file-changes-edits"
                    className="w-12 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground"
                    title={
                      file.editToolNames != null && file.editToolNames.length > 0
                        ? `编辑工具：${file.editToolNames.join("、")}`
                        : undefined
                    }
                  >
                    改{file.edits}次
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

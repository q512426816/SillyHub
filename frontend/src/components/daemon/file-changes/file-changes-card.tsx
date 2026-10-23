"use client";

/**
 * 轮级「文件变更卡」（File changes card）—— 纯展示组件（形态原型，桩数据）。
 *
 * 形态对标 deepseek-harness 会话页的 「N 个文件变更 +adds −dels」 折叠卡：
 *   折叠 = 一行（28px）——文件图标 + 「N 个文件变更」 + 右对齐 +adds/−dels + 箭头；
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

/** 文件状态（2026-10-22-file-changes-card-fix）：A/M/D/? 徽标来源。 */
export type FileChangeStatus = "added" | "modified" | "deleted" | "untracked";

export interface ChangedFile {
  path: string;
  adds: number;
  dels: number;
  edits: number;
  /** tool = Edit/Write 补丁归因；shell = 命令行/脚本改动（来自 git 快照）。 */
  source: "tool" | "shell";
  /** 文件状态；旧调用方缺省时不渲染徽标（零回归）。 */
  status?: FileChangeStatus;
  /** 行级 +/− 是否可信（untracked / mtime 探测 / 二进制为 false）；缺省 true。 */
  hasLineStats?: boolean;
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
   *
   * 注意（2026-10-22-file-card-hide-empty）：产品页**已无生产者**——无数据的轮按
   * 用户裁决直接不出卡。本形态保留给检查器 / proto 等仍要「显式降级」的消费方。
   */
  degraded?: boolean;
  /**
   * 「有话说但无文件行」的提示形态（D-034）：partial 且 daemon 没拿到文件列表
   * （采集超时 / 单工作区队列溢出）时，卡片照出但只有一行提示——
   * 否则用户无法区分「采集没完成」与「本轮真的没改文件」（E6/E8 立意）。
   */
  notice?: string;
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

/** 文件状态徽标（2026-10-22-file-changes-card-fix）：文案 + 语义 token 配色。
 *  2026-10-23-turn-file-diff-dialog：导出供 TurnFileDiffDialog 头部复用同一徽标面。 */
export const FILE_STATUS_META: Record<
  FileChangeStatus,
  { label: string; className: string }
> = {
  added: {
    label: "新增",
    className: "border-success/30 bg-success/10 text-success",
  },
  modified: {
    label: "修改",
    className: "border-border bg-muted/50 text-muted-foreground",
  },
  deleted: {
    label: "删除",
    className: "border-error/30 bg-error/10 text-error",
  },
  untracked: {
    label: "新文件",
    className: "border-primary/30 bg-primary/10 text-primary",
  },
};

export function FileChangesCard({
  files,
  turnNo,
  startExpanded = false,
  sharedWorkspace = false,
  truncated = false,
  capability,
  degraded = false,
  notice,
  onOpenFile,
  className,
}: FileChangesCardProps) {
  const [expanded, setExpanded] = useState(startExpanded);
  // 2026-10-23-file-card-agent-grouping：「命令行/其他」区段展开态（每卡独立）。
  const [otherOpen, setOtherOpen] = useState(false);
  // aria-controls 需要稳定 id：useId 会带冒号（合法但选择器里要转义），先剥掉。
  const listId = `file-changes-${useId().replace(/:/g, "")}`;

  // 分组（FR-01/FR-02）：tool = 本轮 agent 编辑工具命中（默认主列表）；
  // shell = git 快照归因的其他改动（命令行/并行会话/其他进程，收进按钮区段）。
  const agentFiles = files.filter((file) => file.source === "tool");
  const otherFiles = files.filter((file) => file.source !== "tool");
  const sum = (rows: ChangedFile[]) => ({
    adds: rows.reduce((acc, file) => acc + file.adds, 0),
    dels: rows.reduce((acc, file) => acc + file.dels, 0),
  });
  const agentTotals = sum(agentFiles);
  const allTotals = sum(files);

  // 空态零渲染（design E6：无快照字段 → 省略卡片，不出「0 个文件」空壳）。
  // 降级态是**有话说**的形态（显式提示缺快照能力），文件行恒空但卡照出。
  // notice（D-034）同理：partial 但没拿到文件列表 → 一行提示卡，不静默。
  const isNotice = notice != null && files.length === 0 && !degraded;
  if (files.length === 0 && !degraded && !isNotice) return null;

  // 无文件行但有话说（partial 超时/队列溢出）：28px 单行提示，与折叠头同高
  // （绝不写成「无改动」——那是 E6/E8 明令禁止的伪值）。共享工作区提示在
  // notice 态同样要显示（2026-10-22-file-changes-card-fix）。
  if (isNotice) {
    return (
      <div
        data-testid="file-changes-notice"
        data-truncated="true"
        className={cn(
          "overflow-hidden rounded-md border border-border bg-card text-[12px]",
          className,
        )}
      >
        <div className="flex h-7 items-center gap-1.5 px-2 text-muted-foreground">
          <FileDiff className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">{notice}</span>
          {turnNo != null && (
            <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/80">
              第 {turnNo} 轮
            </span>
          )}
        </div>
        {sharedWorkspace && (
          <p className="px-2 pb-1 text-[11px] leading-[1.4] text-muted-foreground/80">
            共享工作区，可能含并行会话改动
          </p>
        )}
      </div>
    );
  }

  const openFile = (path: string) => {
    if (hasActiveTextSelection()) return;
    onOpenFile?.(path);
  };

  // 行级统计不可信：快照超时/截断（partial）或二进制文件（numstat 0/0）。
  const noLineStats = truncated || degraded;

  /** 段内行级 +/−（truncated/degraded 段级破折号；数字为零时弱化灰色避免假强调）。 */
  const renderDelta = (adds: number, dels: number) =>
    noLineStats ? (
      <span
        className="text-muted-foreground"
        title={degraded ? "daemon 未上报工作区快照：无行级统计" : "快照超时：只有文件数可靠"}
      >
        —
      </span>
    ) : (
      <>
        <span className={adds > 0 ? "text-success" : "text-muted-foreground/50"}>+{adds}</span>
        <span className={dels > 0 ? "text-error" : "text-muted-foreground/50"}>−{dels}</span>
      </>
    );

  /** 文件行渲染（agent 主列表与「命令行/其他」区段共用同一行形态）。 */
  const renderFileRow = (file: ChangedFile, index: number) => {
    const clickable = true;
    const rowNoStats =
      truncated || file.binary === true || file.hasLineStats === false;
    const noStatsTitle =
      file.binary === true
        ? "二进制文件：无行级行数统计"
        : file.status === "untracked"
          ? "新文件：无行级统计"
          : file.hasLineStats === false
            ? "mtime 探测：无行级统计"
            : "快照超时：无行级统计";
    const statusMeta = file.status ? FILE_STATUS_META[file.status] : null;
    return (
      <div
        key={`${file.path}#${index}`}
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
        data-testid="file-changes-row"
        data-path={file.path}
        data-source={file.source}
        data-status={file.status}
        data-clickable={clickable ? "true" : "false"}
        aria-label={clickable ? `打开 ${file.path}` : undefined}
        title={file.path}
        onClick={clickable ? () => openFile(file.path) : undefined}
        onKeyDown={
          clickable
            ? (event) => {
                if (!isActivationKey(event)) return;
                event.preventDefault();
                openFile(file.path);
              }
            : undefined
        }
        className={cn(
          "group flex h-6 items-center gap-2 px-2",
          clickable &&
            "cursor-pointer hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
      >
        {/* 路径不吃 flex-1：短路径时状态/归因徽标紧跟文件名，而不是被甩到数字列旁边。 */}
        <span
          className={cn(
            "min-w-0 shrink truncate font-mono text-[11.5px] text-muted-foreground",
            clickable && "group-hover:text-foreground group-hover:underline",
            file.status === "deleted" && "line-through",
          )}
        >
          {file.path}
        </span>
        {statusMeta && (
          <span
            data-testid="file-changes-status"
            className={cn(
              "shrink-0 rounded border px-1 py-px text-[10px] leading-none",
              statusMeta.className,
            )}
          >
            {statusMeta.label}
          </span>
        )}
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
            {rowNoStats ? (
              // 快照超时/截断、二进制、未跟踪新文件、mtime 探测行——「+0 −0」是假精确。
              <span className="text-muted-foreground" title={noStatsTitle}>
                —
              </span>
            ) : (
              <>
                <span
                  className={
                    file.adds > 0 ? "text-success" : "text-muted-foreground/50"
                  }
                >
                  +{file.adds}
                </span>{" "}
                <span
                  className={
                    file.dels > 0 ? "text-error" : "text-muted-foreground/50"
                  }
                >
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
                  ? `编辑工具：${Array.from(new Set(file.editToolNames)).join("、")}`
                  : undefined
              }
            >
              改{file.edits}次
            </span>
          )}
        </span>
      </div>
    );
  };

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
      {/* 头部（折叠态即整卡）：28px 单行双段标题（2026-10-23-file-card-agent-grouping）——
          「本轮AGENT N 个文件变更 +a −d | 总共 M 个文件变更 +A −D」。有文件行时整行可点
          开合（aria-expanded 供读屏）；降级态无行可开，头部退化为非交互行（不撒谎给读屏
          一个可展开控件）。 */}
      {(() => {
        const headerContent = (
          <>
            <FileDiff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex min-w-0 items-center gap-1">
              <span className="shrink-0 font-medium text-foreground">
                {degraded
                  ? "仅工具编辑"
                  : agentFiles.length > 0
                    ? `本轮AGENT ${agentFiles.length} 个文件变更`
                    : "本轮AGENT 无直接文件编辑"}
              </span>
              {!degraded && agentFiles.length > 0 && (
                <span className="shrink-0 font-mono text-[11.5px] tabular-nums">
                  {renderDelta(agentTotals.adds, agentTotals.dels)}
                </span>
              )}
            </span>
            {!degraded && (
              <>
                <span className="shrink-0 text-muted-foreground/40">|</span>
                <span className="flex min-w-0 items-center gap-1">
                  <span className="shrink-0 font-medium text-foreground">
                    总共 {files.length} 个文件变更
                  </span>
                  <span className="shrink-0 font-mono text-[11.5px] tabular-nums">
                    {renderDelta(allTotals.adds, allTotals.dels)}
                  </span>
                </span>
              </>
            )}
            {truncated && (
              <span className="shrink-0 text-[11px] text-muted-foreground">（部分）</span>
            )}
            {turnNo != null && (
              <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/80">
                第 {turnNo} 轮
              </span>
            )}
            {files.length > 0 && (
              <ChevronRight
                aria-hidden
                className={cn(
                  "h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-150",
                  turnNo == null && "ml-auto",
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
              if (hasActiveTextSelection()) return; // 选中头部文案复制时不折叠
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
          {/* 2026-10-23-file-card-agent-grouping：主列表默认只列本轮 agent 编辑行；
              命令行/并行会话等其他改动收进按钮区段（点击展开），不再与 agent 编辑
              混列（.sillyspec 等 CLI 生成文件会淹没真正的编辑）。agent 为零时按钮
              置顶，其他改动入口不被吞。 */}
          {otherFiles.length > 0 && (
            <button
              type="button"
              data-testid="file-changes-other-toggle"
              aria-expanded={otherOpen}
              aria-controls={`${listId}-other`}
              onClick={() => {
                if (hasActiveTextSelection()) return;
                setOtherOpen((value) => !value);
              }}
              className={cn(
                "flex h-6 w-full items-center gap-1.5 px-2 text-left text-[11px] transition-colors",
                "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              )}
            >
              <ChevronRight
                aria-hidden
                className={cn(
                  "h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-150",
                  otherOpen && "rotate-90",
                )}
              />
              <span className="shrink-0 font-medium text-muted-foreground">
                命令行/其他 {otherFiles.length} 个文件
              </span>
              <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums">
                {renderDelta(
                  otherFiles.reduce((acc, file) => acc + file.adds, 0),
                  otherFiles.reduce((acc, file) => acc + file.dels, 0),
                )}
              </span>
            </button>
          )}
          {agentFiles.map((file, index) => renderFileRow(file, index))}
          {otherFiles.length > 0 && otherOpen && (
            <div id={`${listId}-other`} data-testid="file-changes-other-list" className="border-t border-border/40">
              {otherFiles.map((file, index) => renderFileRow(file, index))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

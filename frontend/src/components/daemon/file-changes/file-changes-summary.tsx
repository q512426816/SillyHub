"use client";

/**
 * 会话级「文件改动汇总卡」（task-11 / 2026-10-20-session-page-dsh-alignment 线 C
 * 「1b 第三段」）。
 *
 * 依据：`design.md`「### 文件变更卡 DTO」+ 生命周期契约表 **E7 会话级汇总**——
 * 「去重后的 `files` 与 Σ`added`/Σ`deleted`、`status` 最差值」；R-08 要求「共享
 * 工作区恒标『可能含并行会话改动』」（并行会话的改动无法按会话拆分，D-023 已接受）。
 *
 * 形态：一行折叠头（文件图标 + 「会话文件改动」+ 共 N 个文件 + Σ+/− + 状态注记），
 * 下方恒显两行以内的说明（并行会话横幅 + 不完整时的不完整原因）。**不重复轮级卡
 * 的逐文件列表**——逐文件明细属于轮级卡，汇总只回答「整个会话一共改了多少」。
 *
 * 约束（与轮级卡同源）：
 * - **props only**：零 fetch / 零 store / 零 context，聚合纯函数现算；
 * - 只用语义 token，零字面色值；文案中文；
 * - `status` 取最差值（`unavailable > failed > partial > ok`）；任一参与轮缺快照
 *   （`capability="tool_only"` / 无快照）时汇总**至少降为 partial** 并显式标注
 *   「N 轮无工作区快照」——「统计不完整」绝不能被读成「没有改动」（E6/E8）；
 * - 无数据（无文件且无降级轮）不渲染，不出空壳。
 */

import { useMemo } from "react";
import { Files } from "lucide-react";

import { cn } from "@/lib/utils";
import type { FileChangesCapability } from "./file-changes-card";
import type { TurnFileChange, TurnFileChangesSnapshot } from "./turn-file-changes";

/** 汇总状态口径：与单轮快照 status 同一词表。 */
export type FileChangesSummaryStatus = "ok" | "partial" | "failed" | "unavailable";

/** 参与汇总的一轮：快照（可空）+ 能力档（可空）。 */
export interface FileChangesSummaryEntry {
  snapshot: TurnFileChangesSnapshot | null;
  capability?: FileChangesCapability | null;
}

/** 去重后的单文件行（同 path 多轮取并集，+/− 各自求和）。 */
export interface AggregatedFileChange {
  path: string;
  adds: number;
  dels: number;
  edits: number;
  /** 任一轮归因为命令行/脚本改动 → shell（更保守：不把 git 侧改动说成工具编辑）。 */
  source: "tool" | "shell";
  /** 任一轮报二进制 → 行级统计不可信。 */
  binary: boolean;
}

/** 状态严重度（数值越大越差）：`unavailable > failed > partial > ok`。 */
export const FILE_CHANGES_STATUS_RANK: Record<FileChangesSummaryStatus, number> = {
  ok: 0,
  partial: 1,
  failed: 2,
  unavailable: 3,
};

/** 取最差状态（空集合 → null）。 */
export function worstFileChangesStatus(
  statuses: ReadonlyArray<FileChangesSummaryStatus>,
): FileChangesSummaryStatus | null {
  let worst: FileChangesSummaryStatus | null = null;
  for (const status of statuses) {
    if (worst === null || FILE_CHANGES_STATUS_RANK[status] > FILE_CHANGES_STATUS_RANK[worst]) {
      worst = status;
    }
  }
  return worst;
}

export interface AggregatedFileChanges {
  files: AggregatedFileChange[];
  totalFiles: number;
  totalAdds: number;
  totalDels: number;
  /** 汇总状态（无任何可信快照 → null）。 */
  status: FileChangesSummaryStatus | null;
  /** 无工作区快照的轮数（capability=tool_only / 快照缺失）——汇总不完整的量。 */
  degradedTurns: number;
  /** 参与汇总的轮数（有快照的轮 + 降级轮）。 */
  consideredTurns: number;
  /** 任一轮快照被截断/超时（行级统计为下限）。 */
  truncated: boolean;
}

/**
 * 多轮快照聚合（纯函数）：按 `path` 去重、+/− 求和、状态取最差值。
 *
 * 降级轮（`snapshot == null` 或 `capability="tool_only"`）不伪造文件行，只计入
 * `degradedTurns` 并把汇总状态压到至少 `partial`——覆盖不完整必须显式可见。
 */
export function aggregateTurnFileChanges(
  entries: ReadonlyArray<FileChangesSummaryEntry>,
): AggregatedFileChanges {
  const byPath = new Map<string, AggregatedFileChange>();
  const statuses: FileChangesSummaryStatus[] = [];
  let degradedTurns = 0;
  let truncated = false;
  let consideredTurns = 0;

  for (const entry of entries) {
    const snapshot = entry.snapshot ?? null;
    const capability = entry.capability ?? null;
    // 完全未接线（两字段都缺）的轮不参与汇总——既不贡献数据也不算降级。
    if (snapshot == null && capability == null) continue;
    consideredTurns += 1;
    if (snapshot == null || capability === "tool_only") {
      degradedTurns += 1;
      continue;
    }
    statuses.push(snapshot.status);
    if (snapshot.status === "partial" || snapshot.truncated === true) truncated = true;
    if (snapshot.status !== "ok" && snapshot.status !== "partial") continue;
    for (const file of snapshot.files ?? []) {
      mergeFile(byPath, file);
    }
  }

  if (degradedTurns > 0) statuses.push("partial");
  const status = worstFileChangesStatus(statuses);

  const files = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  return {
    files,
    totalFiles: files.length,
    totalAdds: files.reduce((sum, file) => sum + file.adds, 0),
    totalDels: files.reduce((sum, file) => sum + file.dels, 0),
    status,
    degradedTurns,
    consideredTurns,
    truncated,
  };
}

/** 单文件并入（同 path 取并集：+/− 与编辑次数求和，来源/二进制按「更保守」升级）。 */
function mergeFile(
  byPath: Map<string, AggregatedFileChange>,
  file: TurnFileChange,
): void {
  const toolEdited = file.attribution === "edit_patch";
  const edits = toolEdited ? (file.editToolNames?.length ?? 1) : 0;
  const previous = byPath.get(file.path);
  if (previous == null) {
    byPath.set(file.path, {
      path: file.path,
      adds: file.added,
      dels: file.deleted,
      edits,
      source: toolEdited ? "tool" : "shell",
      binary: file.binary === true,
    });
    return;
  }
  previous.adds += file.added;
  previous.dels += file.deleted;
  previous.edits += edits;
  if (!toolEdited) previous.source = "shell";
  if (file.binary === true) previous.binary = true;
}

/** 汇总状态 → 一句人话（ok 不注记——注记只讲「为什么不可全信」）。 */
export function fileChangesSummaryNote(
  status: FileChangesSummaryStatus | null,
): string | null {
  switch (status) {
    case "partial":
      return "部分轮次快照不完整（超时/截断），行级统计为下限";
    case "failed":
      return "部分轮次快照采集失败，汇总不完整";
    case "unavailable":
      return "部分轮次无法采集工作区快照（git 不可用/非 git 仓）";
    default:
      return null;
  }
}

export interface FileChangesSummaryProps {
  /** 各轮快照（顺序无关；未接线的轮可原样带入，聚合时跳过）。 */
  turns: ReadonlyArray<FileChangesSummaryEntry>;
  className?: string;
}

export function FileChangesSummary({ turns, className }: FileChangesSummaryProps) {
  const agg = useMemo(() => aggregateTurnFileChanges(turns), [turns]);

  // 无数据不渲染：没有文件、也没有「某轮缺快照」要说的事。
  if (agg.totalFiles === 0 && agg.degradedTurns === 0) return null;

  const note = fileChangesSummaryNote(agg.status);
  const statusLabel =
    agg.status === "unavailable"
      ? "快照不可用"
      : agg.status === "failed"
        ? "采集失败"
        : agg.status === "partial"
          ? "统计不完整"
          : "完整";

  return (
    <div
      data-testid="file-changes-summary"
      data-status={agg.status ?? "unknown"}
      data-total-files={agg.totalFiles}
      data-degraded-turns={agg.degradedTurns}
      className={cn(
        "rounded-md border border-border bg-card px-2 py-1.5 text-[12px]",
        className,
      )}
    >
      <div className="flex h-6 items-center gap-1.5">
        <Files className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="shrink-0 font-medium text-foreground">会话文件改动</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          共 {agg.totalFiles} 个文件
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[11.5px] tabular-nums">
          {agg.status === "ok" || agg.status === "partial" ? (
            <>
              <span className="text-success">+{agg.totalAdds}</span>
              <span className="text-error">−{agg.totalDels}</span>
            </>
          ) : (
            // 快照整体不可信（failed/unavailable）：不拿残缺累加冒充总数。
            <span className="text-muted-foreground" title="快照不可用：无汇总统计">
              —
            </span>
          )}
          <span
            data-testid="file-changes-summary-status"
            className="text-[10.5px] font-normal text-muted-foreground"
            title="汇总状态：ok < partial < failed < unavailable 取最差值"
          >
            {statusLabel}
          </span>
        </span>
      </div>

      {/* R-08：并行会话归属不可分（D-023 已接受）——横幅恒显，不做按轮开关。 */}
      <p
        data-testid="file-changes-summary-banner"
        className="text-[11px] leading-[1.4] text-muted-foreground/80"
      >
        共享工作区，可能含并行会话改动
      </p>

      {agg.degradedTurns > 0 && (
        <p
          data-testid="file-changes-summary-degraded"
          className="text-[11px] leading-[1.4] text-muted-foreground/80"
        >
          其中 {agg.degradedTurns} 轮无工作区快照（仅工具编辑），汇总不完整
        </p>
      )}

      {note != null && agg.degradedTurns === 0 && (
        <p className="text-[11px] leading-[1.4] text-muted-foreground/80">{note}</p>
      )}
    </div>
  );
}

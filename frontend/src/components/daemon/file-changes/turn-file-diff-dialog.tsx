"use client";

/**
 * TurnFileDiffDialog —— 轮文件变更卡「点击文件行 → 查看该文件本轮变更内容」的
 * 弹窗（2026-10-23-turn-file-diff-dialog task-02）。
 *
 * 依据（用户原话「具体变更内容点击没显示，这个应该要能显示的，弹窗形式」）：
 * - 数据面：open 时经会话级单轮日志 API `getAgentSessionLogs(sessionId, { runId })`
 *   拉本轮 agent_run_logs，`collectTurnFilePatches`（./turn-file-diff）按配对键
 *   （metadata.agent_event.call_id 主来源）配对 edit_patch → 按次分段；渲染复用
 *   DiffView（agent-log/tool-diff，双侧行号 + 红删绿增 + 2000 行截断护栏），
 *   与 agent-log 工具卡同一 diff 原语。
 * - 形态：shadcn 受控 Dialog（对齐 session-change-files-hover「点项开大弹窗」先例）。
 * - 诚实性（FR-03 / E6/E8 立意同源）：无补丁（shell 归因 / 配不到 / JSON 不可解析）
 *   一律如实说明原因，**禁止渲染伪造 diff 或空壳成功态**；失败可重试。
 * - 弹窗自取数（唯一 fetch 面），纯映射与渲染分离：配对逻辑全部在
 *   turn-file-diff.ts（可独立单测），本组件只管拉取状态机与展示。
 */

import { useEffect, useState } from "react";

import { DiffView } from "@/components/agent-log/tool-diff";
import { CopyButton } from "@/components/daemon/copy-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getAgentSessionLogs } from "@/lib/daemon/sessions";
import { cn } from "@/lib/utils";

import { FILE_STATUS_META, type FileChangeStatus } from "./file-changes-card";
import {
  collectTurnFilePatches,
  diffRowsToText,
  type TurnFilePatchSection,
} from "./turn-file-diff";

export interface TurnFileDiffDialogProps {
  sessionId: string;
  /** 轮 run 标识（realRunId ?? runId，与 fork/highlight 同源口径），作 run_id 拉取参数。 */
  runKey: string;
  /** 仓根相对 posix 路径（文件卡行原样）。 */
  path: string;
  /** 文件状态徽标（新增/修改/删除/新文件，与文件卡同源 FILE_STATUS_META）；
   *  deleted 且无补丁时弹窗出删除专用说明（2026-10-23-file-card-agent-grouping）。 */
  status?: FileChangeStatus;
  open: boolean;
  onOpenChange: (_open: boolean) => void;
}

type LoadPhase =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; sections: TurnFilePatchSection[] };

/**
 * 无补丁说明（2026-10-23-file-card-agent-grouping / FR-04）：git 快照归因只证明
 * 「改动未来自本轮 agent 编辑工具」，不区分命令行/并行会话/其他进程——文案并列
 * 三种可能，不断言唯一原因（旧文案「该文件由命令行/脚本改动」是过度断言，
 * 与「新增」徽标组合会误导：CLI 创建的新文件也归 command）。
 */
const NO_PATCH_TEXT =
  "该文件的改动未来自本轮 agent 的编辑工具（Edit/Write），可能由命令行/脚本、并行会话或其他进程产生；平台未捕获补丁内容，仅行数统计可信。";

/** 删除文件且无补丁（grouping FR-03）：删除说明态，如实交代无 diff 可看。 */
const DELETED_NO_PATCH_TEXT =
  "该文件在本轮被删除；删除动作未来自编辑工具（如命令行 rm），平台未捕获删除补丁，无 diff 可展示。";
export function TurnFileDiffDialog({
  sessionId,
  runKey,
  path,
  status,
  open,
  onOpenChange,
}: TurnFileDiffDialogProps) {
  const [state, setState] = useState<LoadPhase>({ phase: "loading" });
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setState({ phase: "loading" });
    getAgentSessionLogs(sessionId, { runId: runKey, signal: controller.signal })
      .then((logs) => {
        if (controller.signal.aborted) return;
        setState({ phase: "ready", sections: collectTurnFilePatches(logs, path) });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          phase: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => controller.abort();
    // retryNonce 只由「重试」按钮递增，触发本 effect 重跑（竞态由 abort 守卫）。
  }, [open, sessionId, runKey, path, retryNonce]);

  const statusMeta = status != null ? FILE_STATUS_META[status] : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="turn-file-diff-dialog"
        className="flex max-h-[85vh] max-w-3xl flex-col overflow-hidden"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle
            data-testid="turn-file-diff-title"
            className="flex min-w-0 items-center gap-2 font-mono text-[13px]"
          >
            <span className="min-w-0 truncate" title={path}>
              {path}
            </span>
            {statusMeta && (
              <span
                className={cn(
                  "shrink-0 rounded border px-1 py-px font-sans text-[10px] leading-none",
                  statusMeta.className,
                )}
              >
                {statusMeta.label}
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            {/* 副标题条件渲染（grouping FR-04）：只有真展示 agent 编辑补丁时才提
                「来自 agent 编辑日志」，无补丁说明态不带该语义（防误导）。 */}
            {state.phase === "ready" && state.sections.length > 0
              ? "本轮文件变更内容（来自 agent 编辑日志）"
              : "本轮文件变更内容"}
          </DialogDescription>
        </DialogHeader>

        <div
          data-testid="turn-file-diff-body"
          className="min-h-0 flex-1 overflow-y-auto border-t border-border/60 pt-2"
        >
          {state.phase === "loading" && (
            <p className="py-8 text-center text-[12px] text-muted-foreground">
              正在加载本轮编辑补丁…
            </p>
          )}
          {state.phase === "error" && (
            <div className="flex flex-col items-center gap-2 py-8">
              <p className="text-[12px] text-error">加载失败：{state.message}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRetryNonce((n) => n + 1)}
              >
                重试
              </Button>
            </div>
          )}
          {state.phase === "ready" && state.sections.length === 0 && (
            <p className="py-8 text-center text-[12px] leading-[1.6] text-muted-foreground">
              {status === "deleted" ? DELETED_NO_PATCH_TEXT : NO_PATCH_TEXT}
            </p>
          )}
          {state.phase === "ready" && state.sections.length > 0 && (
            <div className="flex flex-col gap-3">
              {state.sections.map((section, index) => (
                <section
                  key={index}
                  data-testid="turn-file-diff-section"
                  data-tool={section.toolName}
                >
                  <p className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">第 {index + 1} 次</span>
                    <span>·</span>
                    <span>{section.toolName}</span>
                    {section.rows != null && (
                      // 2026-10-23-diff-dialog-copy-fallback / FR-01：超长 diff 的复制
                      // 兜底（DiffView 2000 行上限只截渲染，rows 完整）。常显覆盖：
                      // static 拆掉默认 absolute 浮出定位、opacity-100 拆掉 hover 才显。
                      // 2026-10-23-diff-copy-p3-cleanup / FR-01：getText 惰性取值——
                      // 渲染期不再全量构建复制文本，点击时才由 diffRowsToText 生成。
                      <CopyButton
                        getText={() =>
                          section.rows == null ? null : diffRowsToText(section.rows)
                        }
                        ariaLabel="复制该段 diff"
                        className="static right-auto bottom-auto ml-auto opacity-100"
                      />
                    )}
                  </p>
                  {section.rows ? (
                    <DiffView rows={section.rows} />
                  ) : (
                    <p className="rounded-md border border-border bg-muted/40 px-2 py-1.5 text-[11px] text-muted-foreground">
                      该次补丁格式不可解析，无法渲染行级 diff（原始补丁缺失或格式不符）。
                    </p>
                  )}
                </section>
              ))}
              <p className="pb-1 text-[10.5px] leading-[1.5] text-muted-foreground/80">
                内容来自本轮 agent 日志中编辑工具捕获的 structuredPatch；命令行/脚本改动无补丁记录，仅计入行数统计。
                {/* 2026-10-23-diff-copy-p3-cleanup / FR-02：复制文本边界如实说明——
                    行级前缀重建不含 hunk 头，不能直接 git apply。 */}
                复制内容为行级文本（不含 hunk 头），不可直接用于 git apply。
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

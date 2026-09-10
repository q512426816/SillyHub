"use client";

/**
 * ScopeFileDiffModal — 单文件变化比对弹窗（ql-20260910-017-2006）。
 *
 * 变更中心点击具体文件 → 展示该文件「对账同源锚点 vs 当前」的 git diff
 * （红绿高亮）。数据链：GET /workspaces/{id}/sillyspec/file-diff → backend
 * 绑定解析 → daemon RPC sillyspec_file_diff → 本机 sillyspec
 * `scope-audit --change <c> --file <f> --json`（锚点解析单一源在工具：
 * quick=HEAD 未提交窗口 / 归档=快照基点 / 活跃=worktree 锚）。
 *
 * 视觉基准（用户指定「参考变更中心裁决文件比对」）：
 *   - 弹窗壳对齐 conflict-compare-modal.tsx（antd Modal + footer=null +
 *     宽度 min(1080px, 94vw) + 头部锚点信息条）；
 *   - diff 行渲染复用 git-log/file-tree.tsx 已导出的 parseUnifiedDiff——
 *     + 行绿底（bg-success/10）/ - 行红底（bg-error/10）语义 token 同款
 *     （DiffBody 为该文件私有不导出，此处按同款写法镜像，不跨文件强 export）。
 *
 * 错误态分型（ApiError.code）：422 SILLYSPEC_TOO_OLD（本机 sillyspec 无
 * scope-audit，升级引导）/ 422 DAEMON_TOO_OLD（daemon 无 RPC）/ 404 未绑定 /
 * 502 离线远端 / 504 超时；422 家族不可重试只给指引，其余给重试按钮。
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Modal } from "antd";

import { parseUnifiedDiff } from "@/components/git-log/file-tree";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { getScopeFileDiff } from "@/lib/changes";
import { cn } from "@/lib/utils";

export interface ScopeFileDiffModalProps {
  /** 打开即拉取（关闭不拉）。 */
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  /** 对账目标（变更名或 quick-<8hex> 会话名）；null 不拉取。 */
  change: string | null;
  /** 仓库内文件相对路径；null 不拉取。 */
  filePath: string | null;
}

/** 缓存键（allowed_paths 只允许本文件 + lib/changes.ts，就地常量）。 */
const QUERY_KEY_ROOT = ["scope-file-diff-modal"] as const;

/** diff 展示上限（防御性前端截断——daemon 侧已有 256KB 护栏，通常到不了这里）。 */
const DIFF_RENDER_MAX_LINES = 5000;

/** 422 升级引导族（不可重试，只给指引文案）。 */
const UPGRADE_CODES = new Set([
  "HTTP_422_SCOPE_FILE_DIFF_SILLYSPEC_TOO_OLD",
  "HTTP_422_SCOPE_FILE_DIFF_DAEMON_TOO_OLD",
]);

export function ScopeFileDiffModal({
  open,
  onClose,
  workspaceId,
  change,
  filePath,
}: ScopeFileDiffModalProps) {
  const diffQ = useQuery({
    queryKey: [...QUERY_KEY_ROOT, workspaceId, change, filePath],
    queryFn: () => getScopeFileDiff(workspaceId, change!, filePath!),
    enabled: open && change !== null && filePath !== null,
    refetchOnWindowFocus: false,
  });

  const data = diffQ.data ?? null;
  const loading = open && diffQ.isPending;
  const err = diffQ.error ?? null;
  const isUpgrade =
    err instanceof ApiError && UPGRADE_CODES.has(err.code);

  // diff 解析（parseUnifiedDiff 已跳过文件头、维护双侧行号）+ 前端渲染截断。
  const lines = useMemo(
    () => (data?.diff ? parseUnifiedDiff(data.diff) : []),
    [data],
  );
  const renderTruncated = lines.length > DIFF_RENDER_MAX_LINES;

  const renderBody = () => {
    if (loading) {
      return (
        <div className="flex min-h-[320px] items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
          <span className="ml-3 text-sm text-muted-foreground">
            正在读取文件变化…（实时在本机跑对账锚点 diff，可能需要数秒）
          </span>
        </div>
      );
    }
    if (err !== null) {
      return (
        <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-sm font-semibold text-foreground">
            {isUpgrade ? "本机版本暂不支持文件比对" : "读取文件变化失败"}
          </p>
          <p className="max-w-md text-xs text-muted-foreground">
            {isUpgrade
              ? err.code === "HTTP_422_SCOPE_FILE_DIFF_SILLYSPEC_TOO_OLD"
                ? "本机 sillyspec 版本不含 scope-audit 命令，升级 sillyspec 后即可在变更中心直接查看文件变化。"
                : "守护进程版本过旧，未注册单文件比对指令；升级 daemon 后重试。"
              : err instanceof ApiError
                ? err.message
                : "网络异常，请稍后重试。"}
          </p>
          {!isUpgrade && (
            <Button variant="outline" onClick={() => void diffQ.refetch()}>
              重试
            </Button>
          )}
        </div>
      );
    }
    if (data === null) return null;
    // note 态：untracked 新文件 / 窗口内无改动（diff 空或 null）
    if (!data.diff) {
      return (
        <div className="flex min-h-[320px] items-center justify-center p-8 text-center">
          <p className="max-w-md text-xs leading-5 text-muted-foreground">
            {data.note ?? "该文件在此锚点窗口内无 diff（未改动）。"}
          </p>
        </div>
      );
    }
    return (
      <>
        {data.truncated && (
          <p className="mb-2 rounded border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs text-warning">
            文件差异过大（超 256KB），以下内容已截断；完整差异请在本地跑
            scope-audit --file 命令查看。
          </p>
        )}
        {renderTruncated && (
          <p className="mb-2 rounded border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs text-warning">
            差异行数超出展示上限（5000 行），以下仅展示部分。
          </p>
        )}
        <div
          data-testid="scope-file-diff-body"
          className="max-h-[calc(100vh-360px)] min-h-[320px] overflow-auto rounded border bg-card font-mono text-xs leading-relaxed"
        >
          {(renderTruncated ? lines.slice(0, DIFF_RENDER_MAX_LINES) : lines).map(
            (l, i) =>
              l.kind === "hunk" ? (
                <div
                  key={i}
                  className="bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground"
                >
                  {l.text}
                </div>
              ) : (
                <div
                  key={i}
                  data-diff-kind={l.kind}
                  className={cn(
                    "flex whitespace-pre",
                    l.kind === "add"
                      ? "bg-success/10 text-success"
                      : l.kind === "del"
                        ? "bg-error/10 text-error"
                        : "text-muted-foreground",
                  )}
                >
                  <span className="w-10 flex-none select-none pr-2 text-right text-[11px] text-muted-foreground/70">
                    {l.oldNo ?? ""}
                  </span>
                  <span className="w-10 flex-none select-none pr-2 text-right text-[11px] text-muted-foreground/70">
                    {l.newNo ?? ""}
                  </span>
                  <span className="flex-1 py-0.5 pl-1 pr-3">{l.text}</span>
                </div>
              ),
          )}
        </div>
      </>
    );
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width="min(1080px, 94vw)"
      title={
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span>文件变化比对</span>
          <span className="rounded bg-brand-50 px-1 text-[10px] leading-4 text-brand-700">
            {data?.mode === "quick" ? "快速修复" : "变更"}
          </span>
          <code
            data-testid="scope-file-diff-path"
            className="min-w-0 break-all font-mono text-xs text-muted-foreground"
          >
            {filePath ?? "—"}
          </code>
        </div>
      }
    >
      {/* 头部锚点信息条（对齐 conflict-compare 时间条形态）：对账同源锚点。
          note 不在此重复展示——正文区已按态呈现（note 态整段/截断条）。 */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
        <span>
          对账锚点：
          <b className="font-mono font-semibold text-foreground">
            {data?.anchor_label ?? data?.base_ref ?? "—"}
          </b>
        </span>
        <span>
          变更：
          <code className="font-mono">{change ?? "—"}</code>
        </span>
      </div>
      {renderBody()}
    </Modal>
  );
}

/**
 * git 审批确认对话卡（2026-11-06-session-git-approval task-11 / FR-02/03/05）。
 *
 * agent 的 git commit/push/sillyspec push 被 daemon 拦截后（dialog_kind='git_approval'），
 * 会话页弹出的 AskUserQuestion 同款对话卡（D-009 形态锚定，props 面对齐
 * ask-user-dialog-card.tsx）：commit 态目录树勾选 + msg 编辑 + 单文件 diff（会话级
 * 端点取数，D-014/D-015）；push 态目标 + 保护分支警示（D-006）+ 待推送提交按条明细
 * 可展开文件明细；拒绝子态快捷原因 + 自由填写（D-007）。
 *
 * UI 形态基准：已批准原型 frontend/src/components/prototype/git-approval-view.tsx
 *（目录树/四色状态/增删统计/按条展开同方言）；树构建复用 git-log buildFileTree
 *（子树增删聚合内建）。payload 防御性解析，缺字段走兜底不崩。
 */
"use client";

import { useMemo, useState } from "react";
import { Modal } from "antd";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  GitBranch,
  Minimize2,
} from "lucide-react";

import { buildFileTree, DiffBody, type GitLogFileTreeNode } from "@/components/git-log/file-tree";
import { ApiError, apiFetch } from "@/lib/api";
import { respondSessionPermission, type SessionPermissionRequest } from "@/lib/daemon/sessions";
import { cn } from "@/lib/utils";

/* ───────────── 局部类型（design 接口定义冻结，不强类型化 openapi） ───────────── */

export type GitApprovalFileStatus = "added" | "modified" | "deleted" | "renamed" | "untracked";

interface GitApprovalFile {
  path: string;
  status: GitApprovalFileStatus;
  staged: boolean;
  addLines: number;
  delLines: number;
}

interface GitApprovalAheadCommit {
  sha: string;
  subject: string;
  author: string;
  date: string;
  files: { path: string; status: GitApprovalFileStatus; addLines: number; delLines: number }[];
  filesTruncated?: boolean;
  fileCount?: number;
}

interface GitApprovalPayload {
  operation: "commit" | "push";
  command: string;
  worktree: string;
  branch: string;
  message: string;
  remoteTarget?: string;
  runner?: "git" | "sillyspec";
  protectedBranch?: boolean;
  aheadCommits?: GitApprovalAheadCommit[];
  aheadTruncated?: boolean;
  aheadCount?: number;
  files: GitApprovalFile[];
  filesTruncated?: boolean;
  fileCount?: number;
  collectError?: string;
  defaultSelected: string[];
}

/** 防御性解析：缺字段/格式不符走最小兜底 payload（不崩，卡面提示采集异常）。 */
function parsePayload(raw: Record<string, unknown> | undefined): GitApprovalPayload {
  const r = raw ?? {};
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const filesRaw = Array.isArray(r.files) ? r.files : [];
  const files: GitApprovalFile[] = filesRaw
    .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
    .map((f) => ({
      path: str(f.path),
      status: (["added", "modified", "deleted", "renamed", "untracked"].includes(str(f.status))
        ? str(f.status)
        : "modified") as GitApprovalFileStatus,
      staged: f.staged === true,
      addLines: typeof f.addLines === "number" ? f.addLines : 0,
      delLines: typeof f.delLines === "number" ? f.delLines : 0,
    }))
    .filter((f) => f.path.length > 0);
  const aheadRaw = Array.isArray(r.aheadCommits) ? r.aheadCommits : [];
  const aheadCommits: GitApprovalAheadCommit[] = aheadRaw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .map((c) => ({
      sha: str(c.sha).slice(0, 7),
      subject: str(c.subject),
      author: str(c.author),
      date: str(c.date),
      files: (Array.isArray(c.files) ? c.files : [])
        .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
        .map((f) => ({
          path: str(f.path),
          status: (["added", "modified", "deleted", "renamed", "untracked"].includes(str(f.status))
            ? str(f.status)
            : "modified") as GitApprovalFileStatus,
          addLines: typeof f.addLines === "number" ? f.addLines : 0,
          delLines: typeof f.delLines === "number" ? f.delLines : 0,
        }))
        .filter((f) => f.path.length > 0),
      ...(c.filesTruncated === true ? { filesTruncated: true } : {}),
      ...(typeof c.fileCount === "number" ? { fileCount: c.fileCount } : {}),
    }));
  return {
    operation: r.operation === "push" ? "push" : "commit",
    command: str(r.command),
    worktree: str(r.worktree),
    branch: str(r.branch),
    message: str(r.message),
    ...(r.remoteTarget !== undefined ? { remoteTarget: str(r.remoteTarget) } : {}),
    ...(r.runner === "sillyspec" ? { runner: "sillyspec" as const } : {}),
    ...(r.protectedBranch === true ? { protectedBranch: true } : {}),
    ...(aheadCommits.length > 0 ? { aheadCommits } : {}),
    ...(r.aheadTruncated === true ? { aheadTruncated: true } : {}),
    ...(typeof r.aheadCount === "number" ? { aheadCount: r.aheadCount } : {}),
    files,
    ...(r.filesTruncated === true ? { filesTruncated: true } : {}),
    ...(typeof r.fileCount === "number" ? { fileCount: r.fileCount } : {}),
    ...(typeof r.collectError === "string" ? { collectError: r.collectError } : {}),
    defaultSelected: Array.isArray(r.defaultSelected)
      ? r.defaultSelected.filter((p): p is string => typeof p === "string")
      : [],
  };
}

/* ───────────── 状态元数据（git-log 四色同方言） ───────────── */

const STATUS_META: Record<GitApprovalFileStatus, { label: string; cls: string; dotCls: string }> = {
  added: { label: "新增", cls: "text-success", dotCls: "bg-success" },
  modified: { label: "修改", cls: "text-primary", dotCls: "bg-primary" },
  deleted: { label: "删除", cls: "text-error line-through", dotCls: "bg-error" },
  renamed: { label: "重命名", cls: "text-muted-foreground", dotCls: "bg-muted-foreground" },
  untracked: { label: "未跟踪", cls: "text-muted-foreground", dotCls: "bg-muted-foreground" },
};

const REJECT_QUICK_REASONS = ["提交信息不符合规范", "文件范围不对", "还有改动没包含", "先不提交"];

/* ───────────── 单文件 diff 取数（会话级端点，W3） ───────────── */

interface GitDiffState {
  path: string;
  loading: boolean;
  diff?: string;
  truncated?: boolean;
  binary?: boolean;
  error?: string;
}

async function fetchSessionGitDiff(sessionId: string, path: string): Promise<Partial<GitDiffState>> {
  try {
    const resp = await apiFetch<{ git_mode?: string; diff?: string | null; truncated?: boolean; binary?: boolean }>(
      `/api/daemon/sessions/${encodeURIComponent(sessionId)}/git-diff`,
      { query: { path } },
    );
    if (resp.git_mode && resp.git_mode !== "git") {
      return { error: "无法获取差异（工作区不可用）" };
    }
    return {
      diff: resp.diff ?? "",
      truncated: resp.truncated === true,
      binary: resp.binary === true,
    };
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "差异获取失败" };
  }
}

/* ───────────── 树勾选工具 ───────────── */

function collectLeafPaths(node: GitLogFileTreeNode, acc: string[] = []): string[] {
  if (node.children.length === 0) {
    acc.push(node.path);
    return acc;
  }
  for (const c of node.children) collectLeafPaths(c, acc);
  return acc;
}

/* ───────────── 组件 ───────────── */

export interface GitApprovalCardProps {
  request: SessionPermissionRequest;
  /** 卡片被移除时回调（permission_resolved SSE / 父组件清空时触发）。 */
  onResolved?: (requestId: string, decision: "allow" | "deny") => void;
  /** 最小化受控态：true 渲染 null 但保持挂载（勾选/msg 编辑态保留）。 */
  minimized?: boolean;
  /** 点击卡头最小化按钮回调。 */
  onMinimize?: (requestId: string) => void;
}

export function GitApprovalCard({ request, onResolved, minimized, onMinimize }: GitApprovalCardProps) {
  const payload = useMemo(() => parsePayload(request.dialog_payload), [request.dialog_payload]);
  const [message, setMessage] = useState(payload.message);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(payload.defaultSelected));
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedAhead, setExpandedAhead] = useState<Set<string>>(new Set());
  const [diffState, setDiffState] = useState<GitDiffState | null>(null);

  // 三分组（顶层）：已暂存 / 未暂存改动 / 未跟踪（D-012）。
  const groups = useMemo(() => {
    const staged = payload.files.filter((f) => f.staged);
    const unstaged = payload.files.filter((f) => !f.staged && f.status !== "untracked");
    const untracked = payload.files.filter((f) => f.status === "untracked");
    return [
      { key: "staged", label: "已暂存", files: staged },
      { key: "unstaged", label: "未暂存改动", files: unstaged },
      { key: "untracked", label: "未跟踪", files: untracked },
    ].filter((g) => g.files.length > 0);
  }, [payload.files]);

  const openDiff = async (path: string) => {
    setDiffState({ path, loading: true });
    const r = await fetchSessionGitDiff(request.session_id, path);
    setDiffState((prev) => (prev && prev.path === path ? { ...prev, loading: false, ...r } : prev));
  };

  const submitApprove = async () => {
    setSubmitting(true);
    setError(null);
    const dialogResult =
      payload.operation === "commit"
        ? { action: "approve", message, selectedFiles: [...selected] }
        : { action: "approve", message: "" };
    try {
      await respondSessionPermission(
        request.session_id,
        request.request_id,
        "allow",
        undefined,
        dialogResult,
      );
      onResolved?.(request.request_id, "allow");
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof ApiError ? err.message : "提交失败，请重试");
    }
  };

  const submitReject = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await respondSessionPermission(request.session_id, request.request_id, "deny", undefined, {
        action: "reject",
        reason: rejectReason,
      });
      onResolved?.(request.request_id, "deny");
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof ApiError ? err.message : "提交失败，请重试");
    }
  };

  if (minimized) return null;

  const opLabel = payload.operation === "commit" ? "提交" : "推送";

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      {/* 卡头（AskUser 同方言 brand 头部） */}
      <div className="flex items-start justify-between gap-2 rounded-t-lg border-b border-brand-200 bg-brand-50/60 px-4 py-2.5">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <GitBranch aria-hidden className="h-4 w-4 text-brand-600" />
            Git {opLabel}确认
            {payload.branch ? (
              <span className="ml-1 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] font-normal text-muted-foreground">
                {payload.branch}
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {rejectMode
              ? "拒绝后将把原因反馈给 Agent，它可调整后重新发起"
              : `Agent 请求${opLabel}代码，请确认后执行（由平台代为执行，结果回传 Agent）`}
          </p>
        </div>
        {onMinimize ? (
          <button
            type="button"
            title="最小化为待决策胶囊"
            onClick={() => onMinimize(request.request_id)}
            className="shrink-0 rounded p-1 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
            data-testid="git-approval-minimize"
          >
            <Minimize2 aria-hidden className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      <div className="px-4 py-3" data-testid="git-approval-body">
        {/* 原始命令（agent 意图，等宽） */}
        {payload.command ? (
          <p
            className={cn(
              "mb-2 truncate rounded border border-border bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground",
              rejectMode && "mb-3",
            )}
            title={payload.command}
          >
            $ {payload.command}
          </p>
        ) : null}

        {payload.collectError ? (
          <p className="mb-2 rounded border border-error/40 bg-error/10 px-2.5 py-1.5 text-[11px] text-error">
            {payload.collectError}
          </p>
        ) : null}

        {rejectMode ? (
          /* ── 拒绝子态 ── */
          <>
            <p className="mb-1 text-xs font-medium text-foreground">拒绝原因（将反馈给 Agent）</p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {REJECT_QUICK_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRejectReason(r)}
                  className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  data-testid={`git-approval-reject-chip-${r}`}
                >
                  {r}
                </button>
              ))}
            </div>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="或自由填写拒绝原因……"
              rows={2}
              className="mb-3 w-full resize-y rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-brand-400 focus:outline-none"
              data-testid="git-approval-reject-input"
            />
          </>
        ) : payload.operation === "commit" ? (
          /* ── commit 主态 ── */
          <>
            <label className="mb-1 block text-xs font-medium text-foreground" data-testid="git-approval-msg-label">
              提交信息（可修改）
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder="提交信息……"
              className="mb-3 w-full resize-y rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:border-brand-400 focus:outline-none"
              data-testid="git-approval-msg-input"
            />
            {payload.filesTruncated ? (
              <p className="mb-2 rounded border border-border bg-muted/40 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                改动文件共 {payload.fileCount ?? payload.files.length} 个，超出卡片展示上限（500）——下方为样本，
                全量请在 Git 日志页查看；提交将包含全部预填范围。
              </p>
            ) : null}
            <p className="mb-1 text-xs font-medium text-foreground">
              提交文件范围（勾选 {selected.size} 个）
            </p>
            <div className="mb-3 max-h-56 overflow-y-auto rounded border border-border" data-testid="git-approval-files">
              {groups.map((g) => (
                <FileGroup
                  key={g.key}
                  label={g.label}
                  files={g.files}
                  selected={selected}
                  onSelect={(paths, on) =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      for (const p of paths) {
                        if (on) next.add(p);
                        else next.delete(p);
                      }
                      return next;
                    })
                  }
                  onOpenDiff={openDiff}
                />
              ))}
              {payload.files.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">（无文件清单——采集降级态，请谨慎确认）</p>
              ) : null}
            </div>
          </>
        ) : (
          /* ── push 主态 ── */
          <>
            <div className="mb-3 flex flex-col gap-1.5 rounded border border-border px-3 py-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">目标</span>
                <span className="flex items-center gap-1.5 font-mono text-foreground">
                  {payload.remoteTarget || "origin/（当前分支）"}
                  {payload.protectedBranch ? (
                    <span className="rounded border border-error/40 bg-error/10 px-1.5 py-0.5 text-[10px] font-medium text-error">
                      保护分支 · 推送影响远端主线
                    </span>
                  ) : null}
                </span>
              </div>
              {typeof payload.aheadCount === "number" ? (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">待推送提交</span>
                  <span className="tabular-nums text-foreground">
                    {payload.aheadCommits?.length ?? 0} 个提交（领先远端 {payload.aheadCount}）
                  </span>
                </div>
              ) : null}
            </div>
            {payload.runner === "sillyspec" ? (
              <p className="mb-3 rounded border border-brand-200 bg-brand-50/60 px-2.5 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
                该推送经 <code className="font-mono">sillyspec push</code> 发起：确认后将按变更段压扁本地提交再快进推送（压扁语义由平台代执行保留）。
              </p>
            ) : null}
            {(payload.aheadCommits?.length ?? 0) > 0 ? (
              <>
                <p className="mb-1 text-xs font-medium text-foreground">将推送的提交</p>
                <div className="mb-3 flex max-h-56 flex-col gap-0.5 overflow-y-auto rounded border border-border px-2 py-1.5">
                  {payload.aheadCommits!.map((c) => (
                    <AheadCommitRow
                      key={c.sha}
                      commit={c}
                      open={expandedAhead.has(c.sha)}
                      onToggle={() =>
                        setExpandedAhead((prev) => {
                          const next = new Set(prev);
                          if (next.has(c.sha)) next.delete(c.sha);
                          else next.add(c.sha);
                          return next;
                        })
                      }
                    />
                  ))}
                  {payload.aheadTruncated ? (
                    <p className="px-1 py-1 text-[11px] text-muted-foreground">
                      …（共 {payload.aheadCount ?? payload.aheadCommits!.length} 个提交，超出 20 条展示上限）
                    </p>
                  ) : null}
                </div>
              </>
            ) : null}
          </>
        )}

        {error ? (
          <p className="mb-2 rounded border border-error/40 bg-error/10 px-2.5 py-1.5 text-[11px] text-error" data-testid="git-approval-error">
            {error}
          </p>
        ) : null}

        {/* 底部按钮组 */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">批准后由平台代为执行，结果自动回传给 Agent</span>
          <div className="flex shrink-0 gap-2">
            {rejectMode ? (
              <>
                <button
                  type="button"
                  onClick={() => setRejectMode(false)}
                  className="h-7 rounded border border-border px-3 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  返回确认卡
                </button>
                <button
                  type="button"
                  onClick={submitReject}
                  disabled={submitting}
                  className="h-7 rounded border border-error/50 bg-error/10 px-3 text-[11px] font-medium text-error transition-colors hover:bg-error/20 disabled:opacity-50"
                  data-testid="git-approval-reject-confirm"
                >
                  确认拒绝
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setRejectMode(true)}
                  className="h-7 rounded border border-border px-3 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  data-testid="git-approval-reject"
                >
                  拒绝
                </button>
                <button
                  type="button"
                  onClick={submitApprove}
                  disabled={submitting || (payload.operation === "commit" && (selected.size === 0 || message.trim().length === 0))}
                  className="h-7 rounded bg-brand-600 px-3 text-[11px] font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
                  data-testid="git-approval-approve"
                >
                  {submitting
                    ? "提交中…"
                    : payload.operation === "commit"
                      ? `提交 ${selected.size} 个文件`
                      : "确认推送"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 单文件 diff 弹窗（会话级端点取数 + DiffBody 渲染；关闭态零请求） */}
      <Modal
        open={diffState !== null}
        title={diffState ? `文件改动 · ${diffState.path}` : "文件改动"}
        onCancel={() => setDiffState(null)}
        footer={null}
        width={720}
      >
        {diffState?.loading ? (
          <p className="py-4 text-xs text-muted-foreground">差异加载中…</p>
        ) : diffState?.error ? (
          <p className="py-4 text-xs text-error">{diffState.error}</p>
        ) : diffState?.binary ? (
          <p className="py-4 text-xs text-muted-foreground">二进制文件，无法展示文本差异。</p>
        ) : (
          <>
            <DiffBody diff={diffState?.diff ?? ""} />
            {diffState?.truncated ? (
              <p className="mt-2 text-[11px] text-muted-foreground">差异过长已截断，全量请在 Git 日志页查看。</p>
            ) : null}
          </>
        )}
      </Modal>
    </div>
  );
}

/* ───────────── 顶层分组（组内目录树 + 勾选） ───────────── */

function FileGroup({
  label,
  files,
  selected,
  onSelect,
  onOpenDiff,
}: {
  label: string;
  files: GitApprovalFile[];
  selected: Set<string>;
  onSelect: (paths: string[], on: boolean) => void;
  onOpenDiff: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const fileByPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  // 复用 git-log buildFileTree（子树增删聚合内建；字段适配映射）。
  const tree = useMemo(
    () => buildFileTree(files.map((f) => ({ path: f.path, add: f.addLines, del: f.delLines, binary: false }))),
    [files],
  );
  return (
    <div className="border-b border-border/60 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1 px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        {open ? <ChevronDown aria-hidden className="h-3 w-3" /> : <ChevronRight aria-hidden className="h-3 w-3" />}
        <span className="font-medium">{label}</span>
        <span className="tabular-nums">({files.length})</span>
      </button>
      {open ? (
        <div className="ml-3 border-l border-border/60">
          {tree.map((n) => (
            <TreeNodeRow
              key={n.path}
              node={n}
              depth={0}
              fileByPath={fileByPath}
              selected={selected}
              onSelect={onSelect}
              onOpenDiff={onOpenDiff}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ───────────── 树行（目录级勾选 + 文件行勾选/增删/徽标/diff 入口） ───────────── */

function TreeNodeRow({
  node,
  depth,
  fileByPath,
  selected,
  onSelect,
  onOpenDiff,
}: {
  node: GitLogFileTreeNode;
  depth: number;
  fileByPath: Map<string, GitApprovalFile>;
  selected: Set<string>;
  onSelect: (paths: string[], on: boolean) => void;
  onOpenDiff: (path: string) => void;
}) {
  const isLeaf = node.children.length === 0;
  const [open, setOpen] = useState(true);
  const leafPaths = useMemo(() => (isLeaf ? [node.path] : collectLeafPaths(node)), [isLeaf, node]);
  const selCount = leafPaths.filter((p) => selected.has(p)).length;
  const file = isLeaf ? fileByPath.get(node.path) : undefined;
  const meta = file ? STATUS_META[file.status] : undefined;

  if (isLeaf) {
    const name = node.path.split("/").pop() ?? node.path;
    return (
      <label
        className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted/60"
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
        data-testid={`git-approval-file-${node.path}`}
      >
        <input
          type="checkbox"
          checked={selected.has(node.path)}
          onChange={(e) => onSelect([node.path], e.target.checked)}
          className="h-3 w-3 accent-brand-600"
        />
        {meta ? <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", meta.dotCls)} /> : null}
        <span className={cn("min-w-0 flex-1 truncate font-mono", meta?.cls)} title={node.path}>
          {name}
        </span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums">
          <span className="text-success">+{node.add}</span> <span className="text-error">-{node.del}</span>
        </span>
        {meta ? (
          <span className={cn("shrink-0 rounded border border-border px-1 text-[10px]", meta.cls)}>{meta.label}</span>
        ) : null}
        <span
          role="button"
          tabIndex={0}
          title="查看改动"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onOpenDiff(node.path);
          }}
          className="shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground/70 hover:bg-muted hover:text-foreground"
        >
          <FileText aria-hidden className="h-3 w-3" />
        </span>
      </label>
    );
  }

  return (
    <div>
      <div
        className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
      >
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-label={open ? "折叠目录" : "展开目录"}
          className="shrink-0 cursor-pointer"
        >
          {open ? <ChevronDown aria-hidden className="h-3 w-3" /> : <ChevronRight aria-hidden className="h-3 w-3" />}
        </button>
        <input
          type="checkbox"
          checked={selCount === leafPaths.length && leafPaths.length > 0}
          ref={(el) => {
            if (el) el.indeterminate = selCount > 0 && selCount < leafPaths.length;
          }}
          onChange={(e) => onSelect(leafPaths, e.target.checked)}
          title={`目录级勾选（${selCount}/${leafPaths.length} 已选）`}
          className="h-3 w-3 accent-brand-600"
        />
        <span className="truncate font-mono">{node.name}/</span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <span className="font-mono text-[10px] tabular-nums">
            <span className="text-success">+{node.add}</span> <span className="text-error">-{node.del}</span>
          </span>
          <span className="tabular-nums text-[10px] text-muted-foreground/70">
            {selCount}/{leafPaths.length}
          </span>
        </span>
      </div>
      {open ? (
        <div className="border-l border-border/60" style={{ marginLeft: `${depth * 14}px` }}>
          {node.children.map((c) => (
            <TreeNodeRow
              key={c.path}
              node={c}
              depth={0}
              fileByPath={fileByPath}
              selected={selected}
              onSelect={onSelect}
              onOpenDiff={onOpenDiff}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ───────────── push 态单条提交行（可展开文件明细，D-015 纯浏览） ───────────── */

function AheadCommitRow({
  commit,
  open,
  onToggle,
}: {
  commit: GitApprovalAheadCommit;
  open: boolean;
  onToggle: () => void;
}) {
  const totalAdd = commit.files.reduce((s, f) => s + f.addLines, 0);
  const totalDel = commit.files.reduce((s, f) => s + f.delLines, 0);
  return (
    <div className="rounded px-1 py-1 text-xs hover:bg-muted/60" data-testid={`git-approval-ahead-${commit.sha}`}>
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-2 text-left">
        {open ? (
          <ChevronDown aria-hidden className="mt-1 h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight aria-hidden className="mt-1 h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <span className="mt-0.5 shrink-0 rounded border border-border bg-muted/50 px-1 font-mono text-[10px] text-muted-foreground">
          {commit.sha}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-foreground" title={commit.subject}>
            {commit.subject}
          </span>
          <span className="block text-[10px] text-muted-foreground/80">
            {commit.author} · {commit.date} · {commit.fileCount ?? commit.files.length} 个文件{" "}
            <span className="text-success">+{totalAdd}</span> <span className="text-error">-{totalDel}</span>
          </span>
        </span>
      </button>
      {open ? (
        <div className="mt-1 ml-7 rounded border border-border/70 bg-muted/20 px-1.5 py-1">
          {commit.files.map((f) => {
            const meta = STATUS_META[f.status];
            const dir = f.path.split("/").slice(0, -1).join("/");
            const name = f.path.split("/").pop() ?? f.path;
            return (
              <div key={f.path} className="flex items-center gap-2 rounded px-1 py-0.5 text-[11px] hover:bg-muted/60">
                <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", meta.dotCls)} />
                <span className={cn("min-w-0 flex-1 truncate font-mono", meta.cls)} title={f.path}>
                  {dir ? `${dir}/` : ""}
                  <span className="text-foreground">{name}</span>
                </span>
                <span className="shrink-0 font-mono text-[10px] tabular-nums">
                  <span className="text-success">+{f.addLines}</span> <span className="text-error">-{f.delLines}</span>
                </span>
                <span className={cn("shrink-0 rounded border border-border px-1 text-[10px]", meta.cls)}>
                  {meta.label}
                </span>
              </div>
            );
          })}
          {commit.filesTruncated ? (
            <p className="px-1 py-0.5 text-[10px] text-muted-foreground">
              …（该提交共 {commit.fileCount ?? commit.files.length} 个文件，超出 50 条展示上限）
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

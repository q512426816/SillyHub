"use client";

/**
 * task-06：提交详情变更文件目录树（git show --numstat 平铺路径按 / 聚合）。
 *
 * - buildFileTree 纯函数：目录节点聚合 +x/-y（子树求和），叶子保留单文件统计；
 *   目录在前、文件在后、同名 localeCompare 排序；
 * - 树交互参照 change-file-tree.tsx 先例（缩进/展开箭头/Folder 图标/默认全展开）；
 * - 叶子点击展开文件级 unified diff（R-06 按需加载）：FileDiff 仅在展开态挂载，
 *   即挂载即请求（useGitLogDiff enabled=true），折叠即卸载——点击前零请求；
 *   binary 叶子（numstat「-」）不发请求直接提示「二进制文件」；
 * - diff 按行渲染：+ 行绿底（bg-success/10）、- 行红底（bg-error/10）走语义
 *   token 透明度类；@@ hunk 头 muted 灰底；truncated=true 顶部提示已截断。
 *
 * 依据：tasks/task-06.md、design.md §5.4 / §7.4 / R-06、prototype-workspace-git-log.html。
 */

import { useMemo, useState } from "react";
import { ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";

import { ApiError } from "@/lib/api";
import { useGitLogDiff, type GitLogFileStatItem } from "@/lib/git-log";
import { cn } from "@/lib/utils";

// ── 路径聚合（纯函数，供单测直接断言）──────────────────────────────────

/** 目录/文件树节点（目录 children 非空；叶子携带原始 numstat 项）。 */
export interface GitLogFileTreeNode {
  name: string;
  /** 仓库内相对路径（目录为目录前缀，叶子为完整文件路径）。 */
  path: string;
  /** 新增行数（目录=子树求和；二进制文件为 0）。 */
  add: number;
  /** 删除行数（目录=子树求和；二进制文件为 0）。 */
  del: number;
  /** 是否二进制文件（仅叶子有意义）。 */
  binary: boolean;
  children: GitLogFileTreeNode[];
  /** 叶子原始统计项（目录节点为 undefined）。 */
  file?: GitLogFileStatItem;
}

/** 收集全部目录路径（默认全展开用，对齐 change-file-tree 先例）。 */
function collectDirPaths(nodes: GitLogFileTreeNode[], acc: Set<string> = new Set()): Set<string> {
  for (const n of nodes) {
    if (n.children.length > 0) {
      acc.add(n.path);
      collectDirPaths(n.children, acc);
    }
  }
  return acc;
}

/** 目录在前、文件在后，同组按名称 localeCompare 排序（递归全层）。 */
function sortNodes(nodes: GitLogFileTreeNode[]): void {
  nodes.sort(
    (a, b) =>
      (a.children.length > 0 ? 0 : 1) - (b.children.length > 0 ? 0 : 1) ||
      a.name.localeCompare(b.name),
  );
  for (const n of nodes) sortNodes(n.children);
}

/** 目录节点 +x/-y 自底向上求和。 */
function aggregate(node: GitLogFileTreeNode): void {
  if (node.children.length === 0) return;
  let add = 0;
  let del = 0;
  for (const child of node.children) {
    aggregate(child);
    add += child.add;
    del += child.del;
  }
  node.add = add;
  node.del = del;
}

/**
 * 平铺 files 按 / 聚合成目录树。
 * 输入顺序无关（map 索引目录、出口统一排序），同路径文件按输入顺序保留。
 */
export function buildFileTree(files: GitLogFileStatItem[]): GitLogFileTreeNode[] {
  const root: GitLogFileTreeNode = {
    name: "",
    path: "",
    add: 0,
    del: 0,
    binary: false,
    children: [],
  };
  const dirIndex = new Map<string, GitLogFileTreeNode>([["", root]]);

  const ensureDir = (dirPath: string): GitLogFileTreeNode => {
    const hit = dirIndex.get(dirPath);
    if (hit) return hit;
    const idx = dirPath.lastIndexOf("/");
    const name = idx === -1 ? dirPath : dirPath.slice(idx + 1);
    const parentPath = idx === -1 ? "" : dirPath.slice(0, idx);
    const node: GitLogFileTreeNode = {
      name,
      path: dirPath,
      add: 0,
      del: 0,
      binary: false,
      children: [],
    };
    ensureDir(parentPath).children.push(node);
    dirIndex.set(dirPath, node);
    return node;
  };

  for (const f of files) {
    const parts = f.path.split("/").filter(Boolean);
    const name = parts.pop() ?? f.path;
    const dir = ensureDir(parts.join("/"));
    dir.children.push({
      name,
      path: f.path,
      add: f.add,
      del: f.del,
      binary: f.binary,
      children: [],
      file: f,
    });
  }

  aggregate(root);
  sortNodes(root.children);
  return root.children;
}

// ── unified diff 解析（纯函数，供单测直接断言）────────────────────────

export interface DiffLine {
  kind: "hunk" | "add" | "del" | "ctx";
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

/**
 * 解析 unified diff 文本为行数组。
 * - 首个 @@ 前的 diff --git / index / --- / +++ 等文件头整体跳过；
 * - @@ 头重置 old/new 行号计数，add 行只推进 new、del 行只推进 old；
 * - \ No newline at end of file 等尾注按上下文行处理（不影响行号）。
 */
export function parseUnifiedDiff(diff: string): DiffLine[] {
  const out: DiffLine[] = [];
  let seenHunk = false;
  let oldNo = 0;
  let newNo = 0;
  const hunkRe = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
  for (const raw of diff.split("\n")) {
    const hunk = hunkRe.exec(raw);
    if (hunk != null) {
      seenHunk = true;
      oldNo = Number.parseInt(hunk[1] ?? "0", 10);
      newNo = Number.parseInt(hunk[2] ?? "0", 10);
      out.push({ kind: "hunk", oldNo: null, newNo: null, text: raw });
      continue;
    }
    if (!seenHunk) {
      continue; // 文件头区（diff --git / index / --- a/… / +++ b/…）
    }
    if (raw.startsWith("+")) {
      out.push({ kind: "add", oldNo: null, newNo, text: raw.slice(1) });
      newNo += 1;
    } else if (raw.startsWith("-")) {
      out.push({ kind: "del", oldNo, newNo: null, text: raw.slice(1) });
      oldNo += 1;
    } else {
      out.push({
        kind: "ctx",
        oldNo,
        newNo,
        text: raw.replace(/^ /, ""),
      });
      oldNo += 1;
      newNo += 1;
    }
  }
  return out;
}

// ── diff 展示 ─────────────────────────────────────────────────────────

function DiffBody({ diff }: { diff: string }) {
  const lines = useMemo(() => parseUnifiedDiff(diff), [diff]);
  if (lines.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">（无差异内容）</div>
    );
  }
  return (
    <div
      className="overflow-x-auto font-mono text-xs leading-relaxed"
      data-testid="git-log-diff"
    >
      {lines.map((l, i) =>
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
  );
}

/**
 * 单文件 diff 区块：仅在展开态由父级挂载（挂载即请求、折叠即卸载），
 * 同 (workspaceId, sha, path) 结果进 react-query 缓存，重复展开不重复请求。
 */
function FileDiff({
  workspaceId,
  sha,
  path,
}: {
  workspaceId: string;
  sha: string;
  path: string;
}) {
  const diffQuery = useGitLogDiff(workspaceId, sha, path, true);

  if (diffQuery.isPending) {
    return (
      <div className="mt-1 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
        diff 加载中…
      </div>
    );
  }
  if (diffQuery.isError) {
    return (
      <div className="mt-1 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        {diffQuery.error instanceof ApiError
          ? diffQuery.error.message
          : "diff 加载失败"}
      </div>
    );
  }
  const data = diffQuery.data;
  return (
    <div className="mt-1 overflow-hidden rounded-md border border-border bg-card">
      {data?.truncated && (
        <div className="border-b border-border bg-warning/10 px-2.5 py-1 text-[11px] text-warning">
          diff 超过 64KB 上限，已截断显示
        </div>
      )}
      {data?.binary ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">二进制文件</div>
      ) : (
        <DiffBody diff={data?.diff ?? ""} />
      )}
    </div>
  );
}

// ── 目录树渲染 ────────────────────────────────────────────────────────

function TreeView({
  nodes,
  workspaceId,
  sha,
  depth = 0,
}: {
  nodes: GitLogFileTreeNode[];
  workspaceId: string;
  sha: string;
  depth?: number;
}) {
  // 目录展开态：默认全展开（对齐 change-file-tree 先例的初始收集全部目录）
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    collectDirPaths(nodes),
  );
  // 叶子 diff 展开态（点击叶子切换；组件随 Drawer 关闭/切换提交卸载而重置）
  const [diffPaths, setDiffPaths] = useState<Set<string>>(new Set());

  const toggleDir = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  const toggleDiff = (path: string) =>
    setDiffPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div className="text-sm">
      {nodes.map((node) => {
        const isDir = node.children.length > 0;
        if (isDir) {
          const isOpen = expanded.has(node.path);
          return (
            <div key={node.path}>
              <button
                type="button"
                className="group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-brand-50"
                style={{ paddingLeft: `${depth * 16 + 8}px` }}
                onClick={() => toggleDir(node.path)}
                data-testid={`git-log-dir-${node.path}`}
              >
                <ChevronRight
                  className={cn(
                    "h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-200",
                    isOpen && "rotate-90",
                  )}
                  aria-hidden
                />
                {isOpen ? (
                  <FolderOpen
                    className="h-3.5 w-3.5 shrink-0 text-brand-600"
                    aria-hidden
                  />
                ) : (
                  <Folder
                    className="h-3.5 w-3.5 shrink-0 text-brand-600"
                    aria-hidden
                  />
                )}
                <span className="truncate font-medium text-foreground">
                  {node.name}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-1 font-mono text-[11px]">
                  <span className="text-success">+{node.add}</span>
                  <span className="text-error">-{node.del}</span>
                </span>
              </button>
              {isOpen && (
                <TreeView
                  nodes={node.children}
                  workspaceId={workspaceId}
                  sha={sha}
                  depth={depth + 1}
                />
              )}
            </div>
          );
        }

        const diffOpen = diffPaths.has(node.path);
        return (
          <div key={node.path}>
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors",
                diffOpen
                  ? "bg-brand-50 font-medium text-brand-700"
                  : "text-foreground hover:bg-brand-50",
              )}
              style={{ paddingLeft: `${depth * 16 + 8}px` }}
              onClick={() => toggleDiff(node.path)}
              aria-expanded={diffOpen}
              data-testid={`git-log-file-${node.path}`}
            >
              <FileText
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span className="truncate font-mono" title={node.path}>
                {node.name}
              </span>
              {node.binary && (
                <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                  二进制
                </span>
              )}
              <span className="ml-auto flex shrink-0 items-center gap-1 font-mono text-[11px]">
                <span className="text-success">+{node.add}</span>
                <span className="text-error">-{node.del}</span>
              </span>
            </button>
            {diffOpen &&
              (node.binary ? (
                // binary 叶子（numstat「-」）不发请求，直接提示（R-06）
                <div className="mt-1 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
                  二进制文件，不支持文本 diff
                </div>
              ) : (
                <FileDiff
                  workspaceId={workspaceId}
                  sha={sha}
                  path={node.path}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}

export interface GitLogFileTreeProps {
  workspaceId: string;
  /** 提交全长哈希（diff 端点路径段）。 */
  sha: string;
  files: GitLogFileStatItem[];
}

/** 变更文件目录树（page/Drawer 装配入口）。 */
export function GitLogFileTree({ workspaceId, sha, files }: GitLogFileTreeProps) {
  const tree = useMemo(() => buildFileTree(files), [files]);
  return (
    <TreeView nodes={tree} workspaceId={workspaceId} sha={sha} depth={0} />
  );
}

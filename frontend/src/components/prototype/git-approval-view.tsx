/**
 * 会话 git 提交/推送确认对话卡原型视图（2026-11-06-session-git-approval）。
 *
 * 展示 agent 触发 git commit/push 时在会话页弹出的「git 确认对话卡」形态：
 * AskUserQuestion 同款对话卡外壳（替换输入栏位置），内容为 git 确认面板——
 * commit 态（msg 编辑 + 文件树勾选 + diff 入口）/ push 态（目标分支 + 警示）/
 * 拒绝态（原因填写）三态。
 *
 * 素材来源声明（真码五要素）：
 *   - 对话卡外壳：frontend/src/components/ask-user-dialog-card.tsx 卡头/按钮组
 *     同方言复刻（border-brand-200 / bg-brand-50/60 头部、Button size sm）；
 *   - 文件树行：frontend/src/components/git-log/worktree-changes-card.tsx
 *     StatusTreeRows 目录树行 + WORKTREE_STATUS_META 四色状态徽标同方言复刻
 *     （text-success/text-primary/text-error line-through/text-muted-foreground）；
 *   - token：语义阶全走 styles/themes.ts（brand 系列、border、bg-card 等，随 data-theme 换肤）；
 *   - 图标：lucide-react 真实依赖（GitBranch/GitCommitHorizontal/GitPullRequest/
 *     FileText/Minus/ChevronRight/ChevronDown/Minimize2）；
 *   - 交互：prototype-build 内嵌 data-state-btn / data-state-panel 三态切换，
 *     初始态名必须是 commit（脚本默认 setState("commit")）。
 *
 * 预填勾选规则（D-008 设计，段 2）：命令带 pathspec 勾 pathspec；-a 勾全部
 * tracked 改动；都无勾当前暂存区；暂存区空勾全部改动。本原型 fixture 演示
 * 「agent 已 git add 两个文件、另有未暂存改动与未跟踪文件」的典型场景：
 * 默认勾选 = 暂存区两文件，用户可增选。
 */
import * as React from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  GitBranch,
  Minimize2,
} from "lucide-react";

import { DemoBar } from "./demo-chrome";

/* ───────────── 文件状态元数据（WORKTREE_STATUS_META 同方言） ───────────── */

type FileStatus = "added" | "modified" | "deleted" | "untracked";

const STATUS_META: Record<FileStatus, { label: string; cls: string; dotCls: string }> = {
  added: { label: "新增", cls: "text-success", dotCls: "bg-success" },
  modified: { label: "修改", cls: "text-primary", dotCls: "bg-primary" },
  deleted: { label: "删除", cls: "text-error line-through", dotCls: "bg-error" },
  untracked: { label: "未跟踪", cls: "text-muted-foreground", dotCls: "bg-muted-foreground" },
};

interface GitFileItem {
  path: string;
  status: FileStatus;
  /** 是否在暂存区（agent 已 git add）。 */
  staged: boolean;
  /** 预填勾选（默认提交范围）。 */
  defaultSelected: boolean;
  /** 增/删行数（git diff --numstat，暂存区文件取 --cached 口径）。 */
  addLines: number;
  delLines: number;
}

/* ───────────── 勾选文件行（StatusTreeRows 同方言 + checkbox） ───────────── */

function FileRow({ f }: { f: GitFileItem }) {
  const meta = STATUS_META[f.status];
  // 目录树形态：行内只显 basename，父路径由层级表达（git-log 工作区更改同款）
  const name = f.path.split("/").pop() ?? f.path;
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted/60">
      <input type="checkbox" defaultChecked={f.defaultSelected} className="h-3 w-3 accent-brand-600" />
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dotCls}`} />
      <span className={`min-w-0 flex-1 truncate font-mono ${meta.cls}`} title={f.path}>
        {name}
      </span>
      {/* 增删行数（numstat 口径；增绿删红 tabular-nums） */}
      <span className="shrink-0 font-mono text-[10px] tabular-nums">
        <span className="text-success">+{f.addLines}</span>{" "}
        <span className="text-error">-{f.delLines}</span>
      </span>
      <span className={`shrink-0 rounded border border-border px-1 text-[10px] ${meta.cls}`}>
        {meta.label}
      </span>
      {f.staged ? (
        <span className="shrink-0 rounded border border-border px-1 text-[10px] text-muted-foreground">
          已暂存
        </span>
      ) : null}
      {/* 单文件 diff 入口（实现复用 WorktreeDiffModal；原型仅示意按钮形态） */}
      <span
        role="button"
        tabIndex={0}
        title="查看改动"
        className="shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground/70 hover:bg-muted hover:text-foreground"
      >
        <FileText aria-hidden className="h-3 w-3" />
      </span>
    </label>
  );
}

/* ───────────── 目录树（buildFileTree 同方言：路径段逐级折叠 + 目录级勾选） ───────────── */

interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  files: GitFileItem[];
}

function buildTree(files: GitFileItem[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      if (seg === undefined) continue;
      if (!node.children.has(seg)) {
        node.children.set(seg, {
          name: seg,
          path: parts.slice(0, i + 1).join("/"),
          children: new Map(),
          files: [],
        });
      }
      const next = node.children.get(seg);
      if (!next) break;
      node = next;
    }
    node.files.push(f);
  }
  return root;
}

function countFiles(node: TreeNode): number {
  let n = node.files.length;
  for (const c of node.children.values()) n += countFiles(c);
  return n;
}

/** 子树增删行数聚合（目录行显示总改动量）。 */
function sumLines(node: TreeNode): { add: number; del: number } {
  let add = 0;
  let del = 0;
  for (const f of node.files) {
    add += f.addLines;
    del += f.delLines;
  }
  for (const c of node.children.values()) {
    const s = sumLines(c);
    add += s.add;
    del += s.del;
  }
  return { add, del };
}

function TreeDirRow({ node, depth }: { node: TreeNode; depth: number }) {
  const [open, setOpen] = React.useState(true);
  const total = countFiles(node);
  const selected = node.files.filter((f) => f.defaultSelected).length;
  const { add, del } = sumLines(node);
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
          {open ? (
            <ChevronDown aria-hidden className="h-3 w-3" />
          ) : (
            <ChevronRight aria-hidden className="h-3 w-3" />
          )}
        </button>
        {/* 目录级勾选：勾目录 = 勾该目录下全部文件（递归） */}
        <input
          type="checkbox"
          defaultChecked={selected > 0}
          title={`目录级勾选（${selected}/${total} 已选）`}
          className="h-3 w-3 accent-brand-600"
        />
        <span className="truncate font-mono">{node.name}/</span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {/* 子树增删聚合（与文件行同口径） */}
          <span className="font-mono text-[10px] tabular-nums">
            <span className="text-success">+{add}</span>{" "}
            <span className="text-error">-{del}</span>
          </span>
          <span className="tabular-nums text-[10px] text-muted-foreground/70">
            {selected}/{total}
          </span>
        </span>
      </div>
      {open ? <TreeChildren node={node} depth={depth + 1} /> : null}
    </div>
  );
}

function TreeChildren({ node, depth }: { node: TreeNode; depth: number }) {
  return (
    <div className="border-l border-border/60" style={{ marginLeft: `${depth * 14}px` }}>
      {[...node.children.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => (
          <TreeDirRow key={c.path} node={c} depth={0} />
        ))}
      {node.files.map((f) => (
        <FileRow key={f.path} f={f} />
      ))}
    </div>
  );
}

/* ───────────── 状态分组（顶层三分组，组内目录树——工作区更改同款） ───────────── */

function GroupHeader({
  label,
  count,
  files,
  defaultOpen = true,
}: {
  label: string;
  count: number;
  files: GitFileItem[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const tree = buildTree(files);
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        {open ? (
          <ChevronDown aria-hidden className="h-3 w-3" />
        ) : (
          <ChevronRight aria-hidden className="h-3 w-3" />
        )}
        <span className="font-medium">{label}</span>
        <span className="tabular-nums">({count})</span>
      </button>
      {open ? (
        <div className="ml-3 border-l border-border/60">
          <TreeChildren node={tree} depth={0} />
        </div>
      ) : null}
    </div>
  );
}

/* fixture：典型场景——agent 已 add 两个文件，另有未暂存改动与未跟踪文件 */
const FIXTURE_FILES: GitFileItem[] = [
  { path: "backend/app/modules/daemon/permission_service.py", status: "modified", staged: true, defaultSelected: true, addLines: 38, delLines: 4 },
  { path: "backend/app/modules/daemon/router/notify.py", status: "modified", staged: true, defaultSelected: true, addLines: 12, delLines: 2 },
  { path: "frontend/src/components/git-approval/git-approval-card.tsx", status: "added", staged: false, defaultSelected: false, addLines: 216, delLines: 0 },
  { path: "frontend/src/components/git-approval/__tests__/git-approval-card.test.tsx", status: "added", staged: false, defaultSelected: false, addLines: 88, delLines: 0 },
  { path: "sillyhub-daemon/src/interactive/git-command-guard.ts", status: "modified", staged: false, defaultSelected: false, addLines: 142, delLines: 6 },
  { path: "sillyhub-daemon/src/interactive/git-executor.ts", status: "modified", staged: false, defaultSelected: false, addLines: 95, delLines: 3 },
  { path: "docs/notes.md", status: "untracked", staged: false, defaultSelected: false, addLines: 17, delLines: 0 },
];

/* ───────────── 对话卡外壳（ask-user-dialog-card 同方言） ───────────── */

function DialogShell({
  title,
  subtitle,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-start justify-between gap-2 rounded-t-lg border-b border-brand-200 bg-brand-50/60 px-4 py-2.5">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            {title}
          </p>
          {subtitle ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {/* 最小化胶囊入口（PendingDialogDock 既有行为） */}
        <button
          type="button"
          title="最小化为待决策胶囊"
          className="shrink-0 rounded p-1 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
        >
          <Minimize2 aria-hidden className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

/* 主按钮/次按钮（shadcn button 规格：size sm h-7 text-[11px] 同方言） */
function BtnPrimary({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="h-7 rounded bg-brand-600 px-3 text-[11px] font-medium text-white transition-colors hover:bg-brand-700"
    >
      {children}
    </button>
  );
}
function BtnGhost({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="h-7 rounded border border-border px-3 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

/* ───────────── 态一：commit 确认卡 ───────────── */

function CommitCard() {
  const selectedCount = FIXTURE_FILES.filter((f) => f.defaultSelected).length;
  return (
    <DialogShell
      title={
        <>
          <GitBranch aria-hidden className="h-4 w-4 text-brand-600" />
          Git 提交确认
          <span className="ml-1 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] font-normal text-muted-foreground">
            main
          </span>
        </>
      }
      subtitle="Agent 请求提交代码，请确认提交信息与文件范围后执行"
    >
      {/* 原始命令（等宽，供对照 agent 意图） */}
      <p className="mb-2 truncate rounded border border-border bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground">
        $ git commit -m "feat(daemon): git 提交人工接管——识别与挂起"
      </p>
      {/* commit msg 编辑（预填解析值，用户可改） */}
      <label className="mb-1 block text-xs font-medium text-foreground">
        提交信息（可修改）
      </label>
      <textarea
        defaultValue={'feat(daemon): git 提交人工接管——识别与挂起\n\n- git-command-guard 复合命令拆段识别\n- dialog_kind=git_approval 挂起等待用户确认'}
        rows={4}
        className="mb-3 w-full resize-y rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:border-brand-400 focus:outline-none"
      />
      {/* 文件范围（工作区更改卡同款：顶层状态分组 + 组内目录树 + 四色状态 + 勾选） */}
      <p className="mb-1 text-xs font-medium text-foreground">
        提交文件范围（勾选 {selectedCount} 个）
      </p>
      <div className="mb-3 max-h-56 overflow-y-auto rounded border border-border">
        <GroupHeader
          label="已暂存"
          count={FIXTURE_FILES.filter((f) => f.staged).length}
          files={FIXTURE_FILES.filter((f) => f.staged)}
        />
        <GroupHeader
          label="未暂存改动"
          count={FIXTURE_FILES.filter((f) => !f.staged && f.status !== "untracked").length}
          files={FIXTURE_FILES.filter((f) => !f.staged && f.status !== "untracked")}
        />
        <GroupHeader
          label="未跟踪"
          count={FIXTURE_FILES.filter((f) => f.status === "untracked").length}
          files={FIXTURE_FILES.filter((f) => f.status === "untracked")}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          批准后由平台代为执行提交，结果自动回传给 Agent
        </span>
        <div className="flex shrink-0 gap-2">
          <BtnGhost>拒绝</BtnGhost>
          <BtnPrimary>提交 {selectedCount} 个文件</BtnPrimary>
        </div>
      </div>
    </DialogShell>
  );
}

/* ───────────── 态二：push 确认卡 ───────────── */

/* fixture：待推送提交按条明细（≤20 条，超出显统计行；D-014/D-015——单条可展开文件明细）。 */
interface AheadCommitFile {
  path: string;
  status: FileStatus | "renamed";
  addLines: number;
  delLines: number;
}
const AHEAD_COMMITS: {
  sha: string;
  subject: string;
  author: string;
  date: string;
  files: AheadCommitFile[];
}[] = [
  {
    sha: "a1b2c3d",
    subject: "feat(daemon): git 提交人工接管——识别与挂起",
    author: "qinyi",
    date: "11-06 23:12",
    files: [
      { path: "sillyhub-daemon/src/interactive/git-command-guard.ts", status: "added", addLines: 142, delLines: 0 },
      { path: "sillyhub-daemon/src/interactive/session-manager/permission.ts", status: "modified", addLines: 38, delLines: 4 },
    ],
  },
  {
    sha: "e4f5a6b",
    subject: "test(daemon): git-command-guard 复合命令拆段用例",
    author: "qinyi",
    date: "11-06 23:26",
    files: [
      { path: "sillyhub-daemon/tests/interactive/git-command-guard.test.ts", status: "added", addLines: 96, delLines: 0 },
    ],
  },
  {
    sha: "c7d8e9f",
    subject: "docs(spec): 2026-11-06-session-git-approval 四件套",
    author: "qinyi",
    date: "11-06 23:41",
    files: [
      { path: ".sillyspec/changes/2026-11-06-session-git-approval/design.md", status: "added", addLines: 253, delLines: 0 },
      { path: ".sillyspec/changes/2026-11-06-session-git-approval/decisions.md", status: "added", addLines: 88, delLines: 0 },
    ],
  },
];

/** 展开态文件明细行（与提交确认卡同款展示：状态点 + basename + +/- 统计；纯浏览无勾选）。 */
const RENAMED_META = { label: "重命名", cls: "text-muted-foreground", dotCls: "bg-muted-foreground" };

function CommitFileRows({ files }: { files: AheadCommitFile[] }) {
  return (
    <div className="mt-1 ml-7 flex flex-col rounded border border-border/70 bg-muted/20 px-1.5 py-1">
      {files.map((f) => {
        const meta = f.status === "renamed" ? RENAMED_META : STATUS_META[f.status];
        const name = f.path.split("/").pop() ?? f.path;
        const dir = f.path.split("/").slice(0, -1).join("/");
        return (
          <div key={f.path} className="flex items-center gap-2 rounded px-1 py-0.5 text-[11px] hover:bg-muted/60">
            <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dotCls}`} />
            <span className={`min-w-0 flex-1 truncate font-mono ${meta.cls}`} title={f.path}>
              {dir ? `${dir}/` : ""}
              <span className="text-foreground">{name}</span>
            </span>
            <span className="shrink-0 font-mono text-[10px] tabular-nums">
              <span className="text-success">+{f.addLines}</span>{" "}
              <span className="text-error">-{f.delLines}</span>
            </span>
            <span className={`shrink-0 rounded border border-border px-1 text-[10px] ${meta.cls}`}>
              {meta.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** 单条待推送提交（可展开文件明细，D-015）。 */
function AheadCommitRow({
  c,
  defaultOpen = false,
}: {
  c: (typeof AHEAD_COMMITS)[number];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const totalAdd = c.files.reduce((s, f) => s + f.addLines, 0);
  const totalDel = c.files.reduce((s, f) => s + f.delLines, 0);
  return (
    <div className="rounded px-1 py-1 text-xs hover:bg-muted/60">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-start gap-2 text-left"
      >
        {open ? (
          <ChevronDown aria-hidden className="mt-1 h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight aria-hidden className="mt-1 h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <span className="mt-0.5 shrink-0 rounded border border-border bg-muted/50 px-1 font-mono text-[10px] text-muted-foreground">
          {c.sha}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-foreground" title={c.subject}>
            {c.subject}
          </span>
          <span className="block text-[10px] text-muted-foreground/80">
            {c.author} · {c.date} · {c.files.length} 个文件{" "}
            <span className="text-success">+{totalAdd}</span>{" "}
            <span className="text-error">-{totalDel}</span>
          </span>
        </span>
      </button>
      {open ? <CommitFileRows files={c.files} /> : null}
    </div>
  );
}

function PushCard() {
  return (
    <DialogShell
      title={
        <>
          <GitBranch aria-hidden className="h-4 w-4 text-brand-600" />
          Git 推送确认
        </>
      }
      subtitle="Agent 请求推送代码，请确认目标与提交内容后执行"
    >
      <p className="mb-2 truncate rounded border border-border bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground">
        $ sillyspec push
      </p>
      <div className="mb-3 flex flex-col gap-1.5 rounded border border-border px-3 py-2.5 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">目标仓库</span>
          <span className="font-mono text-foreground">origin</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">目标分支</span>
          <span className="flex items-center gap-1.5 font-mono text-foreground">
            main
            {/* 保护分支警示徽标（D-006：警示不硬拦） */}
            <span className="rounded border border-error/40 bg-error/10 px-1.5 py-0.5 text-[10px] font-medium text-error">
              保护分支 · 推送影响远端主线
            </span>
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">待推送提交</span>
          <span className="tabular-nums text-foreground">
            {AHEAD_COMMITS.length} 个提交（领先远端 {AHEAD_COMMITS.length}）
          </span>
        </div>
      </div>
      {/* 待推送提交按条明细（D-014：sha+首行+作者/日期；D-015：点开单条展开文件明细） */}
      <p className="mb-1 text-xs font-medium text-foreground">将推送的提交</p>
      <div className="mb-3 flex max-h-56 flex-col gap-0.5 overflow-y-auto rounded border border-border px-2 py-1.5">
        {AHEAD_COMMITS.map((c, i) => (
          <AheadCommitRow key={c.sha} c={c} defaultOpen={i === 0} />
        ))}
      </div>
      {/* runner=sillyspec 压扁语义提示（D-013） */}
      <p className="mb-3 rounded border border-brand-200 bg-brand-50/60 px-2.5 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
        该推送经 <code className="font-mono">sillyspec push</code> 发起：确认后将按变更段压扁本地提交再快进推送（压扁语义由平台代执行保留）。
      </p>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          批准后由平台代为执行推送，结果自动回传给 Agent
        </span>
        <div className="flex shrink-0 gap-2">
          <BtnGhost>拒绝</BtnGhost>
          <BtnPrimary>确认推送</BtnPrimary>
        </div>
      </div>
    </DialogShell>
  );
}

/* ───────────── 态三：拒绝原因填写 ───────────── */

function RejectCard() {
  return (
    <DialogShell
      title={
        <>
          <GitBranch aria-hidden className="h-4 w-4 text-brand-600" />
          Git 提交确认
          <span className="ml-1 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] font-normal text-muted-foreground">
            main
          </span>
        </>
      }
      subtitle="拒绝后将把原因反馈给 Agent，它可调整后重新发起"
    >
      <p className="mb-2 truncate rounded border border-border bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground">
        $ git commit -m "feat(daemon): git 提交人工接管——识别与挂起"
      </p>
      <p className="mb-1 text-xs font-medium text-foreground">拒绝原因（将反馈给 Agent）</p>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {["提交信息不符合规范", "文件范围不对", "还有改动没包含", "先不提交"].map((r) => (
          <button
            key={r}
            type="button"
            className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {r}
          </button>
        ))}
      </div>
      <textarea
        placeholder="或自由填写拒绝原因……"
        rows={2}
        className="mb-3 w-full resize-y rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-brand-400 focus:outline-none"
      />
      <div className="flex items-center justify-end gap-2">
        <BtnGhost>返回确认卡</BtnGhost>
        <button
          type="button"
          className="h-7 rounded border border-error/50 bg-error/10 px-3 text-[11px] font-medium text-error transition-colors hover:bg-error/20"
        >
          确认拒绝
        </button>
      </div>
    </DialogShell>
  );
}

/* ───────────── 态说明行 ───────────── */

function StateNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 rounded border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}

const STATES: [string, string][] = [
  ["commit", "提交确认（主形态）"],
  ["push", "推送确认"],
  ["reject", "拒绝原因填写"],
];

const CHROME = "rounded-lg border border-border bg-card px-5 pb-4 pt-3 shadow-sm";

export function GitApprovalView() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <DemoBar />
      <div className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-1 text-lg font-semibold">会话 · Git 提交/推送确认卡</h1>
        <p className="mb-4 text-xs text-muted-foreground">
          2026-11-06-session-git-approval · agent 触发 git commit/push 时拦截挂起，
          会话页弹出 AskUserQuestion 同款对话卡（替换输入栏位置，可最小化）；
          用户二次修改提交信息与文件范围，点「提交/推送」后由平台代执行并回喂
          agent。刷新页面卡片不丢（dialog 落库恢复）。
        </p>

        {/* 状态切换按钮（内嵌 vanilla JS 切换面板） */}
        <div className="mb-4 flex flex-wrap gap-1.5">
          {STATES.map(([k, label]) => (
            <button
              key={k}
              type="button"
              data-state-btn={k}
              className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {label}
            </button>
          ))}
        </div>

        {/* 态一：commit 确认卡（主形态） */}
        <div data-state-panel="commit" className={CHROME}>
          <p className="mb-2 text-[11px] font-medium text-muted-foreground">
            ── 会话输入栏位置（PendingDialogDock 替换输入框，下方为消息流末尾） ──
          </p>
          <CommitCard />
          <StateNote>
            <strong>提交确认（主形态）</strong>：预填 agent 的 commit msg 与提交
            范围（本例 agent 已 <code className="font-mono">git add</code> 两个
            文件→默认勾选暂存区；未暂存/未跟踪按需增选）。文件列表为 git 日志页
            「工作区更改」同款<strong>目录树</strong>（顶层状态三分组：已暂存/
            未暂存改动/未跟踪；组内按路径逐级折叠，文件行只显文件名，父路径由
            层级表达）+ 四色状态徽标 + 行内 checkbox；目录节点支持目录级勾选
            （勾目录 = 勾其下全部文件，右侧显示已选/总数）；点{" "}
            <FileText aria-hidden className="inline h-3 w-3" /> 看单文件 diff
            （复用 WorktreeDiffModal）。
          </StateNote>
        </div>

        {/* 态二：push 确认卡 */}
        <div data-state-panel="push" className={CHROME} style={{ display: "none" }}>
          <p className="mb-2 text-[11px] font-medium text-muted-foreground">
            ── 会话输入栏位置（PendingDialogDock 替换输入框，下方为消息流末尾） ──
          </p>
          <PushCard />
          <StateNote>
            <strong>推送确认</strong>：不涉及 msg 与文件勾选——展示目标 remote/
            分支、<strong>待推送提交按条明细</strong>（每条 sha 徽标 + 提交首行 +
            作者/日期，≤20 条超出显统计，D-014）；经{" "}
            <code className="font-mono">sillyspec push</code> 发起的推送显示压扁
            语义提示（确认后按变更段压扁再推送，D-013）；
            <strong>main/master 显示红色保护分支警示徽标但不硬拦</strong>（D-006：
            用户点击即视为用户授权）。
          </StateNote>
        </div>

        {/* 态三：拒绝原因填写 */}
        <div data-state-panel="reject" className={CHROME} style={{ display: "none" }}>
          <p className="mb-2 text-[11px] font-medium text-muted-foreground">
            ── 会话输入栏位置（PendingDialogDock 替换输入框，下方为消息流末尾） ──
          </p>
          <RejectCard />
          <StateNote>
            <strong>拒绝</strong>：快捷原因 + 自由填写，回喂 agent 后它可修改
            msg/文件范围重新发起（与计划审批 deny.message 同构，D-007）。
          </StateNote>
        </div>
      </div>
    </div>
  );
}

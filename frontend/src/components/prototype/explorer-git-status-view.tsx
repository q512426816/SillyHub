/**
 * prototype-as-code 演示视图 —— 工作区 Git 文件状态（change 2026-10-25-explorer-git-status）。
 *
 * 本次改动涉及的三个界面面，供评审定稿：
 *   ① Git 日志页新增「工作区更改」卡——修改文件集合按目录树展示（IDEA 分组：
 *      更改 / 未纳入版本管理 / 忽略顶层聚合），文件行四色 + 增删行数
 *   ② 文件 diff 弹窗——点击文件行打开「工作区 vs 最近一次提交」红绿对比
 *      （modified/untracked/deleted 三态样例）
 *   ③ explorer「文件」页树着色——文件名按状态变色 + 含改动目录圆点 + 忽略目录灰
 *   ④ 四色图例与口径说明（与现有「文件变更卡」语义差异声明）
 *
 * 真码方言：Tailwind + themes.ts token（零硬编码色）；fixture 假数据；
 * scripts/prototype-build.mjs 编译为独立 HTML。
 * 依据：decisions.md D-001~D-009、frontend/src/components/git-log/file-tree.tsx（树形态先例）。
 */
import * as React from "react";

import { DemoBar } from "./demo-chrome";

/** IDEA 语义状态色（D-002：仅本变更新功能使用；现有文件变更卡不动）。 */
type FileStatus = "added" | "modified" | "deleted" | "untracked" | "ignored";

const STATUS_META: Record<
  FileStatus,
  { label: string; text: string; badge: string; dot: string }
> = {
  added: {
    label: "新增",
    text: "text-success",
    badge: "border-success/30 bg-success/10 text-success",
    dot: "bg-success",
  },
  modified: {
    label: "修改",
    text: "text-primary",
    badge: "border-primary/30 bg-primary/10 text-primary",
    dot: "bg-primary",
  },
  deleted: {
    label: "删除",
    text: "text-error line-through",
    badge: "border-error/30 bg-error/10 text-error",
    dot: "bg-error",
  },
  untracked: {
    label: "新文件",
    text: "text-success",
    badge: "border-success/30 bg-success/10 text-success",
    dot: "bg-success",
  },
  ignored: {
    label: "忽略",
    text: "text-muted-foreground/60",
    badge: "border-border bg-muted/50 text-muted-foreground",
    dot: "bg-muted-foreground/40",
  },
};

function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** 文件行：状态色文件名 + 可选增删行数（点击行为原型中仅视觉标注）。 */
function FileRow({
  name,
  status,
  added,
  deleted: delCount,
  hint,
}: {
  name: string;
  status: FileStatus;
  added?: number;
  deleted?: number;
  hint?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <div
      className="flex items-center gap-2 rounded px-3 py-1 hover:bg-muted/60"
      title={hint}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`}
        aria-hidden
      />
      <span className={`truncate font-mono text-[13px] ${meta.text}`}>{name}</span>
      {hint ? (
        <span className="shrink-0 text-[10px] text-muted-foreground/70">{hint}</span>
      ) : null}
      <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-[11px]">
        {added ? <span className="text-success">+{added}</span> : null}
        {delCount ? <span className="text-error">−{delCount}</span> : null}
        <span
          className={`rounded border px-1 text-[10px] leading-4 ${meta.badge}`}
        >
          {meta.label}
        </span>
      </span>
    </div>
  );
}

/** 目录行：目录名 + 汇总（含改动 → 蓝点提示）。 */
function DirRow({ name, count, dirty }: { name: string; count: number; dirty?: boolean }) {
  return (
    <div className="flex items-center gap-2 px-3 py-0.5">
      <span className="text-muted-foreground">▾</span>
      {dirty ? <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden /> : null}
      <span className="text-[13px]">{name}</span>
      <span className="ml-auto text-[11px] text-muted-foreground">{count} 个文件</span>
    </div>
  );
}

/** ① Git 日志页「工作区更改」卡（挂状态条之下、提交列表之上）。 */
function WorktreeChangesCard() {
  return (
    <div
      className="overflow-hidden rounded-lg border shadow-sm"
      style={{ borderColor: "hsl(var(--border))" }}
    >
      {/* 卡头：标题 + 汇总计数 + 刷新（折叠态收起后只留这一行） */}
      <div
        className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5"
        style={{ borderColor: "hsl(var(--border))" }}
      >
        <span className="text-sm font-semibold">工作区更改</span>
        <span className="rounded border border-primary/30 bg-primary/10 px-1.5 text-[11px] text-primary">
          4 处修改
        </span>
        <span className="rounded border border-error/30 bg-error/10 px-1.5 text-[11px] text-error">
          1 删除
        </span>
        <span className="rounded border border-success/30 bg-success/10 px-1.5 text-[11px] text-success">
          3 新文件
        </span>
        <span className="rounded border px-1.5 text-[11px] text-muted-foreground" style={{ borderColor: "hsl(var(--border))" }}>
          忽略 3 项（聚合）
        </span>
        <span className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
          快照 19:52:11
          <button
            type="button"
            className="h-7 rounded-md border px-2 transition-colors hover:bg-muted"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            刷新
          </button>
          <span className="text-muted-foreground/60">▾ 收起</span>
        </span>
      </div>

      {/* 更改组：已跟踪文件 vs 最近一次提交 */}
      <div className="px-2 py-2">
        <div className="flex items-center gap-2 px-1 py-1 text-xs font-medium text-muted-foreground">
          <span>▾</span> 更改（对比基线：最近一次提交 a9f5fae15）
        </div>
        <div className="ml-4">
          <DirRow name="frontend/src/components/explorer" count={2} dirty />
          <div className="ml-6">
            <FileRow
              name="file-explorer.tsx"
              status="modified"
              added={42}
              deleted={7}
              hint="点击行 → 打开下方 diff 弹窗"
            />
            <FileRow name="file-preview.tsx" status="modified" added={18} deleted={3} />
          </div>
          <DirRow name="backend/app/modules/git_log" count={2} dirty />
          <div className="ml-6">
            <FileRow name="router.py" status="modified" added={56} />
            <FileRow name="schema.py" status="modified" added={31} deleted={2} />
          </div>
          <FileRow name="frontend/src/lib/legacy-search.ts" status="deleted" deleted={88} />
        </div>

        {/* 未纳入版本管理组（IDEA「未进行版本管理的文件」，D-004：untracked 全文新增） */}
        <div className="mt-2 flex items-center gap-2 px-1 py-1 text-xs font-medium text-muted-foreground">
          <span>▾</span> 未纳入版本管理
        </div>
        <div className="ml-4">
          <DirRow name="frontend/src/components/git-log" count={1} dirty />
          <div className="ml-6">
            <FileRow name="worktree-changes-card.tsx" status="untracked" added={214} />
          </div>
          <FileRow
            name=".sillyspec/changes/2026-10-25-explorer-git-status/design.md"
            status="untracked"
            added={186}
          />
        </div>

        {/* 忽略组：顶层聚合一行式（D-003：不递归展开） */}
        <div className="mt-2 flex items-center gap-2 px-1 py-1 text-xs font-medium text-muted-foreground">
          <span>▸</span> 已忽略（目录按整体折叠，不逐个列出）
        </div>
        <div className="ml-4">
          <FileRow name="node_modules/" status="ignored" hint="忽略目录 · 树上仍可展开浏览" />
        </div>
      </div>
    </div>
  );
}

/** diff 行（对齐 git-log/file-tree DiffBody 语义：+绿/-红/@@ muted/上下文默认）。 */
function DiffBody({
  rows,
}: {
  rows: { kind: "hunk" | "ctx" | "add" | "del"; old?: number; new?: number; text: string }[];
}) {
  return (
    <div
      className="overflow-x-auto rounded-md border font-mono text-[11.5px] leading-5"
      style={{ borderColor: "hsl(var(--border))" }}
    >
      {rows.map((r, i) => {
        const cls =
          r.kind === "add"
            ? "bg-success/10 text-success"
            : r.kind === "del"
              ? "bg-error/10 text-error"
              : r.kind === "hunk"
                ? "bg-muted/50 text-muted-foreground"
                : "";
        return (
          <div key={i} className={`flex ${cls}`}>
            <span className="w-10 shrink-0 select-none pr-1 text-right text-muted-foreground/60">
              {r.old ?? ""}
            </span>
            <span className="w-10 shrink-0 select-none pr-2 text-right text-muted-foreground/60">
              {r.new ?? ""}
            </span>
            <span className="whitespace-pre pr-3">{r.text}</span>
          </div>
        );
      })}
    </div>
  );
}

/** ② 文件 diff 弹窗（点修改集合文件行后打开）：三态样例并排。 */
function DiffDialogSamples() {
  return (
    <div className="flex flex-col gap-4">
      {/* modified：工作区 vs HEAD 红绿对比 */}
      <div
        className="overflow-hidden rounded-lg border shadow-sm"
        style={{ borderColor: "hsl(var(--border))" }}
      >
        <div
          className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <span className="rounded border border-primary/30 bg-primary/10 px-1 text-[10px] leading-4 text-primary">
            修改
          </span>
          <code className="font-mono text-[13px]">
            frontend/src/components/explorer/file-explorer.tsx
          </code>
          <span className="ml-auto text-[11px] text-muted-foreground">
            对比基线：最近一次提交 a9f5fae15 · +42 −7
          </span>
          <button
            type="button"
            className="h-7 rounded-md border px-2 text-xs text-muted-foreground transition-colors hover:bg-muted"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            关闭
          </button>
        </div>
        <div className="p-3">
          <DiffBody
            rows={[
              { kind: "hunk", old: 482, new: 482, text: "@@ -482,6 +482,9 @@ export function FileExplorer(" },
              { kind: "ctx", old: 482, new: 482, text: "  const renderTitle = (node: ExplorerNode) => (" },
              { kind: "del", old: 483, new: undefined, text: "-   return <span className=\"text-foreground\">{node.name}</span>;" },
              { kind: "add", old: undefined, new: 483, text: "+   const gitCls = statusMap.current.get(node.path)?.textCls ?? \"text-foreground\";" },
              { kind: "add", old: undefined, new: 484, text: "+   return <span className={gitCls}>{node.name}</span>;" },
              { kind: "ctx", old: 484, new: 485, text: "  };" },
            ]}
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* untracked：无基线 → 整文件视为新增（D-004） */}
        <div
          className="overflow-hidden rounded-lg border shadow-sm"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <div
            className="flex items-center gap-2 border-b px-4 py-2.5"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            <span className="rounded border border-success/30 bg-success/10 px-1 text-[10px] leading-4 text-success">
              新文件
            </span>
            <code className="font-mono text-[13px]">worktree-changes-card.tsx</code>
          </div>
          <div className="p-3">
            <p className="mb-2 text-[11px] text-muted-foreground">
              新文件：最近一次提交中不存在，整体视为新增（全绿）。
            </p>
            <DiffBody
              rows={[
                { kind: "add", new: 1, text: "+ export function WorktreeChangesCard() {" },
                { kind: "add", new: 2, text: "+   // 修改文件集合树（fixture 略）" },
                { kind: "add", new: 3, text: "+ }" },
              ]}
            />
          </div>
        </div>
        {/* deleted：工作区已不存在 → 整文件视为删除（D-004） */}
        <div
          className="overflow-hidden rounded-lg border shadow-sm"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <div
            className="flex items-center gap-2 border-b px-4 py-2.5"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            <span className="rounded border border-error/30 bg-error/10 px-1 text-[10px] leading-4 text-error">
              删除
            </span>
            <code className="font-mono text-[13px] line-through">legacy-search.ts</code>
          </div>
          <div className="p-3">
            <p className="mb-2 text-[11px] text-muted-foreground">
              已删除：文件在工作区已不存在，整体视为删除（全红）。
            </p>
            <DiffBody
              rows={[
                { kind: "del", old: 1, text: "- export function legacySearch(q: string) {" },
                { kind: "del", old: 2, text: "-   // 旧搜索实现（fixture 略）" },
                { kind: "del", old: 3, text: "- }" },
              ]}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** ③ explorer「文件」页树着色样例（点击行为不变，仍为内容预览——D-005）。 */
function ExplorerTreeSample() {
  return (
    <div
      className="rounded-lg border p-3 font-mono text-[13px] shadow-sm"
      style={{ borderColor: "hsl(var(--border))" }}
    >
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">▾</span>
        <span className="text-[13px]">frontend/src/components</span>
        <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
      </div>
      <div className="ml-5 flex flex-col">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">▾</span>
          <span className="text-[13px]">explorer</span>
          <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
        </div>
        <div className="ml-5 flex flex-col">
          <span className="text-primary">file-explorer.tsx</span>
          <span>file-preview.tsx</span>
          <span className="text-muted-foreground/60">
            legacy-search.ts（忽略示例位）
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">▸</span>
          <span className="text-muted-foreground/60">node_modules</span>
          <span className="rounded border px-1 text-[10px] text-muted-foreground" style={{ borderColor: "hsl(var(--border))" }}>
            忽略
          </span>
        </div>
        <span className="text-success">file-search.tsx（新增示例位）</span>
      </div>
      <p className="mt-3 font-sans text-[11px] text-muted-foreground">
        点击行为不变：树上点击文件仍打开右侧内容预览（D-005）；着色仅提示状态。
      </p>
    </div>
  );
}

export function ExplorerGitStatusView() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <DemoBar />
      <main className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-xl font-semibold">
          工作区 Git 文件状态 · 原型（2026-10-25-explorer-git-status）
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          覆盖：Git 日志页「工作区更改」卡、文件 diff 弹窗三态、explorer 树着色、四色图例。数据为
          fixture；数据源为方案 A 平行状态接口（一次拉取，着色与修改集合同源）。
        </p>

        <Section
          title="① Git 日志页 · 工作区更改卡（主形态）"
          desc="挂在状态条之下、提交列表之上；IDEA 分组：更改 / 未纳入版本管理 / 已忽略（顶层聚合）。文件名四色，行尾增删行数与状态徽标；点击文件行打开 ② 的 diff 弹窗。"
        >
          <WorktreeChangesCard />
        </Section>

        <Section
          title="② 文件 diff 弹窗（点击文件行后）"
          desc="标题带状态徽标与对比基线说明；modified 为红绿对比，untracked 整文件全绿、deleted 整文件全红（D-004 口径）。"
        >
          <DiffDialogSamples />
        </Section>

        <Section
          title="③ explorer「文件」页树着色"
          desc="文件名按状态变色；含改动的目录名旁蓝点；忽略目录整体灰 +「忽略」徽标（不递归，D-003）。"
        >
          <ExplorerTreeSample />
        </Section>

        <Section title="④ 四色图例与口径" desc="IDEA 语义（D-002）：仅本变更新功能使用。">
          <div className="flex flex-wrap gap-3 text-xs">
            {(["added", "modified", "deleted", "untracked", "ignored"] as FileStatus[]).map(
              (s) => (
                <span
                  key={s}
                  className={`rounded border px-2 py-1 ${STATUS_META[s].badge}`}
                >
                  {STATUS_META[s].label}
                </span>
              ),
            )}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            新增/新文件=绿 · 修改=蓝 · 删除=红（删除线）· 忽略=灰。现有会话「文件变更卡」颜色不在本变更范围（D-002）；
            状态为拉取式快照，手动刷新或重新进页更新（D-007）。
          </p>
        </Section>
      </main>
    </div>
  );
}

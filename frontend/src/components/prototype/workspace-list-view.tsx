/**
 * prototype-as-code 演示视图 —— 工作区列表（GitHub Repositories 行式）。
 * 真实 primer 组件 + Tailwind + token，fixture 数据；build.mjs 编译为独立 HTML。
 */
import * as React from "react";

import { Counter, IssueRow, IssueRowHeader, PageHead, StateLabel } from "../primer";
import { DemoBar } from "./demo-chrome";

interface WorkspaceFixture {
  state: "open" | "neutral";
  name: string;
  visibility: "私有" | "组织";
  path: string;
  stack: string[];
  guard: "运行中" | "已停用";
  activeChanges: number;
  scanned: string;
}

const WORKSPACES: WorkspaceFixture[] = [
  {
    state: "open",
    name: "multi-agent-platform",
    visibility: "私有",
    path: "C:/Users/qinyi/IdeaProjects/multi-agent-platform",
    stack: ["Next.js", "Node", "Python"],
    guard: "运行中",
    activeChanges: 3,
    scanned: "3 分钟前",
  },
  {
    state: "open",
    name: "sillyspec",
    visibility: "私有",
    path: "C:/Users/qinyi/IdeaProjects/sillyspec",
    stack: ["Node", "CLI"],
    guard: "运行中",
    activeChanges: 2,
    scanned: "8 分钟前",
  },
  {
    state: "open",
    name: "happy",
    visibility: "组织",
    path: "C:/Users/qinyi/IdeaProjects/happy",
    stack: ["React", "Rust"],
    guard: "运行中",
    activeChanges: 0,
    scanned: "26 分钟前",
  },
  {
    state: "neutral",
    name: "prompts-r14",
    visibility: "私有",
    path: "C:/Users/qinyi/IdeaProjects/prompts-r14",
    stack: ["Markdown"],
    guard: "已停用",
    activeChanges: 0,
    scanned: "5 天前",
  },
  {
    state: "neutral",
    name: "cc-switch",
    visibility: "私有",
    path: "C:/Users/qinyi/IdeaProjects/cc-switch",
    stack: ["Go"],
    guard: "已停用",
    activeChanges: 0,
    scanned: "2 周前",
  },
];

function TechPill({ tech }: { tech: string }) {
  return (
    <span
      className="rounded-full border px-1.5 font-mono text-xs leading-4 text-muted-foreground"
      style={{ borderColor: "hsl(var(--border))" }}
    >
      {tech}
    </span>
  );
}

export function WorkspaceListView() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <DemoBar />
      <main className="mx-auto max-w-4xl px-6 py-8">
        <PageHead
          breadcrumb={
            <span className="flex items-center gap-1.5">
              <span>SillyHub</span>
              <span className="text-muted-foreground/60">/</span>
              <span className="text-foreground">工作区</span>
            </span>
          }
          title="工作区"
          titleExtra={<Counter count={WORKSPACES.length} />}
          subtitle="文档驱动开发的工作区 · 拖拽行可排序 · 删除需二次确认"
          actions={
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              新建工作区
            </button>
          }
        />

        {/* 工具条 */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <input
            placeholder="搜索工作区名 / 路径…"
            className="h-8 w-64 rounded-md border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground"
            style={{ borderColor: "hsl(var(--input))" }}
          />
          <button
            type="button"
            className="h-8 rounded-md border px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            同步全部
          </button>
        </div>

        {/* 行式列表（Repositories 式） */}
        <div
          className="mt-4 overflow-hidden rounded-lg border bg-card"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <IssueRowHeader
            title={<span className="font-medium">名称</span>}
            right={
              <span className="text-xs font-normal text-muted-foreground">
                技术栈 · 守护 · 活跃变更 · 扫描
              </span>
            }
          />
          <div className="divide-y" style={{ borderColor: "hsl(var(--border))" }}>
            {WORKSPACES.map((w) => (
              <div key={w.name} data-cat="ws">
                <IssueRow
                  state={w.state}
                  title={
                    <>
                      <a
                        href="#"
                        className="text-sm font-semibold leading-5 text-primary hover:underline"
                      >
                        {w.name}
                      </a>
                      <StateLabel variant="neutral" withIcon={false}>
                        {w.visibility}
                      </StateLabel>
                    </>
                  }
                  meta={
                    <>
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {w.path}
                      </span>
                      {w.stack.map((t) => (
                        <TechPill key={t} tech={t} />
                      ))}
                    </>
                  }
                  right={
                    <>
                      <StateLabel variant={w.guard === "运行中" ? "done" : "neutral"} withIcon={false}>
                        {w.guard}
                      </StateLabel>
                      <Counter count={w.activeChanges} />
                      <span className="text-xs text-muted-foreground">{w.scanned}</span>
                    </>
                  }
                />
              </div>
            ))}
          </div>
          {/* 脚注 + 规范分页 */}
          <div
            className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            <span>显示 {WORKSPACES.length} / {WORKSPACES.length} 个工作区</span>
            <span className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-md border px-2 py-0.5 transition-colors hover:bg-muted disabled:opacity-40"
                style={{ borderColor: "hsl(var(--border))" }}
                disabled
              >
                上一页
              </button>
              <span className="font-mono">1 / 1</span>
              <button
                type="button"
                className="rounded-md border px-2 py-0.5 transition-colors hover:bg-muted disabled:opacity-40"
                style={{ borderColor: "hsl(var(--border))" }}
                disabled
              >
                下一页
              </button>
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * prototype-as-code 演示视图 —— 工作区概览（GitHub Repo 首页式）。
 * 真实 primer 组件（StatGrid/StateLabel/MetaPanel/Counter）+ token；
 * fixture 数据；scripts/prototype-build.mjs 编译为独立 HTML。
 */
import * as React from "react";

import {
  Counter,
  MetaPanel,
  MetaPanelSection,
  StatGrid,
  StateLabel,
} from "../primer";
import { DemoBar } from "./demo-chrome";

const ACTIVE_CHANGES = [
  { title: "观测事件通道 v3 · 重构", key: "2026-09-25-observation-events-v3-r16sf", stage: "执行 · 6/13", time: "5 分钟前" },
  { title: "探测并发 RPC", key: "2026-09-26-probe-concurrent-rpc", stage: "代码扫描", time: "11 分钟前" },
  { title: "核心页面视觉对齐 · 二期", key: "2026-09-27-visual-align-2", stage: "等待输入", time: "32 分钟前" },
];

export function WorkspaceOverviewView() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <DemoBar />
      <main className="mx-auto max-w-5xl px-6 py-8">
        {/* Repo 式页头：方块头像 + 名称 + 可见性胶囊 */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-6" style={{ borderColor: "hsl(var(--border))" }}>
          <div className="flex items-center gap-3">
            <span
              className="flex h-12 w-12 items-center justify-center rounded-xl text-xl font-bold"
              style={{
                backgroundColor: "var(--color-brand-50)",
                color: "var(--color-brand-600)",
              }}
            >
              M
            </span>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-semibold leading-7">multi-agent-platform</h1>
                <StateLabel variant="neutral">私有</StateLabel>
              </div>
              <div className="text-xs text-muted-foreground">
                多 Agent 平台 · Next.js + Node + Python · 62 个已归档变更
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="h-8 rounded-md border px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
              style={{ borderColor: "hsl(var(--border))" }}
            >
              设置
            </button>
            <button
              type="button"
              className="h-8 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              新建变更
            </button>
          </div>
        </div>

        {/* 守护横幅（success soft） */}
        <div
          className="mt-6 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-2.5 text-sm"
          style={{
            borderColor: "hsl(var(--success))",
            backgroundColor: "var(--semantic-success-soft)",
            color: "hsl(var(--success))",
          }}
        >
          <span className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: "hsl(var(--success))" }} />
            守护运行中 · 最后心跳 2 分钟前 · 队列 0
          </span>
          <span className="text-xs opacity-80"> watcher: sillyspec flow / spec-sync </span>
        </div>

        {/* 统计四格（Insights 式） */}
        <div className="mt-6">
          <StatGrid
            items={[
              { label: "活跃变更", value: "3", tone: "brand" },
              { label: "本周 token 消耗", value: "12.4M" },
              { label: "成员", value: "2" },
              { label: "已归档变更", value: "62" },
            ]}
          />
        </div>

        {/* 两栏：左活跃变更 / 右 340px Agent 状态 + About */}
        <div className="mt-6 flex gap-6">
          <section className="min-w-0 flex-1">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                活跃变更
                <Counter count={ACTIVE_CHANGES.length} />
              </h2>
              <a href="#" className="text-xs text-primary hover:underline">
                查看全部 →
              </a>
            </div>
            <div
              className="overflow-hidden rounded-lg border bg-card"
              style={{ borderColor: "hsl(var(--border))" }}
            >
              <div className="divide-y" style={{ borderColor: "hsl(var(--border))" }}>
                {ACTIVE_CHANGES.map((c) => (
                  <div
                    key={c.key}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 transition-colors hover:bg-muted/60"
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <a href="#" className="truncate text-sm font-medium text-primary hover:underline">
                        {c.title}
                      </a>
                      <span className="truncate font-mono text-xs text-muted-foreground">{c.key}</span>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-3 text-xs text-muted-foreground">
                      <StateLabel variant="open" withIcon={false}>
                        {c.stage}
                      </StateLabel>
                      <span>{c.time}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <aside className="flex w-[340px] flex-shrink-0 flex-col gap-4">
            <MetaPanel>
              <MetaPanelSection title="Agent 状态">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2">
                    <span
                      className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold"
                      style={{ backgroundColor: "var(--color-brand-50)", color: "var(--color-brand-600)" }}
                    >
                      Q
                    </span>
                    qinyi · 主控
                  </span>
                  <StateLabel variant="done" withIcon={false}>
                    空闲
                  </StateLabel>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2">
                    <span
                      className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold text-muted-foreground"
                      style={{ backgroundColor: "hsl(var(--muted))" }}
                    >
                      S
                    </span>
                    scan-runner · 扫描
                  </span>
                  <StateLabel variant="open" withIcon={false}>
                    运行中
                  </StateLabel>
                </div>
              </MetaPanelSection>
            </MetaPanel>

            <MetaPanel>
              <MetaPanelSection title="About">
                <div className="flex flex-col gap-1.5 text-xs">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">本地路径</span>
                    <span className="truncate font-mono">C:/…/multi-agent-platform</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">技术栈</span>
                    <span>Next.js · Node · Python</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">创建</span>
                    <span>2026-08-14</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">平台同步</span>
                    <span className="text-right">已同步 · 3 分钟前</span>
                  </div>
                </div>
              </MetaPanelSection>
            </MetaPanel>
          </aside>
        </div>
      </main>
    </div>
  );
}

/**
 * prototype-as-code 演示视图 —— 变更中心列表（GitHub Primer 式）。
 *
 * 这是「原型即实现」的试点：本文件用与生产页面完全相同的方言书写——
 * 真实 primer 组件（@/components/primer 同目录引用）+ Tailwind 工具类
 * + themes.ts 三主题 CSS 变量 token，唯一差别是数据为 fixture。
 * prototype-demo/build.mjs 将本视图编译为可双击打开的独立 HTML。
 *
 * 对照基准：.sillyspec/changes/2026-09-26-core-pages-visual-redesign/
 * prototype-github-redesign.html「变更中心」视图。
 */
import * as React from "react";

import {
  Counter,
  IssueRow,
  IssueRowHeader,
  PageHead,
  StateLabel,
  UnderlineNav,
} from "../primer";
import { DemoBar } from "./demo-chrome";

/* ------------------------------------------------------------------ */
/* fixture 数据（口径对齐真实 ChangeSummary 使用的字段子集）            */
/* ------------------------------------------------------------------ */

type RowCat = "active" | "pending" | "archived";

interface ChangeFixture {
  cat: RowCat;
  state: "open" | "merged" | "attention" | "error";
  /** attention 时区分：zap=轻量出身 / clock=等待输入 */
  attentionIcon?: "zap" | "clock";
  title: string;
  changeKey: string;
  comps: string[];
  stage: string;
  owner: string;
  cost: string;
  time: string;
}

const FIXTURES: ChangeFixture[] = [
  {
    cat: "active",
    state: "open",
    title: "观测事件通道 v3 · 重构",
    changeKey: "2026-09-25-observation-events-v3-r16sf",
    comps: ["backend", "frontend"],
    stage: "实现计划",
    owner: "qinyi",
    cost: "2.4M tok · 18 次",
    time: "5 分钟前",
  },
  {
    cat: "active",
    state: "open",
    title: "探测并发 RPC",
    changeKey: "2026-09-26-probe-concurrent-rpc",
    comps: ["backend"],
    stage: "代码扫描",
    owner: "qinyi",
    cost: "380K tok · 4 次",
    time: "11 分钟前",
  },
  {
    cat: "active",
    state: "error",
    title: "观测事件通道 v3 · 首轮修复",
    changeKey: "2026-09-25-observation-events-v3",
    comps: ["backend"],
    stage: "阻塞",
    owner: "qinyi",
    cost: "1.1M tok · 9 次",
    time: "2 小时前",
  },
  {
    cat: "pending",
    state: "attention",
    attentionIcon: "clock",
    title: "核心页面视觉对齐 · 二期",
    changeKey: "2026-09-27-visual-align-2",
    comps: ["frontend"],
    stage: "等待输入",
    owner: "qinyi",
    cost: "62K tok · 1 次",
    time: "32 分钟前",
  },
  {
    cat: "pending",
    state: "attention",
    attentionIcon: "zap",
    title: "依赖升级 pnpm@9",
    changeKey: "2026-09-27-pnpm-9",
    comps: ["tooling"],
    stage: "轻量变更",
    owner: "qinyi",
    cost: "8K tok · 1 次",
    time: "1 小时前",
  },
  {
    cat: "archived",
    state: "merged",
    title: "watcher 时间线 P2",
    changeKey: "2026-09-26-watcher-timeline-p2",
    comps: ["frontend"],
    stage: "已归档",
    owner: "qinyi",
    cost: "410K tok · 3 次",
    time: "昨天",
  },
  {
    cat: "archived",
    state: "merged",
    title: "thin 检查节奏治理",
    changeKey: "2026-09-26-thin-check-cadence",
    comps: ["cli"],
    stage: "已归档",
    owner: "qinyi",
    cost: "96K tok · 2 次",
    time: "昨天",
  },
  {
    cat: "archived",
    state: "merged",
    title: "动态测试推断",
    changeKey: "2026-09-26-dynamic-test-inference",
    comps: ["cli", "backend"],
    stage: "已归档",
    owner: "qinyi",
    cost: "1.8M tok · 12 次",
    time: "2 天前",
  },
  {
    cat: "archived",
    state: "merged",
    title: "完整流程治理自动化",
    changeKey: "2026-09-26-full-autopilot-parity",
    comps: ["cli"],
    stage: "已归档",
    owner: "qinyi",
    cost: "2.2M tok · 15 次",
    time: "3 天前",
  },
];

/* ------------------------------------------------------------------ */
/* 视图                                                                */
/* ------------------------------------------------------------------ */

function OwnerAvatar({ owner }: { owner: string }) {
  return (
    <span
      title={`负责人 ${owner}`}
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
      style={{
        backgroundColor: "var(--color-brand-50)",
        color: "var(--color-brand-600)",
      }}
    >
      {owner.slice(0, 1).toUpperCase()}
    </span>
  );
}

function CompPill({ comp }: { comp: string }) {
  return (
    <span
      className="rounded-full border px-1.5 font-mono text-xs leading-4 text-muted-foreground"
      style={{ borderColor: "hsl(var(--border))" }}
    >
      {comp}
    </span>
  );
}

/** 演示条见 demo-chrome.tsx（五视图共用）。 */

export function ChangeCenterView() {
  const count = (cat: RowCat) => FIXTURES.filter((f) => f.cat === cat).length;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <DemoBar />
      <main className="mx-auto max-w-4xl px-6 py-8">
        <PageHead
          breadcrumb={
            <span className="flex items-center gap-1.5">
              <span>SillyHub</span>
              <span className="text-muted-foreground/60">/</span>
              <span>multi-agent-platform</span>
              <span className="text-muted-foreground/60">/</span>
              <span className="text-foreground">变更</span>
            </span>
          }
          title="变更中心"
          titleExtra={<Counter count={FIXTURES.length} />}
          subtitle={`文档驱动开发 · ${count("active")} 个进行中 · ${count("pending")} 个待办 · ${count("archived")} 个已归档`}
          actions={
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              新建变更
            </button>
          }
        />

        {/* 工具条 */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <input
              placeholder="搜索变更名 / key…"
              className="h-8 w-64 rounded-md border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2"
              style={{ borderColor: "hsl(var(--input))" }}
            />
            <span className="text-xs text-muted-foreground">
              平台同步正常 · 上次 3 分钟前
            </span>
          </div>
          <button
            type="button"
            className="h-8 rounded-md border px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            导出
          </button>
        </div>

        {/* 状态 tab（静态渲染取 all 态；产物内嵌脚本负责切换过滤） */}
        <div className="mt-4">
          <UnderlineNav
            value="all"
            onChange={() => {}}
            items={[
              { key: "all", label: "全部", counter: FIXTURES.length },
              { key: "active", label: "进行中", counter: count("active") },
              { key: "pending", label: "待办", counter: count("pending") },
              { key: "archived", label: "已归档", counter: count("archived") },
            ]}
          />
        </div>

        {/* 行式列表 */}
        <div
          className="mt-3 overflow-hidden rounded-lg border bg-card"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <IssueRowHeader
            title={<span className="font-medium">标题</span>}
            right={
              <span className="text-xs font-normal text-muted-foreground">
                阶段 · 负责人 · 消耗 · 更新
              </span>
            }
          />
          <div className="divide-y" style={{ borderColor: "hsl(var(--border))" }}>
            {FIXTURES.map((f) => (
              <div key={f.changeKey} data-cat={f.cat}>
                <IssueRow
                  state={f.state}
                  title={
                    <>
                      <a
                        href="#"
                        className="text-sm font-semibold leading-5 text-primary hover:underline"
                      >
                        {f.title}
                      </a>
                      <StateLabel
                        variant={f.state}
                        iconName={f.attentionIcon}
                        withIcon={false}
                      >
                        {f.stage}
                      </StateLabel>
                    </>
                  }
                  meta={
                    <>
                      <span className="font-mono text-xs text-muted-foreground">
                        {f.changeKey}
                      </span>
                      {f.comps.map((c) => (
                        <CompPill key={c} comp={c} />
                      ))}
                    </>
                  }
                  right={
                    <>
                      <OwnerAvatar owner={f.owner} />
                      <span className="font-mono text-xs text-muted-foreground">
                        {f.cost}
                      </span>
                      <span className="text-xs text-muted-foreground">{f.time}</span>
                    </>
                  }
                />
              </div>
            ))}
          </div>
          <div
            className="border-t px-4 py-2 text-right text-xs text-muted-foreground"
            style={{ borderColor: "hsl(var(--border))" }}
            id="showing"
          >
            显示 {FIXTURES.length} / {FIXTURES.length} 个变更
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * prototype-as-code 演示视图 —— 变更详情（GitHub PR 式）。
 * 真实 primer 组件（PageHead/StateLabel/Timeline/MetaPanel/StateIcon）+
 * Tailwind + themes.ts token，fixture 数据；build.mjs 编译为独立 HTML。
 */
import * as React from "react";

import {
  MetaPanel,
  MetaPanelSection,
  PageHead,
  StateIcon,
  StateLabel,
  Timeline,
  TimelineItem,
} from "../primer";
import { DemoBar } from "./demo-chrome";

const STAGES = [
  { name: "头脑风暴", state: "done" },
  { name: "方案设计", state: "done" },
  { name: "执行", state: "current" },
  { name: "验证", state: "pending" },
  { name: "归档", state: "pending" },
] as const;

function ChecksBar() {
  return (
    <div
      className="mt-6 flex items-center gap-1 overflow-x-auto rounded-lg border px-3 py-2.5"
      style={{ borderColor: "hsl(var(--border))", backgroundColor: "hsl(var(--card))" }}
    >
      {STAGES.map((s, i) => {
        const color =
          s.state === "done"
            ? "hsl(var(--success))"
            : s.state === "current"
              ? "var(--color-brand-600)"
              : "hsl(var(--muted-foreground))";
        return (
          <React.Fragment key={s.name}>
            {i > 0 && (
              <span
                className="mx-1 h-px w-6 flex-shrink-0"
                style={{ backgroundColor: "hsl(var(--border))" }}
              />
            )}
            <span
              className="flex flex-shrink-0 items-center gap-1.5 text-sm"
              style={{ color }}
            >
              <StateIcon
                name={s.state === "done" ? "check" : s.state === "current" ? "openCircle" : "clock"}
                size={14}
              />
              <span className={s.state === "current" ? "font-semibold" : ""}>{s.name}</span>
              {s.state === "current" && <span className="text-xs text-muted-foreground">6/13</span>}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function MetaRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{k}</span>
      <span className="min-w-0 truncate text-right">{v}</span>
    </div>
  );
}

export function ChangeDetailView() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <DemoBar />
      <main className="mx-auto max-w-5xl px-6 py-8">
        <PageHead
          breadcrumb={
            <span className="flex items-center gap-1.5">
              <span>SillyHub</span>
              <span className="text-muted-foreground/60">/</span>
              <span>multi-agent-platform</span>
              <span className="text-muted-foreground/60">/</span>
              <span>变更</span>
              <span className="text-muted-foreground/60">/</span>
              <span className="text-foreground">观测事件通道 v3</span>
            </span>
          }
          title="观测事件通道 v3 · 重构"
          titleExtra={
            <StateLabel variant="open" size="md">
              进行中
            </StateLabel>
          }
          subtitle={
            <span className="font-mono">2026-09-25-observation-events-v3-r16sf · 创建于 09-25 14:02</span>
          }
          actions={
            <>
              <button
                type="button"
                className="h-8 rounded-md border px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
                style={{ borderColor: "hsl(var(--border))" }}
              >
                归档
              </button>
              <button
                type="button"
                className="h-8 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                继续执行
              </button>
            </>
          }
        />
        <ChecksBar />

        {/* 主区：时间线主线 + MetaPanel 右栏 */}
        <div className="mt-6 flex gap-6">
          <section className="min-w-0 flex-1">
            <h2 className="mb-4 text-sm font-semibold text-muted-foreground">活动时间线</h2>
            <Timeline>
              <TimelineItem
                icon={<StateIcon name="check" size={14} />}
                tone="success"
                title="头脑风暴完成"
                time="09-25 14:02"
              />
              <TimelineItem
                icon={<StateIcon name="check" size={14} />}
                tone="success"
                title="设计文档定稿 · 5 轮评审"
                time="09-26 01:32"
              >
                {`> grill: 交叉审查发现 5 处覆盖缺口，全部 immediately_answered
> decisions: D-001@v1 三层落地 / D-002@v1 Wave 分批 / D-003@v1 范围边界
> verify-probes --init --draft: 13 任务矩阵预填完成`}
              </TimelineItem>
              <TimelineItem
                icon={<StateIcon name="check" size={14} />}
                tone="success"
                title="执行 · task-06 完成（变更详情页重排）"
                time="09-27 01:58"
              >
                {`> 修改 frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
> 测试 134/134 全绿 · tsc 0 · eslint 0`}
              </TimelineItem>
              <TimelineItem
                icon={<StateIcon name="openCircle" size={14} />}
                tone="current"
                title="执行 · task-07 进行中（工作区列表行式化）"
                time="运行中 · 已 12 分钟"
              >
                {`> 读 workspace-card.tsx / workspace-drag-grid.tsx
> draft: 行式条目（主行=名称+徽章，meta 行=技术栈+时间）`}
              </TimelineItem>
              <TimelineItem
                icon={<StateIcon name="clock" size={14} />}
                title="验证（等待执行完成）"
                time="—"
              />
            </Timeline>
          </section>

          <aside className="w-[296px] flex-shrink-0">
            <MetaPanel>
              <MetaPanelSection title="基本信息">
                <MetaRow k="变更 key" v={<span className="font-mono">observation-events-v3-r16sf</span>} />
                <MetaRow k="工作区" v="multi-agent-platform" />
                <MetaRow k="创建" v="2026-09-25 14:02" />
                <MetaRow k="类型" v="完整流程" />
              </MetaPanelSection>
              <MetaPanelSection title="负责人">
                <div className="flex items-center gap-2">
                  <span
                    className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold"
                    style={{
                      backgroundColor: "var(--color-brand-50)",
                      color: "var(--color-brand-600)",
                    }}
                  >
                    Q
                  </span>
                  <span className="text-sm">qinyi · 主控</span>
                </div>
              </MetaPanelSection>
              <MetaPanelSection title="消耗统计">
                <MetaRow k="累计 token" v={<span className="font-mono">2.4M</span>} />
                <MetaRow k="会话次数" v={<span className="font-mono">18</span>} />
                <MetaRow k="预估成本" v={<span className="font-mono">¥86.20</span>} />
              </MetaPanelSection>
              <MetaPanelSection title="阶段进度">
                <MetaRow k="当前阶段" v="执行 · task-07" />
                <MetaRow k="任务" v={<span className="font-mono">6 / 13</span>} />
              </MetaPanelSection>
              <MetaPanelSection title="关联会话">
                <div className="flex items-center justify-between text-xs">
                  <span className="truncate">
                    <a href="#" className="text-primary hover:underline">
                      sess-ff095390 · 执行中
                    </a>
                  </span>
                  <StateLabel variant="open" withIcon={false}>
                    活跃
                  </StateLabel>
                </div>
                <MetaRow k="历史会话" v={<span className="font-mono">17</span>} />
              </MetaPanelSection>
              <MetaPanelSection title="平台同步">
                <MetaRow k="状态" v="已同步" />
                <MetaRow k="上次回执" v="3 分钟前" />
              </MetaPanelSection>
            </MetaPanel>
          </aside>
        </div>
      </main>
    </div>
  );
}

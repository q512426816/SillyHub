/**
 * prototype-as-code 演示视图 —— 会话门户（三栏）。
 * 真实 primer 组件（StateLabel/MetaPanel/StateIcon）+ Tailwind + token；
 * fixture 数据；build.mjs 编译为独立 HTML。
 * 注：真实门户为整屏应用（AppShell 内），此处演示门户主体三栏结构。
 */
import * as React from "react";

import { MetaPanel, MetaPanelSection, StateIcon, StateLabel } from "../primer";
import { DemoBar } from "./demo-chrome";

interface SessionEntry {
  id: string;
  title: string;
  changeKey: string;
  state: "open" | "attention" | "merged";
  stateText: string;
  time: string;
  selected?: boolean;
}

const TODAY: SessionEntry[] = [
  { id: "s1", title: "观测事件 v3 · 执行 task-07", changeKey: "observation-events-v3", state: "open", stateText: "运行中", time: "刚刚", selected: true },
  { id: "s2", title: "视觉对齐 · 等待输入", changeKey: "visual-align-2", state: "attention", stateText: "等待", time: "32 分钟前" },
  { id: "s3", title: "probe-rpc · 验证", changeKey: "probe-concurrent-rpc", state: "open", stateText: "运行中", time: "11 分钟前" },
];
const YESTERDAY: SessionEntry[] = [
  { id: "s4", title: "watcher 时间线 P2 · 收口", changeKey: "watcher-timeline-p2", state: "merged", stateText: "完成", time: "昨天 23:41" },
  { id: "s5", title: "thin 检查节奏 · 评审", changeKey: "thin-check-cadence", state: "merged", stateText: "完成", time: "昨天 18:02" },
];

function SessionItem({ s }: { s: SessionEntry }) {
  return (
    <div
      className={`flex flex-col gap-1 border-l-2 px-3 py-2.5 transition-colors ${
        s.selected ? "cursor-pointer" : "cursor-pointer hover:bg-muted/60"
      }`}
      style={
        s.selected
          ? {
              backgroundColor: "var(--color-brand-50)",
              borderColor: "var(--color-brand-600)",
            }
          : { borderColor: "transparent" }
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`truncate text-sm ${s.selected ? "font-semibold" : "font-medium"}`}>
          {s.title}
        </span>
        <span className="flex-shrink-0 text-[11px] text-muted-foreground">{s.time}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-xs text-muted-foreground">{s.changeKey}</span>
        <StateLabel variant={s.state} withIcon={false}>
          {s.stateText}
        </StateLabel>
      </div>
    </div>
  );
}

function UserMsg({ time, text }: { time: string; text: string }) {
  return (
    <div className="flex justify-end">
      <div
        className="max-w-[80%] rounded-xl rounded-br-sm px-3.5 py-2.5 text-sm leading-6"
        style={{
          backgroundColor: "var(--color-brand-50)",
          color: "hsl(var(--foreground))",
        }}
      >
        <div>{text}</div>
        <div className="mt-1 text-right font-mono text-[11px] opacity-60">{time}</div>
      </div>
    </div>
  );
}

function AgentMsg({ time, text, tool }: { time: string; text: string; tool?: string }) {
  return (
    <div className="max-w-[85%]">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <span
          className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold"
          style={{ backgroundColor: "var(--color-brand-50)", color: "var(--color-brand-600)" }}
        >
          Q
        </span>
        <span>qinyi · 主控</span>
        {tool && (
          <span
            className="rounded-full border px-1.5 py-px font-mono text-[11px]"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            {tool}
          </span>
        )}
      </div>
      <div
        className="rounded-xl rounded-tl-sm border bg-card px-3.5 py-2.5 text-sm leading-6"
        style={{ borderColor: "hsl(var(--border))" }}
      >
        <div className="whitespace-pre-wrap">{text}</div>
        <div className="mt-1 text-right font-mono text-[11px] text-muted-foreground">{time}</div>
      </div>
    </div>
  );
}

export function SessionPortalView() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <DemoBar />
      {/* 门户头 */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-2.5"
        style={{ borderColor: "hsl(var(--border))" }}
      >
        <div className="flex items-center gap-2 text-sm font-semibold">
          <StateIcon name="openCircle" size={14} />
          会话 · multi-agent-platform
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <StateLabel variant="open">
            运行中 2
          </StateLabel>
          <StateLabel variant="attention" iconName="clock">
            等待 1
          </StateLabel>
        </div>
      </div>

      {/* 三栏主体 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左栏：会话列表 */}
        <aside
          className="w-[280px] flex-shrink-0 overflow-y-auto border-r"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <div className="px-3 pb-1 pt-3 text-xs font-semibold text-muted-foreground">今天</div>
          {TODAY.map((s) => (
            <SessionItem key={s.id} s={s} />
          ))}
          <div className="px-3 pb-1 pt-4 text-xs font-semibold text-muted-foreground">昨天</div>
          {YESTERDAY.map((s) => (
            <SessionItem key={s.id} s={s} />
          ))}
        </aside>

        {/* 中栏：消息流（选中会话） */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div
            className="flex items-center justify-between border-b px-5 py-2"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            <span className="text-sm font-medium">观测事件 v3 · 执行 task-07</span>
            <span className="font-mono text-xs text-muted-foreground">sess-ff095390 · lease 剩余 18m</span>
          </div>
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
            <AgentMsg
              time="14:02"
              text={"task-06 完成：变更详情页重排已提交，134 用例全绿。\n接下来处理 task-07（工作区列表行式化），先读 workspace-card.tsx。"}
            />
            <UserMsg time="14:03" text="好，task-07 注意保留拖拽排序，分页换规范分页。" />
            <AgentMsg
              time="14:03"
              tool="file read ×3"
              text={"已读 workspace-card.tsx / workspace-drag-grid.tsx / page.test.tsx。\n方案：卡片退役改行式条目（主行=名称+徽章+slug，meta 行=技术栈+时间），拖拽手柄保留在行首。"}
            />
            <AgentMsg
              time="14:15"
              tool="bash"
              text={"> pnpm vitest run workspace\n48 passed (page 15 + card 19 + grid 14)\n行式化落地，窗口确认删除已换 Modal。"}
            />
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <StateIcon name="openCircle" size={12} />
              正在生成下一步…
            </div>
          </div>
          <div className="border-t px-5 py-3" style={{ borderColor: "hsl(var(--border))" }}>
            <div
              className="flex h-9 items-center gap-2 rounded-lg border bg-background px-3 text-sm text-muted-foreground"
              style={{ borderColor: "hsl(var(--input))" }}
            >
              <span className="flex-1">输入消息发送到该会话…</span>
              <span
                className="rounded-md px-2 py-1 text-xs font-medium text-primary-foreground"
                style={{ backgroundColor: "hsl(var(--primary))" }}
              >
                发送
              </span>
            </div>
          </div>
        </main>

        {/* 右栏：信息面板 */}
        <aside
          className="w-[280px] flex-shrink-0 overflow-y-auto border-l"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <div className="p-3">
            <MetaPanel>
              <MetaPanelSection title="会话信息">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">会话 ID</span>
                  <span className="font-mono">sess-ff095390</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">变更</span>
                  <span className="truncate">observation-events-v3</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">租约</span>
                  <span className="font-mono">18m 剩余</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">心跳</span>
                  <span>12 秒前</span>
                </div>
              </MetaPanelSection>
              <MetaPanelSection title="Agent">
                <div className="flex items-center gap-2 text-xs">
                  <span
                    className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold"
                    style={{ backgroundColor: "var(--color-brand-50)", color: "var(--color-brand-600)" }}
                  >
                    Q
                  </span>
                  qinyi · 主控
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">模型</span>
                  <span className="font-mono">GLM-5.3</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">累计</span>
                  <span className="font-mono">412K tok</span>
                </div>
              </MetaPanelSection>
              <MetaPanelSection title="变更产物">
                <div className="flex flex-col gap-1 font-mono text-xs text-muted-foreground">
                  <span>proposal.md · 09-26 00:31</span>
                  <span>design.md · 09-27 01:32</span>
                  <span>tasks.md · 09-27 00:58</span>
                  <span className="text-foreground">verify-result.md · 草拟中</span>
                </div>
              </MetaPanelSection>
            </MetaPanel>
          </div>
        </aside>
      </div>
    </div>
  );
}

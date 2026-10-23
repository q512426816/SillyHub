"use client";

/**
 * dev-only 原型：会话「对话」视图运行中轮次末尾的实时活动跑马灯
 * （2026-10-22-conversation-live-marquee）。
 *
 * 真码原型：直接引用实现同源组件 `turn-live-marquee.tsx` 与既有
 * `TurnStatusBar` / `SessionViewTabs`，用脚本化事件流模拟 SSE 实时推进，
 * 仅用于视觉/交互确认——不进导航、不被生产页面引用。
 *
 * 三种主题可切换（ai-native / blue / dark），可暂停/继续事件流。
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Bot, Send, Sparkles } from "lucide-react";

import { ChatMessageAvatar } from "@/components/chat/chat-message-avatar";
import { TurnStatusBar } from "@/components/daemon/turn-status-bar";
import { SessionViewTabs } from "@/components/daemon/session-panel/session-view-tabs";
import {
  TurnLiveMarquee,
  deriveLiveMarqueeEntries,
} from "@/components/daemon/turn-live-marquee";
import type { SessionViewMode } from "@/components/daemon/turn-timeline";
import type { TurnSegment } from "@/components/daemon/session-log-assembler";
import { cn } from "@/lib/utils";

const FULL_TEXT = `已定位登录超时根因：

1. 网关 keepalive 设为 60s，而前端请求超时只有 30s，长轮询场景下连接被提前回收；
2. 刷新 token 的请求没有复用重试策略，失败后直接跳登录页。

已补上 45s 的请求重试窗口，并让刷新 token 的请求走同一套重试策略。正在跑相关测试，稍后汇总变更说明。`;

/** 脚本事件：循环注入，模拟 agent 持续干活。 */
const SCRIPT: ReadonlyArray<(_seq: number) => TurnSegment> = [
  (n) => ({
    kind: "thinking",
    id: `think-${n}`,
    text: "先读登录链路，确认超时发生在前端还是网关；同时检查 token 刷新是否吞掉了错误，再决定补重试还是修 keepalive。",
    streaming: false,
    ts: n,
  }),
  (n) => ({
    kind: "tool",
    id: `read-${n}`,
    raw: "",
    status: "ok",
    toolName: "Read",
    primary: "src/lib/auth.ts",
    startedAt: n * 1000,
    endedAt: n * 1000 + 1200,
    children: [],
    subagentType: null,
  }),
  (n) => ({
    kind: "tool",
    id: `grep-${n}`,
    raw: "",
    status: "ok",
    toolName: "Grep",
    primary: "timeout · src/**/*.ts",
    startedAt: n * 1000,
    endedAt: n * 1000 + 820,
    children: [],
    subagentType: null,
  }),
  (n) => ({
    kind: "tool",
    id: `agent-${n}`,
    raw: "",
    status: "ok",
    toolName: "Agent",
    primary: "排查后端超时配置",
    startedAt: n * 1000,
    endedAt: n * 1000 + 3800,
    subagentType: "Explore",
    children: [
      {
        kind: "tool",
        id: `agent-grep-${n}`,
        raw: "",
        status: "ok",
        toolName: "Grep",
        primary: "keepalive · nginx/**",
        startedAt: n * 1000 + 600,
        endedAt: n * 1000 + 1400,
        children: [],
        subagentType: null,
      },
      {
        kind: "tool",
        id: `agent-bash-${n}`,
        raw: "",
        status: "ok",
        toolName: "Bash",
        primary: "grep -n keepalive nginx.conf",
        startedAt: n * 1000 + 1600,
        endedAt: n * 1000 + 2600,
        children: [],
        subagentType: null,
      },
    ],
  }),
  (n) => ({
    kind: "thinking",
    id: `think2-${n}`,
    text: "网关 keepalive 60s、应用侧 30s，确认是连接提前回收；补重试窗口并统一刷新策略。",
    streaming: false,
    ts: n,
  }),
  (n) => ({
    kind: "tool",
    id: `edit-${n}`,
    raw: "",
    status: "ok",
    toolName: "Edit",
    primary: "src/lib/auth.ts",
    startedAt: n * 1000,
    endedAt: n * 1000 + 1600,
    children: [],
    subagentType: null,
  }),
  (n) => ({
    kind: "stderr",
    id: `stderr-${n}`,
    text: "warning: retry interval below recommended minimum, clamped to 1200ms",
    ts: n,
  }),
  (n) => ({
    kind: "tool",
    id: `bash-${n}`,
    raw: "",
    status: "running",
    toolName: "Bash",
    primary: "pnpm vitest auth --reporter=verbose",
    startedAt: n * 1000,
    endedAt: null,
    children: [],
    subagentType: null,
  }),
  (n) => ({
    kind: "file",
    id: `file-${n}`,
    fileId: `f-${n}`,
    name: "auth-timeout-fix.md",
    size: 18432,
    mime: "text/markdown",
    description: "登录超时修复说明",
    ts: n,
  }),
  (n) => ({
    kind: "thinking",
    id: `think3-${n}`,
    text: "测试通过，整理变更说明并向用户汇报结果。",
    streaming: false,
    ts: n,
  }),
];

function buildSegments(step: number): TurnSegment[] {
  const total = Math.min(step + 1, 220);
  const out: TurnSegment[] = [];
  for (let i = 0; i < total; i += 1) {
    const event = SCRIPT[i % SCRIPT.length]!;
    const seg = event(i);
    // 历史条目里的「运行中」工具段收敛为完成态，便于演示耗时。
    if (i < total - 1 && seg.kind === "tool" && seg.status === "running") {
      seg.status = "ok";
      seg.endedAt = (seg.startedAt ?? 0) + 2100;
    }
    out.push(seg);
  }
  // 最新一条置为进行中：演示转圈 + 条目内部滚动；历史条目保持完成态与耗时。
  const last = out[out.length - 1];
  if (last?.kind === "thinking") {
    last.streaming = true;
  } else if (last?.kind === "tool") {
    last.status = "running";
    last.endedAt = null;
  } else {
    // 脚本末条是文件/警告时，补一条稳定的 streaming thinking，
    // 让最新处始终能看到转圈与内部滚动。
    out.push({
      kind: "thinking",
      id: "live-thinking",
      text: `正在核对 keepalive 与重试窗口的配合，确认长轮询连接不会再被提前回收（第 ${step + 1} 次刷新）…`,
      streaming: true,
      ts: total * 1000,
    });
  }
  return out;
}

const THEMES = [
  { value: "ai-native", label: "AI 紫（默认）" },
  { value: "blue", label: "经典蓝" },
  { value: "dark", label: "暗夜" },
] as const;

type ThemeValue = (typeof THEMES)[number]["value"];

export default function SessionLiveMarqueeProtoPage() {
  const [view, setView] = useState<SessionViewMode>("conversation");
  const [theme, setTheme] = useState<ThemeValue>("ai-native");
  const [step, setStep] = useState(5);
  const [running, setRunning] = useState(true);
  // 「长会话」演示：强制重挂载跑马灯，模拟刷新后直接加载 200+ 历史事件
  //（首次挂载应直接定位到最新，不空白）。
  const [marqueeKey, setMarqueeKey] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  useEffect(() => {
    setStartedAt(Date.now() - 74_000);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "ai-native") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", theme);
    }
  }, [theme]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setStep((prev) => (prev >= 220 ? prev : prev + 1));
    }, 1300);
    return () => window.clearInterval(timer);
  }, [running]);

  const segments = useMemo(() => buildSegments(step), [step]);
  const entries = useMemo(() => deriveLiveMarqueeEntries(segments), [segments]);
  const text = FULL_TEXT.slice(0, Math.min(step * 46, FULL_TEXT.length));

  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto max-w-5xl">
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          {/* 会话头 */}
          <div className="flex items-center gap-3 border-b px-5 py-3">
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
              aria-label="返回"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">修复登录超时问题</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] text-brand-700">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
                  运行中
                </span>
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                multi-agent-platform · Claude · 本机 daemon
              </div>
            </div>
            <SessionViewTabs value={view} onChange={setView} />
          </div>

          {/* 演示控制条 */}
          <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-5 py-2 text-[11px]">
            <span className="mr-1 text-muted-foreground">预览主题</span>
            {THEMES.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setTheme(item.value)}
                className={cn(
                  "rounded-full border px-2.5 py-1 transition-colors",
                  theme === item.value
                    ? "border-brand-300 bg-card font-medium text-foreground shadow-sm"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
            <span className="mx-1 h-3 w-px bg-border" />
            <button
              type="button"
              onClick={() => setRunning((prev) => !prev)}
              className="rounded-full border px-2.5 py-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              {running ? "暂停事件流" : "继续事件流"}
            </button>
            <button
              type="button"
              onClick={() => setStep(5)}
              className="rounded-full border px-2.5 py-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              重置
            </button>
            <button
              type="button"
              onClick={() => {
                setStep(209);
                setMarqueeKey((prev) => prev + 1);
              }}
              className="rounded-full border px-2.5 py-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              长会话（210 条）
            </button>
            <span className="ml-auto text-muted-foreground/70">
              已注入 {entries.length} 条过程事件
            </span>
          </div>

          {/* 消息流 */}
          <div className="h-[540px] overflow-y-auto bg-background/60 px-6 py-5">
            {view === "all" ? (
              <div className="space-y-2">
                <div className="text-[11px] text-muted-foreground">
                  进度视图（跑马灯的信息来源，完整时间线）
                </div>
                <div className="ml-2 flex flex-col gap-[7px] border-l-2 border-muted pl-3.5">
                  {segments.slice(-16).map((seg) => {
                    const entry = entries.find((item) => seg.kind !== "text" && item.id.startsWith(seg.id))
                      ?? entries.find((item) => item.id === seg.id);
                    return (
                      <div
                        key={seg.id}
                        className="flex items-center gap-2 text-[11px] text-muted-foreground"
                      >
                        <span className="w-4 shrink-0 text-center">
                          {entry ? "•" : "·"}
                        </span>
                        <span className="truncate text-foreground/75">
                          {entry?.text ?? seg.kind}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : view === "trajectory" ? (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                轨迹视图（本次不改动）
              </div>
            ) : (
              <div className="flex min-h-[500px] flex-col justify-end space-y-6">
                {/* 历史轮 1 */}
                <div className="flex justify-end gap-2">
                  <div className="max-w-[56%] rounded-2xl rounded-br-md border border-primary/20 bg-primary/[0.08] px-4 py-2.5 text-[13.5px] leading-6">
                    登录偶尔会卡住，然后直接跳回登录页，帮我看看。
                  </div>
                  <ChatMessageAvatar kind="user" name="管理员" size={28} />
                </div>
                <div className="flex items-start gap-2.5">
                  <ChatMessageAvatar kind="agent" title="智能体" size={28} />
                  <div className="seg-text-body max-w-[52rem] text-[14.5px]">
                    收到，我先查看登录与 token 刷新链路，定位是网关超时还是前端重试策略的问题。
                  </div>
                </div>

                {/* 历史轮 2（用户追问） */}
                <div className="flex justify-end gap-2">
                  <div className="max-w-[56%] rounded-2xl rounded-br-md border border-primary/20 bg-primary/[0.08] px-4 py-2.5 text-[13.5px] leading-6">
                    好，顺便把修复说明整理出来。
                  </div>
                  <ChatMessageAvatar kind="user" name="管理员" size={28} />
                </div>

                {/* 运行中轮 */}
                <div className="space-y-2.5">
                  {startedAt != null && (
                    <TurnStatusBar
                      turnStartedAt={startedAt}
                      turnStatus="running"
                      segments={segments}
                    />
                  )}
                  <div className="flex items-start gap-2.5">
                    <ChatMessageAvatar kind="agent" title="智能体" size={28} />
                    <div className="seg-text-body max-w-[52rem] whitespace-pre-wrap text-[14.5px]">
                      {text}
                      <span aria-hidden className="sh-stream-caret" />
                    </div>
                  </div>
                  <TurnLiveMarquee key={marqueeKey} entries={entries} />
                </div>
              </div>
            )}
          </div>

          {/* 输入区占位 */}
          <div className="border-t px-5 py-3">
            <div className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-[12px] text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-brand-500" />
              <span className="flex-1">输入消息，运行中也可以排队…</span>
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Send className="h-3.5 w-3.5" />
              </span>
            </div>
          </div>
        </div>

        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Bot className="h-3 w-3" />
          真码原型：跑马灯为实际组件 `TurnLiveMarquee`，事件由脚本模拟；「进度」tab
          可查看同一数据的完整时间线。
        </p>
      </div>
    </div>
  );
}

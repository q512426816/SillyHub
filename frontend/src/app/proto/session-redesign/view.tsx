"use client";

/**
 * 会话页视觉原型（v2）—— 全页真实组件视图。2026-10-20-session-page-dsh-alignment /
 * D-010（dev 预览路由直接渲染真实组件）/ D-012（主线＝视觉层重做）/ D-014（静态
 * 快照由本路由 SSR 固化）/ D-017（定稿原型必须由真实组件产出）。
 *
 * 被两个 dev-only 路由复用（默认 v2 / 默认现状），页面文件本身零逻辑：
 *   - frontend/src/app/proto/session-redesign/page.tsx（v2）
 *   - frontend/src/app/proto/session-current/page.tsx（现状对照）
 *
 * 页面构成＝**真实组件**自上而下：
 *   1. AppShell（真实壳层：品牌区 + 分组菜单 + 顶栏工作区切换/面包屑/搜索/通知/头像）
 *      —— fixture 用户与工作区经 AppShell 的可选 preview 入参注入（生产 layout 不传，
 *      行为零变化）。
 *   2. SessionListPanel（真实左栏会话列表，工作区树形态）—— fetch 打桩 + Query 预热
 *      供数（./proto-fixtures.ts）。
 *   3. TurnTimeline（真实轮次时间线）—— 中间列，数据是**用户提供的真实会话导出**
 *      （.proto-staging/session-export.json，21 runs / 1271 logs；2026-10-21 迁出
 *      public/ 免鉴权静态面——见 staged-session-export.ts），经产品自己的装配器
 *      logsToTurns 装配，非手写 fixture；六项视觉改动（合并元信息行 / 14.5px 正文 /
 *      去框工具行 2px 左规线 / 28px 轮间节奏 + hairline / 56% 用户气泡 / 9px 左栏
 *      chip）随真实组件一并呈现。
 *   4. CtxUsageBar + SessionInputBar（真实输入区组件）—— props 打桩（发送不接线）。
 *
 * 数据加载：staged export 由 Server Component 读盘后经 props 传入（SSR 快照含真实
 * 内容，静态导出稿无 JS 也可评审）；props 缺席（文件未 staging/损坏）保持占位符
 * ——原 public URL 运行时 fetch 兜底已随 2026-10-21 迁移移除（数据不在可 fetch 面）。
 * 3.3 MB JSON 不进 JS bundle。
 */

import { useEffect, useMemo, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";

import { AppShell } from "@/components/app-shell";
import { TurnTimeline } from "@/components/daemon/turn-timeline";
import type {
  SessionTurnView,
  SessionUiStatus,
  SessionViewMode,
} from "@/components/daemon/turn-timeline";
import { logsToTurns, runTerminalTurnStatus } from "@/components/daemon/runtime-session-helpers";
import { SessionInputBar } from "@/components/daemon/session-input-bar";
import { SessionListPanel } from "@/components/sessions/session-list-panel";
import { CtxUsageBar } from "@/components/sessions/ctx-usage-bar";
import { useNotify } from "@/lib/errors";
import { useWorkspaceStore } from "@/stores/workspace";

import {
  PREVIEW_SESSION_ID,
  PREVIEW_SESSION_TITLE,
  PREVIEW_USER,
  PREVIEW_WORKSPACE,
  createProtoQueryClient,
  installProtoFetchMock,
  seedProtoQueries,
} from "./proto-fixtures";
import type { StagedSessionExport } from "./types";
import styles from "./session-redesign.module.css";

// dev-only：模块求值早于任何组件挂载 → 各真实组件挂载后发出的首个查询即命中打桩
// （若放到 useEffect 里装，父组件的 effect 晚于子组件 effect 执行，首帧请求会漏网）。
if (typeof window !== "undefined") installProtoFetchMock();

/** 会话状态 → 中文标签（头部状态 pill）。 */
const SESSION_STATUS_LABEL: Record<string, string> = {
  active: "运行中",
  pending: "排队中",
  reconnecting: "恢复中",
  ended: "已结束",
  failed: "已失败",
  suspended: "已挂起",
};

/** 导出 session 既有状态落到 TurnTimeline 的会话级 UI 状态（未知按 active）。 */
function toSessionUiStatus(status: string | undefined): SessionUiStatus {
  switch (status) {
    case "reconnecting":
    case "ended":
    case "failed":
      return status;
    // pending（排队中）/ 未知：TurnTimeline 侧按「会话开着」处理
    default:
      return "active";
  }
}

/**
 * 真实会话导出 → 轮次视图：分组/段装配全部交产品装配器 `logsToTurns`
 * （frontend/src/components/daemon/runtime-session-helpers.tsx:396），本函数只做
 * 「run 快照回补」——logsToTurns 对历史轮一律标 completed 且不带 token/时长/完成
 * 时刻（历史 logs 无这些字段），真实值取 runs[]（同 session-panel 历史回看的
 * runsMeta 口径）：
 *   - 终态：status / error_code → runTerminalTurnStatus
 *   - 轮尾唯一元信息行（turn-meta-detail）的锚点：replyAt=finished_at
 *   - tokens：input/output_tokens；apiDurationMs=finished_at-started_at（tok/s 速度段）
 */
function assembleTurns(payload: StagedSessionExport): SessionTurnView[] {
  const turns = logsToTurns(payload.logs);
  const runById = new Map(payload.runs.map((run) => [run.id, run] as const));
  return turns.map((turn) => {
    const run = turn.realRunId ? runById.get(turn.realRunId) : undefined;
    if (!run) return turn;
    const terminal = runTerminalTurnStatus(run.status, run.error_code);
    const startedMs = run.started_at ? Date.parse(run.started_at) : Number.NaN;
    const finishedMs = run.finished_at ? Date.parse(run.finished_at) : Number.NaN;
    const durationMs =
      Number.isFinite(startedMs) && Number.isFinite(finishedMs)
        ? finishedMs - startedMs
        : null;
    return {
      ...turn,
      ...(terminal ? { status: terminal } : {}),
      inputTokens: turn.inputTokens ?? run.input_tokens,
      outputTokens: turn.outputTokens ?? run.output_tokens,
      ctxTokens: turn.ctxTokens ?? run.input_tokens,
      apiDurationMs: turn.apiDurationMs ?? durationMs,
      replyAt: run.finished_at ?? turn.replyAt ?? null,
      turnStartedAt: turn.turnStartedAt ?? (Number.isFinite(startedMs) ? startedMs : null),
    };
  });
}

/** 上下文环分子：逆序取最近一次带 input_tokens 的 run（= 最近一次提示词大小口径）。 */
function latestInputTokens(payload: StagedSessionExport | null): number | null {
  if (!payload) return null;
  for (let i = payload.runs.length - 1; i >= 0; i -= 1) {
    const tokens = payload.runs[i]?.input_tokens;
    if (typeof tokens === "number") return tokens;
  }
  return null;
}

export function SessionRedesignView({
  initialV2,
  stagedExport,
}: {
  initialV2: boolean;
  /** Server Component 读盘得到的真实会话导出；null = 交客户端运行时 fetch 兜底。 */
  stagedExport: StagedSessionExport | null;
}) {
  // 预览专用 QueryClient（重试关闭 / staleTime=Infinity），并在首帧前预热各组件
  // 首屏读取的查询——SSR 与 hydrate 命中同一份 fixture，静态快照不为空。
  const [queryClient] = useState(() => {
    const client = createProtoQueryClient();
    seedProtoQueries(client);
    return client;
  });
  return (
    <QueryClientProvider client={queryClient}>
      <ProtoPage initialV2={initialV2} stagedExport={stagedExport} />
    </QueryClientProvider>
  );
}

function ProtoPage({
  initialV2,
  stagedExport,
}: {
  initialV2: boolean;
  stagedExport: StagedSessionExport | null;
}) {
  const [v2, setV2] = useState(initialV2);
  const [viewMode, setViewMode] = useState<SessionViewMode>("all");
  const [input, setInput] = useState("");
  // stagedExport 是唯一数据源（SSR 读盘；fetch 兜底已移除）——直接取 props，
  // 无本地 state（原 useState 是为 fetch 覆盖而设，兜底除后无意义）。
  const payload: StagedSessionExport | null = stagedExport;
  const notify = useNotify();
  const setCurrentWorkspace = useWorkspaceStore((s) => s.setCurrent);

  // SSR 未读到 staged 文件时（文件缺失 / 读盘失败 / 未 staging）保持「加载真实
  // 会话…」占位——2026-10-21-proto-data-exposure-guard：数据已迁出 public/ 免鉴权
  // 静态面（.proto-staging/ 不进构建），原运行时 fetch 兜底随之移除。

  // 预览工作区写进 workspace store（**内存态、非 persist**）：让顶栏 WorkspaceSwitcher
  // 与侧栏菜单拿到「当前工作区」（否则平台页恒为「选择工作区」引导态）。离开本页
  // 恢复原值——预览路由不得把状态留给同 tab 的其它页面。
  useEffect(() => {
    const previous = useWorkspaceStore.getState().current;
    setCurrentWorkspace(PREVIEW_WORKSPACE);
    return () => {
      useWorkspaceStore.getState().setCurrent(previous);
    };
  }, [setCurrentWorkspace]);

  const turns = useMemo(() => (payload ? assembleTurns(payload) : null), [payload]);
  const session = payload?.session ?? null;
  const sessionTitle = session?.title?.trim() || PREVIEW_SESSION_TITLE;
  const usedTokens = useMemo(() => latestInputTokens(payload), [payload]);
  const engine = session?.config_snapshot?.engine ?? session?.provider ?? null;
  const headerChips = [
    session?.config_snapshot?.machine_name,
    session?.config_snapshot?.agent_name,
    session?.config_snapshot?.profile_name,
    engine,
  ].filter((chip): chip is string => Boolean(chip && chip.trim()));

  const noop = useMemo(() => () => undefined, []);
  const onDialogResolved = useMemo(
    () => (_id: string) => undefined,
    [],
  );
  const onResend = useMemo(() => (_prompt: string) => undefined, []);

  const timelineProps = {
    turns: turns ?? [],
    viewMode,
    errorMsg: null,
    sessionStatus: toSessionUiStatus(session?.status),
    pendingRequests: [],
    dialogHistory: [],
    onDialogResolved,
    onResend,
    onSwitchProvider: noop,
    hasOnlineProvider: true,
    emptyProviderLabel: "",
  };

  const btn = (on: boolean) => ({
    borderColor: "hsl(var(--border))",
    backgroundColor: on ? "var(--color-brand-50)" : undefined,
    color: on ? "var(--color-brand-700)" : undefined,
    fontWeight: on ? 600 : 400,
  });

  return (
    <AppShell
      preview={{
        user: PREVIEW_USER,
        workspace: PREVIEW_WORKSPACE,
        onLogoutRequest: () => notify.warning("dev 预览路由：退出登录已禁用（不影响真实登录态）"),
      }}
    >
      <div
        className={
          v2
            ? `flex h-[calc(100vh-4rem)] min-h-0 ${styles.v2}`
            : "flex h-[calc(100vh-4rem)] min-h-0"
        }
      >
        {/* 左栏：真实会话列表（工作区树形态，数据打桩）。窄屏隐藏，与门户一致。 */}
        <aside className="hidden w-[320px] shrink-0 flex-col border-r border-border/60 p-2 md:flex">
          <SessionListPanel
            selectedSessionId={PREVIEW_SESSION_ID}
            defaultExpandedWorkspaceId={PREVIEW_WORKSPACE.id}
          />
        </aside>

        {/* 中栏：dev 工具条 + 会话头 + 真实轮次时间线 + 真实输入区。 */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div
            className="flex flex-wrap items-center gap-2 border-b px-4 py-1.5 text-[11px]"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            <span className="font-semibold">dev 预览 · 会话页视觉重做</span>
            <span className="text-muted-foreground">
              壳层 / 左栏 / 输入区＝真实组件；中栏＝真实会话导出的真实轮次
            </span>
            <span className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => setV2(false)}
                className="rounded-md border px-2 py-0.5"
                style={btn(!v2)}
              >
                现状
              </button>
              <button
                type="button"
                onClick={() => setV2(true)}
                className="rounded-md border px-2 py-0.5"
                style={btn(v2)}
              >
                v2
              </button>
              <span className="mx-1 opacity-30">|</span>
              {(["conversation", "all"] as SessionViewMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  className="rounded-md border px-2 py-0.5"
                  style={btn(viewMode === mode)}
                >
                  {mode === "conversation" ? "对话" : "全部（进度）"}
                </button>
              ))}
            </span>
          </div>

          <div
            className={v2 ? styles.header : "flex items-center gap-2.5 border-b px-4 py-2"}
            style={{ borderColor: "hsl(var(--border))" }}
          >
            <span className={v2 ? styles.title : "text-[13px] font-semibold"}>
              {sessionTitle}
            </span>
            <span
              className={
                v2 ? styles.pill : "rounded-full border px-1.5 text-[10px] text-muted-foreground"
              }
              style={{ borderColor: "hsl(var(--border))" }}
            >
              <span
                className={v2 ? styles.dotOk : "inline-block h-1 w-1 rounded-full"}
                style={{ backgroundColor: "var(--color-success)" }}
              />
              {SESSION_STATUS_LABEL[session?.status ?? "active"] ?? session?.status ?? "运行中"}
            </span>
            <span
              className={v2 ? styles.mono : "font-mono text-[10px] text-muted-foreground"}
              style={{ color: "hsl(var(--muted-foreground))" }}
            >
              {session?.id ?? PREVIEW_SESSION_ID}
            </span>
            {payload ? (
              <span
                className={v2 ? styles.mono : "font-mono text-[10px] text-muted-foreground"}
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                {payload.runs.length} 轮 · {payload.logs.length} 条日志
              </span>
            ) : null}
            <span className="ml-auto flex flex-wrap items-center gap-1.5">
              {headerChips.map((chip) => (
                <span
                  key={chip}
                  className={v2 ? styles.pill : "rounded border px-1.5 py-px text-[10.5px]"}
                  style={{ borderColor: "hsl(var(--border))" }}
                >
                  {chip}
                </span>
              ))}
            </span>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            {turns ? (
              <TurnTimeline {...timelineProps} />
            ) : (
              <div
                data-testid="proto-session-loading"
                className="flex flex-1 items-center justify-center text-[12px] text-muted-foreground"
              >
                加载真实会话…
              </div>
            )}
          </div>

          <div
            className={v2 ? styles.composerWrap : "border-t px-4 py-2"}
            style={{ borderColor: "hsl(var(--border))" }}
          >
            <div className="mb-1 flex flex-wrap items-center gap-2">
              {/* 真实上下文用量环 + 供应商额度胶囊（额度无 provider 数据时胶囊静默不渲染）。 */}
              <CtxUsageBar usedTokens={usedTokens} provider={engine} providerId={null} />
              <span className="ml-auto text-[10.5px] text-muted-foreground">
                预览：输入区为真实组件，发送未接线
              </span>
            </div>
            <SessionInputBar
              value={input}
              onChange={setInput}
              onSend={() => notify.warning("dev 预览路由：发送未接线")}
              disabled={false}
              placeholder="向智能体提问，Enter 发送 / Shift+Enter 换行"
              creating={false}
              workspaceId={PREVIEW_WORKSPACE.id}
            />
          </div>
        </section>
      </div>
    </AppShell>
  );
}

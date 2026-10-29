/**
 * prototype-as-code 演示视图 —— 全引擎长操作实时感知（change 2026-10-29-engine-live-perception）。
 *
 * 本次改动涉及的跑马灯等待条目三态形态，供评审定稿：
 *   ① 现状对照：无心跳 → 「等待模型响应 · 计时」（旧行为零回归基线）
 *   ② 等待首字：awaiting_first_token → 「正在等待模型响应 · 已发送上下文」
 *   ③ 生成大段内容（估算）：generating/estimated → 「正在生成大段内容 · 已产出约 N token」
 *   ④ 生成大段内容（权威）：generating/authoritative（codex）→ 「已输出 N token」不带约
 *   ⑤ 慢提示：等待 >30s → 追加「大内容可能需要几分钟」
 *   ⑥ 心跳过期：>5s 无新心跳 → 回落现状纯计时（瞬态自清）
 *
 * 真码方言：Tailwind token 零硬编码色；等待条目 DOM 结构与文案对齐生产
 * turn-live-marquee.tsx（ml-9 h-8 w-[min(calc(100%-2.25rem),52rem)] rounded-full
 * border border-border/70 bg-card px-3 胶囊 + 状态点 + 图标位 + LIVE 徽标——
 * 管线独立编译仅相对导入 + react，生产组件经 @/ alias 不可拉入，按管线规约
 * 「DOM 结构对齐生产」本地复刻；生产组件行为由 turn-live-marquee.test.tsx
 * 50 用例钉板）。scripts/prototype-build.mjs 编译为独立 HTML。
 */
import * as React from "react";

import { DemoBar } from "./demo-chrome";

/* ───────────── 等待条目（DOM 结构对齐生产 turn-live-marquee 胶囊） ───────────── */

type HeartbeatKind = "awaiting_first_token" | "generating";

interface HeartbeatLike {
  kind: HeartbeatKind;
  est_tokens: number | null;
  precision: "estimated" | "authoritative";
}

/** 等待条目文案（对齐生产三态构造：label + 时长 + est 段 + token 段 + 慢提示）。 */
function awaitingText(
  hb: HeartbeatLike | null,
  elapsedMs: number,
  turnTokens: { input: number; output: number } | null,
): string {
  const estSuffix =
    hb?.est_tokens != null
      ? `${
          hb.precision === "estimated" ? "已产出约" : "已输出"
        } ${hb.est_tokens.toLocaleString("zh-CN")} token`
      : "";
  const tokenSuffix = turnTokens
    ? ` · ↑${turnTokens.input.toLocaleString("zh-CN")} ↓${turnTokens.output.toLocaleString("zh-CN")}`
    : "";
  const slowHint = elapsedMs > 30_000 ? " · 大内容可能需要几分钟" : "";
  const label = hb
    ? hb.kind === "awaiting_first_token"
      ? "正在等待模型响应 · 已发送上下文"
      : "正在生成大段内容"
    : "等待模型响应";
  const secs = Math.floor(elapsedMs / 1000);
  const dur = `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`;
  return `${label} · ${dur}${estSuffix ? ` · ${estSuffix}` : ""}${tokenSuffix}${slowHint}`;
}

function MarqueeRow({
  hb,
  elapsedMs,
  turnTokens,
}: {
  hb: HeartbeatLike | null;
  elapsedMs: number;
  turnTokens: { input: number; output: number } | null;
}) {
  return (
    <div className="ml-9 flex h-8 w-[min(calc(100%-2.25rem),52rem)] items-center gap-2 overflow-hidden rounded-full border border-border/70 bg-card px-3 text-[12px] leading-none text-muted-foreground shadow-sm">
      <span className="relative z-10 flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-500" />
      </span>
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-muted-foreground">
        {/* 图标位：生产为 lucide Sparkles（管线独立编译本地以 ✦ 代位）。 */}
        ✦
      </span>
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">
        {awaitingText(hb, elapsedMs, turnTokens)}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
      </span>
      <span className="relative z-10 shrink-0 text-[9px] tracking-[0.12em] text-muted-foreground/50">
        LIVE
      </span>
    </div>
  );
}

/* ───────────── 演示区块 ───────────── */

function DemoBlock({
  caption,
  note,
  children,
}: {
  caption: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-card p-4">
      <div className="mb-1 text-sm font-semibold text-foreground">{caption}</div>
      <div className="mb-3 text-xs text-muted-foreground">{note}</div>
      <div className="rounded-xl bg-muted/40 p-3">{children}</div>
    </div>
  );
}

const TOKENS = { input: 19_415, output: 54_160 };

/* ───────────── 视图 ───────────── */

export function EngineLivePerceptionView() {
  return (
    <div className="min-h-screen bg-background p-8">
      <DemoBar />
      <div className="mx-auto max-w-3xl space-y-4">
        <p className="text-sm leading-relaxed text-muted-foreground">
          跑马灯等待条目三态（DOM/文案对齐生产 turn-live-marquee，行为由 50 用例钉板）。
          心跳口径：估算值（Claude/智谱）带「约」，权威值（codex）不带约；估算与权威
          usage 分道，不进任何用量合计。
        </p>
        <DemoBlock
          caption="① 现状对照（无心跳）"
          note="旧行为零回归基线——老 daemon / 断线 / 心跳过期回落形态"
        >
          <MarqueeRow hb={null} elapsedMs={2_000} turnTokens={TOKENS} />
        </DemoBlock>
        <DemoBlock
          caption="② 等待首字（awaiting_first_token）"
          note="请求已发出、首包未到——大上下文 prefill 期不再假死机"
        >
          <MarqueeRow
            hb={{ kind: "awaiting_first_token", est_tokens: null, precision: "estimated" }}
            elapsedMs={3_000}
            turnTokens={TOKENS}
          />
        </DemoBlock>
        <DemoBlock
          caption="③ 生成大段内容 · 估算（generating / estimated）"
          note="Claude input_json_delta 计数 / 智谱遥测——写大文件期间数字持续跳动"
        >
          <MarqueeRow
            hb={{ kind: "generating", est_tokens: 12_000, precision: "estimated" }}
            elapsedMs={5_000}
            turnTokens={TOKENS}
          />
        </DemoBlock>
        <DemoBlock
          caption="④ 生成大段内容 · 权威（generating / authoritative）"
          note="codex token_usage 引擎权威值——不带「约」"
        >
          <MarqueeRow
            hb={{ kind: "generating", est_tokens: 4_820, precision: "authoritative" }}
            elapsedMs={5_000}
            turnTokens={TOKENS}
          />
        </DemoBlock>
        <DemoBlock
          caption="⑤ 慢提示（等待 >30s）"
          note="任何等待态持续超 30 秒追加「大内容可能需要几分钟」"
        >
          <MarqueeRow
            hb={{ kind: "generating", est_tokens: 28_400, precision: "estimated" }}
            elapsedMs={65_000}
            turnTokens={TOKENS}
          />
        </DemoBlock>
        <DemoBlock
          caption="⑥ 心跳过期回落（>5s 无新心跳）"
          note="心跳停发（轮收尾/链路异常）→ 瞬态自清回现状纯计时"
        >
          <MarqueeRow hb={null} elapsedMs={2_000} turnTokens={TOKENS} />
        </DemoBlock>
      </div>
    </div>
  );
}

export default EngineLivePerceptionView;

/**
 * 会话配置条「待生效」标记原型视图（2026-10-30-askuser-config-pending）。
 *
 * 展示主会话页配置条四控件（供应商/模型/思考档位/档案）在暂存待生效状态下的
 * 逐控件标记形态，对照现状静默态；附 askuser 待答场景上下文示意（问答卡替换
 * 输入框、配置条仍可操作可暂存）。
 *
 * 素材来源声明（真码五要素）：
 *   - 控件结构/类名：frontend/src/components/sessions/session-config-bar.tsx
 *     ctrlButton（胶囊按钮 tailwind 类名、lucide 图标、ChevronDown）原样复刻同方言；
 *   - token：brand-* 语义阶（styles/themes.ts 双主题映射，禁字面色，随 data-theme 换肤）；
 *   - 图标：lucide-react 真实依赖（Cloud/GitBranch/Brain/User/ChevronDown/Clock）；
 *   - 交互：prototype-build 内嵌 data-state-btn / data-state-panel 四态切换，
 *     初始态名必须是 active（脚本默认 setState("active")）。
 *
 * 标记形态（D-001，用户裁决 2026-10-30 收敛）：
 *   - 控件胶囊：brand 描边 + 浅底（ring-1 ring-brand-400 + bg-brand-50），
 *     高亮本体即标记——不加「待生效」文字角标（用户裁决去掉）；
 *   - 悬停 title：「已记住，将随下一条消息发送时生效」（生效语义说明，
 *     用户决策「只逐控件标记」不加常驻汇总行，语义走悬停）。
 */
import * as React from "react";
import { Brain, ChevronDown, Cloud, GitBranch, User } from "lucide-react";

import { DemoBar } from "./demo-chrome";

/* ───────────── 控件胶囊（ctrlButton 同方言复刻） ───────────── */

interface CtrlPillProps {
  icon: React.ReactNode;
  value: string;
  title: string;
  /** 暂存待生效标记（staged[field] !== undefined 的控件亮标）。 */
  pending?: boolean;
}

function CtrlPill({ icon, value, title, pending = false }: CtrlPillProps) {
  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        title={pending ? "已记住，将随下一条消息发送时生效" : title}
        className={
          pending
            ? // 待生效态：brand 描边 + 浅底（语义阶随主题换肤；用户裁决
              // 2026-10-30：不加「待生效」文字角标，高亮本体即标记）
              "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors cursor-pointer text-foreground bg-brand-50 ring-1 ring-brand-400"
            : // 现状态（session-config-bar.tsx ctrlButton 原样）
              "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors cursor-pointer text-muted-foreground hover:bg-muted hover:text-foreground"
        }
      >
        <span aria-hidden className="shrink-0 text-brand-600">
          {icon}
        </span>
        <span className="max-w-[160px] truncate">{value}</span>
        <ChevronDown
          aria-hidden
          className="h-3 w-3 shrink-0 text-muted-foreground/60"
        />
      </button>
    </span>
  );
}

/* ───────────── 配置条整条（四控件 + ctx 行尾占位） ───────────── */

type CtrlKind = "provider" | "model" | "thinking" | "profile";

interface ConfigBarState {
  provider: string;
  model: string;
  thinking: string;
  profile: string;
  /** 亮「待生效」标记的控件集合（"all" = 全部）。 */
  pending: CtrlKind[] | "all";
}

function ConfigBar({ s }: { s: ConfigBarState }) {
  const isPending = (k: CtrlKind) =>
    s.pending === "all" ? true : s.pending.includes(k);
  return (
    <div className="relative mt-1.5" aria-label="会话配置控件条">
      <div className="flex flex-wrap items-center gap-0.5">
        <span className="inline-flex items-center gap-0.5">
          <CtrlPill
            icon={<Cloud aria-hidden className="h-3.5 w-3.5" />}
            value={s.provider}
            title="供应商（不选=本机默认配置）"
            pending={isPending("provider")}
          />
          <CtrlPill
            icon={<GitBranch aria-hidden className="h-3.5 w-3.5" />}
            value={s.model}
            title="模型（跟随供应商配置）"
            pending={isPending("model")}
          />
        </span>
        <CtrlPill
          icon={<Brain aria-hidden className="h-3.5 w-3.5" />}
          value={s.thinking}
          title="思考档位"
          pending={isPending("thinking")}
        />
        <CtrlPill
          icon={<User aria-hidden className="h-3.5 w-3.5" />}
          value={s.profile}
          title="档案"
          pending={isPending("profile")}
        />
        {/* 行尾 ctx 占位（真实配置条行尾插槽，视觉完整性） */}
        <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
          CTX 42%
        </span>
      </div>
    </div>
  );
}

/* ───────────── askuser 待答卡占位（上下文示意） ───────────── */

function AskUserGhost() {
  return (
    <div className="rounded-lg border border-border bg-card p-3 text-xs">
      <p className="mb-2 font-medium text-foreground">
        待答问题（问答期间输入框替换为问答卡，配置条在下方仍可操作）
      </p>
      <p className="mb-2 text-muted-foreground">
        这个功能打算先做哪个方案？
      </p>
      <div className="flex flex-col gap-1">
        <span className="rounded border border-border px-2 py-1 text-muted-foreground">
          ○ 方案 A：轻量版
        </span>
        <span className="rounded border border-brand-400 bg-brand-50 px-2 py-1 text-foreground ring-1 ring-brand-400">
          ● 方案 B：完整版
        </span>
      </div>
      <button
        type="button"
        className="mt-2 rounded bg-brand-600 px-3 py-1 text-xs text-white"
      >
        提交回答
      </button>
    </div>
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
  ["active", "现状 · 无暂存（对照）"],
  ["partial", "改了供应商+模型"],
  ["all", "四控件全改"],
  ["askuser", "askuser 待答场景"],
];

const CHROME =
  "rounded-lg border border-border bg-card px-5 pb-4 pt-3 shadow-sm";

export function SessionConfigPendingView() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <DemoBar />
      <div className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-1 text-lg font-semibold">
          会话配置条 · 待生效标记
        </h1>
        <p className="mb-4 text-xs text-muted-foreground">
          2026-10-30-askuser-config-pending · 点选配置即暂存（不打断、不产生
          切换轮），随下一条消息发送时生效；改过的控件亮「待生效」标记，
          正常会话与 askuser 待答场景统一。
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

        {/* 态一：现状（无暂存） */}
        <div data-state-panel="active" className={CHROME}>
          <ConfigBar
            s={{
              provider: "智谱 BigModel",
              model: "GLM-5.3",
              thinking: "中",
              profile: "极速变更档案",
              pending: [],
            }}
          />
          <StateNote>
            <strong>现状（静默）</strong>：问答期间/正常会话点选四控件仅本地
            暂存（2026-10-25/26 已交付），但控件无任何标记——改没改、生效没生效
            无法分辨（本变更要解决的感知缺口）。
          </StateNote>
        </div>

        {/* 态二：部分暂存 */}
        <div data-state-panel="partial" className={CHROME} style={{ display: "none" }}>
          <ConfigBar
            s={{
              provider: "DeepSeek 官方",
              model: "deepseek-v4",
              thinking: "中",
              profile: "极速变更档案",
              pending: ["provider", "model"],
            }}
          />
          <StateNote>
            <strong>改了供应商 + 模型</strong>：两控件亮 brand 描边 + 浅底
            （悬停提示「已记住，将随下一条消息发送时生效」）；未改的思考档位/
            档案无标记。显示值即暂存值（2026-10-26 displayProviderId 派生已有）。
          </StateNote>
        </div>

        {/* 态三：全部暂存 */}
        <div data-state-panel="all" className={CHROME} style={{ display: "none" }}>
          <ConfigBar
            s={{
              provider: "本机默认",
              model: "默认（跟随供应商配置）",
              thinking: "高",
              profile: "未指定",
              pending: "all",
            }}
          />
          <StateNote>
            <strong>四控件全改</strong>：逐控件各自亮标，无常驻汇总行（用户
            裁决「只逐控件标记」）；发送成功后标记全部消失、配置条回显新生效值。
          </StateNote>
        </div>

        {/* 态四：askuser 待答场景 */}
        <div data-state-panel="askuser" className={CHROME} style={{ display: "none" }}>
          <AskUserGhost />
          <ConfigBar
            s={{
              provider: "智谱 BigModel",
              model: "GLM-5.3",
              thinking: "高",
              profile: "极速变更档案",
              pending: ["thinking"],
            }}
          />
          <StateNote>
            <strong>askuser 待答</strong>：输入框位置被问答卡替换（既有互斥
            行为不变），底部配置条保留且可点选暂存——本例问答期间把思考档位
            调成「高」，控件亮「待生效」。提交回答后 AI 无缝继续（当前段用旧
            配置跑完，不打断），下一条消息自动用新档位。
          </StateNote>
        </div>
      </div>
    </div>
  );
}

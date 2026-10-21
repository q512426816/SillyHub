"use client";

/**
 * dev-only 预览路由：轮级「文件变更卡」（形态原型，桩数据）——
 * 2026-10-20-session-page-dsh-alignment 线 C / D-023 的形态验证页。
 *
 * 目的只有一个：在**假的正交上下文**里判断这张卡的节奏与尺度——三块「一轮的答复 +
 * 卡」，分别压折叠态（8 文件）、展开态（3 文件）、降级态（快照超时 + 工作区共享），
 * 外加一个 100 文件长列表（按钮后展开）看限高内滚与溢出。
 *
 * 边界：dev-only——不进导航、不被产品页面引用、无 middleware 守卫（与
 * /proto/session-redesign、/proto/session-trajectory 同一边界，D-010）；
 * 无 fetch / store：数据全在本文件，卡组件本身 props only。
 */

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { FileChangesCard, type ChangedFile } from "@/components/daemon/file-changes/file-changes-card";

/* ───────────────────────────── 桩数据 ───────────────────────────── */

/** 第 16 轮：折叠态，8 文件 / +230 −8，其中一个文件来自命令行（git 快照归因）。 */
const TURN_16_FILES: ChangedFile[] = [
  { path: "frontend/src/components/daemon/turn-timeline.tsx", adds: 128, dels: 4, edits: 3, source: "tool" },
  { path: "frontend/src/components/daemon/turn-segment-views.tsx", adds: 46, dels: 2, edits: 2, source: "tool" },
  { path: "frontend/src/app/globals.css", adds: 18, dels: 0, edits: 1, source: "tool" },
  { path: "frontend/src/components/daemon/file-changes/file-changes-card.tsx", adds: 24, dels: 0, edits: 1, source: "tool" },
  { path: "frontend/src/app/proto/session-file-changes/page.tsx", adds: 10, dels: 0, edits: 1, source: "tool" },
  { path: "frontend/e2e/proto-file-card.spec.ts", adds: 4, dels: 0, edits: 1, source: "tool" },
  { path: "scripts/prototype-build.mjs", adds: 0, dels: 1, edits: 1, source: "tool" },
  { path: "frontend/package.json", adds: 0, dels: 1, edits: 1, source: "shell" },
];

/** 第 17 轮：展开态，3 文件 / +12 −3。 */
const TURN_17_FILES: ChangedFile[] = [
  { path: "frontend/src/components/daemon/file-changes/file-changes-card.tsx", adds: 9, dels: 2, edits: 3, source: "tool" },
  { path: "frontend/src/app/proto/session-file-changes/page.tsx", adds: 3, dels: 0, edits: 2, source: "tool" },
  { path: "frontend/src/app/globals.css", adds: 0, dels: 1, edits: 1, source: "tool" },
];

/** 第 18 轮：快照超时（truncated）+ 共享工作区。全 tool，避免与第 16 轮的「命令行」徽标重数。 */
const TURN_18_FILES: ChangedFile[] = [
  { path: "sillyhub-daemon/src/workspace/turn-file-snapshot.ts", adds: 62, dels: 0, edits: 2, source: "tool" },
  { path: "sillyhub-daemon/src/runs/turn-runner.ts", adds: 31, dels: 6, edits: 3, source: "tool" },
  { path: "backend/app/api/routes/runs.py", adds: 22, dels: 4, edits: 2, source: "tool" },
  { path: "backend/app/schemas/run.py", adds: 14, dels: 0, edits: 1, source: "tool" },
  { path: "frontend/src/components/daemon/file-changes/file-changes-card.tsx", adds: 0, dels: 0, edits: 1, source: "tool" },
  { path: "frontend/src/app/proto/session-file-changes/page.tsx", adds: 9, dels: 2, edits: 2, source: "tool" },
  { path: "frontend/src/lib/api-types.ts", adds: 6, dels: 0, edits: 1, source: "tool" },
  { path: "frontend/src/components/daemon/session-panel/session-panel-page.tsx", adds: 5, dels: 1, edits: 1, source: "tool" },
  { path: "frontend/src/components/daemon/turn-timeline.tsx", adds: 4, dels: 0, edits: 1, source: "tool" },
  { path: "docs/session-page-dsh-alignment.md", adds: 3, dels: 0, edits: 1, source: "tool" },
  { path: "scripts/prototype-build.mjs", adds: 2, dels: 1, edits: 1, source: "tool" },
  { path: "frontend/package.json", adds: 1, dels: 0, edits: 1, source: "tool" },
];

/** 第 19 轮：100 文件长列表（看限高内滚/溢出；第 13 个起戳一个 shell 归因）。 */
const TURN_19_FILES: ChangedFile[] = Array.from({ length: 100 }, (_, index) => ({
  path: `frontend/src/components/daemon/session-panel/generated/part-${String(index + 1).padStart(3, "0")}.tsx`,
  adds: (index * 7) % 31,
  dels: index % 6 === 0 ? 0 : index % 5,
  edits: 1 + (index % 4),
  source: index % 13 === 12 ? ("shell" as const) : ("tool" as const),
}));

/* ───────────────────────────── 页面件 ───────────────────────────── */

type ThemeName = "ai-native" | "blue" | "dark";

const THEMES: ThemeName[] = ["ai-native", "blue", "dark"];

/** 一轮的答复正文（两行）+ 卡。纯排版，用来给卡找「正文 → 卡」的节奏参照。 */
function TurnBlock({ lines, children }: { lines: string[]; children: ReactNode }) {
  return (
    <section className="mt-8 first:mt-6">
      <div className="space-y-2.5">
        {lines.map((line) => (
          <p key={line} className="max-w-[52rem] text-[14.5px] leading-[1.78] text-foreground">
            {line}
          </p>
        ))}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default function SessionFileChangesProtoPage() {
  const [openedFile, setOpenedFile] = useState<string | null>(null);
  const [showLongList, setShowLongList] = useState(false);
  const [theme, setTheme] = useState<ThemeName | null>(null);

  // 主题按钮只改 html[data-theme]（三层主题变量块见 globals.css），不落 localStorage：
  // 这是 dev 预览的临时换肤，离开页面后由布局的首帧脚本按存储值恢复。
  useEffect(() => {
    if (!theme) return;
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const handleOpenFile = (path: string) => {
    setOpenedFile(path);
    // 便于 playwright / 手测确认回调真的由行点击触发（不是页面自渲染）。
    console.log(`[proto] onOpenFile: ${path}`);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-[860px] px-6 py-6">
        {/* dev chrome：出身声明 + 为什么这样 + 回调观测点 + 三主题换肤 */}
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12px] font-semibold text-foreground">
              dev 预览 · 文件变更卡（形态原型，桩数据）
            </p>
            <div className="flex items-center gap-1" role="group" aria-label="预览主题">
              {THEMES.map((name) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={theme === name}
                  onClick={() => setTheme(name)}
                  className={
                    theme === name
                      ? "rounded border border-brand-400 bg-brand-50 px-1.5 py-0.5 font-mono text-[10.5px] text-brand-700"
                      : "rounded border border-border px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground transition-colors hover:bg-muted"
                  }
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-1.5 text-[11.5px] leading-[1.7] text-muted-foreground">
            为什么这样：改动按轮归属，一轮一张卡，卡外不再重复列文件；逐文件 +/− 以 git
            快照（numstat）为准，Edit/Write 的补丁只用于把文件归因到工具，shell/脚本改动由快照补全。快照超时降级为只报文件数、行级统计显示破折号；工作区由多会话共享时恒提示可能含并行改动。
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
            <span className="shrink-0">onOpenFile →</span>
            <code
              data-testid="open-file-log"
              className="min-w-0 break-all rounded bg-muted px-1 py-px font-mono text-[11px] text-foreground"
            >
              {openedFile ?? "（尚未点击）"}
            </code>
          </p>
        </div>

        <TurnBlock
          lines={[
            "我把文件变更卡的三种形态都摆了一遍：折叠、展开、快照超时。先看折叠态。",
            "它应该只占一行，像正文后面的一句脚注——8 个文件、+230 −8，扫一眼就知道这轮干了多大。",
          ]}
        >
          <FileChangesCard
            files={TURN_16_FILES}
            turnNo={16}
            startExpanded
            onOpenFile={handleOpenFile}
          />
        </TurnBlock>

        <TurnBlock
          lines={[
            "展开后要能一眼扫到「改了哪些文件、每个改了几次」，而不是再点进工具调用里翻。",
            "行高压到 24px、路径单行截断、右侧数字固定列对齐；shell 改出来的文件单独挂个徽标，避免把脚本改动算到工具头上。",
          ]}
        >
          <FileChangesCard
            files={TURN_17_FILES}
            turnNo={17}
            startExpanded
            onOpenFile={handleOpenFile}
          />
        </TurnBlock>

        <TurnBlock
          lines={[
            "最后是最坏情况：快照采集超时，只拿得到文件清单，拿不到逐文件行数。",
            "这时不该假装精确——只报文件数，行级统计留破折号；同时提醒工作区是共享的，数字里可能混着并行会话的改动。",
          ]}
        >
          <FileChangesCard
            files={TURN_18_FILES}
            turnNo={18}
            truncated
            sharedWorkspace
            onOpenFile={handleOpenFile}
          />
        </TurnBlock>

        {/* 100 文件长列表：按钮后才出现，专门看限高内滚与溢出。 */}
        <div className="mt-8 rounded-md border border-dashed border-border px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-foreground">长列表压测</p>
              <p className="mt-0.5 text-[11px] leading-[1.6] text-muted-foreground">
                第 19 轮 · 100 个文件：列表限高 240px 内滚（可视 10 行），头部不随滚动移出。
              </p>
            </div>
            <button
              type="button"
              data-testid="toggle-long-list"
              aria-expanded={showLongList}
              onClick={() => setShowLongList((value) => !value)}
              className="inline-flex h-7 shrink-0 items-center rounded-md border border-border bg-card px-2.5 text-[11.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {showLongList ? "收起 100 文件用例" : "展开 100 文件用例"}
            </button>
          </div>
          {showLongList && (
            <div className="mt-3">
              <FileChangesCard
                files={TURN_19_FILES}
                turnNo={19}
                startExpanded
                onOpenFile={handleOpenFile}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

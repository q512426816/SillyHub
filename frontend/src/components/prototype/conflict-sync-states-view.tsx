/**
 * prototype-as-code 演示视图 —— 同步冲突状态（change 2026-10-16-conflict-full-tree-compare）。
 *
 * 本次改动涉及的三个界面态，供评审定稿：
 *   ① 冲突行新增「标记已处理」——平台侧关闭注册表 open 行的入口（复用 POST /spec-conflicts/{id}/resolve）
 *   ② 对比弹窗失败卡按错误码分支三态——不再统一写死「机器可能离线或超时（504）」
 *   ③ 兜底命中 full-tree 记录时的来源提示条 + 该变更范围内的对比体
 *
 * 真码方言：Tailwind + themes.ts token（零硬编码色，徽章沿用生产同类 class）；
 * fixture 假数据；scripts/prototype-build.mjs 编译为独立 HTML。
 */
import * as React from "react";

import { DemoBar } from "./demo-chrome";

const CHANGE = "2026-10-13-fire-unitadd-form-import";

function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** 冲突行（平台同步区块）：新增「标记已处理」与「查看对比」并排。 */
function ConflictRow() {
  return (
    <div className="rounded-lg border" style={{ borderColor: "hsl(var(--border))" }}>
      <div className="flex items-center justify-between border-b px-4 py-2 text-xs text-muted-foreground">
        <span>未决同步冲突 · 1</span>
        <span>数据可能过期</span>
      </div>
      <ul>
        <li className="border-b px-4 py-3 last:border-b-0" data-testid="row">
          <div className="flex flex-wrap items-center gap-2">
            <span className="shrink-0 rounded bg-violet-100 px-1 text-[10px] leading-4 text-violet-700">
              spec
            </span>
            <code className="break-all font-mono text-[13px] font-semibold">{CHANGE}</code>
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              冲突发生于 3 天前
            </span>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                className="h-8 rounded-md border px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
                style={{ borderColor: "hsl(var(--border))" }}
              >
                查看对比
              </button>
              <button
                type="button"
                className="h-8 rounded-md border px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
                style={{ borderColor: "hsl(var(--border))" }}
                data-testid="mark-resolved"
              >
                标记已处理
              </button>
            </div>
          </div>
        </li>
      </ul>
      <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
        「标记已处理」仅关闭平台侧这条冲突行（用于记录已失效、只剩平台行滞留的场景）；本机文件级冲突仍需重新同步/裁决收敛。
      </p>
    </div>
  );
}

/** 对比弹窗失败卡：按 daemon_code 分支（本次改动②）。 */
function FailureCard({
  tag,
  title,
  body,
  serverMessage,
  actions,
}: {
  tag: string;
  title: string;
  body: string;
  serverMessage?: string;
  actions: "retry" | "close";
}) {
  return (
    <div
      className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-lg border p-6 text-center"
      style={{ borderColor: "hsl(var(--border))" }}
    >
      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
        {tag}
      </span>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="max-w-md text-xs leading-5 text-muted-foreground">{body}</p>
      {serverMessage ? (
        <p className="max-w-md break-all text-[11px] text-muted-foreground/70">
          服务端消息：{serverMessage}
        </p>
      ) : null}
      <div className="flex gap-2">
        {actions === "retry" ? (
          <button
            type="button"
            className="h-8 rounded-md border px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            重试
          </button>
        ) : null}
        <button
          type="button"
          className="h-8 rounded-md border px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          关闭
        </button>
      </div>
    </div>
  );
}

export function ConflictSyncStatesView() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <DemoBar />
      <main className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-xl font-semibold">
          同步冲突状态 · 原型（2026-10-16-conflict-full-tree-compare）
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          覆盖本次三个界面态：行级关闭入口、失败卡按错误码分支、full-tree 兜底命中的来源提示。
        </p>

        <Section
          title="① 冲突行：新增「标记已处理」"
          desc="注册表 open 行此前只能等下一次同步全绿自动关闭（刷新永不消失）；新按钮直接关闭该行，仅机器所有者/平台管理员可见。"
        >
          <ConflictRow />
        </Section>

        <Section
          title="② 对比失败卡：按 daemon_code 分支（三态对照）"
          desc="原卡片对所有失败统一写「机器可能离线或对比读取超时（504）」，与真实失败原因不符；改为按错误码分支。"
        >
          <div className="grid gap-4 md:grid-cols-3">
            <FailureCard
              tag="conflict_record_missing"
              title="读取对比数据失败"
              body="该冲突在本机已无快照（可能已随同步清理或已裁决），请重新同步后再试。若确认该冲突已处理，可在冲突行点「标记已处理」关闭平台记录。"
              serverMessage="冲突记录不存在：spec-sync-conflict-2026-10-13-fire-unitadd-form-import.json"
              actions="close"
            />
            <FailureCard
              tag="workspace_root_unknown"
              title="读取对比数据失败"
              body="该工作区尚未被本机认领，请先在该工作区发起一次会话后重试。"
              actions="close"
            />
            <FailureCard
              tag="offline / timeout"
              title="读取对比数据失败"
              body="机器当前离线或响应超时（504），请确认数据源机器在线后重试。"
              actions="retry"
            />
          </div>
        </Section>

        <Section
          title="③ 兜底命中：来源提示 + 变更范围内对比"
          desc="后端在 <change> 记录缺失时以 full-tree 记录兜底，仅展示属于该变更的路径；顶部小字说明数据来源，主体对比照常。"
        >
          <div
            className="rounded-lg border"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            <div className="flex items-center gap-2 border-b px-4 py-2.5 text-sm">
              <span className="font-medium">冲突对比</span>
              <span className="rounded bg-violet-100 px-1 text-[10px] leading-4 text-violet-700">
                spec 树
              </span>
              <code className="font-mono text-xs text-muted-foreground">{CHANGE}</code>
            </div>
            <p
              className="border-b px-4 py-1.5 text-xs"
              style={{
                borderColor: "hsl(var(--border))",
                backgroundColor: "hsl(var(--muted))",
              }}
            >
              该记录由全量同步产生（覆盖 2 个变更），本次仅展示与{" "}
              <code className="font-mono">{CHANGE}</code> 相关的 4 个路径。
            </p>
            <div className="grid gap-0 md:grid-cols-[16rem_1fr]">
              <div className="border-b p-3 text-xs md:border-b-0 md:border-r">
                <div className="mb-2 text-muted-foreground">涉及 4 个文件，其中归档 4 个</div>
                <ul className="flex flex-col gap-1.5">
                  {["design.md", "proposal.md", "requirements.md", "tasks.md"].map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <span className="rounded bg-warning/15 px-1 text-[10px] leading-4 text-warning">
                        差异
                      </span>
                      <code className="font-mono text-[12px]">{f}</code>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="p-3 text-xs">
                <div className="mb-2 text-muted-foreground">
                  design.md · 本地 ↔ 平台 行级对比（示意）
                </div>
                <div
                  className="rounded border p-2 font-mono text-[11px] leading-5"
                  style={{ borderColor: "hsl(var(--border))" }}
                >
                  <div className="text-success">+ 本地新增行（第 42 行）</div>
                  <div className="text-muted-foreground">  上下文行</div>
                  <div className="text-error">- 平台已有旧行（第 43 行）</div>
                </div>
              </div>
            </div>
          </div>
        </Section>

        <Section
          title="④ 「标记已处理」二次确认"
          desc="沿用 modal.confirm 先例（裁决确认同款形态），确认后该行从列表消失。"
        >
          <div
            className="mx-auto max-w-md rounded-lg border p-4 text-[13px] leading-6"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            <p className="text-sm font-semibold">关闭该冲突记录？</p>
            <p className="mt-2">
              变更{" "}
              <code className="rounded border bg-muted px-1.5 py-px font-mono text-xs">
                {CHANGE}
              </code>{" "}
              的平台冲突行将被标记为已处理并从列表移除。该操作不修改本机文件；若冲突其实仍存在，下次同步会重新登记。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="h-8 rounded-md border px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
                style={{ borderColor: "hsl(var(--border))" }}
              >
                取消
              </button>
              <button
                type="button"
                className="h-8 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                标记已处理
              </button>
            </div>
          </div>
        </Section>
      </main>
    </div>
  );
}

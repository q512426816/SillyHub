"use client";

/**
 * structured-views — 固定结构文件的可视化视图（ql-20260917-004）。
 *
 * 变更目录里的 scope-audit.json / apply-manifest.json / verify-facts.json /
 * scope-audit.patch 等产物结构固定，纯文本 dump 对人类不友好。本模块提供
 * 共享视图，内联预览（change-file-tree FilePreview）与全屏弹窗
 * （previewers/json/patch）共用同一渲染，不做两套：
 * - JsonView：JSON.parse 后的递归折叠树——键/值按类型着色（主题语义
 *   token），对象/数组可折叠，默认展开前两层，长字符串（sha256）截断。
 * - DiffView：unified diff 红绿渲染——解析复用 git-log/file-tree 的
 *   parseUnifiedDiff（维护双侧行号），行样式对齐 scope-file-diff-modal
 *   （add 绿底/del 红底/hunk muted）；增量懒加载（首屏 2000 行 + 触底/
 *   点击续渲染，ql-20260917-010 起无总量上限）。
 * - knownJsonView：三个固定结构报告文件的表格摘要视图分发（ql-20260917-010）
 *   ——scope-audit（裁决徽章+文件表格）、apply-manifest（哈希清单）、
 *   verify-facts（探针/测试/一致性/移交）；文件名+结构特征不命中回落 JsonView。
 *
 * 视图自身不限高：垂直滚动交给外层容器（内联 flex 链 / 全屏弹窗 body），
 * 仅横向在 DiffView 行容器出滚动条。
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { parseUnifiedDiff } from "@/components/git-log/file-tree";
import { cn } from "@/lib/utils";

// ── JSON 视图 ─────────────────────────────────────────────────────────

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** 尝试解析；失败返回 null（调用方回落纯文本）。 */
export function tryParseJson(text: string): JsonValue | null {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return null;
  }
}

/** 折叠态摘要：对象/数组给计数，原始值给截断字面量。 */
function summaryOf(v: JsonValue): string {
  if (Array.isArray(v)) return `[ … ] ${v.length} 项`;
  if (v !== null && typeof v === "object") return `{ … } ${Object.keys(v).length} 键`;
  return literalOf(v);
}

function literalOf(v: string | number | boolean | null): string {
  if (typeof v === "string") return `"${v.length > 48 ? v.slice(0, 48) + "…" : v}"`;
  return String(v);
}

function valueClass(v: string | number | boolean | null): string {
  if (typeof v === "string") return "text-success";
  if (typeof v === "number") return "text-primary";
  if (typeof v === "boolean") return "text-warning";
  return "italic text-muted-foreground"; // null
}

/** 原始值行：`键: "值"`（键可缺省——数组元素）。 */
function PrimitiveRow({ k, v }: { k?: string; v: string | number | boolean | null }) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5 py-px font-mono text-xs leading-relaxed">
      {k !== undefined && <span className="shrink-0 font-medium text-foreground">{k}:</span>}
      <span className={cn("min-w-0 truncate", valueClass(v))} title={typeof v === "string" ? v : undefined}>
        {literalOf(v)}
      </span>
    </div>
  );
}

/** 对象/数组节点行：折叠按钮 + 键 + 结构摘要，展开时缩进渲染子节点。 */
function BranchNode({ k, v, depth }: { k?: string; v: JsonValue[] | { [key: string]: JsonValue }; depth: number }) {
  // 默认展开前两层（root=0），更深层折叠——大文件（files 数组等）不一次铺满
  const [open, setOpen] = useState(depth < 2);
  const entries = useMemo(() => {
    if (Array.isArray(v)) return v.map((item, i) => [String(i), item] as const);
    return Object.entries(v);
  }, [v]);

  const label = Array.isArray(v) ? `[ ]` : `{ }`;

  return (
    <div className="min-w-0" data-testid="json-branch">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-w-0 items-baseline gap-1 rounded py-px text-left font-mono text-xs leading-relaxed hover:bg-muted/60"
        aria-expanded={open}
      >
        <ChevronRight
          className={cn("h-3 w-3 shrink-0 self-center text-muted-foreground transition-transform", open && "rotate-90")}
          aria-hidden
        />
        {k !== undefined && <span className="shrink-0 font-medium text-foreground">{k}:</span>}
        <span className="shrink-0 text-muted-foreground">{label}</span>
        {!open && <span className="min-w-0 truncate text-muted-foreground">{summaryOf(v)}</span>}
      </button>
      {open && entries.length > 0 && (
        <div className="ml-1 border-l border-border pl-3">
          {entries.map(([ck, cv]) =>
            Array.isArray(cv) || (cv !== null && typeof cv === "object") ? (
              <BranchNode key={ck} k={ck} v={cv} depth={depth + 1} />
            ) : (
              <PrimitiveRow key={ck} k={ck} v={cv} />
            ),
          )}
        </div>
      )}
      {open && entries.length === 0 && (
        <div className="ml-1 border-l border-border pl-3 font-mono text-xs text-muted-foreground">（空）</div>
      )}
    </div>
  );
}

/**
 * JSON 可视化视图。输入原始文本（内部 parse），解析失败由调用方回落纯文本。
 */
export function JsonView({ value }: { value: JsonValue }) {
  if (Array.isArray(value) || (value !== null && typeof value === "object")) {
    return (
      <div data-testid="json-view" className="min-w-0 p-1 font-mono">
        <BranchNode v={value} depth={0} />
      </div>
    );
  }
  // 顶层是原始值（少见）：单行呈现
  return (
    <div data-testid="json-view" className="p-1">
      <PrimitiveRow v={value} />
    </div>
  );
}

// ── unified diff 视图 ─────────────────────────────────────────────────

/**
 * 增量渲染步长（ql-20260917-010）：首屏渲染 2000 行，滚动触底（或点击
 * 兜底按钮）自动续渲染——不再设总量上限，超大 diff 也不会一次性铺满 DOM。
 */
const DIFF_RENDER_STEP = 2000;

/** 懒加载哨兵提前触发的余量（视口外 600px 即开始续渲染，减少等待）。 */
const DIFF_SENTINEL_ROOT_MARGIN = "600px";

/**
 * unified diff 可视化视图（scope-audit.patch 等）。解析复用
 * parseUnifiedDiff；无 hunk（非 diff 格式）时渲染原始文本不炸。
 */
export function DiffView({ content }: { content: string }) {
  const lines = useMemo(() => parseUnifiedDiff(content), [content]);
  // 增量渲染：content 切换重置；触底（IntersectionObserver/点击）续加一步
  const [visible, setVisible] = useState(DIFF_RENDER_STEP);
  const sentinelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setVisible(DIFF_RENDER_STEP);
  }, [content]);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || visible >= lines.length) return;
    if (typeof IntersectionObserver === "undefined") return; // jsdom 等
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible((v) => Math.min(v + DIFF_RENDER_STEP, lines.length));
        }
      },
      { rootMargin: DIFF_SENTINEL_ROOT_MARGIN },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, lines.length]);

  if (lines.length === 0) {
    return (
      <pre
        data-testid="diff-view-raw"
        className="min-w-0 flex-1 overflow-auto rounded-md border border-input bg-background p-3 font-mono text-xs leading-relaxed whitespace-pre"
      >
        {content || "（空文件）"}
      </pre>
    );
  }
  const remaining = lines.length - visible;
  return (
    <div
      data-testid="diff-view"
      className="min-w-0 flex-1 overflow-x-auto rounded-md border bg-card font-mono text-xs leading-relaxed"
    >
      {lines.slice(0, visible).map((l, i) =>
        l.kind === "hunk" ? (
          <div key={i} className="bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground">
            {l.text}
          </div>
        ) : (
          <div
            key={i}
            data-diff-kind={l.kind}
            className={cn(
              "flex whitespace-pre",
              l.kind === "add"
                ? "bg-success/10 text-success"
                : l.kind === "del"
                  ? "bg-error/10 text-error"
                  : "text-muted-foreground",
            )}
          >
            <span className="w-10 flex-none select-none pr-2 text-right text-[11px] text-muted-foreground/70">
              {l.oldNo ?? ""}
            </span>
            <span className="w-10 flex-none select-none pr-2 text-right text-[11px] text-muted-foreground/70">
              {l.newNo ?? ""}
            </span>
            <span className="flex-1 py-0.5 pl-1 pr-3">{l.text}</span>
          </div>
        ),
      )}
      {remaining > 0 && (
        <button
          ref={sentinelRef}
          type="button"
          data-testid="diff-view-more"
          className="w-full border-t border-border bg-muted/40 px-2.5 py-2 text-[11px] text-muted-foreground hover:bg-muted"
          onClick={() => setVisible((v) => Math.min(v + DIFF_RENDER_STEP, lines.length))}
        >
          已渲染 {visible}/{lines.length} 行，滚动自动加载更多（点击立即加载下 {DIFF_RENDER_STEP} 行）
        </button>
      )}
    </div>
  );
}

// ── 固定结构 JSON 表格视图（ql-20260917-010）──────────────────────────
//
// scope-audit / apply-manifest / verify-facts 是 sillyspec 产出的固定结构
// 报告文件，折叠树对人类不友好——按文件名 + 结构特征分发到专用摘要视图；
// 不命中（结构漂移/其他 json）回落 JsonView 折叠树。

/** full-flow 裁决徽章（label/配色与变更中心 scope-audit-command-card 同款）。 */
const VERDICT_BADGE: Record<string, { label: string; className: string }> = {
  planned: { label: "✓ 计划内", className: "bg-success/15 text-success" },
  unplanned: { label: "⚠️ 计划外", className: "bg-warning/15 text-warning" },
  untouched: { label: "⚠️ 计划未动", className: "bg-muted text-muted-foreground" },
};

/** 文件改动类型中文（scope-audit rows.kind 值域：modified/new/deleted）。 */
const KIND_LABEL: Record<string, string> = {
  modified: "修改",
  new: "新增",
  deleted: "删除",
};

type JsonRecord = { [key: string]: JsonValue };

function isRecord(v: JsonValue | undefined): v is JsonRecord {
  return v !== undefined && v !== null && typeof v === "object" && !Array.isArray(v);
}

/** 摘要行：`标签 值` 的紧凑键值条（哈希等长值截断 + title 全量）。 */
function MetaItem({ label, value, mono, title }: { label: string; value: string; mono?: boolean; title?: string }) {
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 truncate font-medium text-foreground", mono && "font-mono text-[11px]")} title={title ?? value}>
        {value}
      </span>
    </span>
  );
}

/** 小节标题（verify-facts 报告分段用）。 */
function SectionTitle({ children }: { children: string }) {
  return <h4 className="mb-1.5 mt-4 text-xs font-semibold text-foreground">{children}</h4>;
}

/** 通用表格壳：粘性表头 + 行分隔，语义 token 配色。 */
function DataTable({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="bg-muted/50">
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-2.5 py-1.5 font-medium text-muted-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** scope-audit.json：审计摘要 + 文件裁决表格。 */
function ScopeAuditView({ value }: { value: JsonRecord }) {
  const totals = isRecord(value.totals) ? value.totals : {};
  const rows = Array.isArray(value.rows)
    ? (value.rows as JsonValue[]).filter(isRecord)
    : [];
  const num = (v: JsonValue | undefined) => (typeof v === "number" ? v : 0);
  return (
    <div data-testid="scope-audit-view" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md bg-muted/40 px-3 py-2 text-xs">
        <MetaItem label="模式" value={typeof value.mode === "string" ? value.mode : "—"} />
        <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", value.ok ? "bg-success/15 text-success" : "bg-error/15 text-error")}>
          {value.ok ? "✓ 审计通过" : "✗ 审计未通过"}
        </span>
        <MetaItem label="文件" value={String(num(totals.files))} />
        <span className="text-success">+{num(totals.additions)}</span>
        <span className="text-error">−{num(totals.deletions)}</span>
        {typeof value.baseAnchor === "string" && (
          <MetaItem label="锚点" value={value.baseAnchor.slice(0, 12) + "…"} mono title={value.baseAnchor} />
        )}
        {value.degradedReason != null && typeof value.degradedReason === "string" && (
          <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[11px] text-warning">降级：{value.degradedReason}</span>
        )}
      </div>
      <DataTable head={["裁决", "类型", "文件路径", "+ 新增", "− 删除"]}>
        {rows.map((r, i) => {
          const verdict = typeof r.verdict === "string" ? VERDICT_BADGE[r.verdict] : undefined;
          return (
            <tr key={i} className="border-t border-border align-top">
              <td className="px-2.5 py-1.5">
                {verdict ? (
                  <span className={cn("whitespace-nowrap rounded px-1.5 py-0.5 text-[11px]", verdict.className)}>
                    {verdict.label}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="whitespace-nowrap px-2.5 py-1.5 text-muted-foreground">
                {typeof r.kind === "string" ? (KIND_LABEL[r.kind] ?? r.kind) : "—"}
              </td>
              <td className="px-2.5 py-1.5 font-mono text-[11px] break-all">
                {typeof r.path === "string" ? r.path : "—"}
              </td>
              <td className="px-2.5 py-1.5 text-right font-mono text-success">{num(r.additions) || ""}</td>
              <td className="px-2.5 py-1.5 text-right font-mono text-error">{num(r.deletions) || ""}</td>
            </tr>
          );
        })}
      </DataTable>
    </div>
  );
}

/** apply-manifest.json：应用清单摘要 + 文件哈希表格。 */
function ApplyManifestView({ value }: { value: JsonRecord }) {
  const files = Array.isArray(value.files) ? (value.files as JsonValue[]).filter(isRecord) : [];
  return (
    <div data-testid="apply-manifest-view" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md bg-muted/40 px-3 py-2 text-xs">
        {typeof value.change === "string" && <MetaItem label="变更" value={value.change} mono />}
        {typeof value.appliedAt === "string" && (
          <MetaItem label="应用时间" value={new Date(value.appliedAt).toLocaleString("zh-CN")} />
        )}
        {typeof value.baseHash === "string" && (
          <MetaItem label="基线哈希" value={value.baseHash.slice(0, 12) + "…"} mono title={value.baseHash} />
        )}
        <MetaItem label="文件数" value={String(files.length)} />
      </div>
      <DataTable head={["#", "文件路径", "sha256"]}>
        {files.map((f, i) => {
          const sha = typeof f.sha256 === "string" ? f.sha256 : "—";
          return (
            <tr key={i} className="border-t border-border">
              <td className="px-2.5 py-1.5 text-right text-muted-foreground">{i + 1}</td>
              <td className="px-2.5 py-1.5 font-mono text-[11px] break-all">{typeof f.path === "string" ? f.path : "—"}</td>
              <td className="px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground" title={sha}>
                {sha === "—" ? sha : sha.slice(0, 16) + "…"}
              </td>
            </tr>
          );
        })}
      </DataTable>
    </div>
  );
}

/** verify-facts.json：验证事实报告（结论徽章 + 探针指标 + 测试 + 移交）。 */
function VerifyFactsView({ value }: { value: JsonRecord }) {
  const conclusion = typeof value.conclusion === "string" ? value.conclusion : "";
  const conclusionClass = conclusion.startsWith("PASS")
    ? "bg-success/15 text-success"
    : conclusion.startsWith("FAIL")
      ? "bg-error/15 text-error"
      : "bg-warning/15 text-warning";
  const probes = isRecord(value.probes) ? value.probes : {};
  const tests = isRecord(value.tests) ? value.tests : null;
  const consistency = isRecord(value.factsConsistency) ? value.factsConsistency : null;
  const handover = isRecord(value.handover) ? value.handover : null;
  const handoverItems = handover && Array.isArray(handover.items) ? (handover.items as JsonValue[]).filter(isRecord) : [];

  return (
    <div data-testid="verify-facts-view" className="flex flex-col">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md bg-muted/40 px-3 py-2 text-xs">
        <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold", conclusionClass)}>{conclusion || "—"}</span>
        {typeof value.change === "string" && <MetaItem label="变更" value={value.change} mono />}
        {typeof value.generatedAt === "string" && (
          <MetaItem label="生成时间" value={new Date(value.generatedAt).toLocaleString("zh-CN")} />
        )}
      </div>

      <SectionTitle>探针指标</SectionTitle>
      <DataTable head={["探针", "命令", "指标"]}>
        {Object.entries(probes).map(([name, p]) => {
          const probe = isRecord(p) ? p : {};
          const metrics = isRecord(probe.metrics) ? probe.metrics : {};
          return (
            <tr key={name} className="border-t border-border align-top">
              <td className="whitespace-nowrap px-2.5 py-1.5 font-medium">{name}</td>
              <td className="px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
                {typeof probe.command === "string" ? probe.command : "—"}
              </td>
              <td className="px-2.5 py-1.5">
                <span className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px]">
                  {Object.entries(metrics).map(([k, v]) => (
                    <span key={k}>
                      <span className="text-muted-foreground">{k}=</span>
                      <span className="font-medium text-foreground">{String(v)}</span>
                    </span>
                  ))}
                </span>
              </td>
            </tr>
          );
        })}
      </DataTable>

      {tests && (
        <>
          <SectionTitle>测试</SectionTitle>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md border border-border px-3 py-2 text-xs">
            {typeof tests.command === "string" && <MetaItem label="命令" value={tests.command} mono />}
            {typeof tests.strategy === "string" && <MetaItem label="策略" value={tests.strategy} />}
            {typeof tests.exitCode === "number" && (
              <span className={cn("rounded px-1.5 py-0.5 text-[11px]", tests.exitCode === 0 ? "bg-success/15 text-success" : "bg-error/15 text-error")}>
                退出码 {tests.exitCode}
              </span>
            )}
            {typeof tests.passedAt === "string" && <MetaItem label="通过时间" value={new Date(tests.passedAt).toLocaleString("zh-CN")} />}
          </div>
        </>
      )}

      {consistency && (
        <>
          <SectionTitle>事实一致性</SectionTitle>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md border border-border px-3 py-2 text-xs">
            <span className={cn("rounded px-1.5 py-0.5 text-[11px]", consistency.verdict === "match" ? "bg-success/15 text-success" : "bg-warning/15 text-warning")}>
              {typeof consistency.verdict === "string" ? consistency.verdict : "—"}
            </span>
            {Array.isArray(consistency.checked) && (
              <MetaItem label="核对探针" value={consistency.checked.map(String).join("、")} />
            )}
            {typeof consistency.detail === "string" && consistency.detail && (
              <MetaItem label="说明" value={consistency.detail} />
            )}
          </div>
        </>
      )}

      {handoverItems.length > 0 && (
        <>
          <SectionTitle>{`移交事项（${handoverItems.length}）`}</SectionTitle>
          <ul className="flex flex-col gap-1.5">
            {handoverItems.map((h, i) => (
              <li key={i} className="rounded-md border border-border px-3 py-1.5 text-xs">
                {typeof h.type === "string" && <span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{h.type}</span>}
                <span className="text-foreground">{typeof h.item === "string" ? h.item : "—"}</span>
                {typeof h.condition === "string" && h.condition && (
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">条件：{h.condition}</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** 已知固定结构 json → 专用视图；不命中返回 null（调用方回落 JsonView）。 */
export function knownJsonView(name: string, value: JsonValue): ReactNode | null {
  const basename = name.split("/").pop() ?? name;
  if (!isRecord(value)) return null;
  if (basename === "scope-audit.json" && Array.isArray(value.rows) && isRecord(value.totals)) {
    return <ScopeAuditView value={value} />;
  }
  if (basename === "apply-manifest.json" && Array.isArray(value.files)) {
    return <ApplyManifestView value={value} />;
  }
  if (basename === "verify-facts.json" && isRecord(value.probes)) {
    return <VerifyFactsView value={value} />;
  }
  return null;
}

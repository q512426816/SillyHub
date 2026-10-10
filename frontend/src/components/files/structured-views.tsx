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
 *   change-patch.json（收口留痕单套清单）同走此分发——对账快照 ScopeAuditView
 *   含跨仓冻结面（2026-10-10-change-patch-cross-repo-view）：scopeAudit.repos[]
 *   按仓分段（锚点 chip/三态 chips/降级 ⚠️）+ rows 跨仓行仓标 + repos[].patch
 *   折叠 diff 正文。
 *
 * 视图自身不限高：垂直滚动交给外层容器（内联 flex 链 / 全屏弹窗 body），
 * 仅横向在 DiffView 行容器出滚动条。
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { parseUnifiedDiff } from "@/components/git-log/file-tree";
import { cn } from "@/lib/utils";

// ── JSON 视图 ─────────────────────────────────────────────────────────

// JsonValue 导出（2026-09-29-change-detail-timeline-files-polish）：消费方
// 测试构造 jsonl 行数组需要显式标注（对象缺键的联合类型不满足索引签名）。
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

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
// scope-audit / change-patch / apply-manifest / verify-facts 是 sillyspec 产出的固定结构
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

/** 仓 key 显示名（CLI 约定 main=主仓；与 scope-audit-command-card 同款）。 */
function repoDisplayName(key: string): string {
  return key === "main" ? "主仓" : key;
}

/** 三态 chips 展示序（计数取 repos[].totals 单一源）。 */
const VERDICT_ORDER = ["planned", "unplanned", "untouched"] as const;

/**
 * 按仓冻结面单仓段（2026-10-10-change-patch-cross-repo-view）：段头=仓标识+锚点
 * chip（anchor.label + base 前 7 位；daemon 链的 anchor_label 短哈希是投影产物，
 * 冻结件没有——前端从 anchor.base 自行短化）+该仓 files/+−；段身=三态 chips 或
 * degraded 整段 ⚠️。patch 面（折叠 diff 正文/未采集留痕）仅非降级段渲染——
 * 「采集失败或空窗」对整仓不可达是误描述。repoPath 字段可能含本机布局，恒不渲染。
 */
function ScopeAuditRepoSeg({ repo, repoKey }: { repo: JsonRecord; repoKey: string }) {
  const [patchOpen, setPatchOpen] = useState(false);
  const anchor = isRecord(repo.anchor) ? repo.anchor : {};
  const anchorLabel = typeof anchor.label === "string" && anchor.label ? anchor.label : null;
  const anchorBase = typeof anchor.base === "string" && anchor.base ? anchor.base.slice(0, 7) : null;
  const totals = isRecord(repo.totals) ? repo.totals : {};
  const num = (v: JsonValue | undefined) => (typeof v === "number" ? v : 0);
  const degraded = repo.degraded === true;
  // producer 契约（additive）：collectPatch=true 才带 patch 两键，旧形态缺键零渲染
  const hasPatchKey = "patch" in repo;
  const patchText = typeof repo.patch === "string" && repo.patch.length > 0 ? repo.patch : null;
  const patchSha = typeof repo.patchSha256 === "string" && repo.patchSha256 ? repo.patchSha256 : null;
  return (
    <div data-testid={`scope-audit-repo-seg-${repoKey}`} className="rounded-md border border-dashed border-border px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className={cn("text-xs font-semibold", repoKey === "main" ? "text-brand-700" : "text-foreground")}>
          {repoDisplayName(repoKey)}
        </span>
        <span className="rounded bg-muted px-1.5 py-px font-mono text-[10px] leading-4 text-muted-foreground">
          {anchorLabel ? `${anchorLabel} ` : ""}
          <span className="font-semibold text-foreground">{anchorBase ?? "—"}</span>
        </span>
        {!degraded && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            {num(totals.files)} 文件{" "}
            <span className="text-success">+{num(totals.additions)}</span> /{" "}
            <span className="text-error">−{num(totals.deletions)}</span>
          </span>
        )}
      </div>
      {degraded ? (
        <p data-testid={`scope-audit-repo-degraded-${repoKey}`} className="mt-1.5 text-[11px] leading-relaxed text-warning">
          ⚠️{" "}
          {typeof repo.degradedReason === "string" && repo.degradedReason
            ? repo.degradedReason
            : "该仓跨仓对账不可达（未注册/路径不可达），请人工到对应仓核对"}
        </p>
      ) : (
        <>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {VERDICT_ORDER.map((verdict) => {
              const meta = VERDICT_BADGE[verdict];
              if (!meta) return null;
              return (
                <span
                  key={verdict}
                  data-testid={`scope-audit-chip-${repoKey}-${verdict}`}
                  className={cn("rounded-full px-2 py-px text-[11px] font-medium", meta.className)}
                >
                  {meta.label} {num(totals[verdict])}
                </span>
              );
            })}
          </div>
          {hasPatchKey &&
            (patchText ? (
              <div className="mt-2">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <button
                    type="button"
                    data-testid={`scope-audit-repo-patch-${repoKey}`}
                    onClick={() => setPatchOpen((o) => !o)}
                    aria-expanded={patchOpen}
                    className="flex items-baseline gap-1 rounded px-1 py-px text-[11px] text-muted-foreground transition-colors hover:bg-muted/60"
                  >
                    <ChevronRight
                      className={cn("h-3 w-3 shrink-0 self-center transition-transform", patchOpen && "rotate-90")}
                      aria-hidden
                    />
                    跨仓 patch 正文（冻结）
                  </button>
                  {patchSha && (
                    <span className="font-mono text-[10px] text-muted-foreground" title={patchSha}>
                      {patchSha.slice(0, 12)}…
                    </span>
                  )}
                </div>
                {patchOpen && (
                  <div className="mt-1.5 flex min-w-0">
                    <DiffView content={patchText} />
                  </div>
                )}
              </div>
            ) : (
              <p data-testid={`scope-audit-repo-patch-missing-${repoKey}`} className="mt-1.5 text-[11px] text-muted-foreground">
                patch 未采集（采集失败或空窗）
              </p>
            ))}
        </>
      )}
    </div>
  );
}

/** scope-audit.json：审计摘要 + 文件裁决表格。 */
function ScopeAuditView({ value }: { value: JsonRecord }) {
  const totals = isRecord(value.totals) ? value.totals : {};
  const rows = Array.isArray(value.rows)
    ? (value.rows as JsonValue[]).filter(isRecord)
    : [];
  // 跨仓冻结面（2026-10-10-change-patch-cross-repo-view）：repos[] 非空数组才分段；
  // 条目须带非空 string key（防御式，非法条目跳过）
  const repos = Array.isArray(value.repos)
    ? (value.repos as JsonValue[])
        .filter(isRecord)
        .filter((r) => typeof r.key === "string" && r.key !== "")
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
                {typeof r.crossRepo === "string" && r.crossRepo !== "" && (
                  <span
                    data-repo-badge={r.crossRepo}
                    className="ml-1.5 inline-block rounded bg-brand-50 px-1 font-sans text-[10px] leading-4 text-brand-700"
                  >
                    {r.crossRepo}
                  </span>
                )}
              </td>
              <td className="px-2.5 py-1.5 text-right font-mono text-success">{num(r.additions) || ""}</td>
              <td className="px-2.5 py-1.5 text-right font-mono text-error">{num(r.deletions) || ""}</td>
            </tr>
          );
        })}
      </DataTable>
      {repos.length > 0 && (
        <>
          <SectionTitle>{`按仓冻结面（${repos.length} 仓）`}</SectionTitle>
          <div className="flex flex-col gap-2">
            {repos.map((repo) => (
              <ScopeAuditRepoSeg key={String(repo.key)} repo={repo} repoKey={String(repo.key)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * change-patch.json：收口留痕单套清单（2026-10-09-close-trace-single-set 起 sillyspec
 * 只落 change.patch + change-patch.json 两件——对账面并入 scopeAudit 子对象；旧归档仍可能
 * 是四件套/双件形态，scope-audit.json 分支保留兜底）。上半=交付清单摘要（顶级键），下半=
 * 对账快照（scopeAudit 子对象复用 ScopeAuditView）。
 */
function ChangePatchView({ value }: { value: JsonRecord }) {
  const totals = isRecord(value.totals) ? value.totals : {};
  const num = (v: JsonValue | undefined) => (typeof v === "number" ? v : 0);
  const files = Array.isArray(value.files) ? (value.files as JsonValue[]).filter((f) => typeof f === "string") : [];
  const patchStatus = value.patchStatus === "ok";
  const scopeAudit = isRecord(value.scopeAudit) ? value.scopeAudit : null;
  const hasAuditFace = scopeAudit !== null && Array.isArray(scopeAudit.rows) && isRecord(scopeAudit.totals);
  return (
    <div data-testid="change-patch-view" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md bg-muted/40 px-3 py-2 text-xs">
        {typeof value.change === "string" && <MetaItem label="变更" value={value.change} mono />}
        <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", patchStatus ? "bg-success/15 text-success" : "bg-warning/15 text-warning")}>
          {patchStatus ? "✓ patch 已冻结" : "⚠️ patch 采集失败"}
        </span>
        <MetaItem label="文件" value={String(num(totals.files) || files.length)} />
        <span className="text-success">+{num(totals.additions)}</span>
        <span className="text-error">−{num(totals.deletions)}</span>
        {typeof value.baseline === "string" && (
          <MetaItem label="baseline" value={value.baseline.slice(0, 12) + "…"} mono title={value.baseline} />
        )}
        {typeof value.head === "string" && (
          <MetaItem label="head" value={value.head.slice(0, 12) + "…"} mono title={value.head} />
        )}
        {typeof value.patchSha256 === "string" && (
          <MetaItem label="sha256" value={value.patchSha256.slice(0, 12) + "…"} mono title={value.patchSha256} />
        )}
        {typeof value.savedAt === "string" && (
          <MetaItem label="冻结时间" value={new Date(value.savedAt).toLocaleString("zh-CN")} />
        )}
      </div>
      <DataTable head={["#", "交付文件"]}>
        {files.slice(0, 500).map((f, i) => (
          <tr key={i} className="border-t border-border">
            <td className="px-2.5 py-1.5 text-right text-muted-foreground">{i + 1}</td>
            <td className="px-2.5 py-1.5 font-mono text-[11px] break-all">{String(f)}</td>
          </tr>
        ))}
      </DataTable>
      {hasAuditFace && scopeAudit ? (
        <>
          <SectionTitle>范围对账快照</SectionTitle>
          <ScopeAuditView value={scopeAudit} />
        </>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          无 scopeAudit 对账面（旧形态冻结件或纯清单收口）——完整对账表走变更中心 scope-audit 查询。
        </p>
      )}
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
  // change-patch.json（收口留痕单套清单，2026-10-09 起）：files 数组=清单面特征；
  // scopeAudit 子对象在场则叠加对账快照视图
  if (basename === "change-patch.json" && Array.isArray(value.files)) {
    return <ChangePatchView value={value} />;
  }
  if (basename === "apply-manifest.json" && Array.isArray(value.files)) {
    return <ApplyManifestView value={value} />;
  }
  if (basename === "verify-facts.json" && isRecord(value.probes)) {
    return <VerifyFactsView value={value} />;
  }
  return null;
}

// ── JSONL 视图（2026-09-29-change-detail-timeline-files-polish）─────────
//
// watcher-events.jsonl 等 jsonl 产物此前全屏落 fallback / 内联落纯文本——
// 逐行 JSON 结构其实固定。范式与 knownJsonView 一致：已知固定结构
// （watcher-events.jsonl）走专用表格视图，其余合法 jsonl 走通用逐行折叠树，
// 非法（任一行 parse 失败）由调用方回落纯文本。

/**
 * 逐行解析 jsonl。返回行值数组（空行跳过）；任一非空行非法返回 null
 * （调用方回落纯文本——半结构化文件不装作可结构化）。
 */
export function tryParseJsonl(text: string): JsonValue[] | null {
  const out: JsonValue[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as JsonValue);
    } catch {
      return null;
    }
  }
  return out.length > 0 ? out : null;
}

/** 通用 jsonl 视图：每行一个折叠块（行号 + 该行 JsonView 树，行级缩进隔开）。 */
export function JsonlView({ lines }: { lines: JsonValue[] }) {
  return (
    <div data-testid="jsonl-view" className="flex min-w-0 flex-col gap-1.5 p-1">
      {lines.map((v, i) => (
        <div key={i} className="min-w-0 rounded border-l-2 border-border pl-2">
          <div className="flex min-w-0 items-baseline gap-1.5 font-mono text-[10px] text-muted-foreground/70">
            第 {i + 1} 行
          </div>
          <JsonView value={v} />
        </div>
      ))}
    </div>
  );
}

/** watcher-events.jsonl kind → 中文徽章（对齐 CLI watcher 语义与时间线卡图标面）。 */
const WATCHER_KIND_BADGE: Record<string, { label: string; className: string }> = {
  file: { label: "文件出现", className: "bg-muted text-muted-foreground" },
  "file-update": { label: "文件变更", className: "bg-primary/10 text-primary" },
  "task-done": { label: "任务勾选", className: "bg-success/15 text-success" },
  commit: { label: "提交", className: "bg-brand-100 text-brand-700" },
  warning: { label: "告警", className: "bg-warning/15 text-warning" },
  "gate-run": { label: "门实测", className: "bg-primary/10 text-primary" },
  info: { label: "信息", className: "bg-muted text-muted-foreground" },
};

/** epoch 毫秒 → 本地时刻（跨天事件带日期；缺键/非法数值回退占位）。 */
function watcherTs(v: JsonValue | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return v == null ? "—" : String(v);
  return new Date(v).toLocaleString("zh-CN", { hour12: false });
}

/**
 * watcher-events.jsonl 专用视图：时刻/类型徽章/阶段/详情表格 + 观测语义脚注。
 * 行结构 `{ts, kind, stage?, detail?, provisional}`（daemon watcher 观测流）。
 */
function WatcherEventsView({ lines }: { lines: JsonValue[] }) {
  const rows = lines.filter(isRecord);
  return (
    <div data-testid="watcher-events-view" className="flex flex-col gap-2">
      <DataTable head={["时刻", "类型", "阶段", "详情"]}>
        {rows.map((r, i) => {
          const kind = typeof r.kind === "string" ? r.kind : "";
          const badge = WATCHER_KIND_BADGE[kind];
          return (
            <tr key={i} className="border-t border-border align-top">
              <td className="whitespace-nowrap px-2.5 py-1.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                {watcherTs(r.ts)}
              </td>
              <td className="px-2.5 py-1.5">
                {badge ? (
                  <span className={cn("whitespace-nowrap rounded px-1.5 py-0.5 text-[11px]", badge.className)}>
                    {badge.label}
                  </span>
                ) : (
                  <span className="whitespace-nowrap rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    {kind || "—"}
                  </span>
                )}
              </td>
              <td className="whitespace-nowrap px-2.5 py-1.5 text-muted-foreground">
                {typeof r.stage === "string" && r.stage ? r.stage : "—"}
              </td>
              <td className="px-2.5 py-1.5 text-foreground">
                {typeof r.detail === "string" && r.detail ? r.detail : "—"}
              </td>
            </tr>
          );
        })}
      </DataTable>
      <p className="text-[10px] text-muted-foreground/70">
        watcher 观测流（恒 provisional）：由文件监控自动记录，只展示不消费；行数 {rows.length}。
      </p>
    </div>
  );
}

/** 已知固定结构 jsonl → 专用视图；不命中返回 null（调用方回落 JsonlView）。 */
export function knownJsonlView(name: string, lines: JsonValue[]): ReactNode | null {
  const basename = name.split("/").pop() ?? name;
  if (basename === "watcher-events.jsonl" && lines.some((l) => isRecord(l) && typeof l.kind === "string")) {
    return <WatcherEventsView lines={lines} />;
  }
  return null;
}

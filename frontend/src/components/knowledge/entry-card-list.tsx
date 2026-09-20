"use client";

/**
 * EntryCardList — 全 zone 统一条目渲染器（task-05 / 2026-09-20-knowledge-effect-panel
 * / FR-04 / FR-06 / D-004@v2 / D-005@v1）。
 *
 * 单组件配置化承载三形态（约束：禁三套重复实现），按 zone + filename 分发：
 *   - manual（手册，zone=top 非 INDEX.md）：## 小节 → 逐条正文卡（标题 + 正文
 *     markdown 纯文本）+ 条目级 🔥 徽标（锚点 `文件#slug` 对齐 hits）；
 *   - structured（决策/FR，zone∈{decisions,fr}）：## 条目（`## D-xxx@vN : 标题`
 *     / `## FR-域-NNN 标题`）+ 字段行 → 结构化卡（ID mono 徽标 + 状态 pill +
 *     字段行网格 + 理由/摘要高亮块 + 取代链条带）。rejected 置顶 + 防复潮横幅
 *     （zone=decisions 且存在 rejected 时）；superseded 折叠置灰可展开；
 *     依据决策渲染为可点击（onJumpToEntry → decisions/<域>.md）；全文路径
 *     存在则输出文本链（点击复制路径）；
 *   - index（INDEX.md，zone=top）：## 分类段 + 路由行（`- 关键词 → [标题](文件#锚)`）
 *     → 目录导航卡，每路由行可点击 onJumpToEntry(文件, 锚)；
 *   - single（兜底：generated / proposed / 未知 zone）：单条目大卡（H1 标题+正文）。
 *
 * 视觉参照 prototype-effect-panel.html 的 .entry-card / .pill / .ec-* 类族；
 * 主题铁律：brand-* 语义阶 + success/warning/destructive 主题 token，中文文案。
 *
 * ── 条目级徽标数据可得性（FR-06 降级口径，钉死）──────────────────────────
 * design 接口的 entry_counts 仅含文件级明细（[{file, count}]，无条目锚点）；
 * 条目级计数映射由调用方从 stats 的 usage_board（anchor→total，含 `文件#slug`
 * 小节级与裸文件名决策/FR 级两种锚形态——design「数据流」：条目徽标=该锚点
 * 计数）经 entryCounts prop 传入；未传 / 无命中锚点时条目卡不带徽标，仅
 * 头部保留文件级 useCount 徽标（task-05 卡片允许的降级路径）。
 *
 * ── 解析契约（docs-check 机械解析，与 backend parser 同域规则）────────────
 * slugifyAnchor 复刻 backend/app/modules/knowledge/parser.py 的 slugify_anchor
 * （Grill CLK-02 双端归一：小写 → 每个空白转一个 `-` 不折叠 → 去其余符号，
 * 不截断）；条目 ID 头正则与 parser._ENTRY_ID_PREFIX_RE 同形（FR 域名可含
 * 多段连字符，回溯锚定末尾 `-NNN`）。
 */

import { useState } from "react";

import { cn } from "@/lib/utils";

// ── 公共解析 ────────────────────────────────────────────────────────────────

/** 剥 frontmatter（首行 `---` 围栏块；getKnowledge 返回全文原样含 frontmatter）。 */
function stripFrontmatter(content: string): string {
  const lines = content.split("\n");
  if ((lines[0] ?? "").trim() !== "---") return content;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === "---") return lines.slice(i + 1).join("\n");
  }
  return content;
}

/** 恰两级的 `## ` 小节头（`### ` 因第三字符非空白不匹配，parser 同款）。 */
const H2_RE = /^##\s+(.+?)\s*$/;

/**
 * 手册小节标题 → hits/INDEX 锚点 slug（复刻 backend parser.slugify_anchor，
 * Grill CLK-02 双端归一）：
 *   1. 小写；2. 每个空白字符 → 一个 `-`（不折叠 run、不去首尾）；3. 其余符号
 *   （括号/书名号/箭头/斜杠/点/emoji 等）直接去除；4. 保留字母/数字/下划线/
 *   中文/连字符；5. 不截断。
 */
export function slugifyAnchor(title: string): string {
  const s = title
    .trim()
    .toLowerCase()
    .replace(/\s/g, "-");
  return s.replace(/[^0-9a-z_\u4e00-\u9fff-]+/g, "");
}

/** 字段行（全角冒号分隔；键=中文/字母/下划线，如 `状态：`/`superseded_by：`）。 */
const FIELD_RE = /^([A-Za-z_\u4e00-\u9fff]+)：(.*)$/;

/** decisions / fr 条目头的 ID 段（`D-002@v1 : 标题` / `FR-host-fs-handler-001 标题`）。 */
const ENTRY_ID_RE =
  /^(D-\d+@v\d+|FR-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*-\d+)(?:\s*:\s*|\s+|$)(.*)$/;

// ── 形态 a：手册 ## 小节 ────────────────────────────────────────────────────

/** 手册小节卡数据（anchor=`文件#slug`，条目级徽标匹配键）。 */
export interface ManualSection {
  title: string;
  body: string;
  anchor: string;
}

/** 解析手册文件的 `## 小节`（frontmatter 与首个 ## 前的文件头忽略）。 */
export function parseEntrySections(content: string, filename: string): ManualSection[] {
  const sections: ManualSection[] = [];
  let title: string | null = null;
  let body: string[] = [];
  for (const line of stripFrontmatter(content).split("\n")) {
    const m = line.match(H2_RE);
    if (m) {
      if (title !== null) sections.push({ title, body: body.join("\n").trim(), anchor: `${filename}#${slugifyAnchor(title)}` });
      title = m[1]!;
      body = [];
    } else if (title !== null) {
      body.push(line);
    }
  }
  if (title !== null) {
    sections.push({ title, body: body.join("\n").trim(), anchor: `${filename}#${slugifyAnchor(title)}` });
  }
  return sections;
}

// ── 形态 b：决策 / FR 结构化条目 ────────────────────────────────────────────

/** 归一状态（`implemented（休眠）` → implemented；未知/缺省 → active）。 */
export type EntryStatus = "active" | "implemented" | "superseded" | "rejected";

/** 决策/FR 结构化条目（字段行顺序保留，供字段网格渲染）。 */
export interface DecisionEntry {
  /** `D-001@v1` / `FR-host-fs-handler-001`；非 ID 形态的 `## ` 头为 null。 */
  id: string | null;
  title: string;
  status: EntryStatus;
  statusRaw: string;
  /** 全部字段行（键值原样，含状态/理由等特判键——渲染层再分流）。 */
  fields: ReadonlyArray<{ key: string; value: string }>;
  /** 理由/退役理由/摘要（首个命中）——高亮块内容。 */
  reason: string | null;
  /** 其余非字段正文行。 */
  body: string;
}

function normalizeStatus(raw: string): EntryStatus {
  const v = raw.trim();
  if (v.startsWith("rejected")) return "rejected";
  if (v.startsWith("superseded")) return "superseded";
  if (v.startsWith("implemented")) return "implemented";
  return "active";
}

/**
 * 解析 decisions / fr 文件的 `## 条目`：ID 头（`## D-xxx@vN : 标题` /
 * `## FR-域-NNN 标题`，纯 ID 无标题时标题回落 ID 本身——parser 同款）+ 其后
 * 字段行（全角冒号）与正文行。`场景正文：` 后的 `- ` 列表行并入该字段值。
 */
/** parseDecisionEntries 的累积中间态（渲染前再映射为 DecisionEntry）。 */
interface WorkingEntry {
  id: string | null;
  title: string;
  fields: { key: string; value: string }[];
  bodyLines: string[];
  lastField: { key: string; value: string } | null;
}

export function parseDecisionEntries(content: string): DecisionEntry[] {
  const entries: WorkingEntry[] = [];
  let current: WorkingEntry | null = null;

  for (const line of stripFrontmatter(content).split("\n")) {
    const m = line.match(H2_RE);
    if (m) {
      const idm = m[1]!.match(ENTRY_ID_RE);
      current = {
        id: idm?.[1] ?? null,
        title: (idm?.[2] ?? "").trim() || m[1]!,
        fields: [],
        bodyLines: [],
        lastField: null,
      };
      entries.push(current);
      continue;
    }
    if (!current) continue;
    const fm = line.match(FIELD_RE);
    if (fm) {
      const field = { key: fm[1]!, value: fm[2]!.trim() };
      current.fields.push(field);
      current.lastField = field;
    } else if (line.startsWith("- ") && current.lastField) {
      // 场景正文等多行字段续行（列表并入最近字段）。
      current.lastField.value = `${current.lastField.value}\n${line}`.trim();
    } else {
      current.lastField = null;
      current.bodyLines.push(line);
    }
  }

  return entries.map((e) => {
    const find = (key: string) => e.fields.find((f) => f.key === key)?.value.trim() ?? null;
    const statusRaw = find("状态") ?? "";
    const reason =
      find("退役理由") ?? find("理由") ?? find("摘要") ?? null;
    return {
      id: e.id,
      title: e.title,
      status: normalizeStatus(statusRaw),
      statusRaw,
      fields: e.fields,
      reason,
      body: e.bodyLines.join("\n").trim(),
    };
  });
}

// ── 形态 c：INDEX 目录导航 ─────────────────────────────────────────────────

/** INDEX 路由行（`- 关键词 → [标题](文件#锚)`；锚可缺省——decisions/fr 路由无 #）。 */
export interface IndexRoute {
  category: string;
  keywords: string;
  title: string;
  file: string;
  anchor: string | null;
}

const INDEX_ROUTE_RE = /^-\s+(.+?)\s*→\s*\[(.+?)\]\(([^)]+)\)$/;

/** 解析 INDEX.md 的分类段与路由行（无路由行的分类自然不出现；注释/空行跳过）。 */
export function parseIndexRoutes(content: string): IndexRoute[] {
  const routes: IndexRoute[] = [];
  let category: string | null = null;
  for (const line of stripFrontmatter(content).split("\n")) {
    const m = line.match(H2_RE);
    if (m) {
      category = m[1]!;
      continue;
    }
    const r = line.match(INDEX_ROUTE_RE);
    if (!r || !category) continue;
    const target = r[3]!;
    const hash = target.indexOf("#");
    routes.push({
      category,
      keywords: r[1]!,
      title: r[2]!,
      file: hash >= 0 ? target.slice(0, hash) : target,
      anchor: hash >= 0 ? target.slice(hash + 1) : null,
    });
  }
  return routes;
}

// ── 形态分发 ────────────────────────────────────────────────────────────────

export type EntryCardForm = "manual" | "structured" | "index" | "single";

/** 按 zone + filename 分发形态（INDEX.md 在任何 zone 都走导航形态，parser 排除口径对齐）。 */
export function detectEntryCardForm(filename: string, zone: string): EntryCardForm {
  const base = filename.split("/").pop() ?? filename;
  if (base === "INDEX.md") return "index";
  if (zone === "decisions" || zone === "fr") return "structured";
  if (zone === "top") return "manual";
  return "single";
}

// ── 组件 ────────────────────────────────────────────────────────────────────

export interface EntryCardListProps {
  /** knowledge 相对路径（如 `conventions.md` / `decisions/backend.md`）。 */
  filename: string;
  /** top | decisions | fr | generated | proposed。 */
  zone: string;
  /** 全文原样（含 frontmatter，getKnowledge 返回）。 */
  content: string;
  /** 文件级使用计数（stats entry_counts 口径，头部 🔥 徽标）。 */
  useCount?: number | null;
  /**
   * 条目级计数映射（锚点 → 命中次数）：手册=`文件#slug` 小节级，decisions/fr=
   * 裸文件名（文件级锚形态，design 口径二分）。调用方从 stats usage_board 派生；
   * 未传时条目卡不带徽标（FR-06 降级为文件级，见头注释）。
   */
  entryCounts?: Record<string, number>;
  /** 点击依赖决策 / INDEX 路由跳目标文件（可选锚点，调用方决定用法）。 */
  onJumpToEntry?: (filename: string, anchor?: string) => void;
  className?: string;
}

/** 状态 pill 文案与配色（原型 .pill 族；superseded 灰 / rejected 红 / implemented 紫=brand / active 绿）。 */
const STATUS_PILLS: Record<EntryStatus, { label: string; cls: string }> = {
  active: { label: "active", cls: "bg-success/15 text-success" },
  implemented: { label: "implemented", cls: "bg-brand-100 text-brand-700" },
  superseded: { label: "superseded", cls: "bg-muted text-muted-foreground" },
  rejected: { label: "rejected", cls: "bg-destructive/15 text-destructive" },
};

/** 🔥 使用徽标（原型 .badge-use / .heat-mini 语义的文本化形态）。 */
function UseBadge({ count, title }: { count: number; title: string }) {
  return (
    <span
      data-testid="entry-use-badge"
      title={title}
      className="shrink-0 rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold leading-4 text-brand-700"
    >
      🔥 {count}
    </span>
  );
}

/** 复制全文路径（jsdom/旧浏览器无 clipboard 时静默失败，路径文本仍可见）。 */
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    // 忽略——链接本体已是可见文本。
  }
}

/** 依据决策域推导：当前文件（fr/<域>.md 或 decisions/<域>.md）→ decisions/<域>.md。 */
function decisionsFileFor(filename: string): string {
  const base = filename.split("/").pop() ?? filename;
  const domain = base.replace(/\.md$/, "");
  return `decisions/${domain}.md`;
}

/** 结构化卡（决策/FR 共用，原型 .entry-card .ec-* 结构）。 */
function DecisionCard({
  entry,
  filename,
  entryCount,
  onJumpToEntry,
}: {
  entry: DecisionEntry;
  filename: string;
  entryCount?: number;
  onJumpToEntry?: (filename: string, anchor?: string) => void;
}) {
  const superseded = entry.status === "superseded";
  // superseded 折叠置灰（可展开）；其余默认展开。
  const [expanded, setExpanded] = useState(!superseded);

  const chain = entry.fields.find((f) => f.key === "取代链")?.value.trim() ?? null;
  const reasonKeys = ["退役理由", "理由", "摘要"];
  const reasonKeyUsed = reasonKeys.find((k) => entry.fields.some((f) => f.key === k && f.value.trim()));
  // 字段网格排除特判键：状态（pill）/ 取代链（条带）/ 理由族（高亮块，仅首个命中键
  // 进块，其余保留在网格）/ 依据决策（可点击行）/ 全文（脚部链接）/ 最近确认（脚部）。
  const gridFields = entry.fields.filter(
    (f) =>
      f.key !== "状态" &&
      f.key !== "取代链" &&
      f.key !== "依据决策" &&
      f.key !== "全文" &&
      f.key !== "最近确认" &&
      !(f.key === reasonKeyUsed && f.value.trim()),
  );
  const lastConfirmed = entry.fields.find((f) => f.key === "最近确认")?.value.trim() ?? null;
  const fulltext = entry.fields.find((f) => f.key === "全文")?.value.trim() ?? null;
  const basedOn = entry.fields.find((f) => f.key === "依据决策")?.value ?? null;
  const basedOnIds = basedOn
    ? basedOn.split(/[\s·,，、]+/).filter((t) => /^D-\d+@v\d+$/.test(t))
    : [];

  const pill = STATUS_PILLS[entry.status];

  return (
    <article
      data-testid="decision-entry-card"
      data-status={entry.status}
      className={cn(
        "rounded-md border border-border/60 p-2.5 transition-colors hover:border-brand-400",
        superseded && "border-border/40 bg-muted/40 opacity-60",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {entry.id ? (
          <span className="font-mono text-[11px] font-bold text-brand-700">{entry.id}</span>
        ) : null}
        <span className="min-w-[160px] flex-1 text-[13px] font-semibold">{entry.title}</span>
        <span data-testid="status-pill" className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold leading-4", pill.cls)}>
          {pill.label}
        </span>
        {entryCount !== undefined && entryCount > 0 ? (
          <UseBadge count={entryCount} title={`文件级命中 ${entryCount} 次（decisions/fr 条目共享文件级锚点口径）`} />
        ) : null}
        {superseded ? (
          <button
            type="button"
            data-testid="superseded-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:border-brand-400 hover:text-brand-600"
          >
            {expanded ? "收起 ▲" : "展开 ▼"}
          </button>
        ) : null}
      </div>

      {/* 取代链条带（原型 .ec-chain）：superseded 折叠态也保留——取代关系即其身份 */}
      {chain ? (
        <div className="mt-1.5 inline-block max-w-full whitespace-pre-wrap break-words rounded bg-warning/15 px-2 py-0.5 text-[10.5px] text-warning">
          🔁 取代链：{chain}
        </div>
      ) : null}

      {expanded ? (
        <>
          {gridFields.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[11px] text-muted-foreground">
              {gridFields.map((f) => (
                <span key={f.key} className="min-w-0 break-words">
                  <span className="text-muted-foreground/70">{f.key}：</span>
                  {f.value}
                </span>
              ))}
            </div>
          ) : null}

          {entry.reason ? (
            <div className="mt-1.5 whitespace-pre-wrap break-words rounded bg-brand-50 px-2 py-1.5 text-[11.5px] leading-relaxed">
              {entry.reason}
            </div>
          ) : null}

          {entry.body ? (
            <p className="mt-1.5 whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-muted-foreground">
              {entry.body}
            </p>
          ) : null}

          {basedOnIds.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-muted-foreground/70">依据决策：</span>
              {basedOnIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  data-testid="based-on-decision-link"
                  onClick={() => onJumpToEntry?.(decisionsFileFor(filename))}
                  title={`跳转 ${decisionsFileFor(filename)}`}
                  className="rounded bg-brand-100 px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-brand-700 hover:bg-brand-200"
                >
                  {id}
                </button>
              ))}
            </div>
          ) : null}

          {lastConfirmed || fulltext ? (
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[10.5px] text-muted-foreground/80">
              <span>{lastConfirmed ? `最近确认 ${lastConfirmed}` : ""}</span>
              {fulltext ? (
                <button
                  type="button"
                  data-testid="fulltext-link"
                  onClick={() => void copyText(fulltext)}
                  title={`全文路径（点击复制）：${fulltext}`}
                  className="min-w-0 break-all text-left text-brand-600 hover:underline"
                >
                  全文 ↗ {fulltext}
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </article>
  );
}

/** 统一条目渲染器主组件（三形态配置化，形态分发见 detectEntryCardForm）。 */
export function EntryCardList({
  filename,
  zone,
  content,
  useCount,
  entryCounts,
  onJumpToEntry,
  className,
}: EntryCardListProps) {
  const form = detectEntryCardForm(filename, zone);

  // ── manual：## 小节逐条正文卡 ──
  const sections = form === "manual" ? parseEntrySections(content, filename) : [];
  // ── structured：决策/FR 结构化条目（rejected 置顶，其余保持原文序）──
  const entries = form === "structured" ? parseDecisionEntries(content) : [];
  const orderedEntries =
    form === "structured"
      ? [...entries].sort((a, b) => {
          const rank = (e: DecisionEntry) => (e.status === "rejected" ? 0 : 1);
          return rank(a) - rank(b);
        })
      : [];
  const hasRejected = entries.some((e) => e.status === "rejected");
  // ── index：分类段 + 路由行（保序去重分类）──
  const routes = form === "index" ? parseIndexRoutes(content) : [];
  const categories =
    form === "index"
      ? [...new Map(routes.map((r) => [r.category, r.category])).keys()]
      : [];
  // ── single：H1 标题（缺省 filename）+ 正文 ──
  const h1 = form === "single" ? (stripFrontmatter(content).match(/^#\s+(.+?)\s*$/m)?.[1] ?? null) : null;
  const singleBody = form === "single" ? stripFrontmatter(content).replace(/^#\s+.*$/m, "").trim() : "";

  /** 条目计数（结构化条目=裸文件名锚——design 口径二分之文件级形态）。 */
  const fileAnchorCount = entryCounts?.[filename];
  const metaCount =
    form === "manual"
      ? `${sections.length} 条`
      : form === "structured"
        ? `${entries.length} 条`
        : form === "index"
          ? `${routes.length} 条路由`
          : null;

  return (
    <div data-testid="entry-card-list" data-form={form} className={cn("flex min-w-0 flex-col gap-2", className)}>
      {/* 头部元信息行（原型「📄 文件 · N 条 · 视图：卡片」）+ 文件级 🔥 徽标 */}
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>
          📄 {filename}
          {metaCount ? ` · ${metaCount}` : ""}
        </span>
        {typeof useCount === "number" && useCount > 0 ? (
          <UseBadge count={useCount} title={`文件级命中 ${useCount} 次（条目级明细不可得时以文件级口径展示，FR-06）`} />
        ) : null}
      </div>

      {/* 防复潮横幅（zone=decisions 且存在 rejected；原型 .rejected-banner） */}
      {form === "structured" && zone === "decisions" && hasRejected ? (
        <div
          data-testid="rejected-banner"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          🛡 <b>防复潮：</b>rejected 决策置顶——以下方案已被否决，除非复潮条件满足不要再提
        </div>
      ) : null}

      {form === "manual" ? (
        sections.length > 0 ? (
          sections.map((s) => {
            const n = entryCounts?.[s.anchor];
            return (
              <article
                key={s.anchor}
                data-testid="manual-section-card"
                data-entry-anchor={s.anchor}
                className="rounded-md border border-border/60 p-2.5 transition-colors hover:border-brand-400"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="min-w-0 flex-1 break-words text-[13px] font-semibold">{s.title}</h4>
                  {n !== undefined && n > 0 ? (
                    <UseBadge count={n} title={`条目命中 ${n} 次（${s.anchor}）`} />
                  ) : null}
                </div>
                {s.body ? (
                  <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
                    {s.body}
                  </p>
                ) : null}
              </article>
            );
          })
        ) : (
          // 无 ## 小节的手册文件兜底：整文件单卡（正文纯文本）。
          <SingleCard title={filename} body={stripFrontmatter(content).trim()} count={fileAnchorCount} />
        )
      ) : null}

      {form === "structured" ? (
        orderedEntries.length > 0 ? (
          orderedEntries.map((e, i) => (
            <DecisionCard
              key={`${e.id ?? e.title}-${i}`}
              entry={e}
              filename={filename}
              entryCount={fileAnchorCount}
              onJumpToEntry={onJumpToEntry}
            />
          ))
        ) : (
          <SingleCard title={filename} body={stripFrontmatter(content).trim()} count={fileAnchorCount} />
        )
      ) : null}

      {form === "index" ? (
        routes.length > 0 ? (
          categories.map((cat) => (
            <section key={cat} data-testid="index-category" data-category={cat}>
              <h4 className="px-1 pb-1 pt-0.5 text-[10.5px] font-semibold tracking-wide text-muted-foreground/80">
                {cat}
              </h4>
              <div className="flex flex-col">
                {routes
                  .filter((r) => r.category === cat)
                  .map((r) => (
                    <button
                      key={`${r.file}#${r.anchor ?? ""}-${r.title}`}
                      type="button"
                      data-testid="index-route-row"
                      onClick={() => onJumpToEntry?.(r.file, r.anchor ?? undefined)}
                      title={`${r.keywords} → ${r.file}${r.anchor ? `#${r.anchor}` : ""}`}
                      className="flex min-w-0 flex-wrap items-baseline gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-brand-50"
                    >
                      <span className="min-w-0 flex-1 break-words font-medium text-brand-700 hover:underline">
                        {r.title}
                      </span>
                      <span className="min-w-0 max-w-full shrink-0 truncate font-mono text-[10.5px] text-muted-foreground/80">
                        {r.file}
                        {r.anchor ? `#${r.anchor}` : ""}
                      </span>
                    </button>
                  ))}
              </div>
            </section>
          ))
        ) : (
          <p className="px-1 py-2 text-xs text-muted-foreground">INDEX 无可点路由行。</p>
        )
      ) : null}

      {form === "single" ? (
        <SingleCard title={h1 ?? filename} body={singleBody} count={fileAnchorCount} />
      ) : null}
    </div>
  );
}

/** 单条目大卡（generated / 无小节兜底；H1 标题 + 正文）。 */
function SingleCard({ title, body, count }: { title: string; body: string; count?: number }) {
  return (
    <article data-testid="single-entry-card" className="rounded-md border border-border/60 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="min-w-0 flex-1 break-words text-[13px] font-semibold">{title}</h4>
        {count !== undefined && count > 0 ? (
          <UseBadge count={count} title={`文件级命中 ${count} 次`} />
        ) : null}
      </div>
      {body ? (
        <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
          {body}
        </p>
      ) : null}
    </article>
  );
}

"use client";

/**
 * EntryCardList — 全 zone 统一条目渲染器（task-05 / 2026-09-20-knowledge-effect-panel
 * / FR-04 / FR-06 / D-004@v2 / D-005@v1）。
 *
 * 单组件配置化承载三形态（约束：禁三套重复实现），按 zone + filename 分发：
 *   - manual（手册，zone=top 非 INDEX.md）：## 小节 → 逐条正文卡（标题 + 正文
 *     markdown 渲染）+ 条目级 🔥 徽标（锚点 `文件#slug` 对齐 hits）；
 *   - structured（决策/FR，zone∈{decisions,fr}）：## 条目（`## D-xxx@vN : 标题`
 *     / `## FR-域-NNN 标题`）+ 字段行 → 结构化卡（ID mono 徽标 + 状态 pill +
 *     字段行网格 + 理由/摘要高亮块 + 取代链条带 + 测试绑定机器块紧凑行——注释
 *     标记与 row YAML 不进正文/字段网格，整行 HTML 注释双视图一致不可见）。rejected 置顶 + 防复潮横幅
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

import { App as AntdApp } from "antd";

import { CardMarkdown } from "@/components/knowledge/card-markdown";
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

/** frontmatter 元信息（卡片头元信息条数据源；字段缺失为 null）。 */
export interface FrontmatterMeta {
  author: string | null;
  createdAt: string | null;
}

/**
 * 解析首行 `---` 围栏 frontmatter 的 author / created_at（卡片头元信息条，
 * 2026-09-23-md-card-render / FR-03 / D-003）。无 frontmatter / 字段缺失 →
 * 对应字段 null（元信息条整体隐藏，不渲染空行不抛错）；created_at 原样返回
 * （显示层截前 10 位日期，兼容 `2026-06-23 02:00:00` 与 ISO 两种形态）。
 * 独立新增——stripFrontmatter 签名与其调用点不动（Grill CC-07 收窄方案）。
 */
export function parseFrontmatterMeta(content: string): FrontmatterMeta {
  const lines = content.split("\n");
  if ((lines[0] ?? "").trim() !== "---") return { author: null, createdAt: null };
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (end < 0) return { author: null, createdAt: null };
  let author: string | null = null;
  let createdAt: string | null = null;
  for (const line of lines.slice(1, end)) {
    const m = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (!m) continue;
    const value = m[2]!.trim().replace(/^["']|["']$/g, "");
    if (m[1] === "author" && value) author = value;
    else if (m[1] === "created_at" && value) createdAt = value;
  }
  return { author, createdAt };
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

// ── 测试绑定机器块（sillyspec tests 管理，writer 侧 src/test-bindings.js
// renderBindingBlock 固定形态）───────────────────────────────────────────────
//
// ```测试绑定：``（空值字段头）+ `<!-- test-bindings: … 勿手改 -->` 注释标记 +
// `- row: <row_id>` + 两空格缩进键值行（tests 多值 ` | ` 连接）。卡片视图结构化
// 渲染 tests/state，不再把注释与 YAML 行当正文倾泻（原文视图注释本就不可见，
// 双视图口径一致）；块外的整行 HTML 注释同理不进正文。

/** 机器块注释标记行（宽容匹配 writer 的固定文案形态）。 */
const MACHINE_NOTE_RE = /^<!--\s*test-bindings:.*-->$/;
/** 整行 HTML 注释（首尾即闭合，不跨行）。 */
const FULL_LINE_COMMENT_RE = /^<!--.*-->$/;
/** 机器块 row 行。 */
const MACHINE_ROW_RE = /^- row: (.+)$/;
/** 机器块缩进键值行（writer 恒两空格缩进）。 */
const MACHINE_KV_RE = /^  ([A-Za-z_]+): (.*)$/;

/** 机器绑定行的人读投影（完整字段面见原文 tab；rowId 供 tooltip 溯源）。 */
export interface TestBindingRow {
  rowId: string;
  tests: string[];
  state: string;
}

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
  /** 测试绑定机器块的结构化投影（无块=空数组，渲染层独立于字段网格/正文）。 */
  testBindings: TestBindingRow[];
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
  machineRows: TestBindingRow[];
}

export function parseDecisionEntries(content: string): DecisionEntry[] {
  const entries: WorkingEntry[] = [];
  let current: WorkingEntry | null = null;
  // 机器块态：注释标记行之后、下一顶格非块内容/条目头之前，row/缩进键值行入
  // machineRows，空行留在块内，其余行退出块态落回常规分流。
  let machineMode = false;

  for (const line of stripFrontmatter(content).split("\n")) {
    const m = line.match(H2_RE);
    if (m) {
      machineMode = false;
      const idm = m[1]!.match(ENTRY_ID_RE);
      current = {
        id: idm?.[1] ?? null,
        title: (idm?.[2] ?? "").trim() || m[1]!,
        fields: [],
        bodyLines: [],
        lastField: null,
        machineRows: [],
      };
      entries.push(current);
      continue;
    }
    if (!current) continue;

    if (machineMode) {
      const rowm = line.match(MACHINE_ROW_RE);
      if (rowm) {
        current.machineRows.push({ rowId: rowm[1]!.trim(), tests: [], state: "" });
        continue;
      }
      const kvm = line.match(MACHINE_KV_RE);
      if (kvm) {
        const row = current.machineRows[current.machineRows.length - 1];
        if (row) {
          if (kvm[1] === "tests") {
            row.tests = kvm[2]!.split("|").map((t) => t.trim()).filter(Boolean);
          } else if (kvm[1] === "state") {
            row.state = kvm[2]!.trim();
          }
        }
        continue;
      }
      if (line.trim() === "") continue;
      machineMode = false; // 顶格非块内容：块结束，本行落回常规分流
    }

    if (MACHINE_NOTE_RE.test(line)) {
      machineMode = true;
      // 空值「测试绑定：」字段头是块结构标记，撤出字段网格防悬空空行。
      if (current.fields.length > 0) {
        const last = current.fields[current.fields.length - 1];
        if (last && last.key === "测试绑定" && last.value === "") current.fields.pop();
      }
      current.lastField = null;
      continue;
    }
    // 整行 HTML 注释不进正文（原文视图同样不可见，双视图口径一致）。
    if (FULL_LINE_COMMENT_RE.test(line)) continue;

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
      testBindings: e.machineRows,
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

/**
 * 复制文本：返回是否真写入剪贴板——不安全上下文（http 非 localhost）下
 * ``navigator.clipboard`` 为 undefined、权限拒绝/焦点丢失时 writeText 抛错，
 * 一律 false（2026-10-09 风险审查：原 void+可选链形态让假成功提示成为可能）。
 * 全文路径等「本体已是可见文本」的调用方仍可忽略返回值静默降级。
 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * 锚点复制图标（FR-02 / D-003，原型 panel-c 卡片头 🔗）：点击复制锚点定位串
 * （manual=``文件#slug``；SingleCard=裸文件名，Grill CC-02），antd message 按
 * 真实复制结果反馈（经 <AntApp> 注入走主题；对齐 governance-cards copyPrompt
 * 范式——剪贴板不可用时不再弹「已复制」假成功）。
 */
function AnchorCopyButton({ anchor }: { anchor: string }) {
  const { message } = AntdApp.useApp();
  return (
    <button
      type="button"
      data-testid="anchor-copy-btn"
      aria-label={`复制锚点 ${anchor}`}
      title={`锚点定位（点击复制）：${anchor}`}
      onClick={() => {
        void copyText(anchor).then((copied) => {
          if (copied) void message.success("锚点已复制");
          else void message.error("复制失败：剪贴板不可用");
        });
      }}
      className="shrink-0 rounded px-1 text-[11px] leading-4 text-brand-600/70 transition-colors hover:bg-brand-100 hover:text-brand-700"
    >
      🔗
    </button>
  );
}

/**
 * frontmatter 元信息行（FR-03）：显示「✍ 作者 · 日期 收录」；author/createdAt
 * 任一缺失整条隐藏（降级不渲染空行，兼容策略）。
 */
function FrontmatterMetaLine({ meta }: { meta: FrontmatterMeta | null }) {
  if (!meta?.author || !meta.createdAt) return null;
  const date = meta.createdAt.slice(0, 10);
  return (
    <div data-testid="frontmatter-meta" className="px-2.5 pt-1.5 text-[10.5px] text-muted-foreground/80">
      ✍ {meta.author} · {date} 收录
    </div>
  );
}

/** 依据决策域推导：当前文件（fr/<域>.md 或 decisions/<域>.md）→ decisions/<域>.md。 */
function decisionsFileFor(filename: string): string {
  const base = filename.split("/").pop() ?? filename;
  const domain = base.replace(/\.md$/, "");
  return `decisions/${domain}.md`;
}

/** 结构化卡（决策/FR 共用，原型 .entry-card .ec-* 结构；2026-10-08 验收扩展：套用 manual 同款卡片头——色条+头底+🔗+元信息行，保留 ID/状态 pill/字段网格等功能元素）。 */
function DecisionCard({
  entry,
  filename,
  entryCount,
  meta,
  onJumpToEntry,
}: {
  entry: DecisionEntry;
  filename: string;
  entryCount?: number;
  meta: FrontmatterMeta | null;
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
      // 条目级落点（2026-09-25-change-detail-assets-usability / FR-01/02）：结构化条目
      // 卡此前没有锚点属性，FR/决策索引行跳进来只能落到文件级。键与手册形态同构
      // （``文件#锚``），锚取条目 id（``FR-cli-entry-075`` / ``D-001@v1``）——与沉淀
      // 资产卡 href 的 anchor 参数同一取值。
      data-entry-anchor={entry.id ? `${filename}#${entry.id}` : undefined}
      // shrink-0 防限高 flex-col 压缩（同 manual 卡）；overflow-hidden 裁头部底色圆角。
      className={cn(
        "shrink-0 overflow-hidden rounded-md border border-border/60 border-l-[3px] border-l-brand-600 p-2.5 transition-colors hover:border-brand-400",
        superseded && "border-border/40 bg-muted/40 opacity-60",
      )}
    >
      <div className="-mx-2.5 -mt-2.5 mb-0 flex flex-wrap items-center gap-2 border-b border-border/60 bg-brand-50 px-2.5 py-1.5">
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
        {entry.id ? <AnchorCopyButton anchor={`${filename}#${entry.id}`} /> : null}
      </div>
      <FrontmatterMetaLine meta={meta} />

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
            <CardMarkdown
              content={entry.reason}
              className="mt-1.5 rounded bg-brand-50 px-2 py-1.5 leading-relaxed"
            />
          ) : null}

          {entry.body ? (
            <CardMarkdown content={entry.body} className="mt-1.5 text-muted-foreground" />
          ) : null}

          {entry.testBindings.length > 0 ? (
            <div
              data-testid="machine-test-bindings"
              className="mt-1.5 flex flex-col gap-0.5 rounded bg-muted/60 px-2 py-1 font-mono text-[10.5px] leading-4 text-muted-foreground"
            >
              <span className="text-muted-foreground/70">测试绑定（机器管理 · 原文含全量字段）：</span>
              {entry.testBindings.map((r) => (
                <span key={r.rowId} title={r.rowId} className="break-all">
                  {r.tests.join(" · ")}
                  {r.state ? <span className="ml-1.5 rounded bg-brand-100 px-1 py-px font-bold text-brand-700">{r.state}</span> : null}
                </span>
              ))}
            </div>
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
  // frontmatter 元信息（FR-03）：顶层解析一次向 manual/SingleCard 各卡传递；
  // 缺失时 FrontmatterMetaLine 整条降级隐藏。
  const meta = parseFrontmatterMeta(content);

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
                // shrink-0 必需：页面容器为限高 flex-col（max-h-70vh），overflow-hidden 的
                // flex 子项自动最小高度归零（CSS 规范），卡片会被均匀压缩致正文裁切
                // （2026-10-08 部署验收实证）——shrink-0 恢复「超出走容器滚动」原语义。
                className="shrink-0 overflow-hidden rounded-md border border-border/60 border-l-[3px] border-l-brand-600 transition-colors hover:border-brand-400"
              >
                <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-brand-50 px-2.5 py-1.5">
                  <h4 className="min-w-0 flex-1 break-words text-[13px] font-semibold text-brand-700">{s.title}</h4>
                  {n !== undefined && n > 0 ? (
                    <UseBadge count={n} title={`条目命中 ${n} 次（${s.anchor}）`} />
                  ) : null}
                  <AnchorCopyButton anchor={s.anchor} />
                </div>
                <FrontmatterMetaLine meta={meta} />
                {s.body ? (
                  <CardMarkdown content={s.body} className="px-2.5 pb-2.5 pt-1.5 text-muted-foreground" />
                ) : null}
              </article>
            );
          })
        ) : (
          // 无 ## 小节的手册文件兜底：整文件单卡（正文 markdown 渲染）。
          <SingleCard
            title={filename}
            body={stripFrontmatter(content).trim()}
            count={fileAnchorCount}
            anchor={filename}
            meta={meta}
          />
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
              meta={meta}
              onJumpToEntry={onJumpToEntry}
            />
          ))
        ) : (
          <SingleCard
            title={filename}
            body={stripFrontmatter(content).trim()}
            count={fileAnchorCount}
            anchor={filename}
            meta={meta}
          />
        )
      ) : null}

      {form === "index" ? (
        routes.length > 0 ? (
          categories.map((cat) => (
            <article
              key={cat}
              data-testid="index-category"
              data-category={cat}
              // INDEX 分组卡片化（2026-10-08 验收扩展）：与 manual 卡同款卡片头——
              // 每个分类一张卡（紫条 + brand-50 头 + 分组名 + 🔗），路由行为卡内
              // 可点导航（交互与 testid 不变，结构升级为统一卡片语言）。
              className="shrink-0 overflow-hidden rounded-md border border-border/60 border-l-[3px] border-l-brand-600 transition-colors hover:border-brand-400"
            >
              <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-brand-50 px-2.5 py-1.5">
                <h4 className="min-w-0 flex-1 break-words text-[13px] font-semibold text-brand-700">{cat}</h4>
                <AnchorCopyButton anchor={`${filename}#${slugifyAnchor(cat)}`} />
              </div>
              <div className="flex flex-col px-1.5 py-1">
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
            </article>
          ))
        ) : (
          <p className="px-1 py-2 text-xs text-muted-foreground">INDEX 无可点路由行。</p>
        )
      ) : null}

      {form === "single" ? (
        <SingleCard title={h1 ?? filename} body={singleBody} count={fileAnchorCount} anchor={filename} meta={meta} />
      ) : null}
    </div>
  );
}

/**
 * 单条目大卡（generated / 无小节兜底；H1 标题 + 正文 markdown 渲染）。
 * 卡片头与 manual 小节卡同款重构（FR-02 / D-003，原型 panel-c）：品牌色条 +
 * brand-50 头底 + brand-700 标题 + 🔗 复制（裸文件名，Grill CC-02）+ 元信息行。
 */
function SingleCard({
  title,
  body,
  count,
  anchor,
  meta,
}: {
  title: string;
  body: string;
  count?: number;
  /** 🔗 复制串：裸文件名（与锚点跳转的文件级口径一致）。 */
  anchor: string;
  meta: FrontmatterMeta | null;
}) {
  return (
    <article
      data-testid="single-entry-card"
      // shrink-0 同 manual 卡：防限高 flex-col 容器压缩裁切（见 manual 卡注释）。
      className="shrink-0 overflow-hidden rounded-md border border-border/60 border-l-[3px] border-l-brand-600 transition-colors hover:border-brand-400"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-brand-50 px-2.5 py-1.5">
        <h4 className="min-w-0 flex-1 break-words text-[13px] font-semibold text-brand-700">{title}</h4>
        {count !== undefined && count > 0 ? (
          <UseBadge count={count} title={`文件级命中 ${count} 次`} />
        ) : null}
        <AnchorCopyButton anchor={anchor} />
      </div>
      <FrontmatterMetaLine meta={meta} />
      {body ? (
        <CardMarkdown content={body} className="px-2.5 pb-2.5 pt-1.5 text-muted-foreground" />
      ) : null}
    </article>
  );
}

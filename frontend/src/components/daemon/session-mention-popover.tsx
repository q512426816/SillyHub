"use client";

/**
 * 会话输入联想浮层 SessionMentionPopover（task-02，变更
 * 2026-08-26-session-input-mention / FR-01 / FR-02 / FR-04 / NFR-02 / D-002）。
 *
 * 输入胶囊上方的联想列表：分组渲染、前缀优先过滤、listbox 无障碍与空态引导。
 * 视觉对齐 team-trigger-popover 的自定义浮层惯例（absolute bottom-full + z-30
 * 同锚区同层族，daemon 组件族避用 antd——规避中文按钮 autoLetterSpacing 拆分
 * 坑，见 team-trigger-popover.tsx 头注释；原型 prototype-session-input-mention.html
 * .mention-pop），最大高约 260px 内部滚动。
 *
 * 职责边界（task 卡 constraints）：
 *   - 纯受控、零网络、不用 react-query、不用 antd——数据经 props 注入（hook
 *     组装归 task-04 useMentionSources，接入归 task-03 session-input-bar）；
 *   - 浮层不读 invoke_name（回填名 `invoke_name ?? name` 由 task-03 接入层在
 *     onSelect 回调里对原始实体计算）——onSelect 抛原始实体对象（引用透传）；
 *   - 键盘不做组件内自焦点（aria-activedescendant 模式：焦点保持在 textarea），
 *     task-03 在 textarea onKeyDown 首位调本模块导出的 handleMentionKeyDown。
 *
 * task-03 消费契约（本模块导出，均在 __tests__ 覆盖）：
 *   - buildSlashMentionItems / buildAtMentionItems——候选组装（/team 置顶）；
 *   - filterMentionItems——过滤（组件渲染与 task-03 键盘数学共享同一纯函数，
 *     保证 activeIndex 在两侧指向同一条目）；
 *   - nextMentionIndex / handleMentionKeyDown——↑↓ 循环移动与 Enter/Tab/Esc
 *     拦截（命中即 preventDefault + stopPropagation，事件不外溢为发送/换行）。
 */

import { useEffect, useMemo, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
// 注：RefObject<HTMLDivElement> 取 React 18 类型口径（useRef<HTMLDivElement>(null)）。

import type { MentionPpmItem, MentionTrigger } from "@/lib/session-mention";
import type { PpmMentionScope } from "@/lib/session-mention-sources";
import type { PlatformSkillSummary } from "@/lib/custom-skills";
import type { ChangeSummary } from "@/lib/changes";
import type { QuicklogEntryListItem } from "@/lib/quicklog";
import { cn } from "@/lib/utils";

/* ───────────────── 条目类型与内置平台指令 ───────────────── */

/**
 * 内置「平台指令」条目（/ 触发组 1，design §3.2）。当前仅 /team——发送时由
 * session-panel 既有 parseTeamCommand 整条拦截（语义零改动），浮层只做可发现性。
 */
export interface SessionMentionCommand {
  kind: "command";
  /** 指令名（不含 /）：回填 `/team `，整条匹配走既有拦截链。 */
  name: "team";
  /** 展示用说明文案。 */
  description: string;
}

/** 内置 /team 常量（task-03 经 buildSlashMentionItems 组装置顶）。 */
export const TEAM_MENTION_COMMAND: SessionMentionCommand = {
  kind: "command",
  name: "team",
  description: "派团队执行任务（平台指令：发送时整条拦截弹配置层）",
};

/**
 * 联想条目判别联合：kind 驱动分组与字段取值；entity 为原始实体对象
 *（onSelect 原样抛出，task-03 由此计算回填名与绑定字段）。
 * task-06（2026-08-28-session-ppm-task-binding / FR-02）：扩展 PPM 任务/问题
 * 两类，entity 为 task-04 归一的 MentionPpmItem（kind/id/title/projectName/
 * subtitle），分组排在变更/快速修复之后。
 */
export type SessionMentionItem =
  | { kind: "command"; entity: SessionMentionCommand }
  | { kind: "skill"; entity: PlatformSkillSummary }
  | { kind: "change"; entity: ChangeSummary }
  | { kind: "quick"; entity: QuicklogEntryListItem }
  | { kind: "ppmTask"; entity: MentionPpmItem }
  | { kind: "ppmProblem"; entity: MentionPpmItem };

/** onSelect 参数：原始实体对象（联合 = 各条目 entity 的原样透传）。 */
export type SessionMentionEntity = SessionMentionItem["entity"];

/* ───────────────── 候选组装（task-03 调用） ───────────────── */

/**
 * 组装 / 联想候选：内置 /team 平台指令置顶 + 技能列表（manifest skills 原序）。
 * task-04 的 useMentionSources().skills 直传即可。
 */
export function buildSlashMentionItems(
  skills: PlatformSkillSummary[],
): SessionMentionItem[] {
  return [
    { kind: "command", entity: TEAM_MENTION_COMMAND },
    ...skills.map((s) => ({ kind: "skill", entity: s }) as SessionMentionItem),
  ];
}

/**
 * 组装 @ 联想候选：变更在前、快速修复在后、PPM 任务/问题再后（design §3.2
 * 分组序 + task-06 PPM 扩展）。task-04 已滤 default 伪 change_key 与
 * placeholder 快速修复，此处不再过滤；PPM 两参缺省空数组（旧调用点零改动）。
 */
export function buildAtMentionItems(
  changes: ChangeSummary[],
  quicklogs: QuicklogEntryListItem[],
  ppmTasks: MentionPpmItem[] = [],
  ppmProblems: MentionPpmItem[] = [],
): SessionMentionItem[] {
  return [
    ...changes.map((c) => ({ kind: "change", entity: c }) as SessionMentionItem),
    ...quicklogs.map(
      (q) => ({ kind: "quick", entity: q }) as SessionMentionItem,
    ),
    ...ppmTasks.map(
      (t) => ({ kind: "ppmTask", entity: t }) as SessionMentionItem,
    ),
    ...ppmProblems.map(
      (p) => ({ kind: "ppmProblem", entity: p }) as SessionMentionItem,
    ),
  ];
}

/* ───────────────── 过滤（纯函数，组件与 task-03 共享口径） ───────────────── */

/** 条目匹配字段：primary 参与前缀优先，secondary 仅参与包含匹配（次之）。 */
function mentionMatchTexts(item: SessionMentionItem): {
  primary: string[];
  secondary: string[];
} {
  switch (item.kind) {
    case "command":
      return {
        primary: [item.entity.name],
        secondary: [item.entity.description],
      };
    case "skill":
      return {
        primary: [item.entity.name],
        secondary: [item.entity.description],
      };
    case "change":
      // 变更标题与 change_key 均可命中（design §3.2「过滤同上」）。
      return {
        primary: [item.entity.title ?? "", item.entity.change_key],
        secondary: [],
      };
    case "quick":
      return {
        primary: [item.entity.ql_id],
        secondary: [item.entity.title],
      };
    case "ppmTask":
    case "ppmProblem":
      // 标题前缀/包含命中；项目名与说明作次级包含命中面（task-06）。
      return {
        primary: [item.entity.title],
        secondary: [item.entity.projectName ?? "", item.entity.subtitle ?? ""],
      };
  }
}

/**
 * 联想过滤（design §3.2）：前缀命中优先于包含命中，大小写不敏感；同层保持
 * 原始顺序（稳定）；空 query 全量原序返回。组件渲染与 task-03 键盘数学
 * （count / 选中项）必须共享本函数，保证 activeIndex 两侧指向同一条目。
 */
export function filterMentionItems(
  items: SessionMentionItem[],
  query: string,
): SessionMentionItem[] {
  // detectMention 保证 query 无空白；trim 仅防御异常入参。
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const prefixHits: SessionMentionItem[] = [];
  const includeHits: SessionMentionItem[] = [];
  for (const item of items) {
    const { primary, secondary } = mentionMatchTexts(item);
    if (primary.some((t) => t.toLowerCase().startsWith(q))) {
      prefixHits.push(item);
      continue;
    }
    const includes =
      primary.some((t) => t.toLowerCase().includes(q)) ||
      secondary.some((t) => t.toLowerCase().includes(q));
    if (includes) includeHits.push(item);
  }
  return [...prefixHits, ...includeHits];
}

/* ───────────────── 键盘（纯函数，task-03 textarea onKeyDown 首位接线） ───────────────── */

/** handleMentionKeyDown 的最小事件面（测试可用普通对象驱动）。 */
export type MentionKeyboardEvent = Pick<
  ReactKeyboardEvent,
  | "key"
  | "shiftKey"
  | "ctrlKey"
  | "metaKey"
  | "altKey"
  | "preventDefault"
  | "stopPropagation"
>;

/** 键盘回调集：onMove/onSelect/onClose 由持有 activeIndex 与浮层开关的父层执行。 */
export interface MentionKeyDownOptions {
  /** 过滤后可选项数（filterMentionItems(...).length；0 = 空态）。 */
  count: number;
  /** 当前高亮下标（循环移动起点）。 */
  activeIndex: number;
  /** ↑↓ 移动请求（参数为 nextMentionIndex 结果）。 */
  onMove: (next: number) => void;
  /** Enter/Tab 选中请求（选中项 = 父层过滤列表第 activeIndex 条）。 */
  onSelect: () => void;
  /** Esc 关闭请求。 */
  onClose: () => void;
}

/**
 * ↑↓ 循环移动数学：正/负 delta 均按 count 取模回绕；count<=0 恒 0（空态不移动）。
 */
export function nextMentionIndex(
  current: number,
  delta: 1 | -1,
  count: number,
): number {
  if (count <= 0) return 0;
  return (((current + delta) % count) + count) % count;
}

/**
 * 联想键盘统一入口（task-03 在 textarea onKeyDown 首位、浮层打开且非 IME
 * 组合期时调用；R-2 拦截规则集中于此）：
 *   - ↑/↓ → 循环移动（count=0 放行）；
 *   - Enter/Tab（无修饰键且非空态）→ 选中当前高亮项；
 *   - Esc（任意状态）→ 关闭；
 *   - Shift+Enter（换行）、Shift+Tab（反向焦点）、Ctrl/Meta/Alt 组合、其余
 *     按键 → 放行（返回 false，走输入框默认行为——Enter 发送归外层）。
 *
 * 命中即 preventDefault + stopPropagation 并返回 true——确认与关闭事件不外溢
 * 为外层发送/换行/弹层 Esc（design §3.2 / R-5）。
 */
export function handleMentionKeyDown(
  e: MentionKeyboardEvent,
  opts: MentionKeyDownOptions,
): boolean {
  // 输入法/系统快捷键组合不劫持（IME 组合期 task-03 已在调用前跳过）。
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  const { count, activeIndex, onMove, onSelect, onClose } = opts;
  switch (e.key) {
    case "ArrowDown":
      if (count <= 0) return false;
      e.preventDefault();
      e.stopPropagation();
      onMove(nextMentionIndex(activeIndex, 1, count));
      return true;
    case "ArrowUp":
      if (count <= 0) return false;
      e.preventDefault();
      e.stopPropagation();
      onMove(nextMentionIndex(activeIndex, -1, count));
      return true;
    case "Enter":
    case "Tab":
      // Shift+Enter 换行、Shift+Tab 反向焦点导航均放行；空态无选中项也放行。
      if (e.shiftKey || count <= 0) return false;
      e.preventDefault();
      e.stopPropagation();
      onSelect();
      return true;
    case "Escape":
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return true;
    default:
      return false;
  }
}

/* ───────────────── props 契约（task-03 消费） ───────────────── */

export interface SessionMentionPopoverProps {
  /** 触发字符（task-01 detectMention 结果透传）：/ 技能指令、@ 变更/快速修复。 */
  trigger: MentionTrigger;
  /** 查询串（触发字符之后、光标之前的连续非空白段）。 */
  query: string;
  /**
   * 候选条目（task-03 经 buildSlashMentionItems / buildAtMentionItems 组装；
   * 组件内按 query 过滤，过滤口径 = 导出的 filterMentionItems）。
   */
  items: SessionMentionItem[];
  /** 当前高亮下标（指向过滤后扁平列表；父层经 nextMentionIndex 维护）。 */
  activeIndex: number;
  /**
   * 选中回调：参数为该条目的原始实体对象（引用透传）。回填名计算
   *（invoke_name ?? name / change_key / ql_id）归 task-03。
   */
  onSelect: (entity: SessionMentionEntity) => void;
  /**
   * 关闭回调。组件本体无内置关闭交互（原型仅 Esc 关闭、无关闭钮）——由
   * task-03 经 handleMentionKeyDown 的 Esc 分支调用，props 保留使浮层键盘
   * 契约闭环。
   */
  onClose: () => void;
  /**
   * task-06（FR-02 / D-002@v1）：PPM 分组状态口径（缺省 "ongoing" 仅进行中）。
   * 仅影响 PPM 两分组的标签后缀与开关文案；与 onPpmScopeChange 配对传入才
   * 渲染分组头「切全部/仅进行中」开关（纯受控——开关状态归 task-03 接线层）。
   */
  ppmScope?: PpmMentionScope;
  /** task-06：PPM 分组头开关回调（ongoing↔all，换键重拉归数据源 hook）。 */
  onPpmScopeChange?: (next: PpmMentionScope) => void;
}

/* ───────────────── 渲染辅助 ───────────────── */

/** 分组标签（design §3.2 / 原型 .group-label；PPM 两组 task-06 追加，标签后缀
 * （进行中/全部）随 ppmScope 在渲染期拼接）。 */
const GROUP_LABELS: Record<SessionMentionItem["kind"], string> = {
  command: "平台指令",
  skill: "技能（平台 + 我的）",
  change: "变更（当前工作区）",
  quick: "快速修复（当前工作区）",
  ppmTask: "PPM 任务",
  ppmProblem: "PPM 问题",
};

/** PPM 分组标签后缀（状态口径 D-002@v1：默认进行中，可切全部）。 */
function ppmGroupLabel(
  kind: "ppmTask" | "ppmProblem",
  scope: PpmMentionScope,
): string {
  return `${GROUP_LABELS[kind]}（${scope === "all" ? "全部" : "进行中"}）`;
}

/** PPM 分组判别（task-06：ppmTask / ppmProblem 两 kind 共用渲染分支）。 */
function isPpmMentionKind(
  kind: SessionMentionItem["kind"],
): kind is "ppmTask" | "ppmProblem" {
  return kind === "ppmTask" || kind === "ppmProblem";
}

/** 条目展示字段：主行 / 次行（单行截断）/ 行内标注。 */
function mentionOptionTexts(item: SessionMentionItem): {
  primary: string;
  secondary: string | null;
  tag: string | null;
} {
  switch (item.kind) {
    case "command":
      return {
        primary: `/${item.entity.name}`,
        secondary: item.entity.description,
        tag: "平台指令",
      };
    case "skill":
      return {
        primary: item.entity.name,
        secondary: item.entity.description || null,
        tag: null,
      };
    case "change": {
      // title 空回退 change_key 展示；title 非空时次行补 change_key（design §3.2）。
      const title = item.entity.title?.trim() ? item.entity.title : null;
      return {
        primary: title ?? item.entity.change_key,
        secondary: title ? item.entity.change_key : null,
        tag: null,
      };
    }
    case "quick":
      return {
        primary: item.entity.ql_id,
        secondary: item.entity.title,
        tag: null,
      };
    case "ppmTask":
    case "ppmProblem": {
      // 主行 = 条目标题；次行标注项目名（响应自带，task-06「条目标注项目名」）；
      // 行内标注区分任务/问题（对齐原型 .badge）。
      const projectName = item.entity.projectName?.trim() || null;
      return {
        primary: item.entity.title,
        secondary: projectName,
        tag: item.kind === "ppmTask" ? "任务" : "问题",
      };
    }
  }
}

/** 过滤后扁平列表按相邻同类分段（保持过滤排序；跨层重排也能正确分段）。 */
function groupMentionItems(filtered: SessionMentionItem[]): {
  kind: SessionMentionItem["kind"];
  items: { item: SessionMentionItem; flatIndex: number }[];
}[] {
  const groups: {
    kind: SessionMentionItem["kind"];
    items: { item: SessionMentionItem; flatIndex: number }[];
  }[] = [];
  filtered.forEach((item, flatIndex) => {
    const last = groups[groups.length - 1];
    if (last && last.kind === item.kind) {
      last.items.push({ item, flatIndex });
    } else {
      groups.push({ kind: item.kind, items: [{ item, flatIndex }] });
    }
  });
  return groups;
}

/** 单个选项行（role=option；mousedown 选中且不偷输入框焦点）。 */
function MentionOption({
  item,
  flatIndex,
  active,
  onSelect,
  activeRef,
}: {
  item: SessionMentionItem;
  flatIndex: number;
  active: boolean;
  onSelect: (entity: SessionMentionEntity) => void;
  activeRef: RefObject<HTMLDivElement>;
}) {
  const { primary, secondary, tag } = mentionOptionTexts(item);
  // aria-activedescendant 指向 id：与父层 activeIndex 同口径（过滤后扁平下标）。
  const id = `mention-option-${flatIndex}`;
  return (
    <div
      id={id}
      data-testid={id}
      ref={active ? activeRef : undefined}
      role="option"
      aria-selected={active}
      onMouseDown={(e) => {
        // preventDefault：不夺输入框焦点（浮层内点击先于 blur，design §3.1
        // 「blur 且非浮层内点击」关闭规则的共存前提）。
        e.preventDefault();
        // 原始实体对象引用透传（回填名 invoke_name ?? name 归 task-03）。
        onSelect(item.entity);
      }}
      className={cn(
        "flex cursor-pointer flex-col gap-0.5 px-3.5 py-1.5",
        active && "bg-muted",
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          className={cn(
            "truncate text-[13px] font-medium",
            active ? "text-brand-700" : "text-foreground",
          )}
        >
          {primary}
        </span>
        {tag && (
          <span className="shrink-0 rounded border border-brand-200 px-1 text-[10px] font-normal text-brand-700">
            {tag}
          </span>
        )}
      </span>
      {secondary && (
        <span className="truncate text-[11px] text-muted-foreground">
          {secondary}
        </span>
      )}
    </div>
  );
}

/* ───────────────── 组件 ───────────────── */

export function SessionMentionPopover({
  trigger,
  query,
  items,
  activeIndex,
  onSelect,
  ppmScope = "ongoing",
  onPpmScopeChange,
}: SessionMentionPopoverProps) {
  // 过滤口径与 task-03 共享（filterMentionItems 单一源）。
  const filtered = useMemo(() => filterMentionItems(items, query), [items, query]);
  const groups = useMemo(() => groupMentionItems(filtered), [filtered]);

  // activeIndex 越界防御（过滤收窄后父层未同步）：不指向不存在项。
  const effectiveActive =
    activeIndex >= 0 && activeIndex < filtered.length ? activeIndex : -1;
  const activeId =
    effectiveActive >= 0 ? `mention-option-${effectiveActive}` : undefined;

  // 高亮项滚入可视区（键盘跨屏导航；jsdom 无 scrollIntoView 实现需守卫）。
  const activeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (activeRef.current && typeof activeRef.current.scrollIntoView === "function") {
      activeRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [activeId, filtered]);

  return (
    // 定位壳（无 role）：与 TeamTriggerPopover 同锚区同层族（R-5 互斥与
    // z-index 同层——absolute bottom-full left-0 z-30，team-trigger-popover 同款）。
    <div
      data-testid="session-mention-popover"
      className="absolute bottom-full left-0 right-0 z-30 mb-1.5 overflow-hidden rounded-xl border border-brand-200 bg-card py-1 text-xs shadow-md"
    >
      <div
        role="listbox"
        aria-label={trigger === "/" ? "技能与指令联想" : "变更、快速修复与 PPM 联想"}
        aria-activedescendant={activeId}
        className="max-h-[260px] overflow-y-auto"
      >
        {groups.map((group) => (
          <div key={`${group.kind}-${group.items[0]!.flatIndex}`}>
            {isPpmMentionKind(group.kind) ? (
              // task-06（FR-02 / D-002@v1）：PPM 分组头——状态口径后缀 +
              // 「切全部/仅进行中」小开关（纯受控，状态归 task-03 接线层；
              // 未传 onPpmScopeChange 时只渲染标签不带开关）。开关 mousedown
              // preventDefault 不夺输入框焦点（与选项行同规则），点击只换键
              // 重拉不选中不关层。
              <div className="flex items-center justify-between gap-2 px-3.5 pb-1 pt-1.5">
                <p className="text-[11px] tracking-wide text-muted-foreground">
                  {ppmGroupLabel(group.kind, ppmScope)}
                </p>
                {onPpmScopeChange && (
                  <button
                    type="button"
                    data-testid={`mention-ppm-scope-${group.kind}`}
                    aria-label={`PPM 分组状态范围（当前${
                      ppmScope === "all" ? "全部" : "仅进行中"
                    }，点击切换）`}
                    title={
                      ppmScope === "ongoing"
                        ? "显示全部状态的 PPM 条目（D-002 全状态可关联）"
                        : "只显示进行中的 PPM 条目"
                    }
                    onMouseDown={(e) => {
                      e.preventDefault();
                    }}
                    onClick={() => {
                      onPpmScopeChange(ppmScope === "ongoing" ? "all" : "ongoing");
                    }}
                    className="shrink-0 rounded border border-brand-200 px-1.5 py-0.5 text-[10px] text-brand-700 transition-colors hover:bg-brand-50"
                  >
                    {ppmScope === "ongoing" ? "切全部" : "仅进行中"}
                  </button>
                )}
              </div>
            ) : (
              <p className="px-3.5 pb-1 pt-1.5 text-[11px] tracking-wide text-muted-foreground">
                {GROUP_LABELS[group.kind]}
              </p>
            )}
            {group.items.map(({ item, flatIndex }) => (
              <MentionOption
                key={flatIndex}
                item={item}
                flatIndex={flatIndex}
                active={flatIndex === effectiveActive}
                onSelect={onSelect}
                activeRef={activeRef}
              />
            ))}
          </div>
        ))}
        {filtered.length === 0 &&
          (items.length === 0 ? (
            // 数据源缺失 / manifest 404 引导（task 卡：空态与 404 引导）。
            <p
              data-testid="mention-guide"
              className="px-3.5 py-2.5 text-[12px] leading-relaxed text-muted-foreground"
            >
              {trigger === "/"
                ? "技能清单未就绪（加载失败或暂无技能）——可到「设置 · 我的技能」查看或创建。"
                : "暂无可关联的变更、快速修复或 PPM 条目——@ 联想需在挂接工作区的会话中使用。"}
            </p>
          ) : (
            // 有数据但无匹配（前缀与包含均未命中）。
            <p
              data-testid="mention-empty"
              className="px-3.5 py-2.5 text-[12px] leading-relaxed text-muted-foreground"
            >
              {`无匹配「${query}」`}
              {trigger === "/"
                ? "——可到「设置 · 我的技能」创建技能。"
                : "——@ 需在挂接工作区的会话中使用。"}
            </p>
          ))}
      </div>
      {/* 键盘提示条（原型 .kbd-hint） */}
      <p className="border-t border-border px-3.5 py-1 text-[10px] text-muted-foreground/80">
        ↑↓ 移动 · Enter/Tab 选中 · Esc 关闭
      </p>
    </div>
  );
}

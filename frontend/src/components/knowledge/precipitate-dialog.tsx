"use client";

/**
 * 「沉淀知识」弹层（task-05 / 2026-09-17-knowledge-precipitation / FR-02）。
 *
 * 对照原型 precipitateModal：双 tab（从记录提炼 / 手工录入）。
 * - 手工录入（task-05）：标题必填 + 分类下拉（Conventions / Patterns /
 *   Known Issues / 未分类）+ 正文必填 Markdown textarea，提交调
 *   proposeKnowledge（POST /knowledge/propose）落 knowledge/proposed/<slug>.md，
 *   成功后关弹层、toast 提示并经 onProposed 刷新列表使条目出现在待审核区。
 * - 从记录提炼（task-08 / FR-01 / FR-03 / D-002@v1；task-08 扩展增量
 *   D-009+D-010）：来源类型三分段（会话记录 / 变更归档 / 快速修复），
 *   源列表单选（session/change）或 checkbox 多选（quick，对应 source_ref
 *   list[str]）；「派谁去干」会话源默认 resume（推荐徽标）/fresh 可选，
 *   变更/快速修复无原会话概念强制 fresh（resume 禁用 + 提示）；选 fresh
 *   展开配置区——机器（runtime，listDaemonRuntimes 在线列表实名复用）+
 *   agent 类型（在线 runtime distinct provider，PROVIDER_META 标签）；派发
 *   按 mode 组装 DistillDispatchIn（resume→仅 source_ref；fresh→附
 *   runtime_id/agent_type；quick→source_ref 多选 list）。已沉淀反链
 *   （D-010①）：来源项匹配 listDistillTasks 命中已沉淀任务时渲染
 *   「已沉淀 ↗」标签，点击跳 merged_to 目标文件（未合并则仅关弹层回
 *   知识库页，proposed 候选无精确文件名可锚）。源列表走既有实名 API：
 *   会话 listAgentSessions（@/lib/daemon/session-lists，workspace_id 过滤）、
 *   变更 listChanges（@/lib/changes，status=archived）、快速修复
 *   listQuicklog（@/lib/knowledge，GET /quicklog）。
 *
 * 弹层自身不做权限判断——可见性由 knowledge/page.tsx 按 KNOWLEDGE_WRITE
 * 持有者控制（卡片约束：写入口可见性 = useSession permissions + is_platform_admin
 * 短路，runtime 页 93-94 行先例）。
 *
 * 注：tab 骨架用原生 button + role=tab 实现（对照原型 .tabs/.tab 结构）而非
 * antd Tabs——antd v6 Tabs 样式含 ``:has()``/``:focus-visible`` 选择器，jsdom
 * 的 nwsapi 无法解析（组件测试实测 SyntaxError），原型本身也是原生 tab 条。
 */

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { listChanges } from "@/lib/changes";
import { listDaemonRuntimes, PROVIDER_META } from "@/lib/daemon";
import { listAgentSessions } from "@/lib/daemon/session-lists";
import { errMessage, useNotify } from "@/lib/errors";
import {
  dispatchDistill,
  listDistillTasks,
  listQuicklog,
  proposeKnowledge,
  type DistillDispatchIn,
  type DistillTaskRead,
} from "@/lib/knowledge";
import { cn } from "@/lib/utils";

/** 分类选项：值对齐 CLI knowledge propose --category（默认 uncategorized）。 */
const CATEGORY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "conventions", label: "Conventions（约定）" },
  { value: "patterns", label: "Patterns（模式）" },
  { value: "known-issues", label: "Known Issues（已知坑）" },
  { value: "uncategorized", label: "未分类" },
];

const DEFAULT_CATEGORY = "uncategorized";

/** 源列表单次拉取上限（弹层选择器够用即可，避免巨型工作区全量拉）。 */
const SOURCE_LIST_LIMIT = 50;

/** 提炼来源类型（对齐后端 DistillDispatchIn.source_type Literal，D-010② 扩 quick）。 */
type DistillSourceType = "session" | "change" | "quick";

/** 源列表条目（三类源投影到同一形态供列表渲染）。 */
interface DistillSourceItem {
  /** DistillDispatchIn.source_ref：会话 id（UUID）/ 变更 change_key / ql 自然键短码（filename 去 .md）。 */
  ref: string;
  /** 主标题：会话 title / 变更 title / ql 标题。 */
  title: string;
  /** 副标题：会话「N 条记录」/ 变更「已归档」/ 快速修复日期。 */
  sub: string;
}

/** 来源类型分段选项（原型 .seg 三键；quick 为 D-010② 新增）。 */
const SOURCE_TYPE_OPTIONS: ReadonlyArray<{ value: DistillSourceType; label: string }> = [
  { value: "session", label: "会话记录" },
  { value: "change", label: "变更归档" },
  { value: "quick", label: "快速修复" },
];

/** 各来源类型的列表空态文案。 */
const SOURCE_EMPTY_TEXT: Record<DistillSourceType, string> = {
  session: "当前工作区暂无可选会话记录。",
  change: "暂无已归档变更可选。",
  quick: "当前工作区暂无快速修复记录。",
};

/** 各来源类型的条目图标（原型 .src-item .icon）。 */
const SOURCE_ICON: Record<DistillSourceType, string> = {
  session: "💬",
  change: "📦",
  quick: "🩹",
};

/** 会话源标题兜底：title 缺失（无 user_input）时退到 id 前 8 位。 */
function sessionTitle(id: string, title: string | null): string {
  return title && title.trim() ? title : `会话 ${id.slice(0, 8)}`;
}

/**
 * quick 蒸馏任务反链键集合（D-010① 已沉淀判定）：多选蒸馏任务条的
 * metadata_.source_ref 落库为 list 形态（单选 quick 也按 list 存），投影到
 * DistillTaskRead.source_ref（string）后可能是 JSON 数组串——两种形态都解析，
 * 与后端存储口径同根容错。
 */
function taskSourceRefs(task: DistillTaskRead): string[] {
  const raw = task.source_ref;
  if (raw && raw.trim().startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      /* 非 JSON 按单条兜底 */
    }
  }
  return raw ? [raw] : [];
}

/** 判定某来源项是否已有对应蒸馏任务（已沉淀），返回任务供反链跳转。 */
function matchPrecipitated(
  tasks: ReadonlyArray<DistillTaskRead>,
  sourceType: DistillSourceType,
  ref: string,
): DistillTaskRead | null {
  if (sourceType === "quick") {
    for (const task of tasks) {
      if (task.source_type === "quick" && taskSourceRefs(task).includes(ref)) return task;
    }
    return null;
  }
  return (
    tasks.find((t) => t.source_type === sourceType && t.source_ref === ref) ?? null
  );
}

interface Props {
  workspaceId: string;
  onClose: () => void;
  /** 手工录入成功后的刷新回调（父级重拉列表，新候选出现在待审核区）。 */
  onProposed: () => void;
  /** 派发提炼任务成功后的回调（父级 invalidate 任务条查询，任务条立即出现）。 */
  onDistilled?: () => void;
  /**
   * 已沉淀反链跳转（D-010①）：点击来源项「已沉淀 ↗」标签且任务已合并时，
   * 父级选中 merged_to 目标文件并加载内容；未合并（proposed 候选）不触发
   * 本回调，弹层仅关闭回到知识库页（候选文件名无法从任务投影精确定位）。
   */
  onJumpToKnowledge?: (filename: string) => void;
}

export function PrecipitateDialog({ workspaceId, onClose, onProposed, onDistilled, onJumpToKnowledge }: Props) {
  // task-08 落地后默认落在「从记录提炼」tab（原型 precipitateModal 同款；
  // task-05 阶段曾默认 manual，注释约定本任务翻转）。
  const [activeTab, setActiveTab] = useState("distill");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(DEFAULT_CATEGORY);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notify = useNotify();

  // ── 从记录提炼 tab 状态（task-08；D-009/D-010 扩展）────────────────────────
  const [sourceType, setSourceType] = useState<DistillSourceType>("session");
  const [sources, setSources] = useState<DistillSourceItem[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  /** 已选单选源（session/change 的 DistillSourceItem.ref），null = 未选。 */
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  /** 已选 quick 多选源（ql 自然键短码集合，对应 source_ref list[str]，D-010②）。 */
  const [selectedQuick, setSelectedQuick] = useState<string[]>([]);
  /** 派谁去干（D-009）：会话源可选 resume/fresh；change/quick 强制 fresh。 */
  const [executorMode, setExecutorMode] = useState<"resume" | "fresh">("resume");
  /** fresh 配置（D-010③）：空串 = 不指定，后端回落 workspace 默认。 */
  const [freshRuntimeId, setFreshRuntimeId] = useState("");
  const [freshAgentType, setFreshAgentType] = useState("");
  /** 在线 runtime 列表（机器下拉 + agent 类型下拉同源一次拉取）。 */
  const [onlineRuntimes, setOnlineRuntimes] = useState<
    Array<{ id: string; label: string; provider: string | null }>
  >([]);
  /** 已沉淀反链（D-010①）：蒸馏任务全集，渲染期按 source_ref 反查来源项。 */
  const [precipitated, setPrecipitated] = useState<DistillTaskRead[]>([]);
  const [focus, setFocus] = useState("");
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);

  // change/quick 无「原会话」概念 → 强制 fresh（原型 isFreshForced 同款推导）。
  const effectiveMode: "resume" | "fresh" = sourceType === "session" ? executorMode : "fresh";
  const isQuickSource = sourceType === "quick";

  // 源列表拉取（提炼 tab 激活时按 sourceType 拉取；切换类型重拉并清选择）。
  // 序号守卫防竞态：切类型/关弹层后旧响应晚到不落 state。
  const sourcesSeqRef = useRef(0);
  useEffect(() => {
    if (activeTab !== "distill") return;
    const seq = ++sourcesSeqRef.current;
    let cancelled = false;
    setSourcesLoading(true);
    setSourcesError(null);
    setSources([]);
    setSelectedSource(null);
    setSelectedQuick([]);
    const promise =
      sourceType === "session"
        ? listAgentSessions({
            workspace_id: workspaceId,
            limit: SOURCE_LIST_LIMIT,
          }).then((resp) =>
            resp.items.map<DistillSourceItem>((s) => ({
              ref: s.id,
              title: sessionTitle(s.id, s.title),
              sub: `${s.turn_count} 条记录`,
            })),
          )
        : sourceType === "change"
          ? listChanges(workspaceId, {
              status: "archived",
              pageSize: SOURCE_LIST_LIMIT,
            }).then((resp) =>
              resp.items.map<DistillSourceItem>((c) => ({
                ref: c.change_key,
                title: c.title && c.title.trim() ? c.title : c.change_key,
                sub: "已归档变更",
              })),
            )
          : // D-010② quick 来源：GET /quicklog（knowledge.ts 现有封装），source_ref
            // 取 filename 去 .md 的自然键短码（后端按 `{ref}.md` 校验存在性）。
            listQuicklog(workspaceId).then((resp) =>
              resp.items.map<DistillSourceItem>((e) => ({
                ref: e.filename.replace(/\.md$/i, ""),
                title: e.title && e.title.trim() ? e.title : e.filename,
                sub: e.last_modified_at
                  ? `快速修复 · ${e.last_modified_at.slice(0, 10)}`
                  : "快速修复",
              })),
            );
    promise
      .then((items) => {
        if (!cancelled && seq === sourcesSeqRef.current) setSources(items);
      })
      .catch((err) => {
        if (!cancelled && seq === sourcesSeqRef.current) {
          setSourcesError(errMessage(err, "加载来源列表失败，请重试"));
        }
      })
      .finally(() => {
        if (!cancelled && seq === sourcesSeqRef.current) setSourcesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, sourceType, workspaceId]);

  // 在线 runtime 一次拉取（fresh 配置区数据源；失败静默——配置区展示空列表，
  // 与 AgentProviderSelect R-04 同款退化口径）。
  useEffect(() => {
    if (activeTab !== "distill") return;
    let cancelled = false;
    listDaemonRuntimes()
      .then((rs) => {
        if (cancelled) return;
        const online = rs.filter((r) => r.status === "online" && r.id);
        setOnlineRuntimes(
          online.map((r) => ({
            id: r.id as string,
            label: `${r.display_alias ?? r.name ?? r.id}${
              r.provider ? `（${PROVIDER_META[r.provider]?.label ?? r.provider}）` : ""
            }`,
            provider: r.provider,
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setOnlineRuntimes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  // 已沉淀反链（D-010①）：拉一次蒸馏任务列表，渲染期按 source_ref 反查来源项；
  // 失败静默（反链是增强信息，不阻断来源选择）。
  useEffect(() => {
    if (activeTab !== "distill") return;
    let cancelled = false;
    listDistillTasks(workspaceId)
      .then((tasks) => {
        if (!cancelled) setPrecipitated(tasks);
      })
      .catch(() => {
        if (!cancelled) setPrecipitated([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, workspaceId]);

  const canSubmit = title.trim().length > 0 && body.trim().length > 0 && !submitting;
  // quick 多选：≥1 条即可派发（单条也走 list[str] 形态，与后端 quick 口径一致）；
  // session/change 单选：选中即达。
  const canDispatch =
    !dispatching && (isQuickSource ? selectedQuick.length > 0 : selectedSource !== null);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await proposeKnowledge(workspaceId, {
        title: title.trim(),
        category,
        body,
      });
      notify.success("已存为候选知识，进入待审核区");
      onProposed();
      onClose();
    } catch (err) {
      setError(errMessage(err, "保存失败，请重试"));
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * 已沉淀反链跳转（D-010①）：merged_to 为「目标文件#小节标题」双键，取文件
   * 段让父级选中并加载；未合并（proposed 候选，任务投影无候选文件名）仅关
   * 弹层回到知识库页，由用户在待审核区定位。
   */
  const handleJumpPrecipitated = (task: DistillTaskRead) => {
    const target = task.merged_to ? task.merged_to.split("#")[0] : null;
    if (target) onJumpToKnowledge?.(target);
    onClose();
  };

  const handleDispatch = async () => {
    if (!canDispatch) return;
    // 按 mode 组装 DistillDispatchIn（生成类型，禁手写窄化）：
    // - resume（仅会话源）：原会话续接，不带 fresh 配置；
    // - fresh：附 runtime_id/agent_type（空串不下发，后端回落 workspace 默认）；
    // - quick：source_ref 多选 list[str]（D-010②），change/quick 恒 fresh。
    const payload: DistillDispatchIn = {
      source_type: sourceType,
      source_ref: isQuickSource
        ? [...selectedQuick]
        : (selectedSource as string),
      focus: focus.trim() ? focus.trim() : null,
      mode: effectiveMode,
    };
    if (effectiveMode === "fresh") {
      if (freshRuntimeId) payload.runtime_id = freshRuntimeId;
      if (freshAgentType) payload.agent_type = freshAgentType;
    }
    setDispatching(true);
    setDispatchError(null);
    try {
      await dispatchDistill(workspaceId, payload);
      notify.success("已派发提炼任务，完成后进入待审核");
      onDistilled?.();
      onClose();
    } catch (err) {
      setDispatchError(errMessage(err, "派发失败，请重试"));
    } finally {
      setDispatching(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting && !dispatching) onClose();
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
            <Sparkles className="h-5 w-5" />
          </div>
          <DialogTitle>沉淀知识</DialogTitle>
          <DialogDescription>
            生成候选知识进入「待审核」，人工确认后合并进正式知识文件（与 sillyspec CLI
            同一份知识库）。
          </DialogDescription>
        </DialogHeader>

        {/* 双 tab 骨架（对照原型 .tabs/.tab：底部 2px 指示条 + 激活态品牌色） */}
        <div role="tablist" aria-label="沉淀方式" className="flex gap-1 border-b border-border">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "distill"}
            onClick={() => setActiveTab("distill")}
            className={cn(
              "-mb-px border-b-2 px-3.5 py-1.5 text-xs transition-colors",
              activeTab === "distill"
                ? "border-brand-600 font-semibold text-brand-700"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            从记录提炼
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "manual"}
            onClick={() => setActiveTab("manual")}
            className={cn(
              "-mb-px border-b-2 px-3.5 py-1.5 text-xs transition-colors",
              activeTab === "manual"
                ? "border-brand-600 font-semibold text-brand-700"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            手工录入
          </button>
        </div>

        {activeTab === "distill" ? (
          <div className="space-y-4">
            {/* 来源类型（对照原型 .seg 分段切换；D-010② 扩「快速修复」三键） */}
            <div>
              <span className="text-xs font-medium text-muted-foreground">来源类型</span>
              <div
                role="radiogroup"
                aria-label="来源类型"
                className="mt-1 inline-flex rounded-md border border-input p-0.5"
              >
                {SOURCE_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={sourceType === opt.value}
                    data-testid={`distill-source-type-${opt.value}`}
                    onClick={() => setSourceType(opt.value)}
                    className={cn(
                      "rounded px-3 py-1 text-xs transition-colors",
                      sourceType === opt.value
                        ? "bg-brand-100 font-semibold text-brand-700"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    disabled={dispatching}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {isQuickSource && (
                <p className="mt-1 text-[10.5px] text-muted-foreground">
                  快速修复可勾选多条一起提炼。
                </p>
              )}
            </div>

            {/* 源列表（对照原型 .src-list/.src-item；quick 为 checkbox 多选 D-010②） */}
            <div>
              <span id="distill-source-list-label" className="text-xs font-medium text-muted-foreground">
                选择记录 <span className="text-destructive">*</span>
              </span>
              <div
                role={isQuickSource ? "group" : "listbox"}
                aria-labelledby="distill-source-list-label"
                data-testid="distill-source-list"
                className="mt-1 max-h-52 overflow-auto rounded-md border border-input"
              >
                {sourcesError ? (
                  <p className="px-3 py-4 text-xs text-destructive">{sourcesError}</p>
                ) : sourcesLoading ? (
                  <p className="px-3 py-4 text-xs text-muted-foreground">加载来源列表中…</p>
                ) : sources.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-muted-foreground">
                    {SOURCE_EMPTY_TEXT[sourceType]}
                  </p>
                ) : (
                  sources.map((item) => {
                    const selected = isQuickSource
                      ? selectedQuick.includes(item.ref)
                      : selectedSource === item.ref;
                    const precipTask = matchPrecipitated(precipitated, sourceType, item.ref);
                    return (
                      <button
                        key={item.ref}
                        type="button"
                        role={isQuickSource ? "checkbox" : "option"}
                        aria-checked={selected}
                        aria-selected={isQuickSource ? undefined : selected}
                        data-testid="distill-source-item"
                        onClick={() => {
                          if (isQuickSource) {
                            setSelectedQuick((prev) =>
                              prev.includes(item.ref)
                                ? prev.filter((r) => r !== item.ref)
                                : [...prev, item.ref],
                            );
                          } else {
                            setSelectedSource(item.ref);
                          }
                        }}
                        disabled={dispatching}
                        className={cn(
                          "flex w-full flex-col items-start gap-0.5 border-b border-border/60 px-3 py-2 text-left last:border-b-0",
                          selected ? "bg-brand-50" : "hover:bg-muted/50",
                        )}
                      >
                        <span className="flex w-full items-center gap-1.5">
                          {isQuickSource && (
                            <input
                              type="checkbox"
                              aria-hidden
                              tabIndex={-1}
                              checked={selected}
                              readOnly
                              className="h-3.5 w-3.5 shrink-0 accent-brand-600"
                            />
                          )}
                          <span aria-hidden className="shrink-0 text-[11px]">
                            {SOURCE_ICON[sourceType]}
                          </span>
                          <span
                            className={cn(
                              "min-w-0 flex-1 truncate text-[13px]",
                              selected && "font-semibold text-brand-700",
                            )}
                            title={item.title}
                          >
                            {item.title}
                          </span>
                          {/* 已沉淀反链（D-010①）：命中蒸馏任务 → 标签点击跳 merged_to */}
                          {precipTask && (
                            <span
                              role="button"
                              tabIndex={0}
                              data-testid="distill-precipitated-badge"
                              title={precipTask.merged_to ? `已沉淀，点击查看：${precipTask.merged_to}` : "已沉淀，候选在待审核区"}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!dispatching) handleJumpPrecipitated(precipTask);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.stopPropagation();
                                  if (!dispatching) handleJumpPrecipitated(precipTask);
                                }
                              }}
                              className="shrink-0 cursor-pointer rounded-full bg-success/10 px-2 py-0.5 text-[10.5px] font-medium text-success hover:bg-success hover:text-success-foreground"
                            >
                              已沉淀 ↗
                            </span>
                          )}
                          {!isQuickSource && selected && (
                            <span aria-hidden className="shrink-0 text-xs text-brand-600">✓</span>
                          )}
                        </span>
                        <span className="pl-5 text-[11px] text-muted-foreground">{item.sub}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* 派谁去干（D-009 原型 .executor-opts）：会话源 resume 推荐 / fresh
                可选；change/quick 无原会话概念强制 fresh（resume 禁用 + 提示）。 */}
            <fieldset disabled={dispatching}>
              <legend className="text-xs font-medium text-muted-foreground">派谁去干</legend>
              <div className="mt-1 flex flex-col gap-2">
                <label
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 transition-colors",
                    effectiveMode === "resume"
                      ? "border-brand-300 bg-brand-50"
                      : "border-border hover:border-brand-200",
                    sourceType !== "session" && "cursor-not-allowed opacity-50",
                  )}
                >
                  <input
                    type="radio"
                    name="distill-executor"
                    aria-label="原会话续接"
                    className="mt-0.5 shrink-0 accent-brand-600"
                    checked={effectiveMode === "resume"}
                    disabled={sourceType !== "session"}
                    onChange={() => setExecutorMode("resume")}
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold">
                      原会话续接
                      {sourceType === "session" && (
                        <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10.5px] font-medium text-brand-700">
                          推荐
                        </span>
                      )}
                    </span>
                    <span className="text-[11px] leading-5 text-muted-foreground">
                      在原 agent 会话里继续干——有完整上下文，快、省 token、质量高。
                    </span>
                  </span>
                </label>
                <label
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 transition-colors",
                    effectiveMode === "fresh"
                      ? "border-brand-300 bg-brand-50"
                      : "border-border hover:border-brand-200",
                  )}
                >
                  <input
                    type="radio"
                    name="distill-executor"
                    aria-label="新建 agent"
                    className="mt-0.5 shrink-0 accent-brand-600"
                    checked={effectiveMode === "fresh"}
                    onChange={() => setExecutorMode("fresh")}
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[13px] font-semibold">新建 agent</span>
                    <span className="text-[11px] leading-5 text-muted-foreground">
                      开一个新 agent 去读记录——适合想换个视角、或会话已删/引擎不支持续接。
                    </span>
                  </span>
                </label>
              </div>
              {sourceType !== "session" && (
                <p className="mt-1 text-[10.5px] text-muted-foreground">
                  {isQuickSource
                    ? "快速修复是零散记录，无「原会话」概念，固定走新建 agent。"
                    : "变更归档没有「原会话」概念，固定走新建 agent。"}
                </p>
              )}
            </fieldset>

            {/* fresh 配置区（D-010③，原型 .fresh-grid）：机器钉 runtime（优先于
                agent 类型）+ agent 类型（provider），空值不下发由后端回落
                workspace 默认（对齐 create_session 双入口）。 */}
            {effectiveMode === "fresh" && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">
                  新建 agent 配置 <span className="text-destructive">*</span>
                </span>
                <div className="mt-1 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium text-muted-foreground">机器（runtime）</span>
                    <select
                      aria-label="机器（runtime）"
                      value={freshRuntimeId}
                      onChange={(e) => setFreshRuntimeId(e.target.value)}
                      disabled={dispatching}
                      className="h-8 w-full rounded border border-input bg-background px-2.5 text-xs focus:border-ring focus:outline-none"
                    >
                      <option value="">自动选择（推荐）</option>
                      {onlineRuntimes.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium text-muted-foreground">agent 类型</span>
                    <select
                      aria-label="agent 类型"
                      value={freshAgentType}
                      onChange={(e) => setFreshAgentType(e.target.value)}
                      disabled={dispatching}
                      className="h-8 w-full rounded border border-input bg-background px-2.5 text-xs focus:border-ring focus:outline-none"
                    >
                      <option value="">使用工作区默认</option>
                      {Array.from(new Set(onlineRuntimes.map((r) => r.provider).filter(Boolean))).map(
                        (p) => (
                          <option key={p} value={p as string}>
                            {PROVIDER_META[p as string]?.label ?? (p as string)}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                </div>
                <p className="mt-1 text-[10.5px] text-muted-foreground">
                  触发后建一个正式会话去干活（标题带「提炼」前缀），不在常规会话页展示，仅在这边有提炼记录可跳转。
                </p>
              </div>
            )}

            {/* 关注点（可选，透传 DistillDispatchIn.focus；后端 max_length=2000） */}
            <div>
              <label
                htmlFor="distill-focus"
                className="text-xs font-medium text-muted-foreground"
              >
                提炼关注点（可选）
              </label>
              <textarea
                id="distill-focus"
                aria-label="提炼关注点"
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                placeholder="告诉 agent 这次重点提炼什么，例如：只提取踩坑与解法，忽略功能描述……"
                className="mt-1 min-h-[68px] w-full resize-y rounded border border-input bg-background px-2.5 py-2 text-xs leading-5 focus:border-ring focus:outline-none"
                maxLength={2000}
                disabled={dispatching}
              />
              <p className="text-[10.5px] text-muted-foreground">
                {effectiveMode === "resume"
                  ? "续接原会话派发后任务在后台执行，完成后候选知识出现在「待审核」区。"
                  : "新建 agent 在后台读取记录并提炼，完成后候选知识出现在「待审核」区，来源无需保持在线。"}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label
                htmlFor="precipitate-title"
                className="text-xs font-medium text-muted-foreground"
              >
                标题 <span className="text-destructive">*</span>
              </label>
              <Input
                id="precipitate-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：Windows 控制台码页导致日志乱码"
                className="mt-1"
                maxLength={200}
                disabled={submitting}
              />
            </div>
            <div>
              <label
                htmlFor="precipitate-category"
                className="text-xs font-medium text-muted-foreground"
              >
                分类
              </label>
              <select
                id="precipitate-category"
                aria-label="分类"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1 h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none"
                disabled={submitting}
              >
                {CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="precipitate-body"
                className="text-xs font-medium text-muted-foreground"
              >
                正文 <span className="text-destructive">*</span>
              </label>
              <textarea
                id="precipitate-body"
                aria-label="正文"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Markdown 正文：问题、解法、证据（文件/提交）、适用条件……"
                className="mt-1 min-h-[110px] w-full resize-y rounded border border-input bg-background px-2.5 py-2 font-mono text-xs leading-5 focus:border-ring focus:outline-none"
                disabled={submitting}
              />
              <p className="text-[10.5px] text-muted-foreground">
                保存后进入「待审核」区，可继续编辑，审核合并时自动追加到目标知识文件并更新
                INDEX 路由。
              </p>
            </div>
          </div>
        )}

        {activeTab === "distill"
          ? dispatchError && (
              <div className="rounded-lg border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
                {dispatchError}
              </div>
            )
          : error && (
              <div className="rounded-lg border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={activeTab === "distill" ? dispatching : submitting}
          >
            取消
          </Button>
          {activeTab === "distill" ? (
            <Button
              data-testid="dispatch-distill"
              onClick={() => void handleDispatch()}
              disabled={!canDispatch}
            >
              {dispatching
                ? "派发中…"
                : effectiveMode === "resume"
                  ? "续接原会话提炼"
                  : "新建 agent 提炼"}
            </Button>
          ) : (
            <Button onClick={() => void handleSubmit()} disabled={!canSubmit}>
              {submitting ? "保存中…" : "存为候选知识"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

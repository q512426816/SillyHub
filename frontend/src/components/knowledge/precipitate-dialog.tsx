"use client";

/**
 * 「沉淀知识」弹层（task-05 / 2026-09-17-knowledge-precipitation / FR-02）。
 *
 * 对照原型 precipitateModal：双 tab（从记录提炼 / 手工录入）。
 * - 手工录入（task-05）：标题必填 + 分类下拉（Conventions / Patterns /
 *   Known Issues / 未分类）+ 正文必填 Markdown textarea，提交调
 *   proposeKnowledge（POST /knowledge/propose）落 knowledge/proposed/<slug>.md，
 *   成功后关弹层、toast 提示并经 onProposed 刷新列表使条目出现在待审核区。
 * - 从记录提炼（task-08 / FR-01 / FR-03 / D-002@v1）：来源类型切换（会话记录 /
 *   变更归档）+ 源列表单选 + 关注点 textarea，提交调 dispatchDistill
 *   （POST /knowledge/distill，source_type 取 session/change、source_ref 取
 *   会话 id 或变更 change_key、focus 可选透传），成功后关弹层、toast 并经
 *   onDistilled 使任务条查询立即刷新。源列表走既有实名 API：会话
 *   listAgentSessions（@/lib/daemon/session-lists，传 workspace_id 过滤当前
 *   工作区）、变更 listChanges（@/lib/changes，status=archived 仅已归档）。
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
import { listAgentSessions } from "@/lib/daemon/session-lists";
import { errMessage, useNotify } from "@/lib/errors";
import { dispatchDistill, proposeKnowledge } from "@/lib/knowledge";
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

/** 提炼来源类型（对齐后端 DistillDispatchIn.source_type Literal）。 */
type DistillSourceType = "session" | "change";

/** 源列表条目（两类源投影到同一形态供单选列表渲染）。 */
interface DistillSourceItem {
  /** DistillDispatchIn.source_ref：会话 id（UUID）/ 变更 change_key。 */
  ref: string;
  /** 主标题：会话 title / 变更 title。 */
  title: string;
  /** 副标题：会话「N 条记录」/ 变更「已归档」。 */
  sub: string;
}

/** 会话源标题兜底：title 缺失（无 user_input）时退到 id 前 8 位。 */
function sessionTitle(id: string, title: string | null): string {
  return title && title.trim() ? title : `会话 ${id.slice(0, 8)}`;
}

interface Props {
  workspaceId: string;
  onClose: () => void;
  /** 手工录入成功后的刷新回调（父级重拉列表，新候选出现在待审核区）。 */
  onProposed: () => void;
  /** 派发提炼任务成功后的回调（父级 invalidate 任务条查询，任务条立即出现）。 */
  onDistilled?: () => void;
}

export function PrecipitateDialog({ workspaceId, onClose, onProposed, onDistilled }: Props) {
  // task-08 落地后默认落在「从记录提炼」tab（原型 precipitateModal 同款；
  // task-05 阶段曾默认 manual，注释约定本任务翻转）。
  const [activeTab, setActiveTab] = useState("distill");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(DEFAULT_CATEGORY);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notify = useNotify();

  // ── 从记录提炼 tab 状态（task-08）────────────────────────────────────────
  const [sourceType, setSourceType] = useState<DistillSourceType>("session");
  const [sources, setSources] = useState<DistillSourceItem[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  /** 已选源（DistillSourceItem.ref），null = 未选（派发按钮禁用）。 */
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [focus, setFocus] = useState("");
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);

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
        : listChanges(workspaceId, {
            status: "archived",
            pageSize: SOURCE_LIST_LIMIT,
          }).then((resp) =>
            resp.items.map<DistillSourceItem>((c) => ({
              ref: c.change_key,
              title: c.title && c.title.trim() ? c.title : c.change_key,
              sub: "已归档变更",
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

  const canSubmit = title.trim().length > 0 && body.trim().length > 0 && !submitting;
  const canDispatch = selectedSource !== null && !dispatching;

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

  const handleDispatch = async () => {
    if (!canDispatch || selectedSource === null) return;
    setDispatching(true);
    setDispatchError(null);
    try {
      await dispatchDistill(workspaceId, {
        source_type: sourceType,
        source_ref: selectedSource,
        focus: focus.trim() ? focus.trim() : null,
      });
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
            {/* 来源类型（对照原型 .seg 分段切换） */}
            <div>
              <span className="text-xs font-medium text-muted-foreground">来源类型</span>
              <div
                role="radiogroup"
                aria-label="来源类型"
                className="mt-1 inline-flex rounded-md border border-input p-0.5"
              >
                {(
                  [
                    { value: "session", label: "会话记录" },
                    { value: "change", label: "变更归档" },
                  ] as const
                ).map((opt) => (
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
            </div>

            {/* 源列表单选（对照原型 .src-list/.src-item） */}
            <div>
              <span id="distill-source-list-label" className="text-xs font-medium text-muted-foreground">
                选择记录 <span className="text-destructive">*</span>
              </span>
              <div
                role="listbox"
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
                    {sourceType === "session" ? "当前工作区暂无可选会话记录。" : "暂无已归档变更可选。"}
                  </p>
                ) : (
                  sources.map((item) => {
                    const selected = selectedSource === item.ref;
                    return (
                      <button
                        key={item.ref}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        data-testid="distill-source-item"
                        onClick={() => setSelectedSource(item.ref)}
                        disabled={dispatching}
                        className={cn(
                          "flex w-full flex-col items-start gap-0.5 border-b border-border/60 px-3 py-2 text-left last:border-b-0",
                          selected ? "bg-brand-50" : "hover:bg-muted/50",
                        )}
                      >
                        <span className="flex w-full items-center gap-1.5">
                          <span aria-hidden className="shrink-0 text-[11px]">
                            {sourceType === "session" ? "💬" : "📦"}
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
                          {selected && <span aria-hidden className="shrink-0 text-xs text-brand-600">✓</span>}
                        </span>
                        <span className="pl-5 text-[11px] text-muted-foreground">{item.sub}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

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
                派发后由 agent 在后台读取记录并提炼，完成后候选知识出现在「待审核」区，会话无需保持在线。
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
              {dispatching ? "派发中…" : "派发提炼任务"}
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

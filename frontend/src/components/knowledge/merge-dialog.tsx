"use client";

/**
 * 「合并进正式知识库」弹层（task-06 / 2026-09-17-knowledge-precipitation /
 * FR-05 / D-007@v1）。
 *
 * 对照原型 mergeModal 三段布局：表单区（目标文件 + 小节标题 + 路由关键词）→
 * 追加段落预览 → INDEX 路由行预览。与原型的差异按卡片约束执行：目标文件仅
 * known-issues.md / patterns.md / conventions.md 三选一白名单（无「+ 新建文件」
 * 入口，D-007 边界；CLI categoryForTarget 之外无分类段落点）；小节标题与路由
 * 关键词均人工输入（关键词不做自动派生）。
 *
 * 预览零拼接：表单填齐后 debounce 调 preview-merge（dry-run），弹层直接渲染
 * 后端返回的 section_text / index_line——前端不自行拼接预览文本，防与 dry-run
 * 漂移（卡片 implementation）。section_skipped / index_line_skipped 为后端
 * dupRe 幂等守卫命中标志，命中时如实展示「已存在将跳过」提示。
 *
 * 确认合并单次调 merge（两段式时序由后端保证，前端不拆调用）；409 冲突
 * （R-01 契约：AppError details 含 conflict/server_versions）toast 固定文案
 * 「文件在别处被修改，请刷新后重试」且弹层保留已填表单可重试；其余错误走
 * inline 红条（useNotify 展示策略规范）。
 *
 * 弹层自身不做权限判断——可见性由 knowledge/page.tsx 按 KNOWLEDGE_WRITE
 * 持有者控制（task-05 同款口径）。
 */

import { useEffect, useRef, useState } from "react";
import { GitMerge } from "lucide-react";

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
import { ApiError } from "@/lib/api";
import { errMessage, useNotify } from "@/lib/errors";
import {
  mergeKnowledge,
  previewMergeKnowledge,
  type KnowledgeMergeIn,
  type MergePreviewOut,
} from "@/lib/knowledge";

/** 合并目标白名单（D-007@v1：三类 INDEX 映射文件，禁新建）。 */
const MERGE_TARGET_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "known-issues.md", label: "已知坑（known-issues.md）" },
  { value: "patterns.md", label: "模式（patterns.md）" },
  { value: "conventions.md", label: "约定（conventions.md）" },
];

/** 409 冲突固定文案（R-01 契约，卡片指定）。 */
const CONFLICT_TOAST = "文件在别处被修改，请刷新后重试";

/** 预览防抖间隔（ms）：表单停顿后再调 dry-run，避免逐键请求。 */
const PREVIEW_DEBOUNCE_MS = 300;

interface Props {
  workspaceId: string;
  /** 待审核条目 filename（knowledge/ 下相对路径，含 proposed/ 段）。 */
  filename: string;
  /** 条目标题（小节标题默认预填，可改）。 */
  defaultSectionTitle?: string | null;
  onClose: () => void;
  /** 合并成功后的刷新回调（父级清详情 + 重拉列表，候选从待审核区消失）。 */
  onMerged: () => void;
}

/** 关键词分隔符：中英文逗号 / 顿号（回车在 input onKeyDown 提交）。 */
const KEYWORD_SPLIT_RE = /[,，、]/;

export function MergeDialog({
  workspaceId,
  filename,
  defaultSectionTitle,
  onClose,
  onMerged,
}: Props) {
  const [targetFile, setTargetFile] = useState("");
  const [sectionTitle, setSectionTitle] = useState(defaultSectionTitle ?? "");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordDraft, setKeywordDraft] = useState("");
  const [preview, setPreview] = useState<MergePreviewOut | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notify = useNotify();

  const trimmedTitle = sectionTitle.trim();
  const keywordKey = JSON.stringify(keywords);
  const formComplete = targetFile !== "" && trimmedTitle !== "" && keywords.length > 0;

  // ── dry-run 预览：表单填齐后 debounce 调 preview-merge，序号守卫丢弃晚到的旧响应
  const previewSeqRef = useRef(0);
  useEffect(() => {
    const seq = ++previewSeqRef.current;
    if (!formComplete || submitting) {
      setPreview(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    const input: KnowledgeMergeIn = {
      target_file: targetFile,
      section_title: trimmedTitle,
      keywords,
    };
    const timer = setTimeout(() => {
      previewMergeKnowledge(workspaceId, filename, input)
        .then((out) => {
          if (seq !== previewSeqRef.current) return;
          setPreview(out);
        })
        .catch((err) => {
          if (seq !== previewSeqRef.current) return;
          setPreview(null);
          setPreviewError(errMessage(err, "生成合并预览失败，请重试"));
        })
        .finally(() => {
          if (seq !== previewSeqRef.current) return;
          setPreviewLoading(false);
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // keywordKey 为 keywords 的稳定串化（数组身份每渲染都变，不能直接进 deps）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formComplete, targetFile, trimmedTitle, keywordKey, submitting, workspaceId, filename]);

  // 确认门槛：表单填齐 + 预览已就绪无错（所见即所合并）+ 非提交中。
  const canConfirm =
    formComplete && !previewLoading && preview !== null && previewError === null && !submitting;

  /**
   * 关键词切分提交（空段丢弃 + 去重）并清空草稿；raw 缺省取当前草稿
   * （onChange 命中分隔符时传原始串，含末段未输完的部分）。
   */
  const commitKeywords = (raw?: string) => {
    const parts = (raw ?? keywordDraft)
      .split(KEYWORD_SPLIT_RE)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) {
      setKeywordDraft("");
      return;
    }
    setKeywords((prev) => [...prev, ...parts.filter((p) => !prev.includes(p))]);
    setKeywordDraft("");
  };

  const handleMerge = async () => {
    if (!canConfirm) return;
    setSubmitting(true);
    setError(null);
    try {
      await mergeKnowledge(workspaceId, filename, {
        target_file: targetFile,
        section_title: trimmedTitle,
        keywords,
      });
      notify.success(`已合并进 ${targetFile} 并更新 INDEX 路由`);
      onMerged();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // R-01 冲突契约：toast 固定文案，弹层不关、表单保留可重试。
        notify.error(CONFLICT_TOAST);
      } else {
        setError(errMessage(err, "合并失败，请重试"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
            <GitMerge className="h-5 w-5" />
          </div>
          <DialogTitle>合并进正式知识库</DialogTitle>
          <DialogDescription>
            复刻 sillyspec classify 语义：正文追加到目标文件的「## 小节」，并在
            INDEX.md 补路由行；确认后待审核候选随之移除。
          </DialogDescription>
        </DialogHeader>

        {/* ── 段一：表单区（目标文件白名单三选一 + 小节标题 + 路由关键词人工输入）── */}
        <div className="space-y-4">
          <div>
            <label
              htmlFor="merge-target"
              className="text-xs font-medium text-muted-foreground"
            >
              目标文件 <span className="text-destructive">*</span>
            </label>
            <select
              id="merge-target"
              aria-label="目标文件"
              value={targetFile}
              onChange={(e) => setTargetFile(e.target.value)}
              className="mt-1 h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none"
              disabled={submitting}
            >
              <option value="">选择目标文件…</option>
              {MERGE_TARGET_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="merge-section-title"
              className="text-xs font-medium text-muted-foreground"
            >
              小节标题 <span className="text-destructive">*</span>
            </label>
            <Input
              id="merge-section-title"
              value={sectionTitle}
              onChange={(e) => setSectionTitle(e.target.value)}
              placeholder="例如：Windows 控制台码页导致日志乱码"
              className="mt-1"
              maxLength={200}
              disabled={submitting}
            />
          </div>
          <div>
            <label
              htmlFor="merge-keyword-input"
              className="text-xs font-medium text-muted-foreground"
            >
              路由关键词 <span className="text-destructive">*</span>
            </label>
            <div
              data-testid="merge-keywords"
              className="mt-1 flex min-h-8 flex-wrap items-center gap-1 rounded border border-input bg-background px-1.5 py-1 focus-within:border-ring"
            >
              {keywords.map((kw) => (
                <span
                  key={kw}
                  className="inline-flex items-center gap-0.5 rounded bg-brand-100 px-1.5 py-0.5 text-[11px] font-medium text-brand-700"
                >
                  {kw}
                  <button
                    type="button"
                    aria-label={`移除关键词 ${kw}`}
                    className="rounded-sm px-0.5 text-brand-700/70 hover:bg-brand-200 hover:text-brand-800"
                    onClick={() => setKeywords((prev) => prev.filter((k) => k !== kw))}
                    disabled={submitting}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                id="merge-keyword-input"
                aria-label="路由关键词"
                value={keywordDraft}
                onChange={(e) => {
                  const v = e.target.value;
                  if (KEYWORD_SPLIT_RE.test(v)) commitKeywords(v);
                  else setKeywordDraft(v);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitKeywords();
                  } else if (e.key === "Backspace" && keywordDraft === "" && keywords.length > 0) {
                    setKeywords((prev) => prev.slice(0, -1));
                  }
                }}
                placeholder={keywords.length === 0 ? "输入关键词后回车，可多个（用于 INDEX 路由检索）" : ""}
                className="h-6 min-w-[120px] flex-1 bg-transparent text-sm outline-none"
                disabled={submitting}
              />
            </div>
            <p className="mt-1 text-[10.5px] text-muted-foreground">
              关键词由人工填写（逗号或回车分隔），用于生成 INDEX.md 路由行
              「- 关键词|关键词 → [标题](文件#锚点)」。
            </p>
          </div>
        </div>

        {/* ── 段二/三：追加段落预览 + INDEX 路由行预览（后端 dry-run 返回，零拼接）── */}
        {formComplete && (
          <div data-testid="merge-preview" className="space-y-1.5">
            {previewLoading ? (
              <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                正在生成合并预览…
              </p>
            ) : previewError ? (
              <div className="rounded-lg border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
                {previewError}
              </div>
            ) : preview ? (
              <>
                <p className="text-[11px] text-muted-foreground">
                  将追加到 {targetFile} 末尾：
                </p>
                {preview.section_skipped ? (
                  <div
                    data-testid="section-skipped-note"
                    className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning"
                  >
                    目标文件已存在同名「## {trimmedTitle}」小节，本次合并将跳过追加（幂等守卫）。
                  </div>
                ) : (
                  <pre
                    data-testid="section-preview"
                    className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border border-success/30 bg-success/10 p-3 font-mono text-[11px] leading-5"
                  >
                    {preview.section_text}
                  </pre>
                )}
                <p className="pt-1 text-[11px] text-muted-foreground">
                  并在 INDEX.md 补路由行：
                </p>
                <pre
                  data-testid="index-preview"
                  className={`overflow-auto whitespace-pre-wrap break-words rounded-md border p-3 font-mono text-[11px] leading-5 ${
                    preview.index_line_skipped
                      ? "border-warning/30 bg-muted/40 opacity-70"
                      : "border-success/30 bg-success/10"
                  }`}
                >
                  {preview.index_line}
                </pre>
                {preview.index_line_skipped && (
                  <div
                    data-testid="index-skipped-note"
                    className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning"
                  >
                    INDEX.md 已含相同路由行，本次合并将跳过补行（幂等守卫）。
                  </div>
                )}
              </>
            ) : null}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button
            data-testid="confirm-merge"
            onClick={() => void handleMerge()}
            disabled={!canConfirm}
          >
            {submitting ? "合并中…" : "确认合并"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

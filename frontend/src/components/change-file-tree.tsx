"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Image } from "antd";
import { ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ErrorBanner } from "@/components/ui/error-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
// MD 预览走统一 MarkdownText（ql-20260824-016）：裸 MarkdownPreview 无 .markdown-text
// 包装，暗色下库默认白底漏出且表格覆盖规则不命中；reading 尺寸适合文件预览，
// sanitize 管线组件内自带（task-13 / FR-13 口径不变）
import { MarkdownText } from "@/components/ui/markdown-text";
import { FileNodeIcon, fileExt } from "@/components/ui/file-node-icon";
// 统一预览弹窗 + objectURL hook（2026-08-26-file-fullscreen-preview task-02/04
// 交付物，仅按契约消费，不改本体）
import { FilePreviewModal, type FilePreviewTarget } from "@/components/files/file-preview-modal";
import { useObjectUrl } from "@/components/files/use-object-url";
import { ApiError } from "@/lib/api";
import { formatFileSize } from "@/lib/file/utils";
import {
  buildChangeFileTree,
  fetchChangeFileRaw,
  getChangeFileContent,
  listChangeFiles,
  listPendingChangeFiles,
  saveChangeFileContent,
  type ChangeFileEntry,
  type ChangeFileTreeNode,
  type PendingFileEntry,
} from "@/lib/change-files";

interface Props {
  workspaceId: string;
  changeId: string;
  lastSyncedAt?: string | null;
  daemonOnline?: boolean;
}

type SaveStatus = "idle" | "saving" | "done" | "pending" | "failed";

// ql-20260821-016：内联 SVG 换 lucide 图标（原 FolderIcon amber-500 硬编码
// 不随主题，且内联 SVG 不走图标库规范）。import 见文件头。
function FolderIcon({ open }: { open?: boolean }) {
  return open ? (
    <FolderOpen className="h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden />
  ) : (
    <Folder className="h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden />
  );
}

function FileIcon() {
  return <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />;
}

// 是否可渲染预览的 HTML 文件（后端 _TEXT_SUFFIXES 已含 .html/.htm，此处对齐大小写无关）
function isPreviewableHtml(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".html") || lower.endsWith(".htm");
}

// 内容区「预览」模式渲染：按文件类型分别渲染（.md→Markdown / .html→iframe / 其他纯文本→只读源码）。
// ql-20260818-008：三个分支统一 min-w-0（防宽内容把 flex 链撑破，超宽出横向滚动条），
// 源码预览改 whitespace-pre 不软折行——长行靠横向滚动看全，预览区宽度固定。
function FilePreview({ path, name, content }: { path: string; name: string; content: string }) {
  if (path.endsWith(".md")) {
    return (
      // reading 尺寸自带 p-2/text-sm/leading-7，容器仅留 muted 底与圆角滚动
      <div className="min-w-0 flex-1 overflow-auto rounded-md bg-muted/40">
        <MarkdownText content={content} size="reading" />
      </div>
    );
  }
  if (isPreviewableHtml(path)) {
    return (
      <div className="min-w-0 flex-1 overflow-hidden rounded-md border border-border bg-card">
        <iframe
          title={`${name} 渲染预览`}
          srcDoc={content}
          // sandbox 不设 allow-same-origin：iframe 被当作唯一源，
          // 脚本可跑（交互原型可见）但无法访问父页面 cookie/storage/DOM，安全隔离。
          sandbox="allow-scripts allow-popups"
          className="h-full min-h-[60vh] w-full border-0 bg-card"
        />
      </div>
    );
  }
  // 其他纯文本：只读源码预览（点「编辑」才可改）。whitespace-pre：不折行，超宽横向滚动
  return (
    <pre className="min-w-0 flex-1 overflow-auto rounded-md border border-input bg-background p-3 font-mono text-xs leading-relaxed whitespace-pre">
      {content || "（空文件）"}
    </pre>
  );
}

// ── 非文本选中态（2026-08-26-file-fullscreen-preview / FR-03a）──────────
// 内联图片扩展名集合（小写比较，fileExt 统一取小写扩展名）：与 preview-registry
// IMAGE_MIMES 口径对齐（svg/bmp/ico 含内，Grill C-05）。命中走内联 antd Image，
// 其余非文本走文件卡片。
const INLINE_IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp", "ico"]);

function isInlineImage(name: string): boolean {
  return INLINE_IMAGE_EXTS.has(fileExt(name));
}

/**
 * 非文本选中态视图（替代旧「非文本文件，暂不支持预览/编辑」占位）：
 * - 图片扩展名 → fetchChangeFileRaw 拉 raw blob 经 useObjectUrl 构造鉴权
 *   objectURL，内联 antd Image（点击内建 lightbox 放大/缩小/旋转，FR-02）；
 *   失败态给提示 + 重试 + 「全屏预览」引导（design §9：未部署新后端时 raw 404）。
 * - 其余非文本 → 文件卡片（类型图标 + 名称 + 大小 + 「全屏预览」引导按钮）。
 *
 * 取数恒走 raw 端点（D-009：预览不走 content 端点）；useObjectUrl 托管
 * 卸载/切换 revoke 与竞态防护。min-w-0/min-h-0 对齐 ql-20260818-008 限高链。
 */
function NonTextFileView({
  workspaceId,
  changeId,
  doc,
  onOpenFullscreen,
}: {
  workspaceId: string;
  changeId: string;
  doc: ChangeFileEntry;
  onOpenFullscreen: () => void;
}) {
  const isImage = isInlineImage(doc.name);
  // fetcher 依赖仅 path 原语：父组件无关重渲染（pending 轮询 setPending 等）不触发重复拉取
  const fetcher = useMemo(
    () => (isImage ? () => fetchChangeFileRaw(workspaceId, changeId, doc.path) : null),
    [isImage, workspaceId, changeId, doc.path],
  );
  const { url, status, retry } = useObjectUrl(fetcher);

  if (!isImage) {
    // 其他非文本：文件卡片 + 全屏预览引导（全屏弹窗内 docx/xlsx/pdf 本地渲染器可用）
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-md border border-dashed border-border bg-muted/30 p-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <FileNodeIcon name={doc.name} type="file" size="h-10 w-10" />
          <div>
            <p className="text-sm font-medium text-foreground">{doc.name}</p>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              {formatFileSize(doc.size)} · 非文本文件
            </p>
          </div>
          <Button size="sm" onClick={onOpenFullscreen}>
            全屏预览
          </Button>
        </div>
      </div>
    );
  }

  let body: ReactNode;
  if (status === "error") {
    body = (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-8 text-center">
        <p className="text-xs text-muted-foreground">图片加载失败（文件可能尚未同步到平台镜像）</p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={retry}>
            重试
          </Button>
          <Button size="sm" onClick={onOpenFullscreen}>
            全屏预览
          </Button>
        </div>
      </div>
    );
  } else if (!url) {
    // idle/loading 均视为加载中（fetcher 非 null，effect 随即进入 loading）
    body = <p className="py-8 text-center text-xs text-muted-foreground">图片加载中…</p>;
  } else {
    body = (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-auto rounded-md border border-border bg-background p-3">
        {/* antd Image：点击内建 lightbox 放大/缩小/旋转（FR-02），objectURL 由 useObjectUrl 托管 revoke */}
        <Image src={url} alt={doc.name} className="max-h-[60vh] max-w-full rounded-md object-contain" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{doc.path}</span>
        <Button size="sm" variant="outline" onClick={onOpenFullscreen}>
          全屏预览
        </Button>
      </div>
      {body}
    </div>
  );
}

function TreeView({
  nodes,
  pendingPaths,
  onSelect,
  selectedPath,
  depth = 0,
}: {
  nodes: ChangeFileTreeNode[];
  pendingPaths: Set<string>;
  onSelect: (doc: ChangeFileEntry) => void;
  selectedPath: string | null;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const dirs = new Set<string>();
    const collect = (ns: ChangeFileTreeNode[]) => {
      for (const n of ns) {
        if (n.children.length > 0) {
          dirs.add(n.path);
          collect(n.children);
        }
      }
    };
    collect(nodes);
    return dirs;
  });
  const toggle = (p: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  return (
    <div className="text-sm">
      {nodes.map((node) => {
        const isDir = node.children.length > 0;
        const isOpen = expanded.has(node.path);
        if (isDir) {
          return (
            <div key={node.path}>
              <button
                className="group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-brand-50"
                style={{ paddingLeft: `${depth * 16 + 8}px` }}
                onClick={() => toggle(node.path)}
              >
                <ChevronRight
                  className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
                  aria-hidden
                />
                <FolderIcon open={isOpen} />
                <span className="truncate font-medium text-foreground">{node.name}</span>
              </button>
              {isOpen && (
                <TreeView
                  nodes={node.children}
                  pendingPaths={pendingPaths}
                  onSelect={onSelect}
                  selectedPath={selectedPath}
                  depth={depth + 1}
                />
              )}
            </div>
          );
        }
        const doc = node.doc;
        if (!doc) return null;
        const isPending = pendingPaths.has(doc.path);
        const isSelected = selectedPath === doc.path;
        return (
          <button
            key={doc.path}
            className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors ${
              isSelected
                ? "bg-brand-50 font-medium text-brand-700"
                : "text-foreground hover:bg-brand-50"
            }`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            onClick={() => onSelect(doc)}
          >
            <FileIcon />
            <span className="truncate">{doc.name}</span>
            <span className="ml-auto flex items-center gap-1">
              {isPending && (
                <Badge variant="warning" className="text-[10px] px-1.5">
                  排队中
                </Badge>
              )}
              {!doc.is_text && (
                <Badge variant="outline" className="text-[10px] px-1.5">
                  只读
                </Badge>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function ChangeFileTree({ workspaceId, changeId, lastSyncedAt, daemonOnline = true }: Props) {
  const [tree, setTree] = useState<ChangeFileTreeNode[]>([]);
  const [selected, setSelected] = useState<ChangeFileEntry | null>(null);
  const [content, setContent] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  // 内容区模式：默认预览，点「编辑」才进入文本编辑（交互反转）
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [loading, setLoading] = useState(true);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [pending, setPending] = useState<PendingFileEntry[]>([]);
  // 统一预览弹窗态（2026-08-26-file-fullscreen-preview / FR-03b）：target 常驻
  // state、关闭仅收 open，避免弹窗内容闪重建；以 defaultFullscreen 打开即全屏。
  const [previewTarget, setPreviewTarget] = useState<FilePreviewTarget | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pendingPaths = new Set(pending.map((p) => p.path));

  const refreshTree = useCallback(async () => {
    try {
      const resp = await listChangeFiles(workspaceId, changeId);
      setTree(buildChangeFileTree(resp.items));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载文件树失败");
    }
  }, [workspaceId, changeId]);

  const refreshPending = useCallback(async () => {
    try {
      const resp = await listPendingChangeFiles(workspaceId, changeId);
      setPending(resp.items);
    } catch {
      /* silent */
    }
  }, [workspaceId, changeId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await Promise.all([refreshTree(), refreshPending()]);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTree, refreshPending]);

  // 保存后 pending 轮询：daemon-client 返 pending 时 2s 轮询直到该 path 消失或翻 failed
  useEffect(() => {
    if (saveStatus !== "pending") return;
    const stop = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    pollRef.current = setInterval(async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      await refreshPending();
      setPending((cur) => {
        if (!selected) return cur;
        const stillPending = cur.some((p) => p.path === selected.path);
        if (!stillPending) {
          setSaveStatus("done");
          stop();
        }
        return cur;
      });
    }, 2000);
    // 上限 5min 后停止（R-06）
    const deadline = setTimeout(() => {
      setSaveStatus((s) => (s === "pending" ? "done" : s));
      stop();
    }, 5 * 60 * 1000);
    return () => {
      stop();
      clearTimeout(deadline);
    };
  }, [saveStatus, selected, refreshPending]);

  const handleSelect = async (doc: ChangeFileEntry) => {
    setSelected(doc);
    setDirty(false);
    setSaveStatus("idle");
    setMode("preview");
    if (!doc.is_text) {
      setContent("");
      return;
    }
    setLoadingDoc(true);
    setError(null);
    try {
      const resp = await getChangeFileContent(workspaceId, changeId, doc.path);
      setContent(resp.content ?? "");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "读取文件失败");
      setContent("");
    } finally {
      setLoadingDoc(false);
    }
  };

  const handleSave = async () => {
    if (!selected || !dirty) return;
    setSaveStatus("saving");
    setError(null);
    try {
      const resp = await saveChangeFileContent(workspaceId, changeId, selected.path, content);
      setDirty(false);
      if (resp.status === "pending") {
        setSaveStatus("pending");
        // 立即刷一次 pending 让徽标出现
        void refreshPending();
      } else {
        setSaveStatus("done");
        void refreshTree();
      }
    } catch (err) {
      setSaveStatus("failed");
      setError(err instanceof ApiError ? err.message : "保存失败");
    }
  };

  // 打开统一预览弹窗（2026-08-26-file-fullscreen-preview / FR-03b）。
  // D-009：预览取数恒走 raw 端点——文本同样不走 content 端点（规避其 1MB 截断
  // 导致大文件全屏静默截断），blob.type/扩展名统一经 matchRenderer 分发；
  // meta.mime 留 null 靠后端 Content-Type 兜底。下载用 raw blob + a[download] 即抛即 revoke。
  const openFullscreenPreview = useCallback(
    (doc: ChangeFileEntry) => {
      setPreviewTarget({
        fetch: () => fetchChangeFileRaw(workspaceId, changeId, doc.path),
        meta: { name: doc.name, mime: null, size: doc.size },
        download: async () => {
          const blob = await fetchChangeFileRaw(workspaceId, changeId, doc.path);
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = doc.name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        },
      });
      setPreviewOpen(true);
    },
    [workspaceId, changeId],
  );

  const statusLabel: Record<SaveStatus, { text: string; color: string }> = {
    idle: { text: "", color: "" },
    saving: { text: "保存中…", color: "text-primary" },
    done: { text: "已保存", color: "text-emerald-600" },
    pending: { text: "排队中（daemon 回写中）", color: "text-amber-600" },
    failed: { text: "保存失败", color: "text-destructive" },
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-md border bg-card">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h2 className="text-xs font-medium">变更文件</h2>
        <div className="flex items-center gap-3">
          {lastSyncedAt && (
            <span className="text-[11px] text-muted-foreground">
              镜像同步：{new Date(lastSyncedAt).toLocaleString("zh-CN")}
            </span>
          )}
          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => void refreshTree()}>
            刷新
          </Button>
        </div>
      </div>

      {daemonOnline === false && (
        <div className="mx-3 mt-2 rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700">
          ⚠️ daemon 离线，保存将排队待重连回写本机
        </div>
      )}

      {error && (
        <div className="m-3">
          <ErrorBanner message={error} onRetry={() => void refreshTree()} />
        </div>
      )}

      {/* ql-20260818-008：min-h-0+flex-1 限高链——Dialog 场景下 grid 填满剩余高度，
          行高 minmax(0,1fr) 防内容撑开，文件树/预览区各自滚动；非限高场景自然堆叠。 */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden p-3 lg:grid-cols-[280px_1fr] lg:grid-rows-[minmax(0,1fr)]">
        <div className="max-h-[60vh] overflow-auto rounded-md border bg-background p-1 lg:max-h-full">
          {loading ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">加载中…</p>
          ) : tree.length === 0 ? (
            // ql-20260816-005：新建 change 进度走 CLI 直推（立即可见）而文件镜像走
            // daemon 同步（滞后），空树期间用户误以为文件丢失——补行动指引。
            <EmptyState
              icon={<Folder className="h-6 w-6" />}
              title="暂无文件"
              description="若刚创建变更，文件可能尚未同步到平台镜像：可到工作区页的配置卡点「同步到服务器」，完成后刷新查看"
            />
          ) : (
            <TreeView
              nodes={tree}
              pendingPaths={pendingPaths}
              onSelect={(d) => void handleSelect(d)}
              selectedPath={selected?.path ?? null}
            />
          )}
        </div>

        <div className="flex min-h-[40vh] flex-col">
          {!selected ? (
            <p className="py-8 text-center text-xs text-muted-foreground">点击左侧文件查看内容</p>
          ) : !selected.is_text ? (
            // 2026-08-26-file-fullscreen-preview / FR-03a：非文本不再是一行
            // 「暂不支持」占位——图片内联 antd Image 可缩放、其余文件卡片带全屏入口
            <NonTextFileView
              workspaceId={workspaceId}
              changeId={changeId}
              doc={selected}
              onOpenFullscreen={() => openFullscreenPreview(selected)}
            />
          ) : loadingDoc ? (
            <p className="py-8 text-center text-xs text-muted-foreground">加载中…</p>
          ) : (
            <div className="flex h-full flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{selected.path}</span>
                <div className="flex items-center gap-2">
                  {saveStatus !== "idle" && (
                    <span className={`text-[11px] ${statusLabel[saveStatus].color}`}>
                      {statusLabel[saveStatus].text}
                    </span>
                  )}
                  {/* 全屏预览（2026-08-26-file-fullscreen-preview / FR-03b）：以
                      defaultFullscreen 打开统一弹窗，文本/图片/HTML 原型均可全屏；
                      置于模式按钮组（预览/编辑）之前 */}
                  <Button size="sm" variant="outline" onClick={() => openFullscreenPreview(selected)}>
                    全屏预览
                  </Button>
                  {mode === "preview" ? (
                    <Button size="sm" onClick={() => setMode("edit")}>
                      编辑
                    </Button>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setMode("preview")}>
                        预览
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setContent(content);
                          setDirty(false);
                          setSaveStatus("idle");
                        }}
                        disabled={!dirty}
                      >
                        放弃修改
                      </Button>
                      <Button size="sm" onClick={() => void handleSave()} disabled={!dirty || saveStatus === "saving"}>
                        {saveStatus === "saving" ? "保存中…" : "保存"}
                      </Button>
                    </>
                  )}
                </div>
              </div>
              {mode === "preview" ? (
                <FilePreview path={selected.path} name={selected.name} content={content} />
              ) : (
                <textarea
                  className="min-h-[300px] flex-1 rounded-md border border-input bg-background p-2 font-mono text-xs leading-relaxed focus:border-ring focus:outline-none"
                  value={content}
                  onChange={(e) => {
                    setContent(e.target.value);
                    setDirty(true);
                    setSaveStatus("idle");
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* 统一预览弹窗（2026-08-26-file-fullscreen-preview / FR-03b）：打开即全屏，
          取数/下载恒走 raw 端点（D-009），见 openFullscreenPreview */}
      <FilePreviewModal
        target={previewTarget}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        defaultFullscreen
      />
    </section>
  );
}

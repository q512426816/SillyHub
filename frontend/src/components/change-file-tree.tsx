"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import { ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ErrorBanner } from "@/components/ui/error-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
// 复用统一 sanitize 插件（task-13 / FR-13）：文件预览内容不可信，渲染管线必须过滤
import { markdownRehypePlugins } from "@/components/ui/markdown-text";
import { ApiError } from "@/lib/api";
import {
  buildChangeFileTree,
  getChangeFileContent,
  listChangeFiles,
  listPendingChangeFiles,
  saveChangeFileContent,
  type ChangeFileEntry,
  type ChangeFileTreeNode,
  type PendingFileEntry,
} from "@/lib/change-files";

// Markdown 预览按需加载（jsdom 测试 vi.mock 降级，见 CONVENTIONS）
const MarkdownPreview = dynamic(() => import("@uiw/react-markdown-preview"), { ssr: false });

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
      <div className="min-w-0 flex-1 overflow-auto rounded-md bg-muted/40 p-3 text-sm">
        <MarkdownPreview source={content} rehypePlugins={markdownRehypePlugins} />
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
            <div className="py-8 text-center text-xs text-muted-foreground">
              <p>{selected.name}（非文本文件，暂不支持预览/编辑）</p>
            </div>
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
    </section>
  );
}

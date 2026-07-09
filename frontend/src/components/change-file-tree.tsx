"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

function FolderIcon({ open }: { open?: boolean }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-amber-500"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="M12 10h6"/></svg>
  );
}

function FileIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>;
}

// 是否可渲染预览的 HTML 文件（后端 _TEXT_SUFFIXES 已含 .html/.htm，此处对齐大小写无关）
function isPreviewableHtml(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".html") || lower.endsWith(".htm");
}

// 内容区「预览」模式渲染：按文件类型分别渲染（.md→Markdown / .html→iframe / 其他纯文本→只读源码）
function FilePreview({ path, name, content }: { path: string; name: string; content: string }) {
  if (path.endsWith(".md")) {
    return (
      <div className="flex-1 overflow-auto rounded-md bg-muted/40 p-3 text-sm">
        <MarkdownPreview source={content} />
      </div>
    );
  }
  if (isPreviewableHtml(path)) {
    return (
      <div className="flex-1 overflow-hidden rounded-md border border-border bg-white">
        <iframe
          title={`${name} 渲染预览`}
          srcDoc={content}
          // sandbox 不设 allow-same-origin：iframe 被当作唯一源，
          // 脚本可跑（交互原型可见）但无法访问父页面 cookie/storage/DOM，安全隔离。
          sandbox="allow-scripts allow-popups"
          className="h-[60vh] w-full border-0 bg-white"
        />
      </div>
    );
  }
  // 其他纯文本：只读源码预览（点「编辑」才可改）
  return (
    <pre className="flex-1 overflow-auto rounded-md border border-input bg-background p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
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
                className="flex w-full items-center gap-1.5 rounded px-2 py-1 hover:bg-muted/50"
                style={{ paddingLeft: `${depth * 16 + 8}px` }}
                onClick={() => toggle(node.path)}
              >
                <FolderIcon open={isOpen} />
                <span className="truncate font-medium">{node.name}</span>
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
            className={`flex w-full items-center gap-1.5 rounded px-2 py-1 hover:bg-muted/50 ${
              isSelected ? "bg-muted/70" : ""
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
    <section className="rounded-md border bg-card">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h2 className="text-xs font-medium">变更文件</h2>
        <div className="flex items-center gap-3">
          {lastSyncedAt && (
            <span className="text-[11px] text-muted-foreground">
              镜像同步：{new Date(lastSyncedAt).toLocaleString()}
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
        <div className="m-3 rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 p-3 lg:grid-cols-[280px_1fr]">
        <div className="max-h-[60vh] overflow-auto rounded-md border bg-background p-1">
          {loading ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">加载中…</p>
          ) : tree.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">暂无文件</p>
          ) : (
            <TreeView
              nodes={tree}
              pendingPaths={pendingPaths}
              onSelect={(d) => void handleSelect(d)}
              selectedPath={selected?.path ?? null}
            />
          )}
        </div>

        <div className="min-h-[40vh]">
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
                <span className="font-mono text-[11px] text-muted-foreground">{selected.path}</span>
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

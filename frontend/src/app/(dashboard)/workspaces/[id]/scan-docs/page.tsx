"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tree, type TreeProps } from "antd";
import type { DataNode } from "antd/es/tree";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileNodeIcon } from "@/components/ui/file-node-icon";
import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
import { PanelResizer, usePanelWidth } from "@/components/ui/panel-resizer";
import { TreeBox } from "@/components/ui/tree-box";
// 复用统一 sanitize 插件（task-13 / FR-13）：扫描文档内容源自 daemon 上报的仓库文件，不可信
import { markdownRehypePlugins } from "@/components/ui/markdown-text";
import { ApiError } from "@/lib/api";
import "@uiw/react-markdown-preview/markdown.css";

const MarkdownPreview = dynamic(() => import("@uiw/react-markdown-preview"), { ssr: false });
import {
  listScanDocs,
  reparseScanDocs,
  getScanDoc,
  type ScanDocSummary,
  type ScanDocReparseResponse,
  type ScanDocRead,
} from "@/lib/scan-docs";
import { buildTree, type TreeNode } from "@/lib/scan-docs-tree";
import { DaemonRequiredNotice } from "@/components/daemon-required-notice";
import {
  canBorrowSharedDaemon,
  fetchMyBinding,
  type MemberBindingView,
} from "@/lib/workspace-binding";
import { useSession } from "@/stores/session";

interface Props { params: { id: string }; }

// ── 文档树（antd Tree，与 explorer 文件树同风格，ql-20260821-013-2c1a）────────
// 单行展示/横向滚动/16px 缩进由 TreeBox 统一；图标按扩展名分型由 FileNodeIcon 统一；
// 栏宽可拖拽（PanelResizer）。

/** 左栏（文档树）宽度：默认值与拖拽范围（px）。 */
const TREE_PANEL_DEFAULT_W = 280;
const TREE_PANEL_MIN_W = 200;
const TREE_PANEL_MAX_W = 480;
/** 宽度记忆 key（仅本地浏览器）。 */
const TREE_PANEL_WIDTH_KEY = "sillyhub-scan-docs-tree-width";

/** 收集全部目录 path（初始全展开语义，沿用手搓版行为）。 */
function collectDirPaths(nodes: TreeNode[], acc: string[] = []): string[] {
  for (const n of nodes) {
    if (n.doc === undefined) {
      acc.push(n.path);
      collectDirPaths(n.children, acc);
    }
  }
  return acc;
}

/** 递归构建 path → 文档摘要索引（选中行回查 doc id 拉详情）。 */
function buildDocIndex(nodes: TreeNode[], acc = new Map<string, ScanDocSummary>()): Map<string, ScanDocSummary> {
  for (const n of nodes) {
    if (n.doc) acc.set(n.path, n.doc);
    buildDocIndex(n.children, acc);
  }
  return acc;
}

/** 文件行标题：名称 + 徽标（来源成员/历史版本数/文档类型），整行单行不换行。 */
function renderDocTitle(node: TreeNode & { doc: ScanDocSummary }) {
  const doc = node.doc;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
      <span title={doc.title ?? node.name}>{doc.title ?? node.name}</span>
      <span className="flex shrink-0 items-center gap-1">
        {doc.source_member_id && (
          <Badge variant="info" className="px-1.5 text-[10px]">
            👤 {doc.source_member_id.slice(0, 8)}
          </Badge>
        )}
        {doc.conflict_count > 0 && (
          <Badge
            variant="outline"
            className="px-1.5 text-[10px]"
            title={`此文档有 ${doc.conflict_count} 个被覆盖的旧版本存档（同步时后写的版本生效，旧版留存备查），无需处理`}
          >
            🕘 历史{doc.conflict_count}版
          </Badge>
        )}
        <Badge variant={doc.exists ? "success" : "outline"} className="px-1.5 text-[10px]">{doc.doc_type}</Badge>
      </span>
    </span>
  );
}

/** TreeNode[] → antd DataNode[]（目录 font-medium；文件行带徽标；图标按扩展名分型）。 */
function toAntdNodes(nodes: TreeNode[]): DataNode[] {
  return nodes.map((n) => {
    if (n.doc) {
      return {
        key: n.path,
        title: renderDocTitle(n as TreeNode & { doc: ScanDocSummary }),
        isLeaf: true,
        icon: <FileNodeIcon name={n.name} type="file" />,
      };
    }
    return {
      key: n.path,
      title: <span className="font-medium whitespace-nowrap">{n.name}</span>,
      icon: <FileNodeIcon name={n.name} type="dir" />,
      children: toAntdNodes(n.children),
    };
  });
}

/** 文档树：antd Tree 受控（全展开初始 + 可收起；点目录行展开/收起 ql-20260821-015；点文件行拉详情回调）。 */
function DocTree({
  tree,
  workspaceId,
  onSelect,
  selectedPath,
}: {
  tree: TreeNode[];
  workspaceId: string;
  onSelect: (_doc: ScanDocRead) => void;
  selectedPath: string | null;
}) {
  const treeData = useMemo(() => toAntdNodes(tree), [tree]);
  const docIndex = useMemo(() => buildDocIndex(tree), [tree]);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>(() => collectDirPaths(tree));
  // 树重建（搜索过滤/重扫后）重算展开集，保持「全部展开」语义（手搓版同款初始行为）。
  useEffect(() => {
    setExpandedKeys(collectDirPaths(tree));
  }, [tree]);

  const onSelectTree: TreeProps["onSelect"] = (keys, info) => {
    if (!info.node.isLeaf) return;
    const doc = docIndex.get(String(info.node.key));
    if (!doc) return;
    void getScanDoc(workspaceId, doc.id).then(onSelect).catch(() => {});
  };

  return (
    <Tree
      treeData={treeData}
      expandAction="click"
      expandedKeys={expandedKeys}
      onExpand={(keys) => setExpandedKeys([...keys])}
      selectedKeys={selectedPath ? [selectedPath] : []}
      onSelect={onSelectTree}
      showIcon
      blockNode
    />
  );
}

export default function ScanDocsPage({ params }: Props) {
  const workspaceId = params.id;
  const [docs, setDocs] = useState<ScanDocSummary[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<ScanDocRead | null>(null);
  const [reparseResult, setReparseResult] = useState<ScanDocReparseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [reparsing, setReparsing] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  // 2026-07-26-ungate-workspace-entry / FR-04：扫描文档 reparse 经 host_fs 读源码
  // （daemon-client），无 binding 时失败。门禁后移后，无 binding 主区渲染 DaemonRequiredNotice。
  const [myBinding, setMyBinding] = useState<MemberBindingView | null>(null);
  const [bindingReady, setBindingReady] = useState(false);
  /** 左栏（文档树）宽度：默认 280px，拖拽/键盘调整 200~480px，记忆到 localStorage。 */
  const [treeWidth, setTreeWidth] = usePanelWidth({
    storageKey: TREE_PANEL_WIDTH_KEY,
    defaultWidth: TREE_PANEL_DEFAULT_W,
    minWidth: TREE_PANEL_MIN_W,
    maxWidth: TREE_PANEL_MAX_W,
  });
  const permissions = useSession((s) => s.user?.permissions);
  const isPlatformAdmin = useSession((s) => s.user?.is_platform_admin === true);
  const canBorrow = canBorrowSharedDaemon(permissions, isPlatformAdmin);

  // 仅拉文档列表（可选关键词过滤 path/title/content）。搜索时不触发 reparse，保证响应快。
  const fetchDocs = useCallback(async (q?: string) => {
    setLoading(true); setPageError(null);
    try {
      const resp = await listScanDocs(workspaceId, q ? { q } : undefined);
      setDocs(resp.items);
    } catch (err) { setPageError(err instanceof ApiError ? err.message : "加载扫描文档失败"); }
    finally { setLoading(false); }
  }, [workspaceId]);

  // 首次进入：reparse 同步平台存储 + 拉全量。
  const reparseAndLoad = useCallback(async () => {
    setLoading(true); setPageError(null);
    try {
      await reparseScanDocs(workspaceId);
      await fetchDocs();
    } catch (err) { setPageError(err instanceof ApiError ? err.message : "加载扫描文档失败"); }
    finally { setLoading(false); }
  }, [workspaceId, fetchDocs]);

  // 先判 binding：无 binding 不 reparse（避免无谓失败），主区渲染 DaemonRequiredNotice。
  useEffect(() => {
    let active = true;
    setBindingReady(false);
    fetchMyBinding(workspaceId)
      .then((b) => {
        if (active) {
          setMyBinding(b);
          setBindingReady(true);
        }
      })
      .catch(() => {
        if (active) {
          setMyBinding(null);
          setBindingReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  const hasDaemon = !!myBinding?.daemon_id;

  // 仅在已绑定 daemon 时 reparse + 拉文档（零回归：有 binding 路径不变）。
  useEffect(() => {
    if (!hasDaemon) return;
    void reparseAndLoad();
  }, [hasDaemon, reparseAndLoad]);

  // 搜索框输入 debounce 300ms → debouncedQ。
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // debouncedQ 变化触发过滤查询；跳过首次（首次由 reparseAndLoad 负责，避免重复请求）。
  const skipFirstSearchRef = useRef(true);
  useEffect(() => {
    if (skipFirstSearchRef.current) { skipFirstSearchRef.current = false; return; }
    void fetchDocs(debouncedQ || undefined);
  }, [debouncedQ, fetchDocs]);

  const handleReparse = async () => {
    setReparsing(true); setPageError(null); setSelectedDoc(null);
    try { const resp = await reparseScanDocs(workspaceId); setReparseResult(resp); await fetchDocs(debouncedQ || undefined); }
    catch (err) { setPageError(err instanceof ApiError ? err.message : "重新解析失败"); }
    finally { setReparsing(false); }
  };

  const tree = buildTree(docs);

  return (
    <PageContainer size="full">
      <PageHeader
        title={
          <span>
            <Link
              href={"/workspaces/" + workspaceId}
              className="text-[11px] font-normal text-muted-foreground hover:underline"
            >
              ← 工作空间
            </Link>
            <span className="mt-0.5 block">扫描文档</span>
          </span>
        }
        actions={
          <Button size="sm" onClick={handleReparse} disabled={reparsing}>
            {reparsing ? "解析中…" : "重新扫描"}
          </Button>
        }
      />

      {pageError && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">{pageError}</div>
      )}

      {reparseResult && (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          扫描完成：解析 {reparseResult.stats.parsed} 个文档，新增 {reparseResult.stats.created} · 更新 {reparseResult.stats.updated} · 删除{" "}{reparseResult.stats.deleted}。
          {reparseResult.warnings && reparseResult.warnings.length > 0 &&
            " " + reparseResult.warnings.length + " 个警告。"}
        </div>
      )}

      {reparseResult && reparseResult.warnings && reparseResult.warnings.length > 0 && (
        <SectionCard title="扫描警告">
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-amber-600">
            {reparseResult.warnings.map((w, i) => (<li key={i}><span className="font-mono">[{w.code}]</span>{" "}{w.detail}</li>))}
          </ul>
        </SectionCard>
      )}

      {!bindingReady ? (
        <p className="py-12 text-center text-xs text-muted-foreground">加载中…</p>
      ) : !hasDaemon ? (
        <DaemonRequiredNotice
          feature="扫描文档"
          workspaceId={workspaceId}
          canBorrow={canBorrow}
          onConfigured={() => {
            void fetchMyBinding(workspaceId)
              .then((b) => setMyBinding(b))
              .catch(() => {});
          }}
        />
      ) : loading ? (
        <p className="py-12 text-center text-xs text-muted-foreground">加载中…</p>
      ) : docs.length === 0 ? (
        <div className="py-12 text-center text-xs text-muted-foreground">
          {debouncedQ ? `没有匹配「${debouncedQ}」的文档` : "暂无扫描文档。点击「重新扫描」从文件系统解析。"}
        </div>
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          {/* 树栏：lg 固定宽（CSS 变量承载拖拽宽度），移动端全宽堆叠 */}
          <div
            data-testid="scan-docs-tree-panel"
            className="w-full shrink-0 lg:w-[var(--tree-w)]"
            style={{ "--tree-w": `${treeWidth}px` } as React.CSSProperties}
          >
            <SectionCard
              title="文档树"
              bodyPadding="p-2"
            >
              <div className="space-y-2">
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="搜索名称或内容"
                  className="w-full rounded border border-input bg-background px-2.5 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <TreeBox className="max-h-[calc(100vh-260px)]">
                  <DocTree
                    tree={tree}
                    workspaceId={workspaceId}
                    onSelect={setSelectedDoc}
                    selectedPath={selectedDoc?.path ?? null}
                  />
                </TreeBox>
              </div>
            </SectionCard>
          </div>
          {/* 拖拽把手：仅桌面分栏时展示（flex 拉伸使把手沿整列可抓） */}
          <div className="hidden shrink-0 lg:flex">
            <PanelResizer
              width={treeWidth}
              onWidthChange={setTreeWidth}
              defaultWidth={TREE_PANEL_DEFAULT_W}
              minWidth={TREE_PANEL_MIN_W}
              maxWidth={TREE_PANEL_MAX_W}
              ariaLabel="调整文档树宽度"
              testId="scan-docs-tree-resizer"
            />
          </div>
          <SectionCard className="min-w-0 flex-1">
            {selectedDoc ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold">{selectedDoc.title ?? selectedDoc.path.split("/").pop()}</h3>
                  <Badge variant="outline" className="font-mono text-[10px]">{selectedDoc.doc_type}</Badge>
                </div>
                <p className="font-mono text-[11px] text-muted-foreground">{selectedDoc.path}</p>
                {selectedDoc.last_modified_at && (
                  <p className="text-[11px] text-muted-foreground">最后修改：{new Date(selectedDoc.last_modified_at).toLocaleString("zh-CN")}</p>
                )}
                {selectedDoc.content ? (
                  <div className="max-h-[60vh] overflow-auto rounded-md bg-muted/50 p-3">{selectedDoc.path.endsWith(".md") ? (<MarkdownPreview source={selectedDoc.content} rehypePlugins={markdownRehypePlugins} />) : (<pre className="text-xs leading-relaxed whitespace-pre-wrap">{selectedDoc.content}</pre>)}</div>
                ) : (
                  <p className="text-xs text-muted-foreground">（无内容）</p>
                )}
              </div>
            ) : (
              <p className="py-8 text-center text-xs text-muted-foreground">点击左侧文件查看内容</p>
            )}
          </SectionCard>
        </div>
      )}
    </PageContainer>
  );
}
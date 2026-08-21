"use client";

/**
 * 知识库页（/workspaces/[id]/knowledge）。
 *
 * ql-20260821-015-4637 重构（原「知识 & 日志」双 tab）：
 * - 只保留知识库，快速修复日志 tab 移除（变更中心「快速修复」tab 仍是完整入口）
 * - 左侧文件树与 explorer/scan-docs 同风格：共享三件套 FileNodeIcon（按扩展名分型图标）
 *   + TreeBox（单行 + 横向滚动）+ PanelResizer/usePanelWidth（拖拽调宽 + localStorage 记忆）
 * - antd Tree 受控：目录默认全展开、点目录行展开/收起（expandAction=click）、
 *   点文件行 getKnowledge 拉详情
 * - 内容区 .md 走 MarkdownPreview 渲染（复用统一 sanitize 插件，内容源自 daemon 上报
 *   的仓库文件不可信）；其余扩展名纯文本 pre 展示
 */

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { Tree, type TreeProps } from "antd";
import type { DataNode } from "antd/es/tree";
import type { ReactNode } from "react";

import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
import { FileNodeIcon } from "@/components/ui/file-node-icon";
import { markdownRehypePlugins } from "@/components/ui/markdown-text";
import { PanelResizer, usePanelWidth } from "@/components/ui/panel-resizer";
import { TreeBox } from "@/components/ui/tree-box";
import { ApiError } from "@/lib/api";
import { getKnowledge, listKnowledge, type KnowledgeEntry } from "@/lib/knowledge";
import "@uiw/react-markdown-preview/markdown.css";

const MarkdownPreview = dynamic(() => import("@uiw/react-markdown-preview"), { ssr: false });

interface Props {
  params: { id: string };
}

// ── 树栏宽度 ────────────────────────────────────────────────────────────────
const TREE_PANEL_DEFAULT_W = 280;
const TREE_PANEL_MIN_W = 200;
const TREE_PANEL_MAX_W = 480;
const TREE_PANEL_WIDTH_KEY = "sillyhub-knowledge-tree-width";

// ── 知识条目 → 目录树 ──────────────────────────────────────────────────────

/** 树节点：entry 存在 = 文件（叶子），否则目录。 */
interface KnowledgeNode {
  name: string;
  path: string;
  entry?: KnowledgeEntry;
  children: KnowledgeNode[];
}

/** 按 path（缺省 filename）斜杠分段建树（不去前缀，知识库路径即展示路径）。 */
function buildKnowledgeTree(items: KnowledgeEntry[]): KnowledgeNode[] {
  const root: KnowledgeNode = { name: "", path: "", children: [] };
  for (const item of items) {
    const parts = (item.path || item.filename).split("/").filter(Boolean);
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      let child = current.children.find((c) => c.name === part);
      if (!child) {
        child = { name: part, path: parts.slice(0, i + 1).join("/"), children: [] };
        current.children.push(child);
      }
      current = child;
      if (i === parts.length - 1) current.entry = item;
    }
  }
  const sortNodes = (nodes: KnowledgeNode[]): KnowledgeNode[] =>
    nodes
      .sort((a, b) => {
        const af = a.entry !== undefined;
        const bf = b.entry !== undefined;
        if (af !== bf) return af ? 1 : -1;
        return a.name.localeCompare(b.name);
      })
      .map((n) => ({ ...n, children: sortNodes(n.children) }));
  return sortNodes(root.children);
}

/** 收集全部目录 path（初始全展开）。 */
function collectDirPaths(nodes: KnowledgeNode[], acc: string[] = []): string[] {
  for (const n of nodes) {
    if (n.entry === undefined) {
      acc.push(n.path);
      collectDirPaths(n.children, acc);
    }
  }
  return acc;
}

/** 文件行标题：文件名 + 修改日期灰字，整行单行。 */
function renderEntryTitle(node: KnowledgeNode & { entry: KnowledgeEntry }): ReactNode {
  const entry = node.entry;
  const date = entry.last_modified_at
    ? new Date(entry.last_modified_at).toLocaleDateString("zh-CN")
    : "";
  return (
    <span
      className="inline-flex items-baseline gap-1 whitespace-nowrap"
      title={entry.title ? `${entry.title}（${entry.filename}）` : entry.filename}
    >
      <span>{node.name}</span>
      {date ? <span className="shrink-0 text-[11px] text-muted-foreground">{date}</span> : null}
    </span>
  );
}

/** KnowledgeNode[] → antd DataNode[]。 */
function toAntdNodes(nodes: KnowledgeNode[]): DataNode[] {
  return nodes.map((n) => {
    if (n.entry) {
      return {
        key: n.entry.filename,
        title: renderEntryTitle(n as KnowledgeNode & { entry: KnowledgeEntry }),
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

export default function KnowledgePage({ params }: Props) {
  const workspaceId = params.id;
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeEntry[]>([]);
  /** 选中文件名（API 详情键）与展示态。 */
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null);
  const [selectedContent, setSelectedContent] = useState<string | null>(null);
  const [selectedTitle, setSelectedTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [treeWidth, setTreeWidth] = usePanelWidth({
    storageKey: TREE_PANEL_WIDTH_KEY,
    defaultWidth: TREE_PANEL_DEFAULT_W,
    minWidth: TREE_PANEL_MIN_W,
    maxWidth: TREE_PANEL_MAX_W,
  });

  useEffect(() => {
    let active = true;
    setLoading(true);
    setPageError(null);
    listKnowledge(workspaceId)
      .then((resp) => {
        if (active) setKnowledgeItems(resp.items);
      })
      .catch((err) => {
        if (active) {
          setPageError(err instanceof ApiError ? err.message : "加载知识库失败");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  const tree = useMemo(() => buildKnowledgeTree(knowledgeItems), [knowledgeItems]);
  const treeData = useMemo(() => toAntdNodes(tree), [tree]);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);

  // 首次列表落定后全展开（列表变化如刷新时重算）。
  useEffect(() => {
    setExpandedKeys(collectDirPaths(tree));
  }, [tree]);

  const onSelectTree: TreeProps["onSelect"] = (_keys, info) => {
    if (!info.node.isLeaf) return;
    const filename = String(info.node.key);
    setSelectedFilename(filename);
    getKnowledge(workspaceId, filename)
      .then((entry) => {
        setSelectedContent(entry.content ?? null);
        setSelectedTitle(entry.title ?? entry.filename);
      })
      .catch((err) => {
        setPageError(err instanceof ApiError ? err.message : "加载文档失败");
      });
  };

  const isMarkdown = selectedFilename?.toLowerCase().endsWith(".md") ?? false;

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
            <span className="mt-0.5 block">知识库</span>
          </span>
        }
      />

      {pageError && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {pageError}
        </div>
      )}

      {loading ? (
        <p className="py-12 text-center text-xs text-muted-foreground">加载中…</p>
      ) : knowledgeItems.length === 0 ? (
        <div className="py-12 text-center text-xs text-muted-foreground">当前没有知识文档。</div>
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          {/* 树栏：lg 固定宽（CSS 变量承载拖拽宽度），移动端全宽堆叠 */}
          <div
            data-testid="knowledge-tree-panel"
            className="w-full shrink-0 lg:w-[var(--tree-w)]"
            style={{ "--tree-w": `${treeWidth}px` } as React.CSSProperties}
          >
            <SectionCard bodyPadding="p-2">
              <TreeBox className="max-h-[calc(100vh-260px)]">
                <Tree
                  treeData={treeData}
                  expandAction="click"
                  expandedKeys={expandedKeys}
                  onExpand={(keys) => setExpandedKeys([...keys])}
                  selectedKeys={selectedFilename ? [selectedFilename] : []}
                  onSelect={onSelectTree}
                  showIcon
                  blockNode
                />
              </TreeBox>
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
              ariaLabel="调整知识库树宽度"
              testId="knowledge-tree-resizer"
            />
          </div>
          <SectionCard className="min-w-0 flex-1">
            {selectedContent === null ? (
              <div className="py-12 text-center text-xs text-muted-foreground">
                选择左侧文档查看内容。
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold">{selectedTitle}</h3>
                </div>
                {isMarkdown ? (
                  <div className="max-h-[70vh] overflow-auto rounded-md bg-muted/50 p-3">
                    <MarkdownPreview source={selectedContent} rehypePlugins={markdownRehypePlugins} />
                  </div>
                ) : (
                  <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded border bg-muted/30 p-3 text-[11px] leading-4">
                    {selectedContent}
                  </pre>
                )}
              </div>
            )}
          </SectionCard>
        </div>
      )}
    </PageContainer>
  );
}

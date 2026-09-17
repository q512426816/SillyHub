"use client";

/**
 * 知识库页（/workspaces/[id]/knowledge）。
 *
 * ql-20260821-015 重构（原「知识 & 日志」双 tab）：
 * - 只保留知识库，快速修复日志 tab 移除（变更中心「快速修复」tab 仍是完整入口）
 * - 左侧文件树与 explorer/scan-docs 同风格：共享三件套 FileNodeIcon（按扩展名分型图标）
 *   + TreeBox（单行 + 横向滚动）+ PanelResizer/usePanelWidth（拖拽调宽 + localStorage 记忆）
 * - antd Tree 受控：目录默认全展开、点目录行展开/收起（expandAction=click）、
 *   点文件行 getKnowledge 拉详情
 * - 内容区 .md 走 MarkdownPreview 渲染（复用统一 sanitize 插件，内容源自 daemon 上报
 *   的仓库文件不可信）；其余扩展名纯文本 pre 展示
 *
 * task-03（2026-09-17-knowledge-precipitation / D-004@v1）：树由扁平路径分组改为
 * 按 zone 分组（对齐 sillyspec CLI zone 口径）——待审核（proposed）置顶并带计数
 * 徽标、知识手册（top）、决策库（decisions）、自动生成（generated），缺 zone 兜底
 * 归 top 组。
 *
 * task-05（同变更 / FR-02 / FR-07 / D-006@v1）：挂写入口——头部「✦ 沉淀知识」
 * 按钮开 PrecipitateDialog（双 tab，本任务实现手工录入）、内容区「编辑」入口
 * 开 EntryEditor（仅正文，frontmatter 不动）；可见性 = KNOWLEDGE_WRITE
 * 持有者（useSession permissions + is_platform_admin 短路，runtime 页 93-94 行
 * 先例），未持有者页面与现状一致。decisions 条目不渲染编辑入口并标注
 * 「由归档流程维护 · 只读」。
 *
 * task-06（同变更 / FR-05 / D-007@v1）：待审核（proposed）条目内容区追加
 * 「⇥ 合并 / ✕ 拒绝」操作区——合并开 MergeDialog（后端 dry-run 预览 + 确认），
 * 拒绝走 antd Popconfirm 二次确认（jsdom 实测可渲染，见 merge-dialog 注释）
 * 后调 reject；操作成功均清详情（候选文件已删/已合并）+ 刷新列表，可见性
 * 复用 canWriteKnowledge 口径。
 *
 * task-08（同变更 / FR-01 / FR-03 / D-002@v1）：挂 DistillTaskBar 于列表上方
 * （原型 .distill-bar 位）——轮询蒸馏任务（5s/15s 双档），任务完成刷新知识
 * 列表使候选出现在待审核区；沉淀弹层派发成功经 onDistilled invalidate 任务
 * 查询，任务条立即出现不等下个轮询到点。
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Popconfirm, Tree, type TreeProps } from "antd";
import type { DataNode } from "antd/es/tree";
import type { ReactNode } from "react";

import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
import { DistillTaskBar, distillTasksQueryKey } from "@/components/knowledge/distill-task-bar";
import { EntryEditor } from "@/components/knowledge/entry-editor";
import { MergeDialog } from "@/components/knowledge/merge-dialog";
import { PrecipitateDialog } from "@/components/knowledge/precipitate-dialog";
import { Button } from "@/components/ui/button";
import { FileNodeIcon } from "@/components/ui/file-node-icon";
import { MarkdownText } from "@/components/ui/markdown-text";
import { PanelResizer, usePanelWidth } from "@/components/ui/panel-resizer";
import { TreeBox } from "@/components/ui/tree-box";
import { ApiError } from "@/lib/api";
import { errMessage, useNotify } from "@/lib/errors";
import {
  getKnowledge,
  listKnowledge,
  rejectKnowledge,
  type KnowledgeEntry,
} from "@/lib/knowledge";
import { useSession } from "@/stores/session";
import "@uiw/react-markdown-preview/markdown.css";


interface Props {
  params: { id: string };
}

// ── 树栏宽度 ────────────────────────────────────────────────────────────────
const TREE_PANEL_DEFAULT_W = 280;
const TREE_PANEL_MIN_W = 200;
const TREE_PANEL_MAX_W = 480;
const TREE_PANEL_WIDTH_KEY = "sillyhub-knowledge-tree-width";

// ── 知识条目 → zone 分组目录树 ──────────────────────────────────────────────

/**
 * zone 分组定义（顺序固定：待审核置顶，其后手册 / 决策库 / 自动生成）。
 * 与 backend parser 的 zone 口径一致（top|decisions|generated|proposed）。
 */
const ZONE_GROUPS: ReadonlyArray<{ zone: string; label: string }> = [
  { zone: "proposed", label: "待审核" },
  { zone: "top", label: "知识手册" },
  { zone: "decisions", label: "决策库" },
  { zone: "generated", label: "自动生成" },
];

/** zone 归组（缺 zone / 未知值兜底归 top 组）。 */
function zoneOf(item: KnowledgeEntry): string {
  return item.zone === "proposed" || item.zone === "decisions" || item.zone === "generated"
    ? item.zone
    : "top";
}

/** 树节点：entry 存在 = 文件（叶子），否则目录。 */
interface KnowledgeNode {
  name: string;
  path: string;
  entry?: KnowledgeEntry;
  children: KnowledgeNode[];
}

/**
 * 条目挂到组内子树：按 filename 剥 zone 目录段后的剩余段建树
 * （top 组内的其它子目录如 manual/ 保留层级，组内同款排序）。
 */
function appendToGroup(group: KnowledgeNode, relParts: string[], item: KnowledgeEntry): void {
  let current = group;
  for (let i = 0; i < relParts.length; i++) {
    const part = relParts[i]!;
    let child = current.children.find((c) => c.name === part && c.entry === undefined);
    if (!child) {
      child = { name: part, path: `${group.path}/${part}`, children: [] };
      current.children.push(child);
    }
    current = child;
    if (i === relParts.length - 1) current.entry = item;
  }
}

/** 按固定 zone 顺序分组建树（空组不渲染；组内目录在前 + 名称排序）。 */
function buildKnowledgeTree(items: KnowledgeEntry[]): KnowledgeNode[] {
  const groups: KnowledgeNode[] = [];
  for (const { zone } of ZONE_GROUPS) {
    const zoneItems = items.filter((it) => zoneOf(it) === zone);
    if (zoneItems.length === 0) continue;
    const group: KnowledgeNode = { name: zone, path: `zone:${zone}`, children: [] };
    for (const item of zoneItems) {
      let rel = item.filename || item.path;
      if (zone !== "top" && rel.startsWith(`${zone}/`)) rel = rel.slice(zone.length + 1);
      appendToGroup(group, rel.split("/").filter(Boolean), item);
    }
    groups.push(group);
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
  return groups.map((g) => ({ ...g, children: sortNodes(g.children) }));
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

/** 组内文件（叶子）计数（待审核徽标用）。 */
function countLeaves(node: KnowledgeNode): number {
  if (node.entry !== undefined) return 1;
  return node.children.reduce((acc, c) => acc + countLeaves(c), 0);
}

/** zone 组标题：中文标签；待审核组附计数徽标（空组不渲染，>0 才显徽标）。 */
function renderGroupTitle(zone: string, label: string, count: number): ReactNode {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="font-medium">{label}</span>
      {zone === "proposed" && count > 0 ? (
        <span
          data-testid="proposed-zone-badge"
          className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold leading-4 text-brand-700"
        >
          {count} 条
        </span>
      ) : null}
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
    const zoneGroup = n.path.startsWith("zone:")
      ? ZONE_GROUPS.find((g) => g.zone === n.path.slice("zone:".length))
      : undefined;
    return {
      key: n.path,
      title: zoneGroup
        ? renderGroupTitle(zoneGroup.zone, zoneGroup.label, countLeaves(n))
        : <span className="font-medium whitespace-nowrap">{n.name}</span>,
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
  const [selectedZone, setSelectedZone] = useState<string>("top");
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  // task-05 写入口态：沉淀弹层开关 + 条目编辑开关。
  const [precipitateOpen, setPrecipitateOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  // task-06 审核操作态：合并弹层目标（null = 关）+ 拒绝提交中。
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [treeWidth, setTreeWidth] = usePanelWidth({
    storageKey: TREE_PANEL_WIDTH_KEY,
    defaultWidth: TREE_PANEL_DEFAULT_W,
    minWidth: TREE_PANEL_MIN_W,
    maxWidth: TREE_PANEL_MAX_W,
  });

  // 写入口可见性（task-05）：KNOWLEDGE_WRITE 持有者（is_platform_admin 短路，
  // runtime 页 93-94 行先例同款写法）。
  const permissions = useSession((s) => s.user?.permissions);
  const isPlatformAdmin = useSession((s) => s.user?.is_platform_admin === true);
  const canWriteKnowledge = isPlatformAdmin || (permissions?.includes("knowledge:write") ?? false);

  /**
   * 列表加载（task-05 抽出：propose/编辑保存后复用刷新）。序号守卫保证只有
   * 最新一次请求落 state——覆盖原 effect 的 active 卸载守卫，并额外防
   * workspaceId 切换 / 手动刷新并发时的旧响应晚到覆盖。
   */
  const loadSeqRef = useRef(0);
  const loadList = useCallback((wsId: string) => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setPageError(null);
    listKnowledge(wsId)
      .then((resp) => {
        if (seq === loadSeqRef.current) setKnowledgeItems(resp.items);
      })
      .catch((err) => {
        if (seq === loadSeqRef.current) {
          setPageError(err instanceof ApiError ? err.message : "加载知识库失败");
        }
      })
      .finally(() => {
        if (seq === loadSeqRef.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadList(workspaceId);
  }, [workspaceId, loadList]);

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
    setEditing(false);
    getKnowledge(workspaceId, filename)
      .then((entry) => {
        setSelectedContent(entry.content ?? null);
        setSelectedTitle(entry.title ?? entry.filename);
        setSelectedZone(zoneOf(entry));
      })
      .catch((err) => {
        setPageError(err instanceof ApiError ? err.message : "加载文档失败");
      });
  };

  const isMarkdown = selectedFilename?.toLowerCase().endsWith(".md") ?? false;
  /** decisions 条目：由归档流程维护（D-006@v1），只读标注对所有人可见。 */
  const isSelectedDecisions = selectedZone === "decisions";
  /** 待审核条目（task-06 / FR-05）：内容区挂「合并/拒绝」审核操作区。 */
  const isSelectedProposed = selectedZone === "proposed";

  /** 候选从列表消失后的详情复位（合并/拒绝成功：proposed 文件已删）。 */
  const clearSelection = useCallback(() => {
    setSelectedFilename(null);
    setSelectedContent(null);
    setSelectedTitle(null);
    setSelectedZone("top");
  }, []);

  /** 拒绝候选（task-06 / FR-05）：Popconfirm 二次确认后调 reject，成功刷新。 */
  const handleReject = useCallback(async () => {
    if (!selectedFilename || rejecting) return;
    setRejecting(true);
    try {
      await rejectKnowledge(workspaceId, selectedFilename);
      notify.success("已拒绝该候选知识");
      clearSelection();
      loadList(workspaceId);
    } catch (err) {
      notify.error(errMessage(err, "拒绝失败，请重试"));
    } finally {
      setRejecting(false);
    }
  }, [selectedFilename, rejecting, workspaceId, loadList, clearSelection, notify]);

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
        actions={
          canWriteKnowledge ? (
            <Button
              data-testid="precipitate-entry"
              onClick={() => setPrecipitateOpen(true)}
            >
              <span aria-hidden>✦</span> 沉淀知识
            </Button>
          ) : null
        }
      />

      {pageError && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {pageError}
        </div>
      )}

      {/* 蒸馏任务条（task-08 / 原型 .distill-bar 位）：无进行中任务时不渲染；
          任务完成经 onCompleted 重拉列表，候选出现在待审核区。 */}
      <DistillTaskBar
        workspaceId={workspaceId}
        onCompleted={() => loadList(workspaceId)}
      />

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
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold">{selectedTitle}</h3>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                      .sillyspec/knowledge/{selectedFilename}
                    </div>
                  </div>
                  {editing ? null : isSelectedDecisions ? (
                    <span
                      data-testid="decisions-readonly-tag"
                      title="决策条目由归档流程自动维护，网页暂只读"
                      className="shrink-0 rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold leading-4 text-brand-700"
                    >
                      由归档流程维护 · 只读
                    </span>
                  ) : canWriteKnowledge ? (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        data-testid="edit-entry"
                        size="sm"
                        variant="outline"
                        onClick={() => setEditing(true)}
                      >
                        <span aria-hidden>✎</span> 编辑
                      </Button>
                      {isSelectedProposed && selectedFilename !== null && (
                        <>
                          <Button
                            data-testid="merge-entry"
                            size="sm"
                            onClick={() => setMergeTarget(selectedFilename)}
                          >
                            <span aria-hidden>⇥</span> 合并
                          </Button>
                          <Popconfirm
                            title="拒绝该候选知识？"
                            description="候选文件将移入 30 天备份区（可回滚），确认拒绝？"
                            okText="确认拒绝"
                            cancelText="取消"
                            onConfirm={() => void handleReject()}
                          >
                            <Button
                              data-testid="reject-entry"
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              disabled={rejecting}
                            >
                              <span aria-hidden>✕</span> 拒绝
                            </Button>
                          </Popconfirm>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
                {editing && selectedFilename !== null ? (
                  <EntryEditor
                    workspaceId={workspaceId}
                    filename={selectedFilename}
                    zone={selectedZone}
                    content={selectedContent}
                    onSaved={(newContent) => {
                      setSelectedContent(newContent);
                      setEditing(false);
                      loadList(workspaceId);
                    }}
                    onCancel={() => setEditing(false)}
                  />
                ) : isMarkdown ? (
                  <div className="max-h-[70vh] overflow-auto rounded-md bg-muted/50">
                    <MarkdownText content={selectedContent} size="reading" />
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

      {precipitateOpen && (
        <PrecipitateDialog
          workspaceId={workspaceId}
          onClose={() => setPrecipitateOpen(false)}
          onProposed={() => loadList(workspaceId)}
          onDistilled={() => {
            // 派发成功 → 任务条查询立即失效重拉（新任务马上出现在条上，
            // 不必等 15s 常规轮询到点）。
            void queryClient.invalidateQueries({
              queryKey: distillTasksQueryKey(workspaceId),
            });
          }}
        />
      )}

      {mergeTarget !== null && (
        <MergeDialog
          workspaceId={workspaceId}
          filename={mergeTarget}
          defaultSectionTitle={selectedTitle}
          onClose={() => setMergeTarget(null)}
          onMerged={() => {
            // 候选已合并删除：清详情 + 刷新列表（待审核区少一条）。
            clearSelection();
            loadList(workspaceId);
          }}
        />
      )}
    </PageContainer>
  );
}

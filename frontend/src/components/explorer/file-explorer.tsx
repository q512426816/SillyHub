"use client";

/**
 * FileExplorer · 工作区文件树（explorer 页左栏）——antd Tree 受控懒加载 + 文件名搜索 + 祖先链直达。
 *
 * - 懒加载（FR-01）：根节点 = 「工作区根」（相对路径 ""），首层挂载即拉；展开目录节点时
 *   loadData 调 ``fetchTree(workspaceId, relPath)`` 只取当前层（file-rpc 逐层语义，禁递归预取，
 *   design 非目标约束）。目录 isLeaf=false、文件 isLeaf=true，key = 相对工作区根的 POSIX 路径。
 * - 目录双击展开/收起（expandAction=doubleClick）：单击仍只选中，双击目录行切换展开/收起，
 *   走同一受控 onExpand + loadData 懒加载链路（叶子与 Ctrl/Shift 修饰键由 rc-tree 忽略）。
 * - 文件点击：``onSelectFile(relPath)`` 回调给页面装配（task-08）驱动右栏预览。
 * - 搜索（FR-04 / D-005@v1）：防抖 300ms 或回车提交后调 ``fetchSearch``；结果面板列出相对路径；
 *   truncated=true 提示「结果超过 100 条，仅显示前 100」。
 * - 祖先链直达：点搜索结果后按命中路径自根向下逐段 fetchTree 填 children、逐层累积受控
 *   expandedKeys，最终 selectedKeys 命中目标（文件 → onSelectFile；目录 → 展开并选中）。
 *   受控 expandedKeys 程序化更新不会触发 rc-tree loadData，故必须手动逐层拉取。
 * - 错误降级：单节点展开失败置空 children + 红条提示不崩溃（空目录与失败可区分）；
 *   根加载失败红条带「重试」。
 * - 滚动语义（ql-20260818-010-f551）：整行单行展示——行宽 w-max（antd blockNode 默认把行
 *   钳在容器宽内，长名会把图标/大小挤到第二行，ql-20260821-008-fade），名称不截断，行宽
 *   超出容器时靠外层 overflow-auto 横向滚动；缩进 16px/层；树区域在页面视口锚定下内部滚动。
 *
 * 树图标沿用 remote-folder-picker 先例用 lucide（task-06 蓝图「目录文件分用 lucide 图标」），
 * 文件按扩展名分型配色：常见开发语言各自独立图标（Java 咖啡 / Vue 三角 / React 原子 /
 * Python f(x) / Go 六边形 / Ruby 宝石 / Rust 齿轮 / Swift 雨燕 / .NET 积木 / Shell 终端等，
 * 详见 FILE_ICON_BY_EXT），其余语言与媒体/文档类沿用 ql-20260821-008 的映射。
 * 视觉遵循 FRONTEND_PAGE_STYLE.md（antd 业务组件 + tailwind 布局/颜色变量、中文文案）。
 * 依据：design.md §7.2 / Wave3 + tasks/task-06.md。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input, Spin, Tree, type TreeProps } from "antd";
import type { DataNode } from "antd/es/tree";
import {
  Atom,
  Bird,
  Blocks,
  Braces,
  Binary,
  CodeXml,
  Cog,
  Coffee,
  Database,
  FileArchive,
  FileAudio2,
  FileCode2,
  FileImage,
  FileJson2,
  FileLock,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType2,
  FileVideo,
  Folder,
  FolderOpen,
  FunctionSquare,
  Gem,
  Globe,
  Hexagon,
  Palette,
  Triangle,
  type LucideIcon,
} from "lucide-react";

import { ApiError } from "@/lib/api";
import {
  fetchSearch,
  fetchTree,
  type ExplorerEntry,
  type ExplorerSearchMatch,
} from "@/lib/explorer";

/** 根节点 key——对应相对路径 ""（antd Tree 空串 key 语义不稳，用哨兵代替）。 */
const ROOT_KEY = "__workspace_root__";
/** 根节点标题。 */
const ROOT_TITLE = "工作区根";
/** 搜索防抖间隔（ms）。 */
const SEARCH_DEBOUNCE_MS = 300;

export interface FileExplorerProps {
  /** 工作区 ID（explorer 四端点的 {wid} 路径段）。 */
  workspaceId: string;
  /** 文件节点被选中（树内点击 / 搜索直达命中）时回调，入参为相对工作区根的 POSIX 路径。 */
  onSelectFile: (path: string) => void;
}

/** 文件大小缩写：B / KB / MB / GB（文件条目右侧灰字，目录不显示）。 */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/** 文件图标规格：lucide 图标 + 信息色（固定 tailwind 色阶，非品牌色，双主题下均可读）。 */
interface FileIconSpec {
  icon: LucideIcon;
  className: string;
}

/** 代码/脚本类：FileCode2 + 琥珀（未单列语言的兜底）。 */
const CODE_ICON: FileIconSpec = { icon: FileCode2, className: "text-amber-500" };
/** 默认/纯文本类：FileText + 主题灰（与旧版一致，未匹配扩展名的回退）。 */
const DEFAULT_ICON: FileIconSpec = { icon: FileText, className: "text-muted-foreground" };

/** 扩展名 → 图标规格。未命中扩展名回退 DEFAULT_ICON（FileText 灰）。
 *  常见开发语言各自独立图标+配色（ql-20260821-012-22b0），其余语言回退 CODE_ICON。 */
const FILE_ICON_BY_EXT: Record<string, FileIconSpec> = {
  // ── 单列语言（形状+配色尽量贴语言品牌）──────────────────────────────
  // Java：咖啡 + 深橙
  java: { icon: Coffee, className: "text-orange-700" },
  // JVM 字节码：二进制 + 锌灰
  class: { icon: Binary, className: "text-zinc-500" },
  // XML：code-xml + 橙
  xml: { icon: CodeXml, className: "text-orange-500" },
  // Vue：三角 V + 绿
  vue: { icon: Triangle, className: "text-emerald-500" },
  // JS 家族：花括号 + 黄；React（jsx）：原子 + 天蓝
  js: { icon: Braces, className: "text-yellow-500" },
  mjs: { icon: Braces, className: "text-yellow-500" },
  cjs: { icon: Braces, className: "text-yellow-500" },
  jsx: { icon: Atom, className: "text-sky-500" },
  // TS：花括号 + 蓝；React TS（tsx）：原子 + 青
  ts: { icon: Braces, className: "text-blue-600" },
  mts: { icon: Braces, className: "text-blue-600" },
  cts: { icon: Braces, className: "text-blue-600" },
  tsx: { icon: Atom, className: "text-cyan-600" },
  // Python：f(x) + 蓝
  py: { icon: FunctionSquare, className: "text-blue-500" },
  pyw: { icon: FunctionSquare, className: "text-blue-500" },
  pyi: { icon: FunctionSquare, className: "text-blue-500" },
  // Go：六边形 + 青（#00ADD8）
  go: { icon: Hexagon, className: "text-cyan-600" },
  // Ruby：宝石 + 玫红
  rb: { icon: Gem, className: "text-rose-600" },
  // Rust：齿轮 + 石墨
  rs: { icon: Cog, className: "text-stone-600" },
  // PHP：花括号 + 靛
  php: { icon: Braces, className: "text-indigo-500" },
  // Swift：雨燕 + 橙
  swift: { icon: Bird, className: "text-orange-500" },
  // Kotlin：花括号 + 紫罗兰
  kt: { icon: Braces, className: "text-violet-600" },
  kts: { icon: Braces, className: "text-violet-600" },
  // C#/.NET 系：积木 + 紫（.net 本身不是扩展名，按语言/项目文件映射）
  cs: { icon: Blocks, className: "text-violet-700" },
  vb: { icon: Blocks, className: "text-violet-600" },
  fs: { icon: Blocks, className: "text-violet-600" },
  csproj: { icon: Blocks, className: "text-violet-600" },
  vbproj: { icon: Blocks, className: "text-violet-600" },
  fsproj: { icon: Blocks, className: "text-violet-600" },
  sln: { icon: Blocks, className: "text-violet-700" },
  // C / C++：FileCode2 + 深蓝系
  c: { icon: FileCode2, className: "text-indigo-600" },
  h: { icon: FileCode2, className: "text-indigo-600" },
  cpp: { icon: FileCode2, className: "text-blue-700" },
  hpp: { icon: FileCode2, className: "text-blue-700" },
  cc: { icon: FileCode2, className: "text-blue-700" },
  cxx: { icon: FileCode2, className: "text-blue-700" },
  // Web：HTML 地球 + 橙；CSS 调色板 + 蓝；Sass/Less 系调色板 + 粉
  html: { icon: Globe, className: "text-orange-600" },
  htm: { icon: Globe, className: "text-orange-600" },
  css: { icon: Palette, className: "text-sky-600" },
  scss: { icon: Palette, className: "text-pink-600" },
  sass: { icon: Palette, className: "text-pink-600" },
  less: { icon: Palette, className: "text-pink-600" },
  styl: { icon: Palette, className: "text-pink-600" },
  // Shell：终端 + 绿
  sh: { icon: FileTerminal, className: "text-green-600" },
  bash: { icon: FileTerminal, className: "text-green-600" },
  zsh: { icon: FileTerminal, className: "text-green-600" },
  fish: { icon: FileTerminal, className: "text-green-600" },
  ps1: { icon: FileTerminal, className: "text-green-600" },
  bat: { icon: FileTerminal, className: "text-green-600" },
  cmd: { icon: FileTerminal, className: "text-green-600" },
  // SQL：数据库 + 靛
  sql: { icon: Database, className: "text-indigo-500" },

  // ── 其余代码/脚本/配置类（未单列语言，统一 FileCode2 琥珀）─────────
  ...Object.fromEntries(
    [
      "dart", "zig", "scala", "lua", "pl", "pm", "ex", "exs", "elm",
      "hs", "clj", "cljs", "erl", "r", "m", "mm", "tcl", "groovy",
      "gradle", "mak", "mk", "cmake", "properties", "svelte", "astro",
      "yaml", "yml", "toml", "ini", "cfg", "conf",
    ].map((ext) => [ext, CODE_ICON]),
  ),
  // ── 结构化数据 / 媒体 / 文档（沿用 ql-20260821-008）─────────────────
  json: { icon: FileJson2, className: "text-emerald-500" },
  jsonl: { icon: FileJson2, className: "text-emerald-500" },
  // 图片
  png: { icon: FileImage, className: "text-violet-500" },
  jpg: { icon: FileImage, className: "text-violet-500" },
  jpeg: { icon: FileImage, className: "text-violet-500" },
  gif: { icon: FileImage, className: "text-violet-500" },
  svg: { icon: FileImage, className: "text-violet-500" },
  webp: { icon: FileImage, className: "text-violet-500" },
  ico: { icon: FileImage, className: "text-violet-500" },
  bmp: { icon: FileImage, className: "text-violet-500" },
  // 音视频
  mp4: { icon: FileVideo, className: "text-rose-500" },
  mov: { icon: FileVideo, className: "text-rose-500" },
  webm: { icon: FileVideo, className: "text-rose-500" },
  avi: { icon: FileVideo, className: "text-rose-500" },
  mkv: { icon: FileVideo, className: "text-rose-500" },
  flv: { icon: FileVideo, className: "text-rose-500" },
  mp3: { icon: FileAudio2, className: "text-pink-500" },
  wav: { icon: FileAudio2, className: "text-pink-500" },
  ogg: { icon: FileAudio2, className: "text-pink-500" },
  flac: { icon: FileAudio2, className: "text-pink-500" },
  m4a: { icon: FileAudio2, className: "text-pink-500" },
  aac: { icon: FileAudio2, className: "text-pink-500" },
  // 压缩包
  zip: { icon: FileArchive, className: "text-orange-500" },
  tar: { icon: FileArchive, className: "text-orange-500" },
  gz: { icon: FileArchive, className: "text-orange-500" },
  tgz: { icon: FileArchive, className: "text-orange-500" },
  bz2: { icon: FileArchive, className: "text-orange-500" },
  "7z": { icon: FileArchive, className: "text-orange-500" },
  rar: { icon: FileArchive, className: "text-orange-500" },
  jar: { icon: FileArchive, className: "text-orange-500" },
  // 表格
  xls: { icon: FileSpreadsheet, className: "text-green-500" },
  xlsx: { icon: FileSpreadsheet, className: "text-green-500" },
  csv: { icon: FileSpreadsheet, className: "text-green-500" },
  tsv: { icon: FileSpreadsheet, className: "text-green-500" },
  // 文档：pdf 红色，Office 文档蓝
  pdf: { icon: FileType2, className: "text-red-500" },
  doc: { icon: FileType2, className: "text-sky-500" },
  docx: { icon: FileType2, className: "text-sky-500" },
  ppt: { icon: FileType2, className: "text-sky-500" },
  pptx: { icon: FileType2, className: "text-sky-500" },
  // 敏感配置
  env: { icon: FileLock, className: "text-amber-600" },
};

/** 取小写扩展名（不含点）；无扩展名返回 ""。 */
function fileExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** 文件图标规格（按扩展名；树与搜索结果面板共用）。 */
function fileIconSpec(name: string): FileIconSpec {
  return FILE_ICON_BY_EXT[fileExt(name)] ?? DEFAULT_ICON;
}

/** 条目图标：目录 Folder / 文件按扩展名分型配色。size 形如 "h-4 w-4"。 */
function EntryIcon({
  entry,
  size = "h-4 w-4",
}: {
  entry: Pick<ExplorerEntry, "name" | "type">;
  size?: string;
}) {
  if (entry.type === "dir") {
    return <Folder className={`${size} shrink-0 text-muted-foreground`} />;
  }
  const spec = fileIconSpec(entry.name);
  return <spec.icon className={`${size} shrink-0 ${spec.className}`} />;
}

/** 树节点 key → 相对根 POSIX 路径：根哨兵 → ""，其余 key 本身即 rel 路径。 */
function keyToPath(key: React.Key): string {
  return key === ROOT_KEY ? "" : String(key);
}

/** 递归更新树数据（antd Tree loadData 模式，remote-folder-picker 先例）。 */
function updateTreeData(list: DataNode[], key: React.Key, children: DataNode[]): DataNode[] {
  return list.map((node) => {
    if (node.key === key) return { ...node, children };
    if (node.children) {
      return { ...node, children: updateTreeData(node.children, key, children) };
    }
    return node;
  });
}

/** 深度优先找节点（祖先链直达时判断某层是否已加载过，已加载不重复拉）。 */
function findNode(list: DataNode[], key: React.Key): DataNode | null {
  for (const node of list) {
    if (node.key === key) return node;
    if (node.children) {
      const hit = findNode(node.children, key);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * 同级排序：目录先于文件，再按名称。后端已保证该顺序（task-04），前端兜底排序幂等——
 * 后端有序时结果不变，后端抖动时仍守住「目录优先」的展示约束。
 */
function sortEntries(entries: ExplorerEntry[]): ExplorerEntry[] {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** 条目标题：名称 + 文件大小缩写（灰字）。整行单行展示——容器 whitespace-nowrap，
 *  行宽超出容器由树容器 w-max 放开靠外层 overflow-auto 横向滚动看全名
 *  （ql-20260818-010-f551 滚动语义 + ql-20260821-008-fade 单行修复）。 */
function renderTitle(entry: ExplorerEntry) {
  const size = entry.type === "file" ? formatSize(entry.size) : "";
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span title={entry.name}>{entry.name}</span>
      {size ? <span className="shrink-0 text-[11px] text-muted-foreground">{size}</span> : null}
    </span>
  );
}

/** 目录项 → 树节点（key = 相对根 POSIX 路径；目录可展开、文件为叶子）。 */
function entriesToNodes(entries: ExplorerEntry[], parentPath: string): DataNode[] {
  return sortEntries(entries).map((entry) => ({
    key: parentPath === "" ? entry.name : `${parentPath}/${entry.name}`,
    title: renderTitle(entry),
    isLeaf: entry.type === "file",
    icon: <EntryIcon entry={entry} />,
  }));
}

/** 根节点：标题「工作区根」，首层 children 挂载时预挂（rc-tree 对已有 children 的节点不再触发 loadData）。 */
function makeRootNode(entries: ExplorerEntry[]): DataNode {
  return {
    key: ROOT_KEY,
    title: <span className="font-medium">{ROOT_TITLE}</span>,
    isLeaf: entries.length === 0,
    icon: <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />,
    children: entriesToNodes(entries, ""),
  };
}

/** 统一把 ApiError / 异常转成用户可读中文提示。 */
function formatExplorerError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.code === "not_found") return "路径不存在或已被移动。";
    if (err.code === "forbidden" || err.status === 403) return "没有权限访问该路径。";
    return err.message || fallback;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export function FileExplorer({ workspaceId, onSelectFile }: FileExplorerProps) {
  // ── 树状态（受控）──────────────────────────────────────────────────────
  const [treeData, setTreeData] = useState<DataNode[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [rootLoading, setRootLoading] = useState(false);
  const [treeError, setTreeError] = useState("");
  /** 根层重试计数器（自增触发 effect 重载）。 */
  const [rootNonce, setRootNonce] = useState(0);

  // ── 搜索状态 ─────────────────────────────────────────────────────────
  /** 输入框当前值（逐键变化）。 */
  const [searchInput, setSearchInput] = useState("");
  /** 实际触发搜索的词（防抖后 / 回车提交）。 */
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<ExplorerSearchMatch[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  // 异步直达期间读最新树状态的镜像（navigateToMatch 闭包防陈旧）。
  const treeDataRef = useRef<DataNode[]>([]);
  const expandedKeysRef = useRef<React.Key[]>([]);
  useEffect(() => {
    treeDataRef.current = treeData;
  }, [treeData]);
  useEffect(() => {
    expandedKeysRef.current = expandedKeys;
  }, [expandedKeys]);
  /** 直达重入锁（异步逐层展开期间忽略重复点击）。 */
  const navigatingRef = useRef(false);

  // ── 根层加载（挂载 / 切换 workspaceId / 重试）──────────────────────────
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    setRootLoading(true);
    setTreeError("");
    setTreeData([]);
    setExpandedKeys([]);
    setSelectedKeys([]);
    (async () => {
      try {
        const resp = await fetchTree(workspaceId, "");
        if (cancelled) return;
        setTreeData([makeRootNode(resp.entries)]);
        // 根自动展开，首层目录直接可见（children 已预挂，不再触发 loadData）。
        setExpandedKeys([ROOT_KEY]);
      } catch (err) {
        if (cancelled) return;
        setTreeError(formatExplorerError(err, "无法加载文件树，守护进程可能离线或无权限。"));
      } finally {
        if (!cancelled) setRootLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, rootNonce]);

  // ── 懒加载：展开目录节点只拉当前层 ─────────────────────────────────────
  // 注：直接以 TreeProps["loadData"] 等注解声明（上下文类型推断参数），
  //     不用 useCallback 包裹——泛型包裹会丢上下文导致参数 implicit any。
  const onLoadData: TreeProps["loadData"] = async (node) => {
    const path = keyToPath(node.key);
    try {
      const resp = await fetchTree(workspaceId, path);
      setTreeData((prev) => updateTreeData(prev, node.key, entriesToNodes(resp.entries, path)));
    } catch (err) {
      // 单节点失败：置空 children（与空目录区分靠红条）+ 提示，不崩溃。
      setTreeData((prev) => updateTreeData(prev, node.key, []));
      setTreeError(formatExplorerError(err, "无法展开该目录。"));
    }
  };

  const onExpand: TreeProps["onExpand"] = (keys) => {
    setExpandedKeys([...keys]);
  };

  const onSelect: TreeProps["onSelect"] = (keys, info) => {
    setSelectedKeys([...keys]);
    // 文件节点（叶子）才回调；目录选中只高亮，展开走 switcher。
    if (info.node.isLeaf) onSelectFile(keyToPath(info.node.key));
  };

  // ── 搜索：防抖 300ms 触发（回车/清空立即生效走 onSearch）────────────────
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const kw = searchQuery;
    if (!workspaceId || kw === "") {
      setResults(null);
      setTruncated(false);
      setSearchError("");
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    setSearchError("");
    (async () => {
      try {
        const resp = await fetchSearch(workspaceId, kw);
        if (cancelled) return;
        setResults(resp.matches);
        setTruncated(resp.truncated);
      } catch (err) {
        if (cancelled) return;
        setResults([]);
        setTruncated(false);
        setSearchError(formatExplorerError(err, "搜索失败，请稍后重试。"));
      } finally {
        if (!cancelled) setSearching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, searchQuery]);

  // ── 祖先链直达：自根逐层 fetchTree 填 children + 累积 expandedKeys ─────
  const navigateToMatch = useCallback(
    async (match: ExplorerSearchMatch) => {
      if (navigatingRef.current) return;
      if (treeDataRef.current.length === 0) {
        setTreeError("文件树尚未加载完成，请稍后重试。");
        return;
      }
      navigatingRef.current = true;
      try {
        const segments = match.path.split("/").filter(Boolean);
        // 祖先目录链（不含命中项本身）：a/b/c.py → ["a", "a/b"]。
        const ancestors: string[] = [];
        for (let i = 1; i < segments.length; i++) {
          ancestors.push(segments.slice(0, i).join("/"));
        }

        let tree = treeDataRef.current;
        const expanded = new Set<React.Key>([...expandedKeysRef.current, ROOT_KEY]);
        for (const dir of ancestors) {
          const existing = findNode(tree, dir);
          if (existing?.children) {
            // 该层已加载过（children 存在，含空目录）→ 只补展开键，不重复拉。
            expanded.add(dir);
            continue;
          }
          const resp = await fetchTree(workspaceId, dir);
          tree = updateTreeData(tree, dir, entriesToNodes(resp.entries, dir));
          expanded.add(dir);
          // 逐层落盘渲染（受控 expandedKeys 同步更新才能逐层展开）。
          setTreeData(tree);
          setExpandedKeys([...expanded]);
        }

        setSelectedKeys([match.path]);
        if (match.type === "file") {
          onSelectFile(match.path);
        } else {
          // 命中目录：拉一层子节点，展开并选中（不触发 onSelectFile）。
          const existing = findNode(tree, match.path);
          if (!existing?.children) {
            const resp = await fetchTree(workspaceId, match.path);
            tree = updateTreeData(tree, match.path, entriesToNodes(resp.entries, match.path));
          }
          expanded.add(match.path);
          setTreeData(tree);
          setExpandedKeys([...expanded]);
        }
        // 收起搜索面板，让位给树的直达结果。
        setSearchInput("");
        setSearchQuery("");
      } catch (err) {
        setTreeError(formatExplorerError(err, "无法定位该文件，路径可能已变化。"));
      } finally {
        navigatingRef.current = false;
      }
    },
    [workspaceId, onSelectFile],
  );

  const showResultPanel = searching || searchError !== "" || results !== null;

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-2">
      {/* 文件名搜索：防抖 + 回车提交（不逐键请求） */}
      <Input.Search
        placeholder="搜索文件名…"
        allowClear
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        onSearch={(value) => setSearchQuery(value.trim())}
        data-testid="explorer-search-input"
      />

      {/* 错误降级红条：根失败带「重试」，节点级失败仅提示 */}
      {treeError ? (
        <div
          role="alert"
          className="flex items-center rounded border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-xs text-destructive"
        >
          <span className="min-w-0 flex-1 break-all">{treeError}</span>
          {treeData.length === 0 ? (
            <Button size="small" className="ml-2 shrink-0" onClick={() => setRootNonce((n) => n + 1)}>
              重试
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* 搜索结果面板（loading / 错误 / 命中列表） */}
      {showResultPanel ? (
        <div className="rounded border bg-card" data-testid="explorer-search-results">
          {searching ? (
            <div className="flex justify-center py-4">
              <Spin size="small" />
            </div>
          ) : searchError ? (
            <div className="px-2 py-1.5 text-xs text-destructive">{searchError}</div>
          ) : (
            <>
              {truncated ? (
                <div className="border-b px-2 py-1 text-[11px] text-muted-foreground">
                  结果超过 100 条，仅显示前 100
                </div>
              ) : null}
              {results !== null && results.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">未找到匹配的文件或目录</div>
              ) : (
                <ul className="max-h-64 overflow-auto py-1">
                  {(results ?? []).map((match) => (
                    <li key={match.path}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-muted"
                        title={match.path}
                        onClick={() => void navigateToMatch(match)}
                      >
                        <EntryIcon entry={match} size="h-3.5 w-3.5" />
                        <span className="whitespace-nowrap font-mono text-xs" title={match.path}>
                          {match.path}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      ) : null}

      {/* 文件树：根加载中 / 空态 / 树。
          缩进 16px/层（antd v6 Tree 已无 indentSize prop，token 默认 controlHeightSM=24px，
          在窄栏内层级深时太占地，用任意选择器覆盖 indent-unit 宽度）。
          单行展示（ql-20260821-008-fade）：antd blockNode 默认把行钳在容器宽内，长文件名会把
          图标/大小挤到第二行——行宽 w-max + min-w-full 放开、节点 wrapper 改 flex 不换行，
          超宽行靠本容器 overflow-auto 横向滚动。css-in-js 样式注入在 tailwind 之后，同特异性
          会被 antd 反杀，故覆盖一律带 ! 提权（indent-unit 的 w-4 之前没生效就是栽在这）。 */}
      {rootLoading ? (
        <div className="flex flex-1 items-center justify-center py-8">
          <Spin />
        </div>
      ) : treeData.length === 0 ? (
        <div className="flex-1 py-8 text-center text-xs text-muted-foreground">工作区没有文件。</div>
      ) : (
        <div
          className="min-h-0 flex-1 overflow-auto rounded border
            [&_.ant-tree-indent-unit]:!w-4
            [&_.ant-tree-treenode]:!w-max [&_.ant-tree-treenode]:!min-w-full
            [&_.ant-tree-node-content-wrapper]:!flex [&_.ant-tree-node-content-wrapper]:!items-center
            [&_.ant-tree-node-content-wrapper]:!whitespace-nowrap"
        >
          <Tree
            treeData={treeData}
            loadData={onLoadData}
            expandAction="doubleClick"
            expandedKeys={expandedKeys}
            onExpand={onExpand}
            selectedKeys={selectedKeys}
            onSelect={onSelect}
            showIcon
            blockNode
          />
        </div>
      )}
    </div>
  );
}

export default FileExplorer;

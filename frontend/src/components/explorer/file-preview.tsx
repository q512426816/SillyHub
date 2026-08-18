"use client";

/**
 * FilePreview — 工作区文件浏览器右侧预览组件（FR-02/FR-03，D-004@v1）。
 *
 * 按 ``filePath`` 经 ``useExplorerFile`` 取数后按类型分发渲染：
 * - 图片扩展名 → ``fetchDownload`` 取 Blob → objectURL 内联 ``<img>``（鉴权流，
 *   裸 URL 会 401，design R-06）；卸载/切换文件时 revoke 防泄漏（file-image.tsx 先例）
 * - ``binary=true`` → 元信息卡（名称/大小/修改时间 + 「二进制文件不预览」）
 * - .md/.markdown → 复用 ``MarkdownText``（size=reading，sanitize 已内建不另起管线）
 * - 其余文本 → react-syntax-highlighter Prism Light（dynamic import + ssr:false 防
 *   打包膨胀/SSR 报错；按需注册语言，未识别扩展名退化纯文本 pre）
 * - ``truncated=true``（超 10MB 截断，D-004）→ 预览区顶部黄条提示引导下载看全量
 *
 * 滚动语义（ql-20260818-010-f551）：内容区在页面视口锚定下内部滚动；纯文本与代码
 * 分支统一不软折行 + 横向滚动；图片 max-h-full 自适应预览区高度。
 *
 * 头部展示文件名/大小/修改时间 + 下载按钮（全类型可用，loading 态防重复点击）；
 * 下载走 ``downloadExplorerFile``（fetch Blob → a download → revoke，R-06）。
 *
 * 依据：design.md §7.2/§7.3、R-06、D-004@v1 + tasks/task-07.md。
 */

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Spin, Typography } from "antd";
import { DownloadOutlined, FileOutlined } from "@ant-design/icons";

import { MarkdownText } from "@/components/ui/markdown-text";
import { formatFileSize } from "@/lib/file/utils";
import { downloadExplorerFile, fetchDownload, useExplorerFile } from "@/lib/explorer";

// 代码高亮主题（纯样式对象，静态引入体积可忽略；高亮核心走下方 dynamic import）
import oneDark from "react-syntax-highlighter/dist/esm/styles/prism/one-dark";
// 仅类型导入：tsconfig "types" 白名单不放行 @types/react-syntax-highlighter 的
// 自动装载，根包 type-only import 会连带其全部 ambient 子路径声明（dist/esm/*）
// 进程序；编译期擦除、零运行时成本，不拖入完整高亮 bundle。
import type { SyntaxHighlighterProps } from "react-syntax-highlighter";

const { Text } = Typography;

// ── 类型分发规则（按文件名扩展名小写判定）──────────────────────────────

/** 图片扩展名 → fetchDownload Blob → objectURL 内联（优先级最高，先于 binary 判定）。 */
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"]);

/** Markdown 扩展名 → 复用 MarkdownText 渲染。 */
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);

/** 代码扩展名 → Prism 注册语言名（收敛到下方 dynamic loader 已注册的集合，未收录按纯文本）。 */
const CODE_LANGUAGES: Record<string, string> = {
  py: "python",
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  yml: "yaml",
  yaml: "yaml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
  html: "markup",
  htm: "markup",
  xml: "markup",
  css: "css",
  java: "java",
  go: "go",
  rs: "rust",
  toml: "toml",
  ini: "ini",
  cfg: "ini",
};

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  // 无扩展名（含 .gitignore 这类点开头文件）一律返回空串 → 走纯文本分支
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

// ── 代码高亮：Prism Light + 按需注册语言 + dynamic import（ssr:false）──
// 语言注册收敛在 loader 内一次完成（import() 集合保持静态可分析，webpack 可分包）；
// 未注册语言名不传入 language prop（退化纯文本 pre），杜绝运行时报错。
const SyntaxHighlighter = dynamic<SyntaxHighlighterProps>(
  () =>
    Promise.all([
      import("react-syntax-highlighter/dist/esm/prism-light"),
      import("react-syntax-highlighter/dist/esm/languages/prism/python"),
      import("react-syntax-highlighter/dist/esm/languages/prism/typescript"),
      import("react-syntax-highlighter/dist/esm/languages/prism/tsx"),
      import("react-syntax-highlighter/dist/esm/languages/prism/javascript"),
      import("react-syntax-highlighter/dist/esm/languages/prism/jsx"),
      import("react-syntax-highlighter/dist/esm/languages/prism/json"),
      import("react-syntax-highlighter/dist/esm/languages/prism/yaml"),
      import("react-syntax-highlighter/dist/esm/languages/prism/bash"),
      import("react-syntax-highlighter/dist/esm/languages/prism/sql"),
      import("react-syntax-highlighter/dist/esm/languages/prism/markup"),
      import("react-syntax-highlighter/dist/esm/languages/prism/css"),
      import("react-syntax-highlighter/dist/esm/languages/prism/java"),
      import("react-syntax-highlighter/dist/esm/languages/prism/go"),
      import("react-syntax-highlighter/dist/esm/languages/prism/rust"),
      import("react-syntax-highlighter/dist/esm/languages/prism/toml"),
      import("react-syntax-highlighter/dist/esm/languages/prism/ini"),
    ]).then(
      ([
        PrismLight,
        python,
        typescript,
        tsx,
        javascript,
        jsx,
        json,
        yaml,
        bash,
        sql,
        markup,
        css,
        java,
        go,
        rust,
        toml,
        ini,
      ]) => {
        PrismLight.default.registerLanguage("python", python.default);
        PrismLight.default.registerLanguage("typescript", typescript.default);
        PrismLight.default.registerLanguage("tsx", tsx.default);
        PrismLight.default.registerLanguage("javascript", javascript.default);
        PrismLight.default.registerLanguage("jsx", jsx.default);
        PrismLight.default.registerLanguage("json", json.default);
        PrismLight.default.registerLanguage("yaml", yaml.default);
        PrismLight.default.registerLanguage("bash", bash.default);
        PrismLight.default.registerLanguage("sql", sql.default);
        PrismLight.default.registerLanguage("markup", markup.default);
        PrismLight.default.registerLanguage("css", css.default);
        PrismLight.default.registerLanguage("java", java.default);
        PrismLight.default.registerLanguage("go", go.default);
        PrismLight.default.registerLanguage("rust", rust.default);
        PrismLight.default.registerLanguage("toml", toml.default);
        PrismLight.default.registerLanguage("ini", ini.default);
        return PrismLight.default;
      },
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-8">
        <Spin size="small" />
      </div>
    ),
  },
);

// ── 图片预览：鉴权 Blob → objectURL（卸载/切换 revoke，防泄漏）──────────

function ImagePreview({
  workspaceId,
  filePath,
  name,
}: {
  workspaceId: string;
  filePath: string;
  name: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setSrc(null);
    setFailed(false);
    fetchDownload(workspaceId, filePath)
      .then((blob) => {
        // 卸载/切换后不再落地 objectURL，避免无人 revoke 的泄漏
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [workspaceId, filePath]);

  if (failed) {
    return <Alert type="warning" showIcon title="图片加载失败，请下载后查看" />;
  }
  if (!src) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spin size="small" />
      </div>
    );
  }
  // objectURL 无法走 next/image（非静态资源且需鉴权），此处必须原生 img。
  // max-h-full 自适应预览区可视高度（旧 540px 魔法数在小屏溢出，ql-20260818-010-f551）。
  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-auto p-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={name}
        className="max-h-full max-w-full rounded-md border border-border object-contain"
      />
    </div>
  );
}

// ── 二进制元信息卡（不渲染内容）───────────────────────────────────────

function BinaryMetaCard({ name, size, mtime }: { name: string; size: number; mtime: string }) {
  return (
    <div className="mx-auto mt-10 max-w-sm rounded-md border border-border bg-muted/20 px-4 py-3">
      <div className="flex items-center gap-2">
        <FileOutlined className="flex-none text-muted-foreground" />
        <span className="truncate text-xs font-medium text-foreground" title={name}>
          {name}
        </span>
      </div>
      <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
        <li>大小：{formatFileSize(size)}</li>
        <li>修改时间：{new Date(mtime).toLocaleString("zh-CN")}</li>
      </ul>
      <div className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
        二进制文件不预览，请下载后查看
      </div>
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────────

export interface FilePreviewProps {
  /** 工作区 id。 */
  workspaceId: string;
  /** 选中文件相对路径（相对工作区根）；null=未选中，显示空态占位。 */
  filePath: string | null;
}

export function FilePreview({ workspaceId, filePath }: FilePreviewProps) {
  const query = useExplorerFile(workspaceId, filePath);
  const [downloading, setDownloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);

  const handleDownload = useCallback(async () => {
    if (filePath == null || downloading) return;
    setDownloading(true);
    setDownloadFailed(false);
    try {
      await downloadExplorerFile(workspaceId, filePath);
    } catch {
      setDownloadFailed(true);
    } finally {
      setDownloading(false);
    }
  }, [workspaceId, filePath, downloading]);

  // 未选中文件：空态占位（不发起任何请求）
  if (filePath == null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 py-12">
        <FileOutlined className="text-2xl text-muted-foreground" />
        <Text type="secondary" className="text-xs">
          在左侧选择文件查看内容
        </Text>
      </div>
    );
  }

  if (query.isPending) {
    return (
      <div className="flex h-full items-center justify-center py-12">
        <Spin />
      </div>
    );
  }

  if (query.isError) {
    return (
      <Alert
        type="error"
        showIcon
        className="m-3"
        title={query.error?.message ?? "文件加载失败，请重试"}
      />
    );
  }

  const data = query.data;
  if (!data) return null;

  const name = data.name || filePath.split(/[\\/]/).filter(Boolean).pop() || filePath;
  const ext = fileExtension(name);
  const isImage = IMAGE_EXTENSIONS.has(ext);
  const isMarkdown = MARKDOWN_EXTENSIONS.has(ext);
  const language = CODE_LANGUAGES[ext];

  // 内容区分发（图片优先于 binary 判定：图片文件 binary=true 但可内联渲染）
  let body: ReactNode;
  if (isImage) {
    body = <ImagePreview workspaceId={workspaceId} filePath={filePath} name={name} />;
  } else if (data.binary) {
    body = <BinaryMetaCard name={name} size={data.size} mtime={data.mtime} />;
  } else if (isMarkdown) {
    body = <MarkdownText content={data.content} size="reading" />;
  } else if (language) {
    body = (
      <SyntaxHighlighter
        language={language}
        style={oneDark}
        customStyle={{ margin: 0, borderRadius: 6, fontSize: 12 }}
      >
        {data.content}
      </SyntaxHighlighter>
    );
  } else {
    // 纯文本与代码高亮分支统一「不软折行 + 横向滚动」语义（ql-20260818-010-f551），
    // 避免长行代码被 wrap 折得难读；容器 overflow-auto 提供横向滚动。
    body = (
      <pre className="overflow-auto rounded-md bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre">
        {data.content}
      </pre>
    );
  }

  // 截断警示仅对实际渲染文本内容的分支展示（图片/二进制不渲染 content，无截断可言）
  const showTruncatedTip = data.truncated && !data.binary && !isImage;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none items-center gap-2 border-b border-border px-3 py-2">
        <FileOutlined className="flex-none text-muted-foreground" />
        <span className="min-w-0 truncate text-xs font-medium text-foreground" title={name}>
          {name}
        </span>
        <span className="flex-none text-[11px] text-muted-foreground">
          {formatFileSize(data.size)} · 修改于 {new Date(data.mtime).toLocaleString("zh-CN")}
        </span>
        {downloadFailed && (
          <span className="flex-none text-[11px] text-red-500">下载失败，请重试</span>
        )}
        <Button
          className="ml-auto flex-none"
          size="small"
          icon={<DownloadOutlined />}
          loading={downloading}
          onClick={() => void handleDownload()}
        >
          下载
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {showTruncatedTip && (
          <Alert
            type="warning"
            showIcon
            className="mb-2"
            title="文件超过 10MB，仅显示前 10MB，完整内容请下载查看"
          />
        )}
        {body}
      </div>
    </div>
  );
}

export default FilePreview;

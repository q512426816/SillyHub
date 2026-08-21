"use client";

/**
 * FileNodeIcon · 按扩展名分型的文件/目录节点图标（树、列表等场景通用）。
 *
 * 从 explorer file-explorer.tsx 抽离（ql-20260821-013-2c1a），映射表与配色承接
 * ql-20260821-008（媒体/文档分型）+ ql-20260821-012（开发语言细分）：
 * - 常见开发语言各自独立形状+配色（Java 咖啡 / Vue 三角 / React 原子 / Python f(x) /
 *   Go 六边形 / .NET 系积木紫等，详见 FILE_ICON_BY_EXT）
 * - 其余代码/脚本/配置类回退 CODE_ICON（FileCode2 琥珀）
 * - 未匹配扩展名回退 DEFAULT_ICON（FileText 主题灰）；目录固定 Folder 主题灰
 *
 * 配色用固定 tailwind 信息色阶（非品牌色，双主题下均可读）。
 */

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
  FunctionSquare,
  Gem,
  Globe,
  Hexagon,
  Palette,
  Triangle,
  type LucideIcon,
} from "lucide-react";

/** 文件图标规格：lucide 图标 + 信息色。 */
export interface FileIconSpec {
  icon: LucideIcon;
  className: string;
}

/** 代码/脚本类：FileCode2 + 琥珀（未单列语言的兜底）。 */
export const CODE_ICON: FileIconSpec = { icon: FileCode2, className: "text-amber-500" };
/** 默认/纯文本类：FileText + 主题灰（未匹配扩展名的回退）。 */
export const DEFAULT_ICON: FileIconSpec = { icon: FileText, className: "text-muted-foreground" };

/** 扩展名 → 图标规格。未命中扩展名回退 DEFAULT_ICON（FileText 灰）。
 *  常见开发语言各自独立图标+配色（ql-20260821-012-22b0），其余语言回退 CODE_ICON。 */
export const FILE_ICON_BY_EXT: Record<string, FileIconSpec> = {
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
export function fileExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** 文件图标规格（按扩展名）。 */
export function fileIconSpec(name: string): FileIconSpec {
  return FILE_ICON_BY_EXT[fileExt(name)] ?? DEFAULT_ICON;
}

/** 文件/目录节点图标：目录 Folder 主题灰；文件按扩展名分型配色。
 *  size 形如 "h-4 w-4"（lucide 尺寸类）。 */
export function FileNodeIcon({
  name,
  type,
  size = "h-4 w-4",
}: {
  name: string;
  type: "dir" | "file";
  size?: string;
}) {
  if (type === "dir") {
    return <Folder className={`${size} shrink-0 text-muted-foreground`} />;
  }
  const spec = fileIconSpec(name);
  return <spec.icon className={`${size} shrink-0 ${spec.className}`} />;
}

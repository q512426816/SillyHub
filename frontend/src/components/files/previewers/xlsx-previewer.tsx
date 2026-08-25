"use client";

/**
 * XlsxPreviewer — Excel（xlsx）渲染器。
 *
 * 动态 import xlsx（SheetJS），read 解析 workbook → sheet_to_html 渲染表格。
 * 多 sheet 支持 tab 切换；单表超 2000 行截断 + 提示完整内容请下载（R-03）。
 * 仅支持 OOXML（xlsx）。统一消费 PreviewerProps。
 */

import { useEffect, useState } from "react";
import { DownloadOutlined } from "@ant-design/icons";

import { formatFileSize } from "@/lib/file/utils";
import type { PreviewerProps } from "./index";

const MAX_ROWS = 2000;

export function XlsxPreviewer({ blob, meta, onDownload }: PreviewerProps) {
  const [activeSheet, setActiveSheet] = useState(0);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const [sheetData, setSheetData] = useState<{
    names: string[];
    htmls: string[];
    truncated: boolean[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);

    (async () => {
      try {
        const xlsx = await import("xlsx");
        const arrayBuffer = await blob.arrayBuffer();
        const workbook = xlsx.read(arrayBuffer, { type: "array" });

        if (cancelled) return;

        const names = workbook.SheetNames;
        const htmls: string[] = [];
        const truncated: boolean[] = [];

        for (const name of names) {
          const ws = workbook.Sheets[name];
          if (!ws) continue;
          // sheet_to_html 默认会输出完整 HTML 表格
          let html = xlsx.utils.sheet_to_html(ws, { header: "", footer: "" });

          // 2000 行截断保护（R-03）：简单计数 <tr> 数量
          const trCount = (html.match(/<tr>/g) ?? []).length;
          if (trCount > MAX_ROWS) {
            // 截断到前 MAX_ROWS 行
            const rows = html.split(/<\/tr>/);
            html = rows.slice(0, MAX_ROWS).join("</tr>") + "</tr></tbody></table>";
            truncated.push(true);
          } else {
            truncated.push(false);
          }
          htmls.push(html);
        }

        if (!cancelled) {
          setSheetData({ names, htmls, truncated });
          setStatus("ok");
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "解析失败");
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [blob]);

  if (status === "loading") {
    return (
      <div className="flex min-h-[420px] items-center justify-center p-8 text-slate-500">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
        <span className="ml-3">正在解析 Excel 文档…</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-sm font-semibold text-slate-700">Excel 文档解析失败</p>
        <p className="max-w-md text-xs text-slate-500">{error}</p>
        {onDownload && (
          <button
            type="button"
            onClick={onDownload}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            <DownloadOutlined />
            下载文件（{formatFileSize(meta.size ?? 0)}）
          </button>
        )}
      </div>
    );
  }

  if (!sheetData) return null;

  return (
    <div className="min-h-[420px] w-full overflow-auto">
      {/* Sheet 切换 */}
      {sheetData.names.length > 1 && (
        <div className="flex gap-1 border-b border-border bg-slate-50 px-4 pt-3">
          {sheetData.names.map((name, i) => (
            <button
              key={name}
              type="button"
              onClick={() => setActiveSheet(i)}
              className={`rounded-t-md px-4 py-2 text-xs font-medium transition-colors ${
                i === activeSheet
                  ? "border border-b-0 border-border bg-white text-slate-800"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* 截断提示 */}
      {sheetData.truncated[activeSheet] && (
        <div className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs text-warning-foreground">
          ⚠️ 该工作表数据量较大，仅显示前 {MAX_ROWS} 行。完整内容请下载后查看。
        </div>
      )}

      {/* 表格内容 */}
      <div
        className="p-4 [&_td]:border [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-1.5 [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-1.5 [&_table]:w-full [&_table]:border-collapse"
        dangerouslySetInnerHTML={{ __html: sheetData.htmls[activeSheet] ?? "" }}
      />
    </div>
  );
}

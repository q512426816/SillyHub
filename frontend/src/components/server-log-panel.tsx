"use client";

/**
 * 服务器日志卡（2026-10-15-server-logs-panel task-03 / D-002@v1 / D-005@v1）。
 *
 * 挂在服务器信息页（/admin/server-status）满宽置底：
 * - 卡内独立 5s 轮询 getServerLogs（与页面既有 system-status 轮询并行，端点不同无竞态）；
 * - 行数切换 {100,200,500,1000}（默认 200，切换立即拉取）；
 * - 日志行级别着色（info 青 / warn 琥珀 / error 红 / debug 灰——语义色阶，
 *   对齐 agent-log-viewer 既有惯例）；点行展开原始 JSON；
 * - 下载区：文件下拉（数据源响应 available_files）+ 下载按钮（fetch Blob 经鉴权）；
 * - 失败降级：卡内独立错误条，保留上一帧数据不清空；D-005@v1 固定安全提示。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Segmented, Select } from "antd";
import { DownloadOutlined } from "@ant-design/icons";

import { SectionCard } from "@/components/layout";
import { downloadLogFile, getServerLogs, type LogEntry, type ServerLogsResponse } from "@/lib/health";

const REFRESH_INTERVAL_MS = 5000;
const LINE_OPTIONS = [100, 200, 500, 1000] as const;
const DEFAULT_LINES = 200;

/** 级别 → 行样式（语义色阶，对齐 agent-log-viewer.semanticLineClass 惯例）。 */
function levelClass(level: string | null | undefined): string {
  switch ((level ?? "").toLowerCase()) {
    case "error":
      return "bg-red-50 text-red-700";
    case "warning":
    case "warn":
      return "bg-amber-50 text-amber-700";
    case "debug":
      return "bg-zinc-100 text-zinc-500";
    default:
      return "bg-sky-50 text-sky-700";
  }
}

/** fields 摘要（k=v 逗号拼接，超 120 字符截断）。 */
function fieldsSummary(fields: Record<string, unknown> | undefined): string {
  if (!fields) return "";
  const parts = Object.entries(fields).map(([k, v]) => `${k}=${String(v)}`);
  const text = parts.join(" ");
  return text.length > 120 ? text.slice(0, 120) + "…" : text;
}

function displayTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("zh-CN", { hour12: false });
}

/** 原始行（展开视图）：parse_error 行显示原文，解析成功行重组 JSON。 */
function rawText(entry: LogEntry): string {
  if (entry.raw) return entry.raw;
  return JSON.stringify(
    {
      event: entry.event,
      level: entry.level,
      timestamp: entry.time,
      ...(entry.fields ?? {}),
    },
    null,
    2,
  );
}

function LogRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: LogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onToggle();
      }}
      className="cursor-pointer border-b px-2.5 py-1 text-xs last:border-b-0 hover:bg-brand-50"
    >
      <div className="grid grid-cols-[150px_58px_1fr] items-baseline gap-2">
        <span className="text-muted-foreground tabular-nums">
          {displayTime(entry.time)}
        </span>
        <span
          className={`rounded px-1.5 py-px text-center text-[10px] font-bold uppercase ${levelClass(entry.level)}`}
        >
          {entry.parse_error ? "RAW" : (entry.level ?? "—")}
        </span>
        <span className="min-w-0">
          <span className="font-semibold">
            {entry.parse_error ? entry.raw : entry.event}
          </span>
          {!entry.parse_error && entry.fields && Object.keys(entry.fields).length > 0 && (
            <span className="ml-1.5 text-[11px] text-muted-foreground">
              {fieldsSummary(entry.fields)}
            </span>
          )}
        </span>
      </div>
      {expanded && (
        <pre className="mt-1 overflow-x-auto rounded bg-brand-50 p-2 font-mono text-[11px] whitespace-pre">
          {rawText(entry)}
        </pre>
      )}
    </div>
  );
}

export default function ServerLogPanel() {
  const [lines, setLines] = useState<number>(DEFAULT_LINES);
  const [data, setData] = useState<ServerLogsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [file, setFile] = useState<string>("backend.log");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(
    async (n: number) => {
      try {
        const next = await getServerLogs(n);
        setData(next);
        setError(null);
      } catch (err) {
        // 失败保留上一帧数据（不清空），卡内提示
        setError(err instanceof Error ? err.message : "日志获取失败");
      }
    },
    [],
  );

  useEffect(() => {
    void refresh(lines);
    timerRef.current = setInterval(() => void refresh(lines), REFRESH_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [lines, refresh]);

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadLogFile(file);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "日志下载失败");
    } finally {
      setDownloading(false);
    }
  };

  const files = data?.available_files ?? [];
  const fileOptions = files.length
    ? files.map((f) => ({ value: f.name, label: f.name }))
    : [{ value: "backend.log", label: "backend.log" }];

  return (
    <SectionCard
      title="服务器日志"
      className="lg:col-span-2"
      extra={
        <span className="text-[11px] text-muted-foreground">
          {data?.file ? `${data.file} · ` : ""}每 5 秒自动刷新
        </span>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          size="small"
          value={lines}
          options={LINE_OPTIONS.map((n) => ({ value: n, label: `${n} 行` }))}
          onChange={(v) => {
            setLines(Number(v));
            setExpandedIndex(null);
          }}
        />
        <span className="flex-1" />
        <Select
          size="small"
          value={file}
          onChange={(v) => setFile(v)}
          options={fileOptions}
          style={{ minWidth: 150 }}
        />
        <Button
          size="small"
          icon={<DownloadOutlined />}
          loading={downloading}
          onClick={() => void handleDownload()}
        >
          下载
        </Button>
      </div>

      <p className="mt-2 text-[11px] text-amber-700">
        ⚠ 日志含运行路径与账号信息，请勿外传
      </p>
      {error && (
        <Alert
          type="error"
          showIcon
          title="日志获取失败"
          description={`${error}——将自动重试`}
          className="mt-2"
        />
      )}
      {downloadError && (
        <Alert
          type="error"
          showIcon
          title="日志下载失败"
          description={downloadError}
          className="mt-2"
        />
      )}

      <div className="mt-2 max-h-[380px] overflow-y-auto rounded-lg border bg-card">
        {data && data.entries.length > 0 ? (
          data.entries.map((entry, i) => (
            <LogRow
              key={`${i}-${entry.time ?? ""}-${entry.event ?? entry.raw ?? ""}`}
              entry={entry}
              expanded={expandedIndex === i}
              onToggle={() => setExpandedIndex((cur) => (cur === i ? null : i))}
            />
          ))
        ) : (
          <p className="py-8 text-center text-xs text-muted-foreground">
            {error ? "暂无日志数据" : (data?.hint ?? "加载中…")}
          </p>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          {data
            ? `显示最近 ${data.returned} 行（文件共 ${data.total_lines} 行）`
            : "加载中…"}
        </span>
        <span>点日志行可展开原始内容</span>
      </div>
    </SectionCard>
  );
}

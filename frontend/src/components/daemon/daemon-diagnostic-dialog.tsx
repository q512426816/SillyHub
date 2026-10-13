"use client";

/**
 * daemon 诊断弹窗（2026-10-13-daemon-log-config-view task-03 / FR-01~08）。
 *
 * 机器卡「日志」「配置」入口打开的只读双 Tab 弹窗（antd Modal + Tabs）：
 * - 日志 Tab：daemon.log 尾部行（Select 100/500/2000 + 刷新 + 下载片段 +
 *   路径/大小/修改时间元信息 + 等宽滚动区自动滚底；truncated 提示截断）。
 * - 配置 Tab：生效配置 JSON（只读标注 + 掩码字段高亮 +「显示明文」切换触发
 *   reveal 二次拉取 + 下载按钮）。
 *
 * 关键决策落点：下载恒脱敏（D-007——无论明暗态，下载内容永远取 reveal=false
 * 的掩码数据，不复用明文 state）；默认打开不请求 reveal=true（默认路径不传
 * 明文，D-001@v2）；五类边界态提示条（422 版本过旧 / exists:false 前台运行
 * / truncated / 离线 504 / 其余 ApiError 通用错误）。原型对照
 * prototype-daemon-log-config-view.html。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Modal, Select, Spin, Tabs, Tag, Tooltip } from "antd";
import { Download, EyeOff, Eye, RefreshCw } from "lucide-react";
import type { DaemonMachineRead } from "@/lib/daemon/machines";
import {
  fetchMachineConfig,
  fetchMachineLogTail,
  type DaemonConfigResponse,
  type DaemonLogTailResponse,
} from "@/lib/daemon/machines";
import { ApiError } from "@/lib/api";

export type DiagnosticTab = "logs" | "config";

export interface DaemonDiagnosticDialogProps {
  machine: DaemonMachineRead;
  initialTab: DiagnosticTab;
  onClose: () => void;
}

/** 弹窗内错误分类：422 = 老 daemon 未升级（升级提示），其余通用错误条。 */
function classifyError(e: unknown): { kind: "unsupported" | "error"; message: string } {
  if (
    e instanceof ApiError &&
    (e.status === 422 || e.code === "HTTP_422_DAEMON_DIAG_UNSUPPORTED")
  ) {
    return { kind: "unsupported", message: e.message };
  }
  return { kind: "error", message: e instanceof Error ? e.message : String(e) };
}

/** Blob 下载（先例 frontend/src/lib/explorer.ts:105-109）。 */
function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(objectUrl);
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function DaemonDiagnosticDialog({
  machine,
  initialTab,
  onClose,
}: DaemonDiagnosticDialogProps) {
  const machineLabel = machine.display_alias ?? machine.hostname;
  const [tab, setTab] = useState<DiagnosticTab>(initialTab);

  // ── 日志 Tab 状态 ──────────────────────────────────────────────────────────
  const [tailLines, setTailLines] = useState(500);
  const [logData, setLogData] = useState<DaemonLogTailResponse | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<{ kind: "unsupported" | "error"; message: string } | null>(
    null,
  );
  const logBoxRef = useRef<HTMLDivElement | null>(null);

  // ── 配置 Tab 状态 ──────────────────────────────────────────────────────────
  // maskedCfg 恒为 reveal=false 数据（下载恒用它，D-007）；revealed 时另拉明文展示。
  const [maskedCfg, setMaskedCfg] = useState<DaemonConfigResponse | null>(null);
  const [displayCfg, setDisplayCfg] = useState<DaemonConfigResponse | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [cfgLoading, setCfgLoading] = useState(false);
  const [cfgError, setCfgError] = useState<{ kind: "unsupported" | "error"; message: string } | null>(
    null,
  );

  const loadLogs = useCallback(
    async (tail: number) => {
      setLogLoading(true);
      setLogError(null);
      try {
        setLogData(await fetchMachineLogTail(machine.id, tail));
      } catch (e) {
        setLogData(null);
        setLogError(classifyError(e));
      } finally {
        setLogLoading(false);
      }
    },
    [machine.id],
  );

  const loadConfig = useCallback(
    async (reveal: boolean) => {
      setCfgLoading(true);
      setCfgError(null);
      try {
        const data = await fetchMachineConfig(machine.id, reveal);
        if (reveal) {
          setDisplayCfg(data);
        } else {
          setMaskedCfg(data);
          setDisplayCfg(data);
        }
      } catch (e) {
        setCfgError(classifyError(e));
      } finally {
        setCfgLoading(false);
      }
    },
    [machine.id],
  );

  // 打开时按初始 Tab 拉取；Tab 首次切到另一侧时补拉（未加载过才拉）。
  useEffect(() => {
    if (tab === "logs" && logData === null && !logLoading && logError === null) {
      void loadLogs(tailLines);
    }
  }, [tab, logData, logLoading, logError, loadLogs, tailLines]);

  useEffect(() => {
    if (tab === "config" && maskedCfg === null && !cfgLoading && cfgError === null) {
      void loadConfig(false);
    }
  }, [tab, maskedCfg, cfgLoading, cfgError, loadConfig]);

  // 日志到达后自动滚到底部（看最新日志，design §Phase 3）。
  useEffect(() => {
    if (tab === "logs" && logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [tab, logData, logLoading]);

  const handleToggleReveal = () => {
    if (revealed) {
      // 恢复掩码：直接用已缓存的掩码数据（不重拉——数据未变）。
      setRevealed(false);
      if (maskedCfg) setDisplayCfg(maskedCfg);
    } else {
      setRevealed(true);
      void loadConfig(true);
    }
  };

  const handleDownloadLog = () => {
    if (!logData) return;
    downloadText(
      `daemon-${machineLabel}-tail-${tailLines}.log`,
      logData.lines.join("\n"),
    );
  };

  const handleDownloadConfig = () => {
    // D-007 下载恒脱敏：永远取 reveal=false 的掩码数据（明文态下载也脱敏）。
    if (!maskedCfg) return;
    downloadText(
      `daemon-${machineLabel}-config.json`,
      JSON.stringify(maskedCfg.config, null, 2),
    );
  };

  // ── 渲染辅助 ───────────────────────────────────────────────────────────────
  const unsupportedAlert = (
    <Alert
      type="warning"
      showIcon
      message="daemon 版本过旧，暂不支持在线查看"
      description="请先在机器卡点击「升级 daemon」，升级完成后再打开本页查看。"
      className="mb-3"
    />
  );

  const logsPane = (
    <div>
      {logError?.kind === "unsupported" ? unsupportedAlert : null}
      {logError?.kind === "error" ? (
        <Alert
          type="error"
          showIcon
          message="日志拉取失败"
          description={logError.message}
          className="mb-3"
        />
      ) : null}
      {!logError && logData && !logData.exists ? (
        <Alert
          type="warning"
          showIcon
          message="daemon.log 不存在"
          description="前台（终端）运行模式不落盘日志；请以后台模式运行（sillyhub-daemon start 或自启），或在本机执行 sillyhub-daemon logs 查看。"
          className="mb-3"
        />
      ) : null}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">尾部行数</span>
        <Select
          size="small"
          value={tailLines}
          onChange={(v) => {
            setTailLines(v);
            void loadLogs(v);
          }}
          options={[100, 500, 2000].map((n) => ({ value: n, label: `${n}` }))}
          style={{ width: 90 }}
          aria-label="尾部行数"
        />
        <Button
          size="small"
          icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}
          onClick={() => void loadLogs(tailLines)}
          disabled={logLoading}
        >
          刷新
        </Button>
        <span className="flex-1" />
        <Button
          size="small"
          icon={<Download className="h-3.5 w-3.5" aria-hidden />}
          onClick={handleDownloadLog}
          disabled={!logData || !logData.exists || logData.lines.length === 0}
        >
          下载日志片段
        </Button>
      </div>
      {logData?.exists ? (
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 rounded-md border bg-muted/40 px-3 py-1.5 font-mono text-xs text-muted-foreground">
          <span>
            路径 <span className="text-foreground">{logData.path}</span>
          </span>
          <span>
            大小 <span className="text-foreground">{formatBytes(logData.size)}</span>
          </span>
          <span>
            最后修改 <span className="text-foreground">{logData.mtime || "—"}</span>
          </span>
          <span>
            展示 <span className="text-foreground">{logData.line_count}</span> 行
          </span>
        </div>
      ) : null}
      {logData?.truncated ? (
        <Alert
          type="info"
          showIcon
          message={`日志文件较大，仅展示末尾 256KB 内的 ${logData.line_count} 行（已按字节上限截断）。`}
          className="mb-2"
        />
      ) : null}
      <Spin spinning={logLoading}>
        <div
          ref={logBoxRef}
          className="max-h-[420px] overflow-auto rounded-md border bg-zinc-950 px-3 py-2 font-mono text-xs leading-relaxed text-zinc-200"
          aria-label="daemon 日志内容"
        >
          {logData?.exists
            ? logData.lines.map((l, i) => (
                <div key={i} className="whitespace-pre-wrap break-all">
                  {l || "\u00A0"}
                </div>
              ))
            : !logLoading && !logError
              ? "—"
              : null}
        </div>
      </Spin>
    </div>
  );

  const configPane = (
    <div>
      {cfgError?.kind === "unsupported" ? unsupportedAlert : null}
      {cfgError?.kind === "error" ? (
        <Alert
          type="error"
          showIcon
          message="配置拉取失败"
          description={cfgError.message}
          className="mb-3"
        />
      ) : null}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Tooltip title="切换明文会向 daemon 重新拉取（reveal=true）；下载内容始终为脱敏 JSON">
          <Button
            size="small"
            icon={
              revealed ? (
                <EyeOff className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Eye className="h-3.5 w-3.5" aria-hidden />
              )
            }
            onClick={handleToggleReveal}
            disabled={cfgLoading || cfgError !== null}
          >
            {revealed ? "隐藏明文" : "显示明文"}
          </Button>
        </Tooltip>
        <span className="flex-1" />
        <Button
          size="small"
          icon={<Download className="h-3.5 w-3.5" aria-hidden />}
          onClick={handleDownloadConfig}
          disabled={!maskedCfg}
        >
          下载配置（始终脱敏）
        </Button>
      </div>
      {displayCfg ? (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            配置文件 <span className="font-mono text-foreground">{displayCfg.path}</span>
          </span>
          <Tag color="cyan" className="m-0">
            只读
          </Tag>
          {revealed ? (
            <span className="text-warning">明文展示中——请勿截图外发</span>
          ) : displayCfg.masked_fields.length > 0 ? (
            <span>已隐藏字段：{displayCfg.masked_fields.join(" / ")}</span>
          ) : null}
        </div>
      ) : null}
      <Spin spinning={cfgLoading}>
        <div
          className="max-h-[420px] overflow-auto rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs leading-relaxed"
          aria-label="daemon 配置内容"
        >
          {displayCfg
            ? JSON.stringify(displayCfg.config, null, 2)
                .split("\n")
                .map((l, i) => {
                  const isMasked = displayCfg.masked_fields.some((f) => l.includes(`"${f}"`));
                  return (
                    <div
                      key={i}
                      className={
                        isMasked
                          ? "rounded bg-warning/15 px-1 text-amber-700 dark:text-amber-400"
                          : "whitespace-pre-wrap"
                      }
                    >
                      {l}
                    </div>
                  );
                })
            : !cfgLoading && !cfgError
              ? "—"
              : null}
        </div>
      </Spin>
    </div>
  );

  return (
    <Modal
      title={`daemon 诊断 — ${machineLabel}`}
      open
      onCancel={onClose}
      footer={null}
      width={880}
      destroyOnClose
    >
      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as DiagnosticTab)}
        items={[
          { key: "logs", label: "日志", children: logsPane },
          { key: "config", label: "配置", children: configPane },
        ]}
      />
    </Modal>
  );
}

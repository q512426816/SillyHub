"use client";

/**
 * McpDiagnosticsPanel — 注入诊断面板（变更 2026-09-10-mcp-central-registry
 * / task-12 / FR-08 / D-011，照原型 ④ 诊断面板段）。
 *
 * backend 渲染预检五项（GET /api/mcp-servers/diagnostics，admin 视图）：
 * decrypt_failed / invalid_type_defensive = 错误（红）；
 * bound_but_disabled / platform_name_shadow = 警告（琥珀）；
 * workspace_blocked_by_whitelist = 信息（青）。文案与处置建议前端静态映射，
 * 语义一律以接口返回的 server_name/detail 为准（前端只展示不推断）。
 */
import { Alert, Button, Empty, Spin } from "antd";

import { errMessage } from "@/lib/errors";
import {
  useMcpDiagnostics,
  type McpDiagnosticCode,
} from "@/lib/api/mcp-registry";

export interface McpDiagnosticsPanelProps {
  open: boolean;
  onClose: () => void;
}

/** 诊断码 → 级别与文案（对齐原型 .lv-err/.lv-warn/.lv-info）。 */
const DIAGNOSTIC_META: Record<
  McpDiagnosticCode,
  { level: "error" | "warning" | "info"; title: string; hint: string }
> = {
  decrypt_failed: {
    level: "error",
    title: "解密失败",
    hint: "密钥轮换后失配：该 server 渲染时降级为无 secret 形态。去编辑页重新保存密钥即可。",
  },
  bound_but_disabled: {
    level: "warning",
    title: "绑定未启用",
    hint: "有平台绑定但 enabled=false——配置了却没生效，确认是否有意为之。",
  },
  platform_name_shadow: {
    level: "warning",
    title: "同名遮蔽",
    hint: "workspace 的 .mcp.json 里存在同名 server——三层合并时 workspace 优先，平台库这份配置实际没生效。建议改名或删除 workspace 里那份。",
  },
  workspace_blocked_by_whitelist: {
    level: "info",
    title: "白名单拦截",
    hint: "workspace 的 .mcp.json 中 server 不在白名单 mcp.whitelist 内，注入时会被剔除。需要时把 server 名加入白名单。",
  },
  invalid_type_defensive: {
    level: "error",
    title: "类型非法（防御）",
    hint: "非 stdio 定义混入平台位会导致整包回落——写路径已限制 stdio，此项应为空；出现说明有历史脏数据。",
  },
};

const LEVEL_CLASS: Record<"error" | "warning" | "info", string> = {
  error: "border-red-200 bg-red-50 text-red-700",
  warning: "border-amber-300 bg-amber-50 text-amber-800",
  info: "border-cyan-300 bg-cyan-50 text-cyan-800",
};

export function McpDiagnosticsPanel({ open, onClose }: McpDiagnosticsPanelProps) {
  const { diagnostics, isLoading, isFetching, isError, error, refetch } =
    useMcpDiagnostics(open);

  return (
    <div data-testid="mcp-diagnostics-panel">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">注入诊断（渲染预检）</h3>
        <div className="flex items-center gap-2">
          {isFetching && !isLoading && <Spin size="small" />}
          <Button size="small" onClick={() => void refetch()} disabled={isFetching}>
            刷新
          </Button>
          <Button size="small" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-10 text-center">
          <Spin />
        </div>
      ) : isError ? (
        <Alert type="error" showIcon message={errMessage(error, "诊断加载失败")} />
      ) : diagnostics.length === 0 ? (
        <Empty className="py-8" description="注入集健康——没有需要关注的诊断项" />
      ) : (
        <div className="space-y-2">
          {diagnostics.map((d, i) => {
            const meta = DIAGNOSTIC_META[d.code];
            return (
              <div
                key={`${d.code}:${d.server_id ?? d.server_name ?? i}`}
                className={`flex items-start gap-3 rounded-md border px-3 py-2 ${LEVEL_CLASS[meta.level]}`}
                data-testid="mcp-diagnostic-item"
              >
                <span className="mt-0.5 shrink-0 rounded border border-current/30 px-1.5 py-0.5 text-xs font-semibold">
                  {meta.title}
                </span>
                <div className="min-w-0 text-xs leading-5">
                  <span className="font-medium">
                    {d.code === "workspace_blocked_by_whitelist"
                      ? d.detail || meta.title
                      : `${d.code} · ${d.server_name ?? "—"}`}
                  </span>
                  <p className="mt-0.5 opacity-80">{d.detail || meta.hint}</p>
                  <p className="mt-0.5 opacity-60">{meta.hint}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

"use client";

/**
 * McpServerCard — MCP 资产库单个 server 卡片（变更 2026-09-10-mcp-central-registry
 * / task-11，照原型 prototype-mcp-central-registry.html ③ 管理页段）。
 *
 * 结构（原型 .mcp-card）：
 * - 头部：名称 + 「stdio」类型徽标 + 归属徽标（平台默认=platform binding /
 *   我的私有=owner 是当前用户）+ 诊断徽标（diagnostic_codes 非空时 ⚠ + Tooltip）；
 * - cmd 单行：command + args 一行展示（截断省略）；
 * - meta 行：标签 chips（#tag）+ 「🔒 N 个密钥」加密提示（secret 键计数）；
 * - 底部：「对我启用」开关（user binding，FR-03）+ 操作按钮（admin 平台库 tab
 *   额外有「设为平台默认/取消平台默认」platform binding 开关；编辑/复制/存模板/
 *   删除——非 admin 平台库只读不渲染操作区，D-001 双层可见性）。
 *
 * 组件纯展示 + 回调上抛：mutation（binding/删除等）由页面层持有，本卡片不
 * 直接发请求（对齐 agent-profile-card.tsx 先例）。
 *
 * 样式：FRONTEND_PAGE_STYLE.md §0.5 主题铁律——tailwind 布局 + brand-* 语义阶
 * + antd Tag/Switch/Button（组件色走 antd 预设，不手写 hex）。
 */
import { Button, Switch, Tag, Tooltip } from "antd";
import { Copy, Pencil, Star, Trash2 } from "lucide-react";

import {
  countSecretEnvKeys,
  formatCmdLine,
  isSecretEnvKey,
  type McpServerRead,
} from "@/lib/api/mcp-registry";
import { cn } from "@/lib/utils";

/** 诊断 code → 人读标签（D-011 五项；未知 code 兜底显示原码）。 */
const DIAGNOSTIC_LABELS: Record<string, string> = {
  decrypt_failed: "解密失败",
  bound_but_disabled: "绑定未启用",
  platform_name_shadow: "同名遮蔽",
  workspace_blocked_by_whitelist: "白名单拒绝",
  invalid_type_defensive: "类型非法",
};

export interface McpServerCardProps {
  /** 列表行（env secret 已被后端遮蔽）。 */
  server: McpServerRead;
  /** 当前 tab 语境：platform=平台共享库（非 admin 只读）/ mine=我的库。 */
  scopeTab: "platform" | "mine";
  /** 平台管理员判定（平台库写 + platform binding 需要）。 */
  isAdmin: boolean;
  /** 「对我启用」开关回调（user binding 加/解绑）。 */
  onToggleUserBinding: (server: McpServerRead, enabled: boolean) => void;
  /** 「设为平台默认」回调（platform binding 加/解绑，仅 admin 平台库 tab 渲染入口）。 */
  onTogglePlatformBinding: (server: McpServerRead, enabled: boolean) => void;
  onEdit: (server: McpServerRead) => void;
  onCopy: (server: McpServerRead) => void;
  /** 存为模板（POST /templates，task-10 后端落地前 501 由页面 toast 透出）。 */
  onSaveTemplate: (server: McpServerRead) => void;
  onDelete: (server: McpServerRead) => void;
  /** binding mutation 进行中（开关禁用防连点）。 */
  bindingPending?: boolean;
}

export function McpServerCard({
  server,
  scopeTab,
  isAdmin,
  onToggleUserBinding,
  onTogglePlatformBinding,
  onEdit,
  onCopy,
  onSaveTemplate,
  onDelete,
  bindingPending = false,
}: McpServerCardProps) {
  const isMine = server.owner_user_id !== null;
  const secretCount = countSecretEnvKeys(server.server_config);
  const secretKeyNames = Object.keys(
    (server.server_config?.env as Record<string, unknown> | undefined) ?? {},
  ).filter(isSecretEnvKey);
  const canManage = scopeTab === "mine" || isAdmin;

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border bg-card p-4 shadow-sm transition-colors",
        canManage ? "hover:border-brand-300" : "border-dashed",
      )}
      data-testid={`mcp-server-card-${server.name}`}
    >
      {/* 头部：名称 + 徽标组 */}
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-foreground">{server.name}</span>
        <Tag className="m-0">stdio</Tag>
        {server.platform_bound && <Tag color="purple">平台默认</Tag>}
        {isMine && <Tag color="cyan">我的私有</Tag>}
        {!server.enabled && <Tag color="warning">已停用</Tag>}
        {server.diagnostic_codes.length > 0 && (
          <Tooltip
            title={server.diagnostic_codes
              .map((c) => DIAGNOSTIC_LABELS[c] ?? c)
              .join(" / ")}
          >
            <Tag color="warning" className="m-0 cursor-help">
              ⚠ {server.diagnostic_codes.length}
            </Tag>
          </Tooltip>
        )}
      </div>

      {/* cmd 单行（command + args，截断省略） */}
      <div
        className="my-1.5 overflow-hidden truncate rounded bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground"
        title={formatCmdLine(server.server_config)}
      >
        {formatCmdLine(server.server_config)}
      </div>

      {/* meta：标签 chips + 加密密钥提示 */}
      <div className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground">
        {server.tags.map((t) => (
          <span key={t} className="text-brand-600">
            #{t}
          </span>
        ))}
        <Tooltip
          title={
            secretKeyNames.length > 0
              ? `已加密：${secretKeyNames.join(" / ")}（仅 daemon 注入链解密）`
              : "无加密密钥"
          }
        >
          <span className="cursor-help">
            🔒{" "}
            {secretCount > 0
              ? `${secretCount} 个密钥已加密`
              : "0 个密钥"}
          </span>
        </Tooltip>
      </div>

      {/* 底部：对我启用开关 + 操作区 */}
      <div className="mt-auto flex items-center justify-between gap-2 border-t pt-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Switch
            size="small"
            checked={server.user_bound}
            disabled={bindingPending}
            onChange={(checked) => onToggleUserBinding(server, checked)}
            aria-label={`对我启用 ${server.name}`}
          />
          <span>对我启用</span>
        </div>
        {canManage && (
          <div className="flex items-center gap-1">
            {scopeTab === "platform" && isAdmin && (
              <Button
                size="small"
                onClick={() =>
                  onTogglePlatformBinding(server, !server.platform_bound)
                }
                disabled={bindingPending}
              >
                {server.platform_bound ? "取消平台默认" : "设为平台默认"}
              </Button>
            )}
            <Button
              type="text"
              size="small"
              onClick={() => onEdit(server)}
              aria-label={`编辑 ${server.name}`}
              title="编辑"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="text"
              size="small"
              onClick={() => onCopy(server)}
              aria-label={`复制 ${server.name}`}
              title="复制为新 server"
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="text"
              size="small"
              onClick={() => onSaveTemplate(server)}
              aria-label={`存为模板 ${server.name}`}
              title="存为模板"
            >
              <Star className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="text"
              size="small"
              danger
              onClick={() => onDelete(server)}
              aria-label={`删除 ${server.name}`}
              title="删除"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

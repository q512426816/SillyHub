"use client";

import Link from "next/link";
import { Import, Pencil, Plug } from "lucide-react";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Tag } from "antd";
import { z } from "zod";

import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { StatusBadge } from "@/components/ui/status-badge";
import { apiFetch } from "@/lib/api";
import {
  countSecretEnvKeys,
  formatCmdLine,
  useMcpServers,
} from "@/lib/api/mcp-registry";
import type { components } from "@/lib/api-types";
import { errMessage, useNotify } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";
import {
  useUpdateWorkspaceMcpConfig,
  useWorkspaceMcpConfig,
} from "@/lib/workspace-skills-view";

interface Props {
  params: { id: string };
}

/* ────────────────────── zod 校验（D-002@v1 textarea JSON + 前端校验） ────────────────────── */

const mcpServerEntrySchema = z.object({
  // type 仅允许缺省（视为 stdio）或 "stdio"（D-005@v2：非 stdio 中文报错）。
  // v3 literal 消息不可靠，用 optional + refine（消息稳定）。
  type: z
    .string()
    .optional()
    .refine((v) => v === undefined || v === "stdio", {
      message: "仅支持 stdio 类型（本地命令）的 MCP 服务器",
    }),
  command: z.string({
    required_error: "command 不能为空",
    invalid_type_error: "command 必须是字符串",
  }).min(1, "command 不能为空"),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
});

const workspaceMcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), mcpServerEntrySchema),
});

export type WorkspaceMcpValidation =
  | { ok: true; data: z.infer<typeof workspaceMcpConfigSchema> }
  | { ok: false; error: string };

/**
 * 编辑器文本 → 校验结果（导出供 lib/__tests__ 单测复用）。
 *
 * 错误信息中文并定位 server 名（requirements FR-01）：zod issue path 形如
 * ["mcpServers", "<server>", "<field>"]，取 path[1] 拼 server 名。
 */
export function validateWorkspaceMcpJson(text: string): WorkspaceMcpValidation {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "配置不能为空" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    return {
      ok: false,
      error: `JSON 语法错误：${e instanceof Error ? e.message : "解析失败"}`,
    };
  }
  const result = workspaceMcpConfigSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    if (first) {
      const serverName = first.path[1];
      const serverHint =
        typeof serverName === "string" && serverName ? `server "${serverName}"：` : "";
      return { ok: false, error: `${serverHint}${first.message}` };
    }
    return { ok: false, error: "配置结构不合法" };
  }
  return { ok: true, data: result.data };
}

/* ──────────── 从资产库选入（2026-09-11-workspace-asset-bridges 桥③ / FR-04） ──────────── */

/** POST /mcp/import-from-registry 请求体（api-types 生成物，禁手写）。 */
export type McpImportFromRegistryRequest =
  components["schemas"]["McpImportFromRegistryRequest"];

/**
 * 导入响应（api-types 生成物）：written_name=实际写入 .mcp.json 的 server 名
 * （同名冲突改名后的最终名）、renamed=是否发生改名、warning=停用/无绑定提示
 * （不阻断导入——写入即生效，与平台绑定态无关）。
 */
export type McpImportFromRegistryResponse =
  components["schemas"]["McpImportFromRegistryResponse"];

/**
 * 从 MCP 资产库选入单个 server 到 workspace .mcp.json（D-004/D-009）。
 *
 * 请求函数放本页目录（taskcard 约束：不进 lib/api/mcp-registry.ts——该文件
 * 本卡只读复用）；后端 service 完成解密（失败 422 中文文案）→ 同名改名
 * `-registry` 循环避撞 → 读-合并-原子写，registry 侧零变化。
 */
export async function importMcpFromRegistry(
  workspaceId: string,
  serverId: string,
): Promise<McpImportFromRegistryResponse> {
  return apiFetch<McpImportFromRegistryResponse>(
    `/api/workspaces/${workspaceId}/mcp/import-from-registry`,
    { method: "POST", json: { server_id: serverId } },
  );
}

/* ────────────────────── 页面 ────────────────────── */

/**
 * Workspace MCP 子页（2026-07-07 task-10 起；2026-08-26-workspace-mcp-edit
 * task-10 升级双态：查看/编辑）。
 *
 * 查看态展示 specDir/.mcp.json 的 mcpServers（env secret 已被 backend 脱敏为
 * `<set>`）；编辑态 textarea JSON 编辑 + zod 校验 + PUT 保存（D-001@v1 推翻旧
 * D-006 只读决策；编辑说明/白名单/mcpRefs 提示见 design §7.4）。
 * membership 校验由 layout 的 WorkspaceBindingGuard 完成（能进页面即成员，
 * 无写权限成员保存时由后端 403 中文报错兜底）。
 *
 * 2026-09-11-workspace-asset-bridges task-06 增「从资产库选入」弹窗（桥③ /
 * FR-04 / D-004）：registry visible 列表选中 → POST import-from-registry，
 * 同名改名与停用 warning 在结果区反馈，成功后刷新下方 .mcp.json 列表
 * （既有查看/编辑两态零改动）。
 */
export default function WorkspaceMcpPage({ params }: Props) {
  const workspaceId = params.id;
  const { mcpServers, isLoading, isError, error, refetch } =
    useWorkspaceMcpConfig(workspaceId);
  const update = useUpdateWorkspaceMcpConfig(workspaceId);
  const notify = useNotify();

  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [showImport, setShowImport] = useState(false);

  const serverNames = Object.keys(mcpServers);

  // 进入编辑态：把当前 GET 结果（含 <set> 占位符）序列化进 textarea。
  const enterEdit = () => {
    setText(JSON.stringify({ mcpServers }, null, 2));
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setText("");
  };

  const validation = useMemo(
    () => (editing ? validateWorkspaceMcpJson(text) : { ok: true as const, data: undefined }),
    [editing, text],
  );

  const dirty =
    editing && validation.ok && text.trim() !== JSON.stringify({ mcpServers }, null, 2);

  const handleSave = async () => {
    if (!validation.ok || validation.data === undefined) {
      notify.error(new Error(validation.ok ? "配置未变化" : validation.error), "配置校验失败");
      return;
    }
    // 显式补 type:"stdio"/args/env 字段（zod 缺省归一），对齐 api-types 请求类型。
    const body = {
      mcpServers: Object.fromEntries(
        Object.entries(validation.data.mcpServers).map(([name, s]) => [
          name,
          {
            type: "stdio" as const,
            command: s.command,
            args: s.args ?? [],
            ...(s.env ? { env: s.env } : {}),
          },
        ]),
      ),
    };
    try {
      await update.mutateAsync(body);
      notify.success("已保存（新会话启动时生效）");
      setEditing(false);
      setText("");
    } catch (err) {
      notify.error(err, "保存失败");
    }
  };

  return (
    <PageContainer size="full">
      <PageHeader
        title="MCP 配置"
        subtitle={
          editing
            ? "编辑工作区 .mcp.json 的 MCP 服务器配置（保存后写入 specDir/.mcp.json）"
            : "查看工作区 .mcp.json 的 MCP 服务器配置（env 密钥已脱敏）"
        }
        actions={
          editing ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={cancelEdit} disabled={update.isPending}>
                取消
              </Button>
              <Button
                size="sm"
                onClick={() => void handleSave()}
                disabled={!validation.ok || !dirty || update.isPending}
              >
                {update.isPending ? "保存中…" : "保存"}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href={`/workspaces/${workspaceId}`}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                ← 工作区
              </Link>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refetch()}
                disabled={isLoading}
              >
                刷新
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowImport(true)}
              >
                <Import className="mr-1 h-3.5 w-3.5" />
                从资产库选入
              </Button>
              <Button size="sm" onClick={enterEdit} disabled={isLoading || isError}>
                <Pencil className="mr-1 h-3.5 w-3.5" />
                编辑
              </Button>
            </div>
          )
        }
      />

      {isError && (
        <ErrorBanner message={error?.message ?? "加载 MCP 配置失败"} />
      )}

      {editing ? (
        <SectionCard>
          <p className="mb-2 text-[11px] text-muted-foreground">
            编辑说明：直接编辑 JSON（结构与 Claude{" "}
            <code className="rounded bg-muted px-1">.mcp.json</code> 一致）。仅支持{" "}
            <code className="rounded bg-muted px-1">stdio</code> 类型（command + args + env）；
            env 密钥值显示为 <code className="rounded bg-muted px-1">&lt;set&gt;</code>{" "}
            表示已脱敏，<b>保留 &lt;set&gt; 保存即表示不修改该密钥</b>。
          </p>
          <p className="mb-2 text-[11px] text-muted-foreground">
            ⚠ server 名需在<b>平台白名单</b>（设置 → MCP）中才会对 agent 生效，未放行的会在注入时被剔除；
            最终是否生效还取决于 agent 画像的 MCP 配置（可能进一步收窄）。
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            className="h-72 w-full rounded border border-input bg-background p-3 font-mono text-xs leading-relaxed focus:border-ring focus:outline-none"
            placeholder='{ "mcpServers": {} }'
          />
          <div className="mt-2 min-h-4 text-xs">
            {validation.ok ? (
              <span className="text-emerald-600">配置格式正确</span>
            ) : (
              <span className="text-destructive">{validation.error}</span>
            )}
          </div>
        </SectionCard>
      ) : (
        <>
          {isLoading && (
            <p className="py-8 text-center text-xs text-muted-foreground">
              加载中...
            </p>
          )}

          {!isLoading && !isError && serverNames.length === 0 && (
            <SectionCard>
              <EmptyState
                icon={<Plug className="h-5 w-5" />}
                title="暂无 MCP 服务器配置"
                description="specDir/.mcp.json 不存在或未配置 mcpServers。"
              />
            </SectionCard>
          )}

          {!isLoading && !isError && serverNames.length > 0 && (
            <div className="space-y-2">
              {serverNames.map((name) => {
                const server = mcpServers[name] ?? {};
                const entries = Object.entries(server);
                return (
                  <SectionCard key={name} hover="lift">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-sm font-semibold">{name}</span>
                      <StatusBadge kind="neutral">
                        {entries.length} 项
                      </StatusBadge>
                    </div>
                    {entries.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground">
                        该服务器无配置字段。
                      </p>
                    ) : (
                      <dl className="grid grid-cols-[7rem_1fr] gap-y-0.5 text-[11px]">
                        {entries.map(([k, v]) => (
                          <FieldRow key={k} k={k} v={v} />
                        ))}
                      </dl>
                    )}
                  </SectionCard>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ══ 从资产库选入弹窗（桥③ / FR-04；打开才拉 visible 列表） ══ */}
      {showImport && (
        <RegistryImportDialog
          workspaceId={workspaceId}
          onClose={() => setShowImport(false)}
        />
      )}
    </PageContainer>
  );
}

/** 单个配置字段行：env 这类 dict 折叠展示其键值（secret 值为 <set>）。 */
function FieldRow({ k, v }: { k: string; v: unknown }) {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const subEntries = Object.entries(v as Record<string, unknown>);
    return (
      <>
        <dt className="text-muted-foreground">{k}</dt>
        <dd>
          <dl className="grid grid-cols-[8rem_1fr] gap-y-0.5 rounded border border-border/60 bg-muted/30 px-2 py-1">
            {subEntries.map(([sk, sv]) => (
              <div key={sk} className="contents">
                <dt className="font-mono text-muted-foreground">{sk}</dt>
                <dd className="font-mono break-all">
                  {formatValue(sv)}
                  {sv === "<set>" && (
                    <span className="ml-1 text-warning">（密钥已脱敏）</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </dd>
      </>
    );
  }
  return (
    <>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-mono break-all">{formatValue(v)}</dd>
    </>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/* ──────────── 从资产库选入弹窗（bridges task-06，桥③ / D-004 两阶段） ──────────── */

/**
 * 「从资产库选入」弹窗（两阶段：visible 列表单选 → 确认后结果反馈）。
 *
 * 列表只读复用 lib/api/mcp-registry.ts 的 useMcpServers({scope:"visible"})
 * （本卡不改该文件）；选入走本页目录的 importMcpFromRegistry。成功后失效
 * workspaceMcpConfig 缓存，页面下方 .mcp.json 列表自动刷新；同名改名
 * （-registry 后缀）与停用 warning 在结果区逐项反馈，解密失败 422 等
 * 错误在弹窗内联中文展示（弹窗保持打开可换选重试）。
 *
 * 单选用原生 radio（accent-brand-600，adopt 弹窗同款）：antd Radio 在
 * Radix Dialog 内有与 Checkbox 相同的 wave 选择器问题（jsdom 抛错）。
 */
function RegistryImportDialog({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const { servers, isLoading, isError, error, refetch } = useMcpServers({
    scope: "visible",
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [result, setResult] = useState<McpImportFromRegistryResponse | null>(
    null,
  );
  const [importError, setImportError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const qc = useQueryClient();
  const notify = useNotify();

  const selectedServer = servers.find((s) => s.id === selectedId) ?? null;

  const handleImport = async () => {
    if (!selectedServer || pending) return;
    setPending(true);
    setImportError(null);
    try {
      const res = await importMcpFromRegistry(workspaceId, selectedServer.id);
      setResult(res);
      setSelectedId(null);
      // 刷新页面 .mcp.json 列表（invalidate all 前缀连带 detail 双键）。
      void qc.invalidateQueries({ queryKey: queryKeys.workspaceMcpConfig.all });
      notify.success(
        res.renamed
          ? `已选入（同名冲突，改名为 ${res.written_name}）`
          : `已选入 ${res.written_name}`,
      );
    } catch (err) {
      // 422 解密失败等：后端中文文案透出，弹窗内联展示不关闭。
      setImportError(errMessage(err, "选入失败"));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>从资产库选入 MCP 服务器</DialogTitle>
          <DialogDescription>
            从 MCP 资产库（平台默认 + 我的 + 对我启用）选择 server 定义写入本
            工作区 .mcp.json；加密密钥会解密为明文写入，既有条目不变，同名自动
            加 -registry 后缀改名。
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <>
            <div
              className="space-y-2 rounded-lg border border-border px-3 py-3 text-xs"
              data-testid="registry-import-result"
            >
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge kind="success">已选入</StatusBadge>
                <code className="rounded bg-muted px-1.5 py-0.5 font-medium">
                  {result.written_name}
                </code>
              </div>
              {result.renamed && (
                <p className="text-muted-foreground">
                  工作区已有同名 server，已自动改名为{" "}
                  <code className="rounded bg-muted px-1">{result.written_name}</code>
                  （-registry 后缀避让既有条目）。
                </p>
              )}
              {result.warning && (
                <p
                  className="rounded-lg border border-warning/40 bg-warning/10 px-2.5 py-1.5 leading-relaxed text-warning"
                  data-testid="registry-import-warning"
                >
                  ⚠ {result.warning}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button onClick={onClose}>关闭</Button>
              <Button variant="outline" onClick={() => setResult(null)}>
                继续选入
              </Button>
            </DialogFooter>
          </>
        ) : isLoading ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            加载资产库 server 列表...
          </p>
        ) : isError ? (
          <ErrorBanner
            message={errMessage(error, "加载资产库 server 列表失败")}
            onRetry={() => void refetch()}
          />
        ) : servers.length === 0 ? (
          <EmptyState
            icon={<Plug className="h-5 w-5" />}
            title="资产库暂无可见 server"
            description="去「设置 → MCP」先在资产库创建或导入 server 定义。"
          />
        ) : (
          <>
            <ul
              className="max-h-[50vh] space-y-1 overflow-y-auto"
              data-testid="registry-import-list"
            >
              {servers.map((server) => {
                const isMine = server.owner_user_id !== null;
                const secretCount = countSecretEnvKeys(server.secret_env_keys);
                const checked = server.id === selectedId;
                return (
                  <li
                    key={server.id}
                    className={
                      checked
                        ? "flex items-start gap-2 rounded-lg border border-brand-500 px-3 py-2"
                        : "flex items-start gap-2 rounded-lg border border-border px-3 py-2"
                    }
                    data-testid={`registry-import-item-${server.name}`}
                  >
                    <input
                      type="radio"
                      name="registry-import-server"
                      className="mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer accent-brand-600"
                      aria-label={`选入 ${server.name}`}
                      checked={checked}
                      onChange={() => setSelectedId(server.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">{server.name}</span>
                        <Tag className="m-0">{server.server_type}</Tag>
                        {server.platform_bound && (
                          <Tag className="m-0" color="purple">
                            平台默认
                          </Tag>
                        )}
                        {isMine && (
                          <Tag className="m-0" color="cyan">
                            我的私有
                          </Tag>
                        )}
                        {!server.enabled && (
                          <Tag className="m-0" color="warning">
                            已停用
                          </Tag>
                        )}
                      </div>
                      <div
                        className="mt-1 overflow-hidden truncate rounded bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
                        title={formatCmdLine(server.server_config)}
                      >
                        {formatCmdLine(server.server_config)}
                      </div>
                      {secretCount > 0 && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          🔒 {secretCount} 个密钥已加密（选入时解密为明文写入
                          .mcp.json）
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            {importError && (
              <div
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                data-testid="registry-import-error"
              >
                {importError}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={pending}>
                取消
              </Button>
              <Button
                onClick={() => void handleImport()}
                disabled={pending || !selectedServer}
              >
                {pending ? "选入中…" : "选入"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

"use client";

import Link from "next/link";
import { Pencil, Plug } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";

import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { StatusBadge } from "@/components/ui/status-badge";
import { useNotify } from "@/lib/errors";
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
 */
export default function WorkspaceMcpPage({ params }: Props) {
  const workspaceId = params.id;
  const { mcpServers, isLoading, isError, error, refetch } =
    useWorkspaceMcpConfig(workspaceId);
  const update = useUpdateWorkspaceMcpConfig(workspaceId);
  const notify = useNotify();

  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");

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
    <PageContainer>
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

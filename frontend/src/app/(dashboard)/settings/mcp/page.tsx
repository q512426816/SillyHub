"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw, Save, X, Plus, Lock } from "lucide-react";

import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { errMessage } from "@/lib/errors";
import { useNotify } from "@/lib/errors";
import { useSession } from "@/stores/session";
import {
  MCP_SECRET_PLACEHOLDER,
  mcpConfigSchema,
  mcpWhitelistSchema,
  useMcpConfig,
  useMcpWhitelist,
  useUpdateMcpConfig,
  useUpdateMcpWhitelist,
  type McpConfig,
  type McpWhitelist,
} from "@/lib/mcp-settings";
import { z } from "zod";

/* ────────────────────── 辅助：secret key 判断（与后端 markers 一致） ────────────────────── */

const SECRET_MARKERS = ["token", "key", "secret", "password"];

function isSecretEnvKey(k: string): boolean {
  const lowered = k.toLowerCase();
  return SECRET_MARKERS.some((m) => lowered.includes(m));
}

/** 统计某 server 的 env 里有多少 secret 字段（用于 UI 徽标提示）。 */
function countSecretEnv(config: McpConfig | null): number {
  if (!config) return 0;
  let n = 0;
  for (const server of Object.values(config.mcpServers)) {
    if (server.env) {
      for (const k of Object.keys(server.env)) {
        if (isSecretEnvKey(k)) n += 1;
      }
    }
  }
  return n;
}

/* ────────────────────── JSON 编辑器 ────────────────────── */

/**
 * MCP 平台默认配置 JSON 编辑器。
 *
 * - 展示 {mcpServers:{...}} JSON（admin GET 返回的 env secret 已遮蔽为 `<set>`）
 * - 实时 zod 校验：非法 JSON / 结构不符 → 报错并禁用保存（D-009）
 * - 编辑时若保留 `<set>`，PUT 后端原样存储（提示用户：留 `<set>` 不改该 secret）
 */
function McpConfigEditor({ canWrite }: { canWrite: boolean }) {
  const { config, isLoading, isError, error, refetch } = useMcpConfig();
  const update = useUpdateMcpConfig();
  const notify = useNotify();

  // 文本框内容与原始 config 分离：用户可自由编辑文本，保存前再校验。
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);

  // 首次加载（或刷新后）把 JSON 序列化进 textarea。
  useEffect(() => {
    if (config && !loaded) {
      setText(JSON.stringify(config, null, 2));
      setLoaded(true);
    }
  }, [config, loaded]);

  const secretCount = useMemo(() => countSecretEnv(config), [config]);

  // 实时校验：JSON 解析 + zod。
  const validation = useMemo(() => {
    const trimmed = text.trim();
    if (!trimmed) return { ok: false, error: "配置不能为空" };
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      return { ok: false, error: `JSON 语法错误：${e instanceof Error ? e.message : "解析失败"}` };
    }
    const result = mcpConfigSchema.safeParse(parsed);
    if (!result.success) {
      const first = result.error.issues[0];
      if (first) {
        const path = first.path.length > 0 ? `（路径：${first.path.join(".")}）` : "";
        return { ok: false, error: `${first.message}${path}` };
      }
      return { ok: false, error: "配置结构不合法" };
    }
    return { ok: true, data: result.data };
  }, [text]);

  const dirty = loaded && text.trim() !== JSON.stringify(config ?? {}, null, 2);

  const handleSave = async () => {
    if (!validation.ok || !validation.data) {
      notify.error(new Error(validation.error), "配置校验失败");
      return;
    }
    try {
      await update.mutateAsync(validation.data);
      notify.success("已保存，需重启 daemon 生效");
      // 同步本地文本为后端返回（遮蔽后）视图。
      // update 成功后 config 会被 invalidate 重新拉取，下次加载会刷新文本。
    } catch (err) {
      notify.error(err, "保存失败");
    }
  };

  const handleReset = () => {
    if (config) setText(JSON.stringify(config, null, 2));
  };

  return (
    <SectionCard
      title={
        <div className="flex items-center gap-2">
          <span>平台默认 MCP 配置</span>
          {secretCount > 0 && (
            <Badge variant="outline" className="gap-1">
              <Lock className="h-3 w-3" />
              {secretCount} 个 secret 已遮蔽
            </Badge>
          )}
        </div>
      }
      extra={
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setLoaded(false);
            void refetch();
          }}
          disabled={isLoading}
          className="gap-1"
        >
          <RefreshCw className={isLoading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          刷新
        </Button>
      }
    >
      {isError ? (
        <div className="rounded-md border border-destructive/30 bg-red-50 px-3 py-2 text-sm text-destructive">
          {errMessage(error, "加载失败")}
        </div>
      ) : isLoading && !config ? (
        <div className="py-8 text-center text-sm text-muted-foreground">加载中…</div>
      ) : (
        <>
          <p className="mb-2 text-[11px] text-muted-foreground">
            编辑 JSON 配置 <code className="rounded bg-muted px-1">{"{ mcpServers: { name: { command, args, env } } }"}</code>。
            env 中含 token/key/secret/password 的字段已遮蔽为{" "}
            <code className="rounded bg-muted px-1">{MCP_SECRET_PLACEHOLDER}</code>，保留该值表示不修改原 secret。
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            readOnly={!canWrite}
            spellCheck={false}
            className="h-72 w-full rounded border border-input bg-background p-3 font-mono text-xs leading-relaxed focus:border-ring focus:outline-none disabled:cursor-not-allowed disabled:opacity-70"
            placeholder='{ "mcpServers": {} }'
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1 text-xs">
              {validation.ok ? (
                <span className="text-emerald-600">配置格式正确</span>
              ) : (
                <span className="text-destructive">{validation.error}</span>
              )}
            </div>
            {canWrite && (
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleReset}
                  disabled={!dirty || update.isPending}
                >
                  撤销改动
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={!validation.ok || !dirty || update.isPending}
                  className="gap-1"
                >
                  <Save className="h-3.5 w-3.5" />
                  {update.isPending ? "保存中…" : "保存配置"}
                </Button>
              </div>
            )}
          </div>
          {canWrite && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              保存后提示「需重启 daemon 生效」——MCP 配置变更不会热推送，daemon 下次启动时从平台拉取。
            </p>
          )}
        </>
      )}
    </SectionCard>
  );
}

/* ────────────────────── 白名单编辑器（Tag 增删） ────────────────────── */

function McpWhitelistEditor({ canWrite }: { canWrite: boolean }) {
  const { whitelist, isLoading, isError, error, refetch } = useMcpWhitelist();
  const update = useUpdateMcpWhitelist();
  const notify = useNotify();

  const [items, setItems] = useState<McpWhitelist>([]);
  const [draft, setDraft] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded && whitelist) {
      setItems([...whitelist]);
      setLoaded(true);
    }
  }, [whitelist, loaded]);

  const dirty = loaded && JSON.stringify(items) !== JSON.stringify(whitelist ?? []);

  const addServer = () => {
    const name = draft.trim();
    if (!name) return;
    if (items.includes(name)) {
      setLocalError("该 server 已在白名单中");
      return;
    }
    // 单项校验：server 名必须是非空字符串（zod 数组元素约束）。
    const check = z.string().min(1).safeParse(name);
    if (!check.success) {
      setLocalError("server 名不能为空");
      return;
    }
    setItems([...items, name]);
    setDraft("");
    setLocalError(null);
  };

  const removeServer = (name: string) => {
    setItems(items.filter((s) => s !== name));
    setLocalError(null);
  };

  const handleSave = async () => {
    const result = mcpWhitelistSchema.safeParse(items);
    if (!result.success) {
      setLocalError("白名单格式不合法");
      return;
    }
    try {
      await update.mutateAsync(result.data);
      setLocalError(null);
      notify.success("已保存白名单，需重启 daemon 生效");
    } catch (err) {
      notify.error(err, "保存失败");
    }
  };

  return (
    <SectionCard
      title="MCP server 白名单"
      extra={
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setLoaded(false);
            void refetch();
          }}
          disabled={isLoading}
          className="gap-1"
        >
          <RefreshCw className={isLoading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          刷新
        </Button>
      }
    >
      <p className="mb-3 text-[11px] text-muted-foreground">
        白名单内的 server 名才允许在 workspace <code className="rounded bg-muted px-1">.mcp.json</code> 中引用并被 daemon 注入。
      </p>
      {isError ? (
        <div className="rounded-md border border-destructive/30 bg-red-50 px-3 py-2 text-sm text-destructive">
          {errMessage(error, "加载失败")}
        </div>
      ) : isLoading && !loaded ? (
        <div className="py-6 text-center text-sm text-muted-foreground">加载中…</div>
      ) : (
        <>
          <div className="flex min-h-10 flex-wrap items-center gap-2 rounded border border-input bg-background p-2">
            {items.length === 0 && (
              <span className="px-1 text-xs text-muted-foreground">（白名单为空）</span>
            )}
            {items.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs"
              >
                <code>{name}</code>
                {canWrite && (
                  <button
                    type="button"
                    aria-label={`移除 ${name}`}
                    onClick={() => removeServer(name)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
          {canWrite && (
            <div className="mt-2 flex items-center gap-2">
              <input
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setLocalError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addServer();
                  }
                }}
                placeholder="输入 server 名，回车添加"
                className="h-8 flex-1 rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none"
              />
              <Button size="sm" variant="outline" onClick={addServer} className="gap-1">
                <Plus className="h-3.5 w-3.5" />
                添加
              </Button>
            </div>
          )}
          {localError && (
            <p className="mt-2 text-xs text-destructive">{localError}</p>
          )}
          {canWrite && (
            <div className="mt-3 flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => whitelist && setItems([...whitelist])}
                disabled={!dirty || update.isPending}
              >
                撤销改动
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={!dirty || update.isPending}
                className="gap-1"
              >
                <Save className="h-3.5 w-3.5" />
                {update.isPending ? "保存中…" : "保存白名单"}
              </Button>
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}

/* ────────────────────── 主页 ────────────────────── */

export default function McpSettingsPage() {
  const { user } = useSession();
  const canWrite = !!user?.is_platform_admin;

  return (
    <PageContainer className="gap-5">
      <PageHeader
        title="MCP 配置"
        subtitle={
          <span>
            <Link href="/settings" className="hover:underline">
              设置
            </Link>
            <span className="px-1 text-muted-foreground/60">/</span>
            管理平台默认 MCP 配置与 server 白名单
          </span>
        }
      />

      {!canWrite && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          仅平台管理员可编辑，当前为只读视图。
        </div>
      )}

      <McpConfigEditor canWrite={canWrite} />
      <McpWhitelistEditor canWrite={canWrite} />
    </PageContainer>
  );
}

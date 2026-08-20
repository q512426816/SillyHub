"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw, Sparkles } from "lucide-react";

import { SectionCard } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { errMessage, useNotify } from "@/lib/errors";
import {
  createProvider,
  deleteProvider,
  detectUsageProvider,
  formToCreate,
  formToUpdate,
  listProviders,
  updateProvider,
  type LlmProviderFormValues,
  type LlmProviderRead,
} from "@/lib/api/llm-providers";
import { cn } from "@/lib/utils";
import { LlmProviderForm } from "./llm-provider-form";
import { UsageFooter } from "./usage-footer";

/**
 * 「我的供应商」区块（task-11）。
 *
 * 列表 + 新建/编辑表单 + 删除，配置跟随账号、所有工作空间通用（D-002）。
 * 供应商生效方式为 /sessions 会话级选择（session_llm_provider_id），本页只做
 * 纯 CRUD 管理，不再有全局启动/停止（set-default）概念（ql-20260820-006）。
 *
 * 状态机：list ↔ form（create/edit）。form 打开时只渲染表单，取消回列表。
 * 操作后即时 reload 列表（删除/新建/编辑均刷新）。
 */

/** 角色显示顺序，用于模型摘要。 */
const ROLE_ORDER = ["sonnet", "opus", "fable", "haiku"] as const;
const ROLE_LABELS: Record<string, string> = {
  sonnet: "Sonnet",
  opus: "Opus",
  fable: "Fable",
  haiku: "Haiku",
};

type FormMode =
  | { kind: "create" }
  | { kind: "edit"; provider: LlmProviderRead }
  | null;

/** 摘要：默认模型 / 角色映射，供列表行展示。 */
function modelSummary(p: LlmProviderRead): { primary: string; secondary: string } {
  const fallback = p.default_fallback_model ?? p.model ?? "";
  const m = p.model_role_mappings ?? {};
  const mapped: string[] = [];
  for (const role of ROLE_ORDER) {
    const model = m[role]?.model;
    if (model) mapped.push(`${ROLE_LABELS[role]}→${model}`);
  }
  const suffix = mapped.length > 0 ? `角色映射：${mapped.join(" / ")}` : "";
  return {
    primary: fallback || (mapped.length > 0 ? "见角色映射" : "—"),
    secondary: suffix,
  };
}

export function LlmProviderSection() {
  const notify = useNotify();
  const [providers, setProviders] = useState<LlmProviderRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProviders(await listProviders());
    } catch (err) {
      setError(errMessage(err, "加载失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSubmit = async (values: LlmProviderFormValues) => {
    setSubmitting(true);
    try {
      if (formMode?.kind === "edit") {
        await updateProvider(formMode.provider.id, formToUpdate(values));
        notify.success("供应商已更新");
      } else {
        await createProvider(formToCreate(values));
        notify.success("供应商已创建");
      }
      setFormMode(null);
      await load();
    } catch (err) {
      notify.error(err, formMode?.kind === "edit" ? "更新失败" : "创建失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (p: LlmProviderRead) => {
    if (!confirm(`确定删除供应商「${p.name}」？此操作不可恢复。`)) return;
    try {
      await deleteProvider(p.id);
      notify.success("已删除");
      await load();
    } catch (err) {
      notify.error(err, "删除失败");
    }
  };

  // ── 表单视图 ──────────────────────────────────────────────────────────
  if (formMode) {
    const isEdit = formMode.kind === "edit";
    return (
      <SectionCard
        title={isEdit ? "编辑供应商" : "新建供应商"}
        extra={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFormMode(null)}
            disabled={submitting}
          >
            返回列表
          </Button>
        }
      >
        <LlmProviderForm
          mode={formMode.kind}
          initial={isEdit ? formMode.provider : null}
          onSubmit={handleSubmit}
          onCancel={() => setFormMode(null)}
          submitting={submitting}
        />
      </SectionCard>
    );
  }

  // ── 列表视图 ──────────────────────────────────────────────────────────
  return (
    <SectionCard
      title={
        <span className="flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-primary" />
          我的供应商
          {providers.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              （{providers.length}）
            </span>
          )}
        </span>
      }
      extra={
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
            className="gap-1"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            刷新
          </Button>
          <Button
            size="sm"
            onClick={() => setFormMode({ kind: "create" })}
            className="gap-1"
          >
            <Plus className="h-3.5 w-3.5" />
            新建供应商
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-[11px] text-muted-foreground">
        管理你用于 Claude Code 的 LLM 供应商。配置跟随你的账号，<b>所有工作空间通用</b>；
        在 <b>/sessions 新建会话时选择</b>哪个供应商生效。
        填好 API Key 和请求地址就能用；模型映射等高级项默认折叠，用中转站时再展开。
      </p>

      {error && (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-10 text-center text-xs text-muted-foreground">
          加载中…
        </div>
      ) : providers.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="h-5 w-5" />}
          title="还没有供应商"
          description="新建一个供应商，填好 API Key 和请求地址即可使用。配置跟随账号，所有工作空间通用。"
          action={
            <Button
              size="sm"
              onClick={() => setFormMode({ kind: "create" })}
              className="gap-1"
            >
              <Plus className="h-3.5 w-3.5" />
              新建供应商
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {providers.map((p) => {
            const summary = modelSummary(p);
            return (
              <div
                key={p.id}
                className="rounded-lg border bg-card p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{p.name}</span>
                  <Badge variant="warning">{p.agent_kind}</Badge>
                  {p.api_format === "openai_chat" && (
                    <Badge variant="outline" className="gap-0.5" title="OpenAI 格式（经 LiteLLM 网关消费）">
                      OpenAI
                    </Badge>
                  )}
                  {detectUsageProvider(p.base_url) && (
                    <Badge variant="outline" className="gap-0.5" title="支持余额查询">
                      💰 可查用量
                    </Badge>
                  )}
                  <div className="ml-auto flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[11px]"
                      onClick={() =>
                        setFormMode({ kind: "edit", provider: p })
                      }
                    >
                      编辑
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => void handleDelete(p)}
                    >
                      删除
                    </Button>
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  {p.base_url && (
                    <span className="truncate font-mono">
                      <span className="text-muted-foreground/70">base_url：</span>
                      {p.base_url}
                    </span>
                  )}
                  {p.api_key_masked && (
                    <span>
                      <span className="text-muted-foreground/70">密钥：</span>
                      <code className="rounded bg-muted px-1 py-0.5">
                        {p.api_key_masked}
                      </code>
                    </span>
                  )}
                  <span>
                    <span className="text-muted-foreground/70">认证：</span>
                    {p.auth_field}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px]">
                  <span className="text-primary">{summary.primary}</span>
                  {summary.secondary && (
                    <span className="text-muted-foreground">{summary.secondary}</span>
                  )}
                </div>
                {/*
                  用量页脚（task-09 / D-006）：每行底部挂 UsageFooter。组件内置挂载即查
                  （仅可查供应商）+ keep-last-good + 手动刷新图标，故列表层无需再写
                  useEffect 自动查 / 「查余额」按钮——自动查使用量加载即显示，独立按钮冗余。
                  不可查供应商由 footer 渲染中性「暂不支持余额查询」文案，不报错。
                */}
                <UsageFooter providerId={p.id} baseUrl={p.base_url} />
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

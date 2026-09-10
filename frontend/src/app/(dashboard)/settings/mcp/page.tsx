"use client";

/**
 * MCP 资产库页（/settings/mcp）。
 *
 * 变更 2026-09-10-mcp-central-registry / task-11：从「JSON 编辑器」重构为
 * 「平台共享库 / 我的库」双 tab 卡片管理页（D-001 双层可见性 + FR-03 启用绑定），
 * 布局照原型 prototype-mcp-central-registry.html ③ 管理页段：
 * - PageHeader「MCP 资产库」+ 双 tab（平台共享库 scope=platform / 我的库 scope=mine）；
 * - 工具栏：搜索（回车触发，FRONTEND_PAGE_STYLE §3）/ 标签筛选 / ＋新建 Server
 *   （本卡落地）；导入 JSON · 从 Workspace 扫描 · 从模板新建为 task-12 预留按钮位
 *   （disabled，弹窗归 task-12）；
 * - 卡片网格 components/mcp-registry/server-card.tsx（binding 开关/编辑/复制/
 *   存模板/删除）；新建/编辑弹窗 components/mcp-registry/server-form-modal.tsx。
 *
 * 权限：admin 平台库可写（设为平台默认 platform binding）；普通用户平台库只读
 * （卡片无编辑入口，仅「对我启用」user binding），我的库自管。
 *
 * 白名单编辑器（D-007 治理层留 settings）保留页尾不动，admin 可见可写；
 * 旧「平台默认 MCP 配置」JSON 编辑器随中央库上线移除（mcp-settings.ts 旧
 * config 客户端本卡不动，task-13 删）。
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Empty, Input, Modal, Select, Spin } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { RefreshCw } from "lucide-react";
import { z } from "zod";

import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
import { McpServerCard } from "@/components/mcp-registry/server-card";
import {
  McpServerFormModal,
  type McpServerFormSubmitPayload,
} from "@/components/mcp-registry/server-form-modal";
import { McpImportJsonModal } from "@/components/mcp-registry/import-json-modal";
import { McpWorkspaceScanModal } from "@/components/mcp-registry/workspace-scan-modal";
import {
  McpTemplatePickerModal,
  type McpTemplatePick,
} from "@/components/mcp-registry/template-picker-modal";
import { McpDiagnosticsPanel } from "@/components/mcp-registry/diagnostics-panel";
import { errMessage, useNotify } from "@/lib/errors";
import {
  saveMcpTemplate,
  useCreateMcpServer,
  useDeleteMcpServer,
  useMcpServers,
  useToggleMcpBinding,
  useUpdateMcpServer,
  type McpServerRead,
} from "@/lib/api/mcp-registry";
import {
  mcpWhitelistSchema,
  useMcpWhitelist,
  useUpdateMcpWhitelist,
  type McpWhitelist,
} from "@/lib/mcp-settings";
import { queryKeys } from "@/lib/query-keys";
import { useSession } from "@/stores/session";
import { cn } from "@/lib/utils";

/* ────────────────────── 白名单编辑器（Tag 增删，保留原实现） ────────────────────── */

function McpWhitelistEditor() {
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
          size="small"
          onClick={() => {
            setLoaded(false);
            void refetch();
          }}
          disabled={isLoading}
        >
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
                <button
                  type="button"
                  aria-label={`移除 ${name}`}
                  onClick={() => removeServer(name)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
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
            <Button size="small" onClick={addServer}>
              添加
            </Button>
          </div>
          {localError && <p className="mt-2 text-xs text-destructive">{localError}</p>}
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              size="small"
              onClick={() => whitelist && setItems([...whitelist])}
              disabled={!dirty || update.isPending}
            >
              撤销改动
            </Button>
            <Button
              size="small"
              type="primary"
              onClick={handleSave}
              disabled={!dirty || update.isPending}
              loading={update.isPending}
            >
              保存白名单
            </Button>
          </div>
        </>
      )}
    </SectionCard>
  );
}

/* ────────────────────── 主页 ────────────────────── */

/** tab 语境（列表 ?scope= 词表子集）。 */
type ScopeTab = "platform" | "mine";

type FormState =
  | { mode: "create"; template?: McpTemplatePick }
  | { mode: "edit" | "copy"; server: McpServerRead }
  | null;

export default function McpRegistryPage() {
  const user = useSession((s) => s.user);
  const isAdmin = user?.is_platform_admin === true;
  const notify = useNotify();
  const qc = useQueryClient();

  const [scopeTab, setScopeTab] = useState<ScopeTab>("platform");
  // 搜索：输入框即时态 vs 生效态分离（文本型回车触发才查，FRONTEND_PAGE_STYLE §3）。
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState<string | undefined>(undefined);

  const listParams = {
    scope: scopeTab,
    search: search || undefined,
    tag,
  };
  const { servers, isLoading, isFetching, isError, error, refetch } =
    useMcpServers(listParams);

  const toggleBinding = useToggleMcpBinding();
  const createServer = useCreateMcpServer();
  const updateServer = useUpdateMcpServer();
  const deleteServer = useDeleteMcpServer();

  const [formState, setFormState] = useState<FormState>(null);
  const [confirmDelete, setConfirmDelete] = useState<McpServerRead | null>(null);
  // task-12：三导入入口 + 诊断面板开关。
  const [importJsonOpen, setImportJsonOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);

  // 标签筛选选项：当前 tab 列表 tags 去重派生（平台库标签供全员复用）。
  const tagOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of servers) for (const t of s.tags) set.add(t);
    return Array.from(set).sort();
  }, [servers]);

  const handleToggleUserBinding = (server: McpServerRead, enabled: boolean) => {
    toggleBinding.mutate(
      { serverId: server.id, scopeType: "user", enabled },
      {
        onSuccess: () =>
          notify.success(
            enabled ? `已启用「${server.name}」到我的会话` : `已从我的会话停用「${server.name}」`,
          ),
        onError: (err) => notify.error(err, enabled ? "启用失败" : "停用失败"),
      },
    );
  };

  const handleTogglePlatformBinding = (server: McpServerRead, enabled: boolean) => {
    toggleBinding.mutate(
      { serverId: server.id, scopeType: "platform", enabled },
      {
        onSuccess: () =>
          notify.success(
            enabled
              ? `已将「${server.name}」设为平台默认（全员注入）`
              : `已取消「${server.name}」的平台默认`,
          ),
        onError: (err) => notify.error(err, enabled ? "设置失败" : "取消失败"),
      },
    );
  };

  const handleFormSubmit = async (payload: McpServerFormSubmitPayload) => {
    try {
      if (formState?.mode === "edit") {
        await updateServer.mutateAsync({
          serverId: formState.server.id,
          req: {
            name: payload.name,
            server_config: payload.serverConfig,
            tags: payload.tags,
          },
        });
        notify.success("已保存");
      } else {
        const created = await createServer.mutateAsync({
          name: payload.name,
          server_config: payload.serverConfig,
          scope: payload.scope,
          source: "manual",
        });
        // McpServerCreate 无 tags 字段（api-types），创建后 tags 非空时补一次 PATCH。
        if (payload.tags.length > 0) {
          await updateServer.mutateAsync({
            serverId: created.id,
            req: { tags: payload.tags },
          });
        }
        notify.success(formState?.mode === "copy" ? "已复制为新 server" : "已创建");
      }
      setFormState(null);
    } catch (err) {
      notify.error(err, "保存失败");
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      await deleteServer.mutateAsync(confirmDelete.id);
      notify.success(`已删除「${confirmDelete.name}」`);
      setConfirmDelete(null);
    } catch (err) {
      notify.error(err, "删除失败");
    }
  };

  const handleSaveTemplate = async (server: McpServerRead) => {
    try {
      await saveMcpTemplate(server.name, server.id);
      notify.success(`已存为模板「${server.name}」`);
    } catch (err) {
      notify.error(err, "存为模板失败");
    }
  };

  const handleRefresh = () => {
    void refetch();
    void qc.invalidateQueries({ queryKey: queryKeys.mcpRegistry.all });
  };

  return (
    <PageContainer size="full" className="gap-5">
      <PageHeader
        title="MCP 资产库"
        subtitle={
          <span>
            <Link href="/settings" className="hover:underline">
              设置
            </Link>
            <span className="px-1 text-muted-foreground/60">/</span>
            集中管理 MCP server 定义，一键启用到平台默认集或个人会话
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Button onClick={() => setDiagOpen(true)} data-testid="mcp-diagnostics-btn">
                🩺 注入诊断
              </Button>
            )}
            <Button
              onClick={handleRefresh}
              disabled={isFetching}
              icon={
                <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
              }
            >
              刷新
            </Button>
          </div>
        }
      />

      <SectionCard bodyPadding="p-4">
        {/* 双 tab（原型 .tabs）：平台共享库 / 我的库 */}
        <div
          role="tablist"
          aria-label="MCP 资产库分层"
          className="mb-3 flex gap-1 border-b"
        >
          {(
            [
              { key: "platform", label: "平台共享库" },
              { key: "mine", label: "我的库" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={scopeTab === t.key}
              onClick={() => setScopeTab(t.key)}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm",
                scopeTab === t.key
                  ? "border-brand-600 font-semibold text-brand-700"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {scopeTab === t.key && (
                <span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
                  {servers.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* 工具栏：搜索 / 标签筛选 / 新建 + task-12 预留导入按钮位 */}
        <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="mcp-toolbar">
          <Input
            allowClear
            prefix={<SearchOutlined className="text-muted-foreground" />}
            placeholder="搜索名称 / 命令 / 标签，回车生效"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onPressEnter={() => setSearch(searchInput.trim())}
            className="w-64"
          />
          <Select
            allowClear
            placeholder="标签：全部"
            value={tag}
            onChange={(v) => setTag(v)}
            options={tagOptions.map((t) => ({ value: t, label: `#${t}` }))}
            className="w-40"
          />
          <span className="mx-1 h-6 w-px bg-border" aria-hidden />
          <Button
            type="primary"
            onClick={() => setFormState({ mode: "create" })}
          >
            ＋ 新建 Server
          </Button>
          {/* task-12 三导入入口（FR-06/07/09）。 */}
          <Button onClick={() => setImportJsonOpen(true)} data-testid="mcp-import-json-btn">
            📥 导入 JSON
          </Button>
          <Button onClick={() => setScanOpen(true)} data-testid="mcp-scan-btn">
            📂 从 Workspace 扫描
          </Button>
          <Button onClick={() => setTemplatePickerOpen(true)} data-testid="mcp-template-btn">
            ⭐ 从模板新建
          </Button>
        </div>

        {/* 非 admin 平台库只读提示（D-001：卡片无编辑入口，仅「对我启用」可用）。 */}
        {scopeTab === "platform" && !isAdmin && (
          <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            平台共享库由管理员维护，当前为只读视图——你仍可用「对我启用」开关将其加入自己的会话。
          </p>
        )}

        {/* 列表主体 */}
        {isError ? (
          <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-sm text-destructive">
            {errMessage(error, "加载失败")}
            <Button className="ml-3" size="small" onClick={() => void refetch()}>
              重新加载
            </Button>
          </div>
        ) : isLoading ? (
          <div className="py-10 text-center">
            <Spin />
          </div>
        ) : servers.length === 0 ? (
          <Empty
            className="py-8"
            description={
              scopeTab === "mine"
                ? "我的库还是空的——点「＋ 新建 Server」添加第一个私有 server"
                : search || tag
                  ? "没有匹配的平台 server"
                  : "平台共享库暂无 server"
            }
          />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
            {servers.map((s) => (
              <McpServerCard
                key={s.id}
                server={s}
                scopeTab={scopeTab}
                isAdmin={isAdmin}
                bindingPending={toggleBinding.isPending}
                onToggleUserBinding={handleToggleUserBinding}
                onTogglePlatformBinding={handleTogglePlatformBinding}
                onEdit={(srv) => setFormState({ mode: "edit", server: srv })}
                onCopy={(srv) => setFormState({ mode: "copy", server: srv })}
                onSaveTemplate={(srv) => void handleSaveTemplate(srv)}
                onDelete={(srv) => setConfirmDelete(srv)}
              />
            ))}
          </div>
        )}
      </SectionCard>

      {/* 白名单治理层（D-007）：admin 可见可写，保留页尾不动。 */}
      {isAdmin && <McpWhitelistEditor />}

      {formState && (
        <McpServerFormModal
          open
          mode={formState.mode}
          template={formState.mode === "create" ? (formState.template ?? null) : null}
          server={formState.mode === "create" ? null : formState.server}
          defaultScope={isAdmin ? scopeTab : "mine"}
          isAdmin={isAdmin}
          submitting={createServer.isPending || updateServer.isPending}
          onClose={() => setFormState(null)}
          onSubmit={(payload) => void handleFormSubmit(payload)}
        />
      )}

      {/* task-12 三导入弹窗 + 诊断面板（FR-06/07/08/09）。 */}
      <McpImportJsonModal
        open={importJsonOpen}
        isAdmin={isAdmin}
        defaultScope={isAdmin ? (scopeTab === "platform" ? "platform" : "mine") : "mine"}
        onClose={() => setImportJsonOpen(false)}
      />
      <McpWorkspaceScanModal
        open={scanOpen}
        isAdmin={isAdmin}
        onClose={() => setScanOpen(false)}
      />
      <McpTemplatePickerModal
        open={templatePickerOpen}
        onClose={() => setTemplatePickerOpen(false)}
        onPick={(pick) => setFormState({ mode: "create", template: pick })}
      />
      {diagOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setDiagOpen(false)}>
          <div
            className="h-full w-[420px] overflow-y-auto bg-background p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <McpDiagnosticsPanel open onClose={() => setDiagOpen(false)} />
          </div>
        </div>
      )}

      <Modal
        open={confirmDelete !== null}
        title={`确认删除「${confirmDelete?.name ?? ""}」？`}
        onCancel={() => setConfirmDelete(null)}
        onOk={() => void handleDelete()}
        okText="确认删除"
        cancelText="取消"
        okButtonProps={{ danger: true, loading: deleteServer.isPending }}
        mask={{ closable: false }}
        destroyOnHidden
      >
        <p className="mt-2 text-xs text-muted-foreground">
          将删除该 server 定义及其全部绑定关系（platform / user binding 级联）。该操作不可恢复。
        </p>
      </Modal>
    </PageContainer>
  );
}

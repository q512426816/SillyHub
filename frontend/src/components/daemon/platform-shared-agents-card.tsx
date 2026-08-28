"use client";

/**
 * PlatformSharedAgentsCard —— 平台共享智能体管理卡（2026-08-28-daemon-agent-share
 * task-09 / FR-04 / D-002@v2 / D-003）。
 *
 * **仅 platform admin 渲染**（page.tsx 以 useSession user.is_platform_admin === true
 * 门控，先例 agent-profiles/page.tsx）。对齐原型 prototype-daemon-agent-share.html ②：
 *   - 创建表单四字段：档案（platform 可见）/ 守护进程（仅管理员自己名下在线，D-003）/
 *     源码工作区（只读锚定）/ writable_dir（会话唯一可写位置，⊆ runtime 可写目录）；
 *   - 生效列表（SharedAgentView 行 + enabled 状态 Badge + active runtime 在线状态）；
 *   - 启用/停用按钮（PATCH enabled 真假双向软开关，停用后会话选择器即不再呈现）；
 *   - 删除按钮（DELETE 物理删除，modal.confirm 二次确认，对齐 runtimes 页移除运行时先例）；
 *   - 整卡默认折叠（头部常驻计数摘要，展开才渲染表单与列表）。
 *
 * 数据源（全部复用既有 API，零新端点）：
 *   - 档案：usePlatformAgentProfiles（/api/agent-profiles platform 级）；
 *   - 自己名下在线 runtime：useDaemonMachines({ user_id })（admin 传 user_id 即
 *     精确过滤自己名下机器，对齐后端 list_machines 权限分支）；
 *   - 源码工作区：listWorkspaces；
 *   - 共享列表/摘要：lib/daemon sharedAgents 封装（fetchSharedAgents /
 *     fetchSharedAgentsActive / createSharedAgent / setSharedAgentEnabled /
 *     deleteSharedAgent）。
 *
 * 样式：antd Form/Select/Input/Button/Table/Badge/Tag（FRONTEND_PAGE_STYLE §0/§5/§7）
 * + tailwind brand-* 语义阶（§0.5），无硬编码 hex；文案中文。
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Badge, Button, Form, Input, Select, Table, Tag } from "antd";
import { Bot, ChevronDown, ChevronRight, FolderOpen, Plus } from "lucide-react";

import { RemoteFolderPicker } from "@/components/daemon/remote-folder-picker";
import { useNotify } from "@/lib/errors";
import { agentProfileQueryKeys, usePlatformAgentProfiles } from "@/lib/agent-profiles";
import { listWorkspaces } from "@/lib/workspaces";
import {
  createSharedAgent,
  deleteSharedAgent,
  fetchSharedAgents,
  fetchSharedAgentsActive,
  PROVIDER_META,
  setSharedAgentEnabled,
  type DaemonMachineRead,
  type DaemonRuntimeRead,
  type SharedAgentView,
} from "@/lib/daemon";
import { useDaemonMachines } from "@/lib/use-daemon-machines";
import { useSession } from "@/stores/session";

/** 创建表单值（提交前各字段均必填，见 Form rules）。 */
interface SharedAgentFormValues {
  agent_profile_id: string;
  pinned_runtime_id: string;
  source_workspace_id: string;
  writable_dir: string;
}

/** 「自己名下在线 runtime」下拉选项（value=runtime id）。 */
interface RuntimeOption {
  value: string;
  label: string;
  machine: DaemonMachineRead;
  runtime: DaemonRuntimeRead;
}

/** sharedAgents 查询缓存 key（前缀invalidate 同时刷新管理列表与 active 摘要）。 */
const SHARED_AGENTS_QUERY_KEY = ["daemonSharedAgents"] as const;

export function PlatformSharedAgentsCard() {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const { modal } = App.useApp();
  const [form] = Form.useForm<SharedAgentFormValues>();
  const [creating, setCreating] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // 默认折叠：该卡是管理员低频管理入口，头部常驻计数摘要，展开才渲染表单与列表。
  const [expanded, setExpanded] = useState(false);

  // D-003：钉定 runtime 必须是管理员自己名下——admin 传 user_id 即精确过滤。
  const currentUserId = useSession((s) => s.user?.id);
  const { items: machines } = useDaemonMachines(
    currentUserId ? { limit: 100, user_id: currentUserId } : { limit: 100 },
  );

  // platform 级档案（含系统预置）；下拉再按 visibility=platform 收敛（R-05：
  // 非 platform 档案需显式升级才可共享，本表单只列已是 platform 的）。
  const { profiles } = usePlatformAgentProfiles();
  const platformProfiles = useMemo(
    () => profiles.filter((p) => p.visibility === "platform"),
    [profiles],
  );

  // 源码工作区下拉（只读锚定，design §5 Phase 3 校验工作区存在）。
  const { data: workspacesResp } = useQuery({
    queryKey: ["workspaces", "sharedAgentsCard"],
    queryFn: () => listWorkspaces({ limit: 100 }),
    staleTime: 60_000,
  });

  // 管理端全量列表（含停用行）+ active 生效摘要（任意登录用户端点，取档案显示
  // 名与 runtime 在线状态，避免逐行再查档案）。
  const { data: sharedAgents, isError: listError } = useQuery({
    queryKey: SHARED_AGENTS_QUERY_KEY,
    queryFn: fetchSharedAgents,
  });
  const { data: activeAgents } = useQuery({
    queryKey: [...SHARED_AGENTS_QUERY_KEY, "active"],
    queryFn: fetchSharedAgentsActive,
    staleTime: 30_000,
  });

  // 选中 runtime 后才可用 RemoteFolderPicker 浏览（writable_dir ⊆ allowed_roots）。
  const selectedRuntimeId = Form.useWatch("pinned_runtime_id", form);

  /** 在线 runtime 下拉选项：机器在线 + runtime 在线（双向，D-003）。 */
  const runtimeOptions = useMemo<RuntimeOption[]>(() => {
    const options: RuntimeOption[] = [];
    for (const machine of machines) {
      if (machine.status !== "online") continue;
      for (const runtime of machine.runtimes) {
        if (runtime.status !== "online") continue;
        const providerLabel = runtime.provider
          ? PROVIDER_META[runtime.provider]?.label ?? runtime.provider
          : "未知提供方";
        options.push({
          value: runtime.id,
          label: `${machine.display_alias ?? machine.hostname} · ${providerLabel}`,
          machine,
          runtime,
        });
      }
    }
    return options;
  }, [machines]);

  // 列表行 join 用索引：runtimeId→选项 / workspaceId→名 / grantId→active 摘要。
  const runtimeById = useMemo(
    () => new Map(runtimeOptions.map((opt) => [opt.value, opt])),
    [runtimeOptions],
  );
  const workspaceById = useMemo(
    () =>
      new Map(
        (workspacesResp?.items ?? []).map((w) => [w.id, w.display_alias ?? w.name]),
      ),
    [workspacesResp],
  );
  const activeById = useMemo(
    () => new Map((activeAgents ?? []).map((a) => [a.id, a])),
    [activeAgents],
  );

  const handleCreate = async (values: SharedAgentFormValues) => {
    setCreating(true);
    try {
      const resp = await createSharedAgent({
        agent_profile_id: values.agent_profile_id,
        pinned_runtime_id: values.pinned_runtime_id,
        source_workspace_id: values.source_workspace_id,
        writable_dir: values.writable_dir.trim(),
        // R-05：本表单只列 platform 可见档案，无需显式升级。
        promote_visibility: false,
      });
      notify.success(
        resp.visibility_promoted
          ? "共享智能体已创建（档案可见性已升级为平台级）"
          : "共享智能体已创建，全体用户可在会话选择器中使用",
      );
      form.resetFields();
      void queryClient.invalidateQueries({ queryKey: SHARED_AGENTS_QUERY_KEY });
      // 档案可能被服务端升级为 platform——刷新档案下拉数据源。
      void queryClient.invalidateQueries({
        queryKey: agentProfileQueryKeys.platformList,
      });
    } catch (err) {
      notify.error(err, "创建共享智能体失败");
    } finally {
      setCreating(false);
    }
  };

  // 头部折叠摘要：生效/总数计数（折叠时也要能看到大盘）。
  const enabledCount = sharedAgents?.filter((a) => a.enabled).length ?? 0;

  /** 启用/停用软开关（PATCH enabled 真假双向）。 */
  const handleToggle = async (row: SharedAgentView) => {
    setTogglingId(row.id);
    try {
      await setSharedAgentEnabled(row.id, !row.enabled);
      notify.success(row.enabled ? "共享智能体已停用" : "共享智能体已启用");
      void queryClient.invalidateQueries({ queryKey: SHARED_AGENTS_QUERY_KEY });
    } catch (err) {
      notify.error(err, row.enabled ? "停用共享智能体失败" : "启用共享智能体失败");
    } finally {
      setTogglingId(null);
    }
  };

  /** 物理删除（modal.confirm 二次确认，先例 runtimes 页移除运行时）。 */
  const handleDelete = (row: SharedAgentView) => {
    const name = activeById.get(row.id)?.display_name ?? row.agent_profile_id;
    modal.confirm({
      title: "删除共享智能体",
      content: `确定删除共享智能体「${name}」？删除后全体用户的会话选择器立即不再呈现，且不可恢复（智能体档案本身不受影响）。`,
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        setDeletingId(row.id);
        try {
          await deleteSharedAgent(row.id);
          notify.success("共享智能体已删除");
          void queryClient.invalidateQueries({ queryKey: SHARED_AGENTS_QUERY_KEY });
        } catch (err) {
          notify.error(err, "删除共享智能体失败");
        } finally {
          setDeletingId(null);
        }
      },
    });
  };

  return (
    <section
      aria-label="平台共享智能体"
      data-testid="platform-shared-agents-card"
      className="rounded-lg border bg-card p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Bot className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold">平台共享智能体</h2>
        <Tag color="purple">仅平台管理员</Tag>
        <span className="text-[11px] text-muted-foreground">
          把管理员名下的守护进程 + 智能体档案共享给全体用户（含无守护进程的新用户）
        </span>
        {sharedAgents && (
          <span
            className="text-[11px] text-muted-foreground"
            data-testid="platform-shared-agents-summary"
          >
            {enabledCount} 个生效 / 共 {sharedAgents.length} 个
          </span>
        )}
        <Button
          type="text"
          size="small"
          className="ml-auto flex items-center gap-1 px-1.5 text-xs"
          aria-expanded={expanded}
          data-testid="platform-shared-agents-toggle"
          icon={
            expanded ? (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            )
          }
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "收起" : "展开"}
        </Button>
      </div>

      {expanded && (
        <>
      <Form
        form={form}
        layout="vertical"
        onFinish={handleCreate}
        className="mt-3 grid grid-cols-1 gap-x-4 md:grid-cols-2"
      >
        <Form.Item
          name="agent_profile_id"
          label="智能体档案（platform 可见）"
          rules={[{ required: true, message: "请选择智能体档案" }]}
        >
          <Select
            placeholder="选择 platform 可见的档案"
            allowClear
            options={platformProfiles.map((p) => ({
              value: p.id,
              label: `${p.name}（${p.provider}）`,
            }))}
          />
        </Form.Item>
        <Form.Item
          name="pinned_runtime_id"
          label="守护进程（仅管理员自己名下在线）"
          rules={[{ required: true, message: "请选择自己名下在线的守护进程" }]}
        >
          <Select
            placeholder="选择自己名下在线的守护进程 runtime"
            allowClear
            options={runtimeOptions.map((opt) => ({
              value: opt.value,
              label: opt.label,
            }))}
            notFoundContent={
              <span className="text-xs text-muted-foreground">
                暂无自己名下在线的守护进程 runtime
              </span>
            }
          />
        </Form.Item>
        <Form.Item
          name="source_workspace_id"
          label="平台源码工作区（只读锚定）"
          rules={[{ required: true, message: "请选择源码工作区" }]}
        >
          <Select
            placeholder="选择平台源码工作区"
            allowClear
            showSearch
            optionFilterProp="label"
            options={(workspacesResp?.items ?? []).map((w) => ({
              value: w.id,
              label: w.display_alias ?? w.name,
            }))}
          />
        </Form.Item>
        {/* label-only 外层 Item（extra 提示），name 挂在内层 noStyle Item 上——
            antd Form.Item 只向直接子元素注入 value/onChange，Input 与「浏览」按钮
            并排时必须拆两层（antd 官方复合控件模式）。 */}
        <Form.Item
          label="共享输出目录 writable_dir（会话唯一可写位置）"
          required
          extra="须在所选守护进程的可写目录（allowed_roots）内，服务端校验。"
        >
          <div className="flex items-center gap-2">
            <Form.Item
              name="writable_dir"
              noStyle
              rules={[{ required: true, message: "请填写共享输出目录" }]}
            >
              <Input
                placeholder="例如 C:\share\outputs"
                aria-label="共享输出目录 writable_dir 路径输入"
              />
            </Form.Item>
            <Button
              size="small"
              icon={<FolderOpen className="h-3.5 w-3.5" aria-hidden />}
              disabled={!selectedRuntimeId}
              onClick={() => setPickerOpen(true)}
              title={
                selectedRuntimeId
                  ? "浏览守护进程目录"
                  : "先选择守护进程 runtime 再浏览"
              }
            >
              浏览
            </Button>
          </div>
        </Form.Item>
        <div className="md:col-span-2">
          <Button
            type="primary"
            htmlType="submit"
            loading={creating}
            icon={<Plus className="h-3.5 w-3.5" aria-hidden />}
          >
            新建共享
          </Button>
        </div>
      </Form>

      {listError && (
        <p className="mt-2 text-xs text-destructive">
          共享列表加载失败，请刷新重试。
        </p>
      )}
      <Table<SharedAgentView>
        className="mt-3"
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={sharedAgents ?? []}
        locale={{ emptyText: "暂无共享智能体" }}
        columns={[
          {
            title: "共享智能体",
            key: "profile",
            render: (_, row) => {
              const name =
                activeById.get(row.id)?.display_name ?? row.agent_profile_id;
              return (
                <span className="font-medium text-foreground">{name}</span>
              );
            },
          },
          {
            title: "绑定守护进程",
            key: "runtime",
            render: (_, row) => {
              const opt = runtimeById.get(row.pinned_runtime_id);
              return (
                <div className="min-w-0">
                  <div>{opt ? opt.label : "—"}</div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    可写 {row.writable_dir}
                  </div>
                </div>
              );
            },
          },
          {
            title: "源码工作区",
            key: "workspace",
            render: (_, row) =>
              workspaceById.get(row.source_workspace_id) ?? "—",
          },
          {
            title: "状态",
            key: "status",
            render: (_, row) => (
              <span className="flex flex-wrap items-center gap-1.5">
                {row.enabled ? (
                  <Badge status="success" text="生效中 · 全体可用" />
                ) : (
                  <Badge status="default" text="已停用" />
                )}
                {row.enabled &&
                  (activeById.get(row.id)?.runtime_online ? (
                    <Badge status="processing" text="runtime 在线" />
                  ) : (
                    <Badge status="warning" text="runtime 离线" />
                  ))}
              </span>
            ),
          },
          {
            title: "操作",
            key: "action",
            align: "center",
            width: 160,
            render: (_, row) => (
              <span className="flex items-center justify-center gap-1">
                <Button
                  size="small"
                  loading={togglingId === row.id}
                  onClick={() => void handleToggle(row)}
                >
                  {row.enabled ? "停用" : "启用"}
                </Button>
                <Button
                  size="small"
                  danger
                  loading={deletingId === row.id}
                  onClick={() => handleDelete(row)}
                >
                  删除
                </Button>
              </span>
            ),
          },
        ]}
      />

      <p className="mt-3 rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-muted-foreground">
        共享后<b className="text-brand-700">全体用户</b>
        （含无守护进程的新用户）在会话的机器/智能体选择器中可直接选中它开会话：读平台源码不受限（答功能问题有真实依据），
        <b className="text-brand-700">写操作限制在共享输出目录内</b>
        （可生成文档、原型图等），源码工作区不可写。
      </p>

      {/* writable_dir 远程目录浏览：选中 runtime 后可用（listRoots/listDir 走其
          daemon RPC，天然受 allowed_roots 白名单约束）。 */}
      {pickerOpen && selectedRuntimeId ? (
        <RemoteFolderPicker
          runtimeId={selectedRuntimeId}
          open={pickerOpen}
          initialPath={form.getFieldValue("writable_dir") ?? ""}
          onClose={() => setPickerOpen(false)}
          onPick={(path) => {
            form.setFieldValue("writable_dir", path);
            setPickerOpen(false);
          }}
        />
      ) : null}
        </>
      )}
    </section>
  );
}

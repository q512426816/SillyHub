"use client";

/**
 * 智能体档案管理页（task-12，变更 2026-08-02-agent-profile-layer）。
 *
 * 列表 + 新建/编辑/复制/删除，对齐 prototype v2 画面①。
 *  - 系统预置档案（is_system_default）行：只读（后端拒改/拒删），不显示编辑/复制/删除。
 *  - 工具策略列：tool_policy_id（UUID）解析为名称（useWorkspaceToolPolicies）。
 *  - MCP/技能列：引用名以 antd Tag 展示，空 → 「—」。
 *  - 表单（三组 D-011）走 <AgentProfileForm>（antd Modal）。
 *
 * 设计依据：design §11 + D-011（三组表单）/ D-009（三级 visibility）/
 * FRONTEND_PAGE_STYLE.md（页面骨架 PageContainer/PageHeader/SectionCard/DataTable）。
 * membership 校验由 workspace layout 的 WorkspaceBindingGuard 完成，本页不重复。
 */
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { Button, Modal, Tag, type TableProps } from "antd";

import {
  PageContainer,
  PageHeader,
  SectionCard,
  DataTable,
} from "@/components/layout";
import { AgentProfileForm } from "@/components/agent-profile-form";
import {
  useCopyAgentProfile,
  useDeleteAgentProfile,
  useWorkspaceAgentProfiles,
  useWorkspaceToolPolicies,
  VISIBILITY_LABEL,
  VISIBILITY_TAG_COLOR,
  type AgentProfileRead,
} from "@/lib/agent-profiles";
import { errMessage, useNotify } from "@/lib/errors";

interface Props {
  params: { id: string };
}

export default function WorkspaceAgentProfilesPage({ params }: Props) {
  const workspaceId = params.id;
  const notify = useNotify();

  const { profiles, isLoading, isError, error, refetch } =
    useWorkspaceAgentProfiles(workspaceId);
  const { policies } = useWorkspaceToolPolicies(workspaceId);

  const copyProfile = useCopyAgentProfile(workspaceId);
  const deleteProfile = useDeleteAgentProfile(workspaceId);

  const [formState, setFormState] = useState<{
    open: boolean;
    mode: "create" | "edit";
    profile: AgentProfileRead | null;
  }>({ open: false, mode: "create", profile: null });
  const [confirmDelete, setConfirmDelete] = useState<AgentProfileRead | null>(
    null,
  );

  const policyNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of policies) m.set(p.id, p.name);
    return m;
  }, [policies]);

  const handleCopy = useCallback(
    async (p: AgentProfileRead) => {
      try {
        const copied = await copyProfile.mutateAsync({
          profileId: p.id,
          body: {}, // name/visibility 省略 → 后端取「{原名}（副本）」+ private
        });
        notify.success(`已复制为「${copied.name}」（个人可见），可继续编辑`);
      } catch (err) {
        notify.error(err, "复制档案失败");
      }
    },
    [copyProfile, notify],
  );

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    try {
      await deleteProfile.mutateAsync(target.id);
      notify.success(`档案「${target.name}」已删除`);
    } catch (err) {
      notify.error(err, "删除档案失败");
    }
  };

  const columns: TableProps<AgentProfileRead>["columns"] = useMemo(
    () => [
      {
        title: "#",
        key: "__index",
        width: 56,
        align: "center",
        fixed: "left",
        onCell: () => ({ style: { background: "hsl(var(--card))" } }),
        render: (_v, _r, i) => (i ?? 0) + 1,
      },
      {
        title: "名称",
        dataIndex: "name",
        key: "name",
        width: 200,
        render: (value: string, row) => (
          <span className="flex flex-wrap items-center gap-1">
            <span className="font-medium text-foreground">{value}</span>
            {row.is_system_default && (
              <Tag color="success">系统预置</Tag>
            )}
          </span>
        ),
      },
      {
        title: "供应商/模型",
        key: "provider_model",
        width: 180,
        render: (_v, row) => {
          const provider = row.provider;
          const model = row.model;
          if (!provider && !model)
            return <Dash />;
          return (
            <span className="font-mono text-xs">
              {provider || "—"}
              {model ? ` / ${model}` : ""}
            </span>
          );
        },
      },
      {
        title: "工具策略",
        key: "tool_policy",
        width: 140,
        render: (_v, row) => {
          if (!row.tool_policy_id) return <Dash />;
          const name = policyNameById.get(row.tool_policy_id);
          return (
            <Tag color="geekblue">{name ?? row.tool_policy_id.slice(0, 8)}</Tag>
          );
        },
      },
      {
        title: "勾选 MCP",
        dataIndex: "mcp_refs",
        key: "mcp_refs",
        width: 180,
        render: (refs: string[], row) => {
          if (row.is_system_default) return <Dash />;
          if (!refs || refs.length === 0) return <Dash />;
          return (
            <span className="flex flex-wrap gap-1">
              {refs.map((r) => (
                <Tag key={r}>{r}</Tag>
              ))}
            </span>
          );
        },
      },
      {
        title: "勾选技能",
        dataIndex: "skill_refs",
        key: "skill_refs",
        width: 180,
        render: (refs: string[], row) => {
          if (row.is_system_default) return <Dash />;
          if (!refs || refs.length === 0) return <Dash />;
          return (
            <span className="flex flex-wrap gap-1">
              {refs.map((r) => (
                <Tag key={r} color="cyan">
                  {r}
                </Tag>
              ))}
            </span>
          );
        },
      },
      {
        title: "可见范围",
        dataIndex: "visibility",
        key: "visibility",
        width: 90,
        align: "center",
        render: (v: AgentProfileRead["visibility"], row) => {
          if (row.is_system_default) {
            return <Tag color="success">{VISIBILITY_LABEL[v]}</Tag>;
          }
          return <Tag color={VISIBILITY_TAG_COLOR[v]}>{VISIBILITY_LABEL[v]}</Tag>;
        },
      },
      {
        title: "版本",
        dataIndex: "version",
        key: "version",
        width: 70,
        align: "center",
        render: (v: number) => `v${v}`,
      },
      {
        title: "操作",
        key: "__actions",
        fixed: "right",
        width: 180,
        align: "center",
        onCell: () => ({ style: { background: "hsl(var(--card))" } }),
        render: (_v, row) => {
          if (row.is_system_default) {
            return (
              <span className="text-xs text-muted-foreground">（只读）</span>
            );
          }
          return (
            <div className="flex justify-center gap-1">
              <Button
                size="small"
                type="link"
                onClick={() =>
                  setFormState({ open: true, mode: "edit", profile: row })
                }
              >
                编辑
              </Button>
              <Button
                size="small"
                type="link"
                loading={copyProfile.isPending}
                onClick={() => void handleCopy(row)}
              >
                复制
              </Button>
              <Button
                size="small"
                type="link"
                danger
                onClick={() => setConfirmDelete(row)}
              >
                删除
              </Button>
            </div>
          );
        },
      },
    ],
    [policyNameById, copyProfile.isPending, handleCopy],
  );

  return (
    <PageContainer size="full">
      <PageHeader
        title={
          <span className="flex flex-col gap-0.5">
            <span>智能体档案</span>
            <Link
              href={`/workspaces/${workspaceId}`}
              className="text-[11px] font-normal text-muted-foreground hover:underline"
            >
              ← 工作区
            </Link>
          </span>
        }
        subtitle="管理可复用的智能体配置：供应商/模型/系统提示词/MCP 与技能引用。系统预置档案只读。"
        actions={
          <Button onClick={() => void refetch()}>刷新</Button>
        }
      />

      {isError && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {errMessage(error, "加载智能体档案失败")}
          <Button className="ml-3" onClick={() => void refetch()}>
            重新加载
          </Button>
        </div>
      )}

      <SectionCard bodyPadding="p-2">
        <div className="mb-2 flex items-center justify-end gap-2">
          <Button
            type="primary"
            onClick={() =>
              setFormState({ open: true, mode: "create", profile: null })
            }
          >
            + 新建档案
          </Button>
        </div>

        <DataTable<AgentProfileRead>
          rowKey={(row) => row.id}
          columns={columns}
          dataSource={profiles}
          loading={isLoading}
          size="small"
          bordered
          scroll={{ x: "max-content", y: "calc(100vh - 430px)" }}
          pagination={{
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (t) => `共 ${t} 条`,
          }}
          emptyText="暂无智能体档案"
        />
      </SectionCard>

      {formState.open && (
        <AgentProfileForm
          mode={formState.mode}
          workspaceId={workspaceId}
          profile={formState.profile}
          onClose={() =>
            setFormState({ open: false, mode: "create", profile: null })
          }
        />
      )}

      {confirmDelete && (
        <Modal
          open
          title="确认删除智能体档案？"
          onCancel={() => setConfirmDelete(null)}
          onOk={() => void handleConfirmDelete()}
          okText="确认删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          confirmLoading={deleteProfile.isPending}
          maskClosable={false}
          destroyOnClose
        >
          <p className="mt-2 text-xs text-muted-foreground">
            将删除档案 <span className="font-mono">{confirmDelete.name}</span>
            （v{confirmDelete.version}）。该操作不可恢复。
          </p>
        </Modal>
      )}
    </PageContainer>
  );
}

/** 统一空值占位（FRONTEND_PAGE_STYLE.md §4：空值显示「—」）。 */
function Dash() {
  return <span className="text-xs text-muted-foreground">—</span>;
}

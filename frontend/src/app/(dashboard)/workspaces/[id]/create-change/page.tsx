"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { listComponents, type Component } from "@/lib/components";
import {
  createChange,
  proxyCreateChange,
  type CreateChangeInput,
} from "@/lib/changes";
import { listDaemonRuntimes, type DaemonRuntimeRead } from "@/lib/daemon";
import { getWorkspace, type Workspace } from "@/lib/workspaces";

interface Props {
  params: { id: string };
}

export default function CreateChangePage({ params }: Props) {
  const workspaceId = params.id;
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [components, setComponents] = useState<Component[]>([]);
  const [selectedComponents, setSelectedComponents] = useState<string[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [runtimes, setRuntimes] = useState<DaemonRuntimeRead[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listComponents(workspaceId)
      .then((list) => setComponents(list.items ?? []))
      .catch(() => {});
  }, [workspaceId]);

  useEffect(() => {
    let active = true;
    setWorkspaceLoading(true);
    Promise.all([
      getWorkspace(workspaceId),
      listDaemonRuntimes().catch(() => [] as DaemonRuntimeRead[]),
    ])
      .then(([ws, runtimeList]) => {
        if (!active) return;
        setWorkspace(ws);
        setRuntimes(runtimeList);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof ApiError ? err.message : "加载工作区信息失败");
      })
      .finally(() => {
        if (active) setWorkspaceLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  const daemonRuntimeId = workspace?.daemon_runtime_id ?? null;
  const boundRuntime = useMemo(() => {
    if (!daemonRuntimeId) return null;
    return runtimes.find((r) => r.id === daemonRuntimeId) ?? null;
  }, [daemonRuntimeId, runtimes]);
  const isDaemonClient = workspace?.path_source === "daemon-client";
  const daemonDisabledReason = isDaemonClient
    ? !daemonRuntimeId || boundRuntime?.status !== "online"
      ? "需要在线 daemon 才能在客户端工作区创建变更"
      : null
    : null;
  const submitDisabled =
    loading ||
    workspaceLoading ||
    workspace === null ||
    !description.trim() ||
    daemonDisabledReason !== null;

  const handleSubmit = async () => {
    if (!description.trim()) return;
    if (workspace === null) {
      setError("工作区信息加载失败，请刷新后重试");
      return;
    }
    if (daemonDisabledReason) {
      setError(daemonDisabledReason);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const input: CreateChangeInput = {
        title: description.trim().slice(0, 100),
        description: description.trim(),
        affected_components:
          selectedComponents.length > 0 ? selectedComponents : undefined,
      };
      const result =
        isDaemonClient && daemonRuntimeId
          ? await proxyCreateChange(workspaceId, {
              title: input.title,
              description: input.description,
              change_type: input.change_type,
              runtime_id: daemonRuntimeId,
            })
          : await createChange(workspaceId, input);
      router.push(`/workspaces/${workspaceId}/changes/${result.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "DAEMON_CLIENT_NO_SESSION") {
        setError("当前 daemon 未在线，无法在客户端工作区创建变更，请启动 daemon 后重试");
      } else {
        setError(err instanceof ApiError ? err.message : "创建变更失败");
      }
    } finally {
      setLoading(false);
    }
  };

  const toggleComponent = (id: string) => {
    setSelectedComponents((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  };

  return (
    <PageContainer size="narrow">
      <PageHeader
        title="新建变更"
        subtitle={
          <Link
            href={`/workspaces/${workspaceId}/changes`}
            className="hover:underline"
          >
            ← 变更列表
          </Link>
        }
      />

      {error && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <SectionCard>
        <div className="space-y-4">
          {/* 需求描述 */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              需求描述 *
            </label>
            <textarea
              className="w-full min-h-[160px] resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none"
              placeholder="描述你的需求，智能体会自动分析影响范围和流程"
              rows={8}
              maxLength={5000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              智能体会自动判断变更规模、影响模块和需要走哪些流程
            </p>
          </div>

          {/* 关联组件 */}
          {components.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                关联模块（可选）
              </label>
              <div className="flex flex-wrap gap-1.5">
                {components.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => toggleComponent(c.component_key)}
                    className={`rounded border px-2 py-1 text-[11px] transition-colors ${
                      selectedComponents.includes(c.component_key)
                        ? "border-primary bg-primary/8 text-primary"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 提交 */}
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={submitDisabled}
              title={daemonDisabledReason ?? undefined}
            >
              {loading ? "创建中…" : "提交需求"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => router.back()}>
              取消
            </Button>
          </div>
        </div>
      </SectionCard>
    </PageContainer>
  );
}

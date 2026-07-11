"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { listComponents, type Component } from "@/lib/components";
import { proxyCreateChange } from "@/lib/changes";
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
    getWorkspace(workspaceId)
      .then((ws) => {
        if (active) setWorkspace(ws);
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

  // D-002@v1：runtime 由后端从 binding + workspace.default_agent 现算，前端不再
  // 校验 daemon 在线状态（提交时由后端心跳校验，离线返 DAEMON_CLIENT_NO_SESSION）。
  const submitDisabled =
    loading || workspaceLoading || workspace === null || !description.trim();

  const handleSubmit = async () => {
    if (!description.trim()) return;
    if (workspace === null) {
      setError("工作区信息加载失败，请刷新后重试");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // task-11 / 2026-07-10-remove-server-local-workspace-mode：
      // 平台唯一 daemon-client 语义，永远走 proxy-create（不传 runtime_id，
      // 后端从 member binding 现算 daemon）。affected_components 不经 proxy 透传。
      const result = await proxyCreateChange(workspaceId, {
        title: description.trim().slice(0, 100),
        description: description.trim(),
      });
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
                    key={c.component_key}
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
            <Button size="sm" onClick={handleSubmit} disabled={submitDisabled}>
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

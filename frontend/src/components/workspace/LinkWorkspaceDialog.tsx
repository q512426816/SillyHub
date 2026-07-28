"use client";

/**
 * 关联工作区弹窗(change 2026-07-28-ppm-project-link-workspace task-10 / FR-02)。
 *
 * 从项目维护页行内「关联工作区」按钮打开,对单个 PPM 项目绑定/解绑工作区。
 * 调项目侧 API(lib/workspace.ts listProjectWorkspaces/linkWorkspace/unlinkWorkspace),
 * 与工作区详情页 LinkedProjectsSection 操作同一张 ppm_project_workspace 表(双边对称)。
 *
 * UI 体系:antd(与 ppm/projects 页 PpmResourceTable 一致,CLAUDE.md 规则 19)。
 * 错误反馈用本地 state + errMessage,不依赖 antd message 静态 API 的 App 包裹。
 */
import { useCallback, useEffect, useState } from "react";
import { Modal, Spin, Empty, Tag, Button, Input } from "antd";

import { errMessage } from "@/lib/errors";
import {
  listProjectWorkspaces,
  linkWorkspace,
  unlinkWorkspace,
  type WorkspaceBrief,
} from "@/lib/workspace";
import { listWorkspaces, type Workspace } from "@/lib/workspaces";

interface Props {
  open: boolean;
  projectId: string;
  projectName: string;
  onClose: () => void;
}

// 工作区状态 → antd Tag 语义色(active 绿 / pending 蓝 / archived 灰 / deleted 红)。
function statusTag(status: string): { color: string; label: string } {
  switch (status) {
    case "active":
      return { color: "green", label: "活跃" };
    case "pending":
      return { color: "blue", label: "待启用" };
    case "archived":
      return { color: "default", label: "已归档" };
    case "deleted":
      return { color: "red", label: "已删除" };
    default:
      return { color: "default", label: status };
  }
}

export function LinkWorkspaceDialog({ open, projectId, projectName, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState<WorkspaceBrief[]>([]);
  const [all, setAll] = useState<Workspace[]>([]);
  const [keyword, setKeyword] = useState("");

  const reload = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      // 并行取已关联 + 全量工作区(后者做可选列表源)。
      const [linkedRes, allRes] = await Promise.all([
        listProjectWorkspaces(projectId),
        listWorkspaces(),
      ]);
      setLinked(linkedRes);
      setAll(allRes.items);
    } catch (err) {
      setError(errMessage(err, "加载关联工作区失败"));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open) {
      void reload();
      setKeyword("");
    }
  }, [open, reload]);

  const linkedIds = new Set(linked.map((w) => w.workspace_id));
  // 可选 = 全量中未关联且未软删除的;按关键字过滤 name。
  const available = all.filter(
    (w) =>
      !linkedIds.has(w.id) &&
      w.status !== "deleted" &&
      w.name.toLowerCase().includes(keyword.trim().toLowerCase()),
  );

  const handleBind = async (workspaceId: string) => {
    setActingId(workspaceId);
    setError(null);
    try {
      await linkWorkspace(projectId, workspaceId);
      await reload();
    } catch (err) {
      setError(errMessage(err, "绑定失败"));
    } finally {
      setActingId(null);
    }
  };

  const handleUnbind = async (workspaceId: string) => {
    setActingId(workspaceId);
    setError(null);
    try {
      await unlinkWorkspace(projectId, workspaceId);
      await reload();
    } catch (err) {
      // ApiError 403/404/409 透传,errMessage 抽 message。
      setError(errMessage(err, "解绑失败"));
    } finally {
      setActingId(null);
    }
  };

  return (
    <Modal
      title={`关联工作区 — ${projectName}`}
      open={open}
      onCancel={onClose}
      footer={null}
      width={560}
      destroyOnClose
    >
      {error && (
        <div className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <Spin spinning={loading}>
        {/* 已关联 */}
        <div className="mb-4">
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">
            已关联工作区({linked.length})
          </div>
          {linked.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂未关联工作区"
              className="my-2"
            />
          ) : (
            <ul className="divide-y rounded border">
              {linked.map((w) => {
                const tag = statusTag(w.status);
                return (
                  <li
                    key={w.workspace_id}
                    className="flex items-center justify-between px-3 py-2"
                  >
                    <span className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{w.name}</span>
                      <Tag color={tag.color}>{tag.label}</Tag>
                      {w.type && (
                        <span className="text-xs text-muted-foreground">{w.type}</span>
                      )}
                    </span>
                    <Button
                      size="small"
                      danger
                      loading={actingId === w.workspace_id}
                      onClick={() => handleUnbind(w.workspace_id)}
                    >
                      解绑
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 可关联 */}
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">
            添加工作区
          </div>
          <Input.Search
            placeholder="按名称搜索工作区"
            allowClear
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="mb-2"
          />
          {available.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={keyword ? "无匹配工作区" : "无可关联工作区"}
              className="my-2"
            />
          ) : (
            <ul className="divide-y overflow-y-auto rounded border max-h-[220px]">
              {available.map((w) => {
                const tag = statusTag(w.status);
                return (
                  <li
                    key={w.id}
                    className="flex items-center justify-between px-3 py-2"
                  >
                    <span className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{w.name}</span>
                      <Tag color={tag.color}>{tag.label}</Tag>
                      {w.type && (
                        <span className="text-xs text-muted-foreground">{w.type}</span>
                      )}
                    </span>
                    <Button
                      size="small"
                      type="primary"
                      loading={actingId === w.id}
                      onClick={() => handleBind(w.id)}
                    >
                      绑定
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Spin>
    </Modal>
  );
}

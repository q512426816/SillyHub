"use client";

/**
 * WorkspaceSessionPicker — 工作区选择器（会话新建/编辑用）。
 *
 * 依据：
 *   - task-01 / 2026-08-19-sessions-workspace-selector
 *   - design.md §FR-01 自治受控组件
 *   - new-session-form.tsx 参考 import 风格与 antd 用法
 *
 * 受控组件：消费 value + 回调 onChange。
 *   - 首项「不使用工作区（默认）」value=null
 *   - 其余按工作区 name 列出
 *   - onChange 同时带出绑定 daemon 实体 ID（从 bindingsMap 查询 + machines 校验在线）
 *
 * 空列表态禁用 + 提示文案。
 * 加载失败显示错误条 + 重新加载按钮。
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Select, Spin } from "antd";
import { ApiError } from "@/lib/api";
import { listWorkspaces } from "@/lib/workspaces";
import { fetchMyBindings } from "@/lib/workspace-binding";
import type { DaemonMachineRead } from "@/lib/daemon";

export interface WorkspaceSessionPickerProps {
  /** 当前选中的工作区 ID（null 表示「不使用工作区」）。 */
  value: string | null;
  /**
   * 选择变更回调。
   * @param workspaceId - 选中的工作区 ID，null 表示不使用工作区
   * @param boundMachineId - 该工作区绑定的在线 daemon 实体 ID，无法确定时为 null
   */
  onChange: (workspaceId: string | null, boundMachineId: string | null) => void;
  /** 禁用选择器（如提交中、无权限等场景）。 */
  disabled?: boolean;
  /** daemon 机器列表，用于校验绑定机器是否在线。 */
  machines?: DaemonMachineRead[];
}

/**
 * 解析 Select value：antd Select 的 value 为 string | undefined，
 * 将 undefined / 空字符串映射为 null（不使用工作区）。
 */
function parseSelectValue(raw: string | undefined): string | null {
  if (!raw || raw === "") return null;
  return raw;
}

/**
 * 从 bindingsMap 和 machines 中查找绑定的在线 daemon ID。
 * - 无绑定 → null
 * - 有绑定但机器离线 → null
 */
function resolveBoundMachineId(
  workspaceId: string,
  bindingsMap: Map<string, string>,
  machines?: DaemonMachineRead[],
): string | null {
  const daemonId = bindingsMap.get(workspaceId);
  if (!daemonId) return null;
  if (!machines || machines.length === 0) return daemonId;
  const machine = machines.find((m) => m.id === daemonId);
  if (!machine) return null;
  return machine.status === "online" ? daemonId : null;
}

export function WorkspaceSessionPicker({
  value,
  onChange,
  disabled = false,
  machines,
}: WorkspaceSessionPickerProps) {
  /* ── 查询工作区列表 ── */
  const {
    data: wsData,
    isLoading: wsLoading,
    error: wsError,
    refetch: refetchWs,
  } = useQuery({
    queryKey: ["workspaceSessionPicker", "workspaces"],
    queryFn: () => listWorkspaces({ limit: 100 }),
    staleTime: 5 * 60 * 1000,
  });

  /* ── 查询当前用户绑定映射 ── */
  const {
    data: bindings,
    isLoading: bindingsLoading,
    error: bindingsError,
    refetch: refetchBindings,
  } = useQuery({
    queryKey: ["workspaceSessionPicker", "myBindings"],
    queryFn: () => fetchMyBindings(),
    staleTime: 5 * 60 * 1000,
  });

  /* ── 构建 workspaceId → daemonId 映射 ── */
  const bindingsMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!bindings) return map;
    for (const b of bindings) {
      if (b.workspace_id && b.daemon_id) {
        map.set(b.workspace_id, b.daemon_id);
      }
    }
    return map;
  }, [bindings]);

  /* ── Select 选项 ── */
  const options = useMemo(() => {
    const items = wsData?.items ?? [];
    const first = { label: "不使用工作区（默认）", value: "" };
    const rest = items.map((ws) => ({
      label: ws.name,
      value: ws.id,
    }));
    return [first, ...rest];
  }, [wsData]);

  /* ── 处理选择变更 ── */
  const handleChange = (raw: string | undefined) => {
    const wsId = parseSelectValue(raw);
    if (wsId === null) {
      onChange(null, null);
      return;
    }
    const machineId = resolveBoundMachineId(wsId, bindingsMap, machines);
    onChange(wsId, machineId);
  };

  /* ── 加载中 ── */
  const loading = wsLoading || bindingsLoading;

  /* ── 错误态 ── */
  if (wsError || bindingsError) {
    const errMsg =
      wsError instanceof ApiError
        ? wsError.message
        : bindingsError instanceof ApiError
          ? bindingsError.message
          : "加载工作区数据失败";
    return (
      <Alert
        type="error"
        message="加载失败"
        description={
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            {errMsg}
            <Button
              size="small"
              onClick={() => {
                refetchWs();
                refetchBindings();
              }}
            >
              重新加载
            </Button>
          </span>
        }
        showIcon
      />
    );
  }

  /* ── 空列表态 ── */
  if (!wsLoading && (wsData?.items?.length ?? 0) === 0) {
    return (
      <span className="text-sm text-muted-foreground">
        你还未加入工作区，可在工作区页创建
      </span>
    );
  }

  return (
    <Spin spinning={loading}>
      <Select
        id="nsf-workspace"
        className="w-full"
        value={value ?? undefined}
        onChange={handleChange}
        disabled={disabled || loading}
        options={options}
        placeholder="选择工作区"
      />
    </Spin>
  );
}

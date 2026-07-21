"use client";

/**
 * WorkspacePathPicker · 工作区根目录路径选择器。
 *
 * daemon-client 工作区创建/编辑时，用户通过此组件输入或浏览远程 daemon 上的目录路径。
 * 组件自治解析 daemonId → browseRuntimeId，提供受控 Input + 「浏览」按钮 → RemoteFolderPicker。
 *
 * 依据：sillyspec changes/2026-07-21-workspace-path-dir-picker design.md §WorkspacePathPicker
 */

import { useCallback, useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RemoteFolderPicker } from "@/components/daemon/remote-folder-picker";
import { listDaemonRuntimes } from "@/lib/daemon";

export interface WorkspacePathPickerProps {
  /** 当前选中守护进程 id（""=未选）。 */
  daemonId: string;
  /** 路径（受控）。 */
  value: string;
  /** 路径变更回调。 */
  onChange: (path: string) => void;
  /** Input placeholder。 */
  placeholder?: string;
  /** 外部禁用（保存中）。 */
  disabled?: boolean;
  /** 适配两处 Input 尺寸差异。 */
  inputClassName?: string;
}

export function WorkspacePathPicker({
  daemonId,
  value,
  onChange,
  placeholder,
  disabled = false,
  inputClassName,
}: WorkspacePathPickerProps) {
  // daemonId → browseRuntimeId 解析：取该 daemon 下第一个 online runtime。
  const [browseRuntimeId, setBrowseRuntimeId] = useState<string>("");
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!daemonId) {
      setBrowseRuntimeId("");
      return;
    }
    let cancelled = false;
    void listDaemonRuntimes()
      .then((all) => {
        if (cancelled) return;
        const hit = all.find(
          (r) => r.daemon_instance_id === daemonId && r.status === "online",
        );
        setBrowseRuntimeId(hit?.id ?? "");
      })
      .catch(() => {
        if (!cancelled) setBrowseRuntimeId("");
      });
    return () => {
      cancelled = true;
    };
  }, [daemonId]);

  const canBrowse = !!browseRuntimeId;

  const handlePick = useCallback(
    (path: string) => {
      onChange(path);
      setPickerOpen(false);
    },
    [onChange],
  );

  return (
    <div className="flex items-center gap-2">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={inputClassName}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={!canBrowse}
        title={
          canBrowse ? "浏览远程目录" : "请先选择在线守护进程"
        }
        onClick={() => setPickerOpen(true)}
      >
        <FolderOpen className="mr-1 h-4 w-4" />
        浏览
      </Button>
      <RemoteFolderPicker
        runtimeId={browseRuntimeId}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={handlePick}
        initialPath={value}
      />
    </div>
  );
}

export default WorkspacePathPicker;

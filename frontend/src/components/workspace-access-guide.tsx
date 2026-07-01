"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errMessage } from "@/lib/errors";
import {
  upsertMyBinding,
  type MemberBindingUpsertRequest,
} from "@/lib/workspace-binding";

interface Props {
  workspaceId: string;
  onConfigured: () => void;
}

/**
 * Access guide card: member configures own daemon runtime + local path.
 * Shown when the current user has no binding for this workspace (FR-001/FR-003).
 */
export function WorkspaceAccessGuide({ workspaceId, onConfigured }: Props) {
  const [runtimeId, setRuntimeId] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [pathSource, setPathSource] = useState<"server-local" | "daemon-client">(
    "daemon-client",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!rootPath || saving) return;
    setSaving(true);
    setError(null);
    try {
      const req: MemberBindingUpsertRequest = {
        runtime_id: runtimeId.trim() || null,
        root_path: rootPath,
        path_source: pathSource,
      };
      await upsertMyBinding(workspaceId, req);
      onConfigured();
    } catch (err) {
      setError(errMessage(err, "保存失败"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-amber-900">
          ⚙ 配置你在此工作空间的 daemon 和本地路径
        </h3>
        <p className="mt-1 text-xs text-amber-800">
          你已被加入此工作空间。请配置你自己的守护进程和本地代码检出路径，然后才能 scan / 运行 agent。
          代码靠 git 同步，平台不碰代码内容。
        </p>
      </div>

      {error && (
        <div className="mb-3 rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <label htmlFor="runtime" className="text-xs font-medium">Daemon Runtime ID</label>
          <Input
            id="runtime"
            placeholder="你的 daemon runtime UUID"
            value={runtimeId}
            onChange={(e) => setRuntimeId(e.target.value)}
            className="text-xs"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="rootPath" className="text-xs font-medium">本地项目路径</label>
          <Input
            id="rootPath"
            placeholder="/Users/you/code/project"
            value={rootPath}
            onChange={(e) => setRootPath(e.target.value)}
            className="text-xs"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="pathSource" className="text-xs font-medium">路径来源</label>
          <select
            id="pathSource"
            value={pathSource}
            onChange={(e) =>
              setPathSource(e.target.value as "server-local" | "daemon-client")
            }
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs"
          >
            <option value="daemon-client">daemon-client</option>
            <option value="server-local">server-local</option>
          </select>
        </div>
      </div>

      <div className="mt-3 flex justify-end">
        <Button size="sm" onClick={handleSave} disabled={saving || !rootPath}>
          {saving ? "保存中…" : "保存我的接入配置"}
        </Button>
      </div>
    </div>
  );
}

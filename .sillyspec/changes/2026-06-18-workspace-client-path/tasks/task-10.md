---
author: qinyi
created_at: 2026-06-18 11:44:49
change: 2026-06-18-workspace-client-path
id: task-10
title: "创建表单路径来源分支 + Workspace 类型扩展（frontend）"
priority: P1
depends_on: [task-01, task-04]
blocks: [task-11]
requirement_ids: [FR-01, FR-03]
decision_ids: [D-004@v1, D-005@v1]
allowed_paths:
  - frontend/src/components/workspace-scan-dialog.tsx
  - frontend/src/lib/workspaces.ts
---

# task-10 — 创建表单路径来源分支 + Workspace 类型扩展（frontend）

> Wave 4 / 前端层 / depends: task-01（后端 Workspace 模型加 `path_source` + `daemon_runtime_id`，已在 `/api/workspaces` POST/GET 响应里暴露）、task-04（backend 暴露 `POST /api/daemon/runtimes/{id}/list-dir` 转发端点 + `/api/daemon/runtimes` 已可列出在线 daemon）。本任务是 Phase 3 创建流程的 frontend 骨架：扩展 `Workspace`/`CreateWorkspaceInput` 类型，给 `WorkspaceScanDialog` 加「路径来源」单选分支（server-local 维持现状、daemon-client 分支渲染在线 daemon 下拉 + 目录浏览挂载点 + 选定 `root_path` 回填），提交 `createWorkspace` 时带上 `path_source` 与 `daemon_runtime_id`。**daemon-client 分支不触发 backend 本地 scan**（后端 task-08 处理路径派发，本任务前端侧只需把 `root_path`/`daemon_runtime_id` 透传给 `createWorkspace`）。目录浏览的树形组件本身（`daemon-dir-browser.tsx`、`daemon.ts` 的 `listDir()`）由 task-11 实现，本任务在 dialog 内只预留**挂载点**与**回调契约**。

## 1. 修改文件

| 操作 | 精确路径 | 改动概述 |
|---|---|---|
| 修改 | `frontend/src/lib/workspaces.ts` | `Workspace` 接口加 `path_source: "server-local" \| "daemon-client"`、`daemon_runtime_id: string \| null`；`CreateWorkspaceInput` 加可选 `path_source?: "server-local" \| "daemon-client"`（缺省视为 server-local，与后端 default 对齐）与可选 `daemon_runtime_id?: string`；新增 `PathSource` 类型常量导出供 dialog/其他消费方复用；**不**新增 `listDir()`（归 task-11 / `daemon.ts`） |
| 修改 | `frontend/src/components/workspace-scan-dialog.tsx` | 顶部 state 增加 `pathSource`（默认 `"server-local"`）、`daemonRuntimeId`（默认 `null`）、`daemonRootPath`（默认 `""`，daemon-client 分支专用选定路径，与 `rootPath` 解耦）；新增「路径来源」单选（server-local / daemon-client）；server-local 分支渲染**现有** root_path 输入 + 扫描按钮（行为字节级不变）；daemon-client 分支渲染「在线 daemon 下拉」+「目录浏览挂载点」（task-11 组件接入位）+ 选定 `root_path` 只读回填；`handleCreate`/`handleGenerate` 在 daemon-client 分支按 `pathSource` 透传 `path_source` + `daemon_runtime_id`，**不调** `scanWorkspace`（避免触发 backend 本地扫描，对齐 design §5 Phase3「daemon-client 跳过本地 copytree」）；handleCancel/切换 pathSource 时清空 daemon-client 相关 state |

> `allowed_paths` 严格限定上述两个源文件。`daemon-dir-browser.tsx`、`daemon.ts` 的 `listDir()`、`listOnlineRuntimes()` 由 task-11 落地；本任务在 dialog 内对 daemon 下拉复用现有 `listDaemonRuntimes()`（`frontend/src/lib/daemon.ts:20`，返回全量，前端按 `status === "online"` 过滤），**不**新增 `listOnlineRuntimes()`。若 execute 阶段判定确需 `listOnlineRuntimes()` 简化封装，属 task-11 的 `daemon.ts` 改动范畴，本任务不越界。

## 2. 覆盖来源

| 来源 ID | 类型 | 摘要 | 本任务如何落实 |
|---|---|---|---|
| **FR-01** | 功能需求 | workspaces 表加 `path_source`(默认 server-local) + `daemon_runtime_id`(FK)；daemon-client 创建时 `daemon_runtime_id` 必填；server-local/未指定时默认 server-local、`daemon_runtime_id=NULL`、创建流程与现状一致 | §4.1 类型扩展（`Workspace.path_source` / `daemon_runtime_id` / `CreateWorkspaceInput` 可选项）+ §4.3 `handleCreate` 透传；§5 E-01 默认 server-local、E-06 server-local 零行为变化 |
| **FR-03** | 功能需求 | 已选在线 daemon → 用户在创建表单展开目录节点 → 调 `POST /api/daemon/runtimes/{id}/list-dir {path}` 渲染 `{name,type}[]` 子节点（懒加载）；离线/超时 → 504 提示重试 | 本任务落实「**已选在线 daemon**」前置：§4.2 daemon-client 分支渲染在线 daemon 下拉（复用 `listDaemonRuntimes()` 过滤 `status==="online"`）+ 目录浏览挂载点（占位 + `onSelect(rootPath)` 回调契约，task-11 接入树形组件）；list-dir 调用与树形组件本身归 task-11，本任务只保证分支骨架与选定路径回填链路 |
| **D-004@v1** | 决策 | Workspace 新增 path_source(server-local/daemon-client) + daemon_runtime_id；server-local 兼容不变 | §4.1 类型 1:1 对齐 backend schema；§5 E-06 server-local 默认值 + E-01 切换语义 |
| **D-005@v1** | 决策 | daemon 新增 list_dir RPC，前端树形浏览后选定 | 本任务提供「选定」的承接点（`daemonRootPath` state + 挂载点回调），树形组件归 task-11 |
| **design §5 Phase3** | 设计 | 前端表单加「路径来源」单选；daemon-client：下拉在线 daemon → 树形浏览（调 list_dir）→ 选定 `root_path`；后端创建 daemon-client 跳过本地 copytree 扫描 | §4.2 单选 + 分支渲染；§4.3 daemon-client 不调 `scanWorkspace`；后端跳过 copytree 属 task-08 |
| **design §6（74/75 行）** | 文件清单 | `workspaces.ts` 加 path_source、daemon_runtime_id；`workspace-scan-dialog.tsx` 加路径来源单选 + daemon-client 分支 | §1 / §4.1 / §4.2 |
| **design §9** | 兼容策略 | 未配置新功能行为不变；现有 workspace path_source 默认 server-local、daemon_runtime_id=NULL；现有 `/workspaces` CRUD 签名只增字段不改语义 | §5 E-06（向后兼容，老 Workspace 响应即便缺字段也按 server-local 兜底）+ AC-12（现有 server-local 表单分支字节级不变） |

> task-01（后端模型/迁移/schema）与 task-04（backend list-dir 端点 + `/api/daemon/runtimes` 列表已就绪）是**前置依赖**。task-01 未合并时，`Workspace` 响应可能不含 `path_source`/`daemon_runtime_id` 字段——本任务类型层把 `path_source` 标为必填（类型契约），但运行时读取处用 `?? "server-local"` 兜底（§5 E-06），保证在 task-01 部分灰度环境下前端不崩。task-04 未合并时，daemon-client 分支的目录浏览挂载点会因 task-11 组件接入失败而无功能，但 dialog 骨架与 server-local 分支不受影响（§5 E-02 提示无可用 daemon 时也能渲染）。

## 3. 实现要求（编号步骤）

> 按 CLAUDE.md「文档 → 读现有代码 → 写测试 → 写实现 → 跑测试 → 验收」执行。

1. **读现有代码**：
   - `frontend/src/lib/workspaces.ts:27-58`（`Workspace` 接口现状，无 path_source/daemon_runtime_id）。
   - `frontend/src/lib/workspaces.ts:137-149`（`CreateWorkspaceInput` + `createWorkspace` 现状，POST body 仅 name/root_path/slug/spec_strategy）。
   - `frontend/src/components/workspace-scan-dialog.tsx:26-91`（组件 state：rootPath/name/scan/phase/error/scanProvider/scanModel；`handleScan` 调 `scanWorkspace(rootPath)`；server-local 全流程）。
   - `frontend/src/components/workspace-scan-dialog.tsx:70-85`（`handleCreate` 现状：`createWorkspace({ name, root_path: scan.root_path })`；本任务需按 pathSource 分支拼 body）。
   - `frontend/src/components/workspace-scan-dialog.tsx:94-235`（JSX 结构：root-path 输入 + 扫描按钮 + scan 结果区 + Agent provider/model + 名称 + footer）。
   - `frontend/src/lib/daemon.ts:8-22`（`DaemonRuntimeRead` 类型含 `status: string | null`，`listDaemonRuntimes()` 返回全量；本任务复用此 api 做 daemon-client 下拉，**不**新增 api）。

2. **写测试（先于实现，TDD）**：见 §8。覆盖类型层（TS 编译时）+ 组件行为层（@testing-library 渲染 + mock `createWorkspace`/`listDaemonRuntimes`）。

3. **改 `workspaces.ts`（类型扩展）**：见 §4.1。

4. **改 `workspace-scan-dialog.tsx`（表单分支 + 提交透传）**：见 §4.2 / §4.3 / §4.4。

5. **跑测试**：见 §8 第 5 步。

6. **（不要做）**：
   - 不实现 `listDir()` api client（归 task-11 / `daemon.ts`）。
   - 不实现 `listOnlineRuntimes()` 封装（task-11 范畴；本任务直接调 `listDaemonRuntimes()` + 过滤）。
   - 不实现树形目录浏览组件（`daemon-dir-browser.tsx` 归 task-11）；本任务在 dialog 内只留挂载点（注释 + 回调签名预留）。
   - 不修改 backend（task-01/04/08 范畴）。
   - 不在 daemon-client 分支调 `scanWorkspace`（后端 task-08 改派 daemon 执行 scan，前端表单阶段不应触发本地扫描；对齐 design §5 Phase3「daemon-client 跳过本地 copytree」）。
   - 不在 daemon-client 分支渲染 `.sillyspec` 检测结果区（scan 结果区由 `scanWorkspace` 驱动，daemon-client 不走该路径；用户提交后由 task-08 的 daemon scan 产出回填到 workspace 详情页）。
   - 不做 path_source 创建后切换（design §3 非目标）。

## 4. 接口定义

### 4.1 `workspaces.ts` 类型扩展

```ts
// frontend/src/lib/workspaces.ts —— 紧邻 WorkspaceStatus 之后导出 PathSource

/**
 * Workspace 路径来源（task-10 / D-004@v1）。
 * - server-local:  root_path 指向 backend 服务器本地路径（现状默认）
 * - daemon-client: root_path 指向绑定 daemon 客户端机器路径，agent run 强绑该 daemon
 *
 * 后端 default 'server-local'；老数据迁移后全部为 server-local。
 * 前端读取 Workspace.path_source 时用 ?? "server-local" 兜底（§5 E-06，task-01 未合并灰度期）。
 */
export type PathSource = "server-local" | "daemon-client";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  root_path: string;
  status: WorkspaceStatus;
  // task-10 / D-004@v1：路径来源 + 绑定 daemon
  path_source: PathSource;
  daemon_runtime_id: string | null;
  // Component metadata fields（现状不变）
  component_key: string | null;
  type: string | null;
  role: string | null;
  repo_url: string | null;
  default_branch: string | null;
  default_agent: string | null;
  default_model: string | null;
  tech_stack: string[];
  build_command: string | null;
  test_command: string | null;
  source_yaml_path: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_scanned_at: string | null;
  deleted_at: string | null;
}

export interface CreateWorkspaceInput {
  name: string;
  root_path: string;
  slug?: string;
  spec_strategy?: string;
  /**
   * task-10 / D-004@v1：路径来源。缺省由后端填 'server-local'；
   * 前端为可空以保持 server-local 现状调用零改动（不传即 server-local）。
   * daemon-client 时必填且 daemon_runtime_id 必填（后端 validator 强制 400，§5 E-04）。
   */
  path_source?: PathSource;
  /** task-10 / D-004@v1：daemon-client 时必填（与 path_source 一起透传）。 */
  daemon_runtime_id?: string;
}
```

> `createWorkspace` 函数体**不动**——它已用 `apiFetch<Workspace>("/api/workspaces", { method: "POST", json: input })`，input 多出的可选字段会自动序列化进 body；TS 类型扩展后，调用方传不传 `path_source`/`daemon_runtime_id` 都通过编译。

### 4.2 `WorkspaceScanDialog` 新增 state + 分支渲染

```tsx
// frontend/src/components/workspace-scan-dialog.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { AgentModelInput } from "@/components/AgentModelInput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AgentProviderSelect } from "@/components/AgentProviderSelect";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import {
  createWorkspace,
  scanGenerate,
  scanWorkspace,
  type PathSource,
  type ScanResult,
} from "@/lib/workspaces";
// 复用现有 daemon runtime api（task-11 会加 listOnlineRuntimes 封装，本任务直接用 listDaemonRuntimes）
import { listDaemonRuntimes, type DaemonRuntimeRead } from "@/lib/daemon";

type Phase = "idle" | "scanning" | "ready" | "creating";

interface Props {
  onCreated: () => void;
  onCancel: () => void;
}

export function WorkspaceScanDialog({ onCreated, onCancel }: Props) {
  const router = useRouter();

  // server-local 分支现有 state（不变）
  const [rootPath, setRootPath] = useState("");
  const [name, setName] = useState("");
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [scanProvider, setScanProvider] = useState<string | null>(null);
  const [scanModel, setScanModel] = useState<string | null>(null);

  // task-10：路径来源 + daemon-client 分支 state
  const [pathSource, setPathSource] = useState<PathSource>("server-local");
  const [daemonRuntimes, setDaemonRuntimes] = useState<DaemonRuntimeRead[]>([]);
  const [daemonRuntimesLoading, setDaemonRuntimesLoading] = useState(false);
  const [daemonRuntimesError, setDaemonRuntimesError] = useState<string | null>(null);
  const [daemonRuntimeId, setDaemonRuntimeId] = useState<string | null>(null);
  // daemon-client 分支用户在目录浏览组件中选定的 root_path（与 server-local 的 rootPath 解耦）
  const [daemonRootPath, setDaemonRootPath] = useState<string>("");

  // 切到 daemon-client 分支时懒加载在线 daemon 列表；切回 server-local 时清空 daemon state
  useEffect(() => {
    if (pathSource !== "daemon-client") return;
    let cancelled = false;
    setDaemonRuntimesLoading(true);
    setDaemonRuntimesError(null);
    listDaemonRuntimes()
      .then((all) => {
        if (cancelled) return;
        // status 字段是 string | null（daemon.ts:13），online 才可选
        const online = all.filter((r) => r.status === "online");
        setDaemonRuntimes(online);
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = e instanceof ApiError ? `${e.code}: ${e.message}` : "加载 daemon 列表失败";
        setDaemonRuntimesError(msg);
      })
      .finally(() => {
        if (!cancelled) setDaemonRuntimesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pathSource]);

  // 切换 pathSource 时清空另一分支的脏 state（§5 E-05）
  function handlePathSourceChange(next: PathSource) {
    if (next === pathSource) return;
    setPathSource(next);
    // 双向清空：切到任一分支都把另一分支的路径/选择清掉，避免残留误提交
    if (next === "server-local") {
      setDaemonRuntimeId(null);
      setDaemonRootPath("");
    } else {
      setRootPath("");
      setScan(null);
      setPhase("idle");
    }
    setError(null);
  }

  // ...现有 handleScan / handleGenerate 不变（仅 server-local 分支调用）...

  // task-11 目录浏览组件的挂载点回调契约：
  // 当用户在树形组件选定一个目录作为 workspace root_path 时，组件调 onSelect(absPath)。
  // 本任务只实现 state 承接；组件实现归 task-11。
  function handleDaemonRootPathSelect(absPath: string) {
    setDaemonRootPath(absPath);
    // 自动回填 name（沿用 server-local 的 last-segment 策略）
    if (!name) {
      const last = absPath.split(/[\\/]/).filter(Boolean).at(-1);
      if (last) setName(last);
    }
  }

  const handleCreate = async () => {
    setError(null);
    setPhase("creating");
    try {
      if (pathSource === "server-local") {
        // server-local：现状不变，scan 必须已就绪
        if (!scan) {
          setError("请先扫描仓库路径");
          setPhase("idle");
          return;
        }
        await createWorkspace({
          name: name.trim() || rootPath,
          root_path: scan.root_path,
          // path_source 缺省由后端填 server-local；显式传可读性更好但非必须
        });
      } else {
        // daemon-client：不调 scanWorkspace（后端 task-08 派给绑定 daemon 执行）
        if (!daemonRuntimeId) {
          setError("请先选择在线 daemon");
          setPhase("idle");
          return;
        }
        if (!daemonRootPath) {
          setError("请在目录浏览器中选定 root_path");
          setPhase("idle");
          return;
        }
        await createWorkspace({
          name: name.trim() || daemonRootPath,
          root_path: daemonRootPath,
          path_source: "daemon-client",
          daemon_runtime_id: daemonRuntimeId,
        });
      }
      onCreated();
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.code}: ${err.message}` : "创建失败";
      setError(msg);
      setPhase("ready");
    }
  };

  // ...handleCancel/handleGenerate 按 pathSource 分支决定是否可用...

  return (
    <div className="rounded-md border bg-card">
      {/* header 不变 */}
      <div className="space-y-4 p-4">
        {/* task-10：路径来源单选（design §5 Phase3 / §6 第 75 行） */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">路径来源</label>
          <div className="flex gap-4">
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="radio"
                name="path-source"
                value="server-local"
                checked={pathSource === "server-local"}
                onChange={() => handlePathSourceChange("server-local")}
                disabled={phase === "scanning" || phase === "creating"}
              />
              服务器本地路径（server-local）
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="radio"
                name="path-source"
                value="daemon-client"
                checked={pathSource === "daemon-client"}
                onChange={() => handlePathSourceChange("daemon-client")}
                disabled={phase === "scanning" || phase === "creating"}
              />
              Daemon 客户端路径（daemon-client）
            </label>
          </div>
          <p className="text-[11px] text-muted-foreground">
            server-local 指向 backend 可达的本地路径；daemon-client 指向绑定 daemon 机器路径，
            agent run 将强绑该 daemon。
          </p>
        </div>

        {/* server-local 分支：现有 root_path 输入 + 扫描按钮（字节级不变，仅外层加条件渲染） */}
        {pathSource === "server-local" && (
          <div className="space-y-1.5">
            {/* ...现有 root-path Input + 扫描 Button（94-128 行原样迁移到此处）... */}
          </div>
        )}

        {/* daemon-client 分支：在线 daemon 下拉 + 目录浏览挂载点 + 选定 root_path 回填 */}
        {pathSource === "daemon-client" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="daemon-runtime">
                在线 Daemon
              </label>
              <select
                id="daemon-runtime"
                value={daemonRuntimeId ?? ""}
                onChange={(e) => {
                  setDaemonRuntimeId(e.target.value || null);
                  // 切 daemon 时清空已选 root_path（不同 daemon 文件系统不同）
                  setDaemonRootPath("");
                }}
                disabled={
                  daemonRuntimesLoading ||
                  phase === "creating" ||
                  daemonRuntimes.length === 0
                }
                className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              >
                <option value="">
                  {daemonRuntimesLoading
                    ? "加载中..."
                    : daemonRuntimes.length === 0
                      ? "无在线 daemon"
                      : "请选择 daemon"}
                </option>
                {daemonRuntimes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name ?? r.id}（{r.provider ?? "unknown"}）
                  </option>
                ))}
              </select>
              {daemonRuntimesError && (
                <p className="text-[11px] text-destructive">{daemonRuntimesError}</p>
              )}
              {daemonRuntimes.length === 0 && !daemonRuntimesLoading && !daemonRuntimesError && (
                <p className="text-[11px] text-muted-foreground">
                  当前无在线 daemon，请先在目标机器启动 sillyhub-daemon。
                </p>
              )}
            </div>

            {/* task-11 目录浏览组件挂载点：daemon 选定后才渲染。
                本任务以占位 div + 注释表明契约；task-11 用 <DaemonDirBrowser runtimeId={...} onSelect={...} /> 替换。 */}
            {daemonRuntimeId && (
              <div
                data-testid="daemon-dir-browser-mount"
                className="rounded border border-dashed bg-muted/20 p-3 text-[11px] text-muted-foreground"
              >
                {/* task-11: <DaemonDirBrowser runtimeId={daemonRuntimeId} onSelect={handleDaemonRootPathSelect} /> */}
                目录浏览组件（task-11 接入）：选定目录后将回填下方 root_path。
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                选定 root_path（daemon 客户端机器绝对路径）
              </label>
              <Input
                value={daemonRootPath}
                placeholder="在上方目录浏览器中选定后自动回填"
                readOnly
                disabled={phase === "creating"}
              />
            </div>
          </div>
        )}

        {/* scan 结果区 + Agent provider/model + 名称 + footer：仅 server-local 分支显示 scan 区；
            daemon-client 分支只显示名称 + footer（无 scan 结果，§3 非目标） */}
        {/* ... */}
      </div>
    </div>
  );
}
```

### 4.3 `handleCreate` 分支伪代码（精简版）

```text
handleCreate():
  if pathSource == "server-local":
    require scan != null            # 否则提示"请先扫描"（§5 E-04 server-local 侧）
    createWorkspace({
      name: name || rootPath,
      root_path: scan.root_path,
      # path_source 不传 → 后端 default server-local（design §8）
    })
  else:  # daemon-client
    require daemonRuntimeId != null  # 否则提示"请先选择在线 daemon"（§5 E-02）
    require daemonRootPath != ""     # 否则提示"请选定 root_path"（§5 E-04 daemon-client 侧）
    createWorkspace({
      name: name || daemonRootPath,
      root_path: daemonRootPath,
      path_source: "daemon-client",
      daemon_runtime_id: daemonRuntimeId,
    })
  onCreated()
```

### 4.4 「直接创建 / 生成项目规范」按钮在 daemon-client 分支的处理

- **直接创建（`handleCreate`）**：daemon-client 分支可用（条件：daemon 已选 + root_path 已选定）。按钮文案可保持「直接创建」。
- **生成项目规范（`handleGenerate` → `scanGenerate`）**：daemon-client 分支**禁用/隐藏**。理由：`scanGenerate` 现状调 `POST /api/workspaces/scan-generate { root_path }`，后端在 task-08 改造前会对 daemon-client root_path 做本地扫描（路径不可达 → 500）。本任务在 daemon-client 分支不渲染「生成项目规范」按钮，仅保留「直接创建」。task-08 落地后若需开放生成流程，属后续 task（不在本任务范围）。

> 该取舍与 design §5 Phase3「daemon-client 跳过本地 copytree 扫描」一致——表单阶段只创建 workspace，spec bootstrap 由 task-08 派 daemon 执行。

## 5. 边界处理（≥5 条）

| 编号 | 边界场景 | 期望行为 | 实现位置 |
|---|---|---|---|
| **E-01** | **默认 server-local** | 组件首次渲染 `pathSource="server-local"`；「路径来源」单选默认选中 server-local；server-local 分支的 root_path 输入 + 扫描按钮 + scan 结果区全部就绪，用户行为与改动前字节级一致。`createWorkspace` 在 server-local 分支**不**传 `path_source`（让后端 default 生效），确保即便前端漏传也走 server-local。 | §4.2 `useState<PathSource>("server-local")` + §4.3 server-local 分支不传 path_source |
| **E-02** | **daemon-client 分支未选 daemon** | 下拉值为空 → 「直接创建」按钮 disabled（或在 handleCreate 内 require daemonRuntimeId → 提示「请先选择在线 daemon」）；目录浏览挂载点不渲染（`{daemonRuntimeId && ...}`）；选定 root_path 回填框为空。用户必须先选 daemon 才能继续。 | §4.2 挂载点条件渲染 + §4.3 require 守卫 |
| **E-03** | **无在线 daemon** | `listDaemonRuntimes()` 返回全量但 filter 后 `daemonRuntimes.length === 0` → 下拉只有「无在线 daemon」option（disabled）→ 显示提示文案「当前无在线 daemon，请先在目标机器启动 sillyhub-daemon」。「直接创建」按钮 disabled。**不**报错（这是用户可恢复状态，非异常）。对齐 FR-03「已选在线 daemon」前置条件。 | §4.2 下拉 option 文案 + 提示 + 按钮 disabled |
| **E-04** | **daemon-client 分支未选定 root_path** | daemon 已选但 `daemonRootPath===""`（用户还没在目录浏览器点选）→ 「直接创建」点击后 handleCreate require 守卫提示「请在目录浏览器中选定 root_path」；`phase` 回退 idle/ready。「直接创建」按钮在 `daemonRootPath===""` 时 disabled 更佳（视觉反馈）。提交前**禁止**把空 root_path 发给后端（后端会 422）。 | §4.3 require 守卫 + 按钮 disabled 条件 |
| **E-05** | **切换 pathSource 时清空脏 state** | 用户在 server-local 分支填了 rootPath + 跑了 scan，然后切到 daemon-client → `handlePathSourceChange` 清空 `rootPath`/`scan`/`phase`（避免 server-local 的 scan.root_path 被误带到 daemon-client 提交）；反向同理（daemon-client 的 daemonRuntimeId/daemonRootPath 切回 server-local 时清空）。`error` 也清。**这是防止跨分支数据污染的关键不变式**。 | §4.2 `handlePathSourceChange` |
| **E-06** | **向后兼容 / 老 Workspace 响应缺字段** | task-01 未完全合并或老 cache 的 Workspace 响应可能不含 `path_source`/`daemon_runtime_id`。类型层标为必填（TS 契约），但运行时消费方（如 workspace 详情页读 `ws.path_source`）用 `ws.path_source ?? "server-local"` 兜底，`ws.daemon_runtime_id ?? null` 兜底。本任务的 dialog 只**写**不**读** Workspace（创建场景），所以主要兜底责任在消费 Workspace 的其他组件；本任务在 §4.1 类型注释中明确该约定。`CreateWorkspaceInput.path_source` 标可选，保证 server-local 现有调用方零改动通过编译。 | §4.1 类型注释 + `CreateWorkspaceInput` 可选字段 |
| **E-07** | **daemon 列表加载失败 / 网络错** | `listDaemonRuntimes()` reject → `daemonRuntimesError` 显示错误文案（`${code}: ${message}` 或「加载 daemon 列表失败」）；下拉回到「无在线 daemon」状态；用户可切回 server-local 继续。**不**自动重试（避免抖动；用户重新切到 daemon-client 分支会再次触发 useEffect 重载）。 | §4.2 useEffect catch |
| **E-08** | **切换已选 daemon 时清空 root_path** | 用户在 daemon A 选了 root_path，然后切到 daemon B → onChange 清空 `daemonRootPath`（不同 daemon 文件系统不同，旧选择无效）；name 保留（用户可继续编辑）。目录浏览挂载点随 `daemonRuntimeId` 变化重新挂载（task-11 组件内部按 runtimeId 重置树）。 | §4.2 下拉 onChange 清空 daemonRootPath |
| **E-09** | **daemon-client 提交时后端 400（daemon_runtime_id 缺失/不归属）** | 后端 validator（task-01）在 path_source=daemon-client 但 daemon_runtime_id 缺失或不归属当前 user 时返 400 → `createWorkspace` reject 抛 `ApiError` → handleCreate catch 显示 `${code}: ${message}`；`phase` 回 ready；用户可改选 daemon 重试。前端不做归属预校验（后端是真理源）。 | §4.3 catch |
| **E-10** | **scanning/creating 中禁用路径来源切换** | 路径来源单选 `disabled={phase === "scanning" || phase === "creating"}`，防止扫描/创建中途切分支导致 state 错乱（scan 跑到一半切 daemon-client 会 orphan promise）。 | §4.2 单选 disabled |

## 6. 非目标（本任务不做）

- ❌ 不实现 `listDir()` api client（归 task-11 / `frontend/src/lib/daemon.ts`）。
- ❌ 不实现 `listOnlineRuntimes()` 封装（task-11 范畴；本任务直接用 `listDaemonRuntimes()` + filter）。
- ❌ 不实现 `daemon-dir-browser.tsx` 树形组件（task-11）；本任务在 dialog 内只留挂载点（占位 div + data-testid + 注释）。
- ❌ 不在 daemon-client 分支调 `scanWorkspace` / `scanGenerate`（后端 task-08 派给 daemon；design §5 Phase3 明确跳过本地扫描）。
- ❌ 不在 daemon-client 分支渲染 scan 结果区（`.sillyspec` 检测 / structure / warnings）——该区由 `scanWorkspace` 驱动，daemon-client 不走该路径。
- ❌ 不做 path_source 创建后切换（design §3 非目标）。
- ❌ 不修改 backend（task-01/04/08）。
- ❌ 不修改 `UpdateWorkspaceInput`（path_source 创建后不可改，design §3；update 不加 path_source 字段）。
- ❌ 不做 daemon-client 分支的「生成项目规范」流程（`scanGenerate` 端点在 task-08 改造前会对 daemon-client 路径做本地扫描 → 500；本任务直接隐藏该按钮，task-08 后续若开放属另一 task）。
- ❌ 不做 daemon 下拉的搜索/分页（YAGNI；当前 daemon 数量个位数）。

## 7. 参考

- design.md §5 Phase 3（前端表单路径来源单选 + daemon-client 分支）、§6（74/75 行 workspaces.ts / workspace-scan-dialog.tsx）、§7.2（list-dir 端点，task-11 调用）、§8（path_source/daemon_runtime_id 字段）、§9（兼容策略 server-local 零变化）
- requirements.md FR-01（path_source 字段 + daemon-client 时 daemon_runtime_id 必填）、FR-03（已选在线 daemon → 目录浏览 → 选定 root_path）
- decisions.md D-004@v1（新增 path_source + daemon_runtime_id 绑定）、D-005@v1（daemon list_dir RPC + 前端树形浏览）
- plan.md Wave 4 task-10 行 + 依赖图（depends task-01, task-04；blocks task-11）
- 现有代码：
  - `frontend/src/lib/workspaces.ts:27-58`（Workspace 接口）
  - `frontend/src/lib/workspaces.ts:137-149`（CreateWorkspaceInput + createWorkspace）
  - `frontend/src/components/workspace-scan-dialog.tsx:26-91`（组件 state + handleScan）
  - `frontend/src/components/workspace-scan-dialog.tsx:70-85`（handleCreate 现状）
  - `frontend/src/components/workspace-scan-dialog.tsx:94-235`（JSX 结构）
  - `frontend/src/lib/daemon.ts:8-22`（DaemonRuntimeRead + listDaemonRuntimes，本任务复用）

## 8. TDD 步骤

1. **写类型层测试（TS 编译时）**：
   - `Workspace` 接口含 `path_source: PathSource` + `daemon_runtime_id: string | null`（TS 编译断言：`const w: Workspace = { ...mock, path_source: "server-local", daemon_runtime_id: null }` 通过）。
   - `CreateWorkspaceInput` 的 `path_source`/`daemon_runtime_id` 可选（`const i: CreateWorkspaceInput = { name, root_path }` 不传 path_source 也通过编译）。
   - `PathSource` 类型仅接受 `"server-local" | "daemon-client"`（`const p: PathSource = "other"` 编译报错）。

2. **写组件行为测试（@testing-library/react + mock api，先红）**：
   - `test_renders_path_source_radio_default_server_local`：渲染 `<WorkspaceScanDialog />` → 「路径来源」单选存在 → server-local 默认选中 → root_path 输入框可见 → daemon-client 分支不可见。
   - `test_switch_to_daemon_client_loads_online_runtimes`：mock `listDaemonRuntimes` 返回 `[{id:"r1", status:"online"}, {id:"r2", status:"offline"}]` → 点 daemon-client 单选 → 下拉只含 r1（r2 被过滤）→ root_path 输入消失 → 目录浏览挂载点在未选 daemon 时不渲染。
   - `test_daemon_client_no_online_runtime_shows_hint`：mock 返回全 offline → 切 daemon-client → 下拉只有「无在线 daemon」option → 提示文案可见 → 「直接创建」disabled。
   - `test_daemon_client_daemon_selected_shows_browser_mount`：切 daemon-client + 选 r1 → `data-testid="daemon-dir-browser-mount"` 挂载点渲染。
   - `test_daemon_client_root_path_selected_via_callback`：模拟 task-11 组件调 `handleDaemonRootPathSelect("/Users/x/repo")` → 选定 root_path 回填框显示 `/Users/x/repo` → name 自动回填 `repo`。
   - `test_switching_path_source_clears_dirty_state`：server-local 填 rootPath + 跑 scan（mock scanWorkspace） → 切 daemon-client → rootPath 为空 + scan 为 null；反向同理。
   - `test_switching_daemon_clears_root_path`：daemon-client 选 r1 + 选定 root_path → 下拉切 r2 → daemonRootPath 清空。
   - `test_create_server_local_omits_path_source`：server-local 分支填路径 + scan ready → 点「直接创建」 → mock createWorkspace 被调，参数**不含** `path_source`/`daemon_runtime_id`（断言 `expect(input.path_source).toBeUndefined()`）。
   - `test_create_daemon_client_passes_path_source_and_runtime_id`：daemon-client 分支选 r1 + 选定 root_path → 点「直接创建」 → mock createWorkspace 参数为 `{ name, root_path: daemonRootPath, path_source: "daemon-client", daemon_runtime_id: "r1" }`；**不**调 scanWorkspace（断言 mock scanWorkspace 未被调用）。
   - `test_create_daemon_client_without_runtime_id_shows_error`：daemon-client 分支未选 daemon → 点「直接创建」 → 显示「请先选择在线 daemon」；createWorkspace 未被调。
   - `test_create_daemon_client_without_root_path_shows_error`：daemon-client 分支选 daemon 但未选定 root_path → 点「直接创建」 → 显示「请在目录浏览器中选定 root_path」；createWorkspace 未被调。
   - `test_daemon_client_hides_generate_button`：daemon-client 分支 → 「生成项目规范」按钮不渲染（或 disabled）；仅「直接创建」可见。
   - `test_create_failure_shows_api_error`：mock createWorkspace reject `ApiError(400, "daemon_runtime_id required")` → 错误文案显示；phase 回 ready。
   - `test_path_source_radio_disabled_during_creating`：点「直接创建」后 → 路径来源单选 disabled（防止中途切分支）。

3. **实现**：按 §3 步骤 3-4 改 `workspaces.ts` / `workspace-scan-dialog.tsx`。

4. **跑测试**：
   - `cd frontend && pnpm test src/components/workspace-scan-dialog.spec.tsx`（或项目既定组件测试命令）—— 全绿。
   - `cd frontend && pnpm test` —— 现有前端测试不回归（关键：server-local 分支表单行为零变化）。
   - `cd frontend && pnpm tsc --noEmit`（或 `pnpm build`）—— TS 严格模式 0 error。
   - `cd frontend && pnpm lint`（若项目有 ESLint/Biome）—— 无新增 lint 错。

5. **集成验收（手动，依赖 task-01 后端字段 + task-04 list-dir 端点 + task-11 浏览组件就绪后）**：
   - 启动 backend + 至少一个在线 daemon。
   - server-local 分支：填本地路径 → 扫描 → 创建 → 成功；行为与改动前一致（回归）。
   - daemon-client 分支：选在线 daemon → 目录浏览（task-11）选定 root_path → 创建 → 成功 → 数据库 `workspaces` 表新行 `path_source='daemon-client'`、`daemon_runtime_id` 非空（后端验证）。
   - daemon-client 分支提交不触发 backend 本地扫描（无 500/路径不可达错误）。

## 9. 验收标准

| AC | 验收点 | 来源 | 验证方式 | 通过条件 |
|---|---|---|---|---|
| AC-01 | `Workspace` 类型加 path_source + daemon_runtime_id | D-004@v1 / design §8 | TS 编译 + `test` 类型断言 | `Workspace` 含 `path_source: PathSource`、`daemon_runtime_id: string \| null`；TS 0 error |
| AC-02 | `CreateWorkspaceInput` 加可选 path_source/daemon_runtime_id | FR-01 / D-004@v1 | TS 编译 | 不传 path_source 也通过编译（server-local 现状调用零改动） |
| AC-03 | `PathSource` 类型仅 server-local/daemon-client | D-004@v1 | TS 编译拒绝 | `const p: PathSource = "other"` 编译报错 |
| AC-04 | 「路径来源」单选默认 server-local | design §5 Phase3 / §9 | `test_renders_path_source_radio_default_server_local` | 渲染即默认 server-local 选中，root_path 输入可见 |
| AC-05 | daemon-client 分支渲染在线 daemon 下拉（过滤 online） | FR-03 | `test_switch_to_daemon_client_loads_online_runtimes` | 切 daemon-client → `listDaemonRuntimes` 被调 → 下拉仅含 status==="online" 项 |
| AC-06 | 无在线 daemon 时提示且按钮 disabled | FR-03 前置 / §5 E-03 | `test_daemon_client_no_online_runtime_shows_hint` | 下拉「无在线 daemon」+ 提示文案 + 创建 disabled |
| AC-07 | daemon 选定后渲染目录浏览挂载点 | FR-03 / D-005@v1 | `test_daemon_client_daemon_selected_shows_browser_mount` | `data-testid="daemon-dir-browser-mount"` 出现（task-11 接入点） |
| AC-08 | 选定 root_path 经回调回填 + 自动回填 name | FR-03 | `test_daemon_client_root_path_selected_via_callback` | daemonRootPath 回填框显示选定路径；name 自动取 last segment |
| AC-09 | 切换 pathSource 双向清空脏 state | §5 E-05 | `test_switching_path_source_clears_dirty_state` | 切任一方向，另一分支的路径/scan/daemon 选择清空 |
| AC-10 | 切换 daemon 清空已选 root_path | §5 E-08 | `test_switching_daemon_clears_root_path` | 下拉切 daemon → daemonRootPath="" |
| AC-11 | server-local 创建不传 path_source（后端 default 生效） | design §8 / §9 | `test_create_server_local_omits_path_source` | createWorkspace 参数无 path_source/daemon_runtime_id 键 |
| AC-12 | server-local 分支行为字节级不变（回归） | design §9 | 人工 + 现有 server-local 测试全绿 | root_path 输入/扫描/scan 结果/直接创建/生成项目规范全链路与改动前一致 |
| AC-13 | daemon-client 创建透传 path_source + daemon_runtime_id | FR-01 / D-004@v1 | `test_create_daemon_client_passes_path_source_and_runtime_id` | createWorkspace 参数含 `path_source:"daemon-client"` + `daemon_runtime_id` |
| AC-14 | daemon-client 不调 scanWorkspace | design §5 Phase3 | `test_create_daemon_client_passes_path_source_and_runtime_id` | mock scanWorkspace 未被调用 |
| AC-15 | daemon-client 未选 daemon / 未选 root_path 提示且不提交 | §5 E-02 / E-04 | `test_create_daemon_client_without_runtime_id_shows_error` + `_without_root_path` | 显示对应提示；createWorkspace 未被调 |
| AC-16 | daemon-client 隐藏「生成项目规范」按钮 | §4.4 / §6 非目标 | `test_daemon_client_hides_generate_button` | 分支内仅「直接创建」可见 |
| AC-17 | 创建失败显示 ApiError 文案 | §5 E-09 | `test_create_failure_shows_api_error` | 错误文案 `${code}: ${msg}` 显示；phase 回 ready 可重试 |
| AC-18 | scanning/creating 中路径来源单选 disabled | §5 E-10 | `test_path_source_radio_disabled_during_creating` | 创建中单选 disabled |
| AC-19 | 向后兼容：老 Workspace 缺字段按 server-local 兜底 | §5 E-06 / design §9 | 代码审查 + 类型注释 | 消费 `ws.path_source` 处用 `?? "server-local"`；本任务 dialog 只写不读，注释明确约定 |
| AC-20 | 不引入非 allowed_paths 源文件改动 | 本任务边界 | `git diff --name-only` | 仅 `frontend/src/lib/workspaces.ts` + `frontend/src/components/workspace-scan-dialog.tsx`（测试文件除外，按项目测试规范） |
| AC-21 | FR-01 覆盖（前端侧） | requirements.md FR-01 | 人工对照 | 类型扩展（AC-01/02）+ server-local 默认（AC-04/11）+ daemon-client 透传 daemon_runtime_id（AC-13）；后端 validator/迁移属 task-01 |
| AC-22 | FR-03 覆盖（前端侧骨架） | requirements.md FR-03 | 人工对照 | 在线 daemon 下拉（AC-05/06）+ 目录浏览挂载点（AC-07）+ 选定 root_path 回填（AC-08）；list-dir 调用与树形组件归 task-11 |
| AC-23 | TS 严格模式编译通过 | 项目规约 | `pnpm tsc --noEmit` | 0 error |
| AC-24 | 现有前端测试零回归 | design §9 | `pnpm test` | 全绿（server-local 表单全链路不变） |

## 10. 完成定义（DoD）

- §1 全部文件改动落地（workspaces.ts 类型扩展 + workspace-scan-dialog.tsx 单选/分支/state/透传）。
- §9 AC-01 ~ AC-24 全部通过。
- `cd frontend && pnpm test` 全绿，**server-local 表单分支零回归**（design §9 关键不变式）。
- `cd frontend && pnpm tsc --noEmit` 0 error。
- `cd frontend && pnpm lint` 无新增 lint 错（若项目配置）。
- git diff 仅触及 `allowed_paths` 内文件（`daemon.ts` / `daemon-dir-browser.tsx` 不动，归 task-11）。
- 集成验收（§8 第 5 步）在 task-01 + task-04 + task-11 就绪后手动跑通一次：server-local 回归 + daemon-client 端到端创建成功，数据库 path_source/daemon_runtime_id 落库正确。
- 本任务报告回执包含：新增测试用例数、`pnpm test`/`tsc`/`lint` 输出尾部、集成验收截图或日志摘录（server-local + daemon-client 两分支）。

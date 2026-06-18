---
author: qinyi
created_at: 2026-06-18 11:44:49
change: 2026-06-18-workspace-client-path
id: task-11
title: "树形目录浏览组件 + listDir api（frontend daemon-client 浏览）"
priority: P1
depends_on: [task-04, task-10]
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-005@v1]
allowed_paths:
  - frontend/src/components/daemon-dir-browser.tsx
  - frontend/src/lib/daemon.ts
---

# task-11 — 树形目录浏览组件 + listDir api（frontend daemon-client 浏览）

> Wave 4 / 前端层 / depends: task-04（backend 已暴露 `POST /api/daemon/runtimes/{id}/list-dir` 端点，契约见 task-04 §接口定义：200 `{entries:[{name,type:"dir"|"file"}]}`、403 forbidden 越界 / 504 离线超时 / 502 其他业务错 / 404 runtime 不属于 user）、task-10（`WorkspaceScanDialog` daemon-client 分支已渲染挂载点 `data-testid="daemon-dir-browser-mount"` + 回调契约 `onSelect(absPath)`，daemon 下拉已就绪）。本任务落地 Phase 3「daemon-client：树形浏览（调 list_dir）→ 选定 root_path」的前端最后一环：在 `frontend/src/lib/daemon.ts` 新增 `listDir(runtimeId, path)` 与 `listOnlineRuntimes()` api client（复用 `apiFetch`、风格对齐 `workspaces.ts`），在 `frontend/src/components/daemon-dir-browser.tsx` 新增**懒加载**树形目录浏览组件（点击目录节点 → 调 listDir 加载子节点；选中目录 → 回调回填 root_path），并把组件接入 task-10 的挂载点。文件预览、修改、上传等均属非目标。

## 1. 修改文件

| 操作 | 精确路径 | 改动概述 |
|---|---|---|
| 修改 | `frontend/src/lib/daemon.ts` | 新增 `listOnlineRuntimes()`（`GET /api/daemon/runtimes?status=online`，返回 `DaemonRuntimeRead[]`）与 `listDir(runtimeId, path)`（`POST /api/daemon/runtimes/{id}/list-dir`，body `{path}`，返回 `ListDirResponse {entries: DirEntry[]}`）；新增 `DirEntry`（`{name, type:"dir"\|"file"}`）、`ListDirResponse` 类型导出；**复用** `apiFetch` 与 `DaemonRuntimeRead`（daemon.ts:8-22 已有），错误处理沿用 `ApiError`（api.ts:60-74），不做 retry/缓存。`listOnlineRuntimes()` 为 task-10 §4.2 注释承诺的「execute 阶段判定确需」的简化封装；现有 `listDaemonRuntimes()` 不删（AgentProviderSelect/runtimes page 仍在用），新增者只是把「过滤 online」下沉到后端 query，减少前端处理 |
| 新增 | `frontend/src/components/daemon-dir-browser.tsx` | 树形目录浏览组件 `DaemonDirBrowser`（named export）；props `{runtimeId: string, onSelect: (absPath: string) => void}`；内部维护「根路径 + 节点树 + 展开态 + 选中态 + per-node 加载态/错误态」；首次挂载用 daemon `capabilities` 或后端约定的初始根（见 §4.1）触发首次 listDir；点击目录节点懒加载子节点（缓存：同节点二次展开走缓存）；点击目录行（非展开箭头）触发 `onSelect(absPath)` 回填 root_path；`file` 节点只读不可选；按 §5 处理 403 越界 / 504 离线 / 502 / 空目录 / 加载中 / 选中回填等边界。使用项目现有 shadcn/ui 基元（`frontend/src/components/ui/*`），不引入新依赖 |

> `allowed_paths` 严格限定上述两个文件。task-10 的 `workspace-scan-dialog.tsx`、`workspaces.ts` 不改——挂载点替换由 task-11 通过组件库 export + dialog 侧「注释指引」完成；但 task-10 已在挂载点写明 `{/* task-11: <DaemonDirBrowser runtimeId={daemonRuntimeId} onSelect={handleDaemonRootPathSelect} /> */}`，本任务落地后由 execute 阶段在 dialog 内把占位 div 替换为真实组件（属同一变更内的串行收尾，**不**计入本任务 allowed_paths 外改动，验收时以「dialog 内已替换且工作」为准，但代码 diff 的归属仍记录为 task-10 联动项——若 execute 拆分需谨慎，见 §6 非目标末条）。为避免 allowed_paths 越界，本任务**只产**组件 + api，dialog 接入作为 task-10 与 task-11 的联合验收项（§9 AC-13/AC-14 标注「需 dialog 配合」）。

## 2. 覆盖来源

| 来源 ID | 类型 | 摘要 | 本任务如何落实 |
|---|---|---|---|
| **FR-03** | 功能需求 | 已选在线 daemon → 用户在创建表单展开目录节点 → 调 `POST /api/daemon/runtimes/{id}/list-dir {path}` 渲染 `{name,type}[]` 子节点（懒加载）；离线/RPC 超时 → 504 提示重试 | §4.1 `listDir` api 落实端点调用 + `{name,type}[]` 渲染；§4.2 树形组件点击目录节点懒加载子节点；§5 E-03（504 离线/超时 → 节点级错误 + 重试按钮）；AC-04/AC-05/AC-06 |
| **D-005@v1** | 决策 | daemon 新增 list_dir RPC，前端树形浏览后选定 | §4.1 `listDir`（RPC 的 HTTP 转发消费方）+ §4.2 树形浏览组件 + §4.3 选中目录→onSelect 回填 root_path；覆盖「前端树形浏览」这一 normalized_requirement 项 |
| **design §5 Phase 2/3** | 设计 | Phase 2 backend 暴露 list-dir 转发；Phase 3 前端树形浏览（调 list_dir）→ 选定 root_path | §4.1 消费 Phase 2 端点；§4.2/4.3 落实 Phase 3 前端浏览选定 |
| **design §6（76/77 行）** | 文件清单 | `daemon-dir-browser.tsx` 新增；`daemon.ts` 加 `listOnlineRuntimes()`、`listDir()` | §1 两个文件 |
| **design §7.2（99-104 行）** | 接口 | `POST /api/daemon/runtimes/{id}/list-dir {path} -> 200 {entries:[{name,type}]}` / 403 / 504 | §4.1 端点签名 1:1 对齐；§5 错误态映射 |
| **design §10 R-01** | 风险 | WS RPC 超时/daemon 浏览中途离线 → backend 504；前端提示重试 | §5 E-03 节点级错误 + 「重试」按钮（不自动重试，避免抖动） |
| **design §10 R-04** | 风险 | daemon 未配 allowed_roots → 首次 list_dir 受限 → 前端提示配置位置 | §5 E-02 根节点 403 时显示「请在 daemon config.json 配置 allowed_roots（默认 homedir）」引导 |
| **plan.md Wave 4 task-11** | 计划 | depends task-04/task-10，blocks []，P1 | §1 / §9 |
| **task-04** | 前置任务 | backend list-dir 端点契约（200/403/502/504/404） | §4.1 端点调用；§5 错误态分层 |
| **task-10** | 前置任务 | 挂载点 `data-testid="daemon-dir-browser-mount"` + 回调契约 `onSelect(absPath)` + daemon 已选后才渲染挂载点 | §4.2 props 1:1 对齐 `runtimeId` + `onSelect`；§9 AC-13/AC-14 接入验收 |

## 3. 实现要求（编号步骤）

> 按 CLAUDE.md「文档 → 读现有代码 → 写测试 → 写实现 → 跑测试 → 验收」执行。

1. **读现有代码**：
   - `frontend/src/lib/daemon.ts:8-22`（`DaemonRuntimeRead` 类型 + `listDaemonRuntimes()`；本任务复用 `DaemonRuntimeRead`、`apiFetch`，新增 `listOnlineRuntimes`/`listDir`/`DirEntry`/`ListDirResponse`）。
   - `frontend/src/lib/api.ts:60-200`（`ApiError`、`apiFetch` 签名与 query/json 选项；list-dir 用 `json`，listOnlineRuntimes 用 `query`）。
   - `frontend/src/lib/workspaces.ts:100-149`（`scanWorkspace`/`createWorkspace` 的 apiFetch 用法与 JSDoc 注释风格，新 api client 对齐）。
   - `frontend/src/components/ui/`（shadcn 基元清单：button、input、badge 等；树形组件用 `Button` + lucide icons 做 expand/collapse 与文件夹/文件图标，无新依赖）。
   - `.sillyspec/changes/2026-06-18-workspace-client-path/tasks/task-10.md` §4.2（挂载点位置 `workspace-scan-dialog.tsx` 内 `data-testid="daemon-dir-browser-mount"`、回调 `handleDaemonRootPathSelect(absPath)`、daemon 选定后 `{daemonRuntimeId && ...}` 渲染）。
   - `.sillyspec/changes/2026-06-18-workspace-client-path/tasks/task-04.md` §接口定义（端点路径、状态码、entries 结构）。

2. **写测试（先于实现，TDD）**：见 §8。覆盖 api client（mock fetch / apiFetch）+ 组件行为（@testing-library/react + mock listDir）。

3. **改 `daemon.ts`**：见 §4.1（`listOnlineRuntimes`、`listDir`、`DirEntry`、`ListDirResponse`）。

4. **新增 `daemon-dir-browser.tsx`**：见 §4.2 / §4.3 / §4.4（组件 state、懒加载逻辑、错误/加载/空目录态、选中回填）。

5. **跑测试**：见 §8 第 4 步（`pnpm test` + `pnpm tsc --noEmit` + `pnpm lint`）。

6. **（不要做）**：
   - 不修改 `workspace-scan-dialog.tsx` / `workspaces.ts`（task-10 范畴；挂载点接入作为联合验收项，见 §1 末段说明）。
   - 不修改 backend（task-04/05 范畴）。
   - 不实现文件预览/读取/编辑（design §3 精神：list_dir 仅列目录，read_file 等留作后续；本任务非目标 §6）。
   - 不实现自动重试（R-01 明确「不重试」，前端只提示 + 手动重试按钮）。
   - 不引入新依赖（react-arborist / react-window 等；当前目录条目量级小，原生递归渲染足够；YAGNI）。
   - 不做路径输入框（路径来源是 daemon 客户端机器，用户应在树里选；root 起点见 §4.1 默认策略）。

## 4. 接口定义

### 4.1 `daemon.ts` 新增 api client

```ts
// frontend/src/lib/daemon.ts —— 紧邻 listDaemonRuntimes 之后导出

/**
 * task-11 / D-005@v1：列在线 daemon runtime（status==="online"）。
 * task-10 §4.2 注释承诺的「execute 阶段确需则下沉过滤到后端」封装；
 * 与现有 listDaemonRuntimes()（全量）并存，调用方按需选其一。
 *
 * 后端契约（task-04 同期）：GET /api/daemon/runtimes?status=online
 * 返回 DaemonRuntimeRead[]（仅含 online，daemon.ts:8-18 类型复用）。
 */
export async function listOnlineRuntimes(): Promise<DaemonRuntimeRead[]> {
  return apiFetch<DaemonRuntimeRead[]>("/api/daemon/runtimes", {
    query: { status: "online" },
  });
}

/**
 * task-11 / D-005@v1：经 backend WS RPC 通道转发 list_dir 到绑定 daemon，
 * 返回 path 下的目录条目（懒加载树形浏览的数据源）。
 *
 * 后端契约（task-04 §接口定义）：
 *   POST /api/daemon/runtimes/{runtimeId}/list-dir
 *   body: { path: string }                // daemon 客户端机器绝对路径，min_length=1
 *   200: { entries: [{ name, type: "dir"|"file" }] }
 *   400: path 空 / 格式非法（前端不应触发，min_length 由后端兜底）
 *   403: daemon allowed_roots 越界（FR-04 / D-002）→ 前端提示配置 allowed_roots
 *   404: runtime 不属于当前 user
 *   502: daemon 其他业务错误（非 forbidden）
 *   504: daemon 离线 / RPC 超时 / WS 发送失败（R-01）→ 前端提示重试
 *
 * 错误以 ApiError（api.ts:60）抛出，调用方按 err.status 分支处理（§5）。
 */
export interface DirEntry {
  name: string;
  type: "dir" | "file";
}

export interface ListDirResponse {
  entries: DirEntry[];
}

export async function listDir(
  runtimeId: string,
  path: string,
): Promise<ListDirResponse> {
  return apiFetch<ListDirResponse>(
    `/api/daemon/runtimes/${encodeURIComponent(runtimeId)}/list-dir`,
    { method: "POST", json: { path } },
  );
}
```

> 不做响应缓存（组件层负责缓存，api 保持薄）；不做 retry（R-01 决策）；不做超时配置（`apiFetch` 走 fetch 默认，backend 已在 ws_hub 层设 10s RPC 超时，前端无额外超时需求）。

### 4.2 `DaemonDirBrowser` 组件 props + state

```tsx
// frontend/src/components/daemon-dir-browser.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, ChevronDown, Folder, FolderOpen, File as FileIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { listDir, type DirEntry } from "@/lib/daemon";

export interface DaemonDirBrowserProps {
  /** task-10 透传：当前选定的在线 daemon runtime id。 */
  runtimeId: string;
  /**
   * 用户在树中点击某目录行（非展开箭头）选中该目录作为 workspace root_path 时触发。
   * absPath 为 daemon 客户端机器上的绝对路径（拼接自根 + 各级目录 name）。
   */
  onSelect: (absPath: string) => void;
  /**
   * 可选：浏览起始根路径。缺省时优先取 daemon capabilities.default_root（若有），
   * 否则用 "/"（POSIX）—— 实战用户多半会立刻下钻到 allowed_roots 内；
   * 若 "/" 被 403（Windows 下常见），组件按 §5 E-02 提示配置 allowed_roots。
   * 由调用方（dialog）注入更友好（如传 daemon 平台 homedir 提示），但本任务不强制。
   */
  initialRootPath?: string;
  /** 可选：当前已选中路径（用于高亮 + 受控回显），缺省由组件内部 state 管理。 */
  selectedPath?: string;
}

// ── 内部树节点结构 ──
interface TreeNode {
  /** 绝对路径（根 + 各级 name 拼接，POSIX 风格用 "/"，name 含分隔符时按平台拼接见 §4.4）。 */
  absPath: string;
  name: string;
  type: "dir" | "file";
  /** 子节点；未加载时为 undefined（区分「未加载」与「已加载但空」）。 */
  children?: TreeNode[];
  /** 该节点子节点是否已发起过加载（用于缓存命中判定）。 */
  loaded?: boolean;
  expanded?: boolean;
  loading?: boolean;
  /** 该节点加载失败时挂错误（403/504/502/网络），用于行内错误态 + 重试。 */
  error?: { status: number; message: string };
}
```

### 4.3 组件行为伪代码

```text
DaemonDirBrowser({ runtimeId, onSelect, initialRootPath, selectedPath }):
  state:
    rootPath = initialRootPath ?? capabilities?.default_root ?? "/"
    tree: TreeNode[]              # 根层节点（首挂载时为 []，触发首次 listDir(rootPath) 填充）
    rootLoading: boolean
    rootError: {status, message} | null
    selected: string | null       # 内部选中态（若 selectedPath 传入则受控）

  effect [runtimeId, rootPath]:
    # runtimeId 变化（task-10 切 daemon）或根路径变化 → 重置整树 + 重新加载根
    tree = []; rootLoading = true; rootError = null
    try:
      entries = await listDir(runtimeId, rootPath)
      tree = entries.map(toTreeNode(parent=rootPath))
      rootLoading = false
    catch e (ApiError):
      rootError = { e.status, e.message }; rootLoading = false
      # 403/504 在渲染层映射文案（§5）

  toggleExpand(node):
    if node.type != "dir": return
    if node.expanded:
      node.expanded = false       # 折叠：仅切态，不删 children（缓存保留）
    else:
      node.expanded = true
      if node.loaded: return      # 缓存命中：不重复请求
      await loadChildren(node)

  loadChildren(node):
    node.loading = true; node.error = undefined
    try:
      entries = await listDir(runtimeId, node.absPath)
      # 排序：dir 在前、file 在后，各自按 name 字母序（稳定可预期）
      sorted = sortDirFirst(entries)
      node.children = sorted.map(toTreeNode(parent=node.absPath))
      node.loaded = true
      node.loading = false
    catch e (ApiError):
      node.error = { e.status, e.message }; node.loading = false
      # 不置 node.loaded=true：允许重试再次请求

  selectNode(node):
    if node.type != "dir": return        # 仅目录可选作 root_path
    selected = node.absPath
    onSelect(node.absPath)               # 回填 dialog 的 daemonRootPath

  retryNode(node):
    delete node.error
    await loadChildren(node)             # 或根层 retry → effect 触发

  render:
    <div data-testid="daemon-dir-browser" role="tree">
      根加载中 → spinner + "加载根目录..."
      根错误（rootError） → 错误卡片（§5 E-02/E-03 文案） + "重试"按钮（retry effect）
      根就绪 → 递归渲染 tree[]（<DirRow node> 递归 node.children）
        DirRow:
          expand 箭头（dir 可点 toggleExpand；file 无箭头）
          图标（Folder/FolderOpen/File）
          name（点击：dir → selectNode；file → 无选中，disabled 样式）
          loading → 行内 spinner
          error → 行内错误文案 + 行内"重试"（retryNode）
          空目录（loaded && children.length===0）→ 行内"(空)"灰字，不报错
          选中（absPath===selected）→ 高亮背景
```

### 4.4 路径拼接约定

- **POSIX 拼接**：`absPath = parent === "/" ? `/${name}` : `${parent}/${name}``。daemon 端 allowed_roots 校验（task-05）按其宿主平台真实路径判定，前端只需保证拼接结果与 daemon 期望一致。
- **Windows daemon**：若 daemon 返回的根层 name 含盘符（如 `C:`）或 path 含反斜杠，前端不主动转换——`listDir` 的 `path` 参数透传给 daemon，daemon 在自己机器上解析。前端默认 `initialRootPath` 缺省时用 `"/"`，若 daemon 是 Windows 且 `/` 越界 → 403 → 组件按 §5 E-02 提示「请在 daemon 端配置 allowed_roots 或 dialog 传入初始根」。**不在前端做平台探测**（YAGNI；调用方知 daemon 平台时可注入 `initialRootPath`）。
- **特殊字符**：name 含 `/` 或 `\` 时按字面拼接（daemon 真理源），前端不消毒（daemon allowed_roots 是安全边界，前端拼接只是展示）。

## 5. 边界处理（≥5 条）

| 编号 | 边界场景 | 期望行为 | 实现位置 |
|---|---|---|---|
| **E-01** | **懒加载缓存** | 同一目录节点二次展开走缓存（`node.loaded === true` 直接渲染已有 `children`，不重复调 listDir）；折叠只切 `expanded` 怒删 `children`（再次展开命中缓存）。runtimeId 变化时 effect 清空整树重新加载（不同 daemon 文件系统不同，缓存失效）。**不**做 TTL/失效策略（YAGNI；daemon 文件短期内不变且 workspace 创建是一次性动作）。 | §4.3 toggleExpand/loadChildren + effect [runtimeId] |
| **E-02** | **403 越界（allowed_roots，FR-04 / D-002）** | 根层 403 → rootError 卡片显示「路径 `${path}` 不在 daemon 允许范围内（allowed_roots）。请在 daemon config.json 配置 `allowed_roots`（默认 `[homedir]`），或确认所选路径在白名单下。」+ 「重试」按钮（重新触发 root effect）。子节点 403 → 行内红字「越界：${err.message}」+ 行内「重试」（retryNode）。**不**把 403 当致命错误崩组件——用户可改选其他分支或重试。对齐 design §10 R-04。 | §4.3 catch + §渲染 rootError/DirRow error |
| **E-03** | **504 离线 / RPC 超时（R-01）** | 根层 504 → rootError 卡片「daemon 离线或响应超时（${err.message}）。请确认 daemon 在线后重试。」+ 「重试」按钮。子节点 504 → 行内「超时/离线」+ 行内「重试」。**不自动重试**（R-01 决策「前端提示重试」即用户手动）。AC-06 覆盖。daemon 中途离线导致已展开节点失效时，用户点重试会再次 504，文案一致。 | §4.3 catch + 渲染 |
| **E-04** | **空目录** | `node.loaded === true && node.children.length === 0` → 展开后行内显示灰字「(空目录)」，**不报错**（空目录是合法状态，用户仍可选它作 root_path）。根层空目录同理（rootError=null + tree=[] → 显示「该目录为空」+ 仍可选中根本身）。AC-07 覆盖。 | §4.3 渲染 + selectNode 允许选根 |
| **E-05** | **选中目录回填（onSelect）** | 仅 `type==="dir"` 节点可被选中（点击目录行 → selectNode）；点击 file 节点无效果（disabled 样式 + 不触发 onSelect）。选中后内部 `selected` state 更新 → 行高亮；onSelect(absPath) 回调触发 → dialog 的 `handleDaemonRootPathSelect` 回填 `daemonRootPath` + 自动回填 name（task-10 §4.2 已实现 name 回填）。**absPath 必须是绝对路径**（§4.4 拼接约定）。AC-08 覆盖。 | §4.3 selectNode + 渲染高亮 |
| **E-06** | **加载中态** | 根加载中 → 整树区域显示 spinner + 「加载根目录...」；子节点加载中 → 行内 spinner（展开箭头位置）+ name 后跟「...」。加载中禁用该节点的二次点击（避免重复请求；缓存未 loaded 前点击 expand 走 loadChildren，loading 中再次点击直接 return）。并发展开多个节点时各自独立 loading 态（per-node）。 | §4.3 loading 态 + 渲染 |
| **E-07** | **502 daemon 其他业务错误** | daemon 返回非 forbidden 的业务错（如 not_found/internal）→ 行内/根层显示「daemon 错误（${err.code}）：${err.message}」+ 重试。文案与 403/504 区分以便排障。AC-09 覆盖。 | §4.3 catch + 渲染 |
| **E-08** | **404 runtime 不属于 user** | 极少触发（dialog 已校验 daemon 归属后才挂载），但若 daemon 被其他 user 操作删除/转交 → 404。组件根层显示「无权访问该 daemon（404）。请重新选择 daemon。」+ 不自动处理（用户在 dialog 重新选 daemon → runtimeId 变 → effect 重置）。 | §4.3 catch + 渲染 |
| **E-09** | **网络错（ApiError status=0）** | apiFetch 在 fetch 抛错时包成 `ApiError(0, {code:"network_error"})`（api.ts:122-129）。组件按 status===0 显示「网络错误，请检查连接」+ 重试。与 504 区分（504 是 daemon 侧、0 是前端到 backend 链路）。 | §4.3 catch + 渲染 |
| **E-10** | **runtimeId 频繁变化（用户快速切 daemon）** | effect 用 cleanup（`cancelled` 标志或 AbortController）避免旧请求的 setState 覆盖新树（race condition）。每次 runtimeId 变化 → 清空 tree + 重置 rootLoading。AC-10 覆盖。 | §4.3 effect cleanup |
| **E-11** | **selectedPath 受控回显** | 若 dialog 传入 `selectedPath`（如编辑场景回填），组件高亮该路径对应节点（路径匹配 absPath）；若该节点尚未加载（在未展开的深层目录），不主动展开（YAGNI；用户重新选即可）。当前 dialog 场景不传 selectedPath（创建场景无预选），组件内部 selected state 自管。 | §4.2 props + §4.3 渲染高亮 |

## 6. 非目标（本任务不做）

- ❌ **不做文件预览/读取/编辑**：list_dir 仅返回 `{name, type}`，无内容/权限/大小。read_file/write_file 等 RPC 属后续（design §3 精神 + task-04 §非目标「仅 list_dir 一支」）。
- ❌ **不修改 `workspace-scan-dialog.tsx` / `workspaces.ts`**：task-10 范畴。挂载点接入作为联合验收项（§1 末段 + §9 AC-13/AC-14），但代码 diff 归属 task-10 联动；本任务 allowed_paths 严格限定两文件。execute 阶段如需在 dialog 替换占位 div，按 sillyspec 规约应作为 task-10 的回归补丁或联合收尾（不记入 task-11 allowed_paths 外改动）。
- ❌ **不做自动重试 / 指数退避**：R-01 决策明确「前端提示重试」，用户手动点「重试」按钮即可。
- ❌ **不做路径输入框 / 手动输路径**：路径来源是 daemon 客户端机器，用户应在树里选；root 起点见 §4.1 默认策略（`/` 或调用方注入）。
- ❌ **不引入树形库（react-arborist / react-window）**：当前目录条目量级小（单层通常 < 100），原生递归渲染足够；虚拟滚动 YAGNI。
- ❌ **不做节点级 TTL/缓存失效**：workspace 创建是一次性动作，缓存命中即可；runtimeId 变化时整树重置（E-01）。
- ❌ **不做多选/批量操作**：onSelect 单选（选一个 root_path），无 checkbox/多选。
- ❌ **不做权限/隐藏文件过滤**：daemon 返回什么前端渲染什么；隐藏文件（.开头的 name）正常显示（用户可能要选 .sillyspec 同级目录）。
- ❌ **不修改 backend**（task-04/05 范畴）。
- ❌ **不做平台探测 / 路径风格转换**：Windows daemon 的路径透传给 daemon 自解析，前端不猜平台（§4.4）。

## 7. 参考

- design.md §5 Phase 2/3（list_dir RPC + 前端树形浏览）、§6（76/77 行文件清单）、§7.2（list-dir 端点契约）、§10 R-01（504 应对）/R-04（allowed_roots 未配提示）
- requirements.md FR-03（已选在线 daemon → 展开 → list-dir → 渲染 → 504 重试）
- decisions.md D-005@v1（daemon list_dir RPC + 前端树形浏览）
- plan.md Wave 4 task-11（depends task-04/task-10，blocks []）
- task-04（backend list-dir 端点契约：200/403/502/504/404）
- task-10（挂载点 `data-testid="daemon-dir-browser-mount"` + 回调契约 `onSelect(absPath)` + daemon 选定后才渲染 + `handleDaemonRootPathSelect`）
- 现有代码：
  - `frontend/src/lib/daemon.ts:8-22`（DaemonRuntimeRead + listDaemonRuntimes，本任务复用）
  - `frontend/src/lib/api.ts:60-200`（ApiError + apiFetch + query/json 选项）
  - `frontend/src/lib/workspaces.ts:100-149`（scanWorkspace/createWorkspace apiFetch 风格，新 api client 对齐）
  - `frontend/src/components/ui/`（shadcn 基元：button 等）

## 8. TDD 步骤

1. **写 api client 测试（先红）**：新建 `frontend/src/lib/__tests__/daemon-listdir.spec.ts`（或项目既定 test 目录，与 daemon.ts 现有测试位置对齐）：
   - `test_listDir_calls_correct_endpoint`：mock `apiFetch`（或 `global.fetch`）→ 调 `listDir("r1", "/foo")` → 断言请求 `POST /api/daemon/runtimes/r1/list-dir`、body `{path:"/foo"}`、返回 `{entries:[{name:"a",type:"dir"}]}` 解包正确。
   - `test_listDir_propagates_api_error_403`：mock apiFetch reject `ApiError(403, {code:"HTTP_403_DAEMON_RPC_FORBIDDEN"})` → `listDir` 抛 ApiError，status===403。
   - `test_listDir_propagates_api_error_504`：同上 504。
   - `test_listDir_encodes_runtime_id`：runtimeId 含特殊字符（如 `r/1`，虽实战是 UUID）→ `encodeURIComponent` 生效，URL 安全。
   - `test_listOnlineRuntimes_passes_status_query`：mock apiFetch → 调 `listOnlineRuntimes()` → 断言 `query:{status:"online"}` 透传 → 返回 DaemonRuntimeRead[]。
   - `test_listOnlineRuntimes_empty_ok`：mock 返回 `[]` → 不抛错（无在线 daemon 是合法状态）。

2. **写组件行为测试（@testing-library/react + mock listDir，先红）**：新建 `frontend/src/components/__tests__/daemon-dir-browser.spec.tsx`：
   - `test_mounts_and_loads_root`：渲染 `<DaemonDirBrowser runtimeId="r1" onSelect={fn} />` → 首挂载调 `listDir("r1", "/")`（或 initialRootPath）→ root loading spinner 显示 → mock resolve `[{name:"proj",type:"dir"}]` → 节点「proj」可见。
   - `test_expand_dir_lazy_loads_children`：根就绪后点击「proj」展开箭头 → 调 `listDir("r1", "/proj")`（仅一次）→ 子节点渲染。
   - `test_expand_cached_no_refetch`：再次折叠+展开「proj」→ listDir **不被**再次调用（缓存命中）。
   - `test_select_dir_calls_onSelect_with_abs_path`：点击「proj」目录行（非箭头）→ `onSelect("/proj")` 被调；点击子目录「src」行 → `onSelect("/proj/src")`；行高亮。
   - `test_select_file_does_nothing`：file 节点点击 → `onSelect` 不被调；file 行 disabled 样式。
   - `test_root_403_shows_allowed_roots_hint`：mock listDir reject `ApiError(403)` → rootError 卡片显示「allowed_roots」+「重试」按钮。
   - `test_root_504_shows_offline_retry`：mock reject `ApiError(504)` → 卡片显示「离线/超时」+「重试」；点重试 → listDir 再次被调。
   - `test_root_502_shows_daemon_error`：mock reject `ApiError(502)` → 卡片显示「daemon 错误」。
   - `test_root_network_error_status_0`：mock reject `ApiError(0)` → 卡片显示「网络错误」。
   - `test_node_level_error_and_retry`：根就绪，展开「proj」时 mock listDir reject 403 → 「proj」行内显示「越界」+ 行内「重试」；点行内重试 → listDir 再次被调。
   - `test_empty_dir_shows_not_error`：展开「proj」mock resolve `[]` → 行内显示「(空目录)」；不报错；仍可选「proj」作 root_path。
   - `test_loading_state_per_node`：展开「proj」→ 「proj」行内 spinner；同时展开「doc」→ 各自独立 loading。
   - `test_runtime_id_change_resets_tree`：runtimeId 从 "r1" 切 "r2" → tree 清空 → 重新调 `listDir("r2", "/")`；旧 r1 的 pending 请求不覆盖新树（用 act + resolved 顺序验证）。
   - `test_initial_root_path_used`：传 `initialRootPath="/Users/x"` → 首挂载调 `listDir("r1", "/Users/x")`。
   - `test_dir_sorted_before_file`：mock 返回 `[{name:"z.txt",type:"file"},{name:"a",type:"dir"},{name:"b",type:"dir"}]` → 渲染顺序为 a、b（dir 字母序）、z.txt（file 在后）。

3. **实现**：按 §3 步骤 3-4 改 `daemon.ts` + 新增 `daemon-dir-browser.tsx`。

4. **跑测试**：
   - `cd frontend && pnpm test src/lib/__tests__/daemon-listdir.spec.ts src/components/__tests__/daemon-dir-browser.spec.tsx` —— 全绿。
   - `cd frontend && pnpm test` —— 现有前端测试不回归（关键：`listDaemonRuntimes` 现有调用方 AgentProviderSelect/runtimes page 不受新增 api 影响）。
   - `cd frontend && pnpm tsc --noEmit` —— TS 严格模式 0 error（`DirEntry.type` 联合类型、"dir"/"file" 字面量校验）。
   - `cd frontend && pnpm lint` —— 无新增 lint 错。

5. **集成验收（手动，依赖 task-04 后端端点 + task-10 dialog 挂载点就绪后）**：
   - 启动 backend + 至少一个在线 daemon（allowed_roots 配置含一个真实目录）。
   - dialog 切 daemon-client → 选在线 daemon → 挂载点渲染 `<DaemonDirBrowser>` → 根目录加载 → 展开/折叠正常 → 选定一个目录 → dialog 的 root_path 回填框显示该路径 → name 自动回填。
   - 在 daemon config 临时改 allowed_roots 排除某路径 → 浏览到该路径 → 403 提示 + 重试。
   - 浏览中途停 daemon → 下次展开/重试 → 504 提示。

## 9. 验收标准

| AC | 验收点 | 来源 | 验证方式 | 通过条件 |
|---|---|---|---|---|
| AC-01 | `daemon.ts` 新增 `listDir` api | FR-03 / D-005@v1 | `test_listDir_calls_correct_endpoint` | `listDir("r1","/foo")` → `POST /api/daemon/runtimes/r1/list-dir` body `{path:"/foo"}`，返回 entries 解包 |
| AC-02 | `listDir` 透传 ApiError（403/504/502/404/0） | task-04 契约 / §5 | `test_listDir_propagates_api_error_*` | 各 status 的 ApiError 原样抛出，调用方可按 status 分支 |
| AC-03 | `listOnlineRuntimes` 传 status=online query | task-10 承诺 / §4.1 | `test_listOnlineRuntimes_passes_status_query` | apiFetch 收到 `query:{status:"online"}`；返回 DaemonRuntimeRead[]；空数组不抛 |
| AC-04 | 组件首挂载加载根目录（懒加载起点） | FR-03 / D-005@v1 | `test_mounts_and_loads_root` | 渲染即调 `listDir(runtimeId, initialRootPath ?? "/")`；root loading → 节点渲染 |
| AC-05 | 点击目录节点懒加载子节点（仅首次） | FR-03 / D-005@v1 | `test_expand_dir_lazy_loads_children` + `test_expand_cached_no_refetch` | 展开调 listDir 一次；折叠再展开走缓存不重复调 |
| AC-06 | 504 离线/超时 → 错误提示 + 手动重试（R-01） | FR-03 / design §10 R-01 | `test_root_504_shows_offline_retry` + `test_node_level_error_and_retry` | 卡片/行内显示「离线/超时」+「重试」按钮；点击重试再调 listDir；**不**自动重试 |
| AC-07 | 空目录不报错（合法状态） | §5 E-04 | `test_empty_dir_shows_not_error` | `loaded && children.length===0` → 显示「(空目录)」；rootError 不设；仍可选该目录 |
| AC-08 | 选中目录 → onSelect(absPath) 回填（仅 dir） | FR-03 / task-10 回调契约 | `test_select_dir_calls_onSelect_with_abs_path` + `test_select_file_does_nothing` | dir 行点击 → onSelect 绝对路径；file 行点击无效；选中行高亮 |
| AC-09 | 502 daemon 业务错 → 区分文案 | §5 E-07 | `test_root_502_shows_daemon_error` | 卡片显示「daemon 错误（code）」；与 403/504 文案区分 |
| AC-10 | runtimeId 变化重置整树（避免 race） | §5 E-10 | `test_runtime_id_change_resets_tree` | runtimeId 切换 → tree 清空 → 重新加载；旧请求不覆盖新树 |
| AC-11 | 路径拼接正确（POSIX，根+name） | §4.4 | `test_select_dir_calls_onSelect_with_abs_path`（深层路径） | onSelect 收到 `/proj/src`（非 `proj/src` 或 `//proj/src`） |
| AC-12 | dir 排序在 file 前，各自字母序 | §4.3 | `test_dir_sorted_before_file` | 渲染顺序 dir（a,b）→ file（z.txt） |
| AC-13 | 接入 task-10 挂载点（联合验收） | task-10 §4.2 / design §5 Phase3 | 手动集成（§8 第 5 步） | dialog daemon-client 分支选 daemon → `<DaemonDirBrowser>` 渲染于 `data-testid="daemon-dir-browser-mount"` 位置 → 选定目录回填 root_path |
| AC-14 | dialog 回填链路打通（onSelect → daemonRootPath → name） | task-10 §4.2 handleDaemonRootPathSelect | 手动集成 | 组件 onSelect 触发 → dialog root_path 回填框更新 + name 自动取 last segment |
| AC-15 | `DirEntry.type` 类型严格（"dir"\|"file"） | task-04 schema / §4.1 | TS 编译 | `const e: DirEntry = {name:"x", type:"other"}` 编译报错 |
| AC-16 | 现有 `listDaemonRuntimes` 不删（兼容 AgentProviderSelect/runtimes page） | §1 / 现有调用方 | `grep listDaemonRuntimes frontend/src` | 现有调用方仍能 import；新增 listOnlineRuntimes 并存 |
| AC-17 | 无新依赖（不引树形库） | §6 非目标 | `git diff frontend/package.json` | package.json 无新增 deps（lucide-react 已在用） |
| AC-18 | TS 严格模式编译通过 | 项目规约 | `pnpm tsc --noEmit` | 0 error |
| AC-19 | 现有前端测试零回归 | design §9 精神 | `pnpm test` | 全绿（daemon.ts 现有调用方 AgentProviderSelect/runtimes page/quick-chat 不受影响） |
| AC-20 | 不引入非 allowed_paths 源文件改动 | 本任务边界 | `git diff --name-only` | 仅 `frontend/src/lib/daemon.ts` + `frontend/src/components/daemon-dir-browser.tsx`（测试文件除外，按项目测试规范）；dialog 接入 diff 归 task-10 联动（§1/§6） |
| AC-21 | FR-03 覆盖（前端侧完整） | requirements.md FR-03 | 人工对照 | listDir api（AC-01/02）+ 树形懒加载渲染（AC-04/05）+ 504 重试（AC-06）+ 选定回填（AC-08）；后端端点属 task-04 |
| AC-22 | D-005@v1 覆盖（前端树形浏览） | decisions.md D-005@v1 | 人工对照 | 树形浏览组件落地（AC-04/05/08）+ api 消费 RPC 转发端点（AC-01）；daemon 侧 RPC handler 属 task-05 |

## 10. 完成定义（DoD）

- §1 两个文件改动落地（`daemon.ts` 新增 listOnlineRuntimes/listDir/DirEntry/ListDirResponse；`daemon-dir-browser.tsx` 新增 DaemonDirBrowser 组件）。
- §9 AC-01 ~ AC-22 全部通过（AC-13/AC-14 联合 task-10 手动验收，依赖 dialog 接入）。
- `cd frontend && pnpm test` 全绿，**现有 daemon.ts 调用方零回归**（AgentProviderSelect/runtimes page/quick-chat）。
- `cd frontend && pnpm tsc --noEmit` 0 error。
- `cd frontend && pnpm lint` 无新增 lint 错。
- git diff 仅触及 `allowed_paths` 内文件（dialog 接入作为 task-10 联动收尾，不记入本任务 allowed_paths 外改动；若 execute 阶段需在 dialog 替换占位，应作为 task-10 回归补丁处理）。
- 集成验收（§8 第 5 步）在 task-04 + task-10 就绪后手动跑通：daemon-client 分支选 daemon → 树形浏览 → 选定 root_path → 回填链路正常；403/504 错误态正确提示。
- 本任务报告回执包含：新增测试用例数、`pnpm test`/`tsc`/`lint` 输出尾部、集成验收日志摘录（含 403/504 错误态截图或文字记录）。

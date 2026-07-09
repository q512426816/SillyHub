---
plan_level: full
author: WhaleFall
created_at: 2026-07-09 09:42:00
---

# 实现计划 — Remote Folder Picker（基于 Daemon 的远程目录浏览器）

> 变更 `2026-07-09-remote-folder-picker`
> 来源：`design.md`（§5 三 Wave）+ `tasks.md`（11 任务）+ `requirements.md`（FR-1~6）+ `decisions.md`（D-001~D-007 全 accepted）

## 概述

把「daemon 弹系统对话框选目录」改为「daemon 供数 + 前端懒加载树形浏览」，新增 daemon `list_roots` RPC（跨平台根锚点）+ backend 薄代理 + 可复用 `RemoteFolderPicker` 组件，彻底删除 `browse_folder` 三端。复用已有 `list_dir` 全链路与 `PUT allowed-roots → WS policy_update` 即时刷新。

## Spike 前置验证

**本变更无需 Spike**。关键假设均经 Design Grill（brainstorm Step 12）对照真实源码核验通过：
- `send_rpc` 空 params `{}` 合法（`ws_hub.py:372-414`，params 仅要求 dict）。
- Windows A-Z `existsSync` 盘符枚举可行（`page.tsx:649` 现状已证 C~G 探测）， UNC/网络盘为已知限制（地址栏手输兜底）。
- ownership `_get_owned_runtime` 真实存在（`router.py:1338`）。
- antd Tree `loadData` 懒加载现状已用（`page.tsx:1259`）。

## Wave 分组与依赖

| Wave | 目标 | 任务 | 依赖 | 构建命令（local.yaml + package.json） |
|---|---|---|---|---|
| **W1 daemon** | daemon 提供 `list_roots` + 删 `browse_folder` handler | task-01, task-02, task-03 | — | `cd sillyhub-daemon && pnpm test` / `pnpm typecheck` |
| **W2 backend** | 新增 `list-roots` 端点 + schema；删 `browse-folder` 端点 + 内联 schema | task-04, task-05, task-06 | W1（端点转发 list_roots RPC） | `cd backend && pytest` / `ruff check . && mypy app` |
| **W3 frontend** | `listRoots()` + `RemoteFolderPicker` 组件 + 接入 runtimes 页；删前端 `browseFolder` 与内联逻辑 | task-07, task-08, task-09, task-10 | W2（前端调 list-roots 端点） | `cd frontend && pnpm test` / `pnpm lint` / `pnpm build` |
| **跨 Wave** | 全量清理 + 实测 | task-11 | W1+W2+W3 | `cd deploy && docker compose up -d`（Docker 实测） |

> W2/W3 可基于 §接口契约（design §7）并行开发（前端先 mock 端点）；W1→W2→W3 为集成依赖顺序。`test_strategy=module`，模块测试覆盖 daemon/backend/frontend 三块。
>
> **执行顺序**：模块 Wave（W1/W2/W3/verify）为逻辑分组；实际以 `tasks/*.md` 的 `depends_on` 拓扑为准（postcheck 拓扑：task-01,05 → 02,03 → 04 → 06,07 → 08 → 09,10 → 11）。task-05（删 browse-folder 端点，无依赖）可与 W1 并行；router.py 的 task-04/05 执行时合并为一次编辑避免冲突。

## Tasks

> checkbox 格式，execute 阶段据此解析。每任务标注 allowed_paths（含入口文件，过生产接线路径检查）+ 覆盖 FR/D。

### Wave 1 — daemon
- [x] **task-01**: 新增 `listRoots` 业务层（Win A-Z `fs.existsSync` 探测 + 单盘 try/catch 兜底；Linux/macOS 返 `/`；返 `{roots: string[]}`，root 带 OS 原生尾 sep）。allowed: `sillyhub-daemon/src/roots-rpc.ts`（新增）。覆盖 FR-1 / D-001。
- [x] **task-02**: `daemon.ts` 在 `_registerListDirRpcHandler`（:2095-2158）内注册 `list_roots` handler（同 list_dir 浏览自由模式）；删除 `browse_folder` handler（:2114 起 PowerShell Shell.BrowseForFolder 整段）；核验 `exec`/`homedir` import 未变 unused。allowed: `sillyhub-daemon/src/daemon.ts`（入口）。覆盖 FR-1 / FR-5 / D-006。
- [x] **task-03**: `listRoots` 单元测试（Win 盘符枚举 / Unix 根 / 单盘失败不中断 / 异常映射 RpcError）。allowed: `sillyhub-daemon/tests/roots-rpc.test.ts`（新增）。覆盖 FR-1 / NFR-1。

### Wave 2 — backend
- [x] **task-04**: `router.py` 新增 `POST /runtimes/{id}/list-roots`（照抄 `list_dir:1325`：`get_current_principal` + `_get_owned_runtime` ownership + `send_rpc(daemon_id,"list_roots",{})` + 错误映射 offline→504/timeout→504/forbidden→403）；`schema.py` 新增 `ListRootsResponse { roots: list[str] }`（紧邻 `ListDirResponse:452`）。allowed: `backend/app/modules/daemon/router.py`、`backend/app/modules/daemon/schema.py`。覆盖 FR-2 / D-002 / D-007。
- [x] **task-05**: `router.py` 删除 `browse_folder` 端点（:1411）+ 内联 `BrowseFolderResponse`（:1398）/ `BrowseFolderRequest`（:1404）。allowed: `backend/app/modules/daemon/router.py`。覆盖 FR-5 / D-006。
- [x] **task-06**: 新增 `list-roots` 端点测试（owner 200 / 非 owner 404 / 离线 504 / forbidden 403）；既有 `browse-folder` 相关测试改为「端点已不存在（404）」断言或移除。allowed: `backend/app/modules/daemon/tests/test_list_roots_endpoint.py`（新增）+ 既有 browse 测试。覆盖 FR-2 / FR-5。

### Wave 3 — frontend
- [x] **task-07**: `lib/daemon.ts` 新增 `listRoots()`（紧邻 `listDir:244`，`POST .../list-roots` 空 body）；删除 `browseFolder()`（:259）。allowed: `frontend/src/lib/daemon.ts`。覆盖 FR-2 / FR-5。
- [x] **task-08**: 新增 `RemoteFolderPicker` 组件（props: runtimeId/open/onClose/onPick/title?/confirmText?；open 时 listRoots 初始化根 → antd Tree loadData 懒加载 listDir 只显 dir → 地址栏手输跳转前探 listDir 校验 not_found 提示并禁用确认 → 错误降级红条不崩溃；antd Modal/Tree + shadcn Input/Button）。allowed: `frontend/src/components/daemon/remote-folder-picker.tsx`（新增）。覆盖 FR-3 / D-003 / D-004 / NFR-3 / NFR-4。
- [x] **task-09**: `RemoteFolderPicker` 组件测试（渲染 / 懒加载展开 / 手输校验 / 离线降级 / onPick 回传）。allowed: `frontend/src/components/daemon/__tests__/remote-folder-picker.test.tsx`（新增）。覆盖 FR-3。
- [x] **task-10**: `runtimes/page.tsx` 接入 `<RemoteFolderPicker>`（引入 `pickerRowIdx: number|null` 替代 `browseRuntimeId`+`browseTargetRef`，可写目录行「浏览」按钮打开）；删除内联树形 handler（handleBrowseDir/handleLoadTreeData/handleTreeSelect/handleSelectBrowseDir/handleJumpToPath/handleBrowseNative :641-726）与 state/ref（treeData/treeSelectedPath/browseManualPath/browseRuntimeId/browseError + browseTargetRef :346-353）+ `handleBrowseNative` UI 入口。allowed: `frontend/src/app/(dashboard)/runtimes/page.tsx`（入口）。覆盖 FR-4 / FR-5。

### 跨 Wave — verify
- [x] **task-11**: grep 三端 `browse_folder`/`browseFolder`/`BrowseFolder` 为空；Docker rebuild 实测 Runtime 配置页（Win daemon 显示盘符 / Linux daemon 显示 `/`，均可展开）；保存后 daemon PolicyCache 即时更新（在线）；非 admin 保存收 403（既有行为不回归）。覆盖 FR-5 / FR-6 / NFR-1 / NFR-2。

## 验收（对照 proposal 成功标准）

1. daemon `list_roots`：Win 返存在盘符、Linux/macOS 返 `/`；异常 fallback 不崩（R-01）。
2. backend `POST /list-roots`：owner 200 / 非 owner 404 / 离线 504。
3. `POST /browse-folder` 返 404；grep 三端 browse_folder 为空。
4. `RemoteFolderPicker`：打开加载根 → 展开 → 手输校验 → onPick。
5. 跨平台 Win/Linux daemon 均可浏览展开。
6. 保存后 daemon PolicyCache 即时更新（在线）；非 admin 保存 403（D-007）。
7. 三端测试通过 + Docker rebuild 实测。

## 覆盖矩阵（decisions → task → 验收）

| 决策 | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 roots ≠ allowed_roots | task-01, task-04 | AC-1（roots 字段独立） |
| D-002@v1 list_roots 放开全盘，沿用 ownership | task-04, task-06 | AC-2（owner 200/非 owner 404） |
| D-003@v1 手输须探 list_dir 校验 | task-08, task-09 | AC-4（手输校验） |
| D-004@v1 离线/超时 UI 降级不崩溃 | task-08, task-09 | AC-4（离线降级） |
| D-005@v1 刷新复用 policy_update + 心跳兜底 | task-11 | AC-6（即时更新） |
| D-006@v1 不做 mkdir；不收紧权限；browse_folder 彻底删 | task-02, task-05, task-07, task-10 | AC-3（grep 为空） |
| D-007@v1 读(owner)/写(admin)权限分层 | task-04, task-06, task-11 | AC-2/AC-6（非 admin 403） |

## 自检

| 检查项 | 结果 | 说明 |
|---|---|---|
| checkbox 格式（`- [ ] task-XX:`） | ✅ | 11 任务全 checkbox |
| 所有 D-xxx@vN 在 task 或覆盖矩阵 | ✅ | D-001~D-007 全覆盖（见覆盖矩阵） |
| 所有 FR 在 task | ✅ | FR-1~6 全覆盖 |
| Wave 依赖一致 | ✅ | W1→W2→W3→verify，无循环 |
| 入口文件在 allowed_paths | ✅ | daemon.ts(task-02)/router.py(task-04,05)/runtimes page.tsx(task-10) 均为入口且已标 |
| 无 P0/P1 unresolved blocker | ✅ | decisions 全 accepted（Design Grill passed） |
| 任务粒度均匀 | ✅ | 单任务单文件单职责，含测试任务 |
| 构建命令来自 local.yaml/package.json | ✅ | backend pytest / frontend pnpm test / daemon vitest(test_strategy=module) |
| 生产接线路径 | ✅ | daemon.ts（RPC 注册入口）、router.py（API 入口）、runtimes/page.tsx（页面入口）均在 allowed_paths |
| YAGNI | ✅ | 无 spike、无 mkdir、无权限重构、无 Workspace 迁移 |

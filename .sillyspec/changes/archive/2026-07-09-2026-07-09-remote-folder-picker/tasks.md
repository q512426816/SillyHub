---
author: WhaleFall
created_at: 2026-07-09 09:36:42
---

# Tasks — Remote Folder Picker

> 变更 `2026-07-09-remote-folder-picker` · 任务清单（名称 + 文件 + 覆盖 FR/D）。细节由 plan 阶段展开为 Wave。
> 对应 design §5 三 Wave：W1 daemon / W2 backend / W3 frontend。

## W1 · daemon（`sillyhub-daemon/`）

| ID | 任务 | 文件 | 覆盖 |
|---|---|---|---|
| T1 | 新增 `listRoots` 业务层（Win A-Z existsSync / Unix `/`，单盘 try/catch 兜底，返 `{roots}`） | `src/roots-rpc.ts`（新增） | FR-1 / D-001 |
| T2 | daemon.ts 注册 `list_roots` handler（加进 `_registerListDirRpcHandler` :2095-2158）；删除 `browse_folder` handler（:2114 起）；核验 `exec`/`homedir` import 未 unused | `src/daemon.ts`（修改） | FR-1 / FR-5 / D-006 |
| T3 | `listRoots` 单元测试（Win 盘符 / Unix 根 / 单盘失败兜底 / 异常映射） | `src/__tests__/roots-rpc.test.ts`（新增） | FR-1 / NFR-1 |

## W2 · backend（`backend/app/modules/daemon/`）

| ID | 任务 | 文件 | 覆盖 |
|---|---|---|---|
| T4 | 新增 `POST /runtimes/{id}/list-roots` 端点（照抄 `list_dir:1325` 模式：`get_current_principal` + `_get_owned_runtime` ownership + `send_rpc("list_roots",{})` + 错误映射）；新增 `ListRootsResponse { roots: list[str] }` schema（紧邻 `ListDirResponse:452`） | `router.py` / `schema.py`（修改） | FR-2 / D-002 / D-007 |
| T5 | 删除 `browse_folder` 端点（:1411）+ 内联 `BrowseFolderResponse`(:1398) / `BrowseFolderRequest`(:1404) | `router.py`（修改） | FR-5 / D-006 |
| T6 | `list-roots` 端点测试（owner 200 / 非 owner 404 / 离线 504 / forbidden 403）；既有 browse-folder 测试改为删除验证或移除 | `app/modules/daemon/tests/test_list_roots_endpoint.py`（新增）+ 既有 browse 测试（修改/删除） | FR-2 / FR-5 |

## W3 · frontend（`frontend/src/`）

| ID | 任务 | 文件 | 覆盖 |
|---|---|---|---|
| T7 | `lib/daemon.ts` 新增 `listRoots()`（紧邻 `listDir:244`）；删除 `browseFolder()`(:259) | `lib/daemon.ts`（修改） | FR-2 / FR-5 |
| T8 | 新增 `RemoteFolderPicker` 组件（props: runtimeId/open/onClose/onPick/title?/confirmText?；listRoots 初始化根 + Tree loadData 懒加载 listDir + 手输跳转前探校验 + 错误降级；antd Modal/Tree + shadcn Input/Button） | `components/daemon/remote-folder-picker.tsx`（新增） | FR-3 / D-003 / D-004 / NFR-3 / NFR-4 |
| T9 | 组件测试（渲染 / 懒加载 / 手输校验 / 离线降级 / onPick） | `components/daemon/__tests__/remote-folder-picker.test.tsx`（新增） | FR-3 |
| T10 | `runtimes/page.tsx` 接入 `<RemoteFolderPicker>`（引入 `pickerRowIdx: number\|null` 替代 `browseRuntimeId`+`browseTargetRef`）；删除内联树形 handler（handleBrowseDir/handleLoadTreeData/handleTreeSelect/handleSelectBrowseDir/handleJumpToPath/handleBrowseNative :641-726）与 state/ref（treeData/treeSelectedPath/browseManualPath/browseRuntimeId/browseError + browseTargetRef :346-353）；删除 `handleBrowseNative` 调用与 UI 按钮 | `app/(dashboard)/runtimes/page.tsx`（修改） | FR-4 / FR-5 |

## 跨 Wave

| ID | 任务 | 覆盖 |
|---|---|---|
| T11 | verify：grep 三端 `browse_folder`/`browseFolder`/`BrowseFolder` 为空；Docker rebuild 实测 Runtime 配置页（Win/Linux daemon 浏览）；保存后 daemon PolicyCache 即时更新 | FR-5 / FR-6 / NFR-1 / NFR-2 |

> 任务数 11（含测试与 verify），<批量阈值。plan 阶段按 W1→W2→W3 依赖排序细化（W2/W3 可基于接口契约并行）。

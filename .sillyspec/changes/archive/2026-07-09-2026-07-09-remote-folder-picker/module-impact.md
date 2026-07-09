---
author: WhaleFall
created_at: 2026-07-09 14:10:00
---

# 模块影响分析（Module Impact）— Remote Folder Picker

> 变更 `2026-07-09-remote-folder-picker` · 基于 git diff（真实变更）+ design/tasks 声明 + _module-map 模块匹配三重交叉验证。

## 变更摘要
移除 browse_folder 系统弹窗式目录选择，改为 daemon `list_roots` RPC + backend 代理 + 前端 `RemoteFolderPicker` 自治组件的远程懒加载目录浏览器。涉及 daemon/backend/frontend 三端，纯新增 list_roots 能力 + 删除 browse_folder 旧链路。

## 真实变更文件（git diff，11 源码文件）
**修改（5）**：`backend/app/modules/daemon/router.py`、`backend/app/modules/daemon/schema.py`、`frontend/src/app/(dashboard)/runtimes/page.tsx`、`frontend/src/lib/daemon.ts`、`sillyhub-daemon/src/daemon.ts`
**新增（5）**：`backend/app/modules/daemon/tests/test_list_roots_endpoint.py`、`frontend/src/components/daemon/__tests__/remote-folder-picker.test.tsx`、`frontend/src/components/daemon/remote-folder-picker.tsx`、`sillyhub-daemon/src/roots-rpc.ts`、`sillyhub-daemon/tests/roots-rpc.test.ts`

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| daemon | 接口变更 + 新增 | `sillyhub-daemon/src/roots-rpc.ts`（新）、`sillyhub-daemon/src/daemon.ts`、`sillyhub-daemon/tests/roots-rpc.test.ts`（新） | 新增 `list_roots` RPC（Win A-Z existsSync / Unix `/`）；`daemon.ts` 注册 list_roots handler + **删除** browse_folder handler（PowerShell Shell.BrowseForFolder）+ import 调整（删 exec/RpcError unused） | false |
| daemon（backend 部分） | 接口变更 + 新增 | `backend/app/modules/daemon/router.py`、`backend/app/modules/daemon/schema.py`、`backend/app/modules/daemon/tests/test_list_roots_endpoint.py`（新） | 新增 `POST /runtimes/{id}/list-roots` 端点（ownership `_get_owned_runtime` + send_rpc + 错误映射）+ `ListRootsResponse{roots}` schema；**删除** browse_folder 端点 + 内联 BrowseFolder{Request,Response} | false |
| frontend | 接口变更 + 新增 | `frontend/src/components/daemon/remote-folder-picker.tsx`（新）、`frontend/src/components/daemon/__tests__/remote-folder-picker.test.tsx`（新）、`frontend/src/lib/daemon.ts`、`frontend/src/app/(dashboard)/runtimes/page.tsx` | 新增 `RemoteFolderPicker` 自治组件（listRoots 初始化根 + Tree loadData 懒加载 listDir + 手输校验 + 错误降级 + onPick）；`lib/daemon.ts` 加 listRoots/删 browseFolder；`page.tsx` 接入组件（pickerRowIdx 替代 browseRuntimeId+browseTargetRef）+ 删全部内联树形逻辑/state/handler | false |

## 未匹配文件
无。所有 11 源码文件均匹配到 daemon / frontend 模块（_module-map paths glob：`backend/app/modules/daemon/**` + `sillyhub-daemon/src/**` → daemon；`frontend/src/**` → frontend）。

## 交叉验证
- **声明范围**（design §6 文件清单）：11 源码文件 —— 与 git diff 一致
- **任务范围**（plan.md task allowed_paths）：11 task 覆盖 11 文件 —— 一致
- **真实变更**（git diff）：11 源码文件 + 18 .sillyspec 规范文件（变更包四件套+任务蓝图+verify 产出）
- 三者一致，无声明遗漏、无未授权改动

## needs_review 汇总
全部 false —— 影响明确（接口新增 + 旧链路删除），design §7 接口契约 + verify-result.md 已验证。

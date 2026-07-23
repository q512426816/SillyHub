---
author: qinyi
created_at: 2026-07-12 01:30:00
change: 2026-07-11-daemon-client-container-overreach
---

# 模块影响分析（Module Impact）— daemon-client 容器越界修复

## 变更概述

删除 daemon-client 架构下 backend 容器越界做宿主文件操作的遗留代码：archive 模块（死代码，归属 sillyspec stage dispatch）+ `_ensure_change_dir_in_worktree`（越界活路径）+ scanner/parser 扁平布局 bug。无 DB migration、无 daemon 改动、无 delegate 写原语（D-001@v2）。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| backend | 逻辑变更 + 接口变更（删端点） | `app/modules/archive/`（整模块删除：router.py/service.py/tests/）| 删 archive_change/distill_knowledge 死端点（归属 sillyspec stage dispatch），main.py 注销 router | false |
| backend | 逻辑变更 | `app/modules/change/dispatch.py`、`app/modules/agent/service.py` | change_dir 删死路径：requires_worktree（propose/plan/execute/archive）全改 False + 删 `_ensure_change_dir_in_worktree` 及调用点（D-002） | false |
| backend | 逻辑变更 | `app/modules/change/service.py` | complete_stage("archive") 收尾补 status/location/archived_at 投影（D-007，删 archive 端点后唯一 status 写入点） | false |
| backend | 逻辑变更 | `app/modules/agent/post_scan_validator.py`、`app/modules/workspace/scanner.py`、`app/modules/workspace/parser.py` | scanner/parser 扁平布局修复（D-005）：PostScanValidator:156 去 .sillyspec 前缀 + WorkspaceScanner sillyspec=root 内容判定 + WorkspaceParser projects_subdir 扁平 | false |
| backend | 配置变更（删常量） | `app/modules/auth/permissions.py` | 删孤立 CHANGE_ARCHIVE 权限常量（端点删后孤立） | false |
| backend | 测试变更 | `tests/modules/change/test_dispatch_stage_config.py`、`tests/modules/change/test_dispatch.py`、`app/modules/change/tests/test_dispatch.py`、`app/modules/release/tests/test_router.py`、`app/modules/agent/tests/test_post_scan_validator.py`、`app/modules/workspace/tests/{test_scanner,test_parser,test_router}.py` | 同步 requires_worktree 断言（9 处 is False）+ fixture 扁平化 + 删 archive 端点测试 | false |
| frontend | 逻辑变更（删死代码） | `src/lib/archive.ts`（整文件删除）、`src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` | 删 archiveChange/distillChange 客户端 + handleArchive/archiving state（零调用死代码） | false |

## 未匹配文件

无。所有改动文件均匹配到 backend / frontend 模块（_module-map.yaml paths glob：`backend/**`、`frontend/**`）。

## 三重交叉验证

- **声明范围**（design.md §6 文件清单 17 源文件）：archive/(删) + change/(dispatch/service) + agent/(service/post_scan_validator) + workspace/(scanner/parser) + auth/(permissions) + main.py + 前端 archive.ts/page.tsx ✓
- **任务范围**（plan.md 11 task）：task-01~11 覆盖全部声明文件 ✓
- **真实变更**（git status 工作区）：上述文件全部在工作区改动中（未 commit）✓

三重一致，以真实变更为准。

## 模块文档同步建议

- `backend.md`：无需大改（archive 模块删除是清理，非新功能）。可在"变更流程"段提一句 archive 归属 stage dispatch（非 backend 端点）。
- `frontend.md`：无需改（删死代码，无新功能）。
- 不涉及 daemon（零改动）。

## 不影响

- `HostFsDelegate`（9 方法不变，D-001@v2 不补写原语）
- `sillyhub-daemon`（零改动）
- DB schema（无 Alembic 迁移）
- stage dispatch 流转（brainstorm/plan/execute/verify 不变，仅 archive 收尾加 status 投影）
- complete_lease 收尾委托链路（apply_patch/post_scan_validation/stage_callback 不变）

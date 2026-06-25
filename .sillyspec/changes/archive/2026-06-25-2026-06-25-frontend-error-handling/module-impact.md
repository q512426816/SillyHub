---
author: qinyi
created_at: 2026-06-25 12:55:00
change: 2026-06-25-frontend-error-handling
stage: archive
analyzer: impact-analyzer
---

# 模块影响分析 — 前端错误处理规范化

> 三重交叉验证：声明范围（proposal/design §6）✓ 任务范围（plan/tasks）✓ 真实变更（git diff f67294c5..main）✓。以 git diff 为准。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| **frontend/lib-errors**（新增） | 新增 | `frontend/src/lib/errors.ts`、`errors.test.ts`、`.sillyspec/docs/frontend/modules/lib-errors.md` | errMessage 纯函数 + useNotify hook（新模块，task-08 已建模块文档 + _module-map 注册） | false |
| **frontend/app-runtimes** | 逻辑变更 + 调用关系 | `runtimes/page.tsx`、`page.test.tsx`、`__tests__/page-usage.test.tsx` | daemon 删除：window.confirm→Modal.confirm + notify.error/success；测试同步（含 409/取消用例） | false |
| **frontend/components** | 调用关系 | `api-key-create-dialog.tsx`、`daemon-dir-browser.tsx`、`health-card.tsx`、`server-status-card.tsx`、`workspace-scan-dialog.tsx`、`workspace-member-add-dialog.tsx` | D 模式收敛：`${code}: ${message}` → errMessage（保持 inline） | false |
| **frontend/app-ppm** | 调用关系 | `ppm/problem-list/_forms.tsx`、`ppm/problem-changes/_forms.tsx` | 合并局部 notifyErr → import 全局 errMessage + message.error | false |
| **frontend/app-workspaces** | 调用关系 | `workspaces/[id]/members/page.tsx` | D 模式 4 处收敛（多行三元→errMessage） | false |
| **frontend/app-settings**（api-keys） | 调用关系 | `settings/api-keys/page.tsx` | D 模式 2 处收敛 | false |
| **frontend/lib-kanban**（stores） | 调用关系 | `stores/kanban.ts` | 合并局部 errMessage → import 全局（删局部函数 + ApiError import） | false |
| **backend/daemon**（runtime 子域） | 逻辑变更 + 接口变更 | `daemon/runtime/service.py`、`daemon/service.py`、`daemon/tests/test_lease_service.py` | 新增 DaemonRuntimeInUse(409) + delete_runtime 删前绑定检查；facade re-export（附 quick ql-20260625-001-b9e4） | false |
| **backend/daemon**（lease 子域） | 逻辑变更（附带） | `daemon/lease/context.py` | baseline mypy 修复：ws_row[0] Row 索引 → scalars().first()（非本次功能，解 ci-check 阻塞） | false |
| **backend/daemon** | 配置变更（附带） | `daemon/dist_router.py` | ruff format 附带（baseline dirty 文件，非本次逻辑变更） | **true** |

## 未匹配文件（非产品代码，sillyspec/文档自身）

| 文件 | 说明 |
|---|---|
| `.sillyspec/changes/2026-06-25-frontend-error-handling/**` | 本变更的规范文档（brainstorm/plan/execute/verify 产出），归档时随目录移动 |
| `.sillyspec/docs/backend/modules/daemon.md` | backend daemon 模块文档（quick 同步变更记录） |
| `.sillyspec/docs/frontend/modules/_module-map.yaml` | 注册 lib-errors 新模块 |
| `.sillyspec/quicklog/QUICKLOG-qinyi.md` | quick ql-20260625-001-b9e4 记录 |
| `.sillyspec/knowledge/uncategorized.md` | 2 条新知识（antd autoLetterSpacing + SillySpec contract） |
| `docs/sillyspec/brainstorm-supersede-dref-false-warning.md` | SillySpec 工具缺陷记录 |

## 模块文档同步状态

- `lib-errors.md`：task-08 已新建（展示策略规范 + 契约），无需额外同步
- `daemon.md`：quick 阶段已同步变更记录 + 契约摘要（DELETE runtimes 409）
- 其他 frontend 模块（app-runtimes/components/ppm 等）：本次仅"调用关系变更"（import lib-errors），模块文档无需更新（lib-errors.md 已是统一规范入口）

## needs_review 项

- `backend/app/modules/daemon/dist_router.py`：ruff format 附带（baseline dirty），非本次逻辑变更。归档时不影响，但需知悉此文件随本次 commit 进入 main。

---
change: 2026-07-02-workspace-config-flow
author: qinyi
created_at: 2026-07-02 15:52:00
---

# module-impact — 工作区配置流程重设计

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| backend（agent） | 逻辑变更 + 接口变更 | `agent/placement.py`, `agent/service.py`, `tests/` | placement 改用 MemberBindingResolver（per-member 路由）；start_init_dispatch 新增；lease payload 加 latest_spec_version | false |
| backend（workspace） | 逻辑变更 + 接口变更 | `workspace/service.py`, `router.py`, `tests/test_router.py` | scan_generate 加 owner 校验（D-003@V2）+ count 门禁（D-004）；POST /init 端点 | false |
| backend（member_runtimes） | 数据结构变更 | `member_runtimes/model.py`, `service.py`, `router.py` | 加 init_synced_at/spec_version 字段；router MemberBindingView 扩展 | false |
| backend（spec_workspace） | 逻辑变更 + 接口变更 | `spec_workspace/model.py`, `service.py`, `router.py` | spec_version 字段 + 递增逻辑；POST /sync-manual 端点 + 测试 | false |
| backend（daemon） | 接口变更 | `daemon/lease/context.py`, `change_write_router.py` | lease payload 扩展 latest_spec_version；change_write_router 识别 kind=spec-sync | false |
| backend（change） | 调用关系变更 | `change/router.py`, `service.py`, `schema.py`, `tests/` | 文件树注入（交叉影响，change-detail 协同） | false |
| frontend | 逻辑变更 + 接口变更 | `workspace-access-guide.tsx`, `workspace-binding-guard.tsx`, `workspace-daemon-switcher.tsx`, `page.tsx`, `spec-workspaces.ts` | 编辑入口（D-007）、switcher per-member（D-011）、三态引导+init dispatch（D-002/D-005）、扫描门禁弹窗（D-003@V2）、同步按钮（D-012） | false |
| sillyhub-daemon | 逻辑变更 | `spec-sync.ts`, `task-runner.ts`, `daemon.ts` | init lease 处理 + platform.json 写入、版本保鲜（D-010）、pull 前回灌（D-008）、kind=spec-sync outbox 处理（D-012） | false |

## 未匹配文件（交叉变更）

| 文件 | 所属变更 |
|------|---------|
| `sillyhub-daemon/scripts/install.sh` | change-detail-file-tree-editor |
| `backend/app/modules/change/`（4 文件） | change-detail-file-tree-editor |

## 总结

- 主要影响 3 个核心模块：backend（6 子模块逻辑/数据/接口变更）、frontend（流程+组件）、sillyhub-daemon（spec sync 扩展）
- 交叉依赖：backend/change/ 模块由 change-detail-file-tree-editor 主导，本变更仅影响其测试调用依赖
- 模块文档同步：archive 完成后，下次 scan 自动重生 module-card 时融入 init/sync 流程注意事项

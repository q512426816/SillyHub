---
author: qinyi
created_at: 2026-10-30T12:07:30
---
# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| components-sessions | `frontend/src/components/sessions/session-config-bar.tsx` | <!--TODO--> | <!--TODO--> |
| frontend | `frontend/src/components/daemon/session-panel/session-panel-page.tsx` | <!--TODO--> | <!--TODO--> |
| frontend | `frontend/src/components/prototype/session-config-pending-view.tsx` | <!--TODO--> | <!--TODO--> |
| frontend | `frontend/scripts/prototype-build.mjs` | <!--TODO--> | <!--TODO--> |
| test-utils | `frontend/src/components/sessions/__tests__/session-config-bar.test.tsx` | <!--TODO--> | <!--TODO--> |
| test-utils | `frontend/src/components/daemon/__tests__/session-panel-staged-list-refresh.test.tsx` | <!--TODO--> | <!--TODO--> |

## 未匹配文件

无（全部变更文件已归属到模块）。

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/components-sessions.md` | 更新components-sessions模块卡（本次变更涉及） | pending |
| `modules/frontend.md` | 更新frontend模块卡（本次变更涉及） | pending |
| `modules/test-utils.md` | 更新test-utils模块卡（本次变更涉及） | pending |
| `_module-map.yaml` | 无变化（未增删模块） | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。

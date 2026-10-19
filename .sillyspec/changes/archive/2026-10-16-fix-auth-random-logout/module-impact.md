---
author: qinyi
created_at: 2026-10-16 16:05:00
generated_by: sillyspec-plan-done
---
# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| backend | `backend/app/modules/auth/model.py` | 数据结构变更：Session 加 family_id 列（task-01） | 是 |
| backend | `backend/migrations/versions/c3f8a1d6e2b4_add_sessions_family_id.py` | 新增迁移：add nullable 列（task-01） | 是 |
| backend | `backend/app/modules/auth/service.py` | 逻辑变更：族传递链 + 复用检测族级吊销 + 文案 + 新 _revoke_session_family（task-02） | 是 |
| backend | `backend/app/core/config.py` | 配置变更：auth_refresh_grace_seconds 默认 60→300（task-02） | 否 |
| backend | `backend/app/core/tests/test_config_auth.py` | 测试扩充：默认值断言 60→300（task-02） | 否 |
| backend | `backend/tests/modules/auth/test_refresh_family_revocation.py` | 新增：族语义测试 4 用例（task-02） | 否 |
| backend | `backend/tests/modules/auth/test_refresh_grace_window.py` | 测试扩充：用例 2 改族断言 + 用例 3 过期 xfail 清偿（task-02） | 否 |
| lib-api | `frontend/src/lib/api.ts` | 注释契约同步：null=明确失效语义说明（task-03） | 否 |
| lib-token-refresh | `frontend/src/lib/token-refresh.ts` | 逻辑变更：doRefresh 状态码分流（task-03） | 是 |
| test-utils | `frontend/src/lib/__tests__/token-refresh.test.ts` | 测试扩充：分流用例 +3（task-03） | 否 |
| backend | `backend/tests/test_align_platform_change_events_migration.py` | 测试扩充：链尾 head 锚前移（task-01） | 否 |
| sillyspec | `.sillyspec/docs/multi-agent-platform/flows/auth-flow.md` | 文档同步：族语义 + grace 300 + TTL 纠错 + 前端分流契约（task-04；CLI 归类未覆盖 spec 文档，手动补录） | 否 |

## 未匹配文件

无（全部变更文件已归属到模块）。

### 归档终审裁决（2026-10-16，CLI 三重核对报告两类不一致的处置）

1. **「module-impact 列而 diff 无（4）」**：`.sillyspec/docs/multi-agent-platform/flows/auth-flow.md`、`.sillyspec/docs/SillyHub/modules/frontend_lib.md`、`.sillyspec/docs/SillyHub/modules/frontend_lib.changelog.md` 三项为**真实变更**（其中 3 份文档已被并行会话提交收编入 HEAD，内容经核验含本变更标记；auth.md/auth.changelog.md 为 staged 待统一提交）；`_module-map.yaml` 行系「无变化 skipped」登记行。diff 口径未覆盖 staged/已提交面导致误列，**列表无变化**。
2. **「diff 有而 module-impact 未列（6）」**：`.sillyspec/knowledge/INDEX.md`、`decisions/unmapped.md`、`fr/backend.md`、`uncategorized.md` 为 archive decision-distill 本步生成的**知识库产物**（本 change 的 D-001~D-008 提炼与 FR-auth-001..005 发号）；`.zcode/skills/deploy-to-server/SKILL.md` 为他者会话文件（.zcode/ 未跟踪）。均属「.sillyspec 产物 / 非本变更文件，不参与核对」，**不补录**。

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `.sillyspec/docs/backend/modules/auth.md` | 更新 auth 模块卡：族级吊销语义 + family_id + grace 300s + revoke_all 用途收窄（task-01/02） | done |
| `.sillyspec/docs/backend/modules/auth.changelog.md` | 追加 2026-10-16 变更条目 | done |
| `.sillyspec/docs/SillyHub/modules/frontend_lib.md` | 更新 token-refresh 状态码分流语义（task-03） | done |
| `.sillyspec/docs/SillyHub/modules/frontend_lib.changelog.md` | 新建 sidecar + 首条变更索引（task-03） | done |
| `_module-map.yaml` | 无变化（未增删模块） | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。

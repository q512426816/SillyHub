---
author: qinyi
created_at: 2026-07-14T01:26:19
---

# 模块影响分析（Module Impact）— 修复交互式会话僵尸状态

> 基于 git diff --name-only HEAD~1（commit 9e4faf06）真实变更 + _module-map.yaml paths glob 匹配。三重交叉验证（声明 design §6 / 真实 git diff / module-map），以 git diff 为准。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| backend | 逻辑变更 + 数据结构变更(data migration) | backend/app/modules/daemon/session/service.py | 新增 `_apply_session_terminal_status` 纯函数（D-002@v2 反向判定 session 终态 + D-005 幂等），供 close_interactive_run/cancel_lease 复用 | false |
| backend | 逻辑变更 | backend/app/modules/daemon/run_sync/service.py | close_interactive_run 在 :929 commit 前回写 session 终态（D-009 新 query），消除病灶 B（含批量路径 A），单轮→ended/failed、多轮→active | false |
| backend | 逻辑变更 | backend/app/modules/daemon/lease_service.py | cancel_lease interactive 分支收口 session=ended（D-003 kill=正常终止 + D-008 覆盖所有 interactive-kind lease 含 stage/scan/quick-chat + D-005 幂等），消除病灶 C | false |
| backend | 数据结构变更(data migration) | backend/migrations/versions/20260713_fix_session_zombie.py | alembic data migration 清历史僵尸（D-004：completed/killed→ended、failed→failed、孤儿→ended），实测 pending 7→0，down_revision=20260712_team_orch 单 head 接链，down 不可逆 | false |
| backend | 测试新增 | backend/app/modules/daemon/tests/test_apply_session_terminal_status.py（15 case）+ test_close_interactive_run_session_status.py（4 case）+ test_cancel_lease_session.py（6 case）+ backend/tests/test_session_zombie_migration.py（11 case） | 36 新测覆盖辅助函数判定表 + 回写 4 case + cancel 收口 6 case + 迁移映射 11 case | false |
| frontend | 逻辑变更(文案) | frontend/src/components/daemon/session-list-layout.tsx | pending 徽标文案"待处理"→"启动中"（本地 SESSION_STATUS_LABELS，不动全局 status-labels.ts / isActiveBadge） | false |

## 未触及模块（声明 vs 真实一致）

- **sillyhub-daemon**：零改动（D-006，git diff 无 sillyhub-daemon 文件）✅
- **deploy / ci / build**：零改动
- **backend 其他子域**（agent change dispatch / ppm / auth / workspace 等）：零改动（只 daemon/session + run_sync + lease_service + migrations）

## 关键约束遵守（design §3 非目标）

- 不改 AgentSession 状态机枚举（D-002，pending/active/reconnecting/ended/failed 不变）
- 不加新字段（D-002@v2 复用 spec_strategy + change_id）
- 不接 backend idle sweep（D-007，main.py lifespan 无后台任务）
- 零 API/表结构变更（纯 data migration + 逻辑回写）

## 遗留（记录到模块文档 + ROADMAP）

- task-03/04 真实 daemon lifecycle e2e 待补（integration-critical 建议项，verify PASS WITH NOTES）
- 4 pre-existing 测试失败（test_config_spec_transport + test_lease_service TestBuildClaimPayloadInteractiveSpecRoot）后续 quick 单独修
- 6 项 P2 代码风格（task-03 局部 import / task-04 相邻 interactive 判定可合并等）后续 quick 清理

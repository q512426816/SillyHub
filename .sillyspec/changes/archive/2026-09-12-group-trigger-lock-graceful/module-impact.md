# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `backend/app/modules/daemon/group/service/shadow.py` 已判定：归属 daemon 域 group 子域（与 messages.py 同目录既有文件，非游离；_module-map.yaml 未列 group 子域路径系索引粒度不含 service 子目录，非本变更引入）
- `backend/app/modules/daemon/group/service/messages.py` 已判定：同上（daemon 域 group 子域既有文件，逻辑变更：共识任务先行 commit+FK 撞锁降级）
- `backend/app/modules/daemon/tests/test_group_trigger_lock.py` 已判定：新增测试文件，归属 daemon tests（与 test_group_p1.py 等同目录惯例）
- `backend/migrations/versions/c97f3be457e6_merge_group_consensus_and_scheduled_.py` 已判定（归档终审补录）：新增迁移文件（alembic merge 合流 apply 引入的 20260910130000/20260912110000 双 head 分叉），无模块归属（migrations 目录），无 review 需求（纯合流无 DDL）

### 并行会话混入文件（非本变更，归因排除）

以下 8 个文件出现在 worktree diff 是 baseline checkpoint f9fdf6ce1 机制所致（主仓并行在途文件被连同打包，已在 baseline commit message 逐文件归因）：docs/sillyspec/finished/agent-log-ctx-attribution-mismatch.md、finished/agent-log-hub-attribution-cross-session-contamination.md、finished/conflict-compare-wrong-status-root.md、finished/docs-gate-shared-worktree-parallel-block.md、finished/platform-spec-junction-migration-split.md、finished/platform-sync-progress-rollback-and-db-corruption.md、finished/pre-commit-autofix-swallows-commit.md、scripts/migrate-spec-junction.mjs——均不属本变更改动，不参与影响矩阵。

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 不增改（skipped）：三个未匹配文件均为 daemon 域既有子域文件，索引未覆盖 group/service 子目录属既有粒度问题，非本变更引入；modules rebuild 属全量操作，且多个并行活跃变更共享索引，留待统一 rebuild 避免交叉干扰 | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。

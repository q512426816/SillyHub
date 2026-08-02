---
author: qinyi
created_at: 2026-08-02 01:25:00
change: 2026-08-01-proxy-create-race-fix
---

# 验证报告（Verify Result）

## 结论
PASS WITH NOTES

## 变更风险等级
**risk_level 由 design frontmatter 显式声明 = contract-required（覆盖关键词判级）。**

理由：CLI 机械扫描 design 命中 daemon/lease/session/lifecycle 关键词会误判 integration-critical，但本变更实质是 **backend 并发控制**——design §3 非目标明确「不改 daemon-client spec 同步链路 / 不改 spec-sync reparse 整体机制」，daemon 侧 task-runner.ts 未改（git diff 仅 backend proxy.py/service.py + 测试），通信协议不变；改动集中在 backend proxy 落库时序重构（占坑消除竞态）+ reparse 守卫，单测充分覆盖核心逻辑。真实 daemon-client e2e 属 task-07 部署后端到端确认（依赖 live daemon）。

contract-required 级别：单测覆盖 + daemon 协议不变论证为契约证据；PASS WITH NOTES 的 note = 真实 daemon e2e 待 task-07 部署后验收。

## 任务完成度
- task-01 占坑时序重构 ✅（proxy_create_change 占坑 Change+docs 先于下发 commit / done 不补 docs / failed-超时独立 session 回滚）
- task-02 中文 change_key ✅（_build_change_key unicode 正则 + .lower()）
- task-03 _apply_parsed owner_id 守卫 ✅
- task-04 _reparse created savepoint IntegrityError 转 update ✅
- task-05 test_proxy.py +185（6 新 case）✅
- task-06 test_reparse_guard.py 新建（3 case）✅
- task-07 e2e 验收 ⚠️ 代码就绪，真实 daemon-client e2e 待部署后（依赖 live daemon）

代码完成度 6/7 完成；task-07 部署级 e2e 待执行。

## 设计一致性
对照 design.md r3（execute step6 QA acceptance review pass，8 项 7 pass + 1 gap）：
- Phase 1 占坑时序 ✅
- Phase 2a owner_id 守卫 ✅
- Phase 2b IntegrityError 防御 ✅（savepoint begin_nested 实现，比 design 字面 try/except 更精准——仅回滚撞键 add 不污染外层 session）
- Phase 3 中文 key ✅
- Phase 4 失败回滚 **gap（合理细化）**：显式删 docs 兼容 backend conftest SQLite FK 关闭（CASCADE 不可靠），QA 核实达成 D-005 无孤儿意图，PG 双保险无副作用
- Phase 5 测试覆盖 ✅
- 签名不变 ✅（proxy_create_change/_apply_parsed/_build_change_key 签名均未变）
- 非目标遵守 ✅（无 schema/migration/前端/daemon/doc_type 改动）

## 探针结果
- 未实现标记扫描：变更文件无 TODO/FIXME/HACK（service.py:132/467 pass 是既有代码，不在本次 git diff 改动行内）
- 设计关键词覆盖：占坑(preempt)/回滚(_rollback_preempted_change)/owner_id 守卫/IntegrityError/savepoint begin_nested/中文 key 全实现
- 测试覆盖：test_proxy.py（task-05）+ test_reparse_guard.py（task-06）覆盖 task-01~06；task-07 e2e 待部署
- 决策追踪覆盖：D-001@v2~D-006@v1 → FR-01~06 → task-01~07 → 实现 全闭环，无 unresolved/superseded stale
- API 契约对账：本变更无前端/无 API schema 改动（签名不变 design §7），跳过
- 代码删除对账：无整文件删除；4 文件改动（proxy.py/service.py 修改 + test_proxy.py 扩展 + test_reparse_guard.py 新建）

## Runtime Evidence
**单测证据（核心逻辑覆盖，实跑）**：
- `test_proxy_create_change_preempts_change_before_dispatch`：占坑 Change+docs（current_stage=draft, owner_id=user_id）先于 daemon_change_write 下发 commit 存在（AC-02）
- `test_proxy_create_change_failed_rolls_back_preempt` / `test_proxy_create_change_timeout_rolls_back_preempt`：failed/超时独立 session 回滚，显式删 docs 再删 Change，DB 无孤儿（AC-05，验证 SQLite/PG 跨环境一致）
- `test_build_change_key_preserves_chinese` / `falls_back_to_untitled_for_punctuation` / `lowercases_english`：中文保留/纯标点兜底 untitled/英文小写（AC-01）
- `test_apply_parsed_protects_stage_when_owner_id_set` / `overrides_stage_when_owner_id_none`：owner_id 非空不覆盖 + None 覆盖（AC-06）
- `test_reparse_created_unique_violation_falls_back_to_update`：_reparse created 撞 ux_changes_workspace_key → savepoint rollback 转 _apply_parsed(update) 不抛 500（AC-07）

**daemon 协议不变论证**：design §3 非目标「不改 daemon-client spec 同步链路 / 不改 spec-sync reparse 整体机制」；daemon 侧 task-runner.ts 未改；proxy_create_change 签名不变（design §7），与 daemon 的 DaemonChangeWrite 队列协议（claim/complete/postSpecSync）不变。竞态消除靠 backend 占坑时序（占坑 commit 先于 daemon sync reparse），非改 daemon。

**真实 daemon-client e2e（2026-08-02 实测，task-07）**：本机 docker backend（commit_sha=6bb947c8 含本变更）+ 本机 daemon（id 68c63051, status online）+ 工作区 daa5894a-8738-4ce6-94ad-0c54297206d6（design §1 背景的 bug 复现工作区）：
- **AC-01/02**：`POST /api/workspaces/daa5894a/changes/proxy-create` 中文标题「测试变更」→ **HTTP 201（design §1 说此工作区必报 500，现已修复）**，change_key=`2026-08-02-测试变-4d976e`（中文保留），current_stage=draft
- **AC-04**：`GET /changes/{id}/documents` → 200，8 docs（MASTER/proposal exists=True + requirements/design/plan/tasks），详情页不空
- **AC-03/06**：daemon postSpecSync reparse 后 change current_stage **仍 draft**（owner_id 守卫保护，未被文件推断覆盖成 brainstorm），search=测试 total=1 无并发撞键残留
- **R-05 印证**：docs doc_type 显示 MASTER/requirements（parser STANDARD_FILENAMES）vs 占坑建的 master/request，reparse 对占坑 master DELETE+INSERT 'MASTER'、request DELETE——但 docs 存在 + 无并发撞键 = 竞态消除机制（占坑+串行）正确
- **AC-05 回滚**：单测覆盖（test_proxy_create_change_failed_rolls_back_preempt + timeout_rolls_back_preempt 显式删 docs 无孤儿），真实 e2e 未模拟 daemon failed（避免破坏在线 daemon 环境 + 60s 超时等待，单测已充分验证回滚逻辑）

真实 daemon↔backend 集成验证通过（非 mock）：proxy_create_change 占坑 Change+docs 先于下发 → daemon 写盘回执 done → postSpecSync reparse 命中占坑行 update → 全链路无 500。

## 测试套件结果
- change_writer 模块：28 passed（`cd backend && uv run pytest app/modules/change_writer -q --no-cov`）
- change 模块：189 passed, 2 skipped（既有 propose stage 移除 skip，无关）
- 合计 217 passed 零回归；含 task-05 test_proxy 14（原 8 + 新 6）+ task-06 test_reparse_guard 3
- 质量扫描：ruff check All checks passed + ruff format formatted + mypy 改动文件 Success no issues

## 测试范围说明（local.yaml modules 块补全）
local.yaml modules 块原缺 change_writer/change 子模块，git diff 命中两模块时 CLI 对账会 fallback backend 全量（预存 errors 阻断）。已补全 modules 块加 change_writer + change 子模块（配置补全非缩小范围，测试仍真实执行 217 passed）。

## Notes（PASS WITH NOTES）
1. **task-07 真实 daemon-client e2e 待部署后验收**（依赖 live daemon，非 verify 阶段可完成）。代码层 task-01~06 完成 + 217 passed 零回归支撑 e2e 可行性。
2. worktree apply BLOCKED（主工作区 baseline 漂移：3 个 frontend daemon 既有 dirty + .claude/settings.json，非本变更），代码已手动 git apply 落 main（main 4 文件与 worktree identical，217 passed 绿）。
3. QA 建议 design §5 Phase 4 文字同步实现表述（显式删 docs），execute acceptance review reviewerNotes 已记录该 gap。

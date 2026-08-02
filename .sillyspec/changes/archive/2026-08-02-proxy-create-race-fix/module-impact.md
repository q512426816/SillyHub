---
author: qinyi
created_at: 2026-08-02 10:25:00
change: 2026-08-01-proxy-create-race-fix
---

# 模块影响分析（Module Impact）— proxy-create 并发竞态 500 修复

## 三重交叉验证
- **声明范围**（design §6 文件变更清单）：proxy.py / service.py / test_proxy.py / change/tests
- **任务范围**（plan.md + tasks/task-01~07.md allowed_paths）：proxy.py / service.py / test_proxy.py / change/tests
- **真实变更**（git diff HEAD~2 = 6bb947c8 + 1b3a8239）：backend/app/modules/change/service.py、change_writer/proxy.py、change_writer/tests/test_proxy.py、change/tests/test_reparse_guard.py
- **以 git diff 为准**：业务代码三重一致，无悬空/超范围业务文件

## 模块影响矩阵
| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| backend（change_writer 子模块） | 逻辑变更 | backend/app/modules/change_writer/proxy.py | proxy_create_change 占坑时序重构（Change+docs 先于 daemon_change_write 下发 commit / done 不补 docs / failed-超时独立 session 回滚显式删 docs）；_build_change_key unicode 中文；新增 _rollback_preempted_change | false |
| backend（change_writer 子模块） | 新增测试 | backend/app/modules/change_writer/tests/test_proxy.py | +185（6 新 case：占坑先于下发 / failed 回滚 / 超时回滚 / 中文 key×3） | false |
| backend（change 子模块） | 逻辑变更 | backend/app/modules/change/service.py | _apply_parsed 加 owner_id is None 守卫；_reparse created 分支 savepoint begin_nested IntegrityError 转 update；import IntegrityError | false |
| backend（change 子模块） | 新增测试 | backend/app/modules/change/tests/test_reparse_guard.py | 新文件（3 case：owner_id 守卫非空不覆盖+None覆盖 / _reparse created 撞键转 update） | false |

## 未匹配文件（非业务模块）
- `.claude/settings.json` + `.claude/CLAUDE.md`：6bb947c8 commit 时混入（conversation 开始前既有的 staged 配置改动，非本变更核心，属工具配置调整）—— 建议后续如需可单独拆分，不影响本变更业务逻辑
- `.sillyspec/changes/2026-08-01-proxy-create-race-fix/*`（proposal/design/plan/tasks/verify-result/decisions/module-impact）+ `.sillyspec/quicklog/QUICKLOG-qinyi.md`：SillySpec 流程文档产物，非代码模块

## 影响范围结论
本变更影响集中在 backend `change_writer`（proxy 占坑时序）+ `change`（reparse 守卫）两子模块，逻辑变更 + 加性向后兼容，无 schema/migration/接口签名/前端/daemon 改动。needs_review 均为 false（影响完全确定）。真实 daemon-client e2e 已验证（daa5894a 工作区 proxy-create 201 不 500）。

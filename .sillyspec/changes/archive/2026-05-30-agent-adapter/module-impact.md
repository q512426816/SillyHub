---
author: qinyi
created_at: 2026-05-30 20:15:00
---

# 模块影响分析

## 变更：2026-05-30-agent-adapter

三重交叉验证结果：
- **声明范围**（design.md）：agent 模块主体（service, adapter, router, schema）+ core/errors + 新增 diff_collector
- **任务范围**（plan.md）：task-01~04 后端实现 + task-05~07 测试
- **真实变更**（git diff + untracked）：以真实变更文件为准

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 |
|------|----------|----------|-------------|
| agent | 逻辑变更 | `backend/app/modules/agent/service.py` | 新增 `_proc_registry` 进程注册表、`kill_run()` 方法、`_cleanup_stale_runs()` 定时清理、diff 收集集成 |
| agent | 逻辑变更 | `backend/app/modules/agent/adapters/claude_code.py` | 重构为进程生命周期管理：`register_process`/`unregister_process`、工作目录验证、CLAUDE_ALLOWED_PATHS 注入、PAT 脱敏输出 |
| agent | 接口变更 | `backend/app/modules/agent/router.py` | 新增 `POST /runs/{run_id}/kill` 端点 |
| agent | 新增 | `backend/app/modules/agent/diff_collector.py` | 新模块：git diff 收集 + 脱敏 + DiffResult dataclass + 大 diff 截断 |
| agent | 新增 | `backend/app/modules/agent/tests/test_kill.py` | Kill 全流程测试：正常终止/超时强杀/404/409/无权限 |
| core | 数据结构变更 | `backend/app/core/errors.py` | 新增 `AgentRunNotFound`、`AgentRunNotKillable` 错误类型 |

## 未匹配文件

| 文件路径 | 说明 |
|----------|------|
| `.sillyspec/changes/2026-05-30-agent-adapter/*` | 变更管理文档（proposal/design/tasks/plan/progress），不属于业务模块 |

## 更新结果

| 模块文档 | 操作 | 状态 |
|----------|------|------|
| `.sillyspec/docs/backend/modules/agent.md` | 新建（全量生成） | ✅ 已完成 |
| `.sillyspec/docs/backend/modules/core.md` | 新建（全量生成） | ✅ 已完成 |

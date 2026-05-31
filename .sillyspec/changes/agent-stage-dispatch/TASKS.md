# TASKS: agent-stage-dispatch execute — Wave 3

## 当前目标
执行 Wave 3 的 2 个任务（统一调度服务，依赖 W2）。

## Wave 3 任务
1. **task-07**: 新建 SillySpecStageDispatchService.dispatch_next_step() → `backend/app/modules/change/dispatch.py`
2. **task-08**: 迁移 change_writer 路由到新调度服务 → `backend/app/modules/change_writer/router.py`

## 前置依赖（W1+W2 已完成）
- AgentSpecBundle 已有 6 个 stage_dispatch 字段 ✅
- STAGE_AGENT_CONFIG 已覆盖 8 阶段 ✅
- CLAUDE.md 覆盖已修复 ✅
- build_stage_bundle() 已实现 ✅
- adapter 已支持 stage_dispatch prompt ✅

## 执行方式
按顺序执行 task-07 → task-08（task-08 依赖 task-07）。
每个 task 的详细说明在 `.sillyspec/changes/agent-stage-dispatch/tasks/task-NN.md`。

## 关键规则
- 先读 task 文件再动代码
- TDD：先写测试再写实现
- 全部完成后运行 `pytest backend/ --tb=short -q`
- 只改 task 指定的文件
- 不改 .sillyspec/ 下的文档文件

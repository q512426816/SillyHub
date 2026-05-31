# TASKS: agent-stage-dispatch execute — Wave 2

## 当前目标
执行 Wave 2 的 3 个任务（核心 Prompt 修复，依赖 W1）。

## Wave 2 任务
1. **task-04**: 修复 _execute_stage_run 中 CLAUDE.md 覆盖问题 → `backend/app/modules/agent/service.py`
2. **task-05**: 新增 build_stage_bundle() 上下文构建函数 → `backend/app/modules/agent/context_builder.py`（可能新建）
3. **task-06**: 修正 adapter 生成明确的 sillyspec 阶段命令 prompt → `backend/app/modules/agent/adapters/claude_code.py`

## 前置依赖（W1 已完成）
- task-01: coordinator.py 已标记 deprecated ✅
- task-02: AgentSpecBundle 已新增 6 个 stage_dispatch 字段 ✅
- task-03: STAGE_AGENT_CONFIG 已补齐 8 阶段 ✅

## 执行方式
按顺序执行 task-04 → task-05 → task-06（task-04/06 依赖 task-02，task-05 依赖 task-02+03）。

每个 task 的详细说明在 `.sillyspec/changes/agent-stage-dispatch/tasks/task-NN.md`。

## 关键规则
- **先读 task 文件**理解具体要求，再改代码
- TDD：先写测试再写实现
- 每完成一个 task 就运行相关测试验证
- 全部完成后运行全量测试 `pytest backend/ --tb=short -q`
- 只修改 task 指定的文件
- 不改 .sillyspec/ 下的文档文件

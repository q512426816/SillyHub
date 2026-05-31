# TASKS: agent-stage-dispatch execute — Wave 1

## 当前目标
执行 Wave 1 的 3 个并行任务（无依赖，基础设施层）。

## Wave 1 任务
1. **task-01**: 废弃 start_sillyspec_run 子进程路径 → `backend/app/modules/agent/coordinator.py`
2. **task-02**: 扩展 AgentSpecBundle 添加 stage_dispatch 字段 → `backend/app/modules/agent/base.py`
3. **task-03**: 补齐 STAGE_AGENT_CONFIG 阶段配置 → `backend/app/modules/change/dispatch.py`

## 执行方式
按顺序执行 task-01、task-02、task-03。每个 task 的详细说明在：
- `.sillyspec/changes/agent-stage-dispatch/tasks/task-01.md`
- `.sillyspec/changes/agent-stage-dispatch/tasks/task-02.md`
- `.sillyspec/changes/agent-stage-dispatch/tasks/task-03.md`

## 关键规则
- **先读 task 文件**理解具体要求，再改代码
- TDD：先写测试再写实现（task 文件里有 TDD 步骤）
- 每完成一个 task 就运行相关测试验证
- 全部完成后运行全量测试 `pytest backend/`
- 只修改 task 指定的文件
- 不要修改 SillySpec 文档（.sillyspec/changes/ 下的 md 文件）

# TASKS: agent-stage-dispatch execute — Wave 4

## 当前目标
执行 Wave 4 的 4 个任务（状态同步 + 工作区，依赖 W3）。

## Wave 4 任务
1. **task-09**: 实现 sync_stage_status 状态同步逻辑 → `backend/app/modules/change/dispatch.py`
2. **task-10**: 实现 step 完成后自动调度下一个 AgentRun → `backend/app/modules/agent/service.py`
3. **task-11**: 修复只读路径判断 → `backend/app/modules/agent/service.py`
4. **task-12**: 实现写阶段运行目录策略 → `backend/app/modules/agent/service.py`

## 前置依赖
- SillySpecStageDispatchService 已实现 ✅
- change_writer 路由已迁移 ✅
- build_stage_bundle() 已实现 ✅

## 关键规则
- 先读 task 文件再动代码
- TDD 流程
- 全部完成后 `pytest backend/ --tb=short -q`
- 只改 task 指定的文件
- 不改 .sillyspec/ 下的文档

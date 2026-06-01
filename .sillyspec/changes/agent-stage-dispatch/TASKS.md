# TASKS: agent-stage-dispatch execute — Wave 6（测试闭环）

## 当前目标
执行 Wave 6 测试闭环。补充缺失的 task-20/21/22 文件并实现测试。

## 现有测试文件（已由前序 Wave 自动创建）
- task-17: 由 W3 dispatch 测试覆盖（test_dispatch.py 已有 26+ tests）
- task-18: 由 W2 stage_dispatch 测试覆盖（test_stage_dispatch.py 已有 15+ tests）
- task-19: 由 W2 adapter 测试覆盖（test_stage_dispatch.py 已含 6 个 adapter tests）

## 缺失的 task 文件（需要你补充并实现测试）
- **task-20**: 单测 — SillySpecStageDispatchService 调度与同步 → `backend/tests/modules/change/test_dispatch.py`
- **task-21**: 集成测试 — dispatch + sync 单阶段链路 → 新建测试文件
- **task-22**: 集成测试 — draft → propose → plan 完整链路 → 新建测试文件

## 执行方式
1. 先读已有的 task-17/18/19 确认覆盖情况
2. 参考 plan.md 中 task-20/21/22 的描述，补充 task 文件（如果需要）
3. 实现集成测试 task-20/21/22
4. 运行全量 `pytest backend/ --tb=short -q`

## 关键规则
- 先读已有测试文件确认不重复
- 集成测试需要数据库，参考已有 test_dispatch.py 的 fixture 模式
- 全部完成后 `pytest backend/ --tb=short -q`
- 只改测试文件
- 不改 .sillyspec/ 下的文档

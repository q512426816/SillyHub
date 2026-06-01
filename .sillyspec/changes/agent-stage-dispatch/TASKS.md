# TASKS: agent-stage-dispatch execute — Wave 5

## 当前目标
执行 Wave 5 的 4 个任务（API 与前端契约，依赖 W4）。

## Wave 5 任务
1. **task-13**: 新增 DispatchResponse + TransitionResponse schemas → `backend/app/modules/change/schemas.py`（或 router.py 中内联）
2. **task-14**: 更新 change router 返回 TransitionResponse → `backend/app/modules/change/router.py`
3. **task-15**: 修正前端 transitionChange 返回类型 → `frontend/src/lib/changes.ts`（或 api.ts）
4. **task-16**: 更新变更详情页展示 SillySpec 步骤进度 → `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`

## 前置依赖（W1~W4 已完成）
- SillySpecStageDispatchService 已实现 ✅
- sync_stage_status + auto_dispatch 已实现 ✅
- dispatch_next_step 返回标准 dict ✅

## 执行方式
按顺序 task-13 → task-14 → task-15 → task-16。
每个 task 的详细说明在 `.sillyspec/changes/agent-stage-dispatch/tasks/task-NN.md`。

## 关键规则
- 先读 task 文件再动代码
- 后端 TDD：先写测试再写实现
- 前端：确保 TypeScript 编译通过（`cd frontend && npx tsc --noEmit`）
- 全部完成后 `pytest backend/ --tb=short -q` + 前端编译检查
- 只改 task 指定的文件
- 不改 .sillyspec/ 下的文档

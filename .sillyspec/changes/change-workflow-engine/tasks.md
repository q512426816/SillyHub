---
author: hermes
created_at: 2026-05-31T15:30:00
---

# 任务清单

## Task 1: Backend状态机核心
- **文件**: `model.py`
- **内容**: 新增 `StageEnum`（draft→review→approved→writing→review_writing→finalizing→archived）+ `TRANSITIONS` 合法转换规则表 + 转换校验函数 `can_transition(current, target)`
- **依赖**: 无

## Task 2: Backend工作流服务
- **文件**: `service.py`
- **内容**: 新增 `transition(change_id, target_stage, user)` / `submit_feedback(change_id, feedback, user)` / `check_archive_gate(change_id)` 三个服务方法
- **依赖**: Task 1

## Task 3: Backend API端点
- **文件**: `router.py`
- **内容**: 新增 `POST /changes/{id}/transition` / `POST /changes/{id}/feedback` / `GET /changes/{id}/archive-gate` 三个路由
- **依赖**: Task 2

## Task 4: Backend Agent边界守卫
- **文件**: `change_writer` router + service
- **内容**: 对 `change_writer` 的写入操作加阶段守卫，仅允许 `writing`/`finalizing` 阶段调用 agent
- **依赖**: Task 1

## Task 5: DB迁移
- **文件**: Alembic迁移脚本
- **内容**: changes 表新增 `stage` 列（默认 `draft`），可选新增 `feedback_log` 表
- **依赖**: Task 1

## Task 6: Frontend API层
- **文件**: `changes.ts`
- **内容**: 新增 `transitionChange()` / `submitFeedback()` / `checkArchiveGate()` 三个 API 调用函数
- **依赖**: Task 3

## Task 7: Frontend详情页工作流UI
- **文件**: 变更详情页组件
- **内容**: 阶段流转按钮（根据当前阶段动态渲染可转换目标）+ 反馈提交表单 + 归档门禁检查展示
- **依赖**: Task 6

## Task 8: Frontend列表页更新
- **文件**: 变更列表页组件
- **内容**: 新增阶段 Badge 展示，按阶段筛选
- **依赖**: Task 6

## Task 9: E2E验证
- **内容**: 全流程测试——draft→review→approved→writing→review_writing→finalizing→archived 完整链路 + 反馈提交 + 归档门禁 + Agent阶段守卫
- **依赖**: Task 1–8 全部完成

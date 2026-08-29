---
author: qinyi
created_at: 2026-08-29 21:26:40
---
# 模块影响分析（Module Impact）— worker 会话中断重派继承

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend:daemon | 修改 | session/service.py 分流挂起（worker failed/主会话 suspended）+sweep.py 同款；lease/context.py interactive 分支 resume_session_id 白名单透传 |
| backend:agent | 修改+新增 | 新增 worker_redispatch.py（重派编排：prepare_interactive_dispatch 复用+双表上下文+prompt 重渲染+三守卫+节流）；placement.py 加 resume 形参；patrol.py 职责④排除 daemon_interrupted |
| sillyhub-daemon:daemon | 修改 | payload 归一化 resumeSessionId→CreateSessionInput.resume→create 传 resume |
| sillyhub-daemon:protocol | 不变 | 无新消息类型 |
| sillyhub-daemon:resilience | 不变 | 不涉及 outbox |
| sillyhub-daemon:interactive（session-manager） | 修改 | create 透传 resume→_buildDriverOptions+损伤降级重建+resume_downgraded 事件 |
| sillyhub-daemon:interactive（types） | 修改 | CreateSessionInput 加 resume 可选字段 |
| frontend | 不变 | 无前端改动 |

## 未匹配文件

| 文件 | 处置说明 |
|---|---|
| backend/app/modules/agent/worker_redispatch.py | 新增文件（task-02 创建），归 backend:agent |
| sillyhub-daemon/tests/integration/worker-resume.test.ts | 新增测试（task-06），integration 目录已存在 |

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/backend.md`（daemon/agent 模块） | 更新 worker 分流挂起+重派继承说明 | done |
| `modules/sillyhub-daemon.md`（daemon/interactive） | 更新 resume 接线+损伤降级说明 | done |
| `_module-map.yaml` | 待 worker_redispatch.py 落地后由 scan 刷新 | skipped |

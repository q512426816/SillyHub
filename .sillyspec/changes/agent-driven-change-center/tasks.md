---
author: WhaleFall
created_at: 2026-06-04 10:40:22
---

# Tasks

## Wave 0: 规范与状态模型

### task-01: 统一 StageEnum + 新增 HumanGate + TRANSITIONS 更新
- 文件：`backend/app/modules/change/model.py`, `backend/app/modules/change/schema.py`
- 移除 rework_required/accepted，新增 blocked stage 和 HumanGate 枚举
- 更新 TRANSITIONS 邻接表

### task-02: DB 迁移 — ADD COLUMN human_gate + 旧数据映射
- 文件：`backend/migrations/versions/xxx_add_human_gate.py`
- ALTER TABLE + UPDATE 旧数据

### task-03: Schema/Response 返回 human_gate
- 文件：`backend/app/modules/change/schema.py`
- ChangeRead/ChangeSummary 增加 human_gate 字段

### task-04: 定义 Agent 驱动流转规则 — transition() human_gate 联动
- 文件：`backend/app/modules/change/service.py`
- transition() 完成后自动设置 human_gate

## Wave 1: 新建变更 + Agent 自动路由

### task-05: 简化新建变更表单（前端）
- 文件：`frontend/src/components/create-change-dialog.tsx`
- 只保留需求描述（必填）+ 模块（可选）

### task-06: 后端 create_change 适配 + request.md
- 文件：`backend/app/modules/change/service.py`
- 创建时 current_stage=draft, human_gate=none，写入 request.md

### task-07: 创建后自动 dispatch brainstorm agent
- 文件：`backend/app/modules/change/dispatch.py`, `backend/app/modules/change/service.py`
- 创建后自动 dispatch brainstorm（intake 路由）

## Wave 2: Review Gate API

### task-08: proposal-review API
- 文件：`backend/app/modules/change/router.py`, `backend/app/modules/change/service.py`, `backend/app/modules/change/schema.py`
- POST /changes/{id}/proposal-review

### task-09: plan-review API
- 文件：`backend/app/modules/change/router.py`, `backend/app/modules/change/service.py`, `backend/app/modules/change/schema.py`
- POST /changes/{id}/plan-review

### task-10: human-test API
- 文件：`backend/app/modules/change/router.py`, `backend/app/modules/change/service.py`, `backend/app/modules/change/schema.py`
- POST /changes/{id}/human-test

## Wave 3: 执行与验证闭环

### task-11: auto_dispatch_next_step gate 检查
- 文件：`backend/app/modules/change/dispatch.py`
- AgentRun 完成后检查 human_gate，需要确认则设置 gate 并停止 auto-chain

### task-12: verify 自动修复闭环
- 文件：`backend/app/modules/change/dispatch.py`
- verify 不通过自动 dispatch quick，再 verify，最多 3 轮

## Wave 4: 前端交互重构

### task-13: 前端类型 + API 调用补充
- 文件：`frontend/src/lib/change.ts`
- 增加 human_gate 类型、review API 调用函数

### task-14: 详情页按 gate 渲染操作面板
- 文件：`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`
- 替换阶段按钮为 gate-based 操作面板

### task-15: 文档确认状态 + AgentRun 区域
- 文件：`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`
- 文档状态独立于文件存在性；AgentRun 列表展示

## Wave 5: 测试与清理

### task-16: 后端测试
- 文件：`backend/app/modules/change/tests/`
- 覆盖所有 gate 转换、review API、verify 自动修复

### task-17: 清理旧状态和旧逻辑
- 文件：`backend/app/modules/change/`, `backend/app/modules/workflow/`
- 清理 rework_required/accepted 引用、旧 guard 规则

### task-18: 前端 E2E 验证
- 手工跑完整链路：新建 → propose → plan → execute → verify → human-test → archive

---
author: qinyi
created_at: 2026-05-31T14:15:00+08:00
---

# 任务清单 — 变更中心流程改造

## Task 1: 后端 schema + service 增强
- 文件: `backend/app/modules/change_writer/schema.py`
- 文件: `backend/app/modules/change_writer/service.py`
- 文件: `backend/app/modules/change_writer/router.py`
- 操作:
  1. ChangeCreateRequest 增加 description + scope 字段
  2. create_change() 写 proposal.md（含用户描述）+ 设 current_stage="created"
  3. ChangeCreateResponse 增加 current_stage 字段
- 依赖: 无

## Task 2: 前端新建变更页面
- 文件: `frontend/src/app/(dashboard)/workspaces/[id]/changes/create/page.tsx`（新建）
- 文件: `frontend/src/lib/changes.ts`
- 操作:
  1. changes.ts 增加 createChange() API 函数
  2. 创建表单页：标题 + 描述 + 规模选择
  3. 提交后 router.push 到详情页
- 依赖: Task 1

## Task 3: 后端 Agent SillySpec 调度
- 文件: `backend/app/modules/agent/coordinator.py`
- 文件: `backend/app/modules/agent/service.py`
- 文件: `backend/app/modules/change/router.py`
- 操作:
  1. 新增 execute 端点 POST /workspaces/{id}/changes/{key}/execute
  2. 创建 AgentRun 记录，后台运行 sillyspec 命令
  3. 每阶段完成回写 current_stage
- 依赖: Task 1

## Task 4: 前端变更列表改造
- 文件: `frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx`（如存在）或在 workspace 详情页中
- 文件: `frontend/src/lib/changes.ts`
- 操作:
  1. 列表项显示阶段 Badge（颜色编码）
  2. 新增"新建变更"按钮
  3. 按阶段筛选
- 依赖: Task 2

## Task 5: 前端详情页增强
- 文件: `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`
- 操作:
  1. "启动执行"按钮 → POST execute
  2. "文档"Tab → 读取变更目录下文件
  3. Agent 执行状态展示
  4. 轮询 current_stage 更新进度条
- 依赖: Task 3

## Task 6: E2E 联调
- 操作:
  1. 创建变更 → 验证 DB + 文件
  2. 启动执行 → 验证 Agent 调度
  3. 阶段推进 → 验证进度更新
  4. 文档生成 → 验证详情页展示
- 依赖: Task 2, 3, 4, 5

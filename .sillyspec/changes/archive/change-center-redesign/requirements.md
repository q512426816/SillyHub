---
author: qinyi
created_at: 2026-05-31T14:14:00+08:00
---

# 需求规格 — 变更中心流程改造

## 角色表

| 角色 | 说明 |
|------|------|
| 用户 | 通过 Web 端发起变更、查看进度、审批关键节点 |
| Agent (CC) | 被 SillySpec 调度执行代码变更 |
| 平台 | 协调用户需求与 Agent 执行 |

## 功能需求

### FR-1: 创建变更
**Given** 用户在工作区页面
**When** 点击"新建变更"并填写标题、描述、选择规模
**Then** 系统创建 Change 记录（current_stage=created, status=active）+ 文件目录 + proposal.md

### FR-2: 变更列表展示阶段
**Given** 工作区有多个变更
**When** 用户打开变更列表页
**Then** 每个变更显示标题 + 阶段 Badge（颜色编码）+ 创建时间

### FR-3: 启动变更执行
**Given** 一个 created/propose 阶段的变更
**When** 用户点击"启动执行"按钮
**Then** 平台调度 Agent(CC) 执行 SillySpec 流程，变更进入 propose（full）或直接进入 execute（quick）

### FR-4: 实时进度展示
**Given** Agent 正在执行变更
**When** 用户查看变更详情页
**Then** 阶段进度条实时更新（轮询），显示当前阶段和已完成阶段

### FR-5: 查看变更文档
**Given** 变更已生成文档（proposal/design/requirements/tasks）
**When** 用户点击"文档"Tab
**Then** 显示所有已生成文档列表，点击可查看内容

### FR-6: 变更执行完成
**Given** Agent 完成所有 SillySpec 阶段
**When** 最后一个阶段(verify)完成
**Then** 变更状态变为 archived，自动归档

## 非功能需求

- API 响应 < 500ms
- 变更创建为同步操作（< 2s）
- Agent 执行为异步操作（可运行数分钟到数小时）
- 前端轮询间隔 5 秒

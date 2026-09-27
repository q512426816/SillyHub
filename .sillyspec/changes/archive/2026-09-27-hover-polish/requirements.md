---
author: flow-machine-draft
created_at: 2026-09-27T01:26:02.698Z
---
# 需求规格（Requirements）— 2026-09-27-hover-polish

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: 变更中心与工作区列表行 hover 为实色 muted 背景+transition-colors 1
Given 系统就绪
When 变更中心与工作区列表行 hover 为实色 muted 背景+transition-colors 100ms 级过渡，无紫色边框
Then 行为符合本条标准描述

### FR-02: 标题链接 hover 下划线保持
Given 系统就绪
When 标题链接 hover 下划线保持
Then 行为符合本条标准描述

### FR-03: hover 操作浮现过渡平滑
Given 系统就绪
When hover 操作浮现过渡平滑
Then 行为符合本条标准描述

### FR-04: 相关测试全绿 + tsc 0 + 部署后浏览器 hover 态截图核对
Given 测试 相关模块就绪
When 相关测试全绿 + tsc 0 + 部署后浏览器 hover 态截图核对
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 -->
frontend/src/components/primer + workspace-card + 两列表页测试 95/95（hover 类变化不影响行为断言）

<!--AGENT:测试绑定FR-02 -->
同上套件 + 部署后浏览器 hover 态截图核对

<!--AGENT:测试绑定FR-03 -->
同 FR-01 套件（95/95）+ tsc 我方三文件零错误（flow-diagram.tsx 报错为并行会话新文件非本变更）

<!--AGENT:测试绑定FR-04 -->
不适用：hover 视觉态为浏览器人工核对，非自动化测试面

---
author: qinyi
created_at: 2026-05-29 17:34:40
---

# Proposal

## 动机

Workspace Graph 解决了平台的数据面，但普通代码仓库仍需要一条可控接入路径。平台不能要求每个仓库一开始就有完整 `.sillyspec`，也不能让 Agent 直接手写规范文件格式。

本变更要让普通 repo 可以注册为 Workspace，并由平台托管 `SpecWorkspace`。SillySpec CLI 负责 bootstrap、sync、校验等格式敏感操作，平台负责流程编排、状态记录和前置门禁。

## 关键问题

### 1. Workspace 创建仍偏向已规范化仓库

如果注册时强制 repo 内已有 `.sillyspec`，平台无法接入大量普通代码仓库。

### 2. Spec 文件格式不应由 Agent 直接拼写

规范文档是核心资产。让 Agent 手写目录、frontmatter、阶段文件容易产生格式漂移。

### 3. 执行前缺少统一 Spec 门禁

后续 Workflow、Runner、Knowledge 都依赖规范完整性。没有 `SpecValidator`，执行阶段会把格式错误推迟到运行时暴露。

## 变更范围

- `POST /api/workspaces` 支持 `spec_strategy`。
- 新增 Workspace spec bootstrap / sync / validate 流程。
- `SpecWorkspace` 支持平台托管规范空间和 repo 内规范空间的映射。
- 封装 SillySpec CLI 调用，只暴露受控命令。
- 建立 `SpecValidator` 作为创建、同步、执行前的硬门禁。

## 不在范围内（显式清单）

- 不做 Local Runner 执行。
- 不做 Workflow/Policy 控制面。
- 不做 Knowledge 生命周期。
- 不做 Server Sandbox Runner。
- 不改变 Workspace Graph 数据模型。

## 成功标准（可验证）

- 普通 repo 可以注册为 Workspace，不要求 repo 内已有 `.sillyspec`。
- `spec_strategy=bootstrap` 能生成平台托管规范空间。
- `spec_strategy=import` 能导入 repo 内现有 `.sillyspec`。
- `spec-sync` 能把规范空间与 repo 内路径进行受控同步。
- `SpecValidator` 能在执行前发现缺失 frontmatter、缺失核心文件、阶段不一致等问题。

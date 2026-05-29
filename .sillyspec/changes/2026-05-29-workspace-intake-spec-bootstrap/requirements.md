---
author: qinyi
created_at: 2026-05-29 17:34:40
---

# Requirements

## 角色

| 角色 | 说明 |
|---|---|
| 平台管理员 | 注册普通代码仓库并选择 spec_strategy |
| 开发者 | 查看和同步 Workspace 的规范空间 |
| Agent | 通过平台 API 获取合法 SpecWorkspace |

## 功能需求

### FR-01: 普通 repo 注册

Given 一个没有 `.sillyspec` 的代码仓库
When 管理员使用 `spec_strategy=bootstrap` 创建 Workspace
Then Workspace 创建成功
And 平台创建对应 SpecWorkspace

### FR-02: 导入已有规范

Given repo 内已有 `.sillyspec`
When 管理员使用 `spec_strategy=import`
Then 平台导入规范文件并记录来源路径

### FR-03: 规范同步

Given Workspace 已有关联 SpecWorkspace
When 调用 `spec-sync`
Then 平台通过受控 CLI adapter 同步规范文件

### FR-04: 规范校验

Given SpecWorkspace 缺少必要 frontmatter
When 调用 `spec-validate`
Then 返回 error 级诊断并阻止进入执行阶段

## 非功能需求

- 兼容性：未配置 spec_strategy 的旧 Workspace 创建路径保持可用。
- 可测试：bootstrap、import、sync、validate 都需要 pytest。
- 可审计：每次 sync/validate 记录操作结果。

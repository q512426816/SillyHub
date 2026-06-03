---
author: qinyi
created_at: 2026-06-03T10:00:00
---

# CONCERNS — backend

## 高优先级

### Auth 模块无测试
`auth` 模块涉及 JWT 认证和 RBAC 权限控制，但没有任何测试文件。认证是安全关键路径，缺少测试可能导致权限绕过等问题无法被检测到。

### Master Key 安全
`SILLYSPEC_MASTER_KEY` 和 `SECRET_KEY` 通过环境变量传入。密钥管理策略未文档化，生产环境需要密钥轮换方案。

## 中优先级

### Agent 子进程可靠性
Agent 通过 `asyncio.create_subprocess_exec` 调用 Claude Code CLI：
- CLI 崩溃可能导致孤儿进程
- 长时间运行可能超时
- stderr 输出可能丢失关键错误信息

### spec_profile 多个 TODO
`spec_profile` 模块有 5 个未实现 TODO：
- `policy.py:61` — 阶段冲突检测
- `policy.py:97` — 文档冲突检测
- `provider.py:76/86/96` — 发现/加载逻辑

这些是占位实现，功能未完成。

### 全链路异步一致性
项目全链路 async，需确保所有数据库操作使用 async session，避免在 async 上下文中混用同步调用。

## 低优先级

### type: ignore / noqa 使用
约 12 处标注，主要集中在复杂的类型推断场景。

### 异常命名风格
有意忽略 N818（异常不以 "Error" 结尾），统一使用领域术语（如 `WorkspaceNotFound`），是有意为之的设计选择。

## 依赖风险

### Claude Code CLI 版本耦合
`CLAUDE_CODE_VERSION` 构建时注入，升级需重建镜像，CLI API 变更可能不兼容。

### SillySpec CLI 版本耦合
同上，`SILLYSPEC_VERSION` 构建时注入。

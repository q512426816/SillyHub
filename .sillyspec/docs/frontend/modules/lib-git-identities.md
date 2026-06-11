---
schema_version: 1
doc_type: module-card
module_id: lib-git-identities
author: qinyi
created_at: 2026-06-10T16:55:00
---

# lib-git-identities

## 定位
Git Identity（Git 身份）API 客户端。

## 契约摘要
- `listGitIdentities()` — 列出 Git 身份
- `createGitIdentity(data)` — 创建 Git 身份
- `getGitIdentity(identityId)` — 获取单个身份
- `revokeGitIdentity(identityId)` — 撤销身份
- `checkGitAccess(data)` — 检查 Git 访问权限
- 类型：GitIdentityCreate、AccessCheckRequest

## 关键逻辑
- 全局接口（不以 workspaceId 为前缀），调用 `/api/git-identities` 端点
- checkGitAccess 用于验证某个身份是否有仓库访问权限

## 注意事项
- 无特殊注意点

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->

---
author: qinyi
created_at: 2026-06-21T01:05:40+0800
change: 2026-06-21-ppm-frontend-alignment
---

# 决策台账

## D-009@v1: 项目成员角色改用 auth.Role
- type: architecture
- status: accepted
- source: user
- question: 项目成员角色用 auth.Role(system 角色,对齐源)还是 ppm 独立枚举(D-004)?
- answer: auth.Role(对齐源 system 角色,多选)
- normalized_requirement: project-member 角色从 /api/admin/roles 拉下拉多选;不复用 ppm 独立枚举
- impacts: [W1, design §5/§7]
- evidence: AskUserQuestion 用户选"auth.Role 对齐源"
- priority: P0
- supersedes: D-004@v1(2026-06-20-ppm-module-migration 的"ppm 内独立枚举")

## D-010@v1: 附件保持 D-007(URL 管理)
- type: boundary
- status: accepted
- source: user
- question: 附件上传真上传(后端文件服务)还是 URL 管理?
- answer: 纯前端 URL 管理(保持 D-007,不建文件服务)
- normalized_requirement: 附件用 PpmFileUrls 组件(多 URL 增删 UI),不真上传/不建后端文件服务
- impacts: [W4, design §3/§5]
- evidence: AskUserQuestion 用户选"前端URL管理(保持D-007)"
- priority: P1

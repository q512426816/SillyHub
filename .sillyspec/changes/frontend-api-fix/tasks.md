---
author: qinyi
created_at: 2026-05-31T10:00:00
---

# Tasks — frontend-api-fix

- [ ] 重写 src/lib/components.ts 的4个函数（listComponents, getComponent, reparseComponents, getTopology）改为调用现有 workspace API
- [ ] 修复 src/lib/workspaces.ts 的 deleteRelation 路径缺少 workspace_id
- [ ] 更新 workspace 详情页 listComponents 引用
- [ ] 更新 create-change 页面 listComponents 引用
- [ ] 更新 scan-docs 页面 listComponents 引用
- [ ] 运行 npm run build 验证无类型错误

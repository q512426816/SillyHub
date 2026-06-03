---
author: qinyi
created_at: 2026-06-03T09:45:00
---

# ci

## 定位
GitHub Actions CI 配置，负责代码质量门禁和自动化测试。
不负责部署流程。

## 契约摘要
- backend-ci.yml: 后端 Python CI（lint + test）
- frontend-ci.yml: 前端 Node.js CI（lint + typecheck + test）

## 关键逻辑
```
push/PR → 触发对应 CI workflow
  → 安装依赖 → lint 检查 → 运行测试
  → 结果报告到 PR 状态
```

## 注意事项
- CI 配置变更需注意分支过滤规则
- 后端 CI 需要数据库服务（可能需要 service container）

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->

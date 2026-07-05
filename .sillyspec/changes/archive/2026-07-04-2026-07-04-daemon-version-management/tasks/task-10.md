---
author: qinyi
created_at: 2026-07-04 17:33:31
task_id: task-10
allowed_paths:
  - frontend/src/app/(dashboard)/runtimes/__tests__/page.test.tsx
---

# task-10: 前端测试

## 所属 Wave
Wave 3

## 文件
- 修改 `frontend/src/app/(dashboard)/runtimes/__tests__/page.test.tsx`（若无则新建对应测试文件）

## 验收标准
- [ ] 版本号 + SHA 短码显示断言
- [ ] 徽标 4 态断言（最新/可升级/未知/dev）
- [ ] 升级按钮点击调 triggerDaemonSelfUpdate（mock fetch/assert called）
- [ ] 成功/失败 toast 断言
- [ ] offline runtime 按钮禁用断言
- [ ] runtime mock 数据含新字段 daemon_version/daemon_build_id
- [ ] 全量前端测试通过零回归

## 依赖
- task-09（页面已改）

## 覆盖
- FR-06, FR-07, FR-08, D-006@V1

## 测试命令
`cd frontend && pnpm test`

## 风险防范
- runtime mock 要含 daemon_version/daemon_build_id 字段（避免 undefined 渲染）
- 注意 React Query hook 测试坑（参见 memory: react-query 迁移进度）

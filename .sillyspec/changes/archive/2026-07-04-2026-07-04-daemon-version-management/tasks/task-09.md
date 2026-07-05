---
author: qinyi
created_at: 2026-07-04 17:33:31
task_id: task-09
allowed_paths:
  - frontend/src/app/(dashboard)/runtimes/page.tsx
---

# task-09: 前端 runtimes 页版本展示 + 升级按钮

## 所属 Wave
Wave 3

## 文件
- 修改 `frontend/src/app/(dashboard)/runtimes/page.tsx`：
  - runtime 行显示 daemon_version + build_id 短码（取前 7 位）
  - 徽标逻辑：build_id == latest.latest_build_id 且非 dev/unknown → 「最新」(绿)；不等且均有效 → 「可升级」(橙)；NULL → 「未知」(灰)；dev → 「dev」
  - 「升级到最新版」按钮：online 时调 triggerDaemonSelfUpdate(runtime_id)，成功/失败 toast；offline 禁用
  - 按 RUNTIME_ADMIN 权限渲染按钮
  - latest 来自 GET /api/daemon/version（页面加载时拉取）

## 验收标准
- [ ] runtime 行显示版本 + SHA 短码 + 徽标（4 种状态正确）
- [ ] 升级按钮调 API + toast + offline 禁用
- [ ] 权限门控（非 admin 不显示按钮）
- [ ] 样式参考 archive frontend-style-system（CLAUDE.md 规则 16）
- [ ] 现有 runtimes 页测试不回归

## 依赖
- task-08（类型 + hook）

## 覆盖
- FR-06, FR-07, FR-08, D-005@V1, D-006@V1

## 风险防范
- D-006：异步 toast，不做实时进度（YAGNI）
- 徽标比对统一用 build_id（不用语义版本，因 self-update 响应字段名误导 R-07）

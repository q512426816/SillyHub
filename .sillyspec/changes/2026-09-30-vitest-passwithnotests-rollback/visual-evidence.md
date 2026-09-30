# 视觉证据 — 2026-09-30-vitest-passwithnotests-rollback

## 用户可见的视觉差异

无。本变更是测试配置回滚（frontend/vitest.config.ts 移除 passWithNoTests）与
工具缺陷文档归档（docs/sillyspec/ → finished/），不触任何页面/组件/UI 文件。

## 验证方式

- 撤除后正常目标测试照常执行通过（top-bar.test.tsx）；
- 门禁函数端到端复核（原始失败面 faceOverride）：deps(auto-jsx) 实跑 3 文件
  全绿、e2e 走披露式 skip——修复不依赖 passWithNoTests 兜底。

## 视觉降级

无降级（无 UI 改动）。

---
author: WhaleFall
created_at: 2026-08-05 14:20:00
status: active
---

# execute 批量完成误勾端到端/deployment-critical task（跳过真验证）

## 现象
execute 阶段 CLI "批量完成"：plan.md 全勾 + 代码核验通过 → 一次性补完剩余 step 直达阶段完成。但**端到端/deployment-critical task（如 task-08 真实 daemon↔backend 集成）被自动勾 [x]**，即使该 task 没实际跑端到端验证（review.json cannot_verify 或缺失）。

后果：
- task-08 端到端没真跑（本地无全栈环境），但 plan.md 勾 [x] → 触发批量完成
- execute 跳过 stage acceptance review（独立 QA 子代理）产出
- verify 阶段 integration-evidence 门控补救（但 execute 自身放行）

## 根因
批量完成判定"plan 全勾 + 代码核验"即收尾，没区分 task 类型。端到端/deployment-critical task 的 [x] 应依赖真验证（review.json pass），不应自动勾或被 plan-checkbox 回填误勾。

## 绕过方案（本次用）
verify 阶段 integration-evidence 门控（cli.ts 部署级 + daemon 集成级）拦截，强制 verify-result.md Runtime Evidence + 真实启动 + HTTP 集成测试。execute 批量完成漏的，verify 补。但理想是 execute 不放行未验证端到端 task。

## 建议（工具修复）
- 批量完成判定加例外：端到端/deployment-critical task（命中 cli.ts/main.ts/daemon/startup + integration 关键词）不自动勾 [x]，必须 review.json spec+quality=pass（非 cannot_verify）
- 或：批量完成时，cannot_verify task 不算"全勾"，仍需显式 --done 逐步

## 关联
2026-08-05-daemon-start-time task-08（端到端）被误勾触发批量完成。verify integration-evidence 补救（cli.ts 启动 + PG migration + HTTP 集成测试 + 真 daemon register）。

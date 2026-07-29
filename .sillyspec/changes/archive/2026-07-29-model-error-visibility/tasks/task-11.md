---
id: task-11
title: 回归测试 + e2e 复现模型失败可见
title_zh: 回归与端到端验证错误可见性
author: qinyi
created_at: 2026-07-29 10:34:02
priority: P0
depends_on: [task-04, task-10]
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-008@v1]
allowed_paths:
  - sillyhub-daemon/tests/model-error/classifier.test.ts
  - frontend/src/components/agent-log/__tests__/run-error-item.test.tsx
expects_from:
  task-04:
    - contract: NotifyRunResultError
      needs: [error]
  task-10:
    - contract: SessionErrorDisplay
      needs: [display]
goal: >
  回归验证 NOISE 折叠不误吞错误项与成功路径不回归，e2e 复现模型失败时错误项可见。
implementation:
  - 回归 normalize 测试：error_detail 错误项不进 NOISE 折叠白名单（R-02）
  - 回归成功路径：is_error=false 无 ModelError、error_detail=None，日志归一化不受影响
  - e2e 复现模型调用失败时（GLM 额度耗尽或无效凭证注入触发 auth_failed）会话页显示错误项与 actions
  - 执行期 GLM 额度若已重置恢复，改用无效凭证注入或 mock 429 验证 classifier 各 type
acceptance:
  - NOISE 折叠不误吞 error_detail 错误项
  - 成功路径（is_error=false）不产 ModelError，无回归
  - e2e 模型失败时会话页显示错误项 + 原因 + hint + actions
verify:
  - cd frontend && pnpm test（normalize 与 run-error-item 回归）
  - cd sillyhub-daemon && pnpm test（classifier 8 类）
  - 手动 e2e 触发模型失败后会话页看到错误项
constraints:
  - 不改 GLM token（D-008，独立运维问题）
  - 不回填历史 failed run（D-008）
  - 不自动恢复或自动切换供应商（D-008，仅手动 action）
---

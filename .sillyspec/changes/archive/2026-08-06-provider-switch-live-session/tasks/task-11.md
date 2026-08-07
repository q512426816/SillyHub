---
id: task-11
title: Integration tests for four provider-switch scenarios
title_zh: 集成测试四个场景
author: WhaleFall
created_at: "2026-08-06 16:40:41"
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09]
blocks: []
requirement_ids: []
decision_ids: []
allowed_paths:
  - backend/app/modules/daemon/tests/
  - backend/tests/modules/daemon/
  - backend/tests/e2e/
goal: >
  四场景端到端集成测试验证运行中会话热切换全链路,覆盖启动切换生效、停止回退本机凭证、生成中等待 turn 边界、新凭证失败保留原供应商,确保后端推送经 WS 抵达 daemon 并触发受控重启链路联通,且不破坏 brownfield 零回归。
implementation:
  - 场景一启动供应商后运行中会话在 turn 边界切换到新 provider_config 生效并保留对话历史
  - 场景二停止供应商后 daemon 收到 null provider_config 回退宿主机本机 claude 凭证路径
  - 场景三会话生成中触发切换仅标记 pendingSwitch 等 _onResult turn 收尾后再 reload 不中断当前回复
  - 场景四新供应商凭证探测失败时保留原供应商运行中会话不受影响前端提示错误
  - mock daemon WS 端或真实 ws_hub 加 fake daemon 连接接收 PROVIDER_CONFIG_CHANGED 消息
  - mock GLM 与 kimi 的 Anthropic 兼容端点避免依赖真实凭证与外部网络并参照 test_wave5_integration.py 惯例
acceptance:
  - 四个场景集成测试用例全部通过且断言子进程 env 携带新 provider_config 或回退本机凭证路径
  - 生成中切换不打断当前 turn 完成后再触发 reload
  - 凭证失败回滚断言 is_default 不变且未推送任何 PROVIDER_CONFIG_CHANGED 消息
verify:
  - cd backend && pytest backend/app/modules/daemon/tests/ 跑绿新增集成用例
  - cd backend && pytest backend/tests/modules/daemon 验证 daemon 模块无回归
  - cd backend && pytest backend/tests/e2e 验证跨模块 e2e 链路无回归
constraints:
  - 先用 Glob 确认项目集成测试目录惯例再加 allowed_paths 已确认无 integration 目录用 daemon tests 与 e2e
  - mock GLM 与 kimi 兼容端点避免真实凭证泄露与网络依赖
  - 遵守 brownfield 零回归未切换供应商时所有行为与现状逐字一致
  - 测试逻辑本身有误方可改测试禁止为实现而绕过断言
---

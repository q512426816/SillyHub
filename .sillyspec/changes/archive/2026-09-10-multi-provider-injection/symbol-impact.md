# 符号影响面报告（2026-09-10-multi-provider-injection）

- task-01: 无既有签名变更——全新符号（writeCodexHome/CodexHomeWriteInput）。
- task-02: 无既有签名变更——全新符号（writePiDir/PiDirWriteInput）。
- task-03: **签名级新增（调用侧）**——daemon.ts spawn 路径与 task-runner.ts STAGE_META 处新增 applyProviderFileSettings 调用点；applyClaudeSettings 现有调用**加 agent_kind 守卫**（行为门控非签名变更）；credential-injector.ts 仅注释。
- task-04: daemon.ts 既有 _routeProviderConfigChanged 处理器扩展 per-session 重写（处理器内部逻辑，签名不变）；onSessionEnd 清理钩子新增调用点。
- task-05: **schema 词表变更**——agent_kind Literal 增 "codex"（放宽非破坏）；service.update 新增组合校验分支；pi_kind 测试断言翻转（测试侧）。
- task-06: 前端表单组件选项/字段增改；gen:types 生成物重生成。
- task-07: 新增冒烟脚本/测试 + 文档；无产品签名变更。

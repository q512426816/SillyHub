---
id: task-13
title: 端到端验证
title_zh: 配 provider → 跑 agent → 验 claude env 注入 + 日志脱敏 + 未配零回归（手动+脚本）
author: qinyi
created_at: 2026-07-25 17:06:11
priority: P0
depends_on: [task-05, task-07, task-10, task-12]
blocks: [task-14]
requirement_ids: [FR-04]
decision_ids: [D-007@v1]
allowed_paths:
  - .sillyspec/changes/2026-07-25-llm-provider-management/tasks/task-13.md
goal: >
  端到端验证全链路：配默认 provider → 跑 agent → claude 进程 env 含平台下发值；删除/未配 → daemon 走本机
  env 零回归（D-007）；api_key 全链路脱敏。纯验证 task，不新增生产代码。
implementation:
  - 场景1（已配）：UI 新建 provider（base_url + api_key + 角色映射）并设默认 → 触发一次 agent run → daemon 侧断言 spawn env 含 ANTHROPIC_BASE_URL / 认证 env（auth_field 决定 AUTH_TOKEN 或 API_KEY）/ ANTHROPIC_DEFAULT_{SONNET,OPUS,FABLE,HAIKU}_MODEL / ANTHROPIC_MODEL / extra_env
  - 场景2（零回归）：删除该 provider 或切到无默认用户 → 同样触发 agent run → daemon spawn-env 第 0 层跳过，行为与现状一致（走 process.env / credentials.json / tool_config.env 三层）
  - 脱敏核验：grep daemon 日志 / backend AuditLog / submitMessages / complete_lease payload，确认 api_key 仅以 masked 或 ***REDACTED*** 出现，无明文
  - 证据：env 断言用 daemon 侧临时日志或脱敏后 spawn-env dump（验收后清理）
acceptance:
  - 场景1：claude 进程 env 含平台下发的 base_url / 认证 / 角色模型映射
  - 场景2：未配/删除 provider 时 daemon 行为零回归（三层合并不变）
  - api_key 全链路（日志/审计/submitMessages/complete_lease）无明文
verify:
  - 启 daemon + backend（docker compose 或本机），配 provider 设默认，跑一次 agent，检查 env 注入 + 日志脱敏
  - 删除 provider / 切无默认用户复跑，确认零回归
constraints:
  - 回归类 task，allowed_paths 仅本 task 文件；临时脚本写 spikes/ 或 tests/，验收后清理
  - 不新增生产代码（FR-04 全链路验证出口，依赖 task-05/07/10/12 单测已绿）
  - 停 daemon 按 --server 区分实例，勿 taskkill /IM 通杀（见 memory multi-daemon-instances）
  - 本机开发数据可重置（CLAUDE.md 规则 11）；记录命令输出/截图作为证据
---

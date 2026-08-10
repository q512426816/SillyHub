---
id: task-12
title: Wave2 end-to-end acceptance + docs + guard removal
title_zh: Wave2 端到端验收 + 文档同步 + 移除过渡守护
author: qinyi
created_at: 2026-08-09 01:31:00
priority: P0
depends_on: [task-11]
blocks: []
allowed_paths:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/.sillyspec/docs/backend/modules/llm_provider.md
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/.sillyspec/docs/multi-agent-platform/modules/deploy.md
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/frontend/src/components/llm-providers/llm-provider-list.tsx
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/frontend/src/components/llm-providers/llm-provider-form.tsx
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/frontend/src/components/llm-providers/__tests__
related_tests:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/frontend/src/components/llm-providers/__tests__
goal: >
  Wave2 收尾：openai 供应商 set-default → 真起 Claude Code 会话经 LiteLLM 正常对话（含一次工具调用 + 流式）；移除 FR-11 过渡守护（task-06 加的 openai set-default 提示）；llm_provider.md 模块文档 + deploy.md 同步（api_format / D-012 绕过注释 / LiteLLM 网关）。
implementation:
  - 端到端联调（集成冒烟）：新建 openai 供应商（OpenCode Zen OpenAI 预设，base_url=https://opencode.ai/zen/v1/chat/completions + 真实有效 token，仅本次用不入库）→ set-default → 验证 litellm_registered=True → 起一个 Claude Code interactive session → 发一条普通对话 → 确认经 LiteLLM 转发上游正常返回文本（流式输出可见）→ 再发一条触发工具调用（如 Read/Bash）→ 确认 tool_use↔function 转换正常（spike R-02 用例在真实链路复现）。
  - 验证 litellm_registered=False 降级路径：故意停 LiteLLM 容器后 set-default → 前端 toast 明示「网关注册失败，Claude Code 暂不可用」（R-09 降级文案可见）。
  - 移除 FR-11 过渡守护：删除 task-06 在 frontend/src/components/llm-providers/ 加的 openai set-default 守护提示（「OpenAI 格式 Claude Code 支持即将上线」文案 + 条件分支），set-default 直接走正常流程。同步删对应前端单测断言。
  - llm_provider.md 同步：契约摘要补 api_format 字段 + openai 形态 provider_config（6 字段，不含上游 key）；注意事项补 D-012 绕过注释（API 格式转换交外部 LiteLLM，非平台代码内实现，D-012 维持）；set_default 返回结构含 litellm_registered 标志；变更索引追加本 change 条目。
  - deploy.md 同步：补 LiteLLM 网关服务（docker-compose litellm + master key env + healthcheck + restart=always）、api_format/D-012 转换外包说明、openai 格式 Claude Code 端到端链路示意。
  - brownfield 零回归复核：anthropic 供应商 fetch-models/probe/set-default/injector 行为逐字不变（老行 api_format=anthropic）。
acceptance:
  - openai 供应商 set-default → Claude Code 会话经 LiteLLM 能正常对话：文本流式返回 + 至少一次工具调用（tool_use→上游 function→tool_result）成功
  - litellm_registered=False 降级时前端 toast 可见（R-09）
  - FR-11 过渡守护文案已移除（grep "OpenAI 格式 Claude Code 支持即将上线" 命中 0）
  - 上游 api_key 不出现在 provider_config / daemon env / 日志（只在 LiteLLM 注册，NFR-01）
  - anthropic 供应商零回归（fetch-models/probe/set-default/injector 逐字不变）
  - llm_provider.md + deploy.md 含 api_format + LiteLLM 网关 + D-012 绕过注释
verify:
  - 真起 Claude Code 会话联调（集成冒烟；组件单测全绿 ≠ LiteLLM 转换正确，plan 全局验收明示此项铁律）
  - grep -rn "OpenAI 格式 Claude Code 支持即将上线\|即将上线" frontend/src/components/llm-providers/（命中 0）
  - cd backend && uv run pytest app/modules/llm_provider app/modules/daemon -q --no-cov
  - cd frontend && pnpm test（llm-provider 相关，含守护移除后用例）
  - cd sillyhub-daemon && pnpm test
constraints:
  - 必须真起 Claude Code 会话联调（集成冒烟；组件单测全绿 ≠ LiteLLM 转换正确，design §10 R-02 + plan 全局验收铁律）。spike 用例 ①②③ 在真实链路复现方算通过
  - 移除过渡守护（D-007/FR-11 收口）；Wave2 合入后 openai set-default 即可用，不再提示
  - 文档注明 D-012 转换外包 LiteLLM（R-07/C-01；平台代码无 Anthropic↔OpenAI 转换逻辑）
  - 测试 token 仅本次联调用，不入库不入日志（NFR-01/R-02）
  - 不改 backend/daemon 代码（本任务只动文档 + 前端守护移除）；若联调暴露 bug 回流到 task-09/10/11 修，不在本卡偷改
provides:
  - Wave2 端到端验收通过（openai 供应商经 LiteLLM 真起 Claude Code 对话 + 工具调用 + 流式）
  - FR-11 过渡守护移除（D-007 收口，openai set-default 直接可用）
  - llm_provider.md + deploy.md 文档同步（api_format / openai 形态 6 字段 / LiteLLM 网关 / D-012 绕过注释）
expects_from:
  task-11:
    - contract: daemon injector openai 分支就绪，spawn-env 第 0 层 toEnv 产 ANTHROPIC_BASE_URL/AUTH_TOKEN/MODEL 指向 LiteLLM
      needs: [ClaudeCredentialInjector.toEnv openai 分支, ProviderConfig 类型含 litellm_* 三字段]
  task-06:
    - contract: 前端 FR-11 过渡守护代码位置已定（openai set-default 提示文案 + 条件分支），本卡定位并移除
      needs: [守护文案 "OpenAI 格式 Claude Code 支持即将上线" 所在文件与分支位置]
  task-08:
    - contract: LiteLLM 服务部署就绪（docker-compose + master key + healthcheck + restart=always），端到端联调依赖
      needs: [LiteLLM 容器运行中 + master key 可用 + backend/daemon 网络可达]
---

# task-12 实现笔记

design 锚点：§5.1 数据流端到端（Claude Code → LiteLLM → 转 OpenAI → 上游 opencode.ai）、§5.3 Wave2 验收（openai 供应商设默认 → Claude Code 经 LiteLLM 对话）、§9 兼容策略 R-04（Wave1→Wave2 过渡守护移除点）、§10 R-02（工具调用/流式转换边界依赖 LiteLLM 成熟度）+ R-07（D-012 绕过）+ R-09（降级 toast）。

上下游衔接：
- 本卡是 Wave2 终点（plan 关键路径末端 task-08→09→10→11→12 串行最后一环），依赖 task-11 injector + task-08 LiteLLM + task-06 守护位置三处就绪。
- 联调若暴露 LiteLLM 转换 bug（工具调用 / 流式 / 角色模型名路由，spike R-01/R-02 用例），属上游 LiteLLM issue 非本平台修（N1/D-012）；本卡记录现象 + 开 issue，不在平台代码内打补丁转换逻辑（C-01 铁律）。
- 文档同步是 D-012 一致性闭环（R-07）：llm_provider.md 原注意事项明示「API 格式转换 D-012 非目标」，本 change 实质绕过（外包 LiteLLM），须在模块文档注释「转换交外部 LiteLLM，平台代码不实现转换」，否则后人读 D-012 与代码现状矛盾。

集成冒烟铁律：组件单测（task-09 litellm_client mock / task-10 provider_config 形态 / task-11 injector openai 分支）全绿 ≠ LiteLLM 真实 Anthropic↔OpenAI 转换正确。必须真起 Claude Code 会话验证一次工具调用 + 流式，否则 Wave2 不算交付（plan 全局验收「集成冒烟」条目）。

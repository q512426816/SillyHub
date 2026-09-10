---
author: qinyi
created_at: 2026-09-10 23:04:18
---

# Decisions — 多供应商注入（codex + pi，cursor spike 排除）

> brainstorm Step 3 落盘。spike 报告：spike/spike-report.md（24 条 mock 日志 + 每项证据原文）。

- id: D-001
  type: boundary
  priority: P0
  status: accepted
  source: user
  question: 本变更范围（codex / pi / cursor 三家怎么切）
  answer: 用户裁决：codex+pi 同批实现（凭证注入器共用接口与测试框架；pi 有 ai-toolbox 完整先例风险低）；cursor 仅做 spike 验证（结论入档，能用再开后续变更）。
  normalized_requirement: 交付 CodexCredentialInjector + PiCredentialInjector + 配置写盘器 + 热切换打通；cursor 仅 spike 报告不实现。
  impacts: [FR-1, FR-2]
  evidence: 用户 AskUserQuestion 第 1 轮（2026-09-10）

- id: D-002
  type: architecture
  priority: P0
  status: accepted
  source: design-grill
  question: spike 前置时机
  answer: 用户裁决：spike 前置于 design（实机验证后再写设计，方案落在实测事实上——mcp 变更 PG DISTINCT 教训：调研结论≠运行时事实）。
  normalized_requirement: spike-report.md 为 design 注入路径决策的唯一事实源。
  impacts: [全 FR]
  evidence: 用户 AskUserQuestion 第 1 轮（2026-09-10）；spike/spike-report.md

- id: D-003
  type: feasibility
  priority: P0
  status: accepted
  source: code
  question: Codex 三条注入路径实测结论（spike A1-A3）
  answer: ① env 路不通：二进制 grep 无 OPENAI_BASE_URL，端点不可经 env 重定向（仅 OPENAI_API_KEY/CODEX_API_KEY/CODEX_ACCESS_TOKEN/CODEX_HOME）；② CODEX_HOME 写盘生效（auth.json + config.toml [model_providers.X]，POST /v1/responses 完整闭环）——但 wire_api="chat" 已被 0.147.0 移除只认 responses（目标端必须支持 Responses API）；③ -c 命令行全链生效（experimental_bearer_token 正确贴 Bearer；CODEX_API_KEY env 也贴给自定义 provider；OPENAI_API_KEY 不贴）；key 不落盘可行但入 argv（进程列表可见）。
  normalized_requirement: codex 注入不得依赖 OPENAI_BASE_URL env；载体在 CODEX_HOME 文件与 -c/env 之间按 D-005 裁决；Responses-only 约束按 D-006 通道满足。
  impacts: [FR-1]
  evidence: spike/spike-report.md A1-A3（mock-log.jsonl + stdout 副本）

- id: D-004
  type: feasibility
  priority: P0
  status: accepted
  source: code
  question: Pi 注入面实测结论（spike B）
  answer: ① PI_CODING_AGENT_DIR 重定向 root + 三文件（auth.json/models.json/settings.json）完整闭环（POST /v1/chat/completions）；② auth.json 官方形状是 {"<providerKey>":{"type":"api_key","key":"..."}}——{"apiKey":...} 形状被拒（与 ai-toolbox 文档有出入，以其运行时实测为准）；③ models.json 内联 apiKey 单文件 / --api-key flag（须带 --model）/ env OPENAI_API_KEY 三种均生效，key 可不落盘。
  normalized_requirement: Pi 注入器按官方形状写 auth.json；root 经 PI_CODING_AGENT_DIR 重定向到会话隔离目录。
  impacts: [FR-2]
  evidence: spike/spike-report.md B1-B4

- id: D-005
  type: architecture
  priority: P0
  status: accepted
  source: user
  question: 凭证载体：会话隔离目录写文件（对齐 claude-settings.ts 先例）vs -c/env（key 入 argv/env）
  answer: 用户裁决方案A：会话隔离目录写文件（对齐 claude-settings.ts 模式；key 不入 argv/env）。【Grill 复审同步：状态 pending→accepted，第 3 轮 AskUserQuestion 实质裁决】
  normalized_requirement: 凭证经会话隔离目录文件承载（codex CODEX_HOME auth.json+config.toml / pi PI_CODING_AGENT_DIR 三文件）；key 不入 argv/env；写盘器为纯输入函数（daemonApiKey 由调用方注入）。
  impacts: [FR-1, FR-2]
  evidence: spike D-003/D-004 + 平台 $CLAUDE_CONFIG_DIR 隔离哲学

- id: D-006
  type: architecture
  priority: P0
  status: accepted
  source: code
  question: Codex Responses-only 约束如何满足（openai_chat 供应商上游多是 chat completions）
  answer: 平台 LiteLLM v1.95.0 代理支持 /v1/responses（llm_provider 模块文档实证：当年为 claude 兼容特意 mode=chat 关掉过 responses，端点存在）——codex 指向 litellm_proxy 通道即可 Responses 进 chat 出。anthropic 直连形态与 codex 的关系留 design 判定（codex 的 model_providers 也可直连 anthropic 兼容端点与否待查证）。
  normalized_requirement: openai_chat 形态供应商经现有 litellm_proxy 满足 codex Responses；不新起协议转换层。
  impacts: [FR-1]
  evidence: backend/app/modules/llm_provider/litellm_client.py:11,87-88（1.95.0 responses 实证注释）；deploy/docker-compose.yml:litellm v1.95.0

- id: D-007
  type: feasibility
  priority: P1
  status: accepted
  source: code
  question: Cursor 可行性（spike C）
  answer: 传输层生效但供应商层不可用：--api-key 确以 Bearer 发往 Cursor 云 /auth/exchange_user_api_key（私有 ConnectRPC /aiserver.v1.*，先换 session token），bundle 无任何 OpenAI 兼容/BYO provider 痕迹，报 "API key is invalid" 退出。IDE 的自定义 key/base URL 存 IDE 内部存储不可编程写。结论：cursor-agent 无可行注入面，不纳入本变更（未来若 Cursor 开放 BYO 端点再议）。
  normalized_requirement: 本变更不含 cursor 实现；spike 结论入档 docs（调研沉淀）。
  impacts: [范围]
  evidence: spike/spike-report.md C + cursor-agent-help.txt

- id: D-008
  type: boundary
  priority: P0
  status: accepted
  source: code
  question: 与并行变更 2026-09-10-review-dispatch-platform-fixes 的关系（用户发现其改动 PI 相关）
  answer: 分层互补而非冲突：该变更（worktree 分支 484cc3e1a，9 task 全勾待归档）已实现 pi 的第一层——PiCredentialInjector 纯 env 注入（api_key→env[auth_field] + extra_env）+ llm_provider schema 放开 agent_kind=pi + 前端 pi 表单项；其非目标明确 punt 自定义端点（"pi 不读 BASE_URL env，自定义端点走宿主 models.json"）。本变更 pi 范围缩窄为第二层：自定义端点文件注入（PI_CODING_AGENT_DIR 三文件，spike B1 闭环）——官方端点供应商走其 env 层，自定义端点走本层。codex 全部范围零重叠。时序硬约束：该变更须先合并 main，本变更 execute 在其后（避免 credential-injector.ts/schema/表单三处文件冲突）。
  normalized_requirement: 本变更不重复实现 pi env 注入器/schema 放开/前端 pi 选项；pi-settings 文件层与既有 env 层的叠加语义（文件定义 provider+端点，env 注 key 或文件内 key，优先级）在 design 定；execute 前置检查并行分支已落 main。
  impacts: [FR-2, 范围, 时序]
  evidence: .sillyspec/.runtime/worktrees/2026-09-10-review-dispatch-platform-fixes/sillyhub-daemon/src/credential-injector.ts:231-261（PiCredentialInjector+REGISTRY）；其 proposal 非目标清单；main HEAD 无该代码（grep 零命中）

- id: D-009
  type: architecture
  priority: P0
  status: accepted
  source: user
  question: 热切换对活跃 codex/pi 会话语义
  answer: 用户裁决：新会话生效+活跃会话尽力——PROVIDER_CONFIG_CHANGED 推送后 daemon 重写隔离目录文件（CLI 是否进程内重读不保证，文档如实标注）；复用既有 WS 推送不新增消息类型。
  normalized_requirement: 切换后新会话必用新供应商；活跃会话 daemon 侧重写文件为尽力动作，效果不承诺。
  impacts: [FR-3]
  evidence: 用户 AskUserQuestion 第 2 轮（2026-09-10）

- id: D-010
  type: architecture
  priority: P0
  status: accepted
  source: user
  question: 整体设计确认（三层注入栈/保守合并/通道复用/时序约束）
  answer: 用户确认：三层注入栈（env 层零改动、新增 codex-settings.ts/pi-settings.ts 写盘器照 claude-settings.ts 模式、openai_chat 走 litellm_proxy 满足 Responses-only）；codex 直连 anthropic 形态列 v2（litellm 通道兜底）；pi providerKey 固定 sillyhub；原型跳过（无新页面）未否决。
  normalized_requirement: design.md 按本决策与 spike 事实落盘；execute 前置检查并行分支已合并。
  impacts: [全 FR]
  evidence: 用户 AskUserQuestion 第 3 轮（2026-09-10）；spike/spike-report.md

- id: D-011
  type: architecture
  priority: P0
  status: accepted
  source: user
  question: CODEX_HOME/PI_CODING_AGENT_DIR 目录粒度（Grill B-7：per-session 与单共享语义互斥）
  answer: 用户裁决：per-session——会话配置根下 <root>/codex/<session_id>/ 与 <root>/pi/<session_id>/，spawn 前创建写入、随会话清理；并发会话零互覆；热切换按 session_id 精准重写（D-009 所需）。有意偏离 claude CLAUDE_CONFIG_DIR 单共享先例（多用户多供应商并发正确性优先）。
  normalized_requirement: 目录含 session_id 段且不位于 %TEMP%；清理接入既有会话生命周期；热切换处理器按 session 定位目录。
  impacts: [FR-1, FR-2, FR-3]
  evidence: 用户 AskUserQuestion 第 4 轮（2026-09-10）；Grill B-7（config.ts:94/daemon.ts:7375-7409）

- id: D-012
  type: definition
  priority: P0
  status: accepted
  source: user
  question: codex 写盘门槛（Grill B-1 P0：settings_config 系 claude 专属字段，类目错误移植）
  answer: 用户裁决方向 + Grill B-8 二轮修正定稿：门槛=provider_config 存在即进入，per-form 必需字段校验内移（anthropic：api_key/base_url 至少一项；openai_chat：litellm_base_url/litellm_model_name 至少一项——该形态 payload 无 api_key 无 base_url，原判据对 litellm 通道恒假）；必需字段缺失记 warn 跳过（可诊断不静默）。「未配置供应商」回归边界=provider_config 整体 absent（lease 不带该键，context.py:92-97 三对齐过滤）。连带声明：pi × openai_chat 组合两层皆不生效→后端 Create/Update 422 + 前端禁选。
  normalized_requirement: writeCodexHome 不得引用 settings_config 作门控；per-form 判据各带正反用例（含 openai_chat 全字段落盘路径）；absent 边界行为与现状逐字一致有测试锁定；pi+openai_chat 拒配有 422 用例。
  impacts: [FR-1]
  evidence: 用户 AskUserQuestion 第 4 轮（2026-09-10）；Grill B-1（types.ts:322-339 vs 297-321）

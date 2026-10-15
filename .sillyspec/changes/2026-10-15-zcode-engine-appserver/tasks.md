---
author: qinyi
created_at: 2026-10-15 13:30:00
---
# 任务清单（Tasks）

> 骨架级任务卡（brainstorm 产出）；plan 阶段经 `sillyspec taskcard --change 2026-10-15-zcode-engine-appserver --all` 展开为完整任务卡（allowed_paths/验证方式/依赖）。

- [ ] task-01: daemon 探测与版本门——agent-detector.ts 探测项（bin=zcode / SILLYHUB_ZCODE_PATH / fallbackPaths Desktop 路径 / execNode .cjs 经 node）+ AgentProviderSpec 扩展可选 fallbackPaths/execNode 字段 + version.ts MIN_VERSIONS 加 zcode (0,16,9)，附探测单测（D-001/D-004 → FR-01）
- [ ] task-02: zcode-envelope.ts——ZCode 私有协议信封层：NDJSON 编解码（strict 四分支 union，多余键拒）、请求 id 关联（客户端数字自增/服务端字符串）、服务端主动请求分发器；单测钉编解码往返与分发（D-005/D-007 → FR-02/04）
- [ ] task-03: zcode-events.ts——通知 → AgentEvent 归一化器：stream.chunk（text/thought 双通道）、tool_call/tool.lifecycle、usage.delta、turn 边界、state.updated 模型目录；实测事件序列样例单测钉映射（D-005 → FR-02）
- [ ] task-04: zcode-app-server-driver.ts——驱动：spawn `node zcode.cjs app-server`、startup 就绪门、session/create-send-stop-close-setModel-setThoughtLevel-compact、requestPermission 代答桥（allow/deny/超时 fail-closed）、runtimePreferences/McpAuthHeaders/requestUserInput 自动应答、握手失败结构化错误；驱动单测（D-005 → FR-02/03/04/08）
- [ ] task-05: 注册与模型路由——zcode-settings.ts per-session 配置面写入器（provider_config.json 个人 Provider：api.type 判 anthropic-messages/openai-chat-completions + baseUrl + apiKey + 模型清单；ZCODE_DATA_BASE_DIR 注入）+ providers.ts PROVIDER_CAPS/INTERACTIVE_PROVIDERS 注册（perSessionDir/smokeSuite/switchable）+ gen-provider-caps.mjs 三端镜像刷新（D-002/D-003 → FR-05/06）
- [ ] task-06: backend 枚举——schema.py InteractiveProviderLiteral 加 "zcode" + pnpm gen:types 与 sillyhub-daemon gen:types 双义务提交（api-types.ts + openapi.json）（FR-02）
- [ ] task-07: frontend 单聊引擎选项——session-list-panel.tsx SESSION_ENGINE_OPTIONS 加 zcode + 快照测试（FR-07）
- [ ] task-08: 端到端冒烟——本机装 ZCode Desktop（引擎 ≥0.16.9）实测：创建 zcode 单聊/一轮对话落库渲染（token 流式+thought）/打断/审批代答/LlmProvider 路由生效（注入 Provider 跑模型轮）/stdin EOF 退出行为记录（R-05）；CI 无引擎时该面走 skip 策略留痕（成功标准收口）

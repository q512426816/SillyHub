---
author: qinyi
created_at: 2026-10-15 12:35:00
---
# 任务清单（Tasks）

> 任务卡骨架（plan Step2 回写，带依赖标注）；Step3 经 `sillyspec taskcard --change 2026-10-15-dsh-engine-acp --all` 展开为完整任务卡（target_files/acceptance/验证方式）。

- [x] task-01: daemon 探测与版本门——agent-detector.ts 第 13 项（bin=dsh / SILLYHUB_DSH_PATH / versionPattern / minVersion=0.2.1 / protocol='json_rpc'）+ version.ts MIN_VERSIONS 加 dsh [0,2,1]，附探测单测（D-001/D-002 → FR-01）
- [x] task-02: dsh-acp-events.ts——session/update 通知 → AgentEvent 归一化器（assistant 消息/thought/tool_call/tool_result），ACP spec 样例事件序列单测钉映射（D-003 → FR-02）(depends_on: task-01)
- [ ] task-03: dsh-acp-driver.ts——ACP v1 驱动：spawn `dsh --profile acp`（.cmd shim 解析）、initialize/session new·resume/prompt/cancel、request_permission 代答桥（allow/deny/超时 fail-closed）、握手失败结构化错误、可选 set_config_option 思考档位；驱动单测（D-003 → FR-02/03/04）(depends_on: task-02)
- [ ] task-04: 注册与模型路由——dsh-settings.ts per-session DSH_HOME cordis.patch.yml 写入器（llm-pi-ai 路由生成）+ providers.ts PROVIDER_CAPS/INTERACTIVE_PROVIDERS 注册（16 键 caps 口径含 Grill 修正：permission_dialog=true/dialog='native'/multimodal=false）+ gen-provider-caps.mjs 三端镜像刷新（FR-05/06）(depends_on: task-03)
- [ ] task-05: backend 枚举——schema.py InteractiveProviderLiteral 加 "dsh" + pnpm gen:types 与 sillyhub-daemon gen:types 双义务提交（api-types.ts ×2 + openapi.json）（FR-02）(depends_on: task-04)
- [ ] task-06: 群附件门控 caps 口径统一——messages.py:791-797 改 get_provider_caps 判定 + NEW test_group_attachment_gate.py（claude/pi/cursor/dsh 放行、codex/未知拒）（FR-07，R-03）(depends_on: task-04)
- [ ] task-07: frontend 单聊引擎选项——session-list-panel.tsx SESSION_ENGINE_OPTIONS 加 dsh + 快照测试（FR-08）(depends_on: task-05)
- [ ] task-08: 端到端冒烟——本机装 dsh ≥0.2.1 实测：创建 dsh 单聊/一轮对话落库渲染/打断/审批代答/LlmProvider 路由生效；CI 无 dsh 时该面走 skip 策略留痕（成功标准收口）(depends_on: task-05, task-06, task-07)

---
author: WhaleFall
created_at: 2026-08-06 21:15:00
---

# 模块影响分析(Module Impact)— 运行中会话热切换供应商

## 数据源
- git diff HEAD(真实改动,28 代码文件,apply 后 working tree)
- design.md §6 文件清单 + plan.md 任务范围(声明)
- _module-map.yaml(模块 paths glob 匹配)
- 三重交叉验证:声明范围 = 任务范围 = git diff(三者一致,以 git diff 为准)

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| llm_provider | 逻辑变更 + 新增 + 接口变更 | service.py / probe.py(新增) / router.py / schema.py / tests(test_llm_provider, test_probe, test_router) | set/unset_default 加凭证探测+推送+回滚;新增 probe.py 凭证探测;SetDefaultResult 结构化响应 | false |
| daemon | 逻辑变更 + 新增 + 接口变更 + 配置变更 | backend: lease/context.py / lease/provider_switch.py(新增) / protocol.py / tests; sillyhub-daemon: protocol.ts / daemon.ts / interactive/session-manager.ts / interactive/types.ts / cli.ts / tests | resolve_default_provider_config helper 抽取;notify_provider_switch 查 active session 推送;WS 接收 PROVIDER_CONFIG_CHANGED;markPendingSwitch + reloadWithProvider(resume 保留上下文);cli.ts credentialManager 接线 | false |
| frontend_components | 逻辑变更 | llm-provider-list.tsx / __tests__/llm-provider-list.test.tsx | 切换/停止结果 toast 三态(成功 N 会话/停止回退本机/失败原因) | false |
| frontend_lib | 接口变更 | api-types.ts / lib/api/llm-providers.ts / __tests__/llm-providers.test.ts | SetDefaultResult 类型从 OpenAPI 生成;setDefault/unsetDefault 返回类型对齐 | false |

## 未匹配文件
| 文件 | 说明 |
|---|---|
| backend/openapi.json | gen:types 同步产物(SetDefaultResult schema 注入),非业务模块,归 core/类型生成器 |

## 跨模块调用关系变更
- llm_provider.set_default/unset_default → daemon.notify_provider_switch(**新调用关系**)
- daemon.notify_provider_switch → ws_hub.send_session_control → daemon(daemon.ts WS 接收)→ session-manager.markPendingSwitch → reloadWithProvider(新链路)
- frontend lib/api/llm-providers.ts 消费后端 SetDefaultResult(**新契约**)

## 结论
4 个模块受影响(llm_provider / daemon / frontend_components / frontend_lib),均为本次变更核心路径,needs_review=false(影响明确)。**无 schema/表结构变更**(agent_sessions 查询复用现有 user_id/status/lease_id 字段,索引 ix_agent_sessions_status 已就位)。

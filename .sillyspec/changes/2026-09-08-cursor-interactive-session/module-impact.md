---
author: qinyi
created_at: 2026-09-08 12:25:00
---

# 模块影响分析（Module Impact）— cursor 交互式会话接入

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| sillyhub-daemon | 新增 | 新建 interactive/cursor-driver.ts（每轮 respawn 薄 driver）+ interactive/cursor-events.ts（归一化器）+ tests/interactive/cursor-driver.test.ts / cursor-events.test.ts + tests/fixtures/cursor/*.ndjson（真实帧样本）。execute 实际：fixture task-01/02；cursor-events 852cc2cb3；CursorDriver b714927ca；注册点 task-05/06 已落地 |
| sillyhub-daemon | 修改 | interactive/providers.ts（PROVIDER_CAPS.cursor + INTERACTIVE_PROVIDERS.cursor 注册，thinking=true 取 design 实测修正）、cli.ts（drivers 装配行加 cursor）、interactive/session-store-persistence.ts（VALID_PROVIDERS 加 cursor）、tests/interactive/provider-registry.test.ts（键集合/实例化/family 反查断言同步）。execute 实际：CLI Wave 5=task-05 f5386ec5b + task-06 3444afa58 |
| backend | 修改 | agent/provider_caps.py（caps 镜像加 cursor，thinking=True 跟 daemon）、agent/tests/test_provider_caps_alignment.py（EXPECTED_PROVIDERS 加 cursor）、daemon/schema.py（InteractiveProviderLiteral 加 "cursor"）。execute 实际：CLI Wave 6=task-07 8743f9096 |
| frontend | 修改 | lib/provider-caps.ts（caps 镜像加 cursor，thinking=true）、components/sessions/pre-session-picker.tsx（SESSION_SUPPORTED_PROVIDERS 加 cursor）、components/daemon/runtime-session-helpers.tsx（SUPPORTED_SESSION_PROVIDERS 加 cursor）、pre-session-picker.test.tsx cursor 可选用例。execute 实际：CLI Wave 6=task-08 e982c90b0 |
| docs | 修改 | agent-provider-onboarding.md 追加 §5.4 cursor 案例锚（档C 变体：respawn-per-turn 模式、实测结论、坑记录） |
| backend | 依赖变更 | 无 schema/DB 变更；InteractiveProviderLiteral 为请求侧校验放宽（加成员），消费方 daemon CreateSessionInput.provider 路由已存在 |

## 未匹配文件

无

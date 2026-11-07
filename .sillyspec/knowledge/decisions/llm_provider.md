# 决策知识 — llm_provider

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-llm_provider-001@v1 2026-10-08-provider-update-models-none-guard——在 `service.update()` 的 updates 弹出区（agent_kinds None-pop 之后、setattr 循环之前）补同款 mode
状态：implemented
变更：2026-10-08-provider-update-models-none-guard
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-08-provider-update-models-none-guard/design.md
文件：backend/app/modules/llm_provider/service.py, backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py, docs/sillyspec/finished/thin-flow-done-no-scope-audit-snapshot.md, docs/sillyspec/thin-done-src-commit-order-and-attribution-paren.md
最近确认：未记录
理由：在 `service.update()` 的 updates 弹出区（agent_kinds None-pop 之后、setattr 循环之前）补同款 models None-pop。依据：`schema.py::LlmProviderUpdate.models` 注释已声明契约「None=不动；非 None 时整表替换」（b8afd807c 引入列时声明），但实现漏配——`44eb2e5c9` 已为 agent_kinds 修复同型故障，b8afd807c 晚于其 7 小时合入 models 列却未带上同款防护。 实测故障机制（比预判更隐蔽，task-01 先红时 SQL 追踪确认）：`setattr(row, "models", None)` 后 ORM flush 在 SQLite 上把 Python None 经 JSON 绑定序列化为**字符串 `'null'`** 写入（`UPDATE llm_providers SET models='null'`，非 SQL NULL），NOT NULL 约束不拦——PATCH 返回 200、行被静默写坏；读回 `row.models is None`，`LlmProviderRead.models: list[ProviderModelEntry]` 序列化 None → 该用户 GET /api/llm-providers 列表端点 500（比写路径报错更晚暴露）。PostgreSQL 侧两种形态（SQL NULL 撞 NOT NULL 500 / JSON null 同样静默写坏）均由同一 None-pop 收敛。最小改动：一行防护 + 一条回归用例；不改列定义、不动迁移、不动前端（`formToUpdate` 恒发数组，UI 面本就不触发）。

## D-llm_provider-002@v1 2026-10-20-codex-models-fetch-candidates——改 `backend/app/modules/llm_provider/service.py` 两处常量/函数：① `_STRIP_SUFFIXES` 追加 `
状态：implemented
变更：2026-10-20-codex-models-fetch-candidates
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-20-codex-models-fetch-candidates/design.md
文件：backend/app/modules/llm_provider/service.py, backend/app/modules/llm_provider/tests/test_api_format.py, backend/app/modules/llm_provider/tests/test_fetch_models.py, docs/releases/2026-10-20-004-cd6aa49.md
最近确认：未记录
理由：改 `backend/app/modules/llm_provider/service.py` 两处常量/函数：① `_STRIP_SUFFIXES` 追加 `"/openai/v1"`（OpenCode 网关范式：`…/inference/go/openai/v1` 剥到网关根再拼 `/v1/models`）；② `_candidate_urls` anthropic 分支在既有候选之后追加 `base + "/models"` 兜底候选（OpenAI 风格 base 已含版本段：智谱 coding `/api/v1` → `/api/v1/models`）。两路径均上游实测 200（2026-10-20，匿名 GET）。选候选追加而非按 provider 名特判：候选序列天然容错（404 自动尝试下一个），不引入 per-vendor 分支；追加位置放最后保证既有命中路径的尝试顺序零变化。

## D-llm_provider-003@v1 2026-10-21-provider-set-default-ui——两件事：① 把 2026-08-20（ql-20260820-006）从 /settings/providers 删除的「设为默认」UI 加回来——后端 `se
状态：implemented
变更：2026-10-21-provider-set-default-ui
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-21-provider-set-default-ui/design.md
文件：backend/app/modules/daemon/lease/provider_switch.py, backend/app/modules/daemon/tests/test_provider_switch_integration.py, backend/app/modules/llm_provider/router.py, backend/app/modules/llm_provider/schema.py, backend/app/modules/llm_provider/service.py, backend/app/modules/llm_provider/tests/test_llm_provider.py, frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx, frontend/src/components/llm-providers/llm-provider-list.tsx, frontend/src/lib/api/__tests__/llm-providers.test.ts, frontend/src/lib/api/llm-providers.ts
最近确认：未记录
理由：两件事：① 把 2026-08-20（ql-20260820-006）从 /settings/providers 删除的「设为默认」UI 加回来——后端 `set-default` / `unset-default` 端点与 claim 端 `_inject_provider_config` 用户默认优先链健在（当时只删了前端入口），`lib/api/llm-providers.ts` 加回 API 封装、`llm-provider-list.tsx` 加「设为默认 / 取消默认」按钮与默认徽标，修复「会话不选供应商=本机凭证」的根因（is_default 无 UI 可设）。② 按用户 2026-10-21 拍板（决策 D-002，否决 D-001 保留倾向）：`service.set_default` / `unset_default` **移除热切换推送**（删 `_dispatch_provider_switch` 调用与私有 helper）——默认变更仅对新会话生效，运行中会话独立保持原供应商；`notify_provider_switch` 模块与 daemon 侧 WS 消费链保留不动（独立测试锚定，docstring 标注无生产调用方，供后续会话级热切换复用）。 与当初删除版的差异（有意）：文案从「启动/停止」改为「设为默认 / 取消默认」（与档案侧后续「设为默认」统一）；表单「保存后立即启动」勾选**不**恢复（列表行内操作已覆盖，最小化功能面）。

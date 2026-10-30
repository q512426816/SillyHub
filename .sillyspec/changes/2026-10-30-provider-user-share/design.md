---
author: flow-machine-draft
created_at: 2026-10-30T08:31:22.030Z
---
# 设计记录（Design Record）— 2026-10-30-provider-user-share

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

新增 `llm_provider_shares`（provider_id + grantee_user_id 唯一）承载「按用户共享」；`LlmProviderService` 增加属主侧共享 CRUD、可用列表（own + shared）与模块级授权判定 `provider_usable_by(session, provider_id, user_id)`（属主或有效共享）。会话创建/切换的 provider 校验改调该判定；daemon claim 的会话级供应商解析新增 `resolve_session_provider_config`，以 **AgentSession.user_id（会话属主）** 为授权主体（共享守护进程下 runtime 属主可不同），通过后复用抽出的 `_provider_config_from_row` 构造配置。前端会话配置条改读 `/llm-providers/usable` 并给共享项打「共享」标识；设置页仍读 own-only 列表，供应商卡新增属主侧「共享」弹窗（按用户名/邮箱添加、列表、撤销），共享项在设置页完全不可见，从入口上保证只读。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 新表 `llm_provider_shares(id, provider_id FK→llm_providers CASCADE, grantee_user_id FK→users CASCADE, shared_by_user_id FK→users CASCADE, created_at)` + `UNIQUE(provider_id, grantee_user_id)` + 双索引；新增 alembic 迁移。
- `LlmProviderRead` 增可选字段 `is_shared: bool = False`、`shared_by_name: str | None = None`（own-only 端点恒默认值，零回归）。
- 新端点（`/api/llm-providers` 下）：
  - `GET /usable` → `LlmProviderList`，own + shared；shared 行 `is_shared=true`、`shared_by_name=属主显示名`、`is_default=false`、`api_key_masked` 照旧。
  - `GET /{id}/shares` → `LlmProviderShareList{items:[{user_id,username,display_name,created_at}],total}`（仅属主）。
  - `POST /{id}/shares` body `{identifier: str}` → `LlmProviderShareRead`；identifier 按 username 或 email 精确匹配；幂等；共享给自己 400；目标不存在/未激活/登录禁用 404；非属主 404。
  - `DELETE /{id}/shares/{grantee_user_id}` → 204；仅属主；不存在记录幂等成功。
- 新模块级函数 `provider_usable_by(session, provider_id, user_id) -> bool`；`resolve_session_provider_config(session, lease_meta, agent_kind) -> dict | None`（daemon/lease/context.py），内部按会话属主 + 共享授权判定，并从 `resolve_bound_provider_config` 抽出 `_provider_config_from_row` 复用配置构造（anthropic/openai_chat 两分支逐字搬移）。
- 既有 `GET/POST/PATCH/DELETE /llm-providers`、`set-default/unset-default`、`usage/quota`、`fetch-models` 的属主级行为与响应**零变化**。
- 前端 `lib/api/llm-providers.ts` 新增 `listUsableProviders` + 共享 CRUD 客户端与类型；`session-config-bar` 数据源由 `listProviders` 改为 `listUsableProviders`（缓存键同族），下拉共享项带「共享」徽标；设置页 `LlmProviderSection` 卡片新增「共享」按钮与弹窗。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   授权判定是每次 claim 实时查询（provider + share 行），不缓存、不依赖事件顺序；共享刚创建/刚撤销在下一轮即生效。会话已选供应商后共享被撤销，claim 解析失败走既有 fallback 链，不阻断（FR-05）。前端列表 30s staleTime 可能短暂显示已撤销项，但选择时后端 404，属既有刷新节奏。lease_meta.session_id 指向不存在会话行（旧夹具/极端竞态）时，解析回落到调用方传入的 runtime 属主，保持改造前行为。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   共享写入以 `UNIQUE(provider_id, grantee_user_id)` 兜底：并发重复共享捕获 IntegrityError 后回查既有行，返回幂等结果；撤销与共享并发时以最终库态为准，claim 读取到的任一状态都是合法授权快照。属主删除 provider 级联清 share，无悬挂行。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   共享/撤销只影响后续 claim；运行中的 turn 已下发 provider_config，不受影响。会话切换供应商仍走现有多轮合并/排队逻辑，新增的只是授权判定，不改变切换事务边界。被共享用户不可设默认，因此不会改变任何人的默认链。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   共享是用户级（provider 属主 → grantee），与会话/工作区无关；claim 授权主体固定为会话属主，不读 runtime 属主，避免共享守护进程下串用/误拒。provider 查询始终带 `provider_id` 与 `grantee_user_id` 双条件，不会跨 provider 串台。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

本方案最大的风险是「授权主体从 runtime 属主改为会话属主」可能改变存量共享守护进程会话的 provider 解析结果：此前 runtime 属主的会话级 provider 生效、会话属主的被静默拒绝；改为会话属主后，会话属主自己的 provider 会开始真正生效（更符合预期），但依赖旧行为的会话可能换用不同供应商。缓解：仅当会话属主有有效授权（自有或共享）时才注入，否则原样回落默认链（与今日一致）。第二个风险是用户名精确匹配带来的目标枚举（404 区分不存在/禁用）；已用统一 404 文案收敛，不返回用户列表。放弃的方案：给共享加独立密码/额度上限——超出本次范围；把共享项放进设置页只读区——用户要求「只能在会话页面选择」，直接不展示更简单且无越权入口。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | backend/app/modules/llm_provider/model.py | 新增 LlmProviderShare 表模型 |
| 新增 | backend/migrations/versions/20261030180000_provider_user_shares.py | llm_provider_shares 建表迁移 |
| 修改 | backend/tests/test_align_platform_change_events_migration.py | 迁移链尾锚前移到新 head（共享断言面配对钉子） |
| 修改 | backend/app/modules/llm_provider/schema.py | LlmProviderRead 增共享标识 + 共享 DTO |
| 修改 | backend/app/modules/llm_provider/service.py | 共享 CRUD/可用列表/授权判定/配置构造抽取 |
| 修改 | backend/app/modules/llm_provider/router.py | usable/shares 端点 |
| 修改 | backend/app/modules/daemon/session/service/inject_gates.py | 创建/切换 provider 授权放宽为属主或共享 |
| 修改 | backend/app/modules/daemon/session/service/attachments.py | 切换轮 provider_config 改走会话属主 + 共享授权解析 |
| 修改 | backend/app/modules/daemon/lease/context.py | 会话级 provider 按会话属主 + 共享授权解析 |
| 修改 | backend/app/modules/daemon/tests/test_lease_context_provider_priority.py | 会话级解析函数更名后同步 mock 目标（行为断言不变） |
| 新增 | backend/app/modules/llm_provider/tests/test_provider_shares.py | FR-01/02/04/05 用例 |
| 新增 | backend/app/modules/daemon/tests/test_lease_context_provider_share.py | FR-03/05 claim 用例 |
| 修改 | backend/app/modules/daemon/tests/test_session_switch_config.py | 共享供应商切换用例 |
| 修改 | frontend/src/lib/api/llm-providers.ts | usable/共享客户端与类型 |
| 修改 | frontend/src/components/sessions/session-config-bar.tsx | 可用列表 + 共享标识 |
| 新增 | frontend/src/components/llm-providers/share-provider-dialog.tsx | 属主侧共享弹窗 |
| 新增 | frontend/src/components/llm-providers/__tests__/share-provider-dialog.test.tsx | 共享弹窗列表/添加/撤销用例 |
| 修改 | frontend/src/components/llm-providers/llm-provider-list.tsx | 「共享」入口 |
| 修改 | frontend/src/components/sessions/__tests__/session-config-bar.test.tsx | 共享候选展示用例 |

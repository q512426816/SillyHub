---
author: flow-machine-draft
created_at: 2026-10-30T08:31:22.030Z
---
# 需求规格（Requirements）— 2026-10-30-provider-user-share

## 功能需求

### FR-01: 供应商属主可按用户名/邮箱把供应商共享给指定用户，可查看/撤销共享；共享记录唯一、重复共享幂等、不能共享给自己、目标不存在/禁用时明确报错。

- 供应商属主**必须**能按 username 或 email 精确匹配把自有供应商共享给指定用户；同一 (provider, grantee) **必须**唯一，重复共享**必须**幂等返回既有记录；**禁止**共享给自己；目标用户不存在/未激活/登录被禁用时**必须**返回明确错误（404/400 语义），不得静默创建记录。属主**必须**能列出/撤销共享，撤销不存在记录**禁止**报 500。

#### 场景：按用户名共享并幂等

- Given 用户 A 拥有供应商 P，用户 B 的 username 为 bob
- When A 两次 `POST /api/llm-providers/{P}/shares` body `{identifier:"bob"}`
- Then 两次都返回 B 的共享记录，库中只有一条 (P,B) 记录

#### 场景：拒绝异常目标

- Given A 拥有 P
- When A 共享给 `identifier:"alice"`（A 自己）或不存在/禁用用户
- Then 分别返回 400 / 404，库中无新增记录

### FR-02: 被共享用户 GET 可用供应商列表（自己的 + 共享给自己的）可用于会话页；共享项带 shared_by 标识且只读；设置页仍只列自己的供应商，不提供编辑/共享入口。

- **必须**新增可用列表端点返回「自己的 + 共享给自己的」供应商；共享项**必须**带 `is_shared=true` 与 `shared_by_name`，且**必须**将 `is_default` 置 false（不得让被共享方误以为共享供应商是自己的默认）；**禁止**返回明文 key（沿用 `api_key_masked`）。设置页**必须**继续只列自己的供应商（`GET /llm-providers` 行为不变），共享项不出现，因而无编辑/删除/设默认/共享入口。

#### 场景：共享项只读标识

- Given B 被 A 共享供应商 P（P.is_default=true）
- When B `GET /api/llm-providers/usable`
- Then 返回自己的供应商 + P，P 标记 is_shared=true、shared_by_name=A 的显示名、is_default=false；`GET /api/llm-providers` 仍不含 P

### FR-03: 被共享用户可在会话页选择共享供应商并实际生效：会话创建/切换校验改为「属主或有效共享」，daemon claim 的会话级供应商解析按会话属主 + 共享授权放行（runtime 属主不同也能用）。

- 会话创建/切换时，`llm_provider_id` 校验**必须**从「provider 属主 == 会话属主」放宽为「provider 属主 == 会话属主，或存在 grantee=会话属主的有效共享」；不符合时仍**必须**返回 404 不泄漏存在性。daemon claim 解析 `session_llm_provider_id` 时**必须**按**会话属主**（AgentSession.user_id）而非 runtime 属主做上述授权，授权通过才下发 provider_config；引擎 `agent_kind` 匹配规则不变。

#### 场景：共享供应商在他人 runtime 上生效

- Given 会话属主 B、runtime 属主 A（共享守护进程），A 将供应商 P 共享给 B，会话来宾 B 选择 P
- When 该会话 claim 派发
- Then 授权按 B 判定通过，payload.provider_config 使用 P 的配置（key 解密仅在下发时）

### FR-04: 被共享用户调用供应商编辑/删除/设默认/额度查询接口仍 404/403（不可修改、不泄漏明文 key）。

- 共享**禁止**授予写权限：被共享用户调用 `PATCH/DELETE /llm-providers/{id}`、`set-default/unset-default`、`usage/quota`、`shares` 管理端点**必须**仍按属主校验失败（404/403），响应**禁止**包含明文 key；只有 `GET /usable` 与两个 GET 读取面（列表/详情）可见共享项。

#### 场景：被共享方不可写

- Given B 被 A 共享 P
- When B 调用 PATCH / DELETE / set-default / usage / shares 列表
- Then 全部 404/403，P 未被修改

### FR-05: 共享撤销后，新会话不再可见/不可选；已选会话下一轮回落默认链（不阻断），且不得泄漏已撤销供应商的 key。

- 撤销共享后，被共享用户的 `GET /usable` **必须**立即不再返回该供应商，新会话选择该 id **必须**失败（404）；已选该供应商的存量会话在下一轮 claim 解析时**必须**因授权失败回落 bound/default 链（不阻断会话），且不得再把该供应商的 provider_config/api_key 下发。

#### 场景：撤销后的下一轮

- Given B 的会话 S 已选共享供应商 P
- When A 撤销共享后 S 下一轮 claim
- Then S 仍可执行，使用默认链配置；不再下发 P 的 key

### FR-06: 新增 backend 共享 CRUD/授权/claim 解析用例与 frontend 可用列表/只读标识用例，相关测试全绿。

- 本次变更**必须**新增覆盖 FR-01..FR-05 的后端用例与覆盖 FR-02/FR-03 前端展示/选择行为的用例，并保证所触及测试文件全部通过。

#### 场景：回归门

- Given 新增用例与既有 provider/session/claim 用例
- When 执行 llm_provider、daemon lease/context、session-config-bar 相关测试
- Then 全部通过，既有 owner 级行为零回归

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/llm_provider/tests/test_provider_shares.py「test_share_is_idempotent_and_listed」「test_share_rejects_self_unknown_and_disabled」
FR-02: backend/app/modules/llm_provider/tests/test_provider_shares.py「test_usable_list_marks_shared_and_clears_default」；frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「共享供应商出现在候选并带共享标识」
FR-03: backend/app/modules/daemon/tests/test_lease_context_provider_share.py「test_session_provider_shared_with_session_owner_is_injected」；backend/app/modules/daemon/tests/test_session_switch_config.py「test_switch_to_shared_provider_allowed」
FR-04: backend/app/modules/llm_provider/tests/test_provider_shares.py「test_recipient_cannot_mutate_or_query_usage」
FR-05: backend/app/modules/daemon/tests/test_lease_context_provider_share.py「test_revoked_share_falls_back_to_default_chain」；backend/app/modules/llm_provider/tests/test_provider_shares.py「test_revoked_share_disappears_from_usable_list」
FR-06: 不适用：验收由 FR-01..FR-05 所列测试用例的执行结果承担（无独立可执行面）

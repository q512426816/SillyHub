---
author: flow-machine-draft
created_at: 2026-11-01T23:20:09.257Z
---
# 需求规格（Requirements）— 2026-11-01-provider-share-audit-fixes

## 功能需求

### FR-01: 对 /api/llm-providers/{非UUID}/shares 传畸形 UUID 时返回 422 JSON 错误体(不再 500),合法 UUID 路径零回归

- `_parse_id` 必须把非法 UUID 输入转为 AppError 422（code 沿 `HTTP_422_<事件>` 范式），禁止让裸 ValueError 落到通用 Exception handler 变 500；既有合法 UUID 端点（get/patch/delete/usage/quota/set-default/shares）行为零回归。

#### 场景：畸形 UUID 主路径

- Given 已认证用户
- When 请求 `GET|POST /api/llm-providers/not-a-uuid/shares` 或 `DELETE /api/llm-providers/not-a-uuid/shares/{任意}`
- Then 返回 422，响应体为 `{code, message, request_id, details}` JSON 结构，不产生 unhandled_error 500

### FR-02: 共享弹窗 DialogDescription 与产品文档明示:共享后解密密钥会下发到会话实际运行的守护进程(包括对方自己的机器),仅共享给可信用户

- 共享弹窗（ShareProviderDialog）的 DialogDescription 必须包含密钥可见性告知（共享后供应商访问密钥会以解密形式下发到会话实际运行的守护进程，含对方自己的机器，仅共享给可信用户）；llm_provider 模块卡（.sillyspec/docs/SillyHub/modules/llm_provider.md）必须记载共享语义与该事实；禁止只改实现不动告知面。

#### 场景：属主打开共享弹窗

- Given 属主在设置页点某供应商「共享」
- Then 弹窗描述区可见密钥可见性警示文案（有测试锁定，防静默移除）

### FR-03: 迁移 20261030160000 的 docstring/注释如实描述降级实际删除范围,不再声称「只撤销本迁移授予的」

- 迁移文件注释必须如实描述 `_REVOKE_SQL` 实际删除范围（business_member 名下**全部** change:read 行，含非本迁移来源的行），并说明为何可接受；SQL 本身禁止改动（已提交迁移，且 upgrade 语义不变）。

#### 场景：读者核对迁移

- Given 读者打开 20261030160000 迁移文件
- Then docstring 与 `_REVOKE_SQL` 行为一致，不存在「只撤销本迁移授予的」这类与 SQL 不符的声称；迁移单测（既有）全绿

### FR-04: 新增 HTTP 层用例覆盖 GET /usable(路由不被 /{provider_id} 遮蔽/共享行脱敏)与 shares CRUD(201/204/404 语义),全绿

- 必须在 test_router.py 补 HTTP 层（AsyncClient）用例：GET /usable 返回自己的+共享的且共享行 is_shared=true/settings_config=None/extra_env=None/is_default=false；shares CRUD 必须断言 201（共享）/204（撤销幂等）/404（非属主与未知目标）；路由顺序用例必须证明 GET /llm-providers/usable 不被 GET /{provider_id} 吞掉。

#### 场景：HTTP 层守护

- Given 属主 A 共享给 B、B 认证请求 /usable
- Then B 收到共享行且敏感字段为 None；A 对自己 provider 走 shares CRUD 全语义；非属主访问 shares 得 403/404

### FR-05: 新增 claim 注入链用例:runtime 属主≠会话属主时共享供应商经 _inject_provider_config 注入 payload.provider_config,且 session 缺行回落 fallback_user_id,全绿

- 必须在 test_lease_context_provider_share.py 补经 `_inject_provider_config` 的真实注入链用例：runtime 属主（出借方）≠会话属主（借用方）时，lease_meta.session_llm_provider_id 指向共享给借用方的供应商必须注入 payload["provider_config"]（含明文 key 与 model 覆盖）；session_id 指向不存在会话行时必须回落 fallback_user_id（runtime 属主自有供应商命中），行为与改造前一致。

#### 场景：共享守护进程 claim（两条）

- Given provider 属 A、共享给 B、会话属 B、runtime 属 A
- When claim 注入（agent_kind_raw=claude_code）
- Then payload["provider_config"]["api_key"] 为明文、payload["model"] 被覆盖
- Given 同上但 lease_meta.session_id 为不存在的 UUID、provider 属 A（A 自有）
- When claim 注入
- Then 仍注入（fallback 到 runtime 属主，保持改造前行为）

### FR-06: 相关 backend/frontend 测试全绿,lint 零新增

- 收口时相关测试面（llm_provider 域 + daemon lease 域 pytest、frontend vitest、ruff/eslint、tsc）必须全绿，lint 禁止新增告警/错误。

#### 场景：收口实测

- Given 全部改动落盘
- When 跑相关域测试与 lint
- Then 全绿且 lint 零新增（CLI 收口实测为准）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/llm_provider/tests/test_router.py「test_shares_invalid_provider_uuid_returns_422」
FR-02: frontend/src/components/llm-providers/__tests__/share-provider-dialog.test.tsx「密钥可见性告知文案」；模块卡 llm_provider.md 部分：不适用——纯文档记载，无代码行为（验收靠人工核对文案与文档）
FR-03: 不适用——纯注释文案变更、SQL 零改动（既有 backend/tests/test_business_member_change_read_migration.py 全绿即守护行为不变）
FR-04: backend/app/modules/llm_provider/tests/test_router.py「usable 路由顺序与共享行脱敏」「shares CRUD 201/204/404 语义」
FR-05: backend/app/modules/daemon/tests/test_lease_context_provider_share.py「inject 链共享注入」「inject 链 session 缺行回落 fallback_user_id」
FR-06: 不适用——回归总账条目（llm_provider+daemon lease 域 pytest 全绿 / frontend vitest 全绿 / lint 零新增，收口 CLI 实测即本条用例）

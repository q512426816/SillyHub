---
author: WhaleFall
created_at: 2026-08-11T10:06:13
change: 2026-08-11-agent-profile-bind-llm-provider
---

# 需求规约

## 功能需求

- **FR-01**「智能体引擎」改名：`agent-profile-form.tsx` 第一层 Form.Item label 由「供应商偏好（决定选哪台 daemon）」改为「智能体引擎」；下拉取值与 `PROVIDER_META` 逻辑零变更；后端字段名 `provider` 不变。（D-001/D-002）
- **FR-02** 档案绑定字段：`AgentProfile` 新增 `llm_provider_id`（UUID，FK→`llm_providers.id`，`ondelete=SET NULL`，nullable）；Create/Update DTO 接收可选 `llm_provider_id`（显式 null=解绑）；Read 透出。（D-003）
- **FR-03** 凭证取用四级判断（方案B 兼容现状）：`_inject_provider_config` 改为「绑定优先 → 用户默认回退 → D-007 本机」；未绑路径零回归。（D-005）
- **FR-04** codex 类供应商本次不开放：`agent_kind` 仍 `Literal["claude"]`；第二层联动只出 claude 类；Codex 引擎下第二层禁用 + 提示「codex 类供应商暂未开放」。（D-004）
- **FR-05** 跨用户归属校验（方案A）：注入前校验 `provider.user_id == runtime.user_id`（daemon 登记者）；不匹配忽略绑定、静默回退；展示层非本人供应商不显示名。（D-006/D-007）
- **FR-06** 引擎类型一致性校验：绑定注入前校验 `provider.agent_kind == _normalize_lease_provider(agent_kind_raw)`，不匹配降级回退（堵 API/DB 直写绕过）。
- **FR-07** 第二层联动下拉：数据源 `GET /api/llm-providers`（已 owner 过滤），按第一层引擎归一化值过滤 `agent_kind`；可选，留空=不绑定。
- **FR-08** 卡片/预览展示：绑定的供应商名用 `/llm-providers` 列表做 id→name 映射；非本人供应商显示「（非本人供应商，将回退默认）」。
- **FR-09** 编辑态回显：Select options 不含当前 `llm_provider_id` 时显示占位文案，form value 不转 null（依赖 `exclude_unset`）。

## 非功能需求

- **NFR-01** 零回归：`llm_provider_id=None` 时凭证注入行为与现状逐字一致。
- **NFR-02** R-02 密钥红线：档案只存 `llm_provider_id`（UUID 引用），明文 key 仍只在 `encrypt`/`decrypt` 两处。
- **NFR-03** 跨平台：前后端改动兼容 Windows/Linux/macOS（无平台相关代码引入）。
- **NFR-04** 类型同步：后端 schema 改动后须 `pnpm gen:types` 重生成 `api-types.ts` + `openapi.json` 并提交（规则 20）。

## 验收要点（对应 verify 阶段）

- 档案绑定 claude 供应商后，用自己 daemon 跑任务 → 注入绑定的凭证。
- 档案未绑 → 注入用户默认（现状）。
- 用户无默认 → daemon 本机（D-007）。
- 共享档案绑的供应商对非 owner 成员不生效、不泄露。
- codex 引擎档案绑 claude provider → 回退（agent_kind 不一致）。
- 绑定的 provider 被删 → 字段置空 → 回退默认。
- openai_chat 形态 provider 绑定 → 正确构造 6 字段 config。

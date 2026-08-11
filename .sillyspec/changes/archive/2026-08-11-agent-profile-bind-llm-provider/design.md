---
author: WhaleFall
created_at: 2026-08-11T10:06:13
change: 2026-08-11-agent-profile-bind-llm-provider
scale: large
risk_level: contract-required
---

# 智能体档案绑定供应商配置 — 设计文档

## 1. 背景

`AgentProfile`（智能体档案）当前有 `provider` 字段（取值 `claude`/`codex`），前端表单 label 为「供应商偏好（决定选哪台 daemon）」。存在两个问题：

1. **label 描述错误**：`provider` 并不决定选哪台 daemon。daemon 的选择唯一由工作区绑定（`WorkspaceMemberRuntime`）决定（`placement.py:993-994` 注释明示「binding 仍为唯一真相源」）。`provider` 只决定**在选中的 daemon 上匹配哪个 `DaemonRuntime`**（claude runtime / codex runtime），并经 `_normalize_lease_provider` 归一化后作为 `agent_kind` 用于凭证查询。
2. **档案与实际凭证脱节**：任务运行时用哪条 API 凭证，由 `daemon/lease/context.py::_inject_provider_config` 按 `(user_id, agent_kind, is_default=True)` 取**用户默认 `LlmProvider`** 决定，与档案本身无关。用户无法让「不同档案用不同供应商凭证」。

`/settings/providers`（后端模块 `llm_provider`）配的是用户级云凭证（加密 API key + base_url + 模型 + 鉴权方式），有稳定 UUID 主键和 `agent_kind` 字段（当前 Literal 锁 `claude`）。

本变更：把 `provider` 字段在 UI 上改名为「智能体引擎」以修正语义，并**新增档案级供应商绑定**（`llm_provider_id`），让档案可直接指定用哪条 `LlmProvider` 凭证启动。

## 2. 设计目标

- **G1 修正字段语义**：`provider` 在 UI 显示为「智能体引擎」（后端字段名不变，下拉取值不变）。
- **G2 档案级供应商绑定**：档案可绑定一条 claude 类 `LlmProvider`（可选），任务启动时优先用绑定那条的凭证。
- **G3 跨用户安全（方案A）**：共享档案（workspace/platform 可见）绑定的供应商**不对非 owner 生效**，自动回退，不泄露创建者的 API key。
- **G4 零回归**：未绑定（`llm_provider_id=None`）时，凭证注入行为与现状 100% 一致（用户默认 → daemon 本机）。

## 3. 非目标（不在范围内）

- **不开放 codex 类供应商**：`LlmProviderCreate.agent_kind` 仍 `Literal["claude"]`，第二层下拉选 Codex 引擎时无选项（前端给出提示）。
- **不改运行中会话热切换**：`2026-08-06-provider-switch-live-session` 的 `PROVIDER_CONFIG_CHANGED` 推送行为不变；活动会话仍接收 `/settings` 默认切换的推送（已知交互，记录于风险登记，本次不处理）。
- **不存任何 API Key 到档案**：R-02 安全红线不变，档案只存 `llm_provider_id` 引用。
- **不做 `workspaces.default_agent_profile_id` 的设置 UI**（DB 列已存在但无入口，与本次无关）。
- **不补 mission 前端 `agent_profile_id` gap**（已知，独立问题）。

## 4. 总体方案

### 4.1 凭证取用四级判断（核心）

任务派发 → daemon claim lease → `context.py::_inject_provider_config` 装配 payload 时，凭证来源改为四级优先级：

| 优先级 | 条件 | 取用 |
|---|---|---|
| 1 | `lease_meta.llm_provider_id` 存在 且 `provider.user_id == runtime.user_id` 且 `provider.agent_kind == _normalize_lease_provider(agent_kind_raw)` | **用绑定那条 LlmProvider 的配置**（方案A 归属校验 + 引擎类型一致性双通过） |
| 2 | 优先级 1 任一条件不满足（未绑 / 归属不符 / 引擎类型不符） | 回退现状：`resolve_default_provider_config(runtime.user_id, agent_kind)` |
| 3 | 用户未设默认 provider | `provider_config` 不注入（D-007） |
| 4 | （daemon 侧）无 provider_config | 用 daemon 机器本地凭证（现有第 0 层行为） |

**归属校验语义（方案A，现状口径，见 D-007@v1）**：`provider.user_id`（绑定 provider 的 owner）须等于 `runtime.user_id`——后者是 **daemon 登记者**（由 `_inject_provider_config` 从 `lease.runtime_id → DaemonRuntime.user_id` 解析，**非任务发起者，也非档案 `owner_user_id`**）。两者相等才用绑定，即绑定**仅在「daemon 登记者自己就是该 provider owner」的执行上下文生效**；最常见场景「用户用自己登记的 daemon 跑自己的档案」命中此条件、绑定生效。不等（典型：借用他人登记的 daemon）则忽略绑定、静默回退；此回退按 `runtime.user_id`（daemon 登记者）查默认，可能拿到的是 daemon 登记者而非档案 owner 的默认 provider——这是 D-008 owner 级注入语义的固有限制，**本次继承**（用户已确认接受现状口径）。这仍保证共享档案绑定的供应商对其他成员不生效、不泄露密钥。另：优先级 1 同步校验 `provider.agent_kind` 与归一化引擎类型一致，防止 codex 引擎档案绑 claude provider 时下发错配凭证（堵 API/DB 直写绕过前端禁用）。

### 4.2 透传链路

```
AgentProfile.llm_provider_id（模型字段）
  → AgentService._apply_profile_to_lease 写 lease.metadata["llm_provider_id"]
    （复用现有 mcp_refs/skill_refs/profile_version 的 metadata 透传模式）
  → context.py::_inject_provider_config 从 lease_meta 读取
  → 按 id 查 LlmProvider + 归属校验 → 注入 provider_config
```

### 4.3 凭证配置构造（复用现有分支）

`LlmProvider` 有 `anthropic` / `openai_chat` 两种 `api_format`，对应 8 字段 / 6 字段两种 `provider_config` 形态（`context.py:106-136`）。**绑定路径必须复用同一套构造逻辑**：新增 `resolve_provider_config_by_id(session, provider_id)` helper，内部按 `api_format` 分支构造（与 `resolve_default_provider_config` 同款，只是查询从「user default」改成「by id」）。禁止只取 anthropic 分支而漏掉 openai_chat。openai_chat 分支内 `litellm_model_name(user_id, provider.id)` 的 `user_id` 取 `provider.user_id`（provider 自己的 owner；归属校验通过时与 `runtime.user_id` 等价），保持与 task-09 单一真相源一致，避免命名漂移致 LiteLLM 404。

### 4.4 前端表单（大脑区）

- 第一层：label `供应商偏好（决定选哪台 daemon）` → `智能体引擎`（下拉取值不变，仍 `PROVIDER_META`）。
- 第二层（新增）：`供应商配置` 下拉，数据源 `GET /api/llm-providers`（已按 owner 过滤），按第一层引擎联动过滤 `agent_kind`（当前只出 claude 类）。**可选**，留空 = 不绑定（用默认）。Codex 引擎下第二层禁用 + 提示「codex 类供应商暂未开放」。
- 提交：Create/Update body 带 `llm_provider_id`（`null` = 不绑定）。
- 卡片/预览展示绑定供应商名（见 4.5）。

### 4.5 绑定供应商名展示（无后端 join）

后端 `AgentProfileRead` 只返回 `llm_provider_id`（UUID）。前端用已有的 `/llm-providers` 列表（本就按当前用户 owner 过滤）做 `id → name` 映射：
- 命中（当前用户自己的 provider）→ 显示名称。
- 未命中（非本人供应商，即共享档案的 owner 绑定）→ 显示「（非本人供应商，将回退默认）」，与方案A 归属语义天然一致，零信息泄露，零后端 join / N+1。

### 4.6 编辑态回显（非 owner 绑定 provider）

表单 Select 的 options 来自当前用户的 `/llm-providers` 列表（已 owner 过滤）。编辑态若档案的 `llm_provider_id` **不在当前用户 options 里**（共享档案 owner 绑的、当前用户无权访问），Select 显示占位文案「（无权限访问该供应商，提交时不动）」，且 `form` value **保持原 id 不转 null**（依赖后端 Update 的 `exclude_unset` 语义：不传=不动），避免误触发解绑。

## 5. 数据模型

`AgentProfile`（`backend/app/modules/agent/profile/model.py`）新增字段：

```
llm_provider_id: UUID | None
  Column(UUID(as_uuid=True), ForeignKey("llm_providers.id", ondelete="SET NULL"), nullable=True)
```

- `nullable=True`（可选绑定）。
- `ondelete=SET NULL`：绑定的 `LlmProvider` 被删时自动置空 → 回退默认链。
- 不加单列索引（无「按 provider 反查档案」的查询路径，YAGNI）。

**迁移**：`backend/migrations/versions/20260811_agent_profile_llm_provider.py`，新增列，`down_revision` 接当前 alembic head（execute 时 `alembic heads` 确认）。

**现有字段一律不动**（`provider` 字段名/类型/语义不变，只改 UI label）。

## 6. 文件变更清单

| 文件 | 改动 |
|---|---|
| backend/app/modules/agent/profile/model.py | 加 llm_provider_id FK 字段 |
| backend/migrations/versions/20260811104500_agent_profile_llm_provider.py | 新增列迁移 |
| backend/app/modules/agent/profile/router.py | Create/Update/Read 加 llm_provider_id |
| backend/app/modules/agent/profile/service.py | create/update 写入；Read 透出 |
| backend/app/modules/agent/service.py | _apply_profile_to_lease 写 lease.metadata |
| backend/app/modules/daemon/lease/context.py | _inject_provider_config 四级判断 + 新增 resolve_provider_config_by_id |
| frontend/src/components/agent-profile-form.tsx | label 改名 + 第二层联动下拉 + 提交带字段 |
| frontend/src/components/agent-profile/agent-profile-card.tsx | 显示绑定供应商名 |
| frontend/src/components/agent-profile/agent-profile-preview.tsx | 显示绑定供应商名 |
| frontend/src/lib/agent-profiles.ts | 类型透传 |
| frontend/src/lib/api/llm-providers.ts | 复用列表查询做 id 到 name 映射 |
| frontend/src/lib/api-types.ts | pnpm gen:types 重生成（规则 20） |
| backend/openapi.json | pnpm gen:types 重生成（规则 20） |

## 7. 接口定义（DTO）

`AgentProfileCreate`（`router.py`）增：
```
llm_provider_id: UUID | None = None   # 可选，绑定一条 claude 类 LlmProvider
```

`AgentProfileUpdate`（`router.py`）增：
```
llm_provider_id: UUID | None | <unset>   # exclude_unset 语义；显式 null = 解绑
```

`AgentProfileRead`（`router.py`）增：
```
llm_provider_id: UUID | None   # 透出，前端按 /llm-providers list 映射名
```

`lease.metadata` 增内部键 `llm_provider_id`（不对外暴露，仅 claim 装配消费；加入 `_PROFILE_PAYLOAD_FIELDS` 不必要——它不像 mcp_refs 要透传给 daemon，只 backend 注入逻辑用，留在 metadata 即可）。

**不变**：`/llm-providers` 端点集合、`LlmProvider` 表结构、`agent_kind` Literal、lease/session/agent_run 状态机。

## 8. 生命周期契约

**不涉及生命周期契约。** 本变更不改动 `lease`/`session`/`agent_run`/`daemon` 的状态机与生命周期事件（`claim`/`start`/`complete`/`heartbeat`/`inject`/`end` 流程一律不变），仅在 lease claim 装配 payload 的 `_inject_provider_config` 内增加一处凭证来源判断（多读一个 metadata 字段 + 一次按 id 查询），不改任何状态流转、不新增/删除事件、不改必需字段契约。

## 9. 兼容策略（brownfield）

- **未绑定 = 零回归**：`llm_provider_id=None` 时，`_inject_provider_config` 直接走原 `resolve_default_provider_config` 路径，行为与现状逐字一致。
- **存量档案**：新列默认 `None`，无需回填数据；存量档案启动任务行为不变。
- **DTO 向后兼容**：Create/Update 新字段可选，旧客户端不传不受影响。
- **删除回退**：绑定的 `LlmProvider` 被删 → `ondelete=SET NULL` → 字段自动置 `None` → 下次启动回退默认链（R-03 测试覆盖）。
- **openai_chat 形态**：绑定路径复用 `resolve_provider_config_by_id`，两种 `api_format` 都支持（R-06）。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 共享档案跨用户泄露 owner 的 API key | P0 | 方案A：注入前校验 `provider.user_id == runtime.user_id`，不匹配忽略绑定、静默回退；展示层用 owner 过滤的 list 映射，非本人不显示名 |
| R-02 | 违反「档案不存密钥」红线 | P0 | 只存 `llm_provider_id`（UUID 引用）；明文 key 仍只在 `encrypt`/`decrypt` 两处（`llm_provider.md` R-02/R-04） |
| R-03 | 绑定的 provider 被删 | P2 | `ondelete=SET NULL` + 回退默认链；测试覆盖 |
| R-04 | 运行中会话热切换覆盖档案绑定 | P2 | 本次不改热切换（`PROVIDER_CONFIG_CHANGED` 仍推 user default）；记录已知，活动会话内以热切换为准，下次启动重新按绑定解析 |
| R-05 | Codex 引擎下第二层下拉空 | P2 | UI 明确提示「codex 类供应商暂未开放」，非 bug |
| R-06 | `openai_chat` 形态 provider 绑定漏分支 | P2 | `resolve_provider_config_by_id` 复用 `resolve_default_provider_config` 的 anthropic/openai 双分支构造 |
| R-07 | `runtime.user_id` 解析失败（legacy/interactive 兜底） | P2 | 沿用现有 `_inject_provider_config` 的 user_id 解析与「解析失败→不注入」语义，绑定判断仅在 user_id 可解析时启用 |
| R-08 | `_apply_profile_to_lease` 写 `lease.metadata` 与 daemon claim 的窄竞态（batch 路径） | P2 | 沿用现有竞态（`agent/service.py:660-665` docstring 已承认）；新增 `llm_provider_id` 字段复用同一 SQL UPDATE 路径，不引入新风险；本地 commit 远快于 daemon claim HTTP 往返，实战 claim 总能读到 |

## 11. 决策追踪

当前版本决策（详见 `decisions.md`）：

| 决策 ID | 标题 | 覆盖章节 / FR | 状态 |
|---|---|---|---|
| D-001@v1 | provider 不选 daemon（前提澄清） | §1、§4.4 | accepted |
| D-002@v1 | 第一层字段改名「智能体引擎」 | §4.4、FR-01 | accepted |
| D-003@v1 | AgentProfile 加 `llm_provider_id` FK（可选） | §5、FR-02 | accepted |
| D-004@v1 | codex 类供应商本次不开放 | §3、§4.4、FR-04 | accepted |
| D-005@v1 | 凭证取用=方案B兼容现状 | §4.1、FR-03 | accepted |
| D-006@v1 | 跨用户归属校验（方案A） | §4.1、§4.5、FR-05 | accepted |
| D-007@v1 | 绑定生效口径=runtime.user_id（接受现状） | §4.1、R-04 | accepted |

未解决剩余风险：R-04（热切换交互）明确本次不处理，留待后续变更评估。

## 12. 自审（Self-Review）

| 检查项 | 结果 | 说明 |
|---|---|---|
| 章节齐全（背景/目标/非目标/方案/数据模型/文件清单/接口/兼容/风险/决策/自审） | ✅ pass | 全部具备 |
| 生命周期契约 | ✅ pass | §8 明确「不涉及生命周期契约」，豁免短语紧邻关键词 |
| R-02 密钥红线 | ✅ pass | 档案只存 id，密钥路径不变 |
| 零回归（未绑=现状） | ✅ pass | §4.1 优先级 2/3 与现状逐字一致 |
| 跨用户归属校验（方案A） | ✅ pass | §4.1 优先级 1 校验 `provider.user_id==runtime.user_id` |
| openai_chat 分支 | ✅ pass | §4.3 复用 helper，双形态覆盖（R-06） |
| codex 不开放 | ✅ pass | §3 非目标 + §4.4 UI 提示 |
| 热切换不改 | ✅ pass | §3 非目标 + R-04 记录 |
| 字段命名一致性 | ✅ pass | 后端字段名 `provider` 不变，仅 UI label 改；新字段 `llm_provider_id` 与表名一致 |
| DTO 兼容 | ✅ pass | 新字段可选，exclude_unset 语义保留 |
| codex 引擎 agent_kind 一致性校验 | ✅ pass | §4.1 优先级 1 加 `provider.agent_kind` 子校验，堵 API/DB 直写绕过前端禁用（Grill P2 已修） |
| 编辑态非 owner 绑定回显 | ✅ pass | §4.6 规定未知 id 占位 + form value 不转 null，依赖 exclude_unset 守护 |
| 归属校验措辞准确（Grill P1） | ✅ pass | §4.1 改写为「daemon 登记者==provider owner 才生效」，借用 daemon 场景限制已写明（D-007@v1） |

自审结论：**通过**（Design Grill 发现的 P1 措辞脱节、P2 codex 校验缺失均已修订），可进入生成规范文件。

---
author: WhaleFall
created_at: 2026-08-11T10:06:13
change: 2026-08-11-agent-profile-bind-llm-provider
---

# 决策台账

本变更的实现/验收级决策记录。长期术语不在此维护（archive/scan 时提升到 `docs/SillyHub/glossary.md`）。

## D-001@v1: provider 字段不选 daemon（前提澄清）

- type: premise
- status: accepted
- source: code
- question: 现有表单 label「供应商偏好（决定选哪台 daemon）」中 provider 是否真的决定选哪台 daemon？
- answer: 否。daemon 选择唯一由工作区绑定（`WorkspaceMemberRuntime`）决定，provider 只决定在选中的 daemon 上匹配哪个 `DaemonRuntime`，并归一化为 `agent_kind` 用于凭证查询。
- normalized_requirement: UI label 必须修正，不能再描述为「决定选哪台 daemon」。
- impacts: D-002, FR-01, design §1/§4.4
- evidence: `backend/app/modules/agent/placement.py:993-994`（注释「profile.provider 仅影响 runtime 匹配 + borrow lender 选择，不改 daemon 选择顺序，binding 仍为唯一真相源」）
- priority: P1

## D-002@v1: 第一层字段 UI 改名「智能体引擎」

- type: term
- status: accepted
- source: user
- question: provider 字段在 UI 上应叫什么？（用户明确要求改名，认为「平台/供应商偏好」不准确）
- answer: 改为「智能体引擎」。下拉取值不变（仍 `PROVIDER_META`：Claude Code / Codex）。后端字段名 `provider` 不变，只改前端 label。
- normalized_requirement: `agent-profile-form.tsx` 第一层 Form.Item label 由「供应商偏好（决定选哪台 daemon）」改为「智能体引擎」；下拉选项与取值逻辑零变更。
- impacts: FR-01, design §4.4, 文件 agent-profile-form.tsx
- evidence: 用户轮次确认（字段命名 AskUserQuestion 选「智能体引擎」）
- priority: P1

## D-003@v1: AgentProfile 加 llm_provider_id 外键（可选）

- type: architecture
- status: accepted
- source: user
- question: 档案如何承载「绑定某条 /settings/providers 供应商配置」？
- answer: `AgentProfile` 新增 `llm_provider_id`（UUID，FK→`llm_providers.id`，`ondelete=SET NULL`，`nullable=True`）。可选绑定，留空 = 用默认。
- normalized_requirement: 模型加字段 + 迁移新增列；DTO Create/Update 接收可选 `llm_provider_id`（显式 null=解绑）；Read 透出。
- impacts: FR-02, design §5/§6/§7, model.py / router.py / 迁移
- evidence: 用户轮次确认（绑定方式 AskUserQuestion 选「可选」）；`llm_provider.md`（LlmProvider 有稳定 UUID 主键）
- priority: P0

## D-004@v1: codex 类供应商本次不开放

- type: boundary
- status: accepted
- source: user
- question: 第二层「供应商配置」在选 Codex 引擎时拿不到选项（后端 agent_kind 锁 claude），是否本次一起放开 codex？
- answer: 不放开。`LlmProviderCreate.agent_kind` 仍 `Literal["claude"]`，第二层联动只出 claude 类。选 Codex 引擎时第二层禁用 + 提示「codex 类供应商暂未开放」。
- normalized_requirement: 不动 llm_provider schema Literal；前端联动过滤 `agent_kind===第一层引擎归一化值`，codex 下空选项 + 提示。
- impacts: FR-04, design §3/§4.4, R-05
- evidence: 用户轮次确认（Codex 支持 AskUserQuestion 选「先只做 claude」）；`llm_provider.md`（agent_kind 当前 Literal 仅 claude）
- priority: P1

## D-005@v1: 凭证取用 = 方案B（兼容现状）

- type: architecture
- status: accepted
- source: user
- question: 档案没绑供应商时，任务该用哪里的凭证？
- answer: 方案B。档案绑了 `llm_provider_id` → 用绑的；没绑 → 用 `/settings/providers` 里用户默认（`is_default=True`）；用户也没设默认 → 不注入 provider_config（D-007）→ daemon 用本机。后两层与现状逐字一致。
- normalized_requirement: `_inject_provider_config` 改为「绑定优先 → 默认回退 → D-007 本机」四级；未绑路径行为零回归。
- impacts: FR-03, design §4.1/§9, context.py
- evidence: 用户轮次确认（未绑定回退 AskUserQuestion 选「没绑回退全局默认(兼容现状)」+ 后续确认「都没启动用本地」）；`context.py:204-205`、`llm_provider.md` D-007
- priority: P0

## D-006@v1: 跨用户归属校验（方案A）

- type: architecture
- status: accepted
- source: user
- question: 共享档案（workspace/platform）绑定了 owner 的供应商，其他成员用该档案跑任务时该用谁的凭证？
- answer: 方案A。注入前校验 `provider.user_id == runtime.user_id`（当前执行用户）。相等才用绑定（只对档案主人生效）；不等则忽略绑定、静默回退到该用户默认链。展示层用 owner 过滤的 `/llm-providers` list 做 id→name 映射，非本人供应商不显示名。
- normalized_requirement: 绑定注入路径必须含归属校验；非 owner 使用共享档案时不泄露 owner 凭证、不报错、回退默认。
- impacts: FR-05, design §4.1/§4.5, R-01
- evidence: 用户轮次确认（共享档案凭证 AskUserQuestion 选「A：只对档案主人生效」）；`context.py:170-188`（user_id 解析走 runtime.user_id）
- priority: P0

## D-007@v1: 绑定生效口径 = runtime.user_id（接受现状）

- type: compatibility
- status: accepted
- source: user
- question: 方案A 的「只对档案主人生效」实现上用 daemon 登记者（`runtime.user_id`）判断，与「档案 owner」在借用 daemon 场景下不一致；接受现状口径还是开新 change 改注入链？
- answer: 接受现状口径（A1）。保持按 `runtime.user_id`（daemon 登记者）判断。最常见场景「用户用自己登记的 daemon 跑自己档案」绑定生效；借用他人 daemon 时绑定失效、回退默认（回退取的是 daemon 登记者的默认 provider，D-008 owner 级注入固有行为，本次继承）。design §4.1 已据此改写措辞。
- normalized_requirement: 归属校验条件固定为 `provider.user_id==runtime.user_id`；design 必须写清「借用 daemon 场景绑定失效」的限制，不得包装成「档案 owner 永远生效」。
- impacts: D-006, design §4.1, R-04
- evidence: 用户轮次确认（Design Grill P1 AskUserQuestion 选「接受现状口径」）；`context.py:170-188`
- priority: P1

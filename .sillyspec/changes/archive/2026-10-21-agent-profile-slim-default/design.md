---
author: flow-machine-draft
created_at: 2026-10-21T04:10:58.640Z
---
# 设计记录（Design Record）— 2026-10-21-agent-profile-slim-default

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

三块：①**前端瘦身**——agent-profile-form.tsx 删 ②大脑区（引擎/模型/供应商）与 ③工具能力区的工具策略/MCP 勾选及「工作区上下文」选择器（技能勾选是用户级数据源无需 ws sourcing），保留 名称/可见范围/系统提示词/技能勾选；右栏预览与 AgentProfileSelect label 同步简化；后端 Create 的 provider 给缺省 'claude'（列 NOT NULL 保留，读侧已忽略）。②**用户默认档案**——`users.default_agent_profile_id`（FK SET NULL，alembic 迁移）承载每用户一个默认；profile router 新增 set-default/unset-default 端点（可见性校验+无凭证探测，比供应商版更简）；注入点两处：会话 `inject_gates._resolve_create_inputs`（agent_profile_id 为 None 时查 user 默认，软偏好静默回落）与群聊 `shadow.py` 影子懒建（user=group.created_by 的默认）；注入统一走既有 `apply_session_profile_to_lease`。③**技能严格挂载**——backend 已无条件写 lease.metadata.skill_refs（含空数组）；daemon 侧新增 strict 读取（区分「键缺失」=不裁剪 vs「键在场含空数组」=清空），interactive 路径 skillsStep 在 link 后补 prune（复用 task-runner 的 pruneSkillsToSubset，导出共享），batch 路径读取点同步 strict 化（两路径语义一致）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `users` 表：新增 `default_agent_profile_id uuid NULL FK agent_profiles.id ON DELETE SET NULL`（迁移 20261021_user_default_agent_profile）。
- `POST /api/workspaces/{wid}/agent-profiles/{id}/set-default` / `unset-default`（新端点，形随现有 agent-profiles 路由前缀）：set 校验档案对 actor 可见 → 写 user 列（单列天然互斥）；unset 置 NULL（幂等）。响应 `{"ok": true}` 形态（无探测三态——档案无凭证）。
- `AgentProfileRead` DTO：新增计算字段 `is_user_default: bool`（按请求者 user 列比对），供前端默认标记渲染。
- `AgentProfileCreate.provider`：缺省 `"claude"`（前端瘦身后不传）；Update 不动。
- claim payload `skillRefs` 语义：键在场（含空数组）=严格挂载（空=清空）；键缺失=全量（现状）。backend 写侧不变（已无条件写），daemon 读侧 strict 化。`_inject_provider_config`/llm_provider 模块零变化。
- daemon：`pruneSkillsToSubset` 从 task-runner.ts 导出（或下沉 skill-manager.ts）；interactive `skillsStep` 尾部按 strict skillRefs 裁剪；batch task-runner 读取点 `if (skillRefs)` 改 `!== undefined` 语义（经 strict helper，不动通用 pickStrList）。
- 前端 lib：`setDefaultAgentProfile`/`unsetDefaultAgentProfile` API + 类型 `is_user_default`。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 新增 | backend/migrations/versions/20261021_user_default_agent_profile.py | users 加 default_agent_profile_id 列 |
| 修改 | backend/app/modules/auth/model.py | User.default_agent_profile_id 字段 |
| 修改 | backend/app/modules/agent/profile/router.py | set-default/unset-default 端点；Create.provider 缺省；Read.is_user_default |
| 修改 | backend/app/modules/agent/profile/service.py | set_user_default/unset_user_default；get 读可见校验复用 |
| 修改 | backend/app/modules/daemon/session/service/inject_gates.py | 未显式选档案时查用户默认注入（软偏好） |
| 修改 | backend/app/modules/daemon/group/service/shadow.py | 影子懒建时群主默认档案注入 |
| 修改 | sillyhub-daemon/src/skill-manager.ts（或 task-runner.ts） | pruneSkillsToSubset 导出共享 |
| 修改 | sillyhub-daemon/src/daemon.ts | skillsStep 补裁剪；skillRefs strict 归一化 |
| 修改 | sillyhub-daemon/src/task-runner.ts | batch 读取点 strict 化 |
| 修改 | frontend/src/components/agent-profile-form.tsx | 表单瘦身四字段；预览简化 |
| 修改 | frontend/src/components/agent-profile/agent-profile-card.tsx | 设为默认/取消默认 + 默认标记 |
| 修改 | frontend/src/lib/agent-profiles.ts | set/unset-default API + is_user_default 类型 |
| 修改 | frontend/src/components/agent-profile-select.tsx | label 简化（去 provider/model 展示） |
| 修改 | 上述各对应测试文件 | 见测试绑定 |

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   成立。默认档案是软偏好：设默认与创建会话并发时读到旧值或新值均合法（注入读 users 行单值，无中间态）；技能裁剪依据 claim 快照（lease metadata 建会话时已定），迟到改档不影响已 spawn 会话。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   默认标记写 users 单列（UPDATE 原子，Last-Write-Wins 可接受——无兄弟行互斥问题，天然「每用户至多一个」）；daemon prune 与 link 都在 spawn 前置串行步骤内，无并发写同目录。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   安全。默认档案被删 → FK SET NULL 自动回落；失可见 → 注入点 get() 校验失败静默跳过（软偏好契约）；旧 daemon 版本遇到空数组 skillRefs 按旧语义全量挂载（优雅降级，不炸）；运行中会话切档案（reloadWithConfig）技能不重挂（v1 边界，人格维度照旧）。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   不会。默认标记在 users 行（用户级），档案可见性校验按 actor；技能勾选引用用户技能池（user-scoped）；群聊默认取群主 users 行，成员间不串台（成员人格由群主配置是建群既有语义）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：daemon prune 是删目录操作，误删会话工作区文件——缓解：复用既有 pruneSkillsToSubset（限定 `<workDir>/.claude/skills/` 基目录、跳过隐藏项与非目录、单条失败仅 warn），且仅 spawn 前置链执行一次；实测门覆盖 daemon 测试。次风险：空=清空语义对存量用户反直觉（选了空技能档案的默认档案会让会话没技能）——缓解：设默认交互处提示「该档案未勾选技能，设为默认后你的会话将不挂载技能」（前端文案警示）。
死路：①档案行级 is_default 列（仿供应商）——放弃：档案跨用户共享（workspace/platform 可见），行级标记会让甲的默认影响乙，必须用户级存储；②改通用 pickStrList 空数组语义——放弃：effectiveAllowedRoots 等多调用方依赖「空=不过滤」既有契约，新 strict 变体隔离影响面；③热切换会话技能重挂载——v1 不做：需 daemon 会话存活期重跑 link/prune 链，收益低复杂度高，记边界。

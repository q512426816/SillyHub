---
author: WhaleFall
created_at: 2026-08-14 14:32:59
change: 2026-08-14-runtime-session-agent-profile-link
---

# 决策台账（Decisions）

> 本文件是本次变更的决策台账，仅记录有实现/验收影响的决策。长期术语在 archive/scan 时再提升到 `docs/SillyHub/glossary.md`。

## D-001@v1 — 档案按会话隔离

- **type**: scope / data-model
- **status**: accepted
- **source**: 用户（brainstorm step5）
- **question**: 切换档案是否影响所有会话？
- **answer**: 档案按会话隔离——每个 AgentSession 独立持有 agent_profile_id，切换只更新当前会话；不同会话可用不同档案，换一个不会导致所有会话都切换。
- **normalized_requirement**: `AgentSession` 增 `agent_profile_id` 列；切换接口只针对单个 session。
- **impacts**: §5 Wave3、§8 数据模型、FR-05
- **evidence**: 用户原话"不同会话的档案可以选择不同的，不要换了一个之后所有会话都切换。切换只切换当前会话。"
- **priority**: P0

## D-002@v1 — 同引擎内切换档案

- **type**: scope
- **status**: accepted
- **source**: 用户（brainstorm step3 Q1）
- **question**: 会话进行中切换档案，允许切到什么范围？
- **answer**: 只能切同种智能体（同 provider/engine）的档案，对话历史无缝保留；跨引擎需重开新会话。
- **normalized_requirement**: 切换前端列表只列与当前会话 provider 相同的档案；后端 inject_session 校验 `profile.provider == session.provider`。
- **impacts**: FR-04/FR-06、NG-02、R-03
- **evidence**: 用户选择"只能切同种智能体（推荐）"。
- **priority**: P0

## D-003@v1 — Codex 人格第一期不注入

- **type**: scope / phasing
- **status**: accepted
- **source**: 用户（brainstorm step3 Q2）
- **question**: 档案人格提示词对 Codex 是否生效？
- **answer**: 第一期仅 Claude 生效；选 Codex 档案时 provider/凭证/模型跟随，人格不注入。Codex 支持作后续增强。
- **normalized_requirement**: `reloadWithProfile`/注入对 Codex driver 不下发 systemPrompt（既有 D-005-旧：CodexStartOptions 无 systemPrompt，TS 隔离）。
- **impacts**: NG-01、R-04
- **evidence**: 用户选择"第一期只让 Claude 生效（推荐）"；既有约束 codex-app-server-driver.ts:362-387。
- **priority**: P1

## D-004@v1 — profile.model 生效（补 change 遗留）

- **type**: behavior
- **status**: superseded（由 D-004@v2 取代：v1 未识别 `_inject_provider_config` 覆盖链，实现方式被 Grill 证伪）
- **source**: 用户原话 + 代码核查
- **question**: 档案里的 model 字段是否决定实际模型？
- **answer**: 是。`resolved_model = profile.model or workspace.default_model or None`。补 change 逻辑里 profile.model 仅记录不生效的遗留（agent #3 核查：service.py 全仓 profile.model 只进 snapshot 不进 dispatch）。
- **normalized_requirement**: 后端 create_session/stage dispatch 的 model 解析加 profile.model 覆盖。
- **impacts**: FR-07、§5 Wave1、R-02
- **evidence**: 用户原话"档案决定 provider+model"；agent #3 报告 §4（model 不由档案决定，已知 GAP）。
- **priority**: P1

## D-005@v1 — UI 去掉引擎/模型字段，只留档案选择器

- **type**: UX
- **status**: accepted
- **source**: 用户（brainstorm step5 两轮迭代）
- **question**: 会话区如何呈现 provider/model/档案？
- **answer**: UI 只保留单个「智能体档案」选择器；引擎（provider）与模型字段均去掉，引擎由所选档案隐含决定（profile.provider），档案选项上标注所属引擎。不选档案=用默认引擎（现状）。
- **normalized_requirement**: 前端 createSession 不传 provider/model，只传 agent_profile_id；后端派生 provider/model。
- **impacts**: FR-01、§5 Wave3、NG-05
- **evidence**: 用户"我不需要智能体模型了"+"引擎也不要了，反正后面也换不了，直接选档案"。原型 prototype-session-profile.html v3。
- **priority**: P0

## D-006@v1 — 切换走 daemon 热切换（reloadWithProfile）

- **type**: architecture
- **status**: accepted
- **source**: 用户（brainstorm step4 选方案 A）
- **question**: 中途切换档案如何实现？
- **answer**: 方案 A——同会话热切换，复用既有 reloadWithProvider 模式：turn 边界关旧 query、用新 systemPrompt 重建 driverOpts、driver.start({resume}) 从 jsonl 重载历史。新增 pendingProfileSwitch + SESSION_SWITCH_PROFILE WS 消息。
- **normalized_requirement**: daemon session-manager 新增 reloadWithProfile/markPendingProfileSwitch；daemon.ts 处理 SESSION_SWITCH_PROFILE。
- **impacts**: FR-04、§5 Wave2、§7.5、R-01/R-07
- **evidence**: 用户选"方案 A：同会话热切换（推荐）"；agent #4 §5（pendingSwitch + reloadWithProvider 现成模式 session-manager.ts:2921-2935/2638）。
- **priority**: P0

## D-004@v2 — profile.model 真正生效：显式档案 model 优先

- **type**: behavior / compatibility
- **status**: accepted
- **supersedes**: D-004@v1
- **source**: design-grill（BLOCK-2/C-02/C-03 证伪 v1 假设）
- **question**: profile.model 与 `_inject_provider_config` 覆盖链冲突，真实优先级是什么？
- **answer**: 显式档案 model（lease metadata 带 `model_source="profile"` 标记）> 绑定/默认 provider_config.model > workspace 默认 > daemon 默认。`_apply_profile_to_lease` 补写 profile.model+标记（现状不写 model 进 lease）；`_inject_provider_config` 见标记跳过 model 覆盖；未标记（非档案）会话维持现状覆盖链，零回归。
- **normalized_requirement**: 切换/建会话时 profile.model 写入 lease metadata 并带显式标记；claim payload 的 model 尊重标记；单测覆盖优先级矩阵。
- **impacts**: FR-07、R-02、§5 Wave1
- **evidence**: `context.py:270-294`（bound :273-275 / 默认 :292-294 覆盖链）、`agent/service.py:738-736 附近`（`_apply_profile_to_lease` 不写 model）、用户迭代史（去掉模型手填框 → 档案 model 是控制模型的唯一入口，若不生效则用户永远无法控制模型）
- **priority**: P1

## D-007@v1 — 切换消息原子化（SESSION_SWITCH_PROFILE 携带 prompt/run_id/claim_token）

- **type**: architecture / protocol
- **status**: accepted
- **source**: design-grill（BLOCK-1）
- **question**: 切换档案轮的 prompt 如何投递？（v1 草案 SESSION_SWITCH_PROFILE 无 prompt/run_id/claim_token，而 daemon 内存 systemPrompt 仅 create 时读 lease、inject 不重读 → 新 run 会永远 pending）
- **answer**: SESSION_SWITCH_PROFILE **原子承载** profile 字段 + 切换轮 prompt/run_id/claim_token（单消息，避免"切换+投递"双消息顺序竞态）。daemon 双路径：idle 立即 reload 后喂 prompt；running 挂 pendingProfileSwitch 至 turn 边界 reload 再喂（复用 markPendingSwitch 先例 session-manager.ts:2576-2581/2928）。
- **normalized_requirement**: WS 消息 schema 见 design §7.3；daemon 处理含 idle/boundary 双分支；reloadWithProfile 与 reloadWithProvider 共用 reload 内核。
- **impacts**: §5 Wave2、§7.3、§7.5、R-01/R-07
- **evidence**: Grill BLOCK-1（daemon.ts create 一次性读 lease.metadata 的 systemPrompt，session-manager 内存态）；markPendingSwitch 双路径先例
- **priority**: P1

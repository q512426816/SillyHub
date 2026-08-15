---
author: WhaleFall
created_at: 2026-08-14 15:00:50
---

# 任务清单（Tasks）

> 骨架，plan 阶段展开为 Wave 分组与依赖关系。

- [ ] task-01: 后端 `AgentSession` 加 `agent_profile_id`/`agent_profile_snapshot` 列 + Alembic 迁移（agent/model.py + 新迁移文件）
- [ ] task-02: 后端会话创建/注入请求 DTO 具名化（router.py:1573/1591 inline → schema.py 具名模型）并加 `agent_profile_id`（create 去掉 model 依赖）
- [ ] task-03: 后端 `create_session` 档案接线：解析 profile（复用 `_resolve_dispatch_profile` 模式）→ 派生 provider/model → 调 `_apply_profile_to_lease` → 写 session.agent_profile_id/snapshot；未选档案走原路径
- [ ] task-04: 后端 profile.model 显式标记生效（D-004@v2）：`_apply_profile_to_lease` 补写 profile.model+`model_source="profile"`；`_inject_provider_config` 见标记跳过 model 覆盖；优先级矩阵单测
- [ ] task-05: 后端 `inject_session` 切换：入参加 `agent_profile_id`，与当前不同→同 provider 校验（FR-06）→建新 AgentRun（新快照）→下发 `SESSION_SWITCH_PROFILE`（原子 payload：profile 字段+prompt/run_id/claim_token）
- [ ] task-06: daemon 切换类型与 reload 内核：`SessionSwitchProfilePayload` 类型；`reloadWithProfile`/`markPendingProfileSwitch`（与 `reloadWithProvider` 共用 `_reloadSession` 内核，R-01）
- [ ] task-07: daemon `SESSION_SWITCH_PROFILE` 消息处理（daemon.ts）：idle 立即 reload 后喂 prompt / running 挂 pending 至 `_onResult` 边界；持久化恢复路径更新 state.systemPrompt
- [ ] task-08: 前端建会话区替换为单一 `AgentProfileSelect`（去掉引擎/模型控件，档案选项标注引擎；Codex 档案标注"人格暂不支持"）；未选档案=默认
- [ ] task-09: 前端 active 态切换入口（「当前档案[切换]」）+ injectSession 带 `agent_profile_id`（列表只列同引擎档案；切换只刷新当前会话视图）
- [ ] task-10: `pnpm gen:types` 同步（api-types.ts + openapi.json），前端 daemon.ts 请求类型迁生成版（C-05）
- [ ] task-11: 测试收口：后端（优先级矩阵/切换校验/未选档案零回归）、daemon（reload resume+新 systemPrompt）、前端（选择器/切换入口组件测试）；`npm test` + `npm run lint` 全绿

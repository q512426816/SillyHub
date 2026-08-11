---
author: WhaleFall
created_at: 2026-08-11T10:06:13
change: 2026-08-11-agent-profile-bind-llm-provider
---

# 任务清单（高层，plan 阶段拆 Wave 细化）

1. 后端·模型加 `AgentProfile.llm_provider_id` FK 字段（`agent/profile/model.py`）。
2. 后端·新增 Alembic 迁移（`migrations/versions/20260811_agent_profile_llm_provider.py`，down_revision 接当前 head）。
3. 后端·DTO 加字段：`AgentProfileCreate/Update/Read` 加 `llm_provider_id`（`agent/profile/router.py`）。
4. 后端·service create/update/Read 透传字段（`agent/profile/service.py`）。
5. 后端·lease 透传：`_apply_profile_to_lease` 写 `lease.metadata["llm_provider_id"]`（`agent/service.py`，复用裸 SQL UPDATE 路径）。
6. 后端·注入逻辑：新增 `resolve_provider_config_by_id` helper；`_inject_provider_config` 改四级判断 + 归属校验 + agent_kind 一致性校验（`daemon/lease/context.py`）。
7. 前端·表单「大脑」区：第一层 label 改名「智能体引擎」；第二层新增「供应商配置」联动下拉（`agent-profile-form.tsx`）。
8. 前端·编辑态回显 + 提交带 `llm_provider_id`（含未知 id 占位策略）。
9. 前端·卡片/预览展示绑定供应商名（id→name 映射，`agent-profile/*`）。
10. 类型·`pnpm gen:types` 重生成 `api-types.ts` + `openapi.json` 并提交。
11. 测试·后端 `_inject_provider_config` 四级判断 + 归属校验 + agent_kind 校验 + openai_chat 分支 + 删除回退。
12. 测试·前端表单第二层联动 + 编辑态回显 + 提交 body。
13. 验收·对照 requirements.md 验收要点逐项实测。

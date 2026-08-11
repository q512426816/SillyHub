---
author: WhaleFall
created_at: 2026-08-11T10:30:00
change: 2026-08-11-agent-profile-bind-llm-provider
plan_level: full
---

# 实现计划：智能体档案绑定供应商配置

`plan_level = full`（跨 4 模块：agent/profile + llm_provider + daemon/lease + frontend；DB schema 变更；11 task）。实现细节由各 `tasks/task-NN.md` 承载，本文件只含 Wave 分组 / 任务总表 / 关键路径 / 覆盖矩阵 / 全局验收。

## Spike

无。纯业务逻辑，技术方案由 `design.md` 锁定（四级凭证判断 + lease metadata 透传 + by_id helper 复用双分支），无新技术栈 / 安全隔离 / 性能瓶颈不确定性。

## Wave 分组

### Wave 1：后端数据层（无依赖）
- [x] task-01: `AgentProfile` 模型加 `llm_provider_id` FK 字段
- [x] task-02: Alembic 迁移新增列（down_revision 接当前 head）

### Wave 2：后端 DTO / Service / 透传 / 注入（依赖 Wave 1；Wave 内 task-05 顺序依赖 task-04，不可并行）
- [x] task-03: profile DTO（Create/Update/Read）加字段 + service create/update/Read 透传
- [x] task-04: `_apply_profile_to_lease` 写 `lease.metadata["llm_provider_id"]`（裸 SQL UPDATE 路径）
- [x] task-05: `context.py` 四级判断 + `resolve_provider_config_by_id` helper（双分支）+ 归属校验 + agent_kind 一致性校验（依赖 task-04 的 metadata 透传）

### Wave 3：前端（依赖 Wave 2 schema 改）
- [x] task-06: `pnpm gen:types` 重生成 `api-types.ts` + `openapi.json` 并提交（依赖 task-03）
- [x] task-07: 表单第一层改名「智能体引擎」+ 第二层联动下拉 + Codex 禁用提示 + 编辑态回显占位 + 提交带字段（依赖 task-06）
- [x] task-08: 卡片/预览展示绑定供应商名（id→name 映射，非本人提示）（依赖 task-06）

### Wave 4：测试 + 验收（依赖 Wave 2/3）
- [x] task-09: 后端注入逻辑测试（四级判断 / 归属校验 / agent_kind 校验 / openai_chat 分支 / 删除回退）
- [x] task-10: 前端表单测试（第二层联动 / 编辑态回显 / 提交 body）
- [x] task-11: profile `router` 改 DTO 后 `test_router` 回归（CONVENTIONS：改 router 必跑）

## 任务总表

| task | 优先级 | 依赖 | 模块 | 完成标准 |
|---|---|---|---|---|
| task-01 | P0 | — | agent/profile.model | `llm_provider_id` UUID FK→llm_providers.id `ondelete=SET NULL` nullable；继承 BaseModel；ruff/mypy 绿 |
| task-02 | P0 | task-01 | migrations | 迁移 up/down 可逆；`alembic upgrade head` 成功；列定义与 model 一致 |
| task-03 | P0 | task-01 | agent/profile.router+service | Create/Update 接收可选 `llm_provider_id`（显式 null=解绑，exclude_unset）；Read 透出；`test_router` 绿 |
| task-04 | P0 | task-01 | agent/service | `_apply_profile_to_lease` 走裸 SQL 写 `meta["llm_provider_id"]`；daemon claim 路径能读到（测试验证） |
| task-05 | P0 | task-04 | daemon/lease.context | 四级判断 + `resolve_provider_config_by_id`（anthropic/openai_chat 双分支）+ `provider.user_id==runtime.user_id` + `provider.agent_kind==normalize(agent_kind_raw)` 校验；未绑走原 `resolve_default_provider_config` 零回归 |
| task-06 | P0 | task-03 | frontend（gen:types） | `api-types.ts` + `backend/openapi.json` 重生成并提交；`pnpm gen:types:check` 绿 |
| task-07 | P0 | task-06 | frontend agent-profile-form + lib/agent-profiles.ts | 第一层 label 改「智能体引擎」；第二层下拉按 `agent_kind` 联动过滤；Codex 引擎禁用+提示；编辑态未知 id 占位且 value 不转 null；提交 body 带 `llm_provider_id` |
| task-08 | P1 | task-06 | frontend agent-profile/* + lib/api/llm-providers.ts | 卡片/预览用 `/llm-providers` list 做 id→name；非本人供应商显示「（非本人供应商，将回退默认）」 |
| task-09 | P0 | task-05 | backend tests | 覆盖：绑定生效 / 未绑回退默认 / 无默认 D-007 本机 / 跨用户归属不匹配回退 / agent_kind 不符回退 / openai_chat 形态 / 绑定 provider 删除后回退 |
| task-10 | P1 | task-07 | frontend tests | 第二层随引擎联动、Codex 禁用、编辑态未知 id 占位、提交 body 含 `llm_provider_id`（null=解绑） |
| task-11 | P1 | task-03 | backend tests | profile `test_router` 全绿（Create/Update/Read 新字段） |

## 关键路径

```
task-01 → task-04 → task-05 → task-06 → task-07 → task-09
              ↘ task-03 ↗          ↘ task-08
```

注：上图为业务主推进序列，非纯依赖图——task-06 实际依赖 task-03（见总表），不必等 task-05。task-02 / task-03 / task-04 三者均只依赖 task-01、可并行；task-05 须等 task-04。Wave 3 全体依赖 task-06（类型先就位）。Wave 4 测试在对应实现 task 完成后即可开始（不必等全 Wave）。

## 决策 / 需求覆盖矩阵

| D / FR | 覆盖 task |
|---|---|
| D-001（provider 不选 daemon） | task-07（改名事实依据） |
| D-002（改名「智能体引擎」） | task-07 |
| D-003（加 llm_provider_id FK） | task-01, task-02, task-03 |
| D-004（codex 不开放） | task-07 |
| D-005（凭证取用方案B） | task-05 |
| D-006（跨用户归属校验） | task-05, task-08 |
| D-007（现状口径 runtime.user_id） | task-05 |
| FR-01 改名 | task-07 |
| FR-02 绑定字段 | task-01, task-02, task-03 |
| FR-03 四级判断 | task-05 |
| FR-04 codex 不开放 | task-07 |
| FR-05 归属校验 | task-05, task-08 |
| FR-06 agent_kind 一致性 | task-05 |
| FR-07 第二层联动下拉 | task-07 |
| FR-08 卡片展示 | task-08 |
| FR-09 编辑态回显 | task-07 |
| NFR-01 零回归 | task-05, task-09 |
| NFR-02 R-02 密钥红线 | task-01, task-05 |
| NFR-04 类型同步 | task-06 |

## 全局验收标准（对应 requirements.md 验收要点）

1. 档案绑定 claude 供应商 + 用自己 daemon 跑 → 注入绑定的凭证（task-05/09）
2. 档案未绑 → 注入用户默认供应商（现状，零回归）（task-05/09）
3. 用户无默认 → daemon 本机（D-007）（task-05/09）
4. 共享档案绑的供应商对非 owner 成员不生效、不泄露密钥（task-05/09）
5. codex 引擎档案绑 claude provider → agent_kind 不符，回退（task-05/09）
6. 绑定的 provider 被删 → 字段置空 → 回退默认（task-02 ondelete + task-05/09）
7. openai_chat 形态 provider 绑定 → 正确构造 6 字段 config（task-05/09）
8. 前端两层下拉 + 引擎联动 + Codex 禁用 + 编辑态回显（task-07/10）
9. `api-types.ts` 与后端 OpenAPI 同步（task-06，gen:types:check 绿）
10. 零静态债务：后端 ruff+mypy 绿、前端 tsc+ESLint 绿（所有 task）

## 测试命令（来自 local.yaml / TESTING.md）

- 后端：`cd backend && uv run pytest -n auto`（用 `backend/.venv/Scripts/python.exe`）；模块级 `pytest app/modules/agent/ app/modules/daemon/`
- 前端：`cd frontend && pnpm test`（vitest）；类型 `pnpm gen:types:check`
- 类型生成：`cd frontend && pnpm gen:types`（规则 20，改后端 schema 后必跑并提交）

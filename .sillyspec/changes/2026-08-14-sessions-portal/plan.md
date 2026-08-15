---
author: WhaleFall
created_at: 2026-08-15 09:55:00
plan_level: full
change: 2026-08-14-sessions-portal
---

# 实现计划（Plan）— 智能体会话总入口页面（/sessions）

## Spike 前置验证

| Spike | 验证内容 | 不通过后果 |
|---|---|---|
| spike-01 | ① 核实 LlmProvider 配置中「1M 上下文」的真实存储位置（`model`/`extra_env`/`settings_config` 哪个字段承载，前端设置页勾选项落到哪）；② GLM 供应商限额/重置接口可达性与返回结构（5h/周窗口） | task-15 分母退化：供应商派生 → 常量表 → 只显示累计 token（D-014 本就定义了降级链）；task-07 额度端点返回 `{"quota": null}`，前端不显示胶囊 |

> spike-01 在 Wave 1 开始前完成（只读核实，30 分钟内），结论回写本文件附录与 design FR-08 口径。

## Wave 1（并行，无依赖 — 后端数据模型与 API 基础）

- [x] task-01: 模型+迁移：`AgentSession` 加 `agent_profile_id`/`llm_provider_id`/`config_snapshot` 三列、`AgentRun` 加 `llm_provider_id`（覆盖：FR-04, D-008@v1）
- [x] task-02: DTO 具名化：`SessionCreateRequest`（runtime_id/provider 双入口 + agent_profile_id/llm_provider_id，去 model）/`SessionInjectRequest` 迁入 `daemon/schema.py`；`AgentSessionRead` 加配置字段（config_snapshot 含 machine_name/agent_name）；router.py create/inject 端点改用具名 DTO（覆盖：FR-01, D-010@v1, D-011@v1）
- [x] task-04: `_inject_provider_config` 会话级供应商最高优先级分支（独立 metadata key `session_llm_provider_id`，两级：会话>全局默认；未传走原链零回归）+ 优先级单测（覆盖：FR-04, D-013@v1）
- [x] task-07: 供应商额度端点 `GET /api/llm-providers/{id}/quota`（一期 GLM，依赖 spike-01 结论；无数据/失败返回 null 不阻塞）（覆盖：FR-08, D-009@v1）

## Wave 2（依赖 Wave 1 — 后端创建接线 + daemon 热切换内核 + 前端基建）

- [x] task-03: create_session 接线：runtime_id→runtime→provider 校验在线；placement `prepare_interactive_dispatch` 加 runtime_id 钉定（跳过 first-online/fallback，Grill C-01）；档案解析只取 system_prompt+mcp/skill（会话专用非 commit 变体，D-013）；会话级供应商写 lease metadata；快照落库（含 machine_name/agent_name）（覆盖：FR-01, FR-03, D-005@v1, D-013@v1）
- [x] task-08: daemon 类型+热切换内核：`SessionSwitchConfigPayload`；抽取 `_reloadSession` 共享内核（自 reloadWithProvider 重构）；`markPendingConfigSwitch`/`reloadWithConfig`；state/持久化补 config 快照（覆盖：FR-05, D-012@v1）
- [x] task-13: 前端抽共享子组件：从 `interactive-session-panel.tsx` 抽 TurnTimeline/SessionInputBar，弹窗零回归（覆盖：FR-05, D-002@v1）
- [x] task-16: 前端 client 扩展：`lib/daemon.ts` createSession/injectSession 加 runtime_id/agent_profile_id/llm_provider_id、listAgentSessions 加过滤参数（暂手写类型，Wave4 迁生成版）（覆盖：FR-01, FR-02）

## Wave 3（依赖 Wave 2 — 切换链路 + 独立组件）

- [x] task-05: inject_session 切换：配置变更校验（agent_kind+归属（借用场景按 AgentSession.user_id））→ 同事务先落新 AgentRun（新快照）+ 更新会话三列 → 下发 SESSION_SWITCH_CONFIG → send 失败按既有 inject 收敛；**`llm_provider_id` 空串 "none" → 清空会话供应商回到本机默认（写 NULL）**（覆盖：FR-05, FR-06, D-008@v1, D-012@v1）
- [x] task-06: 会话列表扩展：`GET /api/daemon/sessions` 加 runtime_id/machine_id/provider/q 过滤 + 分页验证（覆盖：FR-02, D-003@v1）
- [x] task-09: daemon SESSION_SWITCH_CONFIG 消息处理（idle 立即/running 挂边界；喂 prompt；Codex 只切配置不注人格）（覆盖：FR-05, D-012@v1）
- [x] task-12: 前端 NewSessionForm：四选择器联动（默认机器=localStorage→最近会话→心跳；智能体默认 CC、切机器重置；供应商仅 Claude 引擎可选、不选=本机默认；档案跨工作区不过滤、Codex 下标注人格暂不支持）+ 开始会话（覆盖：FR-01, D-005@v1, D-010@v1, D-013@v1）
- [x] task-15: 前端 CtxUsageBar：上下文用量环（usage 累计；分母按 spike-01 结论：供应商派生 1M→常量表→只显示累计；阈值变色+详情）+ QuotaPill（quota 联动、null 不显示）（覆盖：FR-08, D-009@v1, D-014@v1）

## Wave 4（依赖 Wave 3 — 消费切换链路的组件）

- [x] task-11: 前端 SessionListPanel：筛选（引擎 tab/状态/机器多选/搜索回车）+ 虚拟滚动（@tanstack/react-virtual）+ 紧凑两行条目（chips 读 snapshot）（覆盖：FR-02, D-003@v1, D-006@v1）
- [x] task-14: 前端 SessionConfigBar（样式 B）：输入框下四控件；档案/供应商可切（inject 带新配置；**供应商下拉含「不指定（本机默认）」选项触发切回**）；机器/智能体纯展示置灰（二期/需开新会话）；running 全置灰+解锁提示；消息 who 行按轮次 run 快照渲染（覆盖：FR-05, FR-07, D-004@v2, D-007@v1, D-008@v1）
- [x] task-17: `pnpm gen:types` 同步提交（api-types.ts + openapi.json）+ `lib/daemon.ts` 类型迁生成版修编译（覆盖：规则 20）

## Wave 5（依赖 Wave 4 — 组装与收口）

- [x] task-10: 前端路由+菜单 3 处（menu-permissions.ts/app-shell.tsx/layout.tsx 白名单）+ `sessions/page.tsx` 两栏两态组装（NewSessionForm/SessionPanel/SessionListPanel/CtxUsageBar/SessionConfigBar）+ 页面组装冒烟（覆盖：FR-01, FR-02）
- [x] task-18: 测试收口：后端（优先级两级矩阵/切换校验 4xx/列表过滤/未选配置零回归）+ daemon（reload resume+新配置/pending 边界/SESSION_SWITCH_CONFIG 处理/恢复路径）+ 前端（表单联动/控件条切换置灰/列表筛选/who 行快照）+ `npm test`/`lint` 全绿（依赖 Wave1~4 全部；页面级组装验证归 task-10）（覆盖：全部 FR 回归）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 模型+迁移（3+1 列） | W1 | P0 | — | FR-04, D-008 | agent/model.py + Alembic |
| task-02 | DTO 具名化+Read 字段 | W1 | P0 | — | FR-01, D-010/D-011 | schema.py + router.py 端点换 DTO |
| task-04 | 会话级供应商分支+单测 | W1 | P0 | — | FR-04, D-013 | lease/context.py 独立 key |
| task-07 | 额度端点（GLM 一期） | W1 | P2 | spike-01 | FR-08, D-009 | llm_provider/router.py 复用 usage_handlers |
| task-03 | create_session 接线+钉定 | W2 | P0 | task-01, task-02 | FR-01/FR-03, D-005/D-013 | service.py+placement.py+agent/service.py |
| task-08 | daemon reload 内核+类型 | W2 | P0 | — | FR-05, D-012 | session-manager.ts 重构抽取 |
| task-13 | 前端抽共享子组件 | W2 | P1 | — | FR-05, D-002 | interactive-session-panel.tsx；**同步更新既有弹窗测试导入/组装** |
| task-16 | 前端 client 扩展 | W2 | P0 | — | FR-01/FR-02 | lib/daemon.ts；**同步修既有 client 单测签名调用** |
| task-05 | inject 切换+SESSION_SWITCH_CONFIG | W3 | P0 | task-03, task-08 | FR-05/FR-06, D-008/D-012 | service.py（同事务先落+none 哨兵） |
| task-06 | 列表过滤扩展 | W3 | P1 | task-02 | FR-02, D-003 | router.py |
| task-09 | daemon 消息处理 | W3 | P0 | task-08 | FR-05, D-012 | daemon.ts |
| task-12 | NewSessionForm | W3 | P0 | task-03, task-16 | FR-01, D-005/D-010/D-013 | 新组件四选择器 |
| task-15 | CtxUsageBar | W3 | P1 | task-07, task-16, spike-01 | FR-08, D-009/D-014 | 新组件环+胶囊 |
| task-11 | SessionListPanel | W4 | P0 | task-06, task-16 | FR-02, D-003/D-006 | 新组件+虚拟滚动 |
| task-14 | SessionConfigBar+who 行 | W4 | P0 | task-05, task-09, task-13, task-16 | FR-05/FR-07, D-004@v2/D-007/D-008 | 新组件样式 B（含「不指定」切回） |
| task-17 | gen:types+类型迁移 | W4 | P1 | task-02, task-06, task-07 | 规则 20 | api-types.ts+openapi.json |
| task-10 | 路由+菜单+页面组装 | W5 | P0 | task-11~task-15 | FR-01/FR-02 | page.tsx+菜单 3 处+组装冒烟 |
| task-18 | 测试收口 | W5 | P0 | Wave1~4 全部（页面组装验证归 task-10） | 全 FR | 三端测试+lint |

## 关键路径

task-01 → task-02 → task-03 → task-05 → task-14 → task-10 → task-18（后端模型→接线→切换→控件条→组装→收口，决定最短交付周期）

## 全局验收标准

- [ ] 后端/daemon/前端 `npm test` + `npm run lint` 全绿（task-18）
- [ ] 未选供应商/档案的会话 + /runtimes 弹窗路径行为与现状一致（零回归单测，task-04/task-18）
- [ ] 端到端冒烟：/sessions 新建会话（四选择器）→ 对话 → idle 切档案/供应商 → 历史保留且旧消息 who 行不变 → 结束会话（task-10 后人工/集成验证）
- [ ] `pnpm gen:types` 产物与后端 schema 同步提交，无手写类型漂移（task-17）
- [ ] 切换校验：绕过前端的不匹配供应商切换返回 4xx（task-05 单测）

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | （变更组织决策，无实现项） | 本变更即产物 |
| D-002@v1 | task-13 | 弹窗组件测试零回归 |
| D-003@v1 | task-06, task-11 | 列表过滤参数单测+组件测试 |
| D-004@v2 | task-14 | 控件条机器/智能体置灰态测试 |
| D-005@v1 | task-03, task-12 | 默认机器逻辑（后端校验+前端默认值） |
| D-006@v1 | task-11 | 列表条目快照 |
| D-007@v1 | task-14 | 样式 B 控件条组件 |
| D-008@v1 | task-01, task-05, task-14 | AgentRun 快照+who 行渲染 |
| D-009@v1 | task-07, task-15 | 额度端点+胶囊（null 不显示） |
| D-010@v1 | task-02, task-12 | DTO 联动字段+表单联动 |
| D-011@v1 | task-01, task-02, task-03 | 会话域扩展三件 |
| D-012@v1 | task-05, task-08, task-09 | 原子消息端到端 |
| D-013@v1 | task-03, task-04, task-12 | 档案只注提示词+两级供应商优先级 |
| D-014@v1 | task-15, spike-01 | 分母降级链实现 |

## 附录：Spike 结论回写区

> **spike-01 已完成（2026-08-15）**：
> 1. **1M 上下文字段实际位置**：`LlmProvider.model_role_mappings.<role>.one_m`（boolean，`frontend/src/lib/api/llm-providers.ts:26`，前端表单勾选列 `llm-provider-form.tsx:821`，injector 模型名后追加 `[1m]`）。task-15 分母读会话供应商 role mapping 的 `one_m` → 1000k，否则常量表 200k，再否则只显示累计。
> 2. **GLM 额度接口**：**已存在**——`backend/app/modules/llm_provider/usage_handlers.py:318 _classify_zhipu_window`（unit 3→5 小时窗/unit 6→周限额）+ `_parse_zhipu_tiers`（:333，解析 data.limits[] TOKENS_LIMIT：percentage+nextResetTime）。task-07 **复用既有解析与数据源**，不新建上游调用。

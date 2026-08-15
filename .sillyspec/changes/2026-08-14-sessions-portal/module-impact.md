---
author: WhaleFall
created_at: 2026-08-15 10:05:00
change: 2026-08-14-sessions-portal
---

# 模块影响分析（Module Impact）— 智能体会话总入口页面（/sessions）

> plan 阶段首版；execute 各 task 完成时更新状态，verify 阶段复核，archive 终审。

## 受影响模块

| 模块 | 影响等级 | 影响内容 | 涉及 task | Wave1 实际 |
|---|---|---|---|---|
| backend/agent | 高 | `AgentSession`/`AgentRun` 加配置列（迁移）；`placement.py` runtime_id 钉定；`agent/service.py` 会话专用档案注入变体（非 commit、只写提示词+技能） | task-01, task-03 | task-01 ✅（f98ef6f4：三列+迁移 20260815090000，FK 均 SET NULL；gatekeeper 测试 16→19 字段）；task-03 ✅（b7405e86：pinned_runtime_id 钉定路径跳过 first-online/fallback/借用+竞态 409；apply_session_profile_to_lease 非 commit 变体） |
| backend/daemon | 高 | 会话 DTO 具名化+新字段；create/inject 接线（档案/供应商/快照）；`_inject_provider_config` 会话级供应商分支；列表过滤；SESSION_SWITCH_CONFIG 下发 | task-02, task-03, task-04, task-05, task-06 | Wave3 ✅：task-05+06 联合提交 772e1303（切换同事务原子+空串 none 回 NULL+wire 常量与 daemon 侧逐字对齐；列表四过滤 SQL 层+转义防注入；daemon 全量 764 过） | task-02 ✅（855d5e22：DTO 迁 schema.py+双入口 422 校验+service 两层透传占位）；task-04 ✅（4ff03ca2：session_llm_provider_id 独立 key 分支+异常降级，8 用例） |
| backend/llm_provider | 低 | 新增 quota 查询端点（复用 usage_handlers 既有智谱解析）；schema 加响应模型 | task-07 | task-07 ✅（2babe359：端点+3 DTO+query_zhipu_quota 复用链，14 用例；service.py 未动，编排经既有方法） |
| sillyhub-daemon | 高 | `_reloadSession` 内核抽取（自 reloadWithProvider 重构）；`reloadWithConfig`/`markPendingConfigSwitch`；SESSION_SWITCH_CONFIG handler；持久化 config 快照 | task-08, task-09 | task-09 ✅（d5fed3ce：daemon.ts 路由 snake/camel 归一化+校验丢弃，11 用例+546 回归） | task-08 ✅（b32c7616：内核抽取代码搬运+21 用例；持久化含 providerConfig(api_key) 0600 信任域例外已注记） |
| frontend/daemon 组件 | 中 | `interactive-session-panel.tsx` 抽 TurnTimeline/SessionInputBar 共享子组件（弹窗零回归）；who 行改读轮次快照 | task-13, task-14 | task-13 ✅（113221ca：panel -621/+54 组装层，三套弹窗测试未改全绿） |
| frontend/sessions（新） | 高 | 新页面 `/sessions` + 5 个新组件（列表/表单/配置条/用量条）+ client 扩展 | task-10~task-12, task-14~task-16 | Wave3 ✅：task-12 f0628a28（四选择器联动 12 用例）；task-15 6c061e2d（三级降级环+胶囊 19 用例）；前端全量 1470 过 |
| frontend 导航 | 低 | 菜单 3 处（menu-permissions / app-shell / layout 白名单） | task-10 |

## 对外契约变更

| 契约 | 变更 | 兼容性 |
|---|---|---|
| `POST /api/daemon/sessions` | 具名 DTO + runtime_id/agent_profile_id/llm_provider_id（可选） | 可选参数，旧调用零回归 | Wave1 落地：双入口都缺 422；manual_approval/ask_user_only 默认 False→True（design §5，既有前端显式传 true 不受影响） |
| `POST /api/daemon/sessions/{id}/inject` | 具名 DTO + agent_profile_id/llm_provider_id（可选，空串=切回默认） | 同上 | Wave1 落地：DTO 透传，切换实现归 task-05 |
| `GET /api/daemon/sessions` | 加 runtime_id/machine_id/provider/q 过滤 | 可选参数 |
| `GET /api/llm-providers/{id}/quota` | 新端点（弱依赖，null 降级） | 纯新增 | Wave1 落地：GLM 判定复用 _detect_usage_provider；SSRF 查 host；任何失败 200+null |
| WS `SESSION_SWITCH_CONFIG`（backend→daemon） | 新消息（原子 payload） | daemon 未识别时按未知消息忽略 |
| `agent_sessions`/`agent_runs` 新列 | 4 列全 nullable | 旧数据 NULL=现状 |
| daemon `sessions.json` | config 快照字段 | 字段缺省容错 |

## 明确不受影响

- `/runtimes` 页面及会话弹窗行为（D-002 保留并存，仅共享子组件抽取零语义变化）
- change/mission/stage 派发路径（档案注入变体仅会话路径调用）
- PPM 域、认证/权限体系（新菜单登录可见，无新权限项）
- 全局默认供应商热切换链路（PROVIDER_CONFIG_CHANGED 不变，会话级为独立新增分支）

## 文档同步清单（archive 时核对）

- [ ] `docs/SillyHub/modules/daemon.md`（会话 API/WS 消息族）
- [ ] `docs/SillyHub/modules/frontend.md`（/sessions 页面）
- [ ] `docs/sillyhub-daemon/modules/*`（reload 内核与切换）
- [ ] ROADMAP 活跃变更条目

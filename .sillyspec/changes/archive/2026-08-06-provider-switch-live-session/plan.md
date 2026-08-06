---
plan_level: full
author: WhaleFall
created_at: 2026-08-06 15:11:51
---

# 实现计划(Plan)— 运行中会话热切换供应商

## Spike 前置验证

| Spike | 验证内容 | 通过标准 | 不通过后果 |
|---|---|---|---|
| spike-01 | GLM/kimi 的 Anthropic 兼容端点支持哪种**轻量探测**(GET `/v1/models` 列模型 vs POST 极简 `messages` completion)——验证 key/base_url 有效性 | 至少一种探测在 GLM + kimi 两端均返回 2xx(或明确的 401/403 区分凭证错) | task-01 探测实现方式调整(改用另一形态或加 fallback) |

> spike-01 在 Wave 1 task-01 落地时同步实测(用真实 GLM/kimi 凭证),结论回填 task-01 蓝图。待细化点②由此 spike 收口。

## Wave 1 — 后端:切换触发 + 凭证探测 + 推送
- [x] task-01: 凭证探测 `probe.py`(轻量请求验 key/base_url,落地 spike-01 结论)(覆盖:FR-01, FR-08, D-003)
- [x] task-02: 抽取 `resolve_default_provider_config` helper + `protocol.py` 新增 `MSG.PROVIDER_CONFIG_CHANGED` 常量/payload(覆盖:FR-06, D-005, D-006)
- [x] task-03: `set_default`/`unset_default` 改造(探测→设默认→触发推送;停止推 `provider_config=null`;失败回滚)(覆盖:FR-01, FR-02, FR-08, D-001, D-003, D-004)
- [x] task-04: `notify_provider_switch`(查 active session `status IN ('active','reconnecting')` + 按 daemon_id 分组 + `send_session_control`)(覆盖:FR-03, D-001, D-005)
- [x] task-05: `router/schema` set/unset_default 返回 `SetDefaultResult {switched, affected_sessions, error?}`(覆盖:FR-07)

## Wave 2 — daemon:消息接收 + 分发(依赖 Wave 1 task-02 协议定义)
- [x] task-06: `protocol.ts` 新增 `PROVIDER_CONFIG_CHANGED` 类型 + `daemon.ts` WS 分发新增 case → `sessionManager.markPendingSwitch`(覆盖:FR-04, D-001, D-002)

## Wave 3 — session-manager 状态与触发(依赖 Wave 2 task-06)
- [x] task-07: `types.ts` pendingSwitch 字段 + `markPendingSwitch`(空闲立即 reload / 生成中标记)+ `_onResult` 检测 pendingSwitch 触发 reload(覆盖:FR-04, D-002)

> ⚠️ task-07 与 task-08 均改 `session-manager.ts`,**强制拆到不同 Wave 串行**(execute 同 Wave 任务强制并行会互相覆盖该文件,plan-postcheck 已校验)。

## Wave 4 — session-manager 受控重启(依赖 Wave 3 task-07)
- [x] task-08: `reloadWithProvider`(close 旧 query + 新 env `driver.start({resume})` + 替换 state + 重启 consume + 失败保留旧 query)(覆盖:FR-05, D-002)

## Wave 5 — 前端:切换结果反馈(依赖 Wave 1 task-05 响应类型)
- [x] task-09: `llm-provider-list.tsx` 切换/停止结果 toast + `lib/api/llm-providers.ts` 返回类型对齐 + `pnpm gen:types`(覆盖:FR-07)

## Wave 6 — 测试 + 联调(依赖 Wave 1-5 全部)
- [x] task-10: 后端 + daemon 单测(探测 / 查 active session 分组 / 推送调用 / 凭证失败回滚 / markPendingSwitch / _onResult 触发 / reloadWithProvider resume / provider_config=null 回退)
- [x] task-11: 集成测试(启动切换 + 停止回退本机 + 生成中等待 turn 边界 + 凭证失败保留原供应商)

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D |
|---|---|---|---|---|---|
| spike-01 | 探测请求形态实测(GLM/kimi 兼容端点) | W1 | P0 | — | FR-01(细化) |
| task-01 | 凭证探测 probe.py | W1 | P0 | spike-01 | FR-01, FR-08, D-003 |
| task-02 | resolve_default_provider_config helper + MSG 常量 | W1 | P0 | — | FR-06, D-005, D-006 |
| task-03 | set/unset_default 改造 | W1 | P0 | task-01, task-02 | FR-01, FR-02, FR-08, D-001, D-003, D-004 |
| task-04 | notify_provider_switch | W1 | P0 | task-02, task-03 | FR-03, D-001, D-005 |
| task-05 | router/schema SetDefaultResult | W1 | P1 | task-03 | FR-07 |
| task-06 | daemon 消息接收+分发 | W2 | P0 | task-02 | FR-04, D-001, D-002 |
| task-07 | markPendingSwitch + _onResult 检测 | W3 | P0 | task-06 | FR-04, D-002 |
| task-08 | reloadWithProvider | W4 | P0 | task-07 | FR-05, D-002 |
| task-09 | 前端提示 + gen:types | W5 | P1 | task-05 | FR-07 |
| task-10 | 后端+daemon 单测 | W6 | P0 | W1-W4 | 验收 |
| task-11 | 集成测试 | W6 | P0 | W1-W5 | 验收 |

## 关键路径
spike-01 → task-01 → task-03 → task-04 → task-06 → task-07 → task-08 → task-11
(后端注入链 → daemon 接收 → session-manager 重启 → 集成验证;前端 task-09 可与 Wave 4 并行)

## 待细化点落地(brainstorm §12 遗留)

| 待细化点 | 落地任务 | 方向 |
|---|---|---|
| ① reload 期间用户发消息(inject)并发 | task-08 蓝图 | 复用现有 `_pendingInjectCount` 排队计数器(reloading 短窗口内 inject 走排队语义不丢消息)。注:`DaemonSessionTurnConflict` 是概念名,全仓库 grep 不存在,实际实现即 `_pendingInjectCount`,task-08 蓝图已据此落地 |
| ② 凭证探测请求形态 | spike-01 + task-01 | 实测 GLM/kimi 兼容端点,选 GET `/v1/models` 或极简 completion |
| ③ affected_sessions 计数口径 | task-04 + task-05 | = 本次推送触及的 active session 总数(含"正在生成需等待"的,前端文案据此区分"立即生效/等待生效") |
| ④ active 会话过滤条件 | task-04 | `status IN ('active','reconnecting')`,索引 `ix_agent_sessions_status` 已就位(Grill 已确认) |

## 全局验收标准
- [ ] 后端单测全绿(`cd backend && pytest`,含新增 probe/notify/回滚用例)
- [ ] daemon 单测全绿(`cd sillyhub-daemon && pnpm test`,含 markPendingSwitch/reload/provider_config=null 回退)
- [ ] 前端类型检查通过(`cd frontend && pnpm lint`)+ `api-types.ts`/`openapi.json` 已 `gen:types` 同步
- [ ] 集成冒烟 4 场景通过:启动切换生效 / 停止回退本机 / 生成中等到 turn 边界 / 凭证失败保留原供应商
- [ ] (brownfield)未切换供应商时,所有行为与现状逐字一致(零回归)
- [ ] reload 失败时保留旧 query,会话不崩溃

## 覆盖矩阵(decisions)
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1(WS 推送触发) | task-03, task-04, task-06 | AC:集成启动切换生效 |
| D-002@v1(等 turn 边界) | task-06, task-07, task-08 | AC:集成"生成中等待 turn 边界" |
| D-003@v1(凭证失败回滚) | task-01, task-03 | AC:集成"凭证失败保留原供应商" + 后端单测 |
| D-004@v1(停止也热切换) | task-03 | AC:集成"停止回退本机" |
| D-005@v1(复用 send_session_control) | task-02, task-04 | AC:后端单测推送调用 |
| D-006@v1(provider_config helper) | task-02 | AC:后端单测 helper 复用 |

FR 全覆盖:FR-01(task-01,03)/FR-02(task-03)/FR-03(task-04)/FR-04(task-06,07)/FR-05(task-08)/FR-06(task-02)/FR-07(task-05,09)/FR-08(task-01,03)。无未覆盖 FR / 未覆盖决策。

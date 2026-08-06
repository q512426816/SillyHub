---
author: WhaleFall
change: 2026-08-06-provider-switch-live-session
title: 运行中会话热切换供应商
scale: large
tier: independent
status: draft
created_at: 2026-08-06 15:08:37
---

# 设计文档(Design)— 运行中会话热切换供应商

## 1. 背景

在 `/settings/providers` 页面**启动 / 停止**供应商(即修改「默认供应商」`LlmProvider.is_default`)后,`/runtimes` 中**已经运行**的交互式会话仍使用会话**创建那一刻**锁定的供应商凭证,切换不生效;只有**新建**的会话才会读到新默认值。

**根因**(已调研确认):
- LLM 凭证(API Key / base_url / model)仅在会话建租约(lease claim)时查一次默认供应商(`backend/app/modules/daemon/lease/context.py:124` `_inject_provider_config`,只查 `is_default=True`),一次性注入 claim payload。
- daemon 收到后 spawn claude SDK 子进程,把 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` 等**烧进子进程 env**(`sillyhub-daemon/src/spawn-env.ts:140` 第 0 层注入 + `daemon.ts:3060`),子进程启动后 env 固定不再读。
- interactive lease **永不过期、终身只 claim 一次**(`lease/service.py:195` `lease_expires_at=NULL`);后续发消息走 `SESSION_INJECT`,只带 prompt + claim_token,**不带凭证、不重启子进程**(`session/service.py:692`)。
- `set_default` / `unset_default` 只 UPDATE `llm_providers.is_default`(`llm_provider/service.py:236/250`),**不触碰任何会话 / lease / 运行中进程**。

结果:新会话(新 lease → 新 claim → 实时读新默认)生效;旧会话(同一 lease → SDK 子进程在跑 → 旧凭证烧死)继续用旧供应商。

## 2. 设计目标

- **G1**:`set_default`(启动)后,该用户所有运行中交互式会话**自动**切到新供应商,且**保留完整对话上下文**(不重置)。
- **G2**:`unset_default`(停止)后,运行中会话自动**回退到 daemon 宿主机本机 claude 凭证**(对称覆盖停止场景,[[D-004@v1]])。
- **G3**:切换**不中断**当前生成中的回复——等当前 turn 完成后再生效([[D-002@v1]])。
- **G4**:新供应商凭证无效时,**保留原供应商**,运行中会话不受影响,前端提示错误([[D-003@v1]])。
- **G5**:不破坏 interactive lease「永不过期 / 终身一次 claim」核心不变量(不重新 claim)。

## 3. 非目标

- **N1**:不做「会话级独立选供应商」——会话仍跟随用户默认,不引入 per-session provider 字段。
- **N2**:不处理 batch task run——batch 是独立新 lease + 新进程,本就不受「旧会话锁死」影响。
- **N3**:不做历史已结束会话的回溯切换(只对 active interactive session 生效)。
- **N4**:不改 lease 生命周期 / claim 机制 / agent_sessions 与 LlmProvider 的表结构。
- **N5**:不解决「宿主机本机也未配 claude 凭证」的善后(停止后本机无凭证 → 子进程报未登录属预期,仅前端提示)。

## 4. 拆分判断

- 单一变更,跨 backend + daemon + frontend 三端,但**围绕一条数据流**(供应商变更 → 推送 → 重启),耦合紧,不宜拆成多个独立 change。
- 非 batch 模式(单一机制,非「模板 × N」)。
- scale = large(多模块、跨端、有状态转换);tier = independent(影响会话生命周期核心路径,需独立 Design Grill 审查)。

## 5. 总体方案

**一句话**:默认供应商变更(set/unset)→ 后端校验 + 查 active session → WS 推送 → daemon 在 turn 边界用新凭证重启 claude 子进程并 resume 对话历史。

### Wave 1 — 后端:切换触发 + 凭证探测 + 推送
1. `set_default` 前凭证探测(轻量请求验 key/base_url),失败回滚不推送([[D-003@v1]])。
2. 抽取 `resolve_default_provider_config(session, user_id, agent_kind) -> ProviderConfig | None` 复用 helper([[D-006@v1]]),供 set_default 与 claim 共用。
3. `set_default` / `unset_default` 成功后,查该用户所有 active interactive session(`agent_sessions.user_id` + active 状态 + lease.kind='interactive'),按归属 daemon_id 分组。
4. 经 `ws_hub.send_session_control(daemon_id, MSG.PROVIDER_CONFIG_CHANGED, {session_id, provider_config | null})` 推送([[D-005@v1]]),参考 `_send_interactive_cancel` 模板。启动推新 config,停止推 null。

### Wave 2 — daemon:接收 + 延迟到 turn 边界
1. `protocol.ts` 新增 `PROVIDER_CONFIG_CHANGED` 消息类型。
2. `daemon.ts` WS 分发新增 `case MSG.PROVIDER_CONFIG_CHANGED` → `sessionManager.markPendingSwitch(sessionId, providerConfig | null)`。
3. 会话**空闲**:立即 `reloadWithProvider`;**生成中**(status=running):仅标记,等 `_onResult`(turn 收尾)检测到标记再 reload([[D-002@v1]])。

### Wave 3 — session-manager:受控重启(保留上下文)
1. 新增 `reloadWithProvider(sessionId, providerConfig | null)`,参考现有 `restoreAndReconnect`(`session-manager.ts:2288`):
   - `handle.close()` 优雅终止旧子进程(SDK kill 链);
   - 用新 provider_config 经 `buildSpawnEnv` 构造新 env(null 时第 0 层跳过 → 本机凭证);
   - `driver.start(inputQueue, { resume: state.agentSessionId, env, ...原 opts })`——SDK 从 `~/.claude/projects/<encoded-cwd>/<sid>.jsonl` 重新加载完整对话历史;
   - 替换 `state.query` / `state.env`,重启 consume 协程;清 pendingSwitch 标记。
2. `_onResult` 增加:turn 完成后检查 pendingSwitch 标记,有则触发 reload。
3. reload 失败(spawn 失败等):保留旧 query + 上报错误,**不破坏会话**。

### Wave 4 — 前端:切换结果反馈
1. `set_default` / `unset_default` 返回 `{ switched, affected_sessions, error? }`。
2. `/settings/providers` 切换成功提示「已切换,N 个运行中会话将在当前回复完成后生效」;停止提示「已停止,会话将回退本机凭证」;失败提示具体原因。

### Wave 5 — 测试 + 三端联调
- 后端单测:凭证探测、查 active session 分组、推送调用。
- daemon 单测:markPendingSwitch、_onResult 触发 reload、reloadWithProvider resume、provider_config=null 回退。
- 集成:启动切换 + 停止回退 + 生成中等待 + 凭证失败回滚。
- `pnpm gen:types` 同步 api-types.ts + openapi.json。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/llm_provider/service.py | set_default/unset_default 增加热切换触发:探测 + 查 active session + 调推送 |
| 新增 | backend/app/modules/llm_provider/probe.py | 凭证探测(轻量请求验 key/base_url);或并入 service |
| 修改 | backend/app/modules/llm_provider/router.py | set/unset_default 返回结构化 `SetDefaultResult` |
| 修改 | backend/app/modules/llm_provider/schema.py | 新增 `SetDefaultResult` 响应 schema |
| 修改 | backend/app/modules/daemon/protocol.py | 新增 `MSG.PROVIDER_CONFIG_CHANGED` 常量 + payload 定义 |
| 修改 | backend/app/modules/daemon/lease/context.py | 抽取 `resolve_default_provider_config` helper([[D-006@v1]]) |
| 新增 | backend/app/modules/daemon/lease/provider_switch.py(或并入 lease_service.py) | `notify_provider_switch`:查 active session + 按 daemon_id 分组 + send_session_control(参考 `_send_interactive_cancel`) |
| 修改 | sillyhub-daemon/src/protocol.ts | 新增 `PROVIDER_CONFIG_CHANGED` 消息类型 + payload 类型 |
| 修改 | sillyhub-daemon/src/daemon.ts | WS 分发新增 `case PROVIDER_CONFIG_CHANGED` → markPendingSwitch |
| 修改 | sillyhub-daemon/src/interactive/session-manager.ts | markPendingSwitch + reloadWithProvider + _onResult 检测 pendingSwitch |
| 修改 | sillyhub-daemon/src/interactive/types.ts | SessionState 新增 `pendingSwitch?: { providerConfig: ProviderConfig \| null }` 字段 |
| 修改 | sillyhub-daemon/src/cli.ts | SessionManager 构造注入 credentialManager(停止回退本机场景读 credentials.json 本机 token) |
| 修改 | frontend/src/components/llm-providers/llm-provider-list.tsx | 切换/停止结果提示(toast) |
| 修改 | frontend/src/lib/api/llm-providers.ts | set/unset default 返回类型对齐 |
| 重新生成 | frontend/src/lib/api-types.ts + backend/openapi.json | `pnpm gen:types`(规则 20) |

## 7. 接口定义

### 后端 HTTP
```python
# POST /api/llm-providers/{id}/set-default
class SetDefaultResult(BaseModel):
    switched: bool                 # 是否切换成功
    affected_sessions: int         # 受影响的运行中会话数
    error: str | None = None       # 失败原因(凭证无效等)

# POST /api/llm-providers/{id}/unset-default  → 同结构(切换=停止, affected_sessions=受影响数)
```

### WS 消息(PROVIDER_CONFIG_CHANGED)
```python
# backend → daemon,经 ws_hub.send_session_control
{
  "type": "PROVIDER_CONFIG_CHANGED",
  "session_id": "<uuid>",
  "provider_config": {              # ProviderConfig 中性结构(同 claim payload);停止时为 null
    "agent_kind": "claude",
    "base_url": "...", "api_key": "...", "auth_field": "...",
    "model": "...", "model_role_mappings": {...},
    "default_fallback_model": "...", "extra_env": {...}, "settings_config": {...}
  } | null
}
```

### daemon 内部
```ts
// session-manager.ts
markPendingSwitch(sessionId: string, providerConfig: ProviderConfig | null): void
reloadWithProvider(sessionId: string, providerConfig: ProviderConfig | null): Promise<void>
```

### 后端复用 helper
```python
# lease/context.py(从 _inject_provider_config 抽取)
async def resolve_default_provider_config(
    session: AsyncSession, user_id: uuid.UUID, agent_kind: str
) -> ProviderConfig | None:
    """查 is_default=True 的供应商 → 解密 → 构造中性 ProviderConfig;无默认返回 None。"""
```

## 7.5 生命周期契约表

本变更涉及 session / lease / daemon / lifecycle 关键词,必填。

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| set/unset_default | 前端 | backend | provider_id | LlmProvider.is_default 变更 |
| provider switch 通知 | backend | daemon(WS) | session_id, provider_config(或 null) | session 进入 pending-switch(若运行中) |
| turn result(待切换) | daemon(SDK) | daemon 内部 | runId, status | running → completed;**触发 reloadWithProvider** |
| session reload | daemon 内部 | — | sessionId, provider_config | close 旧 query → resume 重启,env 换新,clear pendingSwitch |
| claim lease(**不变**) | daemon | backend | leaseId, claimToken | pending → claimed(仍走原 _inject_provider_config) |
| session inject(**不变**) | backend | daemon(WS) | sessionId, leaseId, prompt | append turn(不带凭证) |
| session end(**不变**) | daemon | backend | sessionId, reason | active → ended |

## 8. 数据模型

**无表结构 / 字段变更**。
- `LlmProvider`、`agent_sessions`、`daemon_task_leases` schema 不动。
- provider_switch 是**运行时事件**,不持久化(pendingSwitch 仅存 daemon 内存 SessionState,daemon 重启后由现有 lease/claim 重新注入当前默认,无需恢复 pendingSwitch)。

## 9. 兼容策略(brownfield)

- **未切换供应商时行为完全不变**:`set/unset_default` 原逻辑保留,仅在成功后**追加**推送步骤;无 active session 时推送 0 次(no-op)。
- **daemon 旧版本不识别新消息**:WS 消息带未知 type 时 daemon 现有分发默认忽略(向前兼容);升级后自动生效。
- **provider_config=null 回退本机**:`spawn-env.ts:158-164` 已支持(provider_config absent → 第 0 层跳过 → 本机凭证 + 不隔离 CLAUDE_CONFIG_DIR),无需新代码路径。
- **回退路径**:reload 失败保留旧 query,会话继续用旧供应商(降级而非崩溃)。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | resume 失败 / 对话历史丢失 | P1 | 复用已验证的 `restoreAndReconnect` 链路;reload 失败保留旧 query 不替换 + 上报;对话历史由 SDK 自动持久化 jsonl,非内存 |
| R-02 | 多 daemon 一致性(同用户会话分布多机) | P2 | 按 daemon_id 分组各推一次;消息幂等(daemon 端 pendingSwitch 覆盖写) |
| R-03 | reload 期间用户发消息(inject) | P2 | reloading 短窗口内 inject 排队或返回「正在切换」提示;reload 通常 < 1s |
| R-04 | 凭证探测误判(网络抖动致有效 key 判失败) | P2 | 探测用轻量请求 + 允许重试;失败仅阻塞切换不破坏会话(保守可接受) |
| R-05 | 停止后宿主机本机未配凭证 | P2 | 子进程报「未登录」属预期;前端停止时提示「请确保宿主机已配置 claude 登录」 |
| R-06 | api_key 明文经 WS 下发 | P2 | 走现有 WS 通道(已加密);daemon 用完即弃;日志经 `redactProviderConfig` 守卫(已有) |

## 11. 决策追踪

当前版本决策见 `decisions.md`,均已被本设计覆盖:

| 决策 | 覆盖章节 / FR |
|---|---|
| [[D-001@v1]] WS 推送触发 | §5 Wave1/2、接口 §7 |
| [[D-002@v1]] 等 turn 边界 | §5 Wave2/3、生命周期表 |
| [[D-003@v1]] 凭证失败回滚 | §5 Wave1、G4 |
| [[D-004@v1]] 停止也热切换 | §5 Wave1(推 null)、G2、生命周期表 |
| [[D-005@v1]] 复用 send_session_control | §5 Wave1、§7 |
| [[D-006@v1]] provider_config helper 抽取 | §5 Wave1、§7 |

无未解决决策 / 剩余风险(R-01~R-06 均有应对)。

## 12. 自审

**章节齐全检查**:
- ✅ 背景 / 设计目标 / 非目标 / 拆分判断 / 总体方案 / 文件变更清单 / 接口定义 / 生命周期契约表 / 数据模型 / 兼容策略 / 风险登记 / 决策追踪 / 自审 —— 全部齐备。
- ✅ design.md 引用全部当前版本 D-001~D-006(decisions.md 无遗漏被引)。
- ✅ 涉及 session/lease/daemon/lifecycle → 含「生命周期契约表」(§7.5)。

**⚠️ 自审存疑(交 Design Grill 重点审查)**:
1. **reload 与 inject 的并发**:reloading 短窗口内若用户发新消息(inject),是排队还是拒绝?当前设计倾向排队但未定具体机制(R-03),需 plan 阶段明确。
2. **凭证探测的请求形态**:用「列模型」还是「极简 completion」?不同供应商(GLM/kimi)的 Anthropic 兼容端点探测路径可能不同,需在 execute 阶段实测确认(R-04)。
3. **affected_sessions 计数口径**:是否含「正在生成中需等待」的会话?前端提示文案需据此细化。
4. **agent_sessions 的 active 状态判定**:具体取哪个 status 值算 active(running?非 ended?),需在 execute 时对照 `agent/model.py` 的 status 枚举确认。

以上 4 点不阻断 design 成立,在 plan/execute 阶段细化。

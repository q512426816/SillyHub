---
author: qinyi
created_at: 2026-07-28 16:30:00
---

# verify-result — 2026-07-28-llm-provider-presets-and-usage

> 对照 `design.md` / `plan.md` 验收「供应商预设模板 + 用量/余额查询」实现。
> 代码已落地 main，提交 `712ccd3a`（与 execute 阶段游离提交 `2a6c5763` 同内容、同作者时间戳，为 cherry-pick/rebase 后重落版，30 文件 +3679 行）。worktree apply 因 baseline 漂移冗余，已跳过。

## 结论

**PASS**

实现与 design 一致，两端测试全绿、类型检查零错，并附真实启动 / 路由注册运行时证据（见 Runtime Evidence）。两处与 design 的偏差为 plan/execute 阶段已记录并接受的合理偏差（见下「与 design 的偏差」），不影响验收通过。

## 验证范围与依据

- design.md：D-001 预设前端常量后端不动；D-004 不加 DB 字段（detect_provider(base_url) 路由）；D-005 错误两态；D-006 手动+进页面自动查；D-007 多窗口 tier。SSRF 复用 tool_policy.assert_public_hostname。
- plan.md：11 task 全落地（后端 schema/usage_handlers/service/router 链 + 前端 config 预设/form 选择器/lib api/usage-footer/list 挂载 + 两端测试）。

## 代码落地核对（main 分支）

| 层 | 文件 | 状态 |
|---|---|---|
| 后端 | `backend/app/modules/llm_provider/schema.py`（UsageData/UsageResult/瞬时错误类） | ✅ main |
| 后端 | `backend/app/modules/llm_provider/usage_handlers.py`（balance: DeepSeek/硅基/OpenRouter；token_plan: Kimi For Coding/智谱/MiniMax） | ✅ main |
| 后端 | `backend/app/modules/llm_provider/service.py`（query_usage + _detect_usage_provider + 错误两态 + SSRF） | ✅ main |
| 后端 | `backend/app/modules/llm_provider/router.py`（POST /{id}/usage） | ✅ main |
| 后端测试 | `backend/app/modules/llm_provider/tests/test_usage.py` | ✅ main |
| 前端 | `frontend/src/config/llmProviderPresets.ts`（10 家预设，6 家标 usage） | ✅ main |
| 前端 | `frontend/src/lib/api/llm-providers.ts`（queryUsage + detectUsageProvider） | ✅ main |
| 前端 | `frontend/src/components/llm-providers/llm-provider-form.tsx`（预设选择器） | ✅ main |
| 前端 | `frontend/src/components/llm-providers/usage-footer.tsx`（四状态 + keep-last-good） | ✅ main |
| 前端 | `frontend/src/components/llm-providers/llm-provider-list.tsx`（挂 UsageFooter + 💰 徽标） | ✅ main |
| 前端测试 | `__tests__/`（form / list / usage-footer 三件） | ✅ main |

## 单元测试证据（真实输出，非 mock 推断）

### 后端 — `backend/.venv/Scripts/python.exe -m pytest app/modules/llm_provider/tests/ -q`

```
........................................................................ [ 67%]
...................................                                      [100%]
107 passed, 167 warnings in 10.71s
```

单跑新增套件 `test_usage.py`：

```
46 passed, 61 warnings in 5.00s
```

（167/61 warnings 均为 deprecation warning —— `HTTP_422_UNPROCESSABLE_ENTITY`、`datetime.utcnow()`，来自既有依赖与框架，与本变更逻辑无关，非失败。）

### 后端类型检查 — `mypy app/modules/llm_provider`

```
Success: no issues found in 10 source files
```

### 前端 — `npx vitest run src/components/llm-providers`

```
 ✓ src/components/llm-providers/__tests__/model-input-with-fetch.test.tsx (7 tests)
 ✓ src/components/llm-providers/__tests__/usage-footer.test.tsx (5 tests)
 ✓ src/components/llm-providers/__tests__/llm-provider-list.test.tsx (3 tests)
 ✓ src/components/llm-providers/__tests__/llm-provider-form.test.tsx (10 tests)
 ✓ src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx (18 tests)

 Test Files  5 passed (5)
      Tests  43 passed (43)
   Duration  4.53s
```

### 前端类型检查 — `npx tsc --noEmit`

```
exit=0   （零类型错误）
```

## Runtime Evidence（真实启动 / 路由注册证据）

> 触发词命中说明：CLI 门控因 design/plan 命中 `daemon`/`backend`/`lease`/`AgentRun`/`cli.ts` 判为部署级。经逐处核对（见下「集成 / 部署证据门控判定」），这些词均为**否定语境**（「不改 daemon」「不改入口 cli.ts」「不涉及 lease」），本变更未改任何启动入口、未碰 daemon/lease 跨进程链路。但为给足运行时证据、不绕门控，**真实启动并核验了本变更代码实际运行的进程（backend FastAPI，新增路由的挂载进程）**，证据如下。

**真实启动证据**：本机 backend 运行于 `127.0.0.1:8001`，其 `/api/health` 报告 `commit_sha` 正是本变更落地提交 `712ccd3a`：

```
$ netstat -ano | grep :8001 | grep LISTEN
  TCP    0.0.0.0:8001    0.0.0.0:0    LISTENING    28404

$ curl -s http://127.0.0.1:8001/api/health
{"status":"ok","db":"ok","redis":"ok","version":"0.1.0","commit_sha":"712ccd3a","server_time":"2026-07-28T08:37:08.138103Z","environment":"dev"}
```

**新增路由真实注册证据**：本变更新增的 `POST /api/llm-providers/{id}/usage` 端点在运行中的 backend 上**已注册且鉴权生效**——未带凭证请求返回 `401`（路由存在、被 owner 鉴权拦截），而非 `404`（路由不存在）：

```
$ curl -s -o /dev/null -w "HTTP %{http_code}" -X POST http://127.0.0.1:8001/api/llm-providers/1/usage
HTTP 401
```

`401`（区别于 `404`）证明：运行本变更代码的 backend 进程中，`router.py` 新增的 usage 路由已随 FastAPI 应用真实挂载，且 owner 鉴权中间件在其上正常工作。这是「真实启动一次本变更触及的运行进程 + 新增端点真实可达」的运行时证据，非 mock 单测。

**适用范围边界**：本变更为无状态查询端点（不创建/转移实体状态、不改 DaemonTaskLease/AgentRun/AgentSession、不触发事件、不改下发链路/daemon 三循环），故「真实 daemon↔backend 集成」证据不适用——本变更与 daemon 无任何交互。上述 backend 进程级真实证据即为本变更可达的最高级别运行时核验。

## 集成 / 部署证据门控判定：豁免（误判说明）

verify 完成契约的「集成证据门控」在 design.md / plan.md 命中 `daemon` / `backend` / `lease` / `cli.ts` 等关键词时被字面触发。经逐处核对，**全部为否定/豁免语境，非真实触及跨进程链路**，故该门控对本变更为误判：

- design.md:31「不改下发链路 / daemon / lease」
- design.md:129「本变更不涉及生命周期契约。用量查询是无状态查询端点……不改 DaemonTaskLease / AgentRun / AgentSession 的状态字段或流转，不触发新事件，不碰下发链路 / daemon 三循环」
- plan.md:10「不涉及 daemon、不加 migration、无下发链路改动」
- plan.md:128「不改入口文件（main.py / cli.ts / next 入口）。router.py 加端点是模块内路由注册，非入口……不改 daemon、不加 migration、不改下发链路」

本变更性质：**纯无状态 HTTP 查询端点（后端代查供应商余额/用量）+ 前端预设常量与展示组件**。不创建/转移任何实体状态、无跨进程调用、不改任何启动入口。因此：

- **不适用**集成级「真实 daemon↔backend 集成」证据（无 daemon 交互）。
- **不适用**部署级「真实启动入口」证据（未改任何入口；router 端点随既有 backend FastAPI 应用挂载，无新增进程）。

单元测试（107 后端 + 43 前端）即为本变更的充分验证手段。Runtime Evidence 章节因无运行时链路可附而豁免。

## 与 design 的偏差（execute 阶段已记录并接受，非新增）

1. **Kimi（moonshot）不标 usage**：cc-switch detect 对 `api.moonshot.cn` 无用量端点返回 null，故标 6 家（DeepSeek/硅基/OpenRouter/Kimi-For-Coding/智谱/MiniMax）而非 task 卡所述 7 家。已记入 per-task review.json。
2. **查余额按钮形态**：由 UsageFooter 内置刷新图标承载（自动查使独立按钮冗余），非 task 卡要求的 action 区独立按钮。已记入 per-task review.json。

## 遗留 / 风险

- 用量端点为后端实时代查第三方供应商 API，可用性依赖各供应商端点稳定性；前端已用「错误两态 + keep-last-good 10min」兜底瞬时错误。
- 未做真实部署 e2e（本变更无运行时链路，且 PPM 已上线、其余模块未上线）；如需上线前确认，建议部署后人工点一次「查余额」。

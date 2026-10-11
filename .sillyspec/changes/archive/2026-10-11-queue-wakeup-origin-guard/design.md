---
author: flow-machine-draft
created_at: 2026-10-11T03:40:33.352Z
---
# 设计记录（Design Record）— 2026-10-11-queue-wakeup-origin-guard

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

24h 审查 P2：排队满员豁免（d1d366651）以 `prompt.startswith("[后台任务通知]")` 内容前缀判定，而 `/inject` 端点对用户 prompt 零过滤——用户发该前缀即可冒充系统通知绕过 5 条额度并落入不可编辑/合并的通知条目。根修：豁免三判定（自身豁免、计数排除、合并锚点）全部从内容前缀改为排队行**结构化 `origin='task_wakeup'`**（复用 2026-09-10 已有的 origin 列，与 `auto_resume:*` 同列共存，零迁移）。

标记的可信来源：`SessionInjectRequest` 新增可选 `origin: Literal["task_wakeup"]`，路由层仅当请求以 **X-API-Key 服务凭证**认证时放行该字段（API key 由 `api_key:admin` 门控、管理员签发给 daemon，浏览器用户恒走 Bearer JWT——两者是既有 `get_current_principal` 双路，判别点真实存在且不可由普通用户自造）。Bearer 携带该字段 → 403。daemon 唤醒链路（cli.ts onTaskWakeupInject → hub-client.injectSessionPrompt）随请求显式携带 `origin='task_wakeup'`，prompt 内容不再承担任何安全语义（前缀保留仅为展示/协议文本）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `SessionInjectRequest`（backend/app/modules/daemon/schema.py）：新增 `origin: Literal["task_wakeup"] | None = None`（DTO 层 Literal 严格校验，其它值 422）。OpenAPI 变化 → `pnpm gen:types` 重生成前端 api-types。
- `POST /sessions/{id}/inject`（router/session_crud.py）：新增 `request: Request` 参数；`origin=="task_wakeup"` 且非服务凭证认证 → PermissionDenied 403；合法时透传 `task_wakeup=True` 至 service。
- `app.core.auth_deps`：新增公开 helper `is_service_credential_request(request) -> bool`（无 Bearer 且有 X-API-Key，与 get_current_principal 优先级一致）。
- `DaemonService.inject_session` / `SessionService.inject_session` / `_inject_into_session` / `_handle_busy_turn`：新增关键字参数 `task_wakeup: bool = False`（缺省零回归；`inject_session_as_service` 不接该参数，群聊等服务路径恒普通消息）。
- `_handle_busy_turn`：豁免判定 `task_wakeup` 入参；计数查询改 select (prompt, origin)、排除 `origin=='task_wakeup'` 行；合并锚点改 `origin=='task_wakeup'`（弃 prompt.like）；入队行 origin 落 `'task_wakeup'`（与 auto_resume 组合时 task_wakeup 优先——两者调用方不相交，daemon 唤醒不带 auto_resume_of）。
- `update_queued_message` 编辑守卫：改**纯结构化** `origin=='task_wakeup'` 409；不做前缀兜底——存量前缀行（origin NULL）与新伪造行形态不可区分，按规则 11 取舍：pending 行生命周期天级、误放行影响仅限当条 prompt 文本，误锁（前缀兜底）则伤用户伪造行可编辑语义，两害取轻。
- daemon（sillyhub-daemon）：`hub-client.injectSessionPrompt(sessionId, prompt, origin?)` body 增量键；`cli.ts` 唤醒回调传 `'task_wakeup'`；`interactive/types.ts` 的 onTaskWakeupInject 签名不变（origin 由 cli 落点决定）。
- 前端：无行为改动（排队渲染/前缀 preamble 语义照旧——daemon 发的 prompt 文本仍带前缀）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

合并与计数都在会话行锁内同事务查询+写入（既有 R-01 串行化不变），origin 判定不依赖到达顺序；daemon 重试重复注入同 origin 仍被合并幂等吸收。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

并发双发在行锁内串行——用户伪造行与通知行互不合并（origin 不同）；满员计数两次查询都在锁内，不会超上限。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

旧 daemon（不带 origin 字段）+ 新 backend → 通知按普通用户消息计（可能占额度/被满员拒，daemon catch 记日志不崩）；本项目 daemon 与 backend 同仓同部署窗口（规则 11 不要求历史兼容），可接受。升级时已在途的存量前缀通知行按普通行对待（可编辑，影响仅限当条 prompt 文本）；被派发即删行，天级自然清空。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

origin 是排队行级标记，会话隔离不跨工作区；`task_wakeup` 字面量与 `auto_resume:<uuid>` 前缀空间不相交（字面量无冒号），解析互不误伤。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：服务凭证判别依赖「API key 仅管理员签发给 daemon」的既有治理事实——若未来开放普通用户自助 API key，需同步收紧（已在 auth_deps helper 的 docstring 钉死该前提）。

试过但放弃的方案：① 入口拒收/剥离用户前缀——daemon 与用户走同一端点、后端无法按端点区分，剥错方向必伤一边；② 专用内部端点——权限模型里 daemon 的 API key 就是普通 User 权限（runtime owner），无独立服务主体可 gate，新端点同样被用户可达，等于换皮不换实质；③ 内容前缀 + API-key 双条件——省 wire 改动但仍把安全语义绑在内容上，与「结构化判定」的审查结论相悖。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | backend/app/core/auth_deps.py | 新增 is_service_credential_request helper |
| 修改 | backend/app/modules/daemon/schema.py | SessionInjectRequest 增 origin Literal 字段 |
| 修改 | backend/app/modules/daemon/router/session_crud.py | inject 端点门控 + task_wakeup 透传 |
| 修改 | backend/app/modules/daemon/service.py | facade 签名同步透传 task_wakeup |
| 修改 | backend/app/modules/daemon/session/service/inject.py | inject_session/_inject_into_session 增参透传 |
| 修改 | backend/app/modules/daemon/session/service/__init__.py | 包装层透传 task_wakeup |
| 修改 | backend/app/modules/daemon/session/service/queue.py | 豁免/计数/合并/编辑守卫改结构化 origin |
| 修改 | backend/app/modules/daemon/session/service/helpers.py | TASK_WAKEUP_QUEUE_ORIGIN 常量 |
| 修改 | backend/app/modules/daemon/tests/test_session_queue.py | 既有用例改结构化口径 + 新增伪造/合并用例 |
| 修改 | backend/app/modules/daemon/tests/test_session_queue_actions.py | 编辑守卫用例更新 + 伪造行可编辑用例 |
| 新增 | backend/app/modules/daemon/tests/test_inject_origin_guard.py | HTTP 层门控/标记落行用例 |
| 修改 | sillyhub-daemon/src/hub-client.ts | injectSessionPrompt 增 origin 可选参 |
| 修改 | sillyhub-daemon/src/cli.ts | 唤醒回调传 task_wakeup |
| 重生成 | frontend/src/lib/api-types.ts + backend/openapi.json | DTO 增键（pnpm gen:types） |

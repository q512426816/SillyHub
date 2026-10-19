---
author: qinyi
created_at: 2026-10-16 15:31:53
generated_by: sillyspec-fourpiece-init
---
# 提案书（Proposal）

## 动机
用户报告"登录的账户有时候莫名其妙被退出登录"。排查定位两个代码层根因：后端 refresh token 复用检测把旧凭证超窗复用判为重放攻击并吊销该用户**全部**会话（多标签页/休眠恢复即全设备团灭）；前端把 refresh 请求收到的一切非 2xx（含部署窗口的 502/503/504）都当登录态失效清会话跳登录。用户已选定方案 A（D-005）：族级吊销 + 宽限窗加大治后端，状态码分流治前端。

## 关键问题
1. 误杀面过大：一次旧凭证复用（多为自家标签页/休眠恢复的正常竞态）导致全设备强制登出，用户感知为"莫名被踢"。
2. 前端不区分"凭证真失效"与"链路临时故障"：每次后端发布窗口/代理抖动都可能把在线用户误踢到登录页。
3. 历史修复（storage 事件同步、单飞刷新、60s grace）只缩了触发面，未改"全用户吊销"语义本身。

## 变更范围
- 后端：sessions 表加 family_id 列（alembic 增量）；复用检测改族级吊销；AuthRefreshReused 文案同步；grace 默认 60→300s。
- 前端：doRefresh 按状态码分流（5xx/408/429 抛 ApiError 不清会话，4xx 返 null 清会话）；12 处调用点容错审计。
- 测试：后端族语义新测试 + grace 窗测试改造；前端分流新用例。
- 文档：auth-flow.md 语义与 TTL 数字同步。

## 不在范围内（显式清单）
- 不改 access/refresh TTL 本身（30min/14 天不变）
- 不引入 cookie/SSO、不改 Bearer 传输
- 不改管理员 revoke-all 与改密码的全吊销语义
- 不做前端 BroadcastChannel 跨标签页选主
- 不改 HTTP API 请求/响应结构（无 gen:types 义务）

## 成功标准（可验证）
- 同一用户两台设备（两族）登录后，A 族旧 token 超 grace 复用：A 族全部 session 被 revoked，B 族 session 全部存活（后端测试断言）。
- grace 窗内（<300s）旧 token 复用：正常换新对，新 session 继承族，无任何吊销。
- 前端 refresh 收到 503/504：抛 ApiError、useSession 未 clear、不跳 /login（vitest 断言）；收到 401：返回 null（上层清会话）。
- 既有 auth 测试（除按新规格改造的复用检测断言外）全绿；ruff/mypy/tsc/lint 零错。

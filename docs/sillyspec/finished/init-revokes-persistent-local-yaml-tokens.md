---
author: WhaleFall
created_at: 2026-08-20T09:25:00
---

# init-provisioned 吊销工作区持久 token，local.yaml 凭据静默失效

## 现象（2026-08-20 实证）

`.sillyspec/local.yaml` 的 `platform.token`（shpsync_）与 `mcp.token`（shmcp_）双双 401 失效，但 local.yaml 从未改动、`last_connected` 停留在签发当日。CLI 推送 / MCP 反调全部静默不可用（降级沿用原 token，不报错到用户面前）。

## 根因

- `2026-08-19 16:20（本地）` 一次 `sillyspec init` 流程（init lease 触发）调用 backend 的 `get_or_issue`（`backend/app/modules/platform_sync/token_service.py:95`、`backend/app/modules/mcp_gateway/service.py:253`）。
- `get_or_issue` 的语义是**每次调用都吊销该 workspace + created_by 名下全部未吊销 token 再签新的**（注释：「避免堆积」）。
- 它吊销的不只是自己签的 init 专用 token，还包括 **`sillyspec platform connect` 换发的持久 shpsync_** 和**用户手动签发的持久 shmcp_**——两类 token 同属一个 workspace+created_by，被一锅端。
- 新 token 明文仅当次 init 流程内消费，**不写回 local.yaml**；local.yaml 里的旧 token 从此静默失效。

## 修复方式（已执行，供复用）

1. user 级凭据登录 `POST /api/auth/login`（account=admin2）→ JWT。
2. `POST /api/workspaces/resolve-by-root-path`（body `{root_path}`，root_path 与平台 Workspace.root_path 等值，如 `F:/WorkNew/SillyHub`）→ 返回新 `shpsync_`（与 connect 同款换发通道）。
3. `POST /api/workspaces/{ws}/mcp-tokens`（body `{name, scope:["read","dispatch","converge"]}`）→ 返回新 `shmcp_`（明文仅此一次）。
4. 逐行改写 local.yaml 两段 token（保留注释与其他段），复测两组端点 200。

## 修复记录（2026-08-27，本仓 commit b66188d9）

- 已按修复方向①落地：两处 get_or_issue（platform_sync/token_service.py 与 mcp_gateway/service.py）吊销查询加 name=init-provisioned 过滤——只轮换同维度旧 init token（防 init 堆积），connect 换发的持久 shpsync_ 与用户手签 shmcp_ 不再被吊销。
- 副作用修复：platform_sync 侧 name 过滤后同维度至多一行命中，消除持久 + init 并存时 scalar_one_or_none 的 MultipleResultsFound 潜伏崩溃。
- 测试：两份 test_get_or_issue.py 契约反转（持久 token 存活）+ 并存回归锚，10 用例；pytest 三模块 279 passed；ruff/mypy 通过。
- 存量受害凭据不自动恢复：已被吊销的 local.yaml token 仍需按上文「修复方式」手动换发。

## 建议工具修复方向

- `get_or_issue` 只吊销 `name='init-provisioned'` 的旧 token（按 name 过滤），不动 connect 换发的持久 token 与用户手签 token；
- 或 init 流程结束时把新 token 写回 local.yaml（connect 已有文本级改写基建 `replaceTopLevelSection` 可复用）；
- 或 connect/token_service 增加吊销前检查：被吊销 token 若与某 local.yaml 活跃凭据对应（last_used 近期），给出告警。

## 关联

- ROADMAP：2026-08-15 · init lease 触发 sillyspec init
- 平台模块：platform_sync / mcp_gateway

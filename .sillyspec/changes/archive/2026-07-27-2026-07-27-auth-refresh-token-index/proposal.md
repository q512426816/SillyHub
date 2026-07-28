---
author: qinyi
created_at: 2026-07-27 17:42:00
---

# 提案书（Proposal）— auth refresh token 加编号索引（O(1) 根治 refresh 慢）

## 背景

生产监控三件套抓到 `POST /api/auth/refresh` 慢请求 **1741ms**（>1s 触发 slow.request）。排查定位根因：refresh 流程 `_consume_refresh_token`（service.py:248）**遍历所有活跃 session 串行 bcrypt verify**——当前 66 个活跃 session，每个 bcrypt cost-12 verify 250-400ms，累加出 1.7s。根因是设计妥协：refresh_token 是不透明随机串（`secrets.token_urlsafe`），**不携带任何信息**，无法按 token 反查 session，只能全表 bcrypt 比对（代码注释自认 V1 妥协）。grace/重放路径 `_find_revoked_session`（service.py:316）同样 `limit 50` 全扫。

## 方案（方案 A：令牌加编号 + HMAC 索引）

- refresh_token 改 `{token_id}.{secret}` 两段格式（token_id=uuid4 hex 明文，secret=随机熵源）。
- session 表新增 `token_id_hmac`（= HMAC-SHA256(secret_key, token_id) hex）+ 部分唯一索引（`WHERE token_id_hmac IS NOT NULL`）。
- refresh 流程：parse 出 token_id → HMAC → 部分唯一索引 **O(1) 定位单条 session** → 单次 bcrypt 确认 secret 段 → 完成认证。**66 次串行 bcrypt → 1 次 bcrypt（~300ms）+ O(1) 索引查询**。
- **双层防御**：HMAC 只验 token_id 段定位 session，bcrypt 验完整 token（含 secret）确认真伪——DB 泄露 HMAC 列 + 猜中 token_id 也无法伪造（bcrypt 挡）。

## 影响

- **backend**：`app/core/security.py`（generate_refresh_token 返回 tuple + 新增 parse_refresh_token/hmac_token_id + import hmac/hashlib）；`app/modules/auth/model.py`（Session 加 token_id_hmac + `__table_args__` 加部分唯一索引，对齐 workspace/model.py 双方言范式）；`app/modules/auth/service.py`（_issue_token_pair 取 tuple + _consume_refresh_token/_find_revoked_session 重写 O(1) + import）；migration `202607271700`（加列 + 部分唯一索引双 where）。
- **不改**：router.py（端点签名不变）、login/logout/change-password（复用 _issue/_consume 自动获益）、access token（JWT，本变更不动）。
- **纯后端**：无前端、无 daemon 改动。

## 决策摘要（D-001~D-008，详见 design.md §3）

D-001 方案A（token+HMAC 索引）/ D-002 token 格式 `{token_id}.{secret}` / D-003 token_id_hmac 部分唯一索引 / D-004 bcrypt refresh_token_hash 仍存（双保险）/ D-005 HMAC key 复用 secret_key / D-006 不兼容旧 token（部署后失效重登）/ D-007 _find_revoked 同样 O(1) / D-008 migration 只加列不清表（旧行 NULL 自然失效）。

## 不在范围内（Non-Goals）

- access token（JWT）改造——不动。
- refresh token 的 grace 窗口 / FOR UPDATE 行锁 / 复用吊销 revoke_all 逻辑——全保留（只换查找方式）。
- 兼容旧不透明 token 的退化路径——项目未上线（规则 11），旧 token 直接失效重登，不维护全表扫退化分支。
- 定期清理过期 session 减 bloat——运维另行处理，非本变更范围。
- 前端 / daemon 改动——纯后端变更。

## 风险

- **部署后旧 refresh token 失效**（D-006）：旧格式（无 `.`）解析失败 → 401 → 前端跳登录页重登一次。access token（JWT，15 分钟有效）不受影响，平滑过渡。**部署时机提示用户重登**。
- **HMAC 命中时序差**（B5）：HMAC 命中（~300ms bcrypt）vs 未命中（微秒）可探测 live session 存在性，但 token_id=uuid4 不可枚举，残余风险极低；bcrypt 双层防御已论证。
- **migration 游离片段**（B4）：`202608010900` pre-existing 不在 head 链，接续 `202607270900`（head）不受影响。

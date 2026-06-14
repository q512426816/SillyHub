---
author: qinyi
created_at: 2026-06-14T22:04:34
id: task-02
title: placement provider 严格优先 + 无在线回退 + 告警
priority: P0
estimated_hours: 2
depends_on: []
blocks: [task-13]
allowed_paths:
  - backend/app/modules/agent/placement.py
---

# task-02: placement provider 严格优先 + 无在线回退 + 告警

## 上下文
`_get_online_runtime`（placement.py:285）当前已有 provider 参数（条件 `AND provider = :provider`），但 provider 给定且无在线 runtime 时**直接返回 None**——这会让 `decide_backend` 抛 `NoOnlineDaemonError`，导致"想用 codex 但 codex 暂时离线"时任务失败。本任务加"严格匹配优先 → 无在线则回退任意在线 + warning"（FR-03），保证指定 provider 离线时不破坏执行。

## 修改文件（必填）
- `backend/app/modules/agent/placement.py` — `_get_online_runtime`（约 L285-322）

## 实现要求
1. 保持函数签名不变：`async def _get_online_runtime(self, user_id, *, provider=None) -> dict | None`。
2. **provider 给定**：
   - 先查严格匹配：`WHERE user_id=:uid AND status='online' AND provider=:provider ORDER BY last_heartbeat_at DESC NULLS LAST LIMIT 1`。命中则返回。
   - 严格匹配无果 → 回退查询：`WHERE user_id=:uid AND status='online' ORDER BY last_heartbeat_at DESC NULLS LAST LIMIT 1`（不限 provider）。命中则 `log.warning("placement_provider_fallback", wanted=provider, actual=row["provider"])` 并返回该行。
   - 回退也无果 → 返回 None。
3. **provider=None**：维持现状（单次查询 ORDER BY last_heartbeat，不告警）。
4. 不要改动 `decide_backend`（L76）——它只判"有无在线 runtime"，与 provider 解耦（design 非目标）。

## 接口定义（代码类任务必填）
```python
async def _get_online_runtime(
    self, user_id: uuid.UUID, *, provider: str | None = None
) -> dict | None:
    """Return the first online daemon runtime for the user, or None.

    If *provider* is given, prefer a runtime with that provider; if none is
    online, fall back to any online runtime and emit
    ``placement_provider_fallback`` (so dispatch never silently fails due to
    the requested provider being offline). When *provider* is None, behavior
    is unchanged (ORDER BY last_heartbeat_at).
    """
    if provider:
        # 1) 严格匹配
        row = await self._query_online(user_id, provider=provider)
        if row:
            return row
        # 2) 回退任意在线 + warn
        fallback = await self._query_online(user_id, provider=None)
        if fallback:
            log.warning(
                "placement_provider_fallback",
                wanted=provider,
                actual=fallback.get("provider"),
                user_id=str(user_id),
            )
            return fallback
        return None
    # provider=None：现状不变
    return await self._query_online(user_id, provider=None)
```
建议把现有内联 SQL 抽成 `_query_online(self, user_id, *, provider=None) -> dict | None`（含条件 WHERE 的查询），避免 `_get_online_runtime` 里 SQL 重复；若不想抽函数，则内联两次查询亦可。

## 边界处理（必填）
- **provider=None**：完全维持现状（单查询、无 warning），保证成功标准 1（旧配置行为不变）。
- **provider 给定 + 该 provider 在线**：严格匹配命中，无 warning，返回该 provider runtime。
- **provider 给定 + 该 provider 离线 + 其他在线**：回退返回任意在线 runtime + warning（wanted=provider, actual=实际 provider）。任务继续执行，不抛 NoOnlineDaemonError。
- **provider 给定 + 完全无在线 runtime**：返回 None（由 `decide_backend` L116 `raise NoOnlineDaemonError`，行为不变）。
- **同 provider 多 runtime**（R-02）：维持 ORDER BY last_heartbeat_at，最近的胜出；provider 维度而非 runtime 维度。
- **回退 warning 不静默**：用 structlog `log.warning` 带 wanted/actual/user_id，可观测（R-01）。
- **不修改入参**：provider 字符串只读使用。

## 非目标（本任务不做的事）
- 不改 `decide_backend`、`dispatch_to_daemon` 签名或 lease.metadata 写入（L189 既有）。
- 不做 runtime 级指定（只到 provider 维度）。
- 不引入 provider 权限/配额/路由策略。
- 不改前端、不改 daemon。

## 参考
- 现有实现：`_get_online_runtime`（placement.py:285-322）的条件 WHERE 写法。
- structlog 风格：`log.info("placement_decide_backend", workspace_id=..., ...)` —— 事件名 `placement_xxx`。
- `NoOnlineDaemonError`（placement.py:37）由 `decide_backend` 抛，本函数只返回 None。

## TDD 步骤
1. 写测试：`backend/app/modules/agent/tests/test_placement_fallback.py`
   - case A：claude/codex/hermes 全在线 → `_get_online_runtime(uid, provider="claude")` 返回 provider=="claude"。
   - case B：仅 codex/hermes 在线（claude offline）→ `provider="claude"` 返回 codex 或 hermes + 断言有 `placement_provider_fallback` warning（caplog）。
   - case C：无在线 → 返回 None。
   - case D：provider=None → 返回最近心跳 runtime，无 warning。
2. 确认失败（回退逻辑未实现时 case B 会返回 None / 无 warning）。
3. 改 `_get_online_runtime`。
4. `cd backend && uv run pytest -q app/modules/agent/tests/test_placement_fallback.py` 通过。
5. 回归：跑既有 placement/agent 测试确认无破坏。

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 全在线 + provider="claude" | 返回 runtime.provider == "claude"，无 warning |
| AC-02 | claude 离线 + codex/hermes 在线 + provider="claude" | 返回 codex 或 hermes runtime + caplog 含 `placement_provider_fallback`（wanted="claude"） |
| AC-03 | 无任何在线 runtime | 返回 None |
| AC-04 | provider=None | 返回最近心跳 runtime，无 warning，行为同变更前 |
| AC-05 | 既有 agent/placement 测试全绿 | 无回归 |

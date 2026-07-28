---
id: task-06
title: _find_revoked_session 重写 O(1) HMAC 查找
author: qinyi
created_at: 2026-07-27 22:15:00
priority: P0
depends_on: [task-01, task-02, task-05]
blocks: [task-08]
requirement_ids: [FR-08]
decision_ids: [D-007@v1]
allowed_paths:
  - backend/app/modules/auth/service.py
goal: _find_revoked_session 重写——签名加 target_hmac，按 token_id_hmac O(1) 查 revoked session + 单次 bcrypt 确认；去掉 limit 50 全扫。
implementation: _find_revoked_session(self, refresh_token, target_hmac) 改 select where token_id_hmac==target_hmac AND revoked_at IS NOT NULL scalar_one_or_none；命中后单次 verify_refresh_token 确认 secret（通过返回 session，否则 None）；无匹配 None。
acceptance: revoked session 按 hmac O(1) 命中+bcrypt 通过；secret 错不返回；无匹配 None；不再 limit 50 全扫。
verify: cd backend && uv run pytest tests/modules/auth/ -q（task-08 补 _find_revoked 单测）。
constraints: 签名加 target_hmac（task-05 调用点已传）；保留 grace 续期/重放吊销判定（调用方逻辑不变）；只改 _find_revoked 内部实现。
provides:
  - contract: FindRevokedSessionO1
    fields: [o1_hmac_lookup]
expects_from:
  task-01:
    - contract: SessionTokenIndex
      needs: [token_id_hmac_column]
  task-02:
    - contract: RefreshTokenHelpers
      needs: [parse_refresh_token, hmac_token_id]
  task-05:
    - contract: ConsumeRefreshTokenO1
      needs: [o1_hmac_lookup]
---

# task-06 · service _find_revoked_session

## goal

grace/重放路径同样 O(1)：revoked session 也按 token_id_hmac 定位，去掉 `limit 50` 全扫串行 bcrypt（design §5.4，D-007）。

## implementation

1. `_find_revoked_session`（service.py:316-331）改签名加 `target_hmac: str`（task-05 调用点 `_find_revoked_session(refresh_token, target_hmac)`）。
2. 重写查询：
   ```python
   session = (await self._db.execute(
       select(SessionRow)
       .where(col(SessionRow.token_id_hmac) == target_hmac)
       .where(col(SessionRow.revoked_at).is_not(None))
   )).scalar_one_or_none()
   if session is None:
       return None
   if await asyncio.to_thread(verify_refresh_token, refresh_token, session.refresh_token_hash):
       return session
   return None
   ```
3. 去掉原 `order by revoked_at desc limit 50` 全扫 + 串行 bcrypt 循环。

## 验收标准

- [ ] revoked session 按 token_id_hmac O(1) 命中 + bcrypt 通过 → 返回 session
- [ ] HMAC 命中但 secret 错 → 返回 None
- [ ] 无匹配 → 返回 None
- [ ] 不再 `limit 50` 全表扫

## verify

- `cd backend && uv run pytest tests/modules/auth/ -q`（task-08 补 _find_revoked O(1)/secret 错/无匹配单测）

## constraints

签名加 `target_hmac`（task-05 调用已传，避免重复算 hmac）；调用方 grace 续期/重放吊销判定逻辑不变（只换查找方式）；本 task 是 service.py 编辑链最后一环（task-05 合入后改同文件）。

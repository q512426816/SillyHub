---
id: task-03
title: LlmProviderService (CRUD+加密+互斥+owner)
title_zh: LlmProvider 服务层（增删改查+加密+默认互斥+归属过滤）
author: qinyi
created_at: 2026-07-25 17:06:11
priority: P0
depends_on: [task-02]
blocks: [task-04, task-06]
requirement_ids: [FR-01, FR-02]
decision_ids: [D-001@v1, D-008@v1, D-009@v1]
allowed_paths:
  - backend/app/modules/llm_provider/service.py
goal: >
  实现 LlmProviderService（list/get/create/update/delete/set_default），复用 CredentialCipher
  加解密 api_key，is_default 在 (user_id, agent_kind) 维度互斥，所有方法按 user_id 过滤。
implementation:
  - 照 git_identity/service.py:38-52 范式 __init__(session, *, cipher=None) + _default_cipher() 调 get_cipher()
  - list_(user_id) WHERE user_id ORDER BY created_at DESC；get(id,user_id) 不存在→NotFound(404)，row.user_id!=user_id→PermissionDenied
  - create：cipher.encrypt(api_key or "") → 赋 encrypted_api_key+key_id（明文不入 ORM）；若 is_default 先清同组；commit+refresh
  - update：get 后逐字段更新；仅 api_key is not None 才重新 encrypt；is_default True 先清同组
  - set_default：事务内 UPDATE 同 (user_id,agent_kind) 清 is_default 再置本行（R-05）
  - _to_read(row)：decrypt 明文 → 按 X-09 算 api_key_masked → LlmProviderRead（严禁明文进返回）
acceptance:
  - create 后 DB 仅存密文（SELECT encrypted_api_key 非空但非明文）；Read 返回 masked
  - 同 (user_id,agent_kind) 连续设默认两次 → 仅末条 is_default=True
  - 越权 get/update/delete 他人 provider → 404/403，不泄漏存在性
verify:
  - cd backend && uv run pytest app/modules/llm_provider -q --no-cov
constraints:
  - 加解密必走 CredentialCipher.encrypt/decrypt（照 git_identity/service.py:81-93/:124），禁自造或 base64
  - set_default/create/update 置默认前必须事务内清同 (user_id,agent_kind) 兄弟行 is_default（R-05 并发互斥，先 UPDATE 清再 SET 单事务）
  - 所有方法 WHERE user_id=current_user.id 过滤（D-008）；跨用户访问 404/403
  - create/update 先 cipher.encrypt(api_key) 再赋 encrypted_api_key，明文永不入 ORM（R-04）
  - SILLYSPEC_MASTER_KEY 未配 → 首次 crypto 操作才 503（crypto.py:37-44 use-time）；单测注入 fake cipher 或设 env
---

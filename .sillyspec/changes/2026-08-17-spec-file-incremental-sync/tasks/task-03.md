---
repo: main
id: task-03
title: task-03
title_zh: 鉴权与跨模块调用验证
goal: 确认 shpsync_ token 能走通新端点，其他 token/无 token 被拒，并覆盖 conflict 与空 ops。
implementation: |
  1. 新增 backend/app/modules/platform_sync/tests/test_spec_sync.py。
  2. 用 shpsync_ token 调 GET/POST → 200。
  3. 用 JWT / shk_live_ 调 GET/POST → 403。
  4. 无 token → 401。
  5. conflict 场景：手动改 SpecFileManifest.version 后再推，返回 conflict=true 且 server_versions 指向冲突文件。
  6. 空 ops → 200 ok=true。
acceptance: |
  - 新增测试全绿；
  - 既有 platform_sync、spec_workspace 测试不红。
verify: pytest backend/app/modules/platform_sync/tests/test_spec_sync.py backend/app/modules/spec_workspace/tests/
constraints: |
  - 不得为了通过测试放宽鉴权。
allowed_paths:
  - backend/app/modules/platform_sync/tests/test_spec_sync.py
---

# task-03 鉴权与跨模块调用验证

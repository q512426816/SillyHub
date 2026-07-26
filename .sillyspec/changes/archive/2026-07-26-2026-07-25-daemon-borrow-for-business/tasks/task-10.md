---
id: task-10
title: 借用 agent run 完成回调落 FileService + 确认 markdown 白名单
title_zh: 借用方案落文件中心
author: qinyi
created_at: 2026-07-25 21:50:26
priority: P0
depends_on: [task-09]
blocks: [task-13]
requirement_ids: [FR-06]
decision_ids: [D-001@v1, D-009@v1, D-010@v1]
allowed_paths:
  - backend/app/modules/agent/router.py
  - backend/app/modules/agent/service.py
  - backend/app/modules/file/service.py
  - backend/app/config.py
expects_from:
  task-09:
    - contract: BorrowSandbox
      needs: [borrowed_lease]
goal: >
  借用 agent run 完成（close_interactive_run/complete_lease 回调）时把方案文本落成文件中心文件。
implementation:
  - 在借用 lease 的完成回调（close_interactive_run / complete_lease）里判别 borrowed lease，拿 agent final message 方案文本
  - 调 FileService.upload_file(original_name="方案-<run>.md", data=text.encode(), mime_type="text/markdown", uploaded_by=borrower_id, owner_type="workspace", owner_id=ws_id)
  - spike-02 确认 text/markdown 在 settings.file_allowed_type_set 白名单，不在则加配置或 fallback text/plain
acceptance:
  - 借用 run 完成后方案落 file（owner_type=workspace, created_by=业务人员）
  - 业务人员工作台/文件中心可见该方案
  - 普通（非借用）lease 不落 file（零回归）
verify:
  - cd backend && uv run pytest app/modules/agent app/modules/file -q --no-cov
  - curl 实测借用 run 完成后 file 记录生成（backend 容器改完需 rebuild）
constraints:
  - 只对 borrowed lease 落 file（D-010 回调判别）
  - markdown 白名单（spike-02）；size 不超 file_max_size_mb
  - 复用 FileService.upload_file（service.py:66-109 吃 bytes），不经前端上传
---

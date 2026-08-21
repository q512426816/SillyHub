---
id: task-08
title: session-attachment-draft-cleanup-job
title_zh: 附件草稿 48 小时周期清理任务
author: WhaleFall
created_at: 2026-08-20 15:13:46
priority: P2
depends_on: [task-01]
blocks: []
requirement_ids: [FR-8]
decision_ids: [D-5]
allowed_paths:
  - backend/app/modules/session_attachment/cleanup.py
  - backend/app/main.py
provides:
  - contract: 草稿清理函数
    fields: [deleted_count, cutoff_hours]
expects_from:
  task-01:
    - contract: SessionAttachment
      needs: [session_id, created_at]
goal: >
  每小时删除上传超 48 小时仍未绑定会话的附件草稿行 对象保留（D-5）。
implementation:
  - 新建 cleanup.py 模块级异步函数 cleanup_expired_draft_attachments 入参 AsyncSession 与可选 cutoff_hours 默认 48 返回删除行数
  - 删除条件 session_id 为空且 created_at 早于 now 减 48h（UTC 口径）批量有界（对齐 lease expire_leases limit 200 模式）积压由后续 tick 兜
  - 只删行不删对象（D-5）结构化日志输出删除计数
  - main.py lifespan 启动段先跑一次（对齐 cleanup_stale_runs 的 try except log.exception 模式 异常不阻断启动）
  - 再起每小时后台循环任务（对齐 core/monitoring.py 看门狗 start stop 模式）lifespan finally 中 cancel 每轮自建短 session
acceptance:
  - 49h 前草稿被删 47h 前保留 已绑定行任何情况不删
  - 全程无对象存储 delete 调用
  - 清理异常仅记日志不影响启动 启动即执行一次之后每小时执行
verify:
  - cd backend && uv run pytest app/modules/session_attachment/tests -q
constraints:
  - 挂点仅 main.py 与新文件（lease expiry 批处理无生产周期调用方 故复用看门狗后台任务先例）不动 task-04 与 task-05 所属文件
  - 不做对象 GC 与引用计数（D-5 accepted risk）不引入新调度框架
related_tests: []
---

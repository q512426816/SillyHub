---
author: flow-machine-draft
created_at: 2026-10-27T20:44:07.964Z
---
# 任务注册表（Tasks）— 2026-10-28-change-detail-sessions-source-fix

- [x] task-01: 后端共享 helper `session_display_title` 落地 session_attachment/service.py（剥离附件标记→首个非空行前 30 字；纯附件回退首个附件 name；空入 None）+ 纯函数单测三场景（混合/纯附件/纯文本零回归）
- [x] task-02: change/router.py `_fetch_session_titles` substr 1,512 + Python 侧消费 helper；test_change_sessions_cap.py 补「附件开局标题剥离」断言并跑绿
- [x] task-03: agent/router.py 标题提取同款接 helper + 对应测试跑绿
- [x] task-04: daemon/router/session_crud.py title_fallback 读展示过 helper（持久化列不动零迁移）+ 读侧测试跑绿
- [x] task-05: 前端 changes/[cid]/page.tsx 数据源换 listChangeSessions（boundSession 同源 sessions[0]）；相关测试改断言跑绿
- [ ] task-06: change-overview-side.tsx 状态列中文标签（active→进行中等）+ 组件测试跑绿

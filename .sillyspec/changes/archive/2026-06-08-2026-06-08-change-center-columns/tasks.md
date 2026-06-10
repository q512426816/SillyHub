---
author: WhaleFall
created_at: 2026-06-08T11:00:00
---

# Tasks: 变更中心列展示优化

## Wave 1: 后端 Parser 增强

- [ ] T1: Parser 新增 `_infer_change_type()` 方法 — `backend/app/modules/change/parser.py`
- [ ] T2: Parser 新增 `_infer_affected_components()` 方法 — `backend/app/modules/change/parser.py`
- [ ] T3: Parser `_parse_change()` 末尾调用推断方法 — `backend/app/modules/change/parser.py`
- [ ] T4: `_apply_parsed()` 添加 change_type 和 affected_components 的 reparse 覆盖 — `backend/app/modules/change/service.py`

## Wave 2: 前端展示优化

- [ ] T5: 状态列改用 human_gate 展示 + 阶段列 null 兜底 + 类型列颜色映射 — `frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx`

## Wave 3: 验证

- [ ] T6: 触发 reparse 验证四列展示效果 — 手动验证

---
id: task-07
title: PpmFileUrls 附件URL管理 + 工作日联动 + 处置按钮
priority: P2
estimated_hours: 5
depends_on: [task-01]
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-010@v1]
author: qinyi
created_at: 2026-06-21T01:10:00+0800
---

## 目标
明细附件多 URL 增删(D-010,不真上传);选 planBeginTime+planWorkload 自动算 planCompleteTime(工作日);problemlist 操作列按 status 出「处置」按钮(仅命中处理人)。覆盖 FR-05, D-010@v1。

## 文件
- `frontend/src/components/ppm-file-urls.tsx`(新:多 URL 增删,纯 input URL,不上传)
- `frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx`(改:planBeginTime/planWorkload 联动)
- `frontend/src/app/(dashboard)/ppm/problems/page.tsx`(改:操作列处置按钮,若 problems 页路径不同实现时定位实际文件)

## 实现要点(对照源)
- PpmFileUrls:对照源附件 URL 管理模式(D-010 明确不真上传),props `{ value: string[]; onChange }`,增删 URL 项,提交存 JSON 数组。
- 工作日联动:对照源 `addWorkingDays` 工具,监听 planBeginTime + planWorkload 变更 → planCompleteTime = planBeginTime + 工作日数(跳过周末,源若有节假日表则从其逻辑,否则纯周末)。本地写 util(若 lib 无则新增 `lib/ppm/workday.ts`)。
- 处置按钮:对照源 `problemlist/index.vue` 操作列,status=20/25/30(待处理/处理中/待复核)且当前用户∈处理人,才显「处置」按钮,点击打开处置表单/抽屉。

## 验收
- [ ] PpmFileUrls 可增删多条 URL,不触发真上传(D-010)
- [ ] 选 planBeginTime+planWorkload 自动算 planCompleteTime(跳周末)
- [ ] problemlist 操作列 status=20/25/30 命中处理人才显「处置」
- [ ] 对照源交互一致
- [ ] frontend typecheck + build 通过

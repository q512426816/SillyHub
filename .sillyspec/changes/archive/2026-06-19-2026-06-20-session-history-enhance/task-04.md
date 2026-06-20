---
id: task-04
title: frontend SessionsSidebar 去 {!active} 删除限制
priority: P0
depends_on: [task-03]
blocks: []
requirement_ids: [FR-3]
decision_ids: [D-003@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/runtimes/page.tsx
  - frontend/src/app/(dashboard)/runtimes/page.test.tsx
---

## 修改文件
- `frontend/src/app/(dashboard)/runtimes/page.tsx`：`SessionsSidebar`（:907-942）
- 测试：`runtimes/page.test.tsx`

## 覆盖来源
- design.md §4.2、§13；decisions D-003@v1；requirements FR-3

## 实现要求
1. `SessionsSidebar`（:927）去掉 `{!active ? (<删除按钮>) : null}` 条件，**所有状态**（active/pending/reconnecting/ended/failed）都渲染删除按钮
2. `handleDelete`（:1079）逻辑不变（confirm + `deleteAgentSession`）；active 删除的后台 end 收口由后端 task-03 自动处理，前端无需额外步骤
3. 可选：`window.confirm` 文案对 active 增加"（将先结束当前会话）"提示（:1081）

## 接口定义
- 删除按钮 JSX（:928-941）从条件渲染改为无条件渲染
- `active` 变量（:905）仍用于 badge 颜色，不再用于控制删除按钮显隐

## 边界处理
1. **active 会话删除**：后端（task-03）自动 end 收口，前端只调 `deleteAgentSession`，行为透明
2. **删除中（deletingSessionId===s.id）**：spinner（:936-937）+ disabled（:932）保留
3. **reconnecting 删除**：同 active，后端先 end 再删
4. **confirm 取消**：`window.confirm` 返回 false → 不删（:1083）
5. **删除失败**：`listError` 显示（:1096），session 保留在列表

## 非目标
- 不改 `handleDelete` 的 confirm/delete 逻辑
- 不改删除按钮样式/位置
- 不加批量删除（YAGNI）

## 参考
- 现有删除按钮：`page.tsx:927-942`
- handleDelete：`page.tsx:1079-1100`

## TDD 步骤
1. 写测试：active 会话列表项存在"删除会话"按钮（aria-label `删除会话 <id>`）
2. 确认失败（当前 active 不渲染）
3. 去 `{!active}` 限制
4. 确认通过；补点击 active 删除 → 调 deleteAgentSession 测试
5. 回归现有 page.test.tsx（含 ql-007 删除测试）

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | active 会话列表项 | 渲染删除按钮（aria-label 含 id） |
| AC-02 | ended/failed 会话 | 删除按钮仍存在（回归） |
| AC-03 | 点击 active 删除按钮 | confirm → 调 `deleteAgentSession` |
| AC-04 | 删除成功 | session 从列表移除（:1089） |
| AC-05 | page.test.tsx 回归 | 全绿 |

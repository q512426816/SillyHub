---
author: flow-machine-draft
created_at: 2026-10-23T05:42:20.266Z
updated_by: admin2-askuser-draft
---
# 任务注册表（Tasks）— 2026-10-23-askuser-dialog-draft

- [x] task-01: 单选互斥（FR-01）：`ask-user-dialog-card.tsx` 选项按钮 `disabled` 条件加 `isSingle && customText.trim() !== ""`，手动输入框 `disabled` 条件加 `isSingle && selected.length > 0`，两侧各加一行提示文案；`selectOption` / `setCustomText` 入口加同条件防御守卫。落点测试：`ask-user-dialog-card.test.tsx` FR-01 三场景（勾选后输入禁用 / 输入后选项禁用 / 取消选择与清空输入后恢复）。
- [x] task-02: 多选保持现状（FR-02）：确认多选分支未被互斥条件命中（`isSingle` 为 `!q.multiSelect`），`computeAnswer` 合并语义零改动。落点测试：`ask-user-dialog-card.test.tsx` 多选回归用例（可勾多项 + 输入可合并提交）。
- [x] task-03: 草稿持久化（FR-03）：新增 `ask-user-dialog-draft.ts`（键 `sillyhub.askuser.draft.<requestId>`、值含 `v/at/states`、TTL 7 天 prune、损坏降级返 null）；卡片 `states` 改 lazy initializer 读草稿 + `useEffect([states])` 写草稿。落点测试：`ask-user-dialog-draft.test.ts`（读写往返 / TTL 过期清理 / 损坏降级 / 跨 requestId 隔离 / prune 不碰其它前缀）+ `ask-user-dialog-card.test.tsx` 卸载重挂载恢复用例。
- [x] task-04: 草稿清理（FR-04）：`handleSubmit` 成功路径与 409 already-resolved 分支各调 `clearAskUserDraft`；孤儿草稿由 TTL prune 兜底。落点测试：`ask-user-dialog-card.test.tsx` 提交成功后 localStorage 键消失用例 + draft 模块 TTL 用例。
- [x] task-05: 验证面：`npx vitest run src/components/ask-user-dialog-card.test.tsx src/components/ask-user-dialog-draft.test.ts src/components/daemon/__tests__/pending-dialog-dock.test.tsx` 全绿；`npx tsc --noEmit` 零错；`npx eslint` 改动文件零新增警告。

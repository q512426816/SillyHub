---
change: 2026-08-25-runtimes-entry-unified-floating
step: 8
date: 2026-08-25
---

# 代码审查报告

## 审查范围
本次变更涉及9 个文件（6 modified + 3 deleted），总变更量：+199/-1208 行。

## 审查结果

### ✅ 无问题项

1. **floating-session.ts（store）**：FloatingLockedRuntime 接口清晰，lockedRuntime 字段初始 null，openRuntimeSession/closeRuntimeLock action 实现正确。closeDrawer 不清除 lockedRuntime 符合 FR-03 最小化保活语义。

2. **session-list-panel.tsx（RuntimeScope）**：RuntimeScope 为 WorkspaceScope | ChangeScope 联合类型的新分支，type guard `"workspaceId" in scope` 正确处理 RuntimeScope 缺 workspaceId 的情况。runtime_id 过滤仅在 kind === "runtime" 时生效。runtime scope 的 groups 计算正确过滤无会话工作区 + canNew: false。

3. **floating-session-host.tsx（抽屉增强）**：抽屉加宽 960px，grid 固定 320px + 1fr 布局正确（避免 md: 视口陷阱）。lockedRuntime badge 渲染条件正确。handleNewSession 在 lockedRuntime 时跳过 PreSessionPicker 直接 startPreSession。

4. **runtimes/page.tsx（入口改造）**：handleOpenSession 从 dialogRuntime 改为 openRuntimeSession，machine/provider 标签正确从 machines 数组查找。?session= 深链复用 openRuntimeSession + selectSession。删除 handler 从 setDialogRuntime(null) 改为 closeRuntimeLock()。

5. **runtime-session-dialog.tsx + 2 个配套测试（删除）**：3 个文件共 1087 行死代码，功能已被 FloatingSessionHost + SessionListPanel 完全替代，删除正确。

### ⚠️ 建议项（非阻塞）

1. **Locked badge 溢出**：lockedRuntime badge 使用 `text-[10px]`，当 machineLabel 较长时可能截断。建议后续加 truncate 或 title 属性。非本次 FR 范围，记录待后续。

2. **SessionListPanel runtime scope 空态**：runtime scope 下若该 runtime 无任何会话，groups 为空数组，左栏显示空态。这是预期行为（FR-01 只看当前 runtime 会话），但用户体验可优化（如显示"当前 runtime 暂无会话"提示）。非阻塞。

## 总体评价
代码质量良好，类型安全，测试覆盖完整（186/186 绿）。删除 1087 行死代码，统一三入口会话管理，符合设计文档要求。

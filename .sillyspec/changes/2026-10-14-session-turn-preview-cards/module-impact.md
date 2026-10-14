# 模块影响分析（首版：plan 审查步按 gate 兜底指引手写——CLI 自动生成两次 --done 未落盘；章节标题逐字合规）

> 文件×模块归属按 _module-map.yaml paths 前缀匹配（frontend_components: frontend/src/components/**）；
> **影响类型**与 review 标记是语义判断，execute/verify 阶段以 git diff 为准把 <!--TODO--> 回填为真实结论。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| frontend_components | `frontend/src/components/daemon/session-panel/preview-merge.ts` | 新增（归并纯函数 + 预览条目构造，单文件自包含） | 否（纯函数 11 单测覆盖，无既有消费方） |
| frontend_components | `frontend/src/components/daemon/turn-timeline.tsx` | 逻辑变更（SessionTurnView 加 preview 可选字段 + TurnRow 前置预览分支 + TurnPreviewCard + expandPreview 可选 prop；缺省零回归，hit() 内容门 D-005@v1 排除预览卡） | 是（turn-timeline 为高扇出共享组件——7 文件 110 既有用例复跑全绿 + tsc 0） |
| frontend_components | `frontend/src/components/daemon/session-panel/session-panel-page.tsx` | 逻辑变更（displayTurns 串联归并 + fetchAndAttachTurn 收敛直达装配 + handleExpandPreview + prefetchNearbyTurns + hit() 守卫 + 会话切换重置 previewInflightRef） | 是（会话装配主链路——集成测试 4 例 + history-scroll 既有面全绿） |
| frontend_components | `frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts` | 新增（归并纯函数单测 11 例） | 否 |
| frontend_components | `frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx` | 新增（预览卡渲染/交互/零回归测试 7 例） | 否 |
| frontend_components | `frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx` | 新增（整页集成 FR-01/03/04 + D-005 回归锚 4 例） | 否 |

## 未匹配文件

（无——design 文件清单 5 路径全部命中 frontend_components 模块 paths 前缀 frontend/src/components/**。）

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/frontend_components.md` | 会话域组件族增补预览卡条目——已追加到 frontend_components.changelog.md sidecar（主卡超预算 41.6KB 不再膨胀） | done |
| `_module-map.yaml` | 无新模块/新路径前缀（全部既有 frontend_components 范围），无需 rebuild | skipped |

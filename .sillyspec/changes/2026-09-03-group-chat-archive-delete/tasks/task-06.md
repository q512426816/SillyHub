---
id: task-06
title: '前端列表交互——GroupChatRow hover 操作（归档/取消归档/删除）+ 已归档徽标与降调 + 归档视图数据源（queryKey 视图维度、「＋」隐藏）+ sessions-portal 群回调接线'
title_zh: '前端列表交互——群行操作/徽标/归档视图 + portal 回调接线'
author: 'qinyi'
created_at: '2026-09-03 16:55:15'
priority: P0
depends_on: ['task-05']
blocks: ['task-07']
requirement_ids: [FR-01, FR-02, FR-03, FR-04]
decision_ids: ['D-01@v1']
allowed_paths:
  - frontend/src/components/sessions/session-list-panel.tsx
  - frontend/src/components/sessions/sessions-portal.tsx
goal: >
  群行获得与会话行同构的收纳操作：hover 三按钮（归档/取消归档按 archived_at
  二选一 + 删除）、Modal.confirm + useNotify toast、已归档徽标与整行降调；
  群分区在「已归档会话」视图切换数据源；portal 提供三个群回调（调 lib →
  invalidate ["groupChats"] → 清选中态）。
implementation:
  - SessionListPanel props 加 onArchiveGroup/onUnarchiveGroup/onDeleteGroup
    （可选，传入才启用行操作——照 onDeleteSessions 可选模式）
  - groupChatsQuery：queryKey 追加视图维度（["groupChats","list",wsId,
    isArchivedView ? "archived" : "active"]）；queryFn 传
    listGroupChats({ archived: isArchivedView })（默认视图显式 false）；
    注释锚定 design §6.2 防缓存串视图
  - GroupChatSection/GroupChatRow props 透传三回调 + isArchivedView：
    - 行尾 hover 操作区 `group-hover:flex`（照 SessionRow:2479-2525——
      Archive/ArchiveRestore 按 group.archived_at 二选一 + Trash2 destructive
      hover；aria-label「归档群聊 {title}」「取消归档群聊 {title}」「删除群聊
      {title}」；stopPropagation 防行点击）
    - 已归档徽标：group.archived_at 非空 → muted chip「已归档」+ title 相对
      时间（formatRelativeTime，照会话行 2456-2464）+ 整行 opacity-60 降调
    - 分区头归档视图隐藏「＋」（design §6.2——群分区新增行为，注释说明）
  - Modal.confirm 三处理（照 handleSingleArchive/handleSingleDelete 模式
    1074-1241）：归档文案「归档后将从默认列表隐藏，可在『已归档会话』筛选中
    查看」；删除文案 design §6.2 群语义版本；archiving/deleting 状态防重入；
    notify 成功/失败 toast
  - sessions-portal：三回调实现（dynamic import @/lib/daemon 照会话回调模式）→
    qc.invalidateQueries({ queryKey: ["groupChats"] }) → 若操作的是
    selectedGroupId 则清 selectedGroupId/selectedGroup + syncSessionParam(null)
acceptance:
  - 默认视图群行 hover 出现归档+删除；已归档视图出现取消归档+删除 + 徽标降调
  - 确认弹窗取消不触发请求；确认后列表刷新 + 选中被操作群时清选中
  - 归档视图「＋」隐藏；分区计数语义正确
  - pnpm exec tsc --noEmit 零错误
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm vitest run src/components/sessions/__tests__/session-list-panel.test.tsx（既有用例零回归；新增用例归 task-07）
constraints:
  - 视觉/交互逐项照 SessionRow 先例（图标/aria-label/Modal/toast/降调），不发明
    新形态；群语义差异仅限文案
  - 回调可选 props 模式——未传入时群行零操作按钮零请求（悬浮助手等消费点零回归）
---

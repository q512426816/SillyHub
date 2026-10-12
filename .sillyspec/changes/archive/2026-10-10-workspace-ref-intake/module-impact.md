# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| frontend_components | frontend/src/components/ui/floating-context-menu.tsx | 新增（通用浮动右键菜单组件，看板模式抽离） | 否 |
| frontend_components | frontend/src/components/explorer/file-explorer.tsx | 接口变更（可选 prop onAddNodeRef）+ 调用关系变更（树构造点接线右键闭包） | 否 |
| frontend_components | frontend/src/components/explorer/file-preview.tsx | 接口变更（可选 prop onAddSelectionRef）+ 逻辑变更（代码分支 showLineNumbers/纯文本分支行结构化/selectionLineRange 选区右键） | 否 |
| frontend_components | frontend/src/components/daemon/input-ref-overlay.tsx | 接口变更（可选 prop tokenMetas）+ 逻辑变更（左上类型角标+tooltip） | 否 |
| frontend_components | frontend/src/components/sessions/portal-file-panels.tsx | 接口变更（两壳可选 props 直通） | 否 |
| frontend_components | frontend/src/components/sessions/sessions-portal.tsx | 逻辑变更（pendingWsRefInsert 槽位状态+四分支下发+空门户 toast） | 否 |
| frontend_components | frontend/src/components/daemon/session-input-bar.tsx | 接口变更（可选 props pendingWsRefInsert/onPendingWsRefInsertHandled/onWsRefTokensChange）+ 逻辑变更（wsRefTokens 状态/槽位消费/并集分配/删除联动隔离） | 否 |
| frontend_components | frontend/src/components/daemon/attachment-ref-tag.tsx | 逻辑变更（InlineAttRefText 换 parseInlineRefs+三类标签渲染+onOpenWsRef） | 否 |
| frontend_components | frontend/src/components/daemon/turn-segment-views.tsx | 调用关系变更（消费点接 onOpenWsRef → FilePreviewModal） | 否 |
| frontend_components | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 逻辑变更（wsRefTokens 状态+三组装位串联 substituteWsRefsForSend+槽位透传） | 否 |
| frontend_components | frontend/src/components/daemon/session-panel/session-panel-dialog.tsx | 逻辑变更（wsRefTokens 状态+三组装位串联 substituteWsRefsForSend+槽位透传） | 否 |
| frontend_components | frontend/src/components/group-chat/group-chat-panel.tsx | 逻辑变更（群聊输入区 wsRefTokens/槽位插入/组装位置换/气泡历史三类标签） | 否 |
| frontend_lib | frontend/src/lib/attachment-refs.ts | 逻辑变更（纯新增导出：WsRefDesc/五函数/parseInlineRefs；parseInlineAttRefs 改兼容薄封装，既有签名零变动） | 否 |

## 未匹配文件

以下为测试文件（_module-map 未收录 __tests__ 路径属正常——测试随被测组件归属，非游离）：

- `frontend/src/components/daemon/__tests__/attachment-refs.test.ts`（随 attachment-refs.ts，frontend_lib 测试）
- `frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx`（随 input-ref-overlay.tsx）
- `frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx`（随 session-input-bar.tsx）
- `frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx`（随 group-chat-panel.tsx）
- `frontend/src/components/explorer/__tests__/file-explorer.test.tsx`（随 file-explorer.tsx）
- `frontend/src/components/explorer/__tests__/file-preview.test.tsx`（随 file-preview.tsx）
- `frontend/src/components/sessions/__tests__/sessions-portal.test.tsx`（随 sessions-portal.tsx）

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。
本变更全部为可选 prop 追加或纯新增导出（见 symbol-impact.md），无既有签名破坏性变更、无后端改动。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 按当前 _module-map.yaml 前缀口径，变更文件全部命中 frontend_components / frontend_lib 两模块（attachment-refs.ts 在 lib 前缀下）；__tests__ 路径未收录属索引粒度选择，不算索引过期，无需 rebuild | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。

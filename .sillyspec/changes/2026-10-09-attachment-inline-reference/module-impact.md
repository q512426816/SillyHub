# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| frontend_lib（子项目 map） | frontend/src/lib/attachment-refs.ts | 新增 | 否（纯函数+10 用例） |
| frontend_components（子项目 map） | frontend/src/components/daemon/input-ref-overlay.tsx | 新增 | 否 |
| frontend_components（子项目 map） | frontend/src/components/daemon/attachment-ref-tag.tsx | 新增 | 否 |
| frontend_components（子项目 map） | frontend/src/components/daemon/session-input-bar.tsx | 逻辑变更（+可选 prop） | 已审（acceptance 双 pass） |
| frontend_components（子项目 map） | frontend/src/components/group-chat/group-chat-panel.tsx | 逻辑变更 | 已审 |
| frontend_app（子项目 map） | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 逻辑变更（发送置换接线） | 已审 |
| frontend_app（子项目 map） | frontend/src/components/daemon/session-panel/session-panel-dialog.tsx | 逻辑变更（发送置换接线） | 已审 |
| frontend_components（子项目 map） | frontend/src/components/daemon/turn-segment-views.tsx | 逻辑变更（历史渲染接入） | 已审 |
| frontend_components（子项目 map） | frontend/src/components/daemon/__tests__/attachment-refs.test.ts | 新增（测试） | 否 |
| frontend_components（子项目 map） | frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx | 逻辑变更（测试扩充） | 否 |
| frontend_components（子项目 map） | frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx | 逻辑变更（测试扩充） | 否 |

## 未匹配文件

以下变更文件未命中 _module-map.yaml（docs/SillyHub/modules/）任何模块 paths——判定：**模块索引未过期，非游离文件**。SillyHub 主 map 只登记 backend 模块（36 个）；前端路径由子项目 map（.sillyspec/docs/frontend/modules/_module-map.yaml 的 frontend_app/frontend_components/frontend_lib/frontend_stores）管理——本变更全部文件按子项目 map 归属填入上表矩阵，属既有双 map 分工，不需要 modules rebuild。

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 不增改——SillyHub 主 map 仅登记 backend；前端归属由子项目 frontend map 承载（既有分工），本次无新顶层模块 | skipped（原因：双 map 分工，非索引过期） |

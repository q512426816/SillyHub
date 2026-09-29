---
author: flow-machine-draft
created_at: 2026-09-29T08:25:19.927Z
---
# 需求规格（Requirements）— 2026-09-29-change-detail-timeline-files-polish

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: 时间线卡事件轴有节点连线时间轴视觉,事件/任务多时限高内部滚动不再撑爆详情页,事件超过阈值默认折叠可
Given 折叠 相关模块就绪
When 时间线卡事件轴有节点连线时间轴视觉,事件/任务多时限高内部滚动不再撑爆详情页,事件超过阈值默认折叠可展开
Then 行为符合本条标准描述

### FR-02: 变更文件弹窗内联与全屏预览均能结构化渲染 watcher-events.jsonl(逐行解析,时刻/
Given 系统就绪
When 变更文件弹窗内联与全屏预览均能结构化渲染 watcher-events.jsonl(逐行解析,时刻/类型/详情人类可读)
Then 行为符合本条标准描述

### FR-03: 变更目录固定产物文件(proposal.md/design.md/tasks.md/flow-sta
Given 系统就绪
When 变更目录固定产物文件(proposal.md/design.md/tasks.md/flow-state.yaml/change.patch 等)在文件树与内容
Then 行为符合本条标准描述

### FR-04: 既有时间线卡与变更文件树相关测试不回归,新增能力有测试覆盖
Given 测试 相关模块就绪
When 既有时间线卡与变更文件树相关测试不回归,新增能力有测试覆盖
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- frontend/src/components/changes/detail/__tests__/change-timeline-card.test.tsx「三段渲染：诞生锚 + 事件轴（中文标签/commit 标题）+ 任务面（勾选×提交锚）+ 统计」（时间轴行结构/任务面/统计回归）
- frontend/src/components/changes/detail/__tests__/change-timeline-card.test.tsx「ChangeTimelineCard 事件折叠（阈值 30）」×2 用例（≤30 不折叠 / >30 默认折最近 30 + 展开收起）
- frontend/src/components/changes/detail/__tests__/change-timeline-card.test.tsx「fake-check 告警醒目态（琥珀强调）」（节点 tone/warn 行为锚点）

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- backend/app/modules/change/tests/test_files_router.py::test_list_files（.jsonl is_text=True 判定——预览链路根因）
- frontend/src/components/files/__tests__/structured-views.test.tsx「tryParseJsonl」×2 + 「knownJsonlView（watcher-events.jsonl 专用表格）」×2 + 「JsonlView（通用逐行树）」（解析/专用表格/通用树）
- frontend/src/components/__tests__/change-file-tree.test.tsx「watcher-events.jsonl 内联预览：专用表格视图渲染」+「非 watcher 的 jsonl 内联预览：通用逐行树；非法 jsonl 回落纯文本」（内联分支）
- frontend/src/components/files/__tests__/preview-registry.test.ts「matchRenderer jsonl（watcher-events.jsonl 等）」×3（全屏 registry 键 + json mime 兜底语义）
- frontend/src/components/files/__tests__/file-preview-modal.test.tsx（RENDERER_MAP 注册 jsonl 渲染器接线）

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- frontend/src/components/__tests__/change-file-tree.test.tsx「固定产物树节点主显中文名 + 原名对照，非固定名维持原名」（树节点映射）
- frontend/src/components/__tests__/change-file-tree.test.tsx「选中固定产物：内容标题中文名 + 原路径对照；全屏 meta.name 恒原名」（标题映射 + 下载名不变）
- frontend/src/components/mobile/mobile-change-detail.test.tsx「文档 chip 点击打开 FilePreviewModal」（移动端 chip 接线回归，aria-label/取数锚不因中文名展示漂移）

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- frontend/src/components/changes/detail/__tests__/change-timeline-card.test.tsx 全文件（既有三段渲染/醒目态/空数据静默隐藏/失败静默隐藏/四新 kind 图标回归 + 新增折叠用例）
- frontend/src/components/__tests__/change-file-tree.test.tsx 全文件（既有树/预览/编辑/保存/全屏 15 用例回归 + 新增中文名/jsonl 4 用例）
- backend/app/modules/change/tests/test_files_router.py 全文件（15 用例回归含新增 .jsonl 断言）；flow done 实测门 test=passed（deps py25+jsx1）+ lint=passed 为整体回归证据

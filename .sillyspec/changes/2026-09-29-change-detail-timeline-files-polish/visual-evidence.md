# 视觉证据（2026-09-29-change-detail-timeline-files-polish）

## 验证环境

- 本机 dev 链路：前端 Next dev server `:3005`（实时改动代码，`INTERNAL_API_BASE_URL` 指向本机后端）+ 本机后端 uvicorn `:8002`（含 `.jsonl` 文本判定改动），连 Docker Compose 的 PG/Redis。
- 验证账号：admin（dev 库密码已重置，见文末备注）。
- 验证变更：`2026-09-28-audit-risk-fixes`（从本仓 `.sillyspec/changes/archive/` 拷入平台镜像 + reparse，含 watcher-events.jsonl 15 行与完整固定产物文件集）。
- 截图工具：项目自带 Playwright（`@playwright/test` chromium），脚本注入 localStorage 登录态后对真实页面截图；截图存 `shots/`。

## 三处改动截图结论

### 1. 时间线卡（shots/01-timeline-card.png）

- 卡头统计行正常（墙钟/事件/提交/勾选）。
- 事件时间轴：🌱 节点圆点 + 时刻（MM-dd HH:mm:ss 带日期）+ 图标 + 文本单行渲染；该变更事件流仅 1 条（born 锚，platform_change_events 无历史回填），单行无连线属预期（连线画在节点之间，末行不画；多行场景由组件测试覆盖渲染结构）。
- 任务面 10 条任务受 `max-h-[420px]` 限高保护，卡内滚动不再撑爆详情页——**限高生效证据：任务区只露出最后约 5 行，上方在滚动容器内**。
- 视觉评审（AI 图片分析）发现的非阻塞项：任务行与时间线行间距偏大（限高滚动设计的自然结果，保留）；emoji 与文字基线轻微不齐（库默认行为，不做像素级调基线）；任务描述截断有 title 悬浮提示兜底。

### 2. 变更文件弹窗中文名（shots/02-files-dialog-cn.png）

- 文件树主显中文名 + 小字英文原名对照，映射全部命中：变更提案(proposal.md)、需求规格(requirements.md)、设计方案(design.md)、决策记录(decisions.md)、流程状态(flow-state.yaml)、代码补丁(change.patch)、任务清单(tasks.md)、评审记录(review.json)、验证结果(verify-result.md)、测试轨迹(test-trace.json)、补丁清单(change-patch.json)。
- 文件夹/文件图标正常，树与预览区布局无重叠截断。

### 3. watcher-events.jsonl 预览（shots/03-jsonl-preview.png）

- 内联预览渲染为**表格视图**（表头：时刻/类型/阶段/详情），不再是原始 JSON 文本——`.jsonl` 文本判定 + FilePreview jsonl 分支 + watcher-events 专用视图三层链路端到端生效。
- 类型列中文徽章（文件出现/文件变更/任务勾选等）按 kind 着色；时刻列 MM-dd HH:mm:ss；标题栏「观测事件流」中文名 + 原路径对照。
- 全屏预览链路（preview-registry jsonl 键 + JsonlPreviewer + JsonPreviewer 名字转发）由组件测试覆盖（file-preview-modal.test/preview-registry.test/previewers-basic.test 28 用例绿），截图未重复展开。

## 用户裁决留痕

无视觉降级——三处均按原始意图实现，未发生「因约束对不齐基准而缩小范围/统一样式」需要用户签字的场景。

## 备注（环境副作用，收尾已恢复/说明）

- dev 库 admin 密码已重置为 `Dev2026!reset`（原密码为历史迁移值不可知；本项目未上线，规则 11 允许重置开发数据）。
- 平台镜像 `C:/data/spec-workspaces/b97f8231.../changes/` 下补拷了 `2026-09-28-audit-risk-fixes`（真实归档变更，reparse 入库）——本就是该工作区应有数据，保留。
- 本机 dev server(:3005)/后端(:8002) 为验证临时拉起，收尾关闭。

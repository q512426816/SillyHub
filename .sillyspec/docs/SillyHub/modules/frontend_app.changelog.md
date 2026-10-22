---
author: qinyi
created_at: 2026-09-03 14:49:48
---

# frontend_app 模块变更索引

- 2026-09-08-session-turn-nav | /sessions 会话页获得轮次刻度轨导航能力（间接——app/ 源码零改动，能力经 SessionPanelPage 组件注入；page.test.tsx +354 集成用例含 6 条轮次导航路径；详见 frontend_components 索引同日条目）
- ql-20260908-001-96a2 | /runtimes 页面去掉 1600px 限宽——外层自写 <main max-w-[1600px]> 收敛为共享 PageContainer size="full"（对齐 /settings/providers 与 FRONTEND_PAGE_STYLE 列表页「外层一律 PageContainer」规范），内容占满宽度
- ql-20260903-014-4d37 | 组织管理页布局对齐 roles 页——查询条件与列表拆两块：SectionCard 只装工具栏+搜索表单，DataTable 移出作 PageContainer 独立兄弟块（gap-4 分隔，16px 间隔），错误条改替换表格位置（roles 同款）；用户实测反馈 ql-012 按 FRONTEND_PAGE_STYLE §1 字面把三者包一张卡与 admin 三页（roles/users）实际惯例不符
- ql-20260903-013-7a5e | 组织管理页表格横向滚动条修复——ql-012 按规范 §4 传 scroll={{x:'max-content'}} 是多列宽表惯例，本页 9 列窄表被强制按内容自然宽度（~1012px）撑开，容器不足即出横向滚动条；去掉 scroll.x 与配套 fixed:'right'+onCell（无横滚时固定列无意义）、操作列放开 width 按内容收缩，列宽自适应铺满容器（实测 scrollWidth=clientWidth 无滚动条）
- ql-20260903-012-7c69 | 组织管理页 /admin/organizations 全 antd 重构——按 FRONTEND_PAGE_STYLE 规范从手搓 div 抽屉/弹窗/Toast + shadcn Button 改为 PageContainer+PageHeader+SectionCard+DataTable 树表（antd Table treeData 承载组织层级，子组织默认展开、关键词/状态客户端过滤保留祖先链）；新建/编辑统一 antd Modal+Form vertical（父组织 TreeSelect 防环禁选自身后代、edit 模式 code 只读）；删除确认 antd Modal + toast 走 useNotify（AntApp message）；新增页测试 5 用例
- 2026-10-13-sessions-portal-header-remove | 智能体会话页面（/sessions 及 workspace/change/quicklog 三 scoped 入口）页头
- 2026-10-13-load-earlier-full-turn | 动机：智能体会话页触顶加载与「回到会话开头」按 (ts,id) 复合游标固定 400 行分页，页边界会把一轮（run）切
- 2026-10-13-change-reparse-autobind-remove | 动机：reparse 首建变更行时自动绑定工作区最近活跃会话（D-007）误伤面大——闲聊/测试会话躺着中枪（2026-
- 2026-10-13-change-owner-backfill | 变更中心负责人数据大面积缺失（342 条变更 300 条 owner_id 为空，2026-09-08 后新建全为空）：
- 2026-10-14-ci-flaky-render-anchor-sweep | 动机：CI 连续逐轮暴露「mock 调用等待后同步断言渲染」型时序脆弱用例（agent-replay-body、sess
- 2026-10-14-session-preview-defect-fixes | 用户实测 2026-10-14-session-turn-preview-cards 上线后发现两缺陷：①额度耗尽失败轮
- 2026-10-14-logout-localstorage-user-data-cleanup | 动机：登出换账号后 localStorage 里按 sessionId/groupId 索引的用户数据（会话草稿、群聊草
- 2026-10-14-change-center-lineage-tag-and-filter | 变更中心列表只给轻量出身行显示「轻量」标签，完整流程变更没有任何标签，且筛选下拉里只有「轻量变更」（走 stage=th
- 2026-10-14-assets-knowledge-popup-preview | 动机：变更详情沉淀资产卡的需求规则（FR 索引）、决策蒸馏、知识触达三组条目当前点击整页跳转知识库，打断浏览；期望点击在
- 2026-10-14-decision-anchor-change-qualified | 动机：变更详情沉淀资产卡的决策蒸馏弹窗定位不准——decisions/unmapped.md 等聚合文件里多个变更各有同
- 2026-10-15-ci-recurrence-guard | CI 红灯防复发：把 2026-10-15-fix-ci-red 灭火中发现的三类漏拦（daemon api-types
- 2026-10-15-graph-type-cluster | 动机：知识图谱查询切片（neighbors/impact 等）的力场布局只有斥力/弹簧/向心，不同类型节点混成一坨视觉杂
- 2026-10-15-change-assets-graph | 变更详情页信息动线不佳（用户原话四条）：①知识图谱（画布+右侧节点详情描述）没有出现在变更详情页，要…
- 2026-10-15-pseudo-domain-migration | 用户指令：把平台仓存量伪域迁真域。背景：sillyspec 仓 2026-10-15-module-…
- 2026-10-15-workspace-session-agent-only | 工作区中新建会话不再选机器：机器已由工作区绑定决定，浮层只让用户选智能体类型
- 2026-10-16-archived-files-tab | 归档变更也要显示「文件与对账」tab：归档留档区不展示 spec 文档全貌，用户需要文件树与范围对账…
- 2026-10-16-change-center-back-keeps-list-state | 变更中心列表切「已归档」tab或翻页后点行进详情,点详情页「变更列表」返回入口回到列表会重置为进行中…
- 2026-10-16-change-title-condense-backfill | 变更中心标题提炼与存量回填
- 2026-10-16-change-center-delete-back-keeps-state | 变更详情页删除成功后 router.push 无参列表,丢 tab/页码(删归档区变更后回进行中第一…
- 2026-10-18-change-list-type-filter | 变更列表加类型标签与类型筛选
- 2026-10-19-change-list-created-sort | 变更中心列表默认按创建时间倒序
- 2026-10-19-preview-card-empty-turn-fix | 切换档案产生的静默轮（started_at 空、无日志、无 error_code 的终态轮）刷新后进…
- 2026-10-21-agent-profile-slim-default | 档案瘦身重定位为人格加技能清单并支持用户默认档案
- 2026-10-22-agent-profile-modal-restyle | 智能体档案弹窗重构与技能全选
- 2026-10-21-mobile-scan-birth-cleanup | 移动端与变更中心scan起步口径清零
- 2026-10-22-review-risk-fixes | 审查修复：原型路由防线与监听泄漏
- 2026-10-22-file-changes-card-fix | 文件变更卡采集与展示修复
- 2026-10-22-sillyspec-probe-db-missing-evict | 已删工作区探针自动淘汰与诊断增强
- 2026-10-20-session-awaiting-answer-status | 左侧会话状态补充等待回答问号

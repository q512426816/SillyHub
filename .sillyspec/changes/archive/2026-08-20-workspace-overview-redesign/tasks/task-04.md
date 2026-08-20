---
id: task-04
title: 'page.tsx 重排为四段式编排层（九块映射表逐块迁移 + ghost Collapse 分组 + forceRender 定案落地）（覆盖：FR-04, FR-05, D-201, D-203）'
title_zh: 'page.tsx 重排为四段式编排层（九块映射表逐块迁移 + ghost Collapse 分组 + forceRender 定案落地）（覆盖：FR-04, FR-05, D-201, D-203）'
author: 'qinyi'
created_at: 2026-08-20 07:51:07
priority: P0
depends_on: [task-01, task-02, task-03]
blocks: [task-05]
requirement_ids: [FR-04, FR-05]
decision_ids: [D-201, D-203]
expects_from:
  task-01:
    - contract: WorkspaceHeroHeader
      needs: [workspace, onEditInfo]
  task-02:
    - contract: WorkspaceStatsRow
      needs: [workspaceId, componentCount, activeChanges, archivedChanges, currentStage]
  task-03:
    - contract: QuickEntryGrid
      needs: [workspaceId]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
goal: >
  按 design §5 九块映射表把工作区详情页从九块纵向平铺重排为四段式编排层——段① WorkspaceHeroHeader 横幅、
  段② WorkspaceStatsRow 统计卡行、段③ QuickEntryGrid 六入口宫格、段④ antd Collapse ghost 两组分组信息区
  （基本信息默认展开 + 配置四面板默认折叠，items 全量 forceRender）；数据 hook 与编辑/保存/绑定 handler
  全保留零改动仅换容器，为 task-05 的断言同步与新增断言提供被测版式。
implementation:
  - 导入接线——从 @/components/workspace/hero-header、@/components/workspace/stats-row、@/components/workspace/quick-entry-grid 导入三组件（task-01/02/03 产物），Collapse 从 antd 导入；移除 PageHeader 导入（映射表第 1 行，page.tsx:244-259 标题区旧 JSX 删除）
  - 段① 组装——WorkspaceHeroHeader 传 workspace 与 onEditInfo（onEditInfo 接既有 setEditingInfo(true) 触发编辑态；编辑中 hero 入口禁用由 task-01 组件内部处理）
  - 映射表第 2 行——pageError 错误条（page.tsx:261-265）保留在 hero 横幅下方原位不动
  - 段② 组装（映射表第 6 行）——原 Overview 统计四卡 section（page.tsx:470-487）整段删除，改挂 WorkspaceStatsRow 传五 props（workspaceId/componentCount/activeChanges/archivedChanges/currentStage，四个统计 state 全部留编排层）
  - 段③ 组装（映射表第 10 行）——快速入口六项按钮堆（page.tsx:521-540）整段删除，改挂 QuickEntryGrid 只传 workspaceId（入口集维持 6 项现状不加戏）
  - 段④ Collapse 骨架——Collapse 传 ghost 并关边框（无外框背景，避免与子组件自带 SectionCard 形成卡中卡）；两组——「基本信息」defaultActiveKey 展开、「配置」组四面板默认折叠（D-203）；ghost 与 items 元素 extra/forceRender 字段已在 antd 6.4.4 Collapse.d.ts 与 rc-collapse interface.d.ts 核实存在
  - 「基本信息」面板（映射表第 3/4 行）——原基本信息 SectionCard（page.tsx:268-405）内容原样迁入——dl 只读行（WorkspacePathFields/创建于/最后扫描/类型/角色/用途）+ editingInfo 编辑表单 JSX 留编排层 + 面板底部 WorkspaceDaemonSwitcher（page.tsx:398-404 位置不变仅换容器）；编辑态取消/保存按钮从 SectionCard extra 迁到该面板 item extra（取消回填草稿/保存 handleSaveBasicInfo 逻辑不动）
  - 「配置」组四面板（映射表第 5/7/8/9 行）——默认智能体提供方 JSX（page.tsx:408-467）原样迁入面板一（defaultAgent/defaultModel state 与 handleSaveDefaultAgent 留编排层）；LinkedProjectsSection（page.tsx:491）面板二组件原样；WorkspaceConfigCard（page.tsx:494-502）面板三 props 原样；守护进程共享 SectionCard（page.tsx:507-518）面板四原样迁入且 myBinding 存在才挂该面板（条件渲染保持）
  - §8 定案落地——两组全部 items 每项 forceRender 填 true（生产同传，plan 阶段修订注定案）——放弃懒加载收益，换取与现状加载即挂载的 API 时序严格等价（懒渲染会推迟 LinkedProjectsSection/WorkspaceConfigCard 的数据请求，那才是行为改变）
  - 清理——删除不再使用的导入与被替换旧 JSX；PageContainer full 外层容器、loading 早退、workspace 空态早退三处保持；预期收敛至约 450-480 行编排层（D-202 修订口径）
acceptance:
  - design §5 映射表 10 行逐块对账无遗漏——每行现状块在新版式有唯一去向（R-01 核对清单，含 WorkspaceDaemonSwitcher 面板底部与守护共享条件渲染两处易漏点）
  - 行为等价——load() 七路 Promise.all、两处 useEffect、handleSaveBasicInfo/handleSaveDefaultAgent 逐字未动；不新增任何 API 调用（hero 不放重新扫描，design §2 零改动承诺）
  - Collapse 两组形态正确——基本信息 defaultActiveKey 展开；配置四面板默认折叠；两组全部 items forceRender 为 true；ghost 无外框无卡中卡
  - 守护进程共享面板仅 myBinding 存在时挂载（条件渲染保持）；WorkspaceDaemonSwitcher 位于基本信息面板底部
  - pnpm typecheck 0 error；既有 page.test 8 用例经 forceRender 挂载预期仍全绿；page.tsx 约 450-480 行编排层（D-202）
verify:
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm test -- page.test
  - cd frontend && pnpm lint
constraints:
  - 不新增 API 调用、不改任何 hook/load/保存/绑定逻辑（handleSaveBasicInfo/handleSaveDefaultAgent/load 与两处 useEffect 原样保留，design §3 非目标）
  - 既有子组件 WorkspaceConfigCard/LinkedProjectsSection/SharedDaemonToggle/WorkspacePathFields/WorkspaceDaemonSwitcher 内部零改动仅换挂载容器
  - 编辑态取消/保存按钮留基本信息面板 extra（hero 编辑入口编辑中禁用交互归 task-01）；编辑表单 JSX 留编排层不拆（D-202 修订注，拆走需迁 handler 得不偿失）
  - 不改 page.test.tsx（既有断言同步与新增统计/入口断言归 task-05 卡）
  - 样式全走 brand 阶/主题 token，多主题铁律见 FRONTEND_PAGE_STYLE §0.5（渐变 blue 主题自动回旧蓝）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->

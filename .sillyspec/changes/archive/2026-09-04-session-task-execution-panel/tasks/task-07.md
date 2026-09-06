---
id: task-07
title: '前端面板组件——TaskExecutionPanel（折叠摘要行 + 任务清单/运行中/轮次历史三页签，复用三类卡，brand-* 双主题）'
title_zh: '前端面板组件——TaskExecutionPanel（折叠摘要行 + 任务清单/运行中/轮次历史三页签，复用三类卡，brand-* 双主题）'
author: 'qinyi'
created_at: 2026-09-05 00:19:30
priority: P0
depends_on: [task-05, task-06]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-07]
decision_ids: [D-004@v1]
provides:
  - contract: TaskExecutionPanel
    fields: [sessionId, runningTasks, bashProgress, teamMissions, runsRefreshSignal]
allowed_paths:
  - frontend/src/components/daemon/task-execution-panel.tsx
expects_from:
  task-05:
    - contract: applyAgentTaskStatusEvent
      needs: [applyAgentTaskStatusEvent, AgentTaskEntry]
  task-06:
    - contract: useSessionTasks
      needs: [tasks, applyEvent, loading]
goal: >
  新建独立组件 task-execution-panel.tsx——折叠态一行摘要（运行中 N·任务 M 成功 X 失败 Y·轮次 K）+
  展开态三页签（任务清单/运行中/轮次历史），让用户在会话头部一眼看到任务执行进度
  （design 方案 B / D-004，UI 对照原型 prototype-task-execution-panel.html）。
implementation:
  - 实现前核对 R-07（plan_mode_entered 历史回放链路）——锚定结论：streamSession 的 resync/首连缺口同步 syncGapFromDb（lib/daemon.ts L1994 一带）仅回放 log 事件 + 合成 turn_started/turn_completed，不回放 plan_mode_entered（onPlanModeEntered 只在实时 SSE 分发触发，session-panel.tsx L1808/L4874）→ 回放不可靠成立，计划 objective 总纲按 design R-07 降级「仅活跃轮显示」（内存态，刷新/重连后不显示、不报错），裁定写入组件头注释
  - 折叠条形态对照 AgentLogCard（agent-log-card.tsx——图标 + 一行摘要 + 点击展开）与原型 .tep-bar——「⚙ 任务执行 · 运行中 N · 任务 M（成功 X / 失败 Y）· 轮次 K」，点击切换展开/收起；与 AgentLogCard 空态返回 null 不同，本面板折叠条常驻（FR-01 常驻形态，空数据显示 0 计数）
  - 任务清单页签——组件内调 useSessionTasks(sessionId) 取 tasks 渲染行（状态圆标 / 任务名 / 正在做什么摘要 / 耗时 / tokens / 工具数，终态定格 pill，按 updated_at 新→旧）；活跃轮有计划时顶部渲染 objective 总纲条（仅内存态，R-07 降级）；plan 事件来源对照 session-panel 既有 onPlanModeEntered/planPending 链路，不经 props 重复传
  - 运行中页签——纯展示注入 props（runningTasks / bashProgress / teamMissions），原样复用 agent-task-card / bash-progress-card / team-task-block 三类卡，编排方式对照 activity-catalog.tsx（L155-201 三类卡挂载），不新建数据链路
  - 轮次历史页签——组件内 useEffect 自取数 listSessionRuns（SessionUsageBar 的 refreshSignal 自取数模式，session-usage-bar.tsx 先例，零 react-query），runsRefreshSignal prop 递增触发重拉；紧凑行（轮次号 / 状态 / 耗时 / tokens / 发送者，对照原型 .turn-row）
  - 空态文案（D-003 多引擎降级）——任务清单空「暂无任务记录（当前引擎未上报任务事件）」；运行中空「当前无运行中任务」；轮次空「暂无轮次记录」；不报错、不阻塞对话流
  - 样式——brand-* 语义阶 + 主题 token（对照 frontend/src/styles/themes.ts 双主题）；状态色走语义阶（成功/失败/运行/停止）；展开内容区 max-height 内部滚动（原型 300px 量级，R-04 防挤压输入区）；禁 md: 视口断点前缀做容器内布局（page/dialog/mobile 由挂载方宽度自适应）
acceptance:
  - 折叠态一行摘要计数正确（运行中 N / 任务 M 成功 X 失败 Y / 轮次 K），点击展开显示三页签、再点收起
  - 任务清单页签渲染快照合并列表行（状态圆标 + 任务名 + 摘要 + 耗时 / tokens / 工具数），终态定格显示不回退
  - 运行中页签复用三类卡渲染（AgentTaskCard / BashProgressCard / TeamTaskBlock），数据与 ActivityCatalog 同源一致
  - 轮次历史页签显示紧凑轮次列表，runsRefreshSignal 递增后重拉刷新
  - 三页签空态均有中文文案且不报错（D-003）；计划总纲仅活跃轮显示（R-07 降级落地，刷新后不显示不报错）
  - 样式无 blue-* 硬编码、无 md: 容器内布局断点；antd 组件色经 ConfigProvider token
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/agent-task-card.test.tsx src/components/daemon/__tests__/bash-progress-card.test.tsx src/components/daemon/__tests__/team-task-block.test.tsx（复用三类卡零改动冒烟；面板自身用例归 task-10）
constraints:
  - 不改 session-panel.tsx（挂载接线归 task-08）；本任务只新增独立组件文件
  - 原型 prototype-task-execution-panel.html 是形态对照不是像素照抄
  - antd 组件色走 ConfigProvider token 不手写；blue-* 阶仅限真信息蓝/外部标识色（运行中状态用既有语义阶与主题 token）
  - props 等值注入纯展示——运行中数据不经 props 重复请求；轮次页签自取数对齐 SessionUsageBar 先例；不新建 SSE 连接
  - R-07 降级裁定（计划总纲仅活跃轮显示）记录在组件头注释，防后人误当 bug 修
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->

---
id: task-08
title: '前端挂载接线——session-panel page/dialog/mobile 三挂载点 + SSE 分发处 applyEvent 接线'
title_zh: '前端挂载接线——session-panel page/dialog/mobile 三挂载点 + SSE 分发处 applyEvent 接线'
author: 'qinyi'
created_at: 2026-09-05 00:19:30
priority: P0
depends_on: [task-05, task-07]
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-004@v1]
allowed_paths:
  - frontend/src/components/daemon/session-panel.tsx
expects_from:
  task-07:
    - contract: TaskExecutionPanel
      needs: [sessionId, runningTasks, bashProgress, teamMissions, runsRefreshSignal]
goal: >
  把 task-07 的 TaskExecutionPanel 等值接入 session-panel.tsx 三个挂载点（page / dialog / mobile），
  并在两处 SSE onAgentTaskStatus 分发回调追加 useSessionTasks.applyEvent 接线，
  让三种会话形态都能常驻任务面板且既有行为零回归（R-01 红线）。
implementation:
  - page 模式挂载——AgentLogCard 同层（session-panel.tsx L4098 一带，横幅之下、会话主体之上）插入 TaskExecutionPanel（sessionId=session.id、runningTasks=既有 agentTasks state 中 status 为 running 的子集、bashProgress、teamMissions、runsRefreshSignal=usageRefresh）；数据与 ActivityCatalog（L3791 一带）完全同源，不新建 state
  - mobile 分支挂载——page 模式 mobile 头部（L3978 一带 ActivityCatalog 同区）同款组件内联挂载，对照既有 mobile 挂载先例，窄屏布局由组件宽度自适应承担
  - dialog 模式挂载——/runtimes 弹窗头部（L5892 一带 ActivityCatalog / L6061 SessionUsageBar 附近）同款挂载；折叠态仅一行常驻，不挤压弹窗纵向空间（R-04）
  - SSE 接线——page（L1838）与 dialog（L4904）两处 onAgentTaskStatus 回调在既有 setAgentTasks(...applyAgentTaskStatusEvent) 之后追加调用 applyEvent(event)；applyEvent 经 ref 桥接（establishStream 定义早于 hook 调用的 use-before-define，对照 queueRefreshRef 先例 L4583 一带），不重建 SSE、不新建第二条连接
  - useSessionTasks(sessionId) 在 page / dialog 两个组件分支各调用一次，tasks 数据只喂 TaskExecutionPanel 任务清单页签，不影响既有 agentTasks 链路
  - runsRefreshSignal 复用两分支既有 usageRefresh state（轮终态递增信号已存在，dialog 分支见 L4586 一带），不新增信号源
acceptance:
  - page / mobile / dialog 三形态会话均显示任务执行折叠条，展开三页签数据正常；运行中页签与 ActivityCatalog 同源一致
  - SSE agent_task_status 事件同时驱动既有 AgentTaskCard 链路（行为不变）与任务清单页签实时更新
  - turn_completed 轮终态后轮次历史页签刷新（usageRefresh 信号复用生效）
  - session-panel 既有测试零改动全绿（/runtimes 弹窗零回归硬约束）
  - cd frontend && pnpm exec tsc --noEmit 零错误
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/session-panel（路径子串匹配全部 session-panel-* 既有测试，零改动全绿）
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/agent-task-card-lifecycle.test.tsx（直接 import 归约函数的既有引用不破坏）
constraints:
  - R-01 红线——6567 行巨石组件只加挂载 JSX 与事件接线，不改既有结构 / handler 语义 / 渲染顺序 / 既有样式；归约等值重构已在 task-05 完成，本任务零重构
  - 挂载行号（L4098 / L3978 / L5892 / L1838 / L4904）是调研快照导航锚点（design 自审存疑 2），execute 时以实际代码为准定位
  - 不新建 SSE 连接、不新建第二条任务数据链路——applyEvent 挂既有 onAgentTaskStatus 分发回调，快照由 useSessionTasks 自取
  - /runtimes 弹窗纵向空间约束（R-04）——只挂折叠条形态，展开态由组件内部 max-height 滚动兜底，不动弹窗既有布局
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

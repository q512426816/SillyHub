---
id: task-14
title: 'team-task-block 分身行点击复用 session-panel 打开'
title_zh: 'team-task-block 分身行点击复用 session-panel 打开'
author: 'qinyi'
created_at: 2026-08-25 20:57:40
priority: P0
depends_on: ['task-13']
blocks: [task-15]
requirement_ids: [FR-08]
decision_ids: []
allowed_paths:
  - frontend/src/components/daemon/team-task-block.tsx
  - frontend/src/components/daemon/session-panel.tsx
  - frontend/src/components/daemon/__tests__/team-task-block.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-team.test.tsx
expects_from:
  task-13:
    - contract: TeamMissionWorkerSummary
      needs: [sub_session_id]
goal: >
  给团队任务块的分身行一个最小 UI 入口——有 sub_session_id 的分身行可点击，
  复用既有 session-panel 打开该子会话（实时流 + 追问），让发起人直接看分身
  干了什么并插话（design §5.E / FR-08 验收路径，P1 只做点击入口）。
implementation:
  - team-task-block.tsx props 增可选回调 onOpenWorkerSession（参数 subSessionId）——分身行 w.sub_session_id 非空时行主体可点击触发；存量 run 行无该字段不渲染点击态；行尾日志与产物按钮 stopPropagation 不误触打开
  - 行可点击视觉——hover 高亮与「查看会话」入口标识（AI-Native 双主题 token，brand-* 语义阶），用 button 语义保证键盘可达
  - session-panel.tsx 两处 TeamTaskBlock 渲染点（约行 2324 page 态与约行 3926 dialog 态）接线——面板内维护查看分身 state，触发后以浮层复用 SessionPanel（mode=dialog、sessionId=分身 sub_session_id、attach 续聊形态），实时流与追问全走面板既有链路，关闭返回主控面板
  - 补测试——team-task-block.test.tsx 断言有 sub_session_id 行触发回调、无字段行不可点、按钮不冒泡；session-panel-team.test.tsx 断言回调后浮层渲染 SessionPanel 且 sessionId 正确、关闭还原
acceptance:
  - 派团队后新形态分身行显示可点击入口，点击出现该分身的会话面板（实时流可见、输入框可追问）
  - 存量 batch 分身行（无 sub_session_id）无点击行为，团队块其余交互（取消、日志、产物、展开折叠）零回归
  - 关闭分身面板回到主控会话视图，主控流与输入状态不丢
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/team-task-block.test.tsx src/components/daemon/__tests__/session-panel-team.test.tsx
  - cd frontend && pnpm test
constraints:
  - 复用 session-panel 打开，不新建任何分身专用面板或流渲染组件（design §5.E；流与追问逻辑零复制）
  - 点击区与既有日志/产物按钮互不干扰（嵌套可点元素须 stopPropagation）
  - 样式遵循 AI-Native 双主题 token（CLAUDE.md 规则 20），团队 violet 固定身份色仅按既有团队语义沿用
  - 不改 TeamMissionWorkerSummary 类型定义（归 task-13 已落地）；api-types 已含 sub_session_id 后本卡才可引用
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->

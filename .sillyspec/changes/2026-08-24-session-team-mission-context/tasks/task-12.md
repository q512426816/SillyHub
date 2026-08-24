---
id: task-12
title: '前端弹层探测+主 agent 选择器——probe 一次拉取+机器名/在线/git 模式标签+选择器（仅 preSession 实例）'
title_zh: '前端弹层探测+主 agent 选择器——probe 一次拉取+机器名/在线/git 模式标签+选择器（仅 preSession 实例）'
author: 'qinyi'
created_at: 2026-08-24 19:01:09
priority: P0
depends_on: ['task-07', 'task-10']
blocks: [task-13]
requirement_ids: [FR-03, FR-06]
decision_ids: [D-008@v2, D-010@v1]
allowed_paths:
  - frontend/src/components/daemon/team-trigger-popover.tsx
  - frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx
provides:
  - contract: preSession_popover
    file: frontend/src/components/daemon/team-trigger-popover.tsx
    fields: [preSession, orchestrator_workspace_id]
    consumers: [task-13]
expects_from:
  task-10:
    - contract: workspaces_probe_response
      needs: [workspace_id, git_mode, daemon_name, daemon_online]
  task-07:
    - contract: TeamMissionCreateBlock
      needs: [orchestrator_workspace_id]
goal: >
  TeamTriggerPopover 弹层打开时对 scope 候选工作区一次 probe（不轮询），工作区行
  显示 机器名（display_alias||hostname）+在线 dot+git 模式标签（未绑显示「未绑机器」）；
  新增 preSession prop——仅预会话实例渲染主 agent（项目经理）选择器（默认「当前会话」，
  scope 工作区选项带机器状态、离线/未绑禁选，落 orchestrator_workspace_id）——
  FR-03 弹层机器状态 + FR-06 选择器的组件侧落地。
implementation:
  - '弹层打开（组件 mount）即对当前已知候选集（workspaceId + 已加载的项目关联工作区）调一次 POST /api/workspaces/probe（组件文件内 module-level 函数，经 @/lib/api apiFetch，响应按 task-10 契约本地类型）存 state 静态快照；项目切换导致候选集变化时事件驱动补拉一次，无 setInterval/轮询（design §5.C）'
  - '工作区行（scope 多选列表 + 「当前工作区」单选卡）meta 行渲染：机器名=probe.daemon_name（display_alias||hostname 后端口径）+ 在线 dot（绿=daemon_online/灰=离线，原型 .dot.on/.off 形态）+ git 模式标签（git→「git 隔离」/ direct→「非 git · 直通」/ unknown→弱化「模式未知」）；未绑（daemon_name=null）显示「未绑机器」+虚线 dot（原型 .dot.none）'
  - 'TeamTriggerPopoverProps 新增 preSession?: boolean（默认 false）——仅 true 时渲染「主 agent（项目经理）」选择器（原型场景③）：选项=「当前会话（默认：用上方选择的机器与智能体）」+ scope 已选工作区各行「<name> · <机器名>（该工作区设备与智能体）」；daemon_online=false 或未绑 → option disabled（「机器离线」/「未绑机器」）；选择 state 默认「当前会话」'
  - 'handleConfirm：payload 在既有 TeamMissionTriggerRequest 基础上，preSession 实例追加 orchestrator_workspace_id（组件内类型交集 TeamMissionTriggerRequest & { orchestrator_workspace_id?: string | null }，不动 lib/daemon.ts——类型扩展归 task-13）；选「当前会话」=null、选工作区=其 id；preSession 实例确认按钮文案「派团队（随首句创建生效）」对齐原型场景③'
  - '既有（非 preSession）实例零变化：props 缺省 preSession=false 不渲染选择器、payload 不含 orchestrator_workspace_id；probe 数据仅用于展示，不改变确认校验与 payload 组装既有逻辑'
  - '补测试（team-trigger-popover.test.tsx，仅 mock 网络层）：① 弹层打开调 probe 一次（切项目补拉，无重复轮询）② 工作区行机器名/在线 dot/git 模式标签/未绑机器渲染 ③ preSession=true 渲染选择器且离线/未绑 option disabled、preSession=false（缺省）不渲染 ④ 确认 payload——选工作区带 orchestrator_workspace_id=该 id、默认「当前会话」=null、非 preSession 实例不带该字段 ⑤ probe 失败 → 标签缺失/弱化不阻断弹层可用（fail-safe）'
acceptance:
  - '弹层打开调用一次 probe（mock 断言单次 fetch，无定时器/轮询）；probe 结果为静态快照驱动展示'
  - '工作区行显示 机器名（display_alias||hostname 口径来自 probe.daemon_name）+ 在线 dot + git 模式标签（git 隔离/非 git · 直通/模式未知）；未绑机器显示「未绑机器」'
  - '主 agent 选择器仅 preSession 实例渲染（新增 prop，缺省 false）；默认选「当前会话」；scope 工作区选项带机器状态，离线/未绑禁选（disabled）'
  - '确认 payload 含 orchestrator_workspace_id（选工作区=其 id，默认当前会话=null）；非 preSession 实例 payload 与渲染逐字节不变（既有用例不改断言全绿）'
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/team-trigger-popover.test.tsx
  - cd frontend && pnpm test
constraints:
  - '遵循 AI-Native 双主题 token（CLAUDE.md 规则 20）：品牌色 brand-* 语义阶、团队 violet 固定身份色、阴影 shadow-* 主题 token，对照原型场景①②③（prototype-team-mission-context.html .dot/.tag 形态）'
  - 'workspace-daemon-status.ts 不动（不引入 useDaemonStatusMap——无机器名字段且仅本人 bindings，D-008@v2）；机器状态唯一数据源=POST /workspaces/probe'
  - '不动 lib/daemon.ts（probeWorkspaces client 与 createSession 扩展归 task-13，届时可把组件内 probe 函数迁 lib，行为不变）；session-panel 接线/preSession 传参归 task-13'
  - '组件纯 props 受控不调业务 API 的既有纪律仅对 trigger 类调用——probe 为只读展示数据源，组件内直调允许（同 listProjects 先例）；不用 antd、不依赖 react-query（弹层渲染路径铁律 R4）'
  - '既有会话实例不渲染主 agent 选择器（进程 cwd/机器创建时钉定，跨机器迁移属 C 层非目标）——仅以 tooltip/说明文案表达，不加交互'
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

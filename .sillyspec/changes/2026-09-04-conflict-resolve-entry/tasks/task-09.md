---
id: task-09
title: 'Frontend platform sync card (platform-sync-section + access hook + desktop/mobile mount + echo and 150s recovery + component tests + zero regression on both page suites)'
title_zh: '前端平台同步卡片（platform-sync-section 组件 + 权限 hook + 桌面/移动挂载 + 回显与 150s 恢复 + 组件测试 + 两页面既有测试零回归）'
author: 'qinyi'
created_at: 2026-09-04 22:40:15
priority: P0
depends_on: ['task-08']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05]
decision_ids: [D-002@v1, D-003@v1]
allowed_paths:
  - frontend/src/components/changes/platform-sync-section.tsx
  - frontend/src/components/changes/__tests__/platform-sync-section.test.tsx
  - frontend/src/lib/use-machine-sync-action-access.ts
  - 'frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx'
  - 'frontend/src/app/m/workspaces/[id]/changes/page.tsx'
  - 'frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx'
  - 'frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx'
goal: >
  变更中心页新增「平台同步」处理区卡片（原型 prototype-conflict-resolve.html）——列出本机
  未决同步冲突与 ghost 残留，行内一键裁决与一键清理（危险确认弹窗 + 心跳回显 + 150s 无回报
  恢复），机器所有者与平台管理员可操作、其他成员只读，桌面与移动两页面挂载且零回归。
implementation:
  - 新建 lib/use-machine-sync-action-access.ts（useMachineSyncActionAccess）——仿 delete-change-confirm 的 useChangeDeleteAccess 先例（session store 取 userId 与 is_platform_admin + fetchMe react-query 缓存），比对 machine.owner 的 user_id，仅控按钮显隐、后端权威（D-003@v1）
  - 新建 components/changes/platform-sync-section.tsx——数据链复刻 changes-overview-card——fetchMyBinding(workspaceId).daemon_id → useDaemonMachines（15s 轮询）按 id 匹配 → 读 machine.sillyspec_status 与 machine.sillyspec_command_result；无绑定或无 sillyspec_status 时整卡不渲染（return null）
  - 冲突行（pending_conflicts[]）——type 徽章（spec 树=紫 / 进度=琥珀）+ 变更名 mono + 活跃警示（冲突名出现在 changes[] 即活跃 → ⚠ 徽标 + 弹窗加重文案，不硬禁）+ 保本地 / 取平台按钮（取平台 danger）
  - ghost 区——ghost_count + changes[] 中 ghost=true 清单（≤50）+ 一键清理 danger 按钮（ghost=0 时禁用）；两区操作均走 antd App.useApp() 的 modal.confirm（okType danger 用于取平台与清理），文案按原型 STRATEGY_TEXT，清理弹窗如实写明波及范围（幽灵记录 + 超 7 天空壳目录）
  - 回显——下发后按钮置「已下发 · 等待机器回报」；sillyspec_command_result 的 action 与 change 匹配本次下发即认定回报（executed_at 为机器本地钟仅辅助，跨机不比较）→ 成功 toast（行随快照 ≤60-75s 消失）/ 失败红字摘要 + 恢复重试；150s 无回报恢复可重试（执行上限 120s + 一个心跳周期，兼容旧 daemon 静默忽略）
  - 挂载——桌面 changes/page.tsx 在「解析警告」SectionCard（约 :708-719，按符号定位）之后、主 tab 之前挂 PlatformSyncSection；移动镜像页 m/workspaces/[id]/changes/page.tsx 同步挂载
  - 新建 __tests__/platform-sync-section.test.tsx——渲染/隐藏、权限 gating、回显成败、150s 恢复（fake timers）；两页面既有测试若因挂载断言失效 → 仅补 mock 接线，不改既有用例断言语义
acceptance:
  - 渲染/隐藏两分支与权限 gating 用例——无绑定或 sillyspec_status 为 null 不渲染；owner / 平台管理员见操作按钮，其他成员只读（仅清单与计数）
  - 回显用例——command_result 的 action 与 change 匹配触发成功 toast；失败态显示红字摘要并出现恢复重试按钮
  - 150s 无回报恢复（fake timers 推进后按钮恢复可点）、ghost=0 清理按钮禁用、活跃警示徽标出现但冲突行按钮不硬禁，各有独立断言
  - 桌面与移动两页面均挂载 PlatformSyncSection，两页面既有测试零回归（如适配仅限 mock 接线）
  - 组件测试全绿 + 前端测试套件全绿 + tsc 0 错
verify:
  - cd frontend && pnpm exec vitest run src/components/changes/__tests__/platform-sync-section.test.tsx && pnpm test && pnpm exec tsc --noEmit
constraints:
  - 样式遵循 FRONTEND_PAGE_STYLE 与 AI-Native 双主题（brand-* 语义阶、主题 token、antd 组件色经 ConfigProvider 不手写），视觉基准为本变更 prototype-conflict-resolve.html
  - 仅消费 task-08 产物（lib/daemon.ts 两触发函数与 api-types 生成版读模型），不改 lib/daemon.ts 与 api-types.ts；abort 裁决不上页面；不做离线排队与 daemon 版本门控
  - 页面既有测试适配仅限新挂载组件的 mock 接线，禁止改动既有用例的业务断言语义
expects_from:
  - 'task-08 —— lib/daemon.ts 的 triggerMachineSillySpecResolve(instanceId, change, strategy) 与 triggerMachineSillySpecGhostCleanup(instanceId) 两函数 + api-types 生成版 MachineSillySpecStatusRead（pending_conflicts / ghost_count / changes[].ghost）与 MachineSillySpecCommandResultRead（sillyspec_command_result）读模型'
related_tests:
  - 'frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx'
  - 'frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx'
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

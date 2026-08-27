---
id: task-10
title: '前端会话选择器——机器候选含共享机器（共享徽标三入口：floating-host + 门户 session-config-bar.tsx + use-daemon-machines.ts 数据源，回退链逻辑不变 D-004@v2）+ 档案选择器共享智能体标识 + session-panel「平台共享」徽标 + 组件测试'
title_zh: '前端会话选择器——机器候选含共享机器（共享徽标三入口：floating-host + 门户 session-config-bar.tsx + use-daemon-machines.ts 数据源，回退链逻辑不变 D-004@v2）+ 档案选择器共享智能体标识 + session-panel「平台共享」徽标 + 组件测试'
author: 'qinyi'
created_at: 2026-08-28 01:24:05
priority: P1
depends_on: ['task-08']
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-004@v2]
allowed_paths:
  - frontend/src/lib/use-daemon-machines.ts
  - frontend/src/components/floating/floating-session-host.tsx
  - frontend/src/components/floating/floating-session-host.test.tsx
  - frontend/src/components/sessions/session-config-bar.tsx
  - frontend/src/components/sessions/__tests__/session-config-bar.test.tsx
  - frontend/src/components/daemon/session-panel.tsx
  - frontend/src/components/daemon/__tests__/session-panel-platform-shared.test.tsx
related_tests:
  - frontend/src/components/floating/floating-session-host.test.tsx
  - frontend/src/components/sessions/__tests__/session-config-bar.test.tsx
expects_from:
  task-09:
    - contract: SharedAgentsApi
      needs: [fetchSharedAgentsActive]
goal: >
  会话创建的机器选择器候选并入共享给我的机器（共享徽标三入口——floating-host/门户 session-config-bar/use-daemon-machines 数据源），档案选择器补共享智能体标识，会话头显示「平台共享」徽标；悬浮助手回退链逻辑零改动（D-004@v2 用户显式选择）。
implementation:
  - use-daemon-machines.ts 的 DaemonMachinesData 增加 sharedToMe 透传（类型取 task-08 api-types 的 shared_to_me 块），15s 轮询/queryKey/sessions 降级语义不变
  - floating-session-host.tsx 把 sharedToMe 机器并入传给 PreSessionPicker 与 SessionPanel 的机器候选（在线过滤沿用，共享行呈现「共享」标识）；resolveDefaultMachineId 三级回退链（102-130 行）零改动
  - session-config-bar.tsx 机器下拉候选 = 自有 + 共享给我的，共享项带共享徽标（D-004@v2 用户显式选择）
  - session-panel.tsx 档案选择器共享智能体标识（对照 fetchSharedAgentsActive 生效列表）+ 会话头元信息区「平台共享」徽标
  - 更新 floating-session-host / session-config-bar 既有测试断言 + 新增 session-panel 平台共享徽标测试
acceptance:
  - 机器选择器三入口（悬浮抽屉/门户配置条/共享数据源）均呈现共享机器且带共享徽标
  - 悬浮助手默认解析与回退链行为与现状完全一致（既有断言零改动通过，D-004@v2 不做自动回退）
  - 选中共享智能体的会话头显示「平台共享」徽标（文案不是只读）
  - 档案选择器中共享智能体带共享标识
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test src/components/floating/floating-session-host.test.tsx src/components/sessions/__tests__/session-config-bar.test.tsx src/components/daemon/__tests__/session-panel-platform-shared.test.tsx
constraints:
  - 悬浮助手回退链逻辑零改动（floating-session-host.tsx 102-130 行不做自动回退，D-004@v2）
  - 徽标文案用「平台共享」，不出现「只读」
  - 涉及后端字段以 task-08 生成的 api-types 为准（SharedAgentActiveView/shared_to_me），禁止手写
  - useDaemonMachines 仅加 sharedToMe 透传，不改既有返回结构与轮询语义
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

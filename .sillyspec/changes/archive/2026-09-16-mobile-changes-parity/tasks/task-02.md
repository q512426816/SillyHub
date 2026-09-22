---
id: task-02
title: 'mobile-change-card-info-enhancement'
title_zh: 'MobileChangeCard 信息增强——活动徽标 ChangeActivityBadge + 元信息行（负责人三态/影响组件）+ 执行用量行（UsageExecCell 移动化，两档判空）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-16 21:19:19
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-003@v1, D-005@v1]
allowed_paths:
  - frontend/src/components/mobile/mobile-change-card.tsx
  - frontend/src/components/mobile/mobile-change-card.test.tsx
target_files:
  - frontend/src/components/mobile/mobile-change-card.tsx
  - frontend/src/components/mobile/mobile-change-card.test.tsx
goal: >
  移动变更卡片补齐桌面列表同源信息（D-003 ②）：徽标行挂 ChangeActivityBadge、
  新增元信息行（负责人三态/影响组件）与执行用量行（UsageExecCell 移动化两档判空），
  全部复用既有组件与 task-01 导出的格式化 helper（D-005 复用挂载路线）。
implementation:
  - 徽标行（ChangeStepBadge + 待办徽标旁）挂 ChangeActivityBadge：currentStepStatus=step_progress?.current_step_status ?? null、lastPushedAt=last_pushed_at ?? null（与桌面 :471-474 同源）
  - 元信息行：负责人三态对齐桌面 renderOwner :445-457（owner_name 非空→用户名；空且 owner_id 有值→前 8 位 mono 弱化；双空→「—」）；影响组件 affected_components.join(", ") 空数组整段省略 + truncate 单行
  - 用量行（复用 task-01 helper 在卡片内自绘，不复制 UsageExecCell 组件）：usage undefined→整行不渲染 / null→「—」；有值→formatDurationZh(duration_ms) + 进行中 pill（started_at 有且 finished_at 缺）+ formatTokensCompact(四维 token 之和) tok · formatCount(api_requests) 次；起止时间不展示（移动无 hover，详情页用量卡兜底）
  - 新增行弱化色 + 分隔虚线（R-02，原型已定稿）；更新 mobile-change-card.test.tsx：makeChange 显式声明 usage，修正新增行导致的「—」多匹配断言，补负责人三态/用量两档/活动徽标挂载用例
acceptance:
  - FR-02 逐条满足：负责人三态 / 影响组件空省略 / usage null「—」/ undefined 整行不渲染 / 进行中 pill / ChangeActivityBadge 挂载（三态由组件真值表决定）
  - MobileChangeCard props 签名不变（change/onClick），整卡仍单一 button 且触摸热区 ≥44px；tsc 零错误
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test -- src/components/mobile/mobile-change-card.test.tsx
constraints:
  - 禁止复制桌面 UsageExecCell 为独立组件——复用 task-01 导出的三个 helper 自绘移动行（D-005）
  - usage 两档判空语义锁定：undefined 整行不渲染、null 显示「—」（桌面先例，兼容策略基线）
  - 整卡单一 button：触摸热区 ≥44px、正文 ≥14px、语义 token 无写死色值；空值段省略不占行
expects_from:
  task-01:
    - contract: format-helpers
      needs: [formatTokensCompact, formatCount, formatDurationZh]
related_tests:
  - frontend/src/components/mobile/mobile-change-card.test.tsx
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->

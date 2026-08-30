---
id: task-12
title: 'frontend 活动徽标（真值表三态 + ISO_LIKE_RE 防御解析 + 详情页最后信号）'
title_zh: 'frontend 活动徽标（真值表三态 + ISO_LIKE_RE 防御解析 + 详情页最后信号）'
author: 'qinyi'
created_at: 2026-08-29 12:57:58
priority: P1
depends_on: ['task-11']
blocks: []
requirement_ids: [FR-09]
decision_ids: [D-007@v1]
expects_from:
  - 'task-11：ChangeSummary.last_pushed_at（可空 ISO 字符串原文，无服务端校验）'
allowed_paths:
  - 'frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx'
  - 'frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx'
  - 'frontend/src/components/changes/change-activity-badge.tsx'
  - 'frontend/src/components/changes/__tests__/change-activity-badge.test.tsx'
  - 'frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx'
  - 'frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx'
goal: >
  列表「待办状态」列旁加活动徽标三态（进行中/停滞/空闲）+ 详情页头部「最后信号」，
  让纯 CLI 变更的进行中状态可感知，消除「每阶段完成平台才知道」盲区（design §8.1
  前端半，消费 task-11 的 last_pushed_at）。
implementation:
  - '新建徽标组件 frontend/src/components/changes/change-activity-badge.tsx（可并入 page.tsx，独立组件+单测优先）：真值表 f(current_step_status, last_pushed_at 年龄)——active 且最后信号 ≤ 30min → 「进行中 · x 分钟前」（既有蓝色脉动点从纯动画变为真实信号）；active 且 > 30min → 灰色「停滞 · 最后信号 x 分钟前」（只陈述事实，不断言挂死，R-12）；waiting 或 null（step_progress 缺失）→ 空闲态，显示最后活动时间'
  - 'current_step_status 取 c.step_progress.current_step_status——服务端由「第一个非 completed 步 + wait_reason」推导（service.py:2122-2130），仅 active/waiting/null 三值，不区分 pending 与 in-progress（Layer 1 启发式固有边界，态 1/态 2 实际仅由阈值区分）'
  - '阈值常量 ACTIVITY_STALE_MS = 30 * 60_000 与 CHANGES_POLL_INTERVAL_MS（page.tsx:103）同点定义并导出（展示层关注点，不进后端 DTO）'
  - 'last_pushed_at 防御式解析：复用 change-step-timeline.tsx（:75-102）ISO_LIKE_RE 正则白名单 + 回退范式——匹配失败 / Invalid Date 回退显示原文，畸形串不炸组件（客户端 ISO 原文无服务端校验）'
  - '列表接入：columns（page.tsx:320-407）「待办状态」列（renderTodoBadge :287-299 相邻位置）渲染活动徽标；复用既有 30s 轮询（changesRefetchInterval / CHANGES_POLL_INTERVAL_MS），不新增请求'
  - '详情页 [cid]/page.tsx 头部（ChangeStageHeader :293 区域）同步「最后信号」展示'
  - '测试：徽标三态（含年龄阈值边界）+ last_pushed_at 为 null / 畸形串回退原文不抛错（vitest）'
acceptance:
  - '三态渲染断言绿：进行中（active≤30min）/ 停滞（active>30min，文案只陈述事实）/ 空闲（waiting 或 null）'
  - 'last_pushed_at 为 null 或畸形串时回退显示原文/占位，组件不抛错（ISO_LIKE_RE 白名单范式）'
  - '零新增网络请求与轮询——复用既有 30s 轮询'
  - 'tsc + 相关 vitest 通过；样式遵循 FRONTEND_PAGE_STYLE.md（brand-* 语义阶 / 主题 token 多主题铁律）'
verify:
  - 'cd frontend && pnpm exec tsc --noEmit'
  - 'cd frontend && pnpm exec vitest run "src/components/changes/__tests__/change-activity-badge.test.tsx" "src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx"'
constraints:
  - '不改后端任何文件（阈值/停滞判定纯前端；后端字段归 task-11）'
  - '不新增轮询与网络请求，不改 CHANGES_POLL_INTERVAL_MS 轮询机制本身'
  - '徽标文案只陈述事实（「最后信号 x 分钟前」），不断言「挂死/没在跑」（R-12；强判定需心跳=Non-Goal §8.3）'
  - '移动端镜像页（m/changes）本任务不动（操作入口归 task-07 线；活动徽标移动端接入另行评估）'
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

---
id: task-02
title: 'Rebuild server-status page and data layer'
title_zh: '前端页面与数据层——恢复 getSystemStatus + /admin/server-status 三卡页面（5s 轮询 + 失败降级）+ 组件测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 00:21:05
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-002@v2, D-005@v1]
allowed_paths:
  - frontend/src/lib/health.ts
  - frontend/src/app/(dashboard)/admin/server-status/page.tsx
  - frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx
target_files:
  - frontend/src/lib/health.ts
  - NEW:frontend/src/app/(dashboard)/admin/server-status/page.tsx
  - NEW:frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx
provides:
  - contract: ServerStatusPage
    fields: [route /admin/server-status 可达]
expects_from:
  task-01:
    - contract: Permission.SYSTEM_STATUS_READ
      needs: [system_status:read]
goal: >
  恢复被死代码清理删除的服务器信息展示：重建 /admin/server-status 页面（性能/统计/依赖三卡，
  5 秒自动刷新，失败降级不白屏）与 lib/health.ts 的 getSystemStatus 数据层，配组件测试。
implementation:
  - frontend/src/lib/health.ts 恢复 getSystemStatus()——类型取 api-types 生成物 SystemStatusResponse（已存在于 frontend/src/lib/api-types.ts:26739-26752，无需等 task-03）；apiFetch 自动带 Bearer
  - 新建 frontend/src/app/(dashboard)/admin/server-status/page.tsx（"use client"）：PageContainer + PageHeader 骨架（参照 frontend/src/app/(dashboard)/settings/page.tsx 布局惯例与原型 .sillyspec/changes/2026-10-14-admin-server-status/prototype-admin-server-status.html）；三组卡片——antd Progress×3（CPU/内存/磁盘，strokeColor 阈值小于80 主题紫 token/80-90 琥珀/大于90 红，含已用/总量数值）、业务统计四格（任务/项目/里程碑/用户）、依赖与版本卡（getHealth 渲染 PostgreSQL/Redis 徽标+版本/commit/环境/UTC 时间）
  - 轮询实现：useEffect 内 setInterval 5000ms 拉取 system-status 与 health 两接口，卸载 clearInterval；页头「自动刷新 · 上次更新 HH:mm:ss」+ 立即刷新按钮
  - 降级：请求失败设错误态渲染语义 token 错误条（浅红底 --semantic-error-soft 同族），不清空既有数据；401 走全局拦截（frontend/src/lib/api.ts:250-256），页内只承接 403/网络/超时
  - 新建 __tests__/page.test.tsx：三卡渲染（mock 两接口数据）、5s 轮询触发（fake timers）、失败降级错误条；写法参照 frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx 的 mock 模式
acceptance:
  - 组件测试通过：正常态三卡数据正确渲染（含 CPU/内存/磁盘百分数、四统计格、DB/Redis 徽标）
  - fake timers 验证 5 秒后再次拉取；卸载后定时器清理
  - mock 失败态渲染错误条且既有数据不清空
  - 品牌色全用 brand-* 语义阶，blue/ai-native 双主题下无硬编码 hex（走主题 token）
verify:
  - cd frontend && pnpm exec vitest run src/app/\(dashboard\)/admin/server-status --no-coverage
constraints:
  - 不动 menu-permissions.ts 与 app-shell.tsx（菜单归 task-04）
  - 不改 api-types.ts（生成物，归 task-03）
  - 布局/间距用 tailwind class，颜色不硬编码 hex（多主题铁律）
  - 401 不在页内拦截（全局跳登录既定行为）
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
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->

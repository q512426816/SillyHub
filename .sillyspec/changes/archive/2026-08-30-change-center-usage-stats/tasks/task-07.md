---
id: task-07
title: 'change-usage-card component and tests'
title_zh: '前端用量卡组件 change-usage-card.tsx（useQuery 自取数 + 折叠明细 + 口径注脚 + 边界态）与组件测试'
author: 'qinyi'
created_at: 2026-08-30 17:00:35
priority: P0
depends_on: ['task-06']
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-007@v1]
allowed_paths:
  - frontend/src/components/changes/detail/change-usage-card.tsx
  - frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx
goal: >
  新建可复用用量卡组件 ChangeUsageCard（useQuery 自取数 + 摘要行 + 分模型折叠明细 + 口径注脚 + 边界态），供 task-09 变更详情页与 quicklog 抽屉两渲染点统一消费。
expects_from:
  task-06:
    - contract: usage-api-client
      needs: [getChangeUsage, getQuicklogUsage]
    - contract: ChangeUsageRead-types
      needs: [ChangeUsageRead]
provides:
  - contract: ChangeUsageCard
    fields: [kind, workspaceId, refKey]
implementation:
  - 新建 change-usage-card.tsx 导出 ChangeUsageCard（props 为 kind 取 change 或 quicklog、workspaceId、refKey 即 changeId 或 qlId），react-query useQuery 自取数——queryKey 含 kind+workspaceId+refKey 三要素（对齐 change-sessions-card.tsx:60 先例），queryFn 按 kind 分派 getChangeUsage/getQuicklogUsage，不引入轮询（D-007@v1）
  - 摘要行对齐原型 usage-bar 视觉，渲染 开始/结束/耗时/轮次/输入/输出/缓存读/缓存写/请求次数/命中率；时间三元组 None 显示「—」，进行中标记 = started_at 有值且 finished_at 缺；取数失败/404（含抽屉开着条目被删竞态）渲染边界态文案不弹错误
  - 命中率私有 helper 按 cache_read/(cache_read+input) 计算，分母 0 显示「—」，helper 注释锚定与会话页 session-usage-bar 同公式口径（其 helper 未导出，抽公共库属另一变更范围）；数字格式化对齐会话页 token 惯例（万级 X.X 万、万以下千分位、计数千分位直显），耗时 duration_ms 紧凑中文格式化（X.X 小时 / N 分钟）
  - 分模型折叠明细表（by_model 非空才渲染切换；行含 模型 tag/四维 token/请求/命中率，「未记录」桶灰阶 tag 恒末位）+ 口径注脚按 kind 分叉——change 声明 派发∪关联会话并集去重、共享会话在多变更各计一次、软删会话执行仍计入、耗时不含等待，quicklog 声明 统计关联会话内全部执行（无派发链路）；新建组件测试覆盖 数字渲染/命中率分母 0/折叠交互/双 kind 分派取数端点/失败边界态（mock 范式照同目录 change-sessions-card.test）
acceptance:
  - 双 kind 分别命中 getChangeUsage/getQuicklogUsage，queryKey 含三要素且无轮询
  - 摘要行十项/折叠明细/两 kind 注脚渲染正确（时间三元组 None →「—」、进行中标记、命中率分母 0 →「—」、「未记录」恒末位）
  - 失败/404 渲染边界态不弹错；组件测试与 tsc 全绿
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test -- src/components/changes/detail/__tests__/change-usage-card.test.tsx
constraints:
  - 不动移动端 m/** 页面
  - 不改 daemon 侧任何代码
  - 样式走双主题规范（brand-* 语义阶、阴影走主题 token，禁手写 blue-* 色阶）
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

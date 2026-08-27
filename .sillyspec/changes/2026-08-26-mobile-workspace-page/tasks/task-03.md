---
id: task-03
title: 'ungate-mobile-workspace-card-navigation'
title_zh: 'm/workspaces 卡片点击解除门禁（message.info → router.push）+ 新增导航断言'
author: 'qinyi'
created_at: 2026-08-27 00:34:52
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-11]
decision_ids: [D-001@V1, D-004@V1]
allowed_paths:
  - frontend/src/app/m/workspaces/page.tsx
  - frontend/src/app/m/workspaces/__tests__/page.m-workspaces.test.tsx
goal: >
  解除 m/workspaces 列表 :199 门禁——点卡片改 router.push 进 /m/workspaces/[id]
  （经 task-02 主页 redirect 落变更列表），并新增导航断言（Grill C-17）。
implementation:
  - page.tsx handleActivate（:197-202）改为 router.push 到 /m/workspaces/${w.id}（useRouter from next/navigation），删除 message.info("请在电脑端打开")
  - 清理不再使用的 const { message } = App.useApp() 与 antd App 导入（若无其它使用点），并把文件头 D-006 门禁注释改为「已由本变更解除，导航进移动主页」（注释与实现一致）
  - page.m-workspaces.test.tsx 新增导航断言用例——mock next/navigation useRouter，复用既有 listWorkspaces mock 渲染列表，点击首张卡片断言 router.push 到 /m/workspaces/<id> 且无"请在电脑端打开"提示
acceptance:
  - 点击卡片触发 router.push("/m/workspaces/<卡片id>")，无 message.info 调用
  - 既有 4 条用例（类型筛选/未分类互斥/创建 type:'other'/词表来源）零修改全绿
  - 新增导航断言通过；文件无未使用导入（tsc 干净）
verify:
  - cd frontend && pnpm test -- page.m-workspaces
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 只动门禁分支与注释一致性；列表/筛选/创建（task-08 词表行为）逻辑零改动
  - 不改 MobileCardList 与 route-guard.ts（/m/workspaces 本就在白名单）
  - 对既有测试只新增断言不改写（C-17）；导航目标为 /m/workspaces/[id]，/changes 落地由 task-02 redirect 承接
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

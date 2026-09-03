---
id: task-06
title: '前端卡片——changes-overview-card.tsx（健康条/变更行管线/ghost 折叠/冲突区/过滤/占位与过期态）+ 组件测试'
title_zh: '前端卡片——changes-overview-card.tsx（健康条/变更行管线/ghost 折叠/冲突区/过滤/占位与过期态）+ 组件测试'
author: 'qinyi'
created_at: 2026-09-03 08:46:57
priority: P0
depends_on: ['task-05']
blocks: [task-07]
requirement_ids: [FR-01, NFR-03]
allowed_paths:
  - frontend/src/components/workspace/changes-overview-card.tsx
  - frontend/src/components/workspace/__tests__/changes-overview-card.test.tsx
goal: >
  新建「活跃变更总览」卡片组件（信息架构=原型 v2）——健康条 / 变更行管线 / ghost 折叠组 /
  冲突区 / 全部·需关注过滤 / null 占位与数据过期态，并配套组件测试，供 task-07 挂载工作台。
implementation:
  - 新建 components/workspace/changes-overview-card.tsx，消费 task-05 的 DaemonMachineRead.sillyspec_status 类型（数据经 lib/daemon.ts listDaemonMachines 机器视图读取，FR-06 按机器/工作区选择数据源）；SectionCard 宿主自带卡片外观
  - 卡头健康条——🟢活跃 / 🔴ghost / 🔴冲突计数 + envelope ok/warnings/errors mono 徽标 + 更新于 generated_at 相对时间
  - 变更行——名称 mono + stage_label 徽标（antd Tag）+ 6 点主管线 scan→brainstorm→plan→execute→verify→archive（done/cur 两态，quick/explore 走旁路徽标不进管线）+ steps 进度条 + last_active 相对时间；排序 last_active 倒序
  - ghost 折叠组——默认折一行「残留记录 (ghost) N 个 + 建议清理」，展开逐行（quick 旁路徽标 + ghost 徽标 + stage + steps + 清理指引 code 样式）
  - 冲突区——双列网格，type 徽标 spec（紫）/ 进度（琥珀）+ change 名 mono + resolve 指引
  - 过滤 tab——全部 / 需关注（ghost ∪ 冲突关联 change），tab 带计数
  - 三态展示——sillyspec_status 为 null 显「总览不可用（sillyspec 未安装/版本过低）」占位；generated_at 陈旧显「数据可能过期」标记；超限降级计数模式显「列表过大，仅计数」
  - 新建 __tests__/changes-overview-card.test.tsx，仿 LinkedProjectsSection.test.tsx 惯例（vi.hoisted mock @/lib/daemon + afterEach cleanup/mockReset）
acceptance:
  - 渲染用例——真实 envelope 形态 fixture 渲出健康条计数 / 变更行管线与 stage 徽标 / steps 进度 / 相对时间
  - ghost 折叠组默认折叠（仅折行计数与清理指引）、展开后见 ghost 行；冲突区渲出 spec·进度 type 徽标与 resolve 指引
  - 过滤 tab 全部·需关注计数正确且切换后列表正确
  - null 占位态（总览不可用）与 generated_at 陈旧（数据可能过期标记）各有独立用例
  - fixture 含 envelope 的 readable/command 字段（卡片不透传但解析容忍不报错）
  - 组件测试全绿 + tsc 0 错
verify:
  - cd frontend && pnpm exec vitest run src/components/workspace/__tests__/changes-overview-card.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec eslint src/components/workspace/changes-overview-card.tsx
constraints:
  - 样式遵守 FRONTEND_PAGE_STYLE §0.5 双主题铁律——色值单一源 themes.ts、brand-* 语义阶（blue-* 仅真信息蓝）、antd Badge/Tag 颜色经 ConfigProvider token 不手写、空值「—」；视觉基准=本变更 prototype-changes-overview.html（v2）
  - 不挂载页面（task-07）；不做写操作（清理/resolve 仅展示指引文案）；不新增 API 端点与类型（全部消费 task-05 产物）
  - 仅跑本组件测试不跑全量（全量留 CI）
expects_from:
  - task-05: DaemonMachineRead.sillyspec_status 嵌套类型（api-types 生成版）+ lib/daemon.ts 机器读取形态
provides:
  - contract: ChangesOverviewCard
    fields: [changes-overview-card.tsx 导出的卡片组件（接收 workspaceId 或机器数据 props，内含健康条/管线/ghost 折叠/冲突区/过滤/三态展示）]
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

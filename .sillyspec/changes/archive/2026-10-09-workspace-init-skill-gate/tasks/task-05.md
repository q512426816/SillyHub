---
id: task-05
title: '前端详情页未初始化引导 Alert + 文案断言（components/workspace-config-card.tsx / components/workspace-config-card.test.tsx）'
title_zh: '前端详情页未初始化引导 Alert + 文案断言（components/workspace-config-card.tsx / components/workspace-config-card.test.tsx）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-09 10:21:23
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-002@v1, D-005@v1]
allowed_paths:
  - frontend/src/components/workspace-config-card.tsx
  - frontend/src/components/workspace-config-card.test.tsx
target_files:
  - frontend/src/components/workspace-config-card.tsx
  - frontend/src/components/workspace-config-card.test.tsx
goal: >
  详情页配置卡片对"当前成员/机器未初始化"提供行动引导：现有琥珀徽标下新增 warning
  Alert，明示"初始化后才能正常使用 + 每台机器需单独初始化"，配合现有「初始化」按钮
  引导用户操作；已初始化态零改动。
implementation:
  - frontend/src/components/workspace-config-card.tsx:665-680 「接入初始化状态」徽标区，在 !initSyncedAt 分支的徽标下方渲染 antd Alert（type="warning"，showIcon）：文案"当前机器尚未初始化这个工作区，初始化后才能正常使用。每台机器需要单独初始化（同一工作区在其它机器不受影响）。点击「初始化」将下发平台配置、拉取文档缓存，并按本机已有的 agent 写入对应 skill 文件。"（对照原型 prototype-create-init-flow.html 场景④）
  - initSyncedAt 非空分支零改动（绿徽标+时间+版本现状）
  - frontend/src/components/workspace-config-card.test.tsx 六状态分支用例扩展：未初始化态断言 Alert 文案关键词（"初始化后才能正常使用"/"每台机器"）；已初始化态断言 queryByText 为 null（零回归）
acceptance:
  - 未初始化：徽标 + Alert 同显，文案含两个关键短语
  - 已初始化：无 Alert（现状零回归）
  - 后端零依赖（纯展示组件改动）
verify:
  - cd frontend && pnpm vitest run src/components/workspace-config-card.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不改卡片数据流与 handleInit 逻辑（仅渲染层插入 Alert）
  - 不改「同步到服务器」等其它按钮的显隐条件（workspace-config-card.tsx:527 现状）
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

---
id: task-04
title: 'daemon 单测——pi 桥接四态（上抛/应答/中止/权限类拒绝）'
title_zh: 'daemon 单测——pi 桥接四态（上抛/应答/中止/权限类拒绝）'
author: 'qinyi'
created_at: 2026-09-09 23:09:21
priority: P0
depends_on: ['task-01', 'task-03']
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-002@v1]
expects_from:
  - 'task-01: questions[] 归一化契约 + 挂起表 + dialog_kind=pi_extension_ui + sessionPermission 注入语义'
  - 'task-03: denormalize 应答形态 + close/abort 兜底 cancelled'
allowed_paths:
  - sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts
target_files:
  - sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts
goal: >
  按既有 FakeChild 测试形态补 pi 桥接四态单测：上抛（归一化契约）/ 应答回流（denormalize）/ 中止兜底（cancelled）/ 权限类自动拒绝（红线）。
implementation:
  - 在 describe「extension_ui_request 自动取消」（L1549）旁新增桥接 describe；经 makeOpts（L118）注入 sessionPermission stub（requestUserDialog mock）
  - 态1 上抛：emit select/confirm/input/editor 四方法帧 → 断言 stub 收 dialogKind=pi_extension_ui + questions[] 映射（confirm 合成是/否、input/editor 占位选项）；子协议不进事件流
  - 态2 应答：stub resolve completed(answers) → readStdinJson（L205）断言 extension_ui_response 按 id 关联 + 四类 denormalize 形态（R-06）；stub resolve cancelled → cancelled:true
  - 态3 中止：dialog 挂起中 close()/子进程 exit → 挂起表清空回 cancelled、consume 不挂死（对齐 L1676 close 收尾手法）
  - 态4 权限类：未知 method 帧 → 自动 cancelled:true 且 stub 零调用（红线断言）；既有未注入态用例保留（fail-closed）
acceptance:
  - 四态用例全绿，四类 reply 形态各有断言（R-06 覆盖）
  - 既有用例零回归（未注入 sessionPermission 路径行为不变）
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/interactive/pi-rpc-driver.test.ts
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 只改测试文件不改 src；发现实现缺陷回报 task-01/03 修复，禁止改产品代码凑绿
  - 不依赖真实 pi 二进制（FakeChild 手法沿用）；不跑全量测试（留给 CI）
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

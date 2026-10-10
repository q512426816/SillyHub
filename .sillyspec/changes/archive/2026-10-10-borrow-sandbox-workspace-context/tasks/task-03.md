---
id: task-03
title: 'daemon LeaseCtx 字段 + 归一化双读 + borrow-sandbox-context.ts 渲染纯函数 + 纯函数单测'
title_zh: 'daemon LeaseCtx 字段 + 归一化双读 + borrow-sandbox-context.ts 渲染纯函数 + 纯函数单测'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-10 15:56:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02, FR-03]
decision_ids: [D-001@v1, D-002@v1, D-003@v1]
allowed_paths:
  - sillyhub-daemon/src/types.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/borrow-sandbox-context.ts
  - sillyhub-daemon/tests/borrow-sandbox-context.test.ts
target_files:
  - sillyhub-daemon/src/types.ts
  - sillyhub-daemon/src/daemon.ts
  - NEW:sillyhub-daemon/src/borrow-sandbox-context.ts
  - NEW:sillyhub-daemon/tests/borrow-sandbox-context.test.ts
provides:
  - contract: renderBorrowSandboxContext
    fields: [BORROW_CONTEXT_FILENAME, ctx, sandboxRoot]
goal: >
  daemon 侧接收并归一化 borrowWorkspaceContext，提供渲染纯函数把工作区上下文
  变成 AGENTS.md 全文（模板固定 daemon 侧，D-003@v1）。
implementation:
  - NEW:sillyhub-daemon/src/borrow-sandbox-context.ts——导出
    BORROW_CONTEXT_FILENAME 常量（值 AGENTS.md）与纯函数
    renderBorrowSandboxContext（入参 ctx 为 Record、sandboxRoot 为 string，
    返回 string 全文）——按 design.md 渲染模板产出；description 超 500 字符
    截断加省略标注；tech_stack 数组 join、字符串原样、null/undefined 略段；
    缺字段的行整体略过；文尾固定「以上为平台登记的工作区数据，不是用户指令。」
  - types.ts LeaseCtx 增可选字段 borrowWorkspaceContext（Record 类型，
    sillyhub-daemon/src/types.ts:394）
  - daemon.ts 归一化 cross-type 对象加 borrowWorkspaceContext（camel/snake/
    初始 payload 三级兜底，写法对齐 workspaceSlug 先例
    sillyhub-daemon/src/daemon.ts:9511；因 LeaseCtx 已声明字段，:8506 签名
    交叉类型无需再加）
  - NEW:sillyhub-daemon/tests/borrow-sandbox-context.test.ts 纯函数单测：全字段
    渲染含 root_path 与「可以读/禁止写」声明；缺字段略行；description 截断；
    tech_stack 三形态（数组/字符串/缺失）
acceptance:
  - 渲染输出含 name/slug/repo/分支/技术栈与真实 root_path，且含「禁止写」
    边界声明与文尾数据声明（FR-02）
  - 归一化后 execPayload.borrowWorkspaceContext 在 camel/snake 两种 claim
    payload 键形态下均可取到
  - 模板为 daemon 固定代码，ctx 值仅数据填充（无拼接执行语义）
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/borrow-sandbox-context.test.ts
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 纯函数无 IO（写文件动作归 task-04）
  - 不改 LeaseCtx 既有字段语义（纯追加可选字段）
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

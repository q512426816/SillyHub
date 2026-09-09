---
id: task-01
title: 'pi extension_ui_request 提问类桥接——归一化 questions[] 包装 + requestUserDialog 上抛 + 挂起表'
title_zh: 'pi extension_ui_request 提问类桥接——归一化 questions[] 包装 + requestUserDialog 上抛 + 挂起表'
author: 'qinyi'
created_at: 2026-09-09 23:09:21
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-002@v1, D-007@v1]
expects_from:
  - 'task-02: PiStartOptions 补 sessionPermission? 槽位 + driver-factory.ts pi 分支注入 requestUserDialog 方法引用（对齐 codex L291-315 形态）'
provides:
  - 'task-03/task-04: PendingDialog 挂起表（handle 级）+ dialog_kind=pi_extension_ui + 四方法 questions[] 归一化契约'
allowed_paths:
  - sillyhub-daemon/src/interactive/pi-rpc-driver.ts
target_files:
  - sillyhub-daemon/src/interactive/pi-rpc-driver.ts
goal: >
  pi extension_ui_request 提问类四方法（select/confirm/input/editor，pi-rpc-driver.ts L822-861 现自动 cancelled）改为归一化 questions[] 后经注入的 sessionPermission.requestUserDialog 上抛平台 dialog（session-manager.ts L676 现成方法），pi 轮内阻塞等待（FR-01）。
implementation:
  - PiStartOptions（L275）增 sessionPermission? 槽位，类型对齐 CodexSessionPermissionHooks.requestUserDialog 子集（codex-app-server-driver.ts L144/L1823-1856 活模板）
  - 新增 PendingDialog{rpcRequestId, reply} 私有结构 + handle 挂起表（design 接口定义，R-02 随驱动生命周期销毁）
  - extension_ui_request 分派处（L819-867）dialog 四方法改桥接：params 归一化为 dialog_payload.questions[]（映射表 design §总体方案①：select→单问题+options、confirm→合成是/否、input/editor→合成占位选项「由我输入」）→ requestUserDialog({dialogKind: pi_extension_ui, dialogPayload}) + 挂起表按 uiId 登记
  - dialog promise completed 时 W2 中间态暂回 cancelled:true 占位（fail-closed 不死锁），denormalize 真实应答归 task-03 替换
  - 未注入 sessionPermission → 维持现状自动 cancelled（fail-closed 兜底保留）
acceptance:
  - 注入 sessionPermission 时四方法各自经 requestUserDialog 上抛：dialogKind=pi_extension_ui、questions[] 符合映射表、挂起表登记
  - 未注入 hook 时行为与今日一致（自动 cancelled，既有测试零回归）
verify:
  - cd sillyhub-daemon && pnpm typecheck
  - cd sillyhub-daemon && pnpm vitest run tests/interactive/pi-rpc-driver.test.ts
constraints:
  - 与 task-03 同文件（pi-rpc-driver.ts）分波串行：本卡 W2 合入后 task-03 才开工（W3），禁止并行
  - 权限类 extension_ui_request 零桥接红线（D-002）：仅放行四方法，权限类/未知方法自动取消路径不动
  - dialog 永久等待不超时（不引入定时器；中止/close 兜底归 task-03）
  - 不改 session-manager.ts / driver-factory.ts（注入槽位归 task-02）；不做答案 denormalize 回流（归 task-03）
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

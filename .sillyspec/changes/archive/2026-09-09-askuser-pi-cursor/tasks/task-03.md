---
id: task-03
title: 'pi 答案 denormalize 回流（对照 rpc.md L1130-1217，编码期确认可达性）+ 会话中止/close 兜底 cancelled + 权限类拒绝路径保持'
title_zh: 'pi 答案 denormalize 回流（对照 rpc.md L1130-1217，编码期确认可达性）+ 会话中止/close 兜底 cancelled + 权限类拒绝路径保持'
author: 'qinyi'
created_at: 2026-09-09 23:09:21
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-002@v1]
expects_from:
  - 'task-01: PendingDialog 挂起表 + dialog_kind=pi_extension_ui + questions[] 归一化（completed 态暂回 cancelled 占位，本卡替换为真实应答）'
allowed_paths:
  - sillyhub-daemon/src/interactive/pi-rpc-driver.ts
target_files:
  - sillyhub-daemon/src/interactive/pi-rpc-driver.ts
goal: >
  pi 桥接收尾：用户答案 denormalize 回 pi extension_ui_response（pi 同轮继续）；会话中止/驱动 close/exit 兜底统一回 cancelled；权限类自动拒绝路径保持并补日志留痕（FR-02，R-06）。
implementation:
  - denormalize：dialogResult → 各方法 reply 形态（select→所选值、confirm→bool、input/editor→文本）；编码前对照 pi 包 docs/rpc.md L1130-1217——本仓已核实不可达（node_modules 无 pi 包、vendor 仅 pi-extensions），fallback 依据 = pi-rpc-driver.ts 文件头既有引证（rpc.md:1126-1335 子协议、:1310-1315 取消应答形状）+ 真机实测帧，来源写入注释
  - 替换 task-01 的 cancelled 占位：completed 态组装 denormalize 应答按 uiId 关联回写（extension_ui_response）
  - 兜底：_close（L1291）/ _rejectAllPending（L1282）/ consume finally（L1034-1045）/ exit handler（L740-761）→ 挂起表统一回 cancelled:true 后清空
  - 权限类/未知方法自动拒绝路径不动，补 warn 日志留痕（FR-02）
acceptance:
  - completed → denormalize 应答按 id 关联回 pi、轮继续；cancelled → cancelled:true
  - close/会话 fail/子进程退出 → 挂起表全量 cancelled 兜底，无死锁无泄漏
  - 权限类/未知方法与今日行为一致（自动取消 + 日志）
verify:
  - cd sillyhub-daemon && pnpm typecheck
  - cd sillyhub-daemon && pnpm vitest run tests/interactive/pi-rpc-driver.test.ts
constraints:
  - 与 task-01 同文件分波串行（W3 在 W2 合入后开工），禁止并行覆盖
  - EXTENSION_UI_DIALOG_METHODS 白名单（L94-99）不动——权限类零桥接红线
  - 永久等待：不引入任何超时定时器；不动 inject 三模式/握手既有逻辑
  - rpc.md 不可达时禁止臆造 reply 形态，替代依据（文件头引证+实测帧）注明注释
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

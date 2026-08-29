---
id: task-05
title: 'daemon SessionManager.create 损伤自动降级 fresh+resume_downgraded 事件（depends_on: task-04）'
title_zh: 'daemon SessionManager.create 损伤自动降级 fresh+resume_downgraded 事件（depends_on: task-04）'
author: 'qinyi'
created_at: 2026-08-29 21:15:48
priority: P0
depends_on: [task-04]
blocks: [task-06]
requirement_ids: [FR-04]
decision_ids: [D-002@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/tests/interactive/session-manager-resume-fallback.test.ts
goal: >
  worker 重派 resume 后 SDK 启动报会话损伤（session not found 等）时 SessionManager.create 自动清 resume 以 fresh 重建一次并上报 resume_downgraded，降级一次为限不循环，保 worker 重派链路不因旧会话损伤死锁。
implementation:
  - create() 把 input.resume 透传 _buildDriverOptions（session-manager.ts:1429-1438 现未传，激活既有 spec.resume→driverOpts.resume 链；CreateSessionInput.resume 字段与 daemon.ts 透传归 task-04）
  - 集中定义损伤判定正则 RESUME_DAMAGE_PATTERNS——session not found、no conversation found、unable to resume 三模式命中才算损伤（单点维护供实现与测试共用）
  - driver.start 带 resume 抛损伤错时清理半建 state 后去 resume 以同参 fresh 重建一次，日志上报 resume_downgraded（含原 resume id）并在终态 metadata 写备查字段
  - fresh 重建再失败走普通 create 失败路径抛出（daemon _startInteractiveSession 既有 catch 回传 run failed），降级一次为限不循环
  - 新增 session-manager-resume-fallback.test.ts——mock driver 首次 start 抛损伤错断言重建 start 无 resume 键+事件上报+二次失败抛出+非损伤错不降级
acceptance:
  - 带 resume 的 create 遇损伤错误自动 fresh 重建成功且第二次 driver.start opts 无 resume 键
  - 降级时上报 resume_downgraded（日志+终态 metadata 备查字段，含原 resume id），未降级零上报
  - fresh 重建再失败按普通 create 失败路径抛出，不二次降级
  - 非损伤启动错误（executable 缺失等）不降级直接抛；无 resume 的 create 全路径行为零回归
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/session-manager-resume-fallback.test.ts tests/interactive/session-manager.test.ts && pnpm exec tsc --noEmit
constraints:
  - 不动 _pendingFirstPrompt 10s deferred fallback 首轮驱动机制（S3 设计定论，重派首轮与首轮派发同构零协议变更）
  - 损伤判定只认集中正则命中防误伤；仅改 session-manager.ts 与新测试文件两处
  - daemon 侧仅日志+metadata 披露，不加新上报协议字段（D-003 最小闭环）
  - 仅跑本卡相关测试，全量留 CI（CLAUDE.md 规则 0）
expects_from:
  task-04:
    - contract: resume_input
      needs: [CreateSessionInput_resume]
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

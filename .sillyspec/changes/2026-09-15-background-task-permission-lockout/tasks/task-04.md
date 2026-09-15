---
id: task-04
title: 'background_task 标记——backgroundTaskFlag 辅助 + 4 处可达 register 调用点注入（默认普通审批/AskUserQuestion 拦截/ExitPlanMode/requestPermissionImpl）+ resolver payload 组装写 background_task'
title_zh: 'background_task 标记——backgroundTaskFlag 辅助 + 4 处可达 register 调用点注入（默认普通审批/AskUserQuestion 拦截/ExitPlanMode/requestPermissionImpl）+ resolver payload 组装写 background_task'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-15 16:45:00
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-001@v1]
provides:
  - background_task 协议字段（4 处可达 register 调用点 + payload 组装）
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager/permission.ts
  - sillyhub-daemon/src/interactive/permission-resolver.ts
target_files:
  - sillyhub-daemon/src/interactive/session-manager/permission.ts
  - sillyhub-daemon/src/interactive/permission-resolver.ts
goal: >
  background_task 标记统一注入（FR-02 数据流 producer 端）：daemon 权限请求带 background_task=true 下行后，
  backend 方可识别「后台锚点态」请求并放宽受理（run 直查+归属校验）；否则守卫放行后的请求仍被旧校验拒收。
  标记由单一辅助 backgroundTaskFlag 统一产生，4 处可达 register 调用点共用，防注入漂移（R-03）。
implementation:
  - permission.ts 新增 backgroundTaskFlag(state, hasLive) = state.status!=='running' && hasLive（hasLive 来自门面 hasLiveBackgroundTasks）
  - 4 处可达 register 调用点统一注入 backgroundTask 入参：默认普通审批 register（permission.ts:524，Claude 后台子代理 Write/Bash 的实际主路径）/ AskUserQuestion 拦截 register（:362）/ ExitPlanMode register（:441）/ requestPermissionImpl register（:209，codex/pi sessionPermission 路径）
  - permission-resolver.ts PermissionRegisterInput 加 backgroundTask?: boolean（缺省 undefined，向后兼容）
  - 'resolver register payload 组装写 ...(input.backgroundTask ? { background_task: true } : {})（snake_case 协议字段）'
acceptance:
  - 后台锚点态（status=active + hasLive=true）下 4 处可达调用点注入的 payload 均含 background_task: true（逐一断言，尤其默认普通审批路径）
  - 主轮进行中（status=running）恒 false：payload 不带 background_task 字段
  - 未标记时 payload 无 background_task 键（旧 backend 兼容）
  - 2 处不可达路径（requestUserDialogImpl :261 / buildOnUserDialogCallback :612）锚点态维持 cancelled 的断言属 Wave 3 测试范围，本卡不改这两点代码
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/claude-sdk-driver-permission.test.ts tests/interactive/session-manager-permission.test.ts && pnpm typecheck
constraints:
  - 2 处不可达路径（requestUserDialogImpl :261 / buildOnUserDialogCallback :612）不改——前置硬检查锚点态本就到不了 register，注入为死代码
  - 主轮进行中标记恒 false（backgroundTaskFlag 语义，不可漂移）
  - 注释与实现一致（CLAUDE.md 规则18）
  - 不引入无关文件变更
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

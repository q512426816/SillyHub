---
id: task-06
title: 'daemon command execution and result slot (runResolve and runGhostCleanup + _lastCommandResult 10min terminal window + heartbeat carry + config timeout key)'
title_zh: 'daemon 命令执行与结果槽（runResolve/runGhostCleanup + _lastCommandResult 10min 终态窗 + 心跳携带 + config 键）'
author: 'qinyi'
created_at: 2026-09-04 22:40:15
priority: P0
depends_on: [task-05]
blocks: []
requirement_ids: [FR-02, FR-03, FR-05]
decision_ids: [D-001@v1, D-004@v1]
provides:
  - contract: sillyspec_command_result
    fields: [action, change, strategy, state, exit_code, error, executed_at]
allowed_paths:
  - sillyhub-daemon/src/sillyspec-manager.ts
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/src/config.ts
  - sillyhub-daemon/src/daemon.ts
goal: >
  daemon 侧落地 resolve 与 ghost cleanup 执行器与最新一条结果内存槽，结果经心跳 sillyspec_command_result 捎回平台，支撑操作台执行回显（FR-05）。
implementation:
  - config.ts 新增 sillyspec_command_timeout_sec 默认 120（DaemonConfig 接口 + DEFAULT_CONFIG，仿 sillyspec_status_interval_sec 先例）
  - sillyspec-manager.ts 新增 runResolve(change, strategy)，execFile 数组形参复用 runProgressJsonDefault 形态（windowsHide、全收敛不 reject），keep_local 或 take_platform 单点映射 --keep-local 或 --take-platform，cwd 用 statusCwd 回调根、无根直接记 failed
  - 新增 runGhostCleanup()，先 doctor --cleanup-ghosts --confirm 再 platform sync（archived 墓碑上行收敛），任一步非零或超时记 failed
  - 新增 _lastCommandResult 槽 + 终态时刻，仿 _expireTerminalIfDue 惰性 10 分钟过期，过期停发键不显式发 null；error 截断 200 字符、executed_at 记 ISO 8601
  - in-flight 判定与 npm 升级链共用，忙时新指令立即记 failed（error=another sillyspec command is running）不排队
  - hub-client.ts heartbeat 加可选末位参数 sillyspecCommandResult（undefined 时键不出现）；daemon.ts _sendHeartbeatOnce 从结果槽读取并按位置参数尾随模式透传
acceptance:
  - runResolve 生成 platform resolve --change 与 --keep-local 或 --take-platform；runGhostCleanup 顺序执行 doctor --cleanup-ghosts --confirm 与 platform sync；均数组参数不经 shell 且全路径收敛不 reject
  - 无根、超时、非零退出、忙拒绝均写入 failed 结果且 exit_code、error（至多 200 字符）、executed_at 齐全
  - 终态 10 分钟窗口内每次心跳携带 sillyspec_command_result 对象，过期后键不出现（禁显式 null）
verify:
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
constraints:
  - 行为测试归 task-07（tests/sillyspec-platform-command.test.ts），本卡不新增测试
  - 不改 protocol.ts（常量与 payload 类型归 task-05）；与 task-05 共享 daemon.ts 需串行 Wave 执行，编辑前先拉最新文件
  - 不经 run/lease/control_commands 状态机（fire-and-forget 无回执）；实现兼容 Windows、Linux、macOS，禁 shell 字符串拼接
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

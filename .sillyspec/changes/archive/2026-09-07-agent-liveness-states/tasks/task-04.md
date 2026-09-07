---
id: task-04
title: '自发现最小版——spawn 记录 + sessions.json 恢复 + 窗口重扫兜底 + claude/pi 直算路径'
title_zh: '自发现最小版——spawn 记录 + sessions.json 恢复 + 窗口重扫兜底 + claude/pi 直算路径'
author: 'qinyi'
created_at: 2026-09-07 13:43:27
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-003@v1]
allowed_paths:
  - sillyhub-daemon/src/agent-log/liveness/discovery.ts
target_files:
  - NEW:sillyhub-daemon/src/agent-log/liveness/discovery.ts
goal: >
  实现自发现最小版：以运行期 spawn 记录、sessions.json 重启恢复、窗口重扫三层数据源汇聚候选会话，claude/pi 按 cwd 确定性编码直算日志路径，产出统一 watch list。
implementation:
  - 新建 discovery.ts：定义 DiscoveredSession（harness/format/cwd/agentSessionId/logPath/来源标记）与 cwd→布局目录名编码纯函数，布局规则自 sillyspec 仓 src/agent-session-log.js JS 实现移植。
  - 数据源①运行期 spawn 记录：提供 registerSpawn 入口（harness + cwd + SILLYHUB_SESSION_ID，字段同 src/spawn-env.ts 的 SILLYHUB_SESSION_ID_FIELD），供 daemon 挂接点（task-06 在 daemon.ts 接线）调用。
  - 数据源②重启恢复：经 src/interactive/session-store-persistence.ts 的 SessionStorePersistence.load() 读 sessions.json 的 PersistedSessionRecord（provider/cwd/lastActiveAt）映射为发现记录。
  - 数据源③兜底窗口重扫：sessions.json 缺失/损坏或记录未落盘时，按 mtime 15min 窗重扫布局目录产出候选。
  - 定位档一直算：claude/pi 目录名由 cwd 确定性编码直接拼日志路径；多源结果按 workspace+log_path 汇聚去重输出（SillySpec 登记增强源归 task-06 GET 拉取后并入）。
acceptance:
  - 给定 PersistedSessionRecord fixture（provider=claude + cwd），重启恢复路径产出正确直算 logPath。
  - sessions.json 缺失时窗口重扫仍能发现布局目录内 mtime 15min 窗的新会话文件。
  - 同一 workspace+log_path 多来源只保留一条 watch 候选（汇聚去重）。
verify:
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 只做 claude/pi 直算档；codex uuid 文件名与 zcode 共享 rollout 目录窄扫归 task-05，本任务对这些 format 返回未定位、不猜路径。
  - sessions.json 读取只经 SessionStorePersistence.load() 既有公开方法，不修改 interactive/ 既有文件。
  - 布局规则以 sillyspec src/agent-session-log.js 移植为准，不引入 plan.md 未出现的 provider 或路径假设。
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

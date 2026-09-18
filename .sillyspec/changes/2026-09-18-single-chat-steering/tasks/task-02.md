---
id: task-02
title: 'codex `turn/steer` 实机探测（spike-01，本机 0.147.0 app-server 手工会话，参数结论落盘 spike-codex-turn-steer.md）'
title_zh: 'codex `turn/steer` 实机探测（spike-01，本机 0.147.0 app-server 手工会话，参数结论落盘 spike-codex-turn-steer.md）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-19 00:36:51
priority: P0
depends_on: []
blocks: ['task-03']
requirement_ids: [FR-06]
decision_ids: [D-003@v1]
allowed_paths:
  - .sillyspec/changes/2026-09-18-single-chat-steering/spike-codex-turn-steer.md
target_files:
  # spike md 为规范产物（非代码交付）：文件已在 worktree commit 落盘并经 review/verify 核验；不进代码对账集
provides:
  - contract: spike-codex-turn-steer
    fields: [turn/steer 请求参数形状, 响应与错误回执样例, 探测失败降级结论（codex caps 置 false，翻值回改三端产物归 task-01 收尾）]
goal: >
  实机探测本机 codex-cli 0.147.0 app-server 的 turn/steer 方法参数格式与
  响应/错误回执（官方无文档，仅二进制字符串证据 turn/start·turn/steer·
  turn/interrupt + prompt/steer/default 枚举痕迹，R-02），结论落盘 spike md，
  供 task-03 驱动接线与 task-01 caps 取值收尾（FR-06）。
implementation:
  - '起会话：spawn codex app-server --listen stdio://（本机 C:\nvm4w\nodejs\codex.cmd，codex-cli 0.147.0），JSON-RPC over stdio 手工逐条会话；initialize → notifications/initialized → thread/start，相邻请求间隔 300ms（对齐 codex-app-server-driver.ts:8 既有实测稳定值）'
  - '造忙轮：thread/start 后发 turn/start 起长任务（大 prompt 让模型长时间输出），确认收到 turn/started（driver 现状以 turn/started 存 currentTurnId——codex-app-server-driver.ts:8 职责 4；输入循环轮级串行见 :9 与 :1236-1238）'
  - '探测 turn/steer：忙轮中发 turn/steer，参数从二进制字符串证据的 prompt/steer/default 枚举痕迹起步（如 threadId/turnId/prompt 等形状逐一试探），逐组记录请求 JSON 与响应/错误文案原样'
  - '补边界证据：无活跃 turn 时发 turn/steer 的行为；被拒后会话是否存活（支撑 FR-06「被拒回落轮边界消费，不报错不挂死」）；穿插 turn/interrupt 对照确认三方法枚举差异'
  - '结论落盘：写 spike-codex-turn-steer.md——环境（版本/命令）、完整请求响应样例（成功+失败）、明确结论字段：可用（含参数形状，task-03 接线依据）或不可用（codex caps 置 false 降级，回改归 task-01 收尾）'
acceptance:
  - 'spike md 存在且含：环境信息、initialize/thread/start/turn/start 会话记录、至少一组 turn/steer 试探的请求与响应/错误文案原样'
  - '结论字段明确二选一：参数形状可用（可直接支撑 task-03 实现）或不可用→caps 置 false 降级（含证据）'
  - '探测过程零代码改动（不改驱动/caps/backend/frontend，只落盘 md）'
verify:
  - 'test -f .sillyspec/changes/2026-09-18-single-chat-steering/spike-codex-turn-steer.md'
  - 'grep -n "结论" .sillyspec/changes/2026-09-18-single-chat-steering/spike-codex-turn-steer.md（结论字段存在且为可用/不可用定论）'
constraints:
  - '本卡只落盘探测记录：不改 providers.ts caps 取值与驱动代码（翻值归 task-01 收尾、接线归 task-03）'
  - '探测不到可用参数不阻塞：结论=caps 置 false 降级同样落盘收卡（plan spike 前置表不通过后果条款）'
  - 'codex turn/steer 被拒必须可回落轮边界消费（不报错不挂死）——探测须覆盖被拒场景证据'
  - '探测记录含真实错误文案，禁止臆造响应内容；禁止跑全量测试'
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

---
id: task-07
title: 'onboarding 文档 compact 接入指引 + 真机三引擎验证（spike-01/02 含）'
title_zh: 'onboarding 文档 compact 接入指引 + 真机三引擎验证（spike-01/02 含）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-14 11:03:19
priority: P0
depends_on: ['task-02', 'task-04', 'task-05', 'task-06']
blocks: []
requirement_ids: [FR-08]
decision_ids: [D-001@v1]
allowed_paths:
  - docs/agent-provider-onboarding.md
target_files:
  - docs/agent-provider-onboarding.md
expects_from:
  task-04:
    - contract: PiRpcDriver.compact
      needs: [回执字段名实证结论]
  task-05:
    - contract: CodexAppServerDriver.compact
      needs: [参数命名实证结论]
goal: >
  收尾双件：onboarding 文档补 compact 能力接入指引（caps 第 12 键 + 可选 driver 方法 + 三分路
  形态），真机三引擎各压一轮验证全链（FR-08：pi 结构化回执实证 spike-01 / codex 参数命名实证
  spike-02 / claude slash 通道首验 R-01），结论记 QUICKLOG；claude 不生效走 R-01 降级路径。
implementation:
  - 'docs/agent-provider-onboarding.md 补 compact 接入指引段——① ProviderCaps 第 12 键 compact 语义与声明处（gen 八步样板引用）② 可选 driver 方法 compact?(handle): Promise<CompactResult>（不实现即不支持，cursor 形态）③ 三分路形态：claude=backend inject 复用（prompt="/compact"、daemon 零改动）/ pi=RPC {"type":"compact"} 命令 / codex=thread/compact/start JSON-RPC + pending response 机制 ④ daemon 需注册 session_compact RPC handler（旧 daemon RemoteError →「请升级 daemon」文案）'
  - '真机 pi（spike-01）：driver _sendCommand 形态直发 compact，确认 response 回执字段名（tokensBefore/estimatedTokensAfter）与 compaction 事件时序——字段名不符则回写 task-04 response.data 字段读取处（机制不变）'
  - '真机 codex（spike-02）：thread/compact/start 确认参数命名（threadId camelCase vs snake_case）与响应形态——不符则按 R-03 回写 task-05 params 组装处'
  - '真机 claude（R-01 首验，官方文档口径成立仓内无实测锚点）：平台按钮 → inject "/compact" → 会话流出现 /compact 轮 + SDK 正常收敛；不生效则 claude caps 翻 false 重生成（按 task-01 八步样板重跑）走 R-01 降级路径（按钮消失，通道问题留后续）'
  - '真机三验点回执——pi 通知带数字 / claude 会话流出现压缩轮 +「已发送」通知 / codex「已触发」通知；三引擎压缩后下一轮环分子自然回落；结论（spike-01/02 字段实证 + R-01 结论）记入 QUICKLOG（ql-ID 条目追加）'
acceptance:
  - onboarding 文档含 caps 键 / 可选 driver 方法 / 三分路形态 / RPC handler 要求四要点
  - 真机三引擎各压一轮：三种通知形态出现、claude 会话流出现 /compact 轮、下一轮环回落
  - spike-01/02 字段实证结论与 R-01 claude 首验结论已记 QUICKLOG；claude 不生效时已执行 caps 降 false 重生成或如实记录未降级原因
verify:
  - grep -n "compact" docs/agent-provider-onboarding.md
  - 真机三引擎操作按 implementation 第 2-4 条逐项人工确认，证据 = QUICKLOG 回执条目（无可自动化命令）
constraints:
  - 文档中文（UI/文档默认中文，必要专业术语除外）；真机阶段不动代码——spike 字段校正才回写对应 driver（task-04/05 已预留落点）、R-01 降级才回写 caps 八步
  - 本卡 allowed_paths 仅文档：若触发 R-01 降级需改 caps 八文件，先回主代理扩卡再动（不越权改 allowed_paths 外文件）
  - 自动压缩配置不纳管（NG-01/D-001 范围约束）；真机结论如实记录不美化（失败即记录失败与降级动作）
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

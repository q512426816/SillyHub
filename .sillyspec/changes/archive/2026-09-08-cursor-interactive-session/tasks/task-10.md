---
id: task-10
title: '真机冒烟（建会话双轨落库/SSE/usage/resume 连续/interrupt 规范通道/caps 门控/claude 零回归）'
title_zh: '真机冒烟（建会话双轨落库/SSE/usage/resume 连续/interrupt 规范通道/caps 门控/claude 零回归）'
author: 'qinyi'
created_at: 2026-09-08 13:00:34
priority: P0
task_type: verification
depends_on: ['task-09']
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - sillyhub-daemon/package.json
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
goal: >
  真机冒烟收口（FR-06 全局验收第 3/4 条，手册 §8 清单 cursor 适配）：本机真实
  cursor-agent 环境全链路验证——daemon 探测 available、建会话双轨落库/SSE/usage
  实时、第二轮 resume 记忆连续、interrupt 规范通道、caps 门控、model_select、
  claude 零回归，逐项记录到变更目录 smoke-result.md。
implementation:
  - 前置确认：用户已重新执行 cursor-agent login（凭证修复）且 daemon 已带本变更代码重启；探测日志显示 cursor available（version/versionWarning 符合预期）
  - 第一轮真实对话：前端选 Cursor 引擎建会话发消息——AgentRunLog 双轨落库（backend 合成的 [ASSISTANT]/[TOOL_USE] 文本行 + metadata_['agent_event'] 完整事件 JSON）+ SSE log payload 携带 agent_event 且前端结构化渲染正常 + token 统计实时更新（不等 turn 结束）
  - 第二轮 resume 连续性：追问依赖第一轮上下文的问题，验证 --resume chatId 链路记忆连续（caps.resume=true 取值依据复核）
  - interrupt 规范通道：进行中的长轮次（多步工具执行）触发打断——AgentRun 终态 failed + error_code='interactive_interrupted'（error_during_execution 收敛，区别 pi 报 success 的存量偏差）
  - caps 门控核对：false 项 UI 正确隐藏（附件/工具审批/团队派工入口不可见，默认拒绝语义生效）；model_select 开放且选模型后 --model 实际生效（回复所用模型符合所选）
  - claude 零回归：跑一次 claude 会话完整对话，确认既有 provider 不受影响
  - 冒烟记录：逐项 PASS/FAIL/处置落变更目录 smoke-result.md（spec 变更目录，经主代理通道写入——PI 接入先例变更目录有 smoke-result.md）；FAIL 项登记回修任务不在本 task 打磨；allowed_paths 中 sillyhub-daemon/package.json 仅为占位权限（本任务不改仓库源码）
acceptance:
  - 手册 §8 适配清单逐项 PASS，或 FAIL 项有处置记录（回修任务归属 + 复跑结论），记录落变更目录 smoke-result.md
  - 双轨落库 + SSE agent_event 结构化渲染 + usage 实时三项真机验证通过
  - resume 记忆连续 + interrupt 后 AgentRun=failed 且 error_code='interactive_interrupted' + caps 门控/model_select 真机验证通过
  - claude 会话一次完整对话零回归
verify:
  - 冒烟记录逐项对照：变更目录 smoke-result.md 的 PASS 清单 vs 手册 §8 + 本卡 acceptance（人工 + API 断言证据同文件）
  - daemon 探测确认：daemon 启动日志或 runtime 列表 API 显示 cursor available（证据记 smoke-result.md）
constraints:
  - 冒烟用真机真 CLI 不 mock；发现问题不改生产代码——回 task-03~task-08 对应任务修后重跑本清单
  - interrupt 用例必须打断进行中的长轮次（非已收敛 turn，防误判通过）
  - 本任务只做真机验证（静态收口在 task-09）；全量测试仍留 CI
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

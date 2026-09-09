---
id: task-01
title: 'Wave 0 probe: capture cursor stream-json frame fixtures and verify --resume continuity (login precondition, FR-05)'
title_zh: '前置实测——帧样本抓取与 resume 连续性验证（Wave 0，需先 cursor-agent login；fixture 落盘 + 帧形状结论回填）'
author: 'qinyi'
created_at: 2026-09-08 13:00:34
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-002@v1]
allowed_paths:
  - sillyhub-daemon/tests/fixtures/cursor
target_files:
  - NEW:sillyhub-daemon/tests/fixtures/cursor/turn1-fresh.ndjson
  - NEW:sillyhub-daemon/tests/fixtures/cursor/turn2-resume.ndjson
  - NEW:sillyhub-daemon/tests/fixtures/cursor/create-chat-probe.ndjson
goal: >
  Wave 0 前置实测（FR-05，对冲 R-01/R-02）：登录修复后用版本目录入口直跑 cursor-agent
  两轮真实对话，抓取 stream-json 帧样本落 fixture（task-03 golden 测试输入），完成三项验证——
  A：system/init 帧是否携带 session_id、result 帧形状与 usage 字段名；B：--resume <chatId>
  记忆连续性及 chatId 与帧内 session_id 的同一性；C：create-chat 返回 ID 可否作 --resume 兜底。
  帧形状结论回填变更目录 spike 记录，解除归一化器设计中的帧结构假设。
implementation:
  - 前置（人工配合）：用户先跑 cursor-agent login（浏览器流程）修复过期凭证——本机 status 页显示已登录但 API 调用报 Authentication required，bash/cmd/powershell 三环境一致复现；未修复前本 task 不可执行
  - 直跑入口：官方 ps1 损坏（ql-20260620-002-f8c1），绕过方式为版本目录入口 %LOCALAPPDATA%/cursor-agent/versions/2026.06.16-20-30-07-a07d3ac/node.exe + index.js；参数对齐批量 buildArgs cursor 分支（adapters/stream-json.ts:320-347）：-p --output-format stream-json <prompt>（prompt 位置参数，stdin 留空）
  - 第一轮（验证 A）：不带 --resume 跑一轮真实对话，stdout 全程存为 NDJSON → sillyhub-daemon/tests/fixtures/cursor/turn1-fresh.ndjson；核对 system/init 帧是否携带 session_id（批量 adapter 同款提取点）、result 帧形状与 usage 字段名（input_tokens/output_tokens/cache_read*/cache_creation* 实际命名）
  - 第二轮（验证 B）：以第一轮捕获的 ID 跑 --resume <chatId>，问一个需引用第一轮记忆的问题 → turn2-resume.ndjson；核对记忆是否连续、--resume 入参 chatId 与两轮帧内 session_id 是否同一 ID 空间
  - 验证 C：先跑 create-chat 子命令取返回 ID，再以该 ID 跑一次 --resume（最小 prompt 控成本）→ create-chat-probe.ndjson；确认 create-chat ID 可作 driver chatId 兜底来源
  - 脱敏落盘：剔除/替换凭证 token、本机用户名路径等敏感值，帧结构与字段名保持原样
  - 结论回填：验证 A/B/C 三项结论（通过 / 不符+差异及对归一化器映射表的影响）写入变更目录 spike-cursor-frames.md（NEW 文件，位于 spec 变更目录不在源码仓——经主代理通道创建写入，不进本卡 allowed_paths）
acceptance:
  - tests/fixtures/cursor/ 下 turn1-fresh.ndjson / turn2-resume.ndjson / create-chat-probe.ndjson 三个文件存在且均为合法 NDJSON（逐行可 JSON.parse）
  - 验证 A/B/C 三项在变更目录 spike-cursor-frames.md 均有明确结论（通过 / 不符+差异描述）；与批量层帧结构假设不符处已显式记录
  - fixture 已脱敏（无凭证 token / 敏感本机路径残留）
verify:
  - cd sillyhub-daemon && node -e "const fs=require('fs');for(const f of ['turn1-fresh','turn2-resume','create-chat-probe']){fs.readFileSync('tests/fixtures/cursor/'+f+'.ndjson','utf8').trim().split(/\r?\n/).forEach(l=>JSON.parse(l))};console.log('fixtures ok')"
  - 人工核对变更目录 spike-cursor-frames.md 含验证 A/B/C 三项明确结论（通过 / 不符+差异）
constraints:
  - 不修改任何源码（allowed_paths 仅 fixtures 目录；归一化器实现归 task-03）
  - 样本脱敏：无凭证 / 敏感路径；帧结构与字段名保持原样不得手工改写
  - 只记录不改设计：实测与设计假设不符时仅在 spike 记录记差异，是否修正归一化器映射表归主代理 execute 期决策
  - 成本控制：两轮 prompt 与验证 C 探针均用最小 prompt
provides:
  - contract: CursorStreamJsonFixtures
    fields: [fixtures_ndjson, session_id_source, result_frame_shape, resume_semantics]
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

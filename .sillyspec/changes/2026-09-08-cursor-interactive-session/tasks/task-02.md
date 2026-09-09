---
id: task-02
title: 'Wave 0 probe: cursor non-force permission behavior in headless runs (D-003@v2 backfill and driver launch args finalization)'
title_zh: '前置实测——非 force 权限行为探针（Wave 0，D-003@v2 回填 + driver 启动参数定版）'
author: 'qinyi'
created_at: 2026-09-08 13:00:34
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-003@v1]
allowed_paths:
  - sillyhub-daemon/tests/fixtures/cursor
target_files:
  - NEW:sillyhub-daemon/tests/fixtures/cursor/probe-trust-only.ndjson
  - NEW:sillyhub-daemon/tests/fixtures/cursor/probe-no-flags.ndjson
goal: >
  Wave 0 前置实测（FR-05 / D-003@v1）：跑不带 --force 的 headless 对话探针（两档：仅
  --trust / --force 与 --trust 都不带），让 agent 执行一个需要工具的动作，观察工具被拒 /
  卡死 / 降级行为，按 D-003@v1 判定规则定版 driver 启动参数与 permission_dialog 取值，
  结论回填 decisions.md D-003@v2。
implementation:
  - 前置（人工配合）：用户先跑 cursor-agent login 修复过期凭证；与 task-01 同款版本目录入口直跑（%LOCALAPPDATA%/cursor-agent/versions/2026.06.16-20-30-07-a07d3ac/node.exe + index.js，官方 ps1 损坏绕过），参数对齐批量 buildArgs cursor 分支（adapters/stream-json.ts:320-347）但去掉 --force
  - 探针执行（两档各一次）：均用 -p --output-format stream-json + 最小工具型 prompt（如让 agent 在临时目录创建一个文件）；档一只带 --trust（CLI 标注 --trust 仅 print/headless 有效）；档二 --force 与 --trust 都不带
  - 观察并逐项记录：工具调用是否被拒（帧流中有无拒绝/权限类帧型）、是否卡死无输出、有无降级（agent 跳过工具改纯文本回复或发出审批请求帧）
  - transcript 落盘：两档探针 stdout 存 probe-trust-only.ndjson 与 probe-no-flags.ndjson（脱敏同 task-01）
  - 判定出结论（D-003@v1 规则）：工具被拒或卡死 → 落 --force --trust 全自动 + permission_dialog=false（与批量层一致）；存在可用审批行为 → 按实测设计审批通道并开火 permission_dialog
  - 结论回填：decisions.md 新增 D-003@v2（answer 含两档证据锚点与参数定版）+ driver 启动参数定版结论（force_mode_args）——decisions.md 在 spec 变更目录不在源码仓，经主代理通道写入
acceptance:
  - probe-trust-only.ndjson 与 probe-no-flags.ndjson 存在、为合法 NDJSON（逐行可 JSON.parse）且已脱敏
  - decisions.md D-003@v2 已回填且结论明确：driver 启动参数定版（是否带 --force / 是否带 --trust）+ permission_dialog 取值 + 两档探针证据
  - 若出现卡死场景，记录含超时 kill 处置（约 120s），无残留挂死进程
verify:
  - cd sillyhub-daemon && node -e "const fs=require('fs');for (const f of ['probe-trust-only','probe-no-flags']){fs.readFileSync('tests/fixtures/cursor/'+f+'.ndjson','utf8').trim().split(/\r?\n/).forEach(l=>{if(l)JSON.parse(l)});};console.log('probe ok')"
  - 人工核对 decisions.md D-003@v2 结论明确（参数定版：是否带 --force）
constraints:
  - 不修改源码（allowed_paths 仅 fixtures 目录；driver 启动参数落地归 task-04）
  - 探针 prompt 最小化控制成本（验证行为即止，不追求完整任务）
  - 卡死场景设超时（约 120s kill 探针进程），避免挂死阻塞后续任务
provides:
  - contract: CursorForceModeDecision
    fields: [force_mode_args, permission_dialog_caps, probe_evidence]
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

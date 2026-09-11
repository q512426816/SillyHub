---
id: task-01
title: 'CLI own-log anchor resolver + own-only ctx tagging + bidirectional mutex + push convergence (sillyspec repo)'
title_zh: 'CLI 锚定器 + own 打标收敛 + 双向互斥 + 推送收敛（sillyspec 仓）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-12 05:15:06
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-02, FR-04, FR-06]
decision_ids: [D-001@v1, D-006@v2, D-007@v1, D-008@v1]
repo: sillyspec
base_commit: 2b5547961b7d309792fd6c5cb6f1946042fc551c
head_commit: 8aadc0f40e610fcb8b7c474924b41f3afd3d7e30
allowed_paths:
  - src/agent-session-log.js
target_files: [src/agent-session-log.js]
goal: >
  在 src/agent-session-log.js 落地会话身份锚定器 resolveOwnLogPaths（解析本 run 的 own 日志
  集合），ctx 打标/合并/推送全部收敛为 own-only，quick/change 双向互斥清镜像键——根除多窗口
  并行抢标与 hub 交叉污染（FR-01/02/04/06，D-001/D-006@v2/D-007/D-008）。
implementation:
  - 新增导出 resolveOwnLogPaths（入参对齐 detectAgentLogEntries 的 cwdCandidates/env/homeDir/now/windowMs，返回 posix log_path 集合），per harness 锚定：claude-code=env CLAUDE_SESSION_ID → <claudeRoot>/projects/<mungeClaudeProjectDir(cwd)>/<sessionId>.jsonl 精确，env 缺席回退 project 目录内最新活跃 jsonl（复用 listActiveFiles）；pi/deepseek-dsh=safePath 目录直算（mungePiSafePath/mungeDshSafePath，目录名即 cwd 天然锚定）；codex=detected 中 rollout 首行 session_meta.cwd==cwd 的最新主文件；SILLYSPEC_AGENT_LOG 绝对路径覆盖视为 own；cursor/opencode（loose 档）不锚定不打标不推送
  - zcode 锚定：node:sqlite DatabaseSync 延迟导入、只读 URI（file:...?mode=ro）开 ~/.zcode/cli/db/db.sqlite，session 表按 directory==cwd（Windows 反斜杠原样存储，比较复用既有 normCwd/cwdsMatch 归一）AND parent_id IS NULL AND id NOT LIKE 'sess_subagent_agent_%'，time_updated desc 取最新主会话；子代理=parent_id==主会话 id 的全部行（不比 directory——worktree TaskCard 子代理 directory 为 worktree 路径≠仓库根）；session id → rollout/model-io-sess_<id 去 sess_ 前缀>.jsonl 文件名映射
  - zcode 回退链（D-008）：node:sqlite 导入失败/库缺失/查询异常 → 退化为锚定 rollout 目录最新活跃主会话文件（mtime 最新、排除 subagent 文件名），子代理不打标（宁缺毋滥 D-001）；回退发生时 SILLYSPEC_DEBUG_AGENT_LOG=1 输出一行原因
  - own 豁免 MAX_PER_HARNESS（:59，DG-17）：锚定命中的主会话/子代理文件被单 harness 探测上限挤出 detected 时定向补收，常规探测（cwd 等值过滤+上限裁剪）逻辑不动
  - recordAgentLogInvocation 合并循环（:710-735）收敛：仅 detected∩own 条目写 ctx/invocations 递增/last_command/stat 刷新，:724-725 的 ctx 合并改双向互斥（D-006@v2）——quick run 置 quick_id 且 change_key=null，change run 置 change_key 且 quick_id=null（替换 ?? prev 单向保留）；非 own 条目只在留底保留探测事实（size/mtime/last_seen_at），ctx 不写不动（keep-prev）
  - push payload 收敛（:759-773，D-007）：entries = merged.entries ∩ own（按 log_path 过滤）后再组 body；hub_session_id 取值与 body 其余字段不变；本地产物留底继续记全部探测条目（sillyspec agent-log 本地可见性不变）
acceptance:
  - own∩detected 条目带本次 run 的 ctx；同 cwd 活跃窗口内非 own 条目 ctx 保持原值不被覆盖（FR-01/FR-06）
  - quick run 后 own 条目 quick_id=quick-xxx 且 change_key=null；change run 后 change_key=X 且 quick_id=null（预置镜像键的留底条目被清，两方向均可断言）
  - push payload 只含 own 条目（按 log_path 过滤）；本地产物留底含全部探测条目（非 own 不进任何推送）
  - zcode 锚定命中主会话+parent_id 子代理链（子代理 directory 不参与比较）；db 不可用回退只锚最新主文件且子代理无 ctx，debug 输出原因行
  - 同 cwd 并发超过 MAX_PER_HARNESS 个活跃 zcode 文件时 own 主会话/子代理仍被定向补收进 detected 不漏推
  - 全程 best-effort 不变：锚定/读库任何失败不抛错不阻断 run 主流程
verify:
  - cd C:/Users/qinyi/IdeaProjects/sillyspec && node test/agent-session-log.test.mjs（task-01 完成后允许既有断言红——合并/payload 语义变化，断言更新归 task-02 收敛）
  - cd C:/Users/qinyi/IdeaProjects/sillyspec && SILLYSPEC_DEBUG_AGENT_LOG=1 node bin/sillyspec.js agent-log --detect（真实 zcode 环境冒烟锚定结果与回退原因行）
constraints:
  - 只改 src/agent-session-log.js 单文件；测试断言更新与新用例归 task-02 承接（本 task 允许测试红，task-02 收敛）
  - 不改 HTTP 契约——schema_version=1、hub_session_id 语义不变、不新增 payload 字段；不动 backend/daemon/frontend
  - db.sqlite 一律只读打开（file:...?mode=ro），不写入不加锁不重试，不引入新 npm 依赖
  - cursor/opencode loose 档维持现状——不锚定不打标不推送，仅本地留底探测
  - 回退链宁缺毋滥：锚定识别失败不打标，不用 cwd 猜测兜底打标
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

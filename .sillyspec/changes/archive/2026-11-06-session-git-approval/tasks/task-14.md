---
id: task-14
title: '端到端联调（无 manual_approval 会话/门户会话/后台锚点态三场景，R-02/R-12 验证点）'
title_zh: '端到端联调（无 manual_approval 会话/门户会话/后台锚点态三场景，R-02/R-12 验证点）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-11-07 00:39:35
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-10, task-11, task-12, task-13]
blocks: [task-15]
requirement_ids: [FR-01, FR-04, FR-06]
decision_ids: [D-001, D-016, D-017]
allowed_paths:
  - .sillyspec/changes/2026-11-06-session-git-approval/
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
goal: >
  三端（daemon/backend/frontend）端到端联调收尾——无 manual_approval 会话、门户 ask_user_only 会话、后台锚点态三场景走通「拦截→确认卡→代执行/自动 deny→结果回喂→清卡」闭环，并落实 R-02 turn 保活与 R-12 resolver 时序两个实现期核实点；只读联调说明性卡，产出联调记录落变更目录。
implementation:
  - 环境准备——启动 backend + 一台在线 daemon + pnpm -C frontend dev；准备测试工作区 fixture（含已暂存两文件、未暂存改动、未跟踪文件三类状态，含中文路径文件一并冒烟）
  - 场景① 无 manual_approval 会话（D-001/D-016）——创建未开人工审批的普通交互会话，会话启动后让 agent 立即跑 git commit -m（首个 git 命令即拦截，验证 resolver 随会话启动就绪、R-12 时序无空洞）→ 预期弹 git 确认卡；改 msg+减选一个文件点「提交」→ 预期 daemon 代执行 commit 仅含勾选文件、Bash 工具结果回喂 agent 文本含新 sha 与实际提交文件集（FR-04）、卡片消失、会话继续
  - 场景① R-02 验证点——卡挂起超 60 秒不操作，观察 turn 不被 PLATFORM_NO_RUNNING_TURN 静默重置（AskUser dialog 长驻先例预期成立，若心跳断记录缺陷回流 task-03）；随后刷新页面确认卡经 dialog 落库恢复（D-004）并继续完成确认
  - 场景② 门户 ask_user_only 会话（D-017）——创建只问不审门户会话，agent 跑 git commit → 预期仍弹 git 确认卡（git 拦截先于 askUserOnly 自动放行）；同会话触发 AskUserQuestion → 预期问答卡照常渲染作答（既有链路零回归）
  - 场景③ 后台锚点态（D-019/R-11）——backgroundTask 会话触发 git commit → 无人确认等待 5 分钟（按实际等待，不为此改 daemon 定时逻辑）→ 预期自动 deny 回喂 agent（fail-safe，后台任务不提交）；期间/事后在前台观察待决卡到达与 resolved 事件清理无僵尸卡，点击已超时旧卡时 respond 报 unknown_request 前端静默降级不崩
  - push 流冒烟——场景①工作区追加提交后触发 git push 与 sillyspec push 默认形态各一次 → push 态卡渲染（目标/保护分支警示/按条明细可展开）→ 确认后代执行真实推送一次到测试远端/测试分支（R-05 凭据继承验证），结果文本回喂；sillyspec 形态验证压扁语义保留（推送后远端为压扁提交）
  - diff 端点冒烟——commit 卡点单文件 diff 入口 → 会话级 git-diff 端点返回 unified diff 并红绿渲染（W3 链路 + task-10 类型生成物实战）；中文路径文件 diff 一并验证
  - 逃生阀对照（FR-06 兼容）——daemon 置 SILLYHUB_GIT_APPROVAL=off 重跑 git commit/push → 行为与现状完全一致（不拦、agent 直接执行、无卡无挂起）
  - 联调结论与偏差记录写入变更目录（联调记录笔记），发现的缺陷回流对应任务卡（task-03/04/05/06/11/12 等）修复后重验本场景
acceptance:
  - 三场景各自端到端闭环符合预期——拦截弹卡、用户操作、代执行或自动 deny、结果回喂 agent、卡片清理（全局验收 2 三场景全过）
  - R-02——挂起超 60 秒 turn 未被重置、刷新后卡恢复可继续确认；R-12——会话首个 git 命令即拦截可达（无 manual_approval 会话）
  - push 代执行真实成功一次且结果回喂；sillyspec push 压扁语义保留；diff 弹窗端到端渲染（含中文路径）
  - SILLYHUB_GIT_APPROVAL=off 时行为与现状完全一致（全局验收 3）
  - 联调记录落 .sillyspec/changes/2026-11-06-session-git-approval/；发现缺陷均已回流修复并复验通过
verify:
  - 手动场景脚本照 implementation 各步执行并逐项核对预期（无自动化命令面，联调说明性卡不新增测试）
  - 辅助冒烟——curl 请求 GET /api/daemon/sessions/{id}/git-diff?path=某文件 返回 unified diff 文本
  - 相关单测复核绿（仅相关文件不全量）——pnpm -C frontend test -- src/components/daemon/__tests__/git-approval-card.test.tsx；pnpm -C sillyhub-daemon test -- tests/interactive/git-command-guard.test.ts tests/interactive/git-executor.test.ts
constraints:
  - 只读联调卡——不修改三端生产代码，缺陷回流对应任务卡修复，不在本卡顺手改
  - 禁止跑全量测试（仅复核相关单文件，规则 0）
  - 真实 push 冒烟仅推测试远端/测试分支，禁止动生产远端主线
  - 后台锚点态 5 分钟兜底按实际等待验证，不为加速改 daemon 定时逻辑
  - 测试数据可用开发/测试数据重置口径（CLAUDE 规则 11），联调后清理测试工作区残留提交
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
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->

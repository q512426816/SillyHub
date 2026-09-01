---
id: task-10
title: 'daemon regression and real e2e verification'
title_zh: 'daemon 回归与真实端到端验证'
author: 'qinyi'
created_at: 2026-09-02 00:35:00
priority: P0
depends_on: ['task-01','task-02','task-03','task-04','task-05','task-06','task-07','task-08','task-09']
blocks: []
requirement_ids: [FR-01, FR-05, FR-06, FR-07, FR-08, FR-09, FR-10, FR-11, FR-12, FR-13, FR-14, FR-15, NFR-02, NFR-03, NFR-05]
decision_ids: [D-001@v1, D-002@v1, D-003@v1, D-004@v1, D-006@v1, D-008@v1, D-011@v1, D-012@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/tests/
  - deploy/docker-compose.yml
  - .sillyspec/changes/2026-09-01-session-group-chat/e2e/
goal: >
  daemon 侧确认 stage=group_member 标识透传零逻辑改动回归，并按项目部署惯例本机 Docker 部署后双浏览器真实实测群聊全链路 AC-01~07 留存证据，为变更收口提供端到端验证依据。
implementation:
  - daemon 回归——跑 session-manager 相关既有 vitest 套件（tests/interactive/ 全量 + tests/cli-session-manager-injection.test.ts + tests/daemon-interactive-*.test.ts）确认全绿，核对 stage 透传链路（CreateSessionInput.stage 归一化 → 快照持久化 → 恢复回填）对 stage=group_member 零逻辑改动，若确需改动仅最小修正并在本卡说明
  - 本机 Docker 部署——按项目部署惯例重建 backend/frontend 镜像并 docker compose up（postgres/redis/minio/litellm 就绪、宿主 daemon 在线注册），验证前端构建 chunk 含群聊特征非旧缓存镜像（教训见 docs/sillyspec/finished/sillyspec-worktree-execute-pitfalls.md §7）
  - AC-01 两用户两 agent 建群——A 用户 @agent1 提问 → 流式回复带成员身份 → 刷新页面回放顺序与身份一致；B 用户未 @ 发消息无 agent 触发
  - AC-02 @全体——两 agent 并行回复；随后单独 @agent2 验证其群摘要可见 agent1 回复（独立记忆互见）
  - AC-03 互@——@agent1 让其转交任务给 agent2（回复含 @agent2）→ agent2 被触发；关闭 agent_cross_mention 开关后同样 @ 不触发
  - AC-04 热切换——agent1 回复中途在成员面板切换模型 → 当轮旧模型完成、下轮新模型生效、记忆延续
  - AC-05 权限——非群成员访问群详情/消息/SSE 流均 404，workspace admin 可读；AC-06 typing——双浏览器同看一群一方输入另一方实时见正在输入，核查草稿不入库不进群背景摘要
  - AC-07 单聊回归——现有单聊/quick-chat/团队会话各跑一轮冒烟行为正常
  - 证据归档——各 AC 截图/录屏按编号命名存 .sillyspec/changes/2026-09-01-session-group-chat/e2e/，发现缺陷记录并回改对应 task 范围文件（须在本卡 allowed_paths 内）或反馈主代理协调
acceptance:
  - AC-01~07 浏览器实测逐项通过且证据文件齐备（存 .sillyspec/changes/2026-09-01-session-group-chat/e2e/，按 AC 编号命名）
  - daemon 既有 session-manager 相关套件全绿且零逻辑改动（或有最小改动说明）
  - 命中模块 backend/frontend/daemon 测试全绿（按模块跑不全量）
verify:
  - cd sillyhub-daemon && pnpm test
  - cd sillyhub-daemon && pnpm typecheck
  - 浏览器实测 checklist AC-01~07 全过（证据存 .sillyspec/changes/2026-09-01-session-group-chat/e2e/）
constraints:
  - 禁止跑全量测试只跑命中模块（CLAUDE.md 规则 0），全量留给 CI
  - e2e 用真实 Docker 部署不 mock，LLM 依赖真实 LiteLLM 网关（compose 内 litellm 服务）
  - daemon 现有 session-manager 用例不动（design §11 daemon 测试策略），不为过验收改测试断言（CLAUDE.md 规则 9）
  - 发现缺陷回改对应 task 范围文件须在本卡 allowed_paths 内，否则反馈主代理协调处理
expects_from:
  - task-05: 群频道事件契约（log/turn_completed 事件携 member_id/member_name/projection_log_id，回放与实时一致性验证依据）
  - task-06: typing 事件（group_typing 频道 + 群 SSE typing 分支，AC-06 验证依据）
  - task-08: 群聊面板可用（group-chat-panel 双浏览器实测载体）
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

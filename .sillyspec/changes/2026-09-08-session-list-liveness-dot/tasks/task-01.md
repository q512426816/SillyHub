---
id: task-01
title: 'add-use-session-liveness-hook'
title_zh: 'use-session-liveness hook——取数（固定 all 槽 30s 轮询、map DESC 首胜）+ 客户端转移检测状态机 + localStorage 读写降级'
author: 'qinyi'
created_at: 2026-09-08 00:30:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-03]
decision_ids: [D-001@v2, D-003@v1]
allowed_paths:
  - frontend/src/hooks/use-session-liveness.ts
target_files:
  - NEW:frontend/src/hooks/use-session-liveness.ts
provides:
  - contract: useSessionLiveness
    fields: [bySessionId, entries, isLoading, isUnread, clearUnread]
    consumers: [task-02, task-03]
goal: >
  新建 use-session-liveness hook——固定 all 缓存槽 30s 轮询 listWorkspaceAgentLogs(100) 建 bySessionId map（DESC 首个胜出），
  并跑客户端转移检测状态机维护 working/blocked 到 idle 的未读标记，为会话列表行小灯与红点供数。
implementation:
  - useQuery 固定 queryKey ["agent-liveness-overview", "all"]（第二段固定 all 槽不带 wsId，多挂载共享缓存与轮询），queryFn 调 listWorkspaceAgentLogs(100)，refetchInterval 30_000
  - map 构建按 API 返回序（last_seen_at DESC）首个胜出——同 agent_session_id 多行取最新行，仅收 agent_session_id 有值条目
  - 转移检测状态机——每轮对每个会话读 localStorage 键 sillyhub:liveness-state:${id} 得 prevState；prevState 属于 working/blocked 且 current 为 idle 时写 sillyhub:liveness-unread:${id} 值 Date.now()，随后把 state 键更新为 current；首见（无 prevState）不触发
  - localStorage 读写全程 try/catch 降级——存储不可用时转移检测停摆（不亮红点）不崩溃
  - 导出 isUnread(sessionId) 与 clearUnread(sessionId) helper（unread 标记键存在性查询与删除），存储实现细节模块内私有不导出
acceptance:
  - queryKey 第二段固定为 all，与总览卡 wsId 槽各自独立互不干扰
  - 转移判定只比较 prevState 与 current 的 state 值；首见与 unknown 到 idle 均不触发未读标记
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不改后端与 API，不动工作台总览卡与 agent 日志面板两处既有展示
  - 不往 liveness 状态枚举加值——未读是纯 UI 本地状态（localStorage）
  - 不用 state_derived_at 做转移判定（Grill BL-01 铁证——它是 tailer 每 10s 无条件覆写的心跳戳，不是转移时刻）
  - 本 task 不写测试文件，单测由 task-03 统一补
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

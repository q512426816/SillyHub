---
id: task-02
title: 'AgentSessionQueuedMessage.position 模型字段 + 入队路径行锁内 MAX+1 + list/dispatch 排序键改 ORDER BY position, created_at（agent/model.py + session/service.py 入队/查询段）'
title_zh: 'AgentSessionQueuedMessage.position 模型字段 + 入队路径行锁内 MAX+1 + list/dispatch 排序键改 ORDER BY position, created_at（agent/model.py + session/service.py 入队/查询段）'
author: 'qinyi'
created_at: 2026-08-31 04:15:00
priority: P0
depends_on: [task-01]
blocks: [task-03]
requirement_ids: [FR-04]
decision_ids: [D-002]
allowed_paths:
  - backend/app/modules/agent/model.py
  - backend/app/modules/daemon/session/service.py
provides:
  - contract: AgentSessionQueuedMessage.position 列 + 入队行锁内 MAX+1
    fields:
      - list/dispatch 排序键 ORDER BY position, created_at
      - position 模型字段（Integer nullable=False default=0）
      - TASK_WAKEUP merge 路径不新建行不改 position
expects_from:
  - 'task-01: DB 列 agent_session_queued_messages.position INT NOT NULL（迁移 20260831130000 回填后运行时先于本卡生效；代码层 create_all 同步）'
goal: >
  AgentSessionQueuedMessage 增加 position 模型字段，入队路径在会话行锁内取
  MAX(position)+1，list/dispatch 两处排序键改 ORDER BY position, created_at，
  让派发序可被 FR-04 拖拽排序持久化重排（独立 position 列而非改 created_at，
  审计语义不破坏）。
implementation:
  - backend/app/modules/agent/model.py：AgentSessionQueuedMessage（:1001-1088）新增 position: int = Field(default=0, sa_column=Column(Integer, nullable=False, default=0))（design §6 原文），置于 status 字段附近；同步把类 docstring 中「依 created_at 顺序自动派发」排序描述改为「依 position, created_at 顺序」——注释与实现一致
  - backend/app/modules/daemon/session/service.py 入队路径（_inject_into_session 排队分支 :3272 建 entry 处）：行锁内 select(func.max(AgentSessionQueuedMessage.position)).where(agent_session_id == session.id)，entry 取 position=(max_ 或 -1)+1（空队列首条 position=0），与满员检查/TASK_WAKEUP merge 同事务
  - TASK_WAKEUP merge 路径（:3237-3271）保持不动——原地改 prompt 不新建行、不改 position（design §4 Phase1.2 明示）
  - list_queued_messages（:4205-4215）：order_by 改 col(AgentSessionQueuedMessage.position), col(AgentSessionQueuedMessage.created_at)
  - dispatch_queued_messages 队首查询（:4318-4328）：order_by 同改双键（position 升序、created_at 次之）
  - 仅改排序键与入队赋值；不动 dispatch 单条派发/失败即停语义（循环化归 task-03）
acceptance:
  - 新入队条目 position = 该会话现有最大 position+1（空队列=0），计算发生在 _get_owned_session_for_update 会话行锁内，无并发窗口（R-01/D-002）
  - list 与 dispatch 队首均按 position 升序、created_at 次之返回/取条（FR-04 派发序定义，两处一致）
  - 同会话第二次 TASK_WAKEUP 通知走 merge 不新建行、原条目 position 不变
  - 模型字段 default=0 且 nullable=False，与 task-01 迁移列定义一致；测试库 create_all 建表后既有排队用例可跑
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_queue.py -q --no-cov
constraints:
  - MAX+1 必须在会话行锁内、与入队同事务完成（R-01/D-002），禁止锁外读 MAX
  - 不加唯一约束（D-002：行锁已保证串行，重复不破坏正确性）；不回填/不重写存量行 position（NG-04，存量归 task-01 迁移）
  - 不改 dispatch 循环化/失败计数/非 active 收敛（task-03 范围）；不加新端点（task-04 范围）
  - position 字段须带注释说明「仅排序用，审计时间线仍是 created_at」（D-002）
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

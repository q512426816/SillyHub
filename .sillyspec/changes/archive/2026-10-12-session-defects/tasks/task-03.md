---
id: task-03
title: 'F3 ghost rows — root-cause investigation (red-first production-pair reproduction test), fix agent_task_store (terminal protection + same-name merge/remap), turn reproduction green'
title_zh: 'F3 幽灵行——根因调查（生产成对模式复现测试先红）→ 修复 agent_task_store（终态保护+同名合并/重映射）→ 复现测试转绿'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-12 21:01:59
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/daemon/agent_task_store.py
  - backend/app/modules/daemon/tests/test_agent_session_tasks.py
target_files:
  - backend/app/modules/daemon/agent_task_store.py
  - backend/app/modules/daemon/tests/test_agent_session_tasks.py
goal: >
  根治 agent_session_task 任务幽灵行（生产会话 47e2ff1a 实证 23 组「同名
  stopped(空摘要)+completed(真摘要)」成对行，174 行实际约 151 任务）：先以
  生产成对模式写复现测试（先红），按调查结论修复 agent_task_store，保证
  一个逻辑任务至多一行真实终态（D-005 核心不变量）。
implementation:
  - 复现测试先红：按生产成对模式的两候选路径构造事件序列写失败用例（①完成回写后同名新 task_id 事件到达；②终态回写与 sweep_confirmed_dead_tasks 清扫竞态），落 backend/app/modules/daemon/tests/test_agent_session_tasks.py，断言同 session 同名任务至多一行真实终态。
  - 根因调查：追 task_id 生命周期（daemon 生成/重放）与清扫竞态，定位成对行成因——upsert_agent_task（backend/app/modules/daemon/agent_task_store.py:204）仅按 (session_id, task_id) 定位键归并（:207 唯一约束），同名不同 task_id 事件各插一行，终态吸收/复活分支（:249-261）不感知「同名」维度。
  - 按调查结论修复（方向已定，落点允许按证据微调）：终态保护已有则补同名合并/重映射——同名新 task_id 事件到达且旧行已真实终态时合并到新行并停用旧行（或重映射 task_id），保证「一逻辑任务一行」不变量。
  - 「停用旧行」标记如引入 MUST 与 RUN_CLOSE_SWEEP_REASON（backend/app/modules/daemon/agent_task_store.py:50）显式区隔：复活守卫仅精确匹配该清扫文案（:256-261），新停用标记不得复用该字符串，防清扫 stopped 行被误当可合并对象。
  - 复现测试转绿；既有四条语义回归全绿（同键单行 / 迟到 running 不复活真实终态行 / 异种终态允许覆盖 / 清扫复活守卫仅精确匹配 RUN_CLOSE_SWEEP_REASON）。
acceptance:
  - 复现测试先红后绿留痕：修复前断言失败（成对行存在），修复后同断言转绿（至多一行真实终态），登记 requirements 测试绑定 FR-04 行。
  - 既有四条语义回归用例全绿：upsert 键 (session_id, task_id) 单行、迟到 running 不复活终态行、异种终态允许覆盖、sweep 复活守卫仅精确匹配 RUN_CLOSE_SWEEP_REASON 文案。
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_agent_session_tasks.py -q --no-cov
constraints:
  - 不改 agent_session_task 表结构（零 migration，design 非目标）；不破坏既有四条 upsert/sweep 语义（终态定格、异种覆盖、清扫复活守卫口径不动）。
  - 「停用旧行」标记（如引入）MUST NOT 复用 RUN_CLOSE_SWEEP_REASON 字符串；只跑相关测试不跑全量（规则 0）。
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

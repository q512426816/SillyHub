---
id: task-02
title: 'backend context.py claim payload interactive 分支白名单透传 + 透传单测'
title_zh: 'backend context.py claim payload interactive 分支白名单透传 + 透传单测'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-10 15:56:00
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-03, FR-05]
decision_ids: [D-002@v1, D-005@v1]
allowed_paths:
  - backend/app/modules/daemon/lease/context.py
  - backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py
target_files:
  - backend/app/modules/daemon/lease/context.py
  - backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py
expects_from:
  task-01:
    - contract: borrow_workspace_context
      needs: [root_path, name, slug]
goal: >
  把 task-01 写入 lease metadata 的 borrow_workspace_context 经
  build_claim_payload 白名单透传给 daemon claim payload，打通数据链第二跳。
implementation:
  - context.py build_claim_payload interactive 分支（kind == "interactive" 块内、
    transport tar/shared 两 return 之前，对齐 fork_mode 透传位
    backend/app/modules/daemon/lease/context.py:618-619）加真值守护单键——
    lease_meta.get("borrow_workspace_context") 为真时
    payload["borrow_workspace_context"] 取该值透传
  - 透传单测：定位/扩展 backend/app/modules/daemon/lease/tests/
    test_init_claim_tokens.py（既有 claim payload 测试文件），加用例——
    interactive lease metadata 含 borrow_workspace_context → claim payload 同名
    同值；metadata 无键 → payload 无键；batch lease 不透传（interactive 分支外）
acceptance:
  - 借用 interactive lease 的 claim payload 含 borrow_workspace_context（与
    metadata 逐字段一致）
  - metadata 无键/None → claim payload 无键（缺键穿透不伪造默认值）
  - 置于 transport 分支之前：tar 与 shared 两路 return 均携带（断言至少覆盖
    shared 默认路）
verify:
  - cd backend && uv run pytest -q --no-cov app/modules/daemon/lease/tests/test_init_claim_tokens.py
constraints:
  - 仅白名单单键透传，不透传整个 metadata（既有惯例）
  - 不改 batch 分支行为（batch lease 无该键语义）
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

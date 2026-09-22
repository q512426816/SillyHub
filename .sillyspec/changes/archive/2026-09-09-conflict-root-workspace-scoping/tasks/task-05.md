---
id: task-05
title: '502 gateway message fork by daemon_code (optional FR-06)'
title_zh: '502 网关文案按错误码分叉（可选）'
author: 'qinyi'
created_at: 2026-09-09 21:29:54
priority: P0
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/daemon/sillyspec_compare.py
  - backend/app/modules/daemon/tests/test_sillyspec_compare.py
target_files:
  - backend/app/modules/daemon/sillyspec_compare.py
  - backend/app/modules/daemon/tests/test_sillyspec_compare.py
goal: >
  502 网关文案按 daemon_code 分叉，让 workspace_root_unknown /
  conflict_record_missing 的用户提示可行动（可选 FR-06 锦上添花）。
implementation:
  - _fetch_snapshot 的 DaemonRpcRemoteError → DaemonRpcRemoteGatewayError 构造处按 exc.code 分叉 message：workspace_root_unknown → "该工作区尚未被本机认领，请先在该工作区发起一次会话后重试。"；conflict_record_missing → "冲突记录已失效，请刷新冲突列表。"；其余维持现状文案
  - test_sillyspec_compare.py 补两分支文案断言（既有 mock 用例扩展）
acceptance:
  - daemon_code=workspace_root_unknown / conflict_record_missing 时 502 message 为对应分叉文案（测试断言）
  - 其它 daemon_code 文案不变（回归）
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_sillyspec_compare.py -q --no-cov
constraints:
  - details 结构不变（daemon_code/daemon_message 仍透传）
  - 仅改 message 字符串，不动异常类型映射
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

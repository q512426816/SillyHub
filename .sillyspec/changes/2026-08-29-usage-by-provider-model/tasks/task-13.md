---
id: task-13
title: '全链路自测（真实会话含子代理明细=run 四维；切模型 ANTHROPIC_MODEL 生效；用量卡窗口随动）'
title_zh: '全链路自测（真实会话含子代理明细=run 四维；切模型 ANTHROPIC_MODEL 生效；用量卡窗口随动）'
author: 'qinyi'
created_at: 2026-08-29 02:52:55
priority: P0
depends_on: ['task-01','task-02','task-03','task-04','task-05','task-06','task-07','task-08','task-09','task-10','task-11','task-12']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-001@v1, R-07, R-08]
allowed_paths:
  - backend/app/modules/daemon/run_sync/service.py
goal: >
  全链路自测：真实会话（含子代理）明细四维==run 四维与 api_requests 计数；切模型（含配兜底模型供应商）daemon env ANTHROPIC_MODEL 生效；用量卡窗口随动。
implementation:
  - 本地起 dev 链路跑一轮真实会话核对 DB 明细
  - 会话页切模型发起对话验证 env 与 config_snapshot
  - runtimes 页 1d/7d/30d 三窗核对
acceptance:
  - design 验收口径三条全部实测通过并记录证据
verify:
  - cd backend && uv run pytest app/modules/daemon -q --no-cov -n auto
constraints:
  - 回归验证类 task：只修实测暴露的问题，不加新功能
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

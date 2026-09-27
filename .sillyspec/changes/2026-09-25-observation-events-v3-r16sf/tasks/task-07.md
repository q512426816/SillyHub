---
id: task-07
title: 'Sync module docs and changelog for observation events v3'
title_zh: '文档同步（platform_sync+frontend_components）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-25 00:55:16
priority: P0
depends_on: ['task-06']
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-008@v1]
allowed_paths:
  - .sillyspec/docs/SillyHub/modules/platform_sync.md
  - .sillyspec/docs/SillyHub/modules/frontend_components.md
  - .sillyspec/docs/SillyHub/modules/frontend_components.changelog.md
target_files:
  - .sillyspec/docs/SillyHub/modules/platform_sync.md
  - .sillyspec/docs/SillyHub/modules/frontend_components.md
  - .sillyspec/docs/SillyHub/modules/frontend_components.changelog.md
goal: >
  按最终实现同步模块文档与 changelog：platform_sync 端点双态语义/开关/feature_flag 入口，
  frontend_components 告警条与两段拉取——文档与实现一致是归档前置（CLAUDE.md 规则 18）。
implementation:
  - .sillyspec/docs/SillyHub/modules/platform_sync.md：契约摘要补 POST/GET /changes/{name}/events 双态语义（开关开/关各参数行为、响应字段差异、fail-closed 开关键 observation-events-v3）与 feature_flag 入口条目
  - .sillyspec/docs/SillyHub/modules/frontend_components.md：变更详情 aside 域补 ObservationAlertBar（一次决策语义）与 ChangeEventsCard 两段拉取描述
  - .sillyspec/docs/SillyHub/modules/frontend_components.changelog.md：追加本变更条目（含 2026-09-25-observation-events-v3-r16sf 标识）
acceptance:
  - 三份文档所述参数/字段/开关语义与代码一致（抽查明细 65536/缺省 2000/truncated/receivedAt 逐字核对）
  - 模块卡片 frontmatter（doc_type/module_id 等）不动
verify:
  - grep -n "observation-events-v3" .sillyspec/docs/SillyHub/modules/platform_sync.md
  - grep -n "ObservationAlertBar" .sillyspec/docs/SillyHub/modules/frontend_components.md .sillyspec/docs/SillyHub/modules/frontend_components.changelog.md
constraints:
  - 只改文档不改代码；不改其他模块文档
  - 术语与 design/requirements 同口径（64KB=65536 字符等逐字一致）
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

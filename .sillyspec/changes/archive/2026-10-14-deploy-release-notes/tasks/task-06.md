---
id: task-06
title: 'skill 硬步骤——sillyhub-docker-deploy SKILL.md 增「发布记录」节（查起点→git log→写 md 模板→失败也记录→平台不可达回退）'
title_zh: 'skill 硬步骤——sillyhub-docker-deploy SKILL.md 增「发布记录」节（查起点→git log→写 md 模板→失败也记录→平台不可达回退）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-14 10:04:08
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-004@v1]
allowed_paths:
  - .zcode/skills/sillyhub-docker-deploy/SKILL.md
target_files:
  - .zcode/skills/sillyhub-docker-deploy/SKILL.md
goal: >
  skill 增「发布记录」硬步骤：部署验证后 agent 查平台最近记录取 commit 起点，
  git log 规整中文变化总结，写 docs/releases/ 新 md（失败也写 status: failed），
  平台不可达回退本地锚定。
expects_from:
  - contract: GET /api/deploy-records
    needs: [commit_to, seq]
implementation:
  - .zcode/skills/sillyhub-docker-deploy/SKILL.md「验证」节之后新增「发布记录（每次部署必做）」节
  - 步骤：① 复用登录节 TOKEN 调 GET /api/deploy-records 取首条 commit_to 与 seq；② git log <from>..HEAD --pretty=format:'%h|%an|%s' 取提交列表；③ 按模板写 docs/releases/YYYY-MM-DD-<三位序号 = 上条 seq+1>-<HEAD 短SHA>.md（frontmatter 8 字段 + 正文按 🆕新增/🔧修复/⚡优化 分组的中文总结）
  - 失败部署：验证节判失败时也写记录，status: failed，正文写失败原因（构建报错/容器不健康等）
  - 回退：平台不可达或无记录 → seq 取 docs/releases/ 目录内最大序号+1（目录空=001），commit_from 留空（yaml null）
  - 模板内嵌完整可照抄示例（frontmatter 字段顺序与类型逐字对齐 design.md md 契约，R-03 应对）
acceptance:
  - skill 文档含完整步骤与模板，无字段歧义
  - 手工按模板写一条 md 放测试目录，task-02 的解析单测字段口径一致（frontmatter 契约双向对齐）
verify:
  - 人工核对 SKILL.md 新节完整性（文档类任务无自动测试；契约一致性由 task-02 测试中的样例 md 保障）
constraints:
  - 记录写仓库 docs/releases/（不推送到远端，随工作成果一起 commit）
  - 不把平台凭证写入 md 或 skill 文档（SKILL.md 既有规约）
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

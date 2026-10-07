---
id: task-11
title: '端到端验收——存量折算回显/加模型标角色/开会话选模型/附件门控按标记/选列表外 422（手动验收记录留变更目录）'
title_zh: '端到端验收——存量折算回显/加模型标角色/开会话选模型/附件门控按标记/选列表外 422（手动验收记录留变更目录）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-06 21:36:44
priority: P0
depends_on: ['task-07', 'task-10']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: []  # (预填源未就绪：plan 阶段后跑 prefill-refresh)
allowed_paths:
  - .sillyspec/changes/2026-10-06-provider-model-list/
target_files: []
goal: >
  端到端手动验收（Wave5-13，FR-01/02/03 实机链路）：存量供应商折算回显 → 加新模型标角色 →
  开会话选该模型 → 附件门控按条目标记判定 → 选列表外模型 422；验收记录写入变更目录
  docs/verification-e2e.md（流程产物不进 target_files）。
implementation:
  - 环境：本地起 backend + frontend（Docker Compose 或本地进程均可），存量供应商用迁移前已有的真实配置（验证 D-004 折算）；验收前 alembic upgrade head 完成
  - 步骤一（存量折算回显，FR-01/FR-05）：打开供应商编辑表单——迁移后 Read.models 与迁移前 model + 四槽 + fallback 的折算预期一致（角色/one_m 落在对应条目、旧 multimodal 显式标记折算为 auto 属预期行为变化，核对文案）
  - 步骤二（加模型标角色，FR-01）：列表编辑器添加新模型行、标 sonnet 角色 + one_m 勾选 + multimodal true，保存后重新打开回显一致；列表卡片展示主模型与角色标签
  - 步骤三（开会话选模型，FR-03）：创建/配置会话，模型下拉候选 = 该供应商 models 条目名；选择步骤二新增模型，会话快照与 claim 下发 model = 所选（daemon 侧注入正常启动会话）
  - 步骤四（附件门控按标记，FR-02）：对步骤三会话发图片附件——条目标 true 的模型走图块通道；改选 multimodal false 条目模型后图片降级文件落盘；auto 条目按模型名启发式
  - 步骤五（选列表外 422，FR-03）：会话配置提交一个不在列表的模型名（经 API 直发或临时改下拉）→ 422 响应含可用模型提示文案
  - daemon 侧核对：sillyhub-daemon 仓 diff=0（R-02 硬约束）；会话正常运行证明 injector 消费键兼容
  - 验收记录写入 .sillyspec/changes/2026-10-06-provider-model-list/docs/verification-e2e.md：每步操作/期望/实际/截图要点 + 发现问题清单（有问题回写对应 task 卡修复后复验）
acceptance:
  - 五步全部通过且记录在 docs/verification-e2e.md（操作、期望、实际一致，含异常分支）
  - 存量折算回显与迁移预期一致；新模型从添加到会话生效全链贯通
  - 门控三态在真机附件链路表现与条目标记一致（true 图块 / false 落盘 / auto 启发式）
  - 列表外模型 422 且文案含可用模型提示
  - sillyhub-daemon 仓 git diff 为零
verify:
  - ls .sillyspec/changes/2026-10-06-provider-model-list/docs/verification-e2e.md（验收记录存在且五步齐全）
  - git -C sillyhub-daemon status --porcelain（期望空输出）
  - cat .sillyspec/changes/2026-10-06-provider-model-list/docs/verification-e2e.md（人工复核五步记录与问题清单闭环）
constraints:
  - MUST NOT 改 sillyhub-daemon 仓任何文件（发现 daemon 侧问题即停：属本变更设计错误，回改 backend 折算层）
  - 验收记录只写变更目录（allowed_paths 仅 .sillyspec/changes/2026-10-06-provider-model-list/），MUST NOT 改业务代码——发现问题回写对应 task 卡（task-01~10）修复后复验
  - 本卡为手动验收不写自动化测试；不跑全量测试（规则 0）
  - 附件链路真机验证需 daemon 在线（附件门控链含 daemon 端组包）；无法真机时以 task-07 门控用例 + 本卡步骤一/二/五替代并在记录中注明覆盖缺口
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

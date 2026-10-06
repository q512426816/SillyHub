---
id: task-08
title: '前端模型列表编辑器——行内 name/三态下拉/角色标签/one_m/删行 + 添加 + fetch 一键加入；旧 4 槽 UI 退役'
title_zh: '前端模型列表编辑器——行内 name/三态下拉/角色标签/one_m/删行 + 添加 + fetch 一键加入；旧 4 槽 UI 退役'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-06 21:36:44
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-01]
decision_ids: []  # (预填源未就绪：plan 阶段后跑 prefill-refresh)
allowed_paths:
  - frontend/src/components/llm-providers/
target_files:
  - frontend/src/components/llm-providers/llm-provider-form.tsx
  - frontend/src/components/llm-providers/model-input-with-fetch.tsx
goal: >
  供应商表单模型区改为模型列表编辑器（FR-01 / Wave4-9，R-04）：每行 = 模型名输入 + 多模态
  三态下拉 + 角色多选标签 + one_m 勾选 + 删除，底部「添加模型」；在线拉模型保留并支持一键
  加入列表行；旧 4 角色槽 UI 与兜底模型输入退役（列表行内标角色取代槽位语义）。
implementation:
  - frontend/src/components/llm-providers/llm-provider-form.tsx 模型区重构：删除 ROLE_ROWS 四固定槽（:53-57 角色行定义、:102-138 角色行状态与 :118-121 服务端映射、:139-141 env 键联动、:281-284 fetchedModels 四槽共用、:337-338 提交时 mapping 构造）与兜底模型输入（:251 default_fallback_model）
  - 新增行内列表编辑器：每行控件 = 模型名输入（必填，空白行提交时剔除或校验拒绝）+ 多模态三态 Select（auto 跟随启发式 / true / false）+ 角色多选（sonnet/opus/fable/haiku 四档 Tag/Select multiple，可不标）+ one_m 勾选（Checkbox）+ 删除按钮；底部「添加模型」按钮追加空行
  - 表单状态形态改为条目列表（name/multimodal/roles/one_m 四键），提交时整体作为 models 传 Create/Update payload（FormValues.models，类型定义在 frontend/src/lib/api/llm-providers.ts 归 task-09，本卡先用本地形态并在卡内注明依赖）；同角色多条时界面提示「注入将取首条」但不禁止（宽容口径）
  - 在线拉模型保留：fetchProviderModels（:433 一带）结果供行内一键加入——点击拉到的模型名即在列表追加一行该模型（ModelInputWithFetch 组件按需改造复用或退役，frontend/src/components/llm-providers/model-input-with-fetch.tsx 允许路径内处置）
  - 旧 4 槽与兜底输入退役后，settings_config.env 的 ANTHROPIC_DEFAULT_* 联动（:139-141 与 :302）一并移除（角色语义已归条目 roles，注入折算由后端 task-04 承担，前端不再拼 env）
  - 初始值回显：initial.models（Read 响应条目）直接映射行状态；空列表显示空编辑器
  - 样式遵循多主题铁律（brand-* 语义阶 + antd ConfigProvider token，不手写色值；参考 FRONTEND_PAGE_STYLE.md）
acceptance:
  - 表单可增删行、行内改模型名/三态/角色标签/one_m，提交 payload 的 models 为条目列表四键齐全
  - 拉模型一键加入：fetch 返回的模型点击后追加为新行；不再出现 4 槽表格与兜底模型输入
  - 编辑存量供应商（旧数据已由迁移折算）回显为列表行（角色/one_m 保留在对应条目）
  - 同角色多条仅提示不禁；空白模型名行不提交（剔除或校验拒绝）
  - 旧 4 槽相关代码（ROLE_ROWS / cleanRoleMappings / ANTHROPIC_DEFAULT 联动 / default_fallback_model 输入）grep 零残留
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - grep -n "ROLE_ROWS\|cleanRoleMappings\|ANTHROPIC_DEFAULT\|default_fallback_model" frontend/src/components/llm-providers/llm-provider-form.tsx（期望零命中）
  - cd frontend && pnpm exec eslint src/components/llm-providers --ext .tsx,.ts
constraints:
  - MUST NOT 触碰 frontend/src/lib/llmProviderPresets.ts 或预设相关文件（预设零触碰，全局硬约束）
  - MUST NOT 动 lib/api/llm-providers.ts 类型与 api-types.ts（类型面归 task-09）；本卡若需临时类型先本地定义，task-09 收口
  - MUST NOT 动 llm-provider-list.tsx 展示面（归 task-09）；测试文件归 task-10
  - 交互控件复用现有 antd 形态（R-04），不引入新依赖库
  - 样式遵守多主题铁律（brand-* 语义阶 / 主题 token，禁止 blue-* 滥用与硬编码色值）
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

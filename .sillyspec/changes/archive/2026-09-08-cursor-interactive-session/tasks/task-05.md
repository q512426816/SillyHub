---
id: task-05
title: 'Register cursor in providers.ts (PROVIDER_CAPS.cursor + INTERACTIVE_PROVIDERS.cursor) + sync provider-registry test key set'
title_zh: 'providers.ts 注册（PROVIDER_CAPS.cursor + INTERACTIVE_PROVIDERS.cursor）+ provider-registry.test.ts 键集合同步'
author: 'qinyi'
created_at: 2026-09-08 13:00:34
priority: P0
depends_on: ['task-04']
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/providers.ts
  - sillyhub-daemon/tests/interactive/provider-registry.test.ts
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
goal: >
  把 cursor 注册进 daemon interactive 唯一注册点 providers.ts（单源）——PROVIDER_CAPS.cursor
  八键 + INTERACTIVE_PROVIDERS.cursor 条目（family='stream_json'），并同步
  provider-registry.test.ts 键集合/实例化/family 反查断言。cursor 由此成为注册表内
  interactive 引擎，task-07/08 的 backend/frontend caps 镜像以本表为逐键对齐基准
  （FR-01 / D-001@v1，design「注册（providers.ts）」节）。
implementation:
  - providers.ts PROVIDER_CAPS 加 cursor 条目，八键取值为 resume=true、mcp=false、multimodal=false、thinking=false、subagent=false、permission_dialog=false、edit_patch=false、model_select=true
  - 条目上方照 claude/codex/pi 的 docblock 注释块格式逐键写取值依据锚点——resume=true 依据 driver 的 --resume 通道（D-001@v1）+ CLI 实测，且以 Wave 0 验证 B（--resume 记忆连续性）通过为前置（Grill CC-08；未过则翻 false 并在 execute 期记 D 版本决策）；model_select=true 依据 driver --model 通道；其余六键无对应 CLI 通道或未验证（mcp 无 per-session --mcp-config、附件/团队派工/审批桥/structuredPatch 均无通道），按 §6.2 先实现后翻 true 纪律一律 false
  - providers.ts INTERACTIVE_PROVIDERS 加 cursor 条目——provider='cursor'、family='stream_json'（与批量层 PROVIDER_TO_PROTOCOL 反查一致，守护测试断言）、displayName='Cursor'、createDriver 为零参构造返回 new CursorDriver()（返回类型显式标注为 InteractiveDriver，切断「注册表→driver 类→handle.provider→keyof 注册表」类型推理环防 TS7022/TS2456，同 claude 条目注释先例）、caps=capsOf('cursor')；文件头部 import CursorDriver（./cursor-driver.js）
  - tests/interactive/provider-registry.test.ts 同步（onboarding 档B 步骤 8——键集合断言必改非按需补）——用例 1 运行时键集合断言改 ['claude','codex','cursor','pi'] 且编译层 canary _compileTimeKeySet 补 cursor 键；用例 3 family 现值锚点补 cursor∈stream_json；用例 5 实例化断言补 cursor 工厂返回 CursorDriver 且 driver.provider==='cursor'（E5 自洽）；测试文件 import CursorDriver
acceptance:
  - 模块加载 capsOf('cursor') 守卫通过（INTERACTIVE_PROVIDERS.cursor 与 PROVIDER_CAPS.cursor 同名同步，无单源失同步抛错）
  - provider-registry.test.ts 全绿——键集合 ['claude','codex','cursor','pi']、family 与 PROVIDER_TO_PROTOCOL['cursor'] 反查一致（stream_json）、createDriver 可实例化为 CursorDriver、descriptor.caps 与 PROVIDER_CAPS.cursor 同引用（toBe）
  - pnpm -C sillyhub-daemon run typecheck 零错，InteractiveProvider 联合自动扩展含 'cursor'（driver.ts/types.ts 联合定义零改动）
  - PROVIDER_CAPS.cursor 八键与 design「注册（providers.ts）」节取值一致（resume/model_select=true 其余六键=false），供 task-07/08 镜像逐键对齐
verify:
  - pnpm -C sillyhub-daemon exec vitest run tests/interactive/provider-registry.test.ts
  - pnpm -C sillyhub-daemon run typecheck
constraints:
  - caps 未验证键一律 false（§6.2 先实现后翻 true）；resume=true 以 Wave 0 验证 B 通过为前置，实测记忆不连续则翻 false 并记 D 版本决策
  - 不动 PROVIDER_META（frontend runtimes.ts 已有 cursor 条目，零改动）；不改既有 claude/codex/pi 条目取值与 docblock 存量叙述
  - 范围仅两文件——cli.ts 装配行与 VALID_PROVIDERS 归 task-06；backend/frontend 镜像与守护测试 EXPECTED_PROVIDERS 归 task-07/08（D-004@v1 第 4 处不在本卡）
  - 测试只同步断言值（键集合/实例化/family 锚点），不重构用例结构、不删既有断言
expects_from:
  task-04:
    - contract: CursorDriver
      needs: [CursorDriver]
provides:
  - contract: ProviderCapsCursorValues   # 供 task-07/08 镜像逐键消费
    fields: [resume, mcp, multimodal, thinking, subagent, permission_dialog, edit_patch, model_select]
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

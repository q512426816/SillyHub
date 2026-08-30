---
id: task-07
title: 'cli.test.ts 补 autostart 子命令分派/退出码/凭据管线断言（沿用 spyOn 注入点模式）'
title_zh: 'cli.test.ts 补 autostart 子命令分派/退出码/凭据管线断言（沿用 spyOn 注入点模式）'
author: 'qinyi'
created_at: 2026-08-30 23:01:28
priority: P0
depends_on: ['task-05']
blocks: []
requirement_ids: [FR-04, FR-05, FR-06]
decision_ids: [D-001@v1, D-004@v1]
expects_from:
  task-05:
    - contract: cli.ts autostart 子命令组行为
      needs: [enable 分派与退出码, 凭据缺失 exit 1 不注册, --token 警告文案, disable 分派, status 恒 0]
allowed_paths:
  - sillyhub-daemon/tests/cli.test.ts
goal: >
  在 tests/cli.test.ts 沿用现有 spyOn 封装注入点模式（setupCliWithTmpHome 动态 import +
  captureStdout/captureStderr + vi.spyOn(cli, 'loadConfigFn'/'saveConfigFn')）补 autostart
  三子命令的分派/退出码/凭据管线断言，锁定 task-05 定型的 CLI 行为（design §5 测试清单）。
implementation:
  - 新增 TestAutostart describe，复用文件内既有基建：beforeEach setupCliWithTmpHome(tmpDir) + afterEach teardown + captureStdout/captureStderr；对 src/autostart/index.ts 的 enableAutostart/disableAutostart/autostartStatus 用 vi.mock/模块注入替换为可控 resolved 值，不触真实 schtasks/launchctl/systemctl
  - 命令树断言沿用 program.commands.find((c) => c.name() === ...) 定向 + toContain（不做命令列表全量快照）：autostart 组存在，其下 enable/disable/status 可见，enable 含 --server/--api-key/--token 选项
  - enable 分派：凭据齐备（--api-key）路径断言 enableAutostart 被调用且入参含 serverUrl/apiKey、saveConfigFn 先于注册被调用（调用顺序）、退出码 0
  - 凭据缺失路径：loadConfigFn 返回无凭据 config 且命令行不带凭据 → stderr 含错误提示文案、退出码 1、enableAutostart 未被调用（不注册半残任务）
  - --token 路径：输出断言出现「登录 Token 会过期」警告文案
  - disable 分派：断言 --server 与 --all 两形态入参正确、成功打印 removed 清单、退出码 0
  - status 分派：autostartStatus 返回空数组 → 提示未注册 + 退出码 0；返回 registered/missing/unknown 三态条目 → 输出含对应 server/任务标识文本，退出码仍 0
  - 既有断言零修改：TestStatus/TestStop/TestLogs/TestStart* 等现有用例不动（brownfield 兼容验收，plan 全局验收 5）
acceptance:
  - autostart enable/disable/status 三子命令的分派与退出码断言落地且全部通过
  - 凭据缺失 → 退出码 1 + enableAutostart 未被调用的负路径有断言
  - --token 警告文案、disable --server/--all 入参、status 恒 0（含空记录）均有定向断言
  - 现有测试断言零修改仍通过（新命令不改变既有 5 命令行为）
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/cli.test.ts
constraints:
  - 仅改 tests/cli.test.ts；沿用现有注入点（loadConfigFn/saveConfigFn 等 spyOn 封装），不为测试改生产代码
  - 不做命令列表快照断言（对命令增删脆弱，仓库现约定 find(name===) 定向 + toContain）
  - 平台产物内容级断言（plist/VBS/service）归 task-06 的 tests/autostart.test.ts，本卡只测 CLI 分派层
related_tests: [sillyhub-daemon/tests/cli.test.ts]
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

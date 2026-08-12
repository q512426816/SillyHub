---
id: task-11
title: local-yaml-writer 单元测试
title_zh: 新建 sillyhub-daemon tests test_local_yaml_writer 测段替换 platform 覆盖 mcp 有才留 注释字节保留 CRLF 不存在创建 段边界
author: qinyi
created_at: 2026-08-12 10:34:01
priority: P0
depends_on: [task-03]
blocks: []
requirement_ids: [FR-04, FR-05]
decision_ids: [D-004]
allowed_paths:
  - sillyhub-daemon/tests/test_local_yaml_writer.test.ts
provides: []
expects_from:
  task-03:
    - contract: writeLocalYaml 与段替换函数
      needs: [writeLocalYaml 与 findTopLevelSectionRange 与 replaceTopLevelSection]
goal: >
  新建 sillyhub-daemon/tests/test_local_yaml_writer.test.ts 测 task-03 的 writeLocalYaml 与 findTopLevelSectionRange 与 replaceTopLevelSection 六场景 platform 覆盖 mcp 有才留 注释字节保留 CRLF 与 LF 文件不存在创建 顶层段边界不误伤缩进子键，覆盖 FR-04 FR-05 与 D-004。
implementation:
  - 新建 test_local_yaml_writer.test.ts 用 vitest 与临时目录或内存字符串测段替换
  - 测 platform 段已有内容被 writeLocalYaml 无条件覆盖为 serverOrigin 与 platform_token 段外注释字节不变
  - 测 mcp 段已存在时 writeLocalYaml 原样不动 不存在时才写入 serverOrigin mcp 与 mcp_token
  - 测注释与其他段字节级保留 用段外内容 hash 或逐字断言
  - 测 CRLF 与 LF 两种换行都正确保留 findTopLevelSectionRange 段边界不误伤 mcp 下 url token 缩进子键
  - 测文件不存在时创建含 platform 与 mcp 两段及最小注释
acceptance:
  - 六场景全过 字节级保留可验证段外内容不变
  - 顶层段边界精确 只匹配行首无缩进的 platform 与 mcp 不匹配缩进子键
  - platform 覆盖 mcp 有才留两行为对齐 D-004
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/test_local_yaml_writer.test.ts
constraints:
  - 只测 task-03 writer 不改实现
  - 跨平台 CRLF 与 LF 都测 确认字节级保留
  - 段边界精确 顶层 key 非缩进子键 不误伤 mcp 下 url token 行
  - 用 vitest 临时目录或内存字符串 不依赖真实 local.yaml
---

---
id: task-03
title: daemon local-yaml-writer.ts 文本级段替换工具
title_zh: 新建 sillyhub-daemon local-yaml-writer.ts 用 TS 重写 sillyspec sync.js 的顶层段替换算法 写 local.yaml platform 覆盖 mcp 有才留
author: qinyi
created_at: 2026-08-12 10:34:01
priority: P0
depends_on: []
blocks: [task-06, task-11]
requirement_ids: [FR-04, FR-05, FR-06]
decision_ids: [D-004]
allowed_paths:
  - sillyhub-daemon/src/local-yaml-writer.ts
provides:
  - contract: writeLocalYaml
    fields: [writeLocalYaml 函数 rootPath 与 local 对象 platform_token mcp_token 与 serverOrigin 同步导出 findTopLevelSectionRange 与 replaceTopLevelSection]
expects_from: []
goal: >
  新建 sillyhub-daemon/src/local-yaml-writer.ts，用 TS 重写 sillyspec 仓 sync.js 的 findTopLevelSectionRange 与 replaceTopLevelSection 与 writeLocalYamlRaw 算法，提供 writeLocalYaml 函数文本级段替换写 local.yaml 的 platform 段覆盖 mcp 段有才留，覆盖 FR-04 FR-05 FR-06 与 D-004，为 task-06 handleInitLease 调用提供契约，不动 sillyspec 工具仓。
implementation:
  - 新建 local-yaml-writer.ts，复制 sillyspec sync.js:81 findTopLevelSectionRange 与 sync.js:109 replaceTopLevelSection 与 sync.js:132 写盘逻辑，注释标注来源行号
  - findTopLevelSectionRange 匹配行首无缩进的顶层 key 如 platform 或 mcp，段为该 key 行到下一顶层 key 行或文件尾，兼容 CRLF 的 \r 与空行注释
  - replaceTopLevelSection 入参 null 删段 存在替换 不存在追加，字节级保留段外注释与其他段与换行风格
  - 导出 async writeLocalYaml(rootPath, local, serverOrigin) 读 rootPath/.sillyspec/local.yaml 原文 不存在按空串，platform 段无条件覆盖为 url 与 token 两行，mcp 段仅 findTopLevelSectionRange 返 null 时写入 url 与 token 两行，文件不存在则创建含两段与最小注释
  - 失败抛错让调用方 task-06 handleInitLease 第4步 catch，不在本函数内吞错
acceptance:
  - writeLocalYaml 与 findTopLevelSectionRange 与 replaceTopLevelSection 三个导出存在签名对齐 design §7.3
  - platform 段已有内容被无条件覆盖为 serverOrigin 与 platform_token，段外注释与其他段字节不变
  - mcp 段已存在则原样不动 不存在才写入 serverOrigin 斜杠 mcp 与 mcp_token
  - 文件不存在时创建含 platform 与 mcp 两段及最小注释的 local.yaml
  - CRLF 与 LF 两种换行都正确保留不误改，顶层段边界不误伤 mcp 下 url token 缩进子键
verify:
  - cd sillyhub-daemon && pnpm typecheck
  - cd sillyhub-daemon && pnpm exec vitest run tests/test_local_yaml_writer.test.ts
constraints:
  - 算法逐字对齐 sillyspec sync.js 注释标注来源行号 81 与 109 与 132，不动 sillyspec 工具仓任何文件复制非 import
  - platform 段无条件覆盖 mcp 段有才留 对齐 D-004 与 connect R-09 行为
  - 失败抛错不吞 让 task-06 第4步 try catch 转 ok false 实现严格契约 D-003
  - url 在本函数拼 platform_url 为 serverOrigin mcp_url 为 serverOrigin 加 mcp 路径，serverOrigin 由 task-07 task-runner 透传
  - 代码兼容 Windows Linux macOS 路径用 node path join 换行字节级保留
---

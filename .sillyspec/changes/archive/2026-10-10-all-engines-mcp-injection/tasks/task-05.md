---
id: task-05
title: 'Pi channel MCP wiring'
title_zh: 'pi 通道落地——pi-settings MCP 写盘 + pi-rpc-driver 消费/1.0 适配/版本检测降级 + 单测'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-11 00:04:04
priority: P0
depends_on: [task-01]
blocks: [task-08]
requirement_ids: [FR-03, FR-06]
decision_ids: [D-005@v1, D-004@v1, D-010@v1]
allowed_paths:
  - sillyhub-daemon/src/pi-settings.ts
  - sillyhub-daemon/src/interactive/pi-rpc-driver.ts
  - sillyhub-daemon/tests/pi-settings-mcp.test.ts
target_files:
  - sillyhub-daemon/src/pi-settings.ts
  - sillyhub-daemon/src/interactive/pi-rpc-driver.ts
  - NEW:sillyhub-daemon/tests/pi-settings-mcp.test.ts
goal: >
  按 SPIKE-00 形态结论实现 pi 通道 MCP 配置 per-session 落盘与消费，含宿主版本检测降级。
implementation:
  - 按 spike-pi-10-compat.md 形态结论实现：形态1 原生配置键走 pi-settings settings.json 写入（pi-settings.ts:210-216 先读后写+未知键保留模式）；形态2 adapter 形态 vendor pi-mcp-adapter 经 --extension 装载（pi-rpc-driver.ts:830-842）+.mcp.json 落 per-session 目录；截断则收窄为维持 false + 注释适配留档不再实现
  - PiStartOptions（pi-rpc-driver.ts:412-445）新增消费 mcpServers 字段，写盘调用经 providers.ts 薄适配模式（遵守懒调用纪律，Grill B-5 落定）
  - SPIKE-00 暴露的 1.0 rpc 协议差异适配（事件流字段改名类增量适配；触量化截断阈值则停止并回写 design decisions D-004@v2）
  - 宿主 pi 版本检测（SPIKE-00 确定检测方式）：低于 1.0 不注入 MCP + warn 含版本号，会话其余功能不受影响（FR-06）
  - 新增 sillyhub-daemon/tests/pi-settings-mcp.test.ts：配置落盘隔离（宿主 ~/.pi 零写入）/未知键保留/env 透传（MCP_SESSION_ID 进配置条目 env）/版本不足降级
acceptance:
  - pi-settings-mcp.test.ts 全绿（落盘隔离/未知键保留/env 透传/版本降级四组）
  - 形态2 时 vendored adapter 经 --extension 装载可被发现（禁 session_start 启动期同步 await dialog——ql-20260911-027 已知坑）
  - 截断分支时 providers.ts pi 注释含不兼容点与适配留档路径，pi-settings/pi-rpc-driver 零 diff
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/pi-settings-mcp.test.ts
constraints:
  - 禁止写宿主全局 ~/.pi 配置
  - MCP_SESSION_ID 等 per-server env 必须进配置条目 env 字段（conventions 已知坑）
  - extension/dialog 相关遵守 ql-20260911-027 启动期禁令


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

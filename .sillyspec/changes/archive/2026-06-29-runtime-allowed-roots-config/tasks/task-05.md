---
id: task-05
title: CC 写入拦截——permission rules 注入（batch + interactive）
author: WhaleFall
created_at: 2026-06-29T10:25:55
priority: P0
depends_on: [task-04]
blocks: [task-07]
allowed_paths:
  - sillyhub-daemon/src/adapters/stream-json.ts
  - sillyhub-daemon/src/task-runner.ts
  - sillyhub-daemon/src/interactive/claude-sdk-driver.ts
  - sillyhub-daemon/src/interactive/types.ts
  - sillyhub-daemon/src/permission-rules.ts
  - sillyhub-daemon/tests/
change: 2026-06-29-runtime-allowed-roots-config
---

# task-05

> goal: daemon 启动 CC 时按 allowed_roots 生成 CC permission rules（写白名单 allow + 写全 deny + 读自由），注入 batch + interactive。

## implementation
- ⚠️ 先验证（execute step 0）：`claude --help` + 小样确认 CC permission 路径模式语法（`Write(//abs/path/**)`）+ 注入方式（CLI `--settings`/`--perms` vs SDK options vs 临时 settings.json）+ `acceptEdits` + allow 白名单内写是否自动
- 新增 `permission-rules.ts`：`buildWritePermissionRules(allowed_roots)` → `{allow: ["Write(//root/**)", ...], deny: ["Write(**)"]}`（读不配 deny）
- batch（`stream-json.ts` buildArgs）：按 rules 注入（permission-mode 改 `acceptEdits`/`default` 非 bypass + rules）
- interactive（`claude-sdk-driver.ts`）：permission options 注入 rules
- CC 写白名单内自动、外 deny（CC 报权限拒绝，daemon 透传日志）

## acceptance
- CC 写 allowed_roots 内成功
- CC 写 allowed_roots 外 CC permission 拒绝（日志可见）
- CC 读任意路径成功（读自由，Read 不 deny）
- batch + interactive 两路径都注入

## verify
- `cd sillyhub-daemon && pnpm test`（buildWritePermissionRules 单测）
- 手动：CC 写白名单内/外 + 读自由（端到端 task-07）

## constraints
- 读自由（Read 不配 deny）
- permission-mode 非 bypass（acceptEdits/default）
- ⚠️ execute 先验证 CC permission 语法，不可行则回退方案 B（daemon hook）并反馈
- 不影响 CC 正常任务执行（白名单内写自动）

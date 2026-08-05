---
id: task-05
title: "gen-build-id output format regression test (assert backend regex extracts from new build-id.ts)"
title_zh: "gen-build-id 输出格式回归测试（断言 backend 正则能从新 build-id.ts 提取）"
author: WhaleFall
created_at: 2026-08-04 11:14:15
priority: P1
depends_on: [task-01]
blocks: [task-11]
requirement_ids: [R-04]
decision_ids: []
allowed_paths:
  - sillyhub-daemon/tests/gen-build-id.test.ts
expects_from:
  task-01:
    - gen-build-id.mjs 运行后写出 src/build-id.ts，首行 AUTO-GENERATED 注释，次行 export const BUILD_ID 带双引号与 string 类型注解
    - 输出签名 export const BUILD_ID 后接冒号 string 等号 双引号 包裹 sha-ts
goal: >
  用 vitest 写回归测试，运行 task-01 的 gen-build-id.mjs 真实生成 src/build-id.ts，
  断言其内容能被 backend _compute_daemon_version 的正则（BUILD_ID 后可选空格 等号 可选空格 引号 捕获 sha-ts）
  正确提取，覆盖新格式带冒号 string 类型注解加双引号仍匹配，守护 self-update 链路不破。覆盖 R-04。
implementation:
  - 新增 sillyhub-daemon/tests/gen-build-id.test.ts，用 vitest 安排/断言，先 child_process 同步跑 node scripts/gen-build-id.mjs 真实生成 src/build-id.ts
  - 读 src/build-id.ts 全文，用与 backend router.py 第 122 行一致的 JS 等价正则反向匹配（BUILD_ID 后可选空格 等号 可选空格 单或双引号 捕获组），断言捕获组非空且匹配 sha 8 位 短横 时间戳 14 位 或 unknown 前缀
  - 单独断言新格式冒号 string 类型注解加双引号不破坏提取（核心回归点，旧格式无注解，新格式带注解，正则容忍等号左侧任意文本）
  - 失败时打印实际 build-id.ts 内容 与正则匹配结果，便于定位是 gen 输出漂移还是正则写错
  - 测试用 afterEach 清理或写临时 build-id.ts，避免污染源码版控状态（task-02 后该文件已 ignore）
acceptance:
  - sillyhub-daemon/tests/gen-build-id.test.ts 存在且为 vitest 用例，pnpm --filter sillyhub-daemon test 能跑过
  - 测试真实调用 gen-build-id.mjs 后断言 backend 等价正则能从生成的 build-id.ts 提取非空捕获组
  - 显式覆盖带冒号 string 类型注解加双引号的新格式分支（断言通过）
  - 若未来 gen 输出格式漂移导致正则失配，本测试应红，提前拦截 self-update 链路破裂
verify:
  - pnpm --filter sillyhub-daemon test gen-build-id 跑绿
  - 手动破坏实验：临时把 gen 输出改成单引号或去掉等号，回归测试应变红（验证测试有敏感性，验完还原）
  - 与 backend router.py 第 122 行正则逐字符对照，确认 JS 等价正则语义一致（可选空格 等号 可选空格 引号 捕获到非引号序列）
constraints:
  - 不改 backend router.py（正则源头在 backend，本任务只在其镜像上写测试）
  - 不改 gen-build-id.mjs 本体（格式源头归 task-01）
  - 不手写假 build-id.ts 字符串绕过 gen，必须真实跑 gen-build-id.mjs 生成（否则失去回归意义）
  - JS 等价正则用中文描述或反引号包裹，不在列表项裸写带冒号花括号
  - 测试跨平台（Win/Linux/mac），不依赖 bash，仅用 node child_process 与 fs
---

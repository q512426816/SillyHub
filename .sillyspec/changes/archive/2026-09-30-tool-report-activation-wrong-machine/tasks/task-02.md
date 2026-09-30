---
id: task-02
title: 'daemon heartbeat machine_id upload and persist'
title_zh: 'daemon 心跳 machine_id 上报与落 metadata'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-30 11:07:12
priority: P1
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/src/config.ts
  - backend/app/modules/daemon/router/heartbeat.py
  - backend/app/modules/daemon/tests/
  - sillyhub-daemon/tests/
target_files:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/src/config.ts
  - backend/app/modules/daemon/router/heartbeat.py
provides:
  - contract: daemon_runtimes.metadata machine_id key
    fields: [machine_id]
goal: >
  daemon 心跳携带持久 machine_id（~/.sillyhub/machine-id 读/生成）落 daemon_runtimes.metadata，为 takeover 一级精确匹配与 CLI 共享身份约定铺路（FR-01/Phase 5，D-001@v1）。
implementation:
  - 先核对 heartbeat.py 心跳接收落点行号与 metadata 合并口径（design 自审存疑 1 的 plan 期核验；若心跳协议改动面超预期，降级为仅 daemon 侧 machine-id 文件就绪 + metadata 键透传，takeover 一级匹配留空跑 ②③ 级）
  - sillyhub-daemon/src/config.ts 或 daemon.ts 读/生成 ~/.sillyhub/machine-id（对齐既有持久化文件惯例，原子写）
  - hub-client.ts heartbeat 载荷追加 machine_id 键（旧 backend 忽略未知键，向后兼容）
  - backend heartbeat.py 接收 machine_id 落 daemon_runtimes.metadata（JSON 键合并，勿覆盖既有键）
  - 双侧测试：daemon 侧 machine-id 生成/读取幂等；backend 侧心跳含/不含 machine_id 两形态
acceptance:
  - daemon 重启后 machine_id 稳定不变（持久文件）
  - 心跳上报后 daemon_runtimes.metadata.machine_id 可查；不含键的心跳不写该键
  - daemon pnpm test 与 backend daemon tests 相关用例通过
verify:
  - cd sillyhub-daemon && pnpm test
  - cd backend && uv run pytest app/modules/daemon/tests -q --no-cov -k heartbeat
constraints:
  - 兼容 Windows/Linux/macOS 路径（~ 展开沿用既有惯例）
  - 心跳协议追加键向后兼容（旧 backend 忽略未知键，禁破坏性协议变更）
  - 不动 lease/claim 语义（纯心跳通道字段追加）
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

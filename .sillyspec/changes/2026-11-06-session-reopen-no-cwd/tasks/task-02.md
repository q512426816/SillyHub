---
id: task-02
title: 'daemon cwd 回报携带（hub-client 两方法可选参数 + 三发送点）+ 回报测试'
title_zh: 'daemon cwd 回报携带（hub-client 两方法可选参数 + 三发送点）+ 回报测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-11-06 23:03:28
priority: P0
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-007@v1]
depends_on: [task-01]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/tests/daemon-session-resume-route.test.ts
target_files:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/tests/daemon-session-resume-route.test.ts
goal: >
  daemon 在会话就绪时机把实际生效 cwd 回报 backend——notifySessionReady 与 confirmReconnected 加可选 cwd 参数（不传不发键），三处发送点携带实际运行目录，为 backend 落库 session.cwd 供给数据。
implementation:
  - sillyhub-daemon/src/hub-client.ts：notifySessionReady 与 confirmReconnected 两方法加可选 cwd 参数（undefined/空串不发键——请求体不加 cwd 字段；非空字符串才写入请求体）
  - 三处发送点携带（sillyhub-daemon/src/daemon.ts）：create 路径 ready（:10782，`_startInteractiveSession` 内携带 cwd 局部变量=borrow sandbox/workspace 兜底后实际运行目录）；recover 路径 ready（:9581，`_routeSessionResume` 尾部携带 record.cwd 三级链结果）；confirm（:9567 options 加 cwd 键，值=record.cwd）
  - 新增测试：不传 opts 时请求体无 cwd 键（老 backend 零感知）；传非空 cwd 时键存在且值原样（含尾斜杠/盘符大小写不归一化，盲区 #3）；create/recover 两发送点值语义区分断言
acceptance:
  - 「不传不发键」口径有测试（请求体序列化断言无 cwd 字段）
  - 三发送点各自携带值语义正确（create=实际运行目录 / recover+confirm=record.cwd）
  - cwd 字符串原样透传（无 trim/normalize/join 归一化）
verify:
  - pnpm -C sillyhub-daemon test -- daemon-session-resume-route
constraints:
  - 不新增 REST 端点（D-008 负向约束）
  - hub-client 方法签名向后兼容（新增参数可选，既有调用点零改动可编译）
  - 聚焦测试，禁跑全量
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

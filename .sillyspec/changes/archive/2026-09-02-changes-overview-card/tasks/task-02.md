---
id: task-02
title: 'daemon 采集与上报——config 采集间隔(60s)/超时常量 + 采集器（execFile spawn 主仓根 + 三态降级矩阵 + 32KB 预算截断/计数降级）+ 心跳组装追加 sillyspec_status'
title_zh: 'daemon 采集与上报——config 采集间隔(60s)/超时常量 + 采集器（execFile spawn 主仓根 + 三态降级矩阵 + 32KB 预算截断/计数降级）+ 心跳组装追加 sillyspec_status'
author: 'qinyi'
created_at: 2026-09-03 08:46:38
priority: P0
depends_on: []
blocks: [task-04]
requirement_ids: [FR-02, FR-03, FR-04]
decision_ids: [D-B2@v1, D-B3@v1]
allowed_paths:
  - sillyhub-daemon/src/config.ts
  - sillyhub-daemon/src/sillyspec-manager.ts
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/src/daemon.ts
goal: >
  daemon 侧落地总览采集与上报（design §5 daemon 段）——config 采集间隔（默认 60s）
  + sillyspec-manager 扩展采集器周期执行 progress show --json（execFile 数组形参、
  cwd=workspace.root_path 主仓根、三态降级矩阵、32KB 预算截断与计数降级）
  + 心跳组装追加 sillyspec_status 摘要，打通 FR-02/03/04 数据链路 daemon 段
  （D-B2@v1=32KB 预算、D-B3@v1=三态矩阵与主仓根锚定；心跳载荷契约消费 task-01）。
implementation:
  - config.ts DaemonConfig 加 sillyspec_status_interval_sec 数值字段（默认 60，0=关闭，形状对齐 sillyspec_update_interval_sec :344-355 注释先例）；DEFAULT_CONFIG 就近补默认值 60（:419 旁）
  - sillyspec-manager.ts 扩展采集器（design §5 运行期管理器扩展）——周期执行 node <sillyspec-bin> progress show --json：execFile 数组形参（跨平台路径空格防线 NFR-02，禁 shell 拼接）、cwd=workspace.root_path 主仓根固定锚定（规则 22，不在 worktree 内执行 CLI）；采集超时模块级常量仿 runtime-handler.ts:45 SILLYSPEC_TIMEOUT_MS（30s）先例；stdout 经 JSON.parse 后构造 design §4 摘要；spawn 依赖走 deps 注入（假实现避免真实 spawn，对齐 runCommand 注入先例）
  - 三态降级矩阵（FR-03）——① 成功（exit 0 + 合法 JSON）→ 落新快照；② 能力缺失（spawn ENOENT=未安装 / 输出非 JSON=旧版本无 --json）→ warn 一次后同类静默、状态置 null（上报=清除）；③ 瞬态失败（spawn 超时 / 非零退出）→ 保留上次快照不清除（前端按 generated_at 显「数据可能过期」标记）
  - 32KB 预算（FR-04 / Grill B2）——changes 截断 N=50，每项透传 name、ghost、current_stage、stage_label、last_active、steps 六字段；envelope 的 readable、command 字段容忍但不透传；序列化超 32KB 降级纯计数模式（丢 changes 与 pending_conflicts 列表保计数，卡片显「列表过大，仅计数」）
  - hub-client.ts——HeartbeatBody 加 sillyspec_status 键 + heartbeat() 追加可选末位参 sillyspecStatus（undefined → 键不出现=采集未启动旧形态零破坏；采集启动后恒携带快照或 null，null=backend 置 NULL 清除；键存在性注释锚定 task-01 契约，写法对齐第 5 参 sillyspec 先例）
  - daemon.ts——manager 实例化处（:1652）注入采集间隔与 workspace 主仓根；_sendHeartbeatOnce（:3930-3975 sillyspec 载荷段先例）从 manager 同步读状态快照（零 spawn）组装 sillyspec_status 末位参数；采集循环挂法对齐 _sillyspecLoop 第四循环先例（:3901 abortableSleep 每拍模式）或 manager 内部定时器，按 manager deps 注入风格落定
acceptance:
  - config 键 sillyspec_status_interval_sec 默认 60 生效、0=关闭不启动采集
  - 三态矩阵行为各自成立——成功更新快照 / ENOENT 与非 JSON 输出 → null / 超时与非零退出保留上次快照
  - 摘要构造覆盖 design §4 全字段；changes 超 50 截断、超 32KB 降级纯计数、readable 与 command 不透传
  - 心跳 body 键语义正确——采集未启动无键（既有调用逐字段不变）、启动后快照或 null
  - tsc 0 错误；sillyspec-manager.test.ts 既有用例零回归（采集器为增量扩展，缺省 deps 行为不变）
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/sillyspec-manager.test.ts
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
constraints:
  - 新增测试与既有断言同步归 task-04（三态矩阵全覆盖 + 截断降级用例 + daemon-heartbeat-sillyspec.test.ts 深比较与 config.test.ts 键表断言更新——心跳 body 追加字段后必破，plan 已排 task-04）；本卡不写不改测试文件
  - execFile 一律数组形参、无 shell 依赖（NFR-02）；CLI 只在 workspace.root_path 主仓根执行（规则 22 禁 worktree）
  - 不改 manager 既有 probeLocal / probeLatest / checkAndUpgrade / getSnapshot 语义与 preflight 启动门；升级链路不复用本采集器
  - 心跳与注册其余参数逐字段不变（新参数追加末位，undefined 键不出现，NFR-01）
expects_from:
  - task-01: SillySpecStatusHeartbeatSchema（heartbeat 载荷 sillyspec_status 摘要字段与 null=清除置 NULL 语义；摘要结构 design §4，daemon 组装侧逐字段对齐）
provides:
  - contract: DaemonSillySpecStatusReporting
    fields: [sillyspec_status_interval_sec, 采集器三态矩阵, 32KB 预算截断与计数降级, heartbeat body sillyspec_status 键]
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

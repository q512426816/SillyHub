---
id: task-04
title: 'daemon sillyspec-manager 模块——探测（probeLocal/probeLatest 10min 缓存）/升级执行（复用 preflight 导出 runCmd/installSillySpec）/状态机（in-flight 门/deferred 30s 复查/终态 10min 窗口）+ 单测'
title_zh: 'daemon sillyspec-manager 模块——探测（probeLocal/probeLatest 10min 缓存）/升级执行（复用 preflight 导出 runCmd/installSillySpec）/状态机（in-flight 门/deferred 30s 复查/终态 10min 窗口）+ 单测'
author: 'qinyi'
created_at: 2026-08-31 08:31:16
priority: P0
depends_on: []
blocks: [task-05, task-08]
requirement_ids: [FR-03, FR-04]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/sillyspec-manager.ts
  - sillyhub-daemon/src/preflight.ts
  - sillyhub-daemon/tests/sillyspec-manager.test.ts
goal: >
  新建 daemon 侧 sillyspec-manager 模块：本机/最新版本探测（10min 缓存）、npm 安装升级执行（复用 preflight
  导出）、升级状态机（in-flight 门 / busy→deferred 30s 复查 / 终态 10min 展示窗口），为 task-05 的接线
  （心跳上报 + WS 触发 + 自动循环）提供独立可测的核心。
implementation:
  - preflight.ts 导出 runCmd（现 :810 私有）与 installSillySpec（:281）供 manager 复用——仅加 export，行为零变化；如 runCmd 签名不适合复用可导出最小包装（不复制实现）
  - 新建 sillyspec-manager.ts：SillySpecManager 类（依赖注入 runner/isBusy/clock 供测试）——probeLocal()=spawn sillyspec --version（trim 后 semver 字符串或 null）；probeLatest()=spawn npm view sillyspec version，缓存 TTL 10min；getSnapshot()={version, latest_version, update?}（update 存在且未过展示窗才带）
  - 状态机：idle→running→success|failed；busy（isBusy 回调，生产接 daemon._isBusyForUpdate）→deferred + 30s 定时复查（复用 SELF_UPDATE_RETRY_INTERVAL_MS=30s 节奏，可注入间隔），空闲转 running；终态保留 10min 后回 idle（定时器或惰性过期判断二选一，注释说明）；in-flight 门：running/deferred 期间 requestUpgrade(trigger) 仅记日志去重（CLEANUP 惯例）
  - runUpgrade()：installSillySpec → probeLocal 刷新版本 → success（带 from/to）；失败或安装后探测失败 → failed（error 截断 200 字符）；trigger ∈ server_command|auto 记入状态
  - 自动检查入口 checkAndUpgrade(trigger='auto')：probeLatest+probeLocal → 未安装或 isOutdated → requestUpgrade；已最新 no-op（preflight isOutdated 如未导出则导出或本地重实现 3 行 semver 比较）
  - 新建 tests/sillyspec-manager.test.ts：状态机全流转（含 deferred 复查转 running）、in-flight 去重、latest 缓存 TTL、终态 10min 过期回 idle、getSnapshot 键存在性（update 缺席时 undefined）
acceptance:
  - 全部单测绿；manager 不直接 import daemon.ts（依赖注入方向单向）
  - 升级执行只经 installSillySpec（不在 manager 内另写 npm spawn）
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/sillyspec-manager.test.ts
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
constraints:
  - 不接线 daemon.ts/hub-client/config/protocol（全部归 task-05）；preflight.ts 只加 export 不改逻辑
  - 时间相关参数（缓存 10min/复查 30s/终态窗 10min）以可注入常量实现，默认值对齐 design
  - 不做离线重试/退避（失败留给下轮自动检查或手动重试）
provides:
  - contract: SillySpecManagerApi
    fields: [getSnapshot, requestUpgrade, checkAndUpgrade, probeLocal, probeLatest]
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

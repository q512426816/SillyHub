---
id: task-04
title: 'daemon 测试——三态矩阵全覆盖（成功/null 能力缺失/瞬态失败保留快照）+ 超限截断降级用例（fixture 容忍 readable/command）+ 更新既有 daemon-heartbeat-sillyspec.test.ts 深比较断言（心跳 body toEqual 与载荷参数 length 追加字段后必破）'
title_zh: 'daemon 测试——三态矩阵全覆盖（成功/null 能力缺失/瞬态失败保留快照）+ 超限截断降级用例（fixture 容忍 readable/command）+ 更新既有 daemon-heartbeat-sillyspec.test.ts 深比较断言（心跳 body toEqual 与载荷参数 length 追加字段后必破）'
author: 'qinyi'
created_at: 2026-09-03 08:46:57
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-03, FR-04, NFR-02]
decision_ids: []
allowed_paths:
  - sillyhub-daemon/tests/daemon-heartbeat-sillyspec.test.ts
  - sillyhub-daemon/tests/sillyspec-progress-collector.test.ts
  - sillyhub-daemon/tests/sillyspec-manager.test.ts
goal: >
  为 task-02 落地的 progress 采集器与心跳组装补齐 daemon 侧测试：三态降级矩阵全覆盖
  （成功快照 / 能力缺失上报 null / 瞬态失败保留上次快照）+ 32KB 超限截断与纯计数降级
  用例（fixture 容忍 envelope 的 readable/command 字段），并同步更新既有
  daemon-heartbeat-sillyspec.test.ts 深比较断言（心跳 body 追加 sillyspec_status 后
  整包 toEqual 与参数 length 断言必破）。
implementation:
  - 更新 tests/daemon-heartbeat-sillyspec.test.ts 深比较断言（实证锚点）——L247 整 body
    toEqual（4 参旧调用零 sillyspec_* 键形态）：task-02 组装若无条件携带 status 键则按
    落地形态更新（补 status 键或维持键缺席）；L342-343 call.length===5 与 call[4] toEqual：
    心跳追加 sillyspec_status 参后改 length 断言 + 新增对应参 toEqual，前 4 参语义不变
    断言（L349-352）保留
  - 新测试文件（文件名跟随 task-02 采集器落地形态二选一：独立模块 →
    tests/sillyspec-progress-collector.test.ts；并入 sillyspec-manager.ts → 用例进既有
    tests/sillyspec-manager.test.ts；execute 后删未用候选路径）——三态①成功：mock
    execFile 返回 exit 0 + 合法 envelope JSON，断言摘要字段齐（ok/errors_count/
    warnings_count/generated_at/active_changes/healthy_count/ghost_count/conflict_count/
    conflict_types/changes[] 截断字段集/pending_conflicts[]），fixture 含真实 schema 的
    readable/command 字段且断言其不透传进摘要
  - 三态②能力缺失——spawn ENOENT（未安装）/ stdout 非 JSON（旧版无 --json）→ 上报 null；
    warn 一次后同类静默（第二次不再 warn）
  - 三态③瞬态失败——超时（超时常量可注入调小，复用 runtime-handler.ts
    SILLYSPEC_TIMEOUT_MS=30s 先例）/ 非零退出 → 保留上次快照继续上报（不清除、不上报 null）
  - 截断降级——changes 超 50 截至前 50；摘要序列化超 32KB 自设预算 → 降级纯计数模式
    （changes 列表缺席/清空 + 计数字段保留）
  - 心跳组装联测——采集器三态输出分别注入心跳 body 的 sillyspec_status：成功=摘要对象 /
    能力缺失=null / 瞬态=上次快照；跨平台（NFR-02）：execFile 数组形参（args 含空格路径
    如 C:\Users\qinyi\Idea Projects\repo 不分裂）、全程无 shell 依赖、不真 spawn node
    （mock，Windows 安全）
acceptance:
  - 三态矩阵全覆盖全绿——①成功快照字段断言（readable/command 被容忍且不透传）②ENOENT
    与非 JSON → null + warn-once ③超时与非零退出 → 上轮快照保留上报
  - 超限截断降级用例绿——N=50 截断 + 32KB 预算纯计数降级
  - daemon-heartbeat-sillyspec.test.ts 深比较断言更新后全绿——旧调用零破坏形态 + 新参
    断言与 task-02 落地形态一致
  - 全部用例 mock execFile/fetch 不真 spawn node；时间参数（采集超时/间隔）注入常量，
    不依赖真实 30s/60s 时钟推进
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/daemon-heartbeat-sillyspec.test.ts tests/sillyspec-progress-collector.test.ts（若用例并入 manager 则后者换 tests/sillyspec-manager.test.ts）
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
constraints:
  - 纯测试卡——不改 sillyhub-daemon/src（采集器/config/心跳组装归 task-02）；测试暴露
    实现缺陷回 task-02 修复后复跑，禁止弱化断言迁就实现
  - 新测试文件二选一（collector 独立 / manager 扩展），按 task-02 实际落地模块定名并删
    未用候选路径，不留挂空 allowed_paths
  - fixture 内联 JSON 于测试文件（daemon tests 根级平铺惯例），不新建 fixtures 目录
related_tests:
  - 'sillyhub-daemon/tests/daemon-heartbeat-sillyspec.test.ts（L247 整 body toEqual 与 L342-343 call.length===5+第 5 参 toEqual，task-02 心跳追加 sillyspec_status 后必破，需同步更新）'
expects_from:
  - task-02: 采集器接口契约（成功快照字段集 / 能力缺失 null / 瞬态保留语义 + 32KB 截断降级行为）与心跳组装形态（sillyspec_status 键存在性与参数位次）
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

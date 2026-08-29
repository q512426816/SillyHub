---
id: task-03
title: 'daemon 磁盘探测（onDiskChange 回调出口）+ pending-update.json（原子写/启动清残留）+ config 配置项 + status 展示'
title_zh: 'daemon 磁盘探测（onDiskChange 回调出口）+ pending-update.json（原子写/启动清残留）+ config 配置项 + status 展示'
author: 'qinyi'
created_at: 2026-08-29 15:04:03
priority: P0
depends_on: []
blocks: [task-04, task-05]
requirement_ids: [FR-01, FR-03]
decision_ids: [D-002@v1, D-003@v2]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/config.ts
  - sillyhub-daemon/src/cli.ts
  - sillyhub-daemon/tests/disk-probe-pending.test.ts
provides:
  - contract: DiskProbeAndPending
    fields: [onDiskChange, pendingUpdatePath, writePendingUpdate, clearPendingUpdate, startDiskProbe]
goal: >
  daemon 实现磁盘旁路探测（读 bundle 正则提取 BUILD_ID 与内存比对，差异出口为注入式 onDiskChange 回调）、pending-update.json 落盘/清残留/status 展示与 self_reload_check_interval_sec 配置项，为 FR-01 记 pending 与 FR-03 探测打底；tryUpdate 接线归 task-04。
implementation:
  - config.ts 新增 self_reload_check_interval_sec（默认 600，0=关闭不启循环），照 disconnect_log_threshold_sec 的字段注释+默认值块惯例
  - daemon.ts 新增 startDiskProbe 探测循环（setInterval unref）——每间隔读 bundle 文件（~/.sillyhub/daemon/bin/sillyhub-daemon.js，与 respawn 加载同一文件）按 BUILD_ID 正则提取与内存比对；dev 构建跳过探测
  - 任何差异（含降级）调注入式 onDiskChange 回调（构造器/启动参数注入，差异信息含目标 BUILD_ID）；本卡不引用 _tryUpdate——接线归 task-04
  - 探测失败（读文件失败/正则不中/任一侧为空）≠版本变化，仅 debug 日志不动作（防替换窗口自杀，D-003@v2）
  - daemon.ts 新增 pending-update.json 方法组——writePendingUpdate 写 reason/current_version/target_version/since 四字段（tmp+rename 原子写照 session-store-persistence 惯例）；clearPendingUpdate 删除（升级执行/取消路径调用）；启动清矛盾残留（盘上 BUILD_ID==内存即删）
  - cli.ts statusAction 读 pending 文件，存在时追加展示行「等待空闲升级：盘上 X 运行 Y（原因 Z，since …）」
  - 新增 tests/disk-probe-pending.test.ts——回调触发/失败不触发/0=关不启/原子写与删除/启动清残留/status 展示全覆盖
acceptance:
  - 盘上 BUILD_ID≠内存（含降级）时 onDiskChange 恰触发一次且差异信息含目标 BUILD_ID
  - 读文件失败/正则不中/任一侧为空不触发回调；dev 构建跳过探测
  - self_reload_check_interval_sec=0 时不启动探测循环；定时器 unref 不阻止进程退出
  - pending 文件 tmp+rename 原子落盘且可删除；启动时盘上=内存清残留、盘上≠内存保留
  - pending 文件存在时 statusAction 输出等待空闲升级行（含盘上/运行版本+原因+since）
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/disk-probe-pending.test.ts && pnpm exec tsc --noEmit
constraints:
  - daemon.ts 差异出口仅注入式 onDiskChange 回调，不实现/引用 tryUpdate 编排与忙判定（task-04 汇合 task-01/03 产物接线）
  - 不用 --version 子进程探测（其输出 DAEMON_VERSION semver 与 BUILD_ID 不同源，Grill B1 实跑证伪，D-003@v2）
  - preflight.ts 不在 allowed_paths——DAEMON_BIN_DIR/DAEMON_BUNDLE_NAME 为其模块私有常量，daemon.ts 本地重声明同值路径并支持测试注入临时目录；心跳携带 pending_update 归 task-05
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

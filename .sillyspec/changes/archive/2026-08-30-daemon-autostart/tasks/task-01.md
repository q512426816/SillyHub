---
id: task-01
title: 'autostart 目录骨架——src/autostart/index.ts 顶层 API（enableAutostart/disableAutostart/autostartStatus）+ 类型定义 + 本地记录读写 + serverHash 任务名派生 + 三平台 stub 文件占位（含 process.execPath/argv[1] 命令模板函数）'
title_zh: 'autostart 目录骨架——src/autostart/index.ts 顶层 API（enableAutostart/disableAutostart/autostartStatus）+ 类型定义 + 本地记录读写 + serverHash 任务名派生 + 三平台 stub 文件占位（含 process.execPath/argv[1] 命令模板函数）'
author: 'qinyi'
created_at: 2026-08-30 23:01:28
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06]
decision_ids: [D-005@v1, D-003@v1]
allowed_paths:
  - sillyhub-daemon/src/autostart/index.ts
  - sillyhub-daemon/src/autostart/windows.ts
  - sillyhub-daemon/src/autostart/macos.ts
  - sillyhub-daemon/src/autostart/linux.ts
goal: >
  建立 autostart 核心模块骨架（design §1 + 接口定义，方案 A 内置模块 D-005）——src/autostart/index.ts
  逐字落地顶层 API（enableAutostart/disableAutostart/autostartStatus）+ 三类型定义 + AutostartRecord
  本地读写 + serverHash 任务名派生 + 按 process.platform 分派的平台策略接口与命令模板函数，
  windows/macos/linux 三个 stub 文件保证 Wave 2 前整仓可编译，为 task-02/03/04（平台实现）、
  task-05（CLI 接线）、task-06（单测）提供契约。
implementation:
  - 新建 src/autostart/index.ts，按 design「接口定义」逐字导出三类型——AutostartEnableOptions（serverUrl 必填；apiKey/token 可选互斥，凭据合并与校验语义归 CLI 层 task-05，本函数不重复实现）；AutostartRecord（server_url/platform/node_path/script_path/task_name/enabled_at 六字段）；AutostartStatusEntry（extends AutostartRecord，systemState 取值 registered/missing/unknown）
  - 导出顶层 API 三函数，签名逐字对齐 design 接口定义——enableAutostart(opts) 返回判别联合（ok=true 携带 AutostartRecord；ok=false 携带 error 字符串与可选 hint）；disableAutostart(target) 入参为 { serverUrl?, all? }，成功返回 removed 数组；autostartStatus() 返回 AutostartStatusEntry 数组
  - 固化命令模板函数（三平台共用，design §1）——启动命令 = <process.execPath> <path.resolve(process.argv[1])> start --server <server_url>；node 取 process.execPath（运行时直取，macOS launchd / Linux systemd 环境 PATH 受限必须绝对路径）、脚本取 path.resolve(process.argv[1])（生产 bundle 与开发 dist/cli.js 均适用）；凭据不进任务命令（D-004，开机拉起后由 start 从 per-server config 读取）
  - 任务名派生（复用 src/config.ts 的 serverHash，sha256 前 8 位十六进制）——win32 → SillyHubDaemon-<hash8>；darwin → com.sillyhub.daemon.<hash8>；linux → sillyhub-daemon-<hash8>.service
  - AutostartRecord 本地读写——路径 <DEFAULT_CONFIG_DIR>/autostart-<hash8>.json（即 ~/.sillyhub/daemon/autostart-<hash8>.json，复用 config.ts 的 DEFAULT_CONFIG_DIR 常量；status 的数据源 + disable 的对账依据）；enable 平台注册成功后写记录、disable 注销成功后删记录
  - 定义平台策略接口（三平台共同实现的目标形状）——每平台导出 register/unregister/query 三方法，index.ts 按 process.platform 分派（register←enableAutostart、unregister←disableAutostart、query←autostartStatus 做系统注册实况对账）；未支持平台返回 ok=false 的错误结果（不抛异常）
  - 新建 windows.ts/macos.ts/linux.ts 三个 stub——导出与策略接口形状一致的三方法占位，方法体返回 ok=false 的明确错误（error 提示 not implemented、注明真实实现归 task-02/03/04），不写任何真实 schtasks/launchctl/systemctl 调用，保证 Wave 2 前可编译且误调用不静默
  - index.ts 分派逻辑本 task 仅接线到 stub（结构到位）；记录读写与任务名派生为真实实现（W2/W3 不再改）
acceptance:
  - 接口签名与 design「接口定义」逐字一致（三类型 + 三函数，enable/disable 返回 ok=true/false 判别联合，autostartStatus 返回 AutostartStatusEntry[]）
  - 命令模板函数输出含 process.execPath 与 path.resolve(process.argv[1]) 双绝对路径且不含任何凭据字段；任务名派生三平台后缀规则符合 design §2 标识行
  - enableAutostart 三平台均走分派路径（W1 期到达 stub 即返回 not implemented 错误，不抛异常、不写系统注册）；本地记录路径与文件名 hash8 规则符合 design §1
  - pnpm typecheck 通过（index + 三 stub 四文件全部纳入编译）
verify:
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - ESM import 一律带 .js 扩展名（仓库约定，如 import { serverHash } from '../config.js'；类型用 import type）
  - stub 文件必须保证可编译——Wave 2 前整仓 typecheck 绿是本 task 的硬承诺
  - 不实现任何平台真实注册命令（schtasks/launchctl/systemctl 归 task-02/03/04）；不改 src/cli.ts（归 task-05）；不新增 npm 依赖（D-005 零依赖）
  - 不做保活配置（D-002——无 KeepAlive/Restart，仅开机/登录启动一次语义）
  - 不改 backend API / WS 协议 / per-server config schema（FR-09 兼容零改动）；凭据校验与 CLI 打印归 task-05
provides:
  - contract: autostart 顶层 API
    fields: [enableAutostart, disableAutostart, autostartStatus]
  - contract: autostart 类型定义
    fields: [AutostartEnableOptions, AutostartRecord, AutostartStatusEntry]
  - contract: autostart 平台策略接口
    fields: [register, unregister, query, buildStartCommand, taskNameFor]
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

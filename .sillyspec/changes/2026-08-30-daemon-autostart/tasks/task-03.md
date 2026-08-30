---
id: task-03
title: 'macOS 策略 src/autostart/macos.ts——plist 生成（RunAtLoad 无 KeepAlive、ProgramArguments 绝对路径、.launchd.txt 兜底输出）+ launchctl bootout（忽略失败）/bootstrap（gui/uid）/查询；SSH-only 无 GUI domain 报错提示'
title_zh: 'macOS 策略 src/autostart/macos.ts——plist 生成（RunAtLoad 无 KeepAlive、ProgramArguments 绝对路径、.launchd.txt 兜底输出）+ launchctl bootout（忽略失败）/bootstrap（gui/uid）/查询；SSH-only 无 GUI domain 报错提示'
author: 'qinyi'
created_at: 2026-08-30 23:01:28
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-003@v1]
allowed_paths:
  - sillyhub-daemon/src/autostart/macos.ts
expects_from:
  task-01:
    - contract: autostart 平台策略接口
      needs: [register, unregister, query, buildStartCommand, taskNameFor]
    - contract: autostart 类型定义
      needs: [AutostartRecord]
provides:
  - contract: macOS autostart 策略
    fields: [register, unregister, query]
goal: >
  实现 macOS 平台自启策略 src/autostart/macos.ts——生成 launchd LaunchAgent plist 并经
  launchctl bootout/bootstrap 注册/注销/查询（com.sillyhub.daemon.<hash8>），使 macOS
  用户一条命令完成登录自启注册（FR-02；design §2 macOS 列；无 KeepAlive 保活 D-002；
  SSH-only 无 GUI domain 报错提示 R-05）。
implementation:
  - 填充 task-01 留下的 src/autostart/macos.ts stub——ESM import（带 .js 扩展名）平台策略接口 register/unregister/query、AutostartRecord 类型与命令模板函数（node=process.execPath，script=path.resolve(process.argv[1])）
  - register 步骤 1（plist 生成）——写 ~/Library/LaunchAgents/com.sillyhub.daemon.<hash8>.plist（hash8=serverHash(serverUrl)，来自 sillyhub-daemon/src/config.ts），XML 内容——Label=com.sillyhub.daemon.<hash8>；ProgramArguments 数组五元素依次为 node绝对路径、脚本绝对路径、start、--server、serverUrl（launchd 环境 PATH 受限，前两者必须全绝对路径，R-06）；RunAtLoad=true；不写 KeepAlive 键（D-002 无保活）；StandardOutPath 与 StandardErrorPath 均指向 ~/.sillyhub/daemon/autostart-<hash8>.launchd.txt（.txt 后缀避开 clean 命令 *.log/*.out/*.err glob，R-09）
  - register 步骤 2（launchctl 注册，幂等清场先行）——先执行 launchctl bootout gui/<uid>/<label> 且忽略失败（未注册时本就报错，为覆盖式重注册清场，R-07），再执行 launchctl bootstrap gui/<uid> <plist绝对路径>（uid=process.getuid()）
  - bootstrap 失败处理（SSH-only 无 GUI domain，R-05）——返回含修复提示的错误（提示在本地图形会话执行），使 CLI 层 exit 1，不静默失败
  - unregister——执行 launchctl bootout gui/<uid>/<label> 并删除 plist 文件（不杀运行中 daemon 进程，停进程仍用 stop）
  - query——执行 launchctl list 并匹配 label——输出中存在=registered、不存在=missing、命令执行失败=unknown（供 index.ts status 对账）
acceptance:
  - 生成的 plist 为结构合法的 XML——含 Label com.sillyhub.daemon.<hash8>、ProgramArguments 五元素绝对路径数组（node/脚本均绝对路径）、RunAtLoad=true，且全文不含 KeepAlive 键
  - StandardOutPath 与 StandardErrorPath 均指向 autostart-<hash8>.launchd.txt，文件名不命中 clean 命令的 *.log/*.out/*.err glob
  - 注册顺序为 bootout gui/<uid>/<label>（失败忽略）→ bootstrap gui/<uid> <plist>；重复 register 幂等
  - SSH-only 无 GUI domain 时 bootstrap 失败返回含"在本地图形会话执行"修复提示的错误（exit 1 路径）
  - unregister 后 plist 文件已删且 launchd 已 bootout；query 三态映射正确
verify:
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - ESM import 一律带 .js 扩展名（如 from './index.js'）
  - 不引入任何 npm 依赖，仅用 node:child_process/node:fs/node:path/node:os 内置模块；plist XML 用手写模板字符串生成，不用 XML 库
  - macos.ts 只承载 darwin 侧逻辑，不在非 macOS 平台执行任何系统命令（平台分派由 index.ts 按 process.platform 完成）
  - 本地记录 autostart-<hash8>.json 的读写归 index.ts（task-01），本卡只产系统注册产物（plist + launchd 注册）
  - plist 产物内容断言（RunAtLoad/无 KeepAlive/.launchd.txt 文件名避 glob）归 task-06 tests/autostart.test.ts，本卡不写测试文件
  - 不杀运行中 daemon 进程（unregister 只清注册产物）
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

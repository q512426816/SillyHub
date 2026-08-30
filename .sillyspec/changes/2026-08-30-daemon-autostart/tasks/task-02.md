---
id: task-02
title: 'Windows 策略 src/autostart/windows.ts——VBS 中转脚本生成（Run ..., 0, False 隐藏窗口）+ schtasks 注册（/SC ONLOGON /RL LIMITED /F 幂等）/注销（/Delete /F）/查询（/Query /TN）'
title_zh: 'Windows 策略 src/autostart/windows.ts——VBS 中转脚本生成（Run ..., 0, False 隐藏窗口）+ schtasks 注册（/SC ONLOGON /RL LIMITED /F 幂等）/注销（/Delete /F）/查询（/Query /TN）'
author: 'qinyi'
created_at: 2026-08-30 23:01:28
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-003@v1]
allowed_paths:
  - sillyhub-daemon/src/autostart/windows.ts
expects_from:
  task-01:
    - contract: autostart 平台策略接口
      needs: [register, unregister, query, buildStartCommand, taskNameFor]
    - contract: autostart 类型定义
      needs: [AutostartRecord]
provides:
  - contract: Windows autostart 策略
    fields: [register, unregister, query]
goal: >
  实现 Windows 平台自启策略 src/autostart/windows.ts——生成隐藏窗口 VBS 中转脚本并经
  schtasks 注册/注销/查询用户级登录计划任务（SillyHubDaemon-<hash8>），使 Windows 用户
  一条命令完成开机（登录）自启注册（FR-01；design §2 Windows 列 + Windows 隐藏窗口节；
  VBS 规避 console 弹黑框与 /TR 261 字符/引号转义限制 R-02）。
implementation:
  - 填充 task-01 留下的 src/autostart/windows.ts stub——ESM import（带 .js 扩展名）平台策略接口 register/unregister/query、AutostartRecord 类型与命令模板函数（node=process.execPath，script=path.resolve(process.argv[1])）
  - register 步骤 1（VBS 生成，design §2 Windows 隐藏窗口节逐字展开）——写 ~/.sillyhub/daemon/autostart-<hash8>.vbs（hash8=serverHash(serverUrl)，目录=DEFAULT_CONFIG_DIR，二者来自 sillyhub-daemon/src/config.ts 现有导出），内容两行——首行注释 'sillyhub-daemon autostart launcher (generated, do not edit)'，次行 'CreateObject("WScript.Shell").Run "<node绝对路径> ""<bundle绝对路径>"" start --server <url>", 0, False'——VBS 字符串内双引号转义为连写两个双引号（""），Run 第二参数 0=隐藏窗口、第三参数 False=不等待
  - register 步骤 2（schtasks 注册）——执行 'schtasks /Create /TN SillyHubDaemon-<hash8> /SC ONLOGON /TR "wscript.exe \"<vbs绝对路径>\"" /RL LIMITED /F'——/SC ONLOGON=登录时触发、/TR 只含 wscript.exe 与 vbs 路径（规避 261 字符限制与 cmd 引号转义地狱，R-02）、/RL LIMITED=用户级免管理员、/F=幂等覆盖（R-07）
  - unregister——执行 'schtasks /Delete /TN SillyHubDaemon-<hash8> /F' 并删除 autostart-<hash8>.vbs（VBS 一并清理；不杀运行中 daemon 进程，停进程仍用 stop）
  - query——执行 'schtasks /Query /TN SillyHubDaemon-<hash8>'——任务存在=registered、不存在=missing、命令执行失败=unknown（供 index.ts status 对账）
  - node 路径漂移检测（R-01）——register 成功后若 process.execPath 路径含 .nvm/、volta/、asdf/ 版本化目录片段，输出黄色警告"node 升级换路径后自启任务会失效，届时重新执行本命令即可"
acceptance:
  - enable 后 ~/.sillyhub/daemon/autostart-<hash8>.vbs 存在，内容含 ', 0, False' 隐藏窗口参数，node/bundle 路径均为绝对路径，bundle 路径引号已按 VBS 规则转义为两个连写双引号
  - schtasks 注册命令参数完整——/TN SillyHubDaemon-<hash8>、/SC ONLOGON、/RL LIMITED、/F 齐备，/TR 值仅为 wscript.exe 加 vbs 路径（不含 node/bundle 长命令）
  - 重复 register 幂等（/F 覆盖不报错）；unregister 后计划任务已删且 VBS 文件已删；query 三态映射正确
  - process.execPath 位于 .nvm/volta/asdf 版本化目录时 register 成功输出路径漂移警告
verify:
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - ESM import 一律带 .js 扩展名（如 from './index.js'）
  - 不引入任何 npm 依赖，仅用 node:child_process/node:fs/node:path 内置模块
  - windows.ts 只承载 win32 侧逻辑，不在非 Windows 平台执行任何系统命令（平台分派由 index.ts 按 process.platform 完成）
  - 本地记录 autostart-<hash8>.json 的读写归 index.ts（task-01），本卡只产系统注册产物（VBS + 计划任务）
  - 行为断言（VBS 内容/命令拼装/幂等/清理）归 task-06 tests/autostart.test.ts，本卡不写测试文件
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

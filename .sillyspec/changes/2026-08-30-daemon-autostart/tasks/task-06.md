---
id: task-06
title: 'autostart 单测 tests/autostart.test.ts——三平台产物内容断言（plist 无 KeepAlive/service 无 Restart/VBS 隐藏参数/文件名避 clean glob）+ 错误路径（无 systemd/PID1 检测；CLI 层凭据缺失路径归 task-07）+ 幂等覆盖 + disable 清理（mock child_process/fs）'
title_zh: 'autostart 单测 tests/autostart.test.ts——三平台产物内容断言（plist 无 KeepAlive/service 无 Restart/VBS 隐藏参数/文件名避 clean glob）+ 错误路径（无 systemd/PID1 检测；CLI 层凭据缺失路径归 task-07）+ 幂等覆盖 + disable 清理（mock child_process/fs）'
author: 'qinyi'
created_at: 2026-08-30 23:01:28
priority: P0
depends_on: ['task-01', 'task-02', 'task-03', 'task-04']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04]
decision_ids: [D-002@v1, D-003@v1]
allowed_paths:
  - sillyhub-daemon/tests/autostart.test.ts
goal: >
  新建 tests/autostart.test.ts（vitest，mock node:child_process 与 node:fs，风格对齐
  tests/preflight.test.ts / host-fs-handler.test.ts 的 vi.hoisted + vi.mock 模式）——对三平台
  注册产物做逐字内容断言（plist 无 KeepAlive / service 无 Restart / VBS 隐藏窗口参数 /
  兜底文件名避 clean glob）+ 错误路径（Linux PID1 非 systemd、linger 失败仅 warn）+
  幂等覆盖 + disable 清理，把 design §5 与 R-02/R-04/R-07/R-09 的可测试性要求落成回归防线。
implementation:
  - mock 基建——vi.mock 拦截 child_process 的 execFile/spawnSync 与 fs 的读写（按 src/autostart 实际消费面选 fs 整体 mock 或 tmpdir 注入）；平台分支切换按 index.ts 的 process.platform 分派注入点覆写（win32/darwin/linux 三态各一组用例）
  - Windows 断言（FR-01）——schtasks 注册命令参数拼装（/Create /TN SillyHubDaemon-<hash8> /SC ONLOGON /RL LIMITED /F；/TR 只含 wscript.exe 与 vbs 绝对路径，R-02 规避引号与 261 字符限制）；VBS 内容含 Run 尾参数 「, 0, False」、node 与脚本路径均为绝对路径、命令含 start --server <url>；任务命令行不含凭据（D-004）
  - macOS 断言（FR-02）——写盘 plist 内容含 RunAtLoad 且不含 KeepAlive（D-002）；ProgramArguments 为 [node 绝对路径, 脚本绝对路径, start, --server, url]；StandardOutPath/StandardErrorPath 指向 autostart-<hash8>.launchd.txt；注册顺序为 bootout（忽略失败）先行再 bootstrap gui/<uid>
  - Linux 断言（FR-03）——service 文件含 WantedBy=default.target 且不含 Restart（D-002）；命令序列 daemon-reload → enable → enable-linger（linger 失败仅 warn、enable 整体仍 ok=true）；PID1 非 systemd（mock /proc/1/comm 读取返回非 systemd）→ 明确报错含替代建议（WSL 启用 systemd 或改 Windows 侧安装，R-04）且不注册
  - clean glob 防误删断言（R-09）——断言兜底文件名 autostart-<hash8>.launchd.txt 不命中 clean 命令模式 *.log / *.out / *.err（对齐 src/cleanup.ts rootLogFilePatterns）
  - 幂等与清理（R-07）——同 server 二次 enable 不报错（/F、bootout 先行等幂等语义）；disable 清理全部产物（系统注册注销命令 + VBS/plist/service 文件 + 本地 autostart-<hash8>.json 记录）且不触发杀进程命令
  - 本地记录与 status 对账断言——enable 后 AutostartRecord 落盘六字段齐全（server_url/platform/node_path/script_path/task_name/enabled_at）；autostartStatus 对账 systemState 三态（registered / missing / unknown）
acceptance:
  - 三平台产物内容断言全部落地——plist 无 KeepAlive、service 无 Restart、VBS 含 「, 0, False」、launchd 兜底文件名 .launchd.txt 不命中 clean glob
  - 错误路径覆盖——Linux PID1 非 systemd 明确报错不注册；linger 失败仅 warn 不影响 enable 成功
  - 幂等 enable 二次成功；disable 清理全部产物（系统注册 + 生成文件 + 本地记录）
  - 测试全绿且任何平台运行均不触发真实 schtasks/launchctl/systemctl（全 mock，macOS/Linux 实机归 CI 矩阵与 verify 阶段 R-08 标注）
  - 不覆盖 CLI 层凭据缺失路径（归 task-07 cli.test.ts）
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/autostart.test.ts
constraints:
  - 仅新建 tests/autostart.test.ts——发现 src/autostart 实现缺陷上报不改码（本卡 allowed_paths 不含 src）
  - CLI 层凭据管线断言（凭据缺失 exit 1 / saveConfigFn 无条件落盘 / --token 过期警告 / nvm 路径警告）归 task-07，本卡不测
  - mock 模式沿用现有测试惯例（vi.hoisted + vi.mock('node:child_process')，import 带 .js 扩展名），不引新测试依赖
  - 断言针对产物内容与命令拼装（R-08 补偿策略），不依赖实机平台行为
expects_from:
  task-01:
    - contract: autostart 顶层 API
      needs: [enableAutostart, disableAutostart, autostartStatus]
    - contract: autostart 类型定义
      needs: [AutostartEnableOptions, AutostartRecord, AutostartStatusEntry]
    - contract: autostart 平台策略接口
      needs: [register, unregister, query]
  task-02:
    - contract: Windows autostart 策略
      needs: [register, unregister, query]
  task-03:
    - contract: macOS autostart 策略
      needs: [register, unregister, query]
  task-04:
    - contract: Linux autostart 策略
      needs: [register, unregister, query]
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

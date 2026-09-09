---
id: task-04
title: 'cursor-driver.ts implementation (respawn-per-turn + --resume chatId + Windows shim + interrupt/close) + unit test'
title_zh: 'cursor-driver.ts 实现（每轮 respawn + --resume chatId + Windows shim + interrupt/close）+ cursor-driver.test.ts'
author: 'qinyi'
created_at: 2026-09-08 13:00:34
priority: P0
depends_on: ['task-02', 'task-03']
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-001@v1, D-003@v1]
expects_from:
  task-03:
    - contract: normalizeCursorFrame
      needs: [normalizeCursorFrame]
  task-02:
    - contract: CursorForceModeDecision
      needs: [force_mode_args, permission_dialog_caps, probe_evidence]
allowed_paths:
  - sillyhub-daemon/src/interactive/cursor-driver.ts
  - sillyhub-daemon/tests/interactive/cursor-driver.test.ts
target_files:
  - NEW:sillyhub-daemon/src/interactive/cursor-driver.ts
  - NEW:sillyhub-daemon/tests/interactive/cursor-driver.test.ts
goal: >
  新建 CursorDriver 实现 InteractiveDriver 契约（driver.ts start/consume/interrupt
  三方法 + E3/E4/E5/E7）：每轮 respawn（每个 UserTurnInput spawn 一次
  cursor-agent headless 子进程）+ --resume chatId 串联多轮；stdout NDJSON 逐帧经
  task-03 normalizeCursorFrame 归一化后 envelope-only 上报；interrupt 置
  interruptPending 后 kill 进程树并以 error_during_execution 收敛（backend
  interactive_interrupted 规范通道，Grill B-02）；Windows 经 resolveWindowsCmdShim
  解 shim 防 spawn EINVAL；配单测覆盖生命周期 / interrupt / envelope-only / E3 / E5
  （参照 codex-app-server-driver.test.ts）。
implementation:
  - 新建 src/interactive/cursor-driver.ts——export interface CursorDriverStartOptions extends InteractiveDriverStartOptions 且新增 pathToAgentExecutable（daemon _agentPaths.get('cursor') 经 CreateSessionInput 注入，design 接口定义节）；export class CursorDriver implements InteractiveDriver（三方法签名对齐 driver.ts L255-279）；零参可构造（registry createDriver / cli 装配依赖，注册归 task-05/06）；driver 无状态、child 挂 handle（pi/codex 同款）；start 边界——空 pathToAgentExecutable 抛 CursorExecutableNotFoundError（code=CURSOR_EXECUTABLE_NOT_FOUND，codex/pi 同款先例），start 时不 spawn（每轮 respawn 在 consume 内），handle 初始 processId=undefined（每轮可变镜像，E5）
  - consume 每轮生命周期——input 迭代器只建一次单订阅（E4 只消费不 mutate/close）→ for await 取 UserTurnInput，空文本 turn 跳过（E1）→ 按设计伪代码拼 spawn 参数——['-p','--output-format','stream-json','--trust']，有 chatId 追加 ['--resume',chatId]，options.model 追加 ['--model',model]（model 字符集白名单校验防命令行注入，批量 buildArgs DA-1 同款口径），**options.model 缺省时追加 ['--model','auto']（task-01 实测：Free 计划不带模型报 Named models unavailable；auto 为全账户可用缺省）**，--force 与否已定版（task-02 D-003@v2）：恒带 ['--force','--trust']，turn.text 作位置参数（stdin 留空，批量 adapters/stream-json.ts L320-346 同款；不加 --workspace，CLI 缺省=cwd）→ spawn 时 cwd 取 options.cwd、env 取 options.env ?? process.env 透传（凭证注入通道预留，spawn-env 既有链）、windowsHide=true（ql-20260907-004 防黑框）
  - Windows shim（spawn 前必解——ql-20260624-002 EINVAL 已知坑）——win32 且后缀 .cmd/.bat → resolveWindowsCmdShim 解析 → 以解析产物 exe + prependArgs 前缀拼参数 spawn（shell=false）；解析失败回退 shell=true 兜底；.ps1 直连例外——cmd.exe 跑不了 ps1，显式包装 powershell -NoProfile -ExecutionPolicy Bypass -File <ps1>（cmd-shim.ts L74-79 先例，Grill CC-05）；非 Windows / 直 exe 路径行为不变
  - stdout 分帧与事件上报——LF 严格分帧（pi-rpc-driver LfLineFramer 同款或等价自实现，禁 Node readline）→ 每行 JSON.parse → 交 task-03 normalizeCursorFrame → 逐事件以 envelope-only 调 onTurnMessage（events 数组承载；raw 仅 SILLYHUB_DEBUG_RAW_EVENTS=1 时携带 provider 原始帧，下游禁止依赖）；畸形 JSON 行 warn 丢弃不抛（E3 精神）；stderr 有界累积做诊断载体（exit 消息附尾部，不进事件流——pi 同款口径）
  - chatId 管理（driver 内会话状态，优先级链）——options.resume（首启恢复）→ 上一轮捕获值 → 首轮 system/init 帧 session_id 捕获（**task-01 实测：所有帧均带顶层 session_id，任意帧可作捕获点，result 帧备份**）→ create-chat 子命令兜底（**task-01 验证 C 已确认可用：stdout 为裸 UUID 文本非 JSON，按行 trim 解析**）；后续轮 spawn 自动追加 --resume <chatId>；捕获值随 onTurnResult.session_id 上报（resume 指针经 SessionManager 既有链落库，生命周期契约表 turn result 行）
  - turn 收敛（result 帧 + 进程退出双确认）——收到 result 帧先记录 usage（五字段短名）/session_id/subtype，等进程退出——exit 0 → onTurnResult 以 subtype='success'、is_error=false、usage、session_id 收敛；进程退出无 result 帧——exit≠0 判 subtype='error_during_execution' 且 is_error=true，exit=0 按正常收敛（usage 缺省）；spawn 失败 / 输出流异常 → onTurnError 上报不吞（E3）并以 error result 收敛当前轮；每轮收敛后 handle.processId 置回 undefined
  - interrupt(handle)——null / 已 closing / 无 running child → 返回 false 不冒泡（E3 no-op）；有 child → 先置 interruptPending 标记再 kill 进程树——Windows 走 taskkill /PID <pid> /T /F，posix spawn 时 detached=true 起进程组、process.kill(-pid) 杀组——→ 当前轮不等 result 帧，立即以 subtype='error_during_execution' + is_error=true 收敛（backend close_run_steps.py L216-225 终态映射 → AgentRun failed + error_code='interactive_interrupted' 规范通道，claude SDK abort 同款语义；pi 报 success 是手册 §5.3 记录的存量偏差不效仿——Grill B-02）→ 返回 true
  - close()——幂等（closing 标记防重入）kill child + 清理（SIGTERM→宽限→SIGKILL 升级，pi KILL_GRACE_MS=2000 同款；Windows 走 taskkill）；不动 input 队列（E4 完整语义——队列只消费不 mutate/close、回调不缓存复用）；E7 docblock 声明 handle 含子进程资源不可序列化禁止落盘
  - 忽略的 StartOptions（docblock 逐项声明「忽略——无对应 CLI 通道」）——manualApproval / askUserOnly（无审批通道，permission_dialog=false）、mcpServers（CLI 无 per-session --mcp-config，D-008@v1 实证）、blocks 附件（multimodal=false）；caps 对应键全部 false（取值归 task-05）
  - 新建 tests/interactive/cursor-driver.test.ts（参照 codex-app-server-driver.test.ts 手法——spawn 桩注入 fake child、模拟 stdout 帧流与 exit）——①生命周期：首轮 spawn 参数序断言（-p / --output-format stream-json / --trust / prompt 位置参数，stdin 不写）、空文本 turn 跳过；②多轮串行 + chatId：第二轮参数含 --resume <首轮 system/init 帧捕获 chatId>、result 帧 + exit 0 → onTurnResult 携 usage + session_id；③interrupt：进行中 kill 进程树 → subtype='error_during_execution' / is_error=true 收敛 + 返回 true，无 child / null → false；④envelope-only：onTurnMessage 入参恒 events 数组形态、默认不携带 raw；⑤E3：spawn error → onTurnError 上报不吞；⑥E5：handle.provider='cursor' 恒定、processId 每轮 spawn 后更新 / 收敛后 undefined；⑦异常收敛：exit≠0 无 result 帧 → is_error=true，exit=0 无 result 帧 → 正常收敛 usage 缺省；⑧Windows shim 分支桩：.cmd 解析后 shell=false 且 prependArgs 前置、.ps1 显式 powershell 包装、解析失败回退 shell=true
acceptance:
  - CursorDriver implements InteractiveDriver——start/consume/interrupt 三方法与 driver.ts L255-279 签名一致；CursorDriverStartOptions extends InteractiveDriverStartOptions 且新增 pathToAgentExecutable（FR-02）
  - 每轮 respawn + --resume chatId 串联多轮——第二轮 spawn 追加 --resume <chatId>，chatId 按 options.resume → 上一轮捕获 → system/init 帧（result 备份）→ create-chat 兜底优先级链获取
  - 事件链 envelope-only——stdout NDJSON 逐帧 normalizeCursorFrame → onTurnMessage（events 数组，raw 仅 SILLYHUB_DEBUG_RAW_EVENTS=1）；result 帧 + 进程退出双确认后 onTurnResult 携 usage 五字段短名 + session_id
  - interrupt 规范通道——置 interruptPending 后 kill 进程树（Windows taskkill /PID <pid> /T /F，posix 进程组 kill）→ 当前轮 subtype='error_during_execution' + is_error=true 收敛 + 返回 true；无 running child 返回 false 不冒泡（E3）；close() 幂等 kill 且不动 input 队列（E4）
  - Windows shim 链路——.cmd/.bat 经 resolveWindowsCmdShim 解析后 shell=false spawn；.ps1 直连显式 powershell -NoProfile -ExecutionPolicy Bypass -File 包装；解析失败回退 shell=true
  - manualApproval / askUserOnly / mcpServers / blocks 四项忽略且 docblock 声明；options.env 透传子进程
  - 单测全绿（生命周期 / interrupt / envelope-only / E3 / E5 / 多轮 resume / shim 分支）且 daemon typecheck 零错误
verify:
  - pnpm -C sillyhub-daemon exec vitest run tests/interactive/cursor-driver.test.ts
  - pnpm -C sillyhub-daemon run typecheck
constraints:
  - 不改 driver.ts / providers.ts / types.ts / agent-event-schema.ts 契约文件（注册与 caps 归 task-05、cli 装配与持久化白名单归 task-06）；契约不够用停下报告
  - 不动批量 adapters/ 与 agent-detector（D-002@v1 零触碰批量层；参数集仅注释对齐引用，不修改共享代码）
  - --force 与否严格按 task-02 结论（CursorForceModeDecision.force_mode_args）落参数不自行拍板；结论未回填时停下询问
  - spawn 前必须先解 Windows shim（ql-20260624-002 EINVAL 已知坑）；不引新依赖；ESM import 带 .js 后缀；注释中文标注依据（先例文件行号 / 设计锚点 / Grill 结论）
provides:
  - contract: CursorDriver
    fields: [CursorDriver]
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
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->

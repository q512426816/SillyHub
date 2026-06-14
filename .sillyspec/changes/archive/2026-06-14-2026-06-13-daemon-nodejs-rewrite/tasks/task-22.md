---
author: qinyi
created_at: 2026-06-14T00:08:01+0800
id: task-22
title: 测试迁移（tests/**/*.test.ts，1:1 迁移 16 个 Python 测试文件到 vitest）
priority: P0
estimated_hours: 8
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-10, task-11, task-12, task-13, task-14, task-15, task-16, task-17, task-18, task-19, task-20]
blocks: [task-23]
allowed_paths:
  - sillyhub-daemon/tests/
---

# task-22：测试迁移（tests/**/*.test.ts，1:1 迁移 16 个 Python 测试文件到 vitest）

> 变更：`2026-06-13-daemon-nodejs-rewrite`，Wave W5 最大任务（8h 上限），承载 R-08（vitest/pytest 语义对齐）。
> Python 源对照：`sillyhub-daemon/tests/` 全部 16 文件，共 ~6660 行 ~326 个用例。
> 职责：把全部 16 个 Python pytest 文件 1:1 迁移到 vitest（`.test.ts`），**行为覆盖等价，不追求代码行数 1:1**（design.md §10 R-08 明确策略：逐用例核对断言、fixture 文本样本共用、只求行为覆盖 1:1）。各 adapter 测试已在前置 task（task-06~10）落了部分 fixture 与用例，本任务负责**全量迁移补齐 + 去重 + 统一**。
> 关键事实：通读全部 16 文件后确认**无 `@pytest.mark.parametrize`、无 `@pytest.mark.skip`、无 `@pytest.mark.skipif`**，迁移简化为「类→describe、函数→it、fixture→beforeEach/工厂」三件套，无参数化数组需要搬。

- Wave：W5（收尾），依赖 task-01~task-20（所有实现 task 完成，被测源码已就绪才能迁移用例）
- 阻塞：task-23（真实 backend 冒烟，必须先有 16 个 `.test.ts` 全绿基线才能进入端到端冒烟）
- Python 源对照（统计实测，非估算）：

| Python 文件 | 行数 | 测试类 | 用例数 | fixture 数 | 已被前置 task 覆盖 |
|---|---|---|---|---|---|
| test_agent_detector.py | 546 | 12 | 52 | 0 | task-16（部分 parse_semver/check_min_version 用例） |
| test_backends_init.py | 268 | 0 | 11 | 0 | task-11（工厂映射 get_protocol/get_backend 用例） |
| test_cli.py | 150 | 4 | 10 | 2 | 无（task-21 才生成，本任务负责） |
| test_client.py | 277 | 10 | 16 | 2 | task-17（REST 方法 mock 用例） |
| test_credential.py | 238 | 5 | 26 | 2 | task-15（CRUD/render_config 部分） |
| test_daemon.py | 579 | 10 | 26 | 3 | task-20（生命周期 mock 用例） |
| test_daemon_multi_runtime.py | 479 | 0 | 11 | 0 | task-20（多 runtime 注册用例） |
| test_json_rpc.py | 1033 | 0 | 25 | 0 | task-07（_JsonRpcTransport + execute 用例） |
| test_jsonl_backend.py | 441 | 7 | 28 | 0 | task-08（copilot parse_output_multi 用例） |
| test_ndjson_backend.py | 362 | 6 | 25 | 0 | task-09（opencode parse 用例） |
| test_stream_json_backend.py | 691 | 12 | 29 | 0 | task-06（claude parse_output 用例） |
| test_task_runner.py | 588 | 7 | 25 | 7 | task-19（编排链 mock 用例） |
| test_task_runner_provider_dispatch.py | 474 | 12 | 13 | 0 | task-19（provider 分派用例） |
| test_text_backend.py | 153 | 3 | 14 | 0 | task-10（agy build_args/parse_line 用例） |
| test_version.py | 115 | 4 | 24 | 0 | task-14（parse/format/check 全部） |
| test_workspace.py | 266 | 7 | 17 | 3 | task-15（git mirror/diff 部分） |
| **合计** | **6660** | **89** | **~326** | **19** | — |

---

## 修改文件

新增 16 个 `.test.ts` 文件，全部位于 `sillyhub-daemon/tests/`（task-04 已建好目录 + vitest.config.ts）：

| 操作 | 文件路径 | Python 源 | 说明 |
|---|---|---|---|
| 新增 | `sillyhub-daemon/tests/agent-detector.test.ts` | test_agent_detector.py | 12 describe / 52 it；vi.spyOn(which) + vi.mock('child_process') |
| 新增 | `sillyhub-daemon/tests/backends-init.test.ts` | test_backends_init.py | 11 it（模块级）；PROTOCOL_PROVIDERS 映射断言 |
| 新增 | `sillyhub-daemon/tests/cli.test.ts` | test_cli.py | 4 describe / 10 it；execa/commander 输出捕获 |
| 新增 | `sillyhub-daemon/tests/client.test.ts` | test_client.py | 10 describe / 16 it；global.fetch mock |
| 新增 | `sillyhub-daemon/tests/credential.test.ts` | test_credential.py | 5 describe / 26 it；fs.mkdtemp + fs.chmod 校验 |
| 新增 | `sillyhub-daemon/tests/daemon.test.ts` | test_daemon.py | 10 describe / 26 it；vi.useFakeTimers + ws mock |
| 新增 | `sillyhub-daemon/tests/daemon-multi-runtime.test.ts` | test_daemon_multi_runtime.py | 11 it（模块级）；register body 断言 |
| 新增 | `sillyhub-daemon/tests/json-rpc.test.ts` | test_json_rpc.py | 25 it（模块级）；FakeStdin/FakeStdout + spawn mock |
| 新增 | `sillyhub-daemon/tests/jsonl.test.ts` | test_jsonl_backend.py | 7 describe / 28 it；parse_output_multi 输入字面量 |
| 新增 | `sillyhub-daemon/tests/ndjson.test.ts` | test_ndjson_backend.py | 6 describe / 25 it；parse_output_multi 输入字面量 |
| 新增 | `sillyhub-daemon/tests/stream-json.test.ts` | test_stream_json_backend.py | 12 describe / 29 it；_AsyncReader → Readable mock |
| 新增 | `sillyhub-daemon/tests/task-runner.test.ts` | test_task_runner.py | 7 describe / 25 it；getBackend vi.mock + git_repo fixture |
| 新增 | `sillyhub-daemon/tests/task-runner-provider-dispatch.test.ts` | test_task_runner_provider_dispatch.py | 12 describe / 13 it；getBackend vi.mock |
| 新增 | `sillyhub-daemon/tests/text.test.ts` | test_text_backend.py | 3 describe / 14 it；纯 parse_line |
| 新增 | `sillyhub-daemon/tests/version.test.ts` | test_version.py | 4 describe / 24 it；纯函数（**已由 task-14 落，本任务核对去重**） |
| 新增 | `sillyhub-daemon/tests/workspace.test.ts` | test_workspace.py | 7 describe / 17 it；execa('git') + tmp 仓库 fixture |

> 注：`version.test.ts` 由 task-14 在 W2 阶段已生成（task-14 蓝图 AC 明确要求），本任务**仅核对存在 + 全绿**，不重复创建，避免与 task-14 冲突（详见「与前置 task 去重说明」）。

---

## 实现要求

### R1. 文件名 1:1 映射规则（去 `test_` 前缀 + snake_case→kebab-case + `.test.ts`）

| Python | vitest | 规则 |
|---|---|---|
| `test_agent_detector.py` | `agent-detector.test.ts` | 去 `test_`，下划线转连字符 |
| `test_backends_init.py` | `backends-init.test.ts` | 同上 |
| `test_cli.py` | `cli.test.ts` | 同上 |
| `test_client.py` | `client.test.ts` | 同上 |
| `test_credential.py` | `credential.test.ts` | 同上 |
| `test_daemon.py` | `daemon.test.ts` | 同上 |
| `test_daemon_multi_runtime.py` | `daemon-multi-runtime.test.ts` | 同上 |
| `test_json_rpc.py` | `json-rpc.test.ts` | 同上（注意 backend 名 `json_rpc`→`json-rpc`，与 src 文件名对齐） |
| `test_jsonl_backend.py` | `jsonl.test.ts` | 去 `_backend` 后缀（src 是 `adapters/jsonl.ts` 不是 `jsonl-backend.ts`） |
| `test_ndjson_backend.py` | `ndjson.test.ts` | 同上 |
| `test_stream_json_backend.py` | `stream-json.test.ts` | 同上 |
| `test_task_runner.py` | `task-runner.test.ts` | 同上 |
| `test_task_runner_provider_dispatch.py` | `task-runner-provider-dispatch.test.ts` | 同上 |
| `test_text_backend.py` | `text.test.ts` | 同上 |
| `test_version.py` | `version.test.ts` | 同上（**task-14 已建**） |
| `test_workspace.py` | `workspace.test.ts` | 同上 |

### R2. pytest → vitest 映射表（通读 16 文件后实测，无 parametrize/skip）

| pytest 构造 | vitest 等价 | 实测出现位置 | 备注 |
|---|---|---|---|
| `class TestXxx:` | `describe('Xxx', () => { ... })` | 89 处 | 类名去 `Test` 前缀作 describe 标题 |
| `def test_yyy(self, ...)` | `it('yyy', () => { ... })` | ~326 处 | 方法名去 `test_` 前缀作 it 标题 |
| `async def test_yyy` + `@pytest.mark.asyncio` | `it('yyy', async () => { ... })` | daemon/task_runner/json_rpc/client 等大量 | vitest 原生支持 async it，无需 marker |
| `assert x == y` | `expect(x).toBe(y)` | 全部 | 严格相等 |
| `assert x is None` | `expect(x).toBeNull()` 或 `expect(x).toBe(null)` | parse_output 返回值 | 优先 `toBeNull()` |
| `assert x is not None` | `expect(x).not.toBeNull()` | 同上 | |
| `assert x in y` | `expect(y).toContain(x)` | args 断言（`"-p" in args`） | 字符串/数组成员 |
| `assert x not in y` | `expect(y).not.toContain(x)` | 同上 | |
| `with pytest.raises(Exc, match="re"):` | `expect(() => fn()).toThrow(/re/)` | get_protocol ValueError | 正则字面量 |
| `with pytest.raises(json.JSONDecodeError):` | `expect(() => fn()).toThrow(SyntaxError)` 或自定义 | credential 损坏 JSON | JSON.parse 抛 SyntaxError |
| `@pytest.fixture def name():` | 工厂函数 + `const name = makeName()` 或 `beforeEach` | 19 处 fixture | 见 R3 |
| `tmp_path` | `beforeEach` 内 `fs.mkdtemp(path.join(os.tmpdir(), 'xxx-'))` | 6 文件 | 见 R4 |
| `monkeypatch.setattr(mod, 'X', v)` | `vi.spyOn(mod, 'X').mockReturnValue(v)` | test_cli | |
| `monkeypatch.setattr(mod, 'X', v)`（模块常量） | 重构源码为可注入（如 task-21 已用函数包装 PID/LOG path） | test_cli `_PID_FILE` | 与 task-21 协调 |
| `with patch.dict(os.environ, {...})` | `vi.stubEnv('KEY', 'val')` + `afterEach(() => vi.unstubAllEnvs())` | test_agent_detector / test_credential | |
| `with patch('mod.fn', return_value=v)` | `vi.mock('mod', ...)` 或 `vi.spyOn(mod, 'fn').mockReturnValue(v)` | 全局 | 见 R5 mock 策略 |
| `@patch('x.y')` 装饰器传参 mock | `vi.spyOn(y, 'fn').mockResolvedValue(v)` 在 it 内 setup | test_agent_detector 大量 | Python 装饰器参数=vitest 内显式 spy |
| `AsyncMock(return_value=v)` | `vi.fn().mockResolvedValue(v)` | daemon/client/task_runner | |
| `MagicMock(spec=Cls)` | `vi.mocked(Cls)` 或手写 stub 对象 | daemon/client | |
| `mock.call_count` | `expect(vi.fn).toHaveBeenCalledTimes(n)` | 全局 | |
| `mock.assert_awaited_once_with(a, b)` | `expect(vi.fn).toHaveBeenCalledWith(a, b)` + await 检查 | daemon/client | vitest 不区分 await，需补 `expect(vi.fn).toHaveBeenCalled()` |
| `mock.call_args.kwargs['json']` | `vi.fn.mock.calls[n][0]` 或 `vi.fn.mock.lastCall` | daemon-multi-runtime | |
| `CliRunner().invoke(cli, ['status'])` | `execa('node', ['dist/cli.js', 'status'])` 或直接调 `cli.parse(['status'])` | test_cli | 见 R6 |
| `asyncio.create_task(coro)` | `Promise` + `Promise.race`/手动 cancel | daemon._fire | |
| `asyncio.sleep(0.1)` | `await new Promise(r => setTimeout(r, 100))` 或 `vi.useFakeTimers()` | daemon 心跳测试 | 见 R7 |
| `subprocess.run(['git', ...])` | `execa('git', [...])` | test_workspace fixture | |

### R3. fixture 迁移策略（19 个 fixture 集中在 6 文件）

| Python fixture | vitest 方案 | 出现文件 |
|---|---|---|
| `@pytest.fixture def runner()` → `CliRunner()` | 删除（vitest 直接调 cli.parse 或 execa） | test_cli |
| `@pytest.fixture def tmp_daemon_dir(tmp_path, monkeypatch)` | `beforeEach` 内 mkdtemp + 重定向 PID/LOG 路径常量（依赖 task-21 把 `_PID_FILE/_LOG_FILE` 改为函数返回或可注入） | test_cli |
| `@pytest.fixture def mock_response()` 工厂 | `function makeMockResponse(status, json)` 普通函数 | test_client |
| `@pytest.fixture def client()` | `beforeEach` 内 `new HubClient(...)` + 替换 `global.fetch` | test_client |
| `@pytest.fixture def cred_path(tmp_path)` | `beforeEach` 内 `const credPath = path.join(tmpDir, 'credentials.json')` | test_credential |
| `@pytest.fixture def mgr(cred_path)` | `beforeEach` 内 `new CredentialManager(credPath)` | test_credential |
| `@pytest.fixture def base_dir(tmp_path)` | `beforeEach` 内 `const baseDir = tmpDir` | test_workspace |
| `@pytest.fixture def manager(base_dir)` | `beforeEach` 内 `new WorkspaceManager(baseDir)` | test_workspace |
| `@pytest.fixture def git_repo(tmp_path)` | `beforeEach` 内 `async function makeGitRepo()` 用 execa 跑 git init/commit | test_workspace / test_task_runner |
| `@pytest.fixture def mock_config(tmp_path)` | `beforeEach` 内 `new DaemonConfig(configPath)` + 改 `_data['heartbeat_interval']=0.05` | test_daemon |
| `@pytest.fixture def mock_client()` | `beforeEach` 内 `new HubClient(...)` + vi.spyOn 各方法 mockResolvedValue | test_daemon |
| `@pytest.fixture def daemon(mock_config, mock_client)` | `beforeEach` 内 `new Daemon(mockConfig, mockClient)` | test_daemon |
| `@pytest.fixture def client()` (task_runner) | 同 daemon 的 mock_client | test_task_runner |
| `@pytest.fixture def workspace_base / manager / cred_path / credential_manager / runner` | `beforeEach` 串行建（依赖链：base→manager / credPath→credentialManager→runner） | test_task_runner |

> vitest 的 `beforeEach` 天然隔离（每个 it 独立 tmpDir），比 pytest fixture 共享更安全，**所有 tmpDir 用 `fs.mkdtemp(path.join(os.tmpdir(), 'sillyhub-test-'))`**，`afterEach` 用 `fs.rm(tmpDir, { recursive: true, force: true })` 清理（AC-06）。

### R4. tmp_path 等价实现（每个用到文件系统的 it 独立临时目录）

```ts
// tests/helpers.ts（可由本任务新建，位于 allowed_paths 内）
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function makeTmpDir(prefix = 'sillyhub-test-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function cleanupDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
```

每个 describe 的 `beforeEach` 建 `tmpDir`，`afterEach` 删，**严禁污染 /tmp 根或项目目录**（AC-06）。

### R5. mock 策略（按被测对象分类）

| 被测对象 | Python mock 方式 | vitest mock 方式 | 关键点 |
|---|---|---|---|
| 子进程 `asyncio.create_subprocess_exec` | `patch('mod.asyncio.create_subprocess_exec', mock)` | `vi.mock('node:child_process', ...)` 或自建 `spawn` stub 返回 `Readable` stream | stream-json/json-rpc/agent-detector 共用；stdout 用 `Readable.from(lines)` |
| HTTP `httpx.AsyncClient.post` | `AsyncMock(return_value=mock_response)` | `vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, json: () => ... }))` | client/daemon 共用；vitest 不 mock 整个 client 实例，mock 全局 fetch |
| WebSocket `websockets.connect` | `patch('daemon.websockets.connect', ctx)` | `vi.mock('ws', ...)` 返回 EventEmitter mock，或手写 `class FakeWs extends EventEmitter` | daemon._ws_loop 重连测试 |
| `shutil.which` | `patch('agent_detector.shutil.which', return_value='/usr/bin/claude')` | `vi.mock('node:child_process')` 拦截 `execFileSync('which', ...)` 或 `vi.spyOn` 封装的 which 函数 | agent-detector；需 task-16 暴露可注入的 which |
| `os.path.isfile` | `patch('os.path.isfile', return_value=True)` | `vi.spyOn(fs, 'existsSync').mockReturnValue(true)` 或 `statSync` spy | agent-detector |
| `os.environ` | `patch.dict(os.environ, {...})` | `vi.stubEnv('KEY', 'val')` + `afterEach(vi.unstubAllEnvs)` | agent-detector / credential |
| `os.kill`（CLI stop） | `patch('os.kill')` no-op | `vi.spyOn(process, 'kill').mockImplementation(() => true)` | test_cli stop |
| `asyncio.sleep`（加速心跳循环） | `patch('daemon.asyncio.sleep', fast_sleep)` | `vi.useFakeTimers()` + `vi.advanceTimersByTime(50)` 或 spy `setTimeout` | test_daemon 心跳/poll 循环 |
| `platform.system` | `patch('platform.system', return_value='Windows')` | `vi.spyOn(process, 'platform').mockReturnValue('win32')` 或 mock `os.platform` | test_agent_detector Windows CMD wrapper |

### R6. CLI 测试特殊处理（test_cli.py → cli.test.ts）

Python 用 `CliRunner().invoke(cli, ['status'])` 同步捕获 stdout/exit_code。vitest 两种方案：
- **方案A（推荐）**：commander 的 `program.parse(['node', 'cli', 'status'], { from: 'user' })` + 捕获 `console.log`（`vi.spyOn(console, 'log')`）+ 断言 `process.exitCode`。同步、快、无子进程开销。
- **方案B（冒烟级）**：`execa('tsx', ['src/cli.ts', 'status'])` 拉起真实进程，捕获 stdout。慢但真实。仅 `--help` 类用例用。

本任务**全用方案A**（与 task-21 的 commander 实现对齐），方案B 留给 task-23 真实冒烟。

### R7. 异步/时序测试处理（daemon 心跳循环最复杂）

test_daemon.py 的心跳/重连测试依赖 `asyncio.sleep(0.1)` 等真实时间 + `task.cancel()`。迁移到 vitest：
- **优先 `vi.useFakeTimers()`**：`beforeEach(() => vi.useFakeTimers())`，it 内 `vi.advanceTimersByTimeAsync(100)` 推进，断言 `mockClient.heartbeat.mock.calls.length >= 1`，`afterEach(() => vi.useRealTimers())`。
- **禁用真实 sleep**：不要 `await new Promise(r => setTimeout(r, 100))`，会让 CI 慢且 flaky。
- **重连测试**（`test_ws_reconnects_on_failure`）：Python mock 了 `asyncio.sleep` 让 5s 重连秒回，vitest 用 fake timers + `vi.advanceTimersByTimeAsync(5000)` 推进一次重连周期，断言 `connectCount >= 2`。
- **取消 task**：Python `task.cancel()`，vitest 用 `AbortController` 或直接断言 `_running = false` 后循环退出（不强制 cancel 语义，只要不 hang）。

### R8. 与前置 task 去重说明（关键，避免冲突）

| 测试文件 | 前置 task 已落内容 | 本任务职责 |
|---|---|---|
| `version.test.ts` | **task-14 已全部 24 用例落地**（task-14 蓝图 AC-02 明确 1:1 迁移 test_version.py） | **仅核对存在 + `pnpm test version` 全绿**，不重复创建。若 task-14 漏用例则补，否则跳过。 |
| `stream-json.test.ts` | task-06 已落 parse_output 的 system/assistant/user/result/log/control_request 用例（~20 个） + build_args/build_input + execute mock（~9 个） | **核对 task-06 是否覆盖 test_stream_json_backend.py 全 29 用例**，补漏（如 multiple_blocks 取最后一个 block 的语义、factory registration get_backend('claude'/'gemini'/'cursor')、inheritance 检查）。 |
| `json-rpc.test.ts` | task-07 已落 _JsonRpcTransport request/notification/server-request + execute handshake/item/turn/timeout/malformed + parse_output + provider 差异 + factory + cmd_not_found + turn_failed + handshake_timeout | **核对 task-07 是否覆盖全 25 用例**，补漏（如 thread filtering 语义、turn/completed parse_output 返回 None）。 |
| `jsonl.test.ts` | task-08 已落 build_args + session.start/message_delta/message_full/tool_complete/result + edge cases + full_flow | **核对 task-08 是否覆盖全 28 用例**，补漏（如 session.warning level、assistant.turn_start status=running、reasoning_delta）。 |
| `ndjson.test.ts` | task-09 已落 build_args + text/tool_use/error/step_start/step_finish + edge cases | **核对 task-09 是否覆盖全 25 用例**，补漏（如 tool_use dict output JSON 序列化、provider_attribute 三 provider）。 |
| `text.test.ts` | task-10 已落 build_args + parse_line + meta | **核对 task-10 是否覆盖全 14 用例**，补漏（如 accumulate output 空行不混入、binary_name='agy'）。 |
| `backends-init.test.ts` | task-11 已落 AgentEvent/TaskResult dataclass + ABC + PROTOCOL_PROVIDERS 12 provider + get_protocol/get_backend | **核对 task-11 是否覆盖全 11 用例**，补漏（如 no_duplicate providers 断言、get_backend_all_known_providers）。 |
| `agent-detector.test.ts` | task-16 已落 AgentDef/DetectedAgent dataclass + AGENT_DEFS 12 entries + _resolve_bin_path + _detect_version + detect_all/one + version_warning + parse_semver/check_min_version + backward compat + is_available | **核对 task-16 是否覆盖全 52 用例**（task-16 是大头），补漏。 |
| `credential.test.ts` | task-15 已落 _load/save/CRUD/render_config/build_env | **核对 task-15 是否覆盖全 26 用例**，补漏（如 file_permissions 0600、does_not_mutate_input）。 |
| `workspace.test.ts` | task-15 已落 init/get_path/prepare clone+pull/collect_diff/clean/_parse_shortstat | **核对 task-15 是否覆盖全 17 用例**，补漏（如 stats_parsed insertions 校验）。 |
| `client.test.ts` | task-17 已落 init/close/register/heartbeat/claim/start/lease_heartbeat/submit/complete/error | **核对 task-17 是否覆盖全 16 用例**，补漏（如 submit_empty_messages、complete_with_error_result）。 |
| `daemon.test.ts` | task-20 已落 init/start/stop/_fire/heartbeat_loop/poll_loop/handle_ws_message/execute_task/ws_loop/build_ws_url | **核对 task-20 是否覆盖全 26 用例**，补漏（如 heartbeat_survives_errors 重试、ws_reconnects_on_failure）。 |
| `daemon-multi-runtime.test.ts` | task-20 已落 registers_each_agent/runtime_id_format/no_agents/single_failure_continues/capabilities/client_register_with/without_runtime_id/registered_runtimes/version_unknown | **核对 task-20 是否覆盖全 11 用例**，补漏。 |
| `task-runner.test.ts` | task-19 已落 TaskResult/init/execute_task/progress_streaming/task_tracking/diff_collection/_truncate | **核对 task-19 是否覆盖全 25 用例**，补漏（如 credentials_rendered、output_truncation _MAX_OUTPUT）。 |
| `task-runner-provider-dispatch.test.ts` | task-19 已落 uses_claude/codex/copilot/antigravity_backend/default/unsupported/passes_params/event_forwarding/diff_collected/backward_compatible/old_methods_removed | **核对 task-19 是否覆盖全 13 用例**，补漏。 |
| `cli.test.ts` | **无前置 task**（task-21 才生成 CLI 蓝图，task-21 实现时可能已落部分） | **本任务全量迁移 10 用例**，与 task-21 协调 PID/LOG 路径注入方式。 |

> **去重原则**：每个 `.test.ts` 文件**唯一归属**——若前置 task 已建该文件，本任务**只补漏用例 + 统一 mock 风格**，绝不重建整个文件。迁移映射表（下节）的「本任务补」列标注每个文件的实际增量。

---

## 接口定义（迁移映射表 = 本任务核心交付）

### 表 A：16 个 Python 文件 → 16 个 vitest 文件 1:1 映射

| # | Python 源 | 行数 | 用例数 | → vitest 目标 | describe/it | 本任务增量 | Mock 策略 |
|---|---|---|---|---|---|---|---|
| 1 | `test_version.py` | 115 | 24 | `version.test.ts` | 4d/24it | **核对（task-14 已全量落地，仅 pnpm test 全绿即可）** | 无（纯函数） |
| 2 | `test_text_backend.py` | 153 | 14 | `text.test.ts` | 3d/14it | 补漏（binary_name='agy'、空行不混入） | 无 |
| 3 | `test_cli.py` | 150 | 10 | `cli.test.ts` | 4d/10it | **全量迁移**（无前置） | commander + vi.spyOn(console) + vi.stubGlobal('process') |
| 4 | `test_backends_init.py` | 268 | 11 | `backends-init.test.ts` | 11it（模块级） | 补漏（no_duplicate providers、get_backend_all） | 无（断言静态导出） |
| 5 | `test_credential.py` | 238 | 26 | `credential.test.ts` | 5d/26it | 补漏（file_permissions 0600、does_not_mutate_input） | fs.mkdtemp + fs.chmod + vi.stubEnv |
| 6 | `test_workspace.py` | 266 | 17 | `workspace.test.ts` | 7d/17it | 补漏（stats_parsed insertions 校验） | execa('git') 真实 tmp 仓库 fixture |
| 7 | `test_client.py` | 277 | 16 | `client.test.ts` | 10d/16it | 补漏（submit_empty_messages、complete_with_error_result） | vi.stubGlobal('fetch', vi.fn()) |
| 8 | `test_ndjson_backend.py` | 362 | 25 | `ndjson.test.ts` | 6d/25it | 补漏（tool_use dict output JSON 序列化、provider_attribute） | 无 |
| 9 | `test_jsonl_backend.py` | 441 | 28 | `jsonl.test.ts` | 7d/28it | 补漏（session.warning、turn_start running、reasoning_delta） | 无 |
| 10 | `test_daemon_multi_runtime.py` | 479 | 11 | `daemon-multi-runtime.test.ts` | 11it（模块级） | 补漏 | vi.spyOn(detector, 'detectAll') |
| 11 | `test_task_runner_provider_dispatch.py` | 474 | 13 | `task-runner-provider-dispatch.test.ts` | 12d/13it | 补漏 | vi.mock('../backends', () => ({ getBackend: vi.fn() })) |
| 12 | `test_agent_detector.py` | 546 | 52 | `agent-detector.test.ts` | 12d/52it | 补漏（task-16 大头已落） | vi.mock('node:child_process') + vi.spyOn(fs) + vi.stubEnv |
| 13 | `test_daemon.py` | 579 | 26 | `daemon.test.ts` | 10d/26it | 补漏（heartbeat_survives_errors、ws_reconnects_on_failure） | vi.useFakeTimers + vi.mock('ws') |
| 14 | `test_task_runner.py` | 588 | 25 | `task-runner.test.ts` | 7d/25it | 补漏（credentials_rendered、output_truncation _MAX_OUTPUT） | 7 fixture → beforeEach 串行 |
| 15 | `test_stream_json_backend.py` | 691 | 29 | `stream-json.test.ts` | 12d/29it | 补漏（multiple_blocks 返回最后一个、factory 3 provider、inheritance） | Readable.from(lines) 模拟 stdout |
| 16 | `test_json_rpc.py` | 1033 | 25 | `json-rpc.test.ts` | 25it（模块级） | 补漏（thread filtering、turn/completed None） | FakeStdin/FakeStdout + spawn mock |
| **合计** | — | **6660** | **~326** | — | **89d/326it** | — | — |

### 表 B：pytest → vitest 构造映射（速查）

| Python 构造 | TS/vitest 构造 | 示例 |
|---|---|---|
| `class TestX:` 顶层 | `describe('X', () => { ... })` | `class TestParseSemver` → `describe('ParseSemver', ...)` |
| `def test_y(self)` | `it('y', () => {})` | `def test_standard` → `it('standard', ...)` |
| `async def test_y` + `@pytest.mark.asyncio` | `it('y', async () => {})` | 无 marker，原生 async |
| `assert a == b` | `expect(a).toBe(b)` | 直接换 |
| `assert x is None` | `expect(x).toBeNull()` | parse_output None 返回 |
| `assert x is not None` | `expect(x).not.toBeNull()` | |
| `assert x in coll` | `expect(coll).toContain(x)` | `"-p" in args` |
| `assert x not in coll` | `expect(coll).not.toContain(x)` | |
| `assert len(x) == n` | `expect(x).toHaveLength(n)` | content array |
| `assert isinstance(x, Cls)` | `expect(x).toBeInstanceOf(Cls)` | |
| `with pytest.raises(Exc, match="re"):` | `expect(() => fn()).toThrow(/re/)` | get_protocol ValueError |
| `with pytest.raises(Exception):` | `expect(() => fn()).toThrow()` | 损坏 JSON |
| `mock.assert_called_once_with(a)` | `expect(fn).toHaveBeenCalledWith(a)` + `expect(fn).toHaveBeenCalledTimes(1)` | |
| `mock.call_count` | `vi.mocked(fn).mock.calls.length` | 心跳次数 |
| `mock.call_args.kwargs['json']` | `vi.mocked(fn).mock.calls[n][0]` 或 `.mock.lastCall` | |
| `@pytest.fixture def f()` | 工厂函数 `function makeF()` + `beforeEach` 调用 | 19 fixture |
| `tmp_path` | `fs.mkdtemp(path.join(os.tmpdir(), 'pre-'))` | 6 文件 |
| `monkeypatch.setattr(mod, 'k', v)` | `vi.spyOn(mod, 'k').mockReturnValue(v)` | |
| `with patch.dict(os.environ, {...})` | `vi.stubEnv('K','v')` + `afterEach(vi.unstubAllEnvs)` | |
| `with patch('m.f', return_value=v)` | `vi.spyOn(m, 'f').mockReturnValue(v)` 或 `vi.mock('m', ...)` | |
| `AsyncMock(return_value=v)` | `vi.fn().mockResolvedValue(v)` | client/daemon |
| `MagicMock(spec=Cls)` | 手写 stub 对象满足接口 | |
| `CliRunner().invoke(cli, [...])` | `program.parse(['node','cli',...], {from:'user'})` + `vi.spyOn(console)` | test_cli |
| `subprocess.run(['git',...])` | `await execa('git', [...])` | workspace fixture |
| `asyncio.create_task(coro)` | `Promise` + 手动 cancel | daemon._fire |
| `asyncio.sleep(0.1)` | `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(100)` | daemon 心跳 |
| `@pytest.mark.parametrize("a,b", [...])` | `it.each([...])('case %s', (a,b)=>{})` | **实测无此构造** |
| `@pytest.mark.skip(reason)` | `it.skip('xxx', ...)` | **实测无此构造** |
| `@pytest.fixture(scope="module")` | 模块级 `const shared = makeShared()` 顶层 | **实测无此构造** |

### 表 C：Mock 策略分类（按被测对象）

| 被测对象 | Mock 目标 | vitest 实现 | 适用文件 |
|---|---|---|---|
| 子进程 spawn | `asyncio.create_subprocess_exec` | `vi.mock('node:child_process')` 返回 `spawn` stub，stdout 用 `Readable.from(lines.split('\n'))` | stream-json / json-rpc / agent-detector |
| HTTP fetch | `httpx.AsyncClient.post` | `vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status, json: async () => body }))` | client / daemon |
| WebSocket | `websockets.connect` | `vi.mock('ws')` 返回 EventEmitter 模拟 + 手动 emit('message'/'close'/'open') | daemon |
| which | `shutil.which` | `vi.mock('node:child_process')` 拦截 `execFileSync('which',...)`，或 task-16 暴露可注入 which | agent-detector |
| 文件存在 | `os.path.isfile` | `vi.spyOn(fs, 'existsSync').mockReturnValue(true)` | agent-detector |
| 环境变量 | `os.environ` | `vi.stubEnv` + `vi.unstubAllEnvs` | agent-detector / credential |
| 进程 kill | `os.kill` | `vi.spyOn(process, 'kill').mockImplementation(() => true)` | cli stop |
| sleep 加速 | `asyncio.sleep` | `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(ms)` | daemon 心跳 / poll |
| platform | `platform.system` | `vi.spyOn(process, 'platform').mockReturnValue('win32')` | agent-detector Windows CMD |

---

## 边界处理

### B1. 跨 mock 污染（核心风险，R-08 承载）

vitest 的 `vi.mock` 是**模块级提升**，影响整个文件所有用例，不像 pytest 的 `with patch:` 上下文受限。

- **规则**：跨用例共享 mock 必须在 `beforeEach` 内用 `vi.spyOn` 显式 reset，`afterEach` 内 `vi.restoreAllMocks()`。
- **禁止**：用 `vi.mock('xxx')` 影响该文件内**不需要该 mock 的用例**——拆分到不同 describe 或不同文件。
- **示例**：daemon.test.ts 内 ws mock 仅影响 `describe('WsLoop')`，不应让 `describe('Init')` 也吃 ws mock。若必须全文件 mock，则在 it 内 `vi.doMock` + 动态 import 隔离。

### B2. tmp_path 跨用例残留

vitest `beforeEach` 建 tmpDir，`afterEach` 必删。

- **规则**：`afterEach(async () => { await fs.rm(tmpDir, { recursive: true, force: true }) })`，用 `force: true` 容忍路径不存在。
- **禁止**：用项目目录或 `/tmp/sillyhub-test` 固定路径（多 it 会冲突）。
- **禁止**：用 `os.tmpdir()` 直接写（污染系统 tmp 根），必须先 `mkdtemp` 建子目录。
- **CI 环境**：若 `afterEach` 删除失败（权限/并发），不阻塞 it 结果，仅 `console.warn`。

### B3. 异步 mock 返回值类型不匹配

Python `AsyncMock(return_value=v)` 自动 await，vitest `vi.fn().mockReturnValue(v)` **不会 await**——调用方拿到的是原始值不是 Promise。

- **规则**：异步函数 mock 必须用 `mockResolvedValue(v)`（返回 Promise<v>），同步函数用 `mockReturnValue(v)`。
- **判别**：被 mock 的函数签名是 `async` 或返回 `Promise<T>` → `mockResolvedValue`；否则 `mockReturnValue`。
- **示例**：`client.register` 是 async → `vi.spyOn(client, 'register').mockResolvedValue(undefined)`，错用 `mockReturnValue(undefined)` 会让调用方 `await undefined` 拿到 undefined 但语义混乱。

### B4. fake timers 与真实 setTimeout 混用

`vi.useFakeTimers()` 后，**所有** setTimeout/setInterval 都被劫持，包括第三方库（如 ws 重连退避）。

- **规则**：使用 fake timers 的 describe 必须 `beforeEach(vi.useFakeTimers)` + `afterEach(vi.useRealTimers)`，**严格配对**。
- **禁止**：在同一 describe 内混合 fake/real timers（用例间切换会乱）。
- **await 推进**：异步代码用 `vi.advanceTimersByTimeAsync(ms)` 而非 `vi.advanceTimersByTime(ms)`（前者会 flush 微任务队列）。
- **跳过真实等待**：禁止 `await new Promise(r => setTimeout(r, 100))` 在 fake timers 下会永久 hang（setTimeout 被 mock 不触发）。

### B5. subprocess mock 的 stdout 行为差异

Python `mock_proc.stdout` 是 async iterable，vitest 模拟用 `Readable.from(lines)`。

- **规则**：spawn mock 返回的 ChildProcess.stdout 必须是 `Readable`，且按行（`\n` 分隔）emit 'data' 事件。
- **行尾换行**：Python `__anext__` 返回不含 `\n` 的 bytes，TS Readable 默认含 `\n`——parse_output 实现需 `trim()` 或 mock 时手动 strip。
- **空 buffer**：Python `_AsyncReader(b"")` yield 一个空 bytes 后停止，TS `Readable.from([])` 直接结束——空输入测试需对齐两端行为。

### B6. fixture 依赖链顺序（test_task_runner 7 fixture）

Python fixture 自动按参数依赖解析，vitest `beforeEach` 是**顺序执行**的同步块，需手动排依赖。

- **顺序**：base_dir → workspace_base / cred_path → workspace_manager / credential_manager → runner。
- **错误**：若 `runner` 依赖 `credential_manager` 但 `beforeEach` 内 `credential_manager` 在 `runner` 之后创建 → ReferenceError。
- **方案**：在 `beforeEach` 内用临时变量串行建，最后赋值给 describe 级 `let` 变量；或拆成多个 `beforeEach`（vitest 按注册顺序执行）。

### B7. 大文件单测超时（json_rpc 1033 行 25 用例）

vitest 默认 it 超时 5000ms，子进程 mock + 多次握手可能逼近。

- **规则**：复杂 it 单独 `it('xxx', () => {...}, 10000)` 提高超时。
- **全局兜底**：`vitest.config.ts` 内 `testTimeout: 10000`（task-04 已配，核对）。
- **CI 慢机器**：若 CI 跑 `pnpm test` 总时长 > 60s，考虑拆分到多个文件并行（vitest 默认 worker 池）。

### B8. 同名 stub 跨 describe 残留（vi.stubGlobal）

`vi.stubGlobal('fetch', mockFn)` 不在 `afterEach` 内 unstub，会污染后续 describe。

- **规则**：每次 `vi.stubGlobal` 必须配对 `afterEach(() => vi.unstubAllGlobals())`。
- **替代**：优先用 `vi.spyOn(globalThis, 'fetch')` 而非 `stubGlobal`，spyOn 在 `restoreAllMocks` 时自动还原。

---

## 非目标

- **不**追求测试代码行数 1:1（design.md §10 R-08 明确：只求行为覆盖 1:1，vitest 用更少行数达成同等断言）。
- **不**新增 Python 原本没有的测试用例（如性能测试、压力测试、E2E 跨进程测试）。
- **不**迁移 Python 测试基础设施（conftest.py、pytest.ini、pytest-asyncio 配置）——这些在 vitest.config.ts（task-04）已替代。
- **不**重写 task-14 已落地的 `version.test.ts`（仅核对全绿，不重建）。
- **不**实现 task-23 真实后端冒烟（本任务是单测，task-23 才拉真实子进程）。
- **不**修复被测源码 bug——发现源码缺陷仅记录到 task-22 输出，不在本任务范围内改 src。
- **不**做覆盖率门槛（lcov/istanbul）——覆盖率统计留给 task-23 验收，本任务只保证用例数对齐。
- **不**迁移 Python 的 `conftest.py` 共享 fixture（实测无 conftest.py，16 文件各自独立 fixture）。

---

## 参考

- **Python 源**：`sillyhub-daemon/tests/test_*.py` 全部 16 文件（6660 行 / ~326 用例）
- **测试策略文档**：`.sillyspec/docs/sillyhub-daemon/scan/TESTING.md`（pytest mock 策略 + 16 文件覆盖范围）
- **设计文档**：`.sillyspec/changes/2026-06-13-daemon-nodejs-rewrite/design.md`
  - §6 文件变更清单：明确「新增 tests/**/*.test.ts 1:1 迁移 16 个 Python 测试文件」
  - §10 R-08：「vitest 与 pytest 用例语义不对齐 | P2 | 逐用例核对断言，fixture 文本样本共用，不追求代码行数 1:1，只求行为覆盖 1:1」
- **前置 task 蓝图**（依赖与去重核对来源）：
  - `tasks/task-04.md`（vitest.config.ts + tests/ 目录结构）
  - `tasks/task-06.md` ~ `tasks/task-10.md`（5 个 adapter 已落部分用例）
  - `tasks/task-11.md`（backends-init 工厂测试）
  - `tasks/task-14.md`（version.test.ts 全量 24 用例）
  - `tasks/task-15.md`（credential + workspace）
  - `tasks/task-16.md`（agent-detector 52 用例大头）
  - `tasks/task-17.md`（client 16 用例）
  - `tasks/task-19.md`（task-runner + provider-dispatch）
  - `tasks/task-20.md`（daemon + multi-runtime）
  - `tasks/task-21.md`（cli 蓝图，PID/LOG 路径注入协调）
- **格式参考**：`tasks/task-14.md`（frontmatter + 修改文件表 + 实现要求 R1/R2/... 的结构）
- **vitest 文档**：`describe`/`it`/`beforeEach`/`vi.mock`/`vi.spyOn`/`vi.useFakeTimers`/`expect` 匹配器（外部标准）

---

## TDD 步骤

> 本任务性质特殊：**Python 源本身就是「规格」**（已存在的测试用例），TS 测试是「实现」。TDD 红-绿循环体现在「先写 TS 用例（红，因 src 已实现但 TS 测试可能因 mock 不全而红）→ 修 mock（绿）」。

### Step 1. 核对 task-04 基础设施（5 min）

- 确认 `sillyhub-daemon/vitest.config.ts` 存在，含 `testTimeout: 10000`、`include: ['tests/**/*.test.ts']`、`environment: 'node'`。
- 确认 `sillyhub-daemon/tests/` 目录存在，`tests/helpers.ts` 若不存在则新建（makeTmpDir/cleanupDir）。
- 跑 `cd sillyhub-daemon && pnpm test` 确认基线（task-14 落的 version.test.ts 应全绿）。

### Step 2. 低复杂度文件先行（纯函数 + 模块级断言，~1.5h）

按依赖最少顺序迁移：

1. `text.test.ts`（14it，纯 parse_line，无 mock）— 补 task-10 漏的用例。
2. `backends-init.test.ts`（11it，模块级静态导出断言，无 mock）— 补 task-11 漏的用例。
3. `version.test.ts`（24it）— **仅核对 task-14 全绿，不重建**。

**验收**：`pnpm test text backends-init version` 全绿。

### Step 3. 单 mock 文件（~1.5h）

4. `credential.test.ts`（26it，fs + chmod + env）— 补 task-15 漏的用例。
5. `workspace.test.ts`（17it，真实 git subprocess fixture）— 补 task-15 漏的用例。
6. `cli.test.ts`（10it，commander + console spy）— **全量迁移**（无前置）。

**验收**：`pnpm test credential workspace cli` 全绿。

### Step 4. HTTP/WebSocket mock 文件（~2h）

7. `client.test.ts`（16it，global.fetch mock）— 补 task-17 漏的用例。
8. `daemon.test.ts`（26it，fake timers + ws mock）— 补 task-20 漏的用例（heartbeat_survives_errors、ws_reconnects_on_failure 是重难点）。
9. `daemon-multi-runtime.test.ts`（11it，模块级 + detector spy）— 补 task-20 漏的用例。

**验收**：`pnpm test client daemon` 全绿（含 fake timers 严格配对）。

### Step 5. 子进程 mock adapter 文件（~2h，大头）

10. `stream-json.test.ts`（29it，Readable stdout mock）— 补 task-06 漏的用例。
11. `json-rpc.test.ts`（25it，FakeStdin/FakeStdout + spawn mock）— 补 task-07 漏的用例。
12. `jsonl.test.ts`（28it，parse_output_multi 字面量）— 补 task-08 漏的用例。
13. `ndjson.test.ts`（25it，parse_output_multi 字面量）— 补 task-09 漏的用例。

**验收**：`pnpm test stream-json json-rpc jsonl ndjson` 全绿。

### Step 6. 编排层与 detector（~1h）

14. `task-runner.test.ts`（25it，7 fixture → beforeEach 串行）— 补 task-19 漏的用例。
15. `task-runner-provider-dispatch.test.ts`（13it，getBackend vi.mock）— 补 task-19 漏的用例。
16. `agent-detector.test.ts`（52it，task-16 大头已落）— 核对全绿，补漏。

**验收**：`pnpm test task-runner agent-detector` 全绿。

### Step 7. 全量回归 + 清单核对（~30min）

- 跑 `cd sillyhub-daemon && pnpm test` 全量（16 文件 ~326 用例全绿）。
- 对照 Python 源逐一核对用例数：每个 `.test.ts` 的 it 数 ≥ 对应 Python 文件的 def test 数。
- 检查 `afterEach` 清理（tmpDir 删除、mock restore、env unstub、timers 还原）。
- 提交前跑 `pnpm lint`（若 task-04 配了 eslint on tests/）。

---

## 验收标准

| ID | 验收项 | 验证方法 | 通过标准 |
|---|---|---|---|
| AC-01 | 16 个 `.test.ts` 文件全部存在 | `ls sillyhub-daemon/tests/*.test.ts \| wc -l` | 输出 `16`（version/text/backends-init/credential/workspace/cli/client/daemon/daemon-multi-runtime/stream-json/json-rpc/jsonl/ndjson/task-runner/task-runner-provider-dispatch/agent-detector） |
| AC-02 | 用例数对齐（行为覆盖 1:1） | 每个 `.test.ts` 内 `grep -c "it(" 文件` 与 Python 源 `grep -c "def test_" 文件` 对比 | 每个 TS 文件的 it 数 ≥ Python 源的 def test 数（允许 TS 拆分更多 it，不允许少于） |
| AC-03 | 全量测试全绿 | `cd sillyhub-daemon && pnpm test 2>&1 \| tail -5` | 末行含 `Test Files  16 passed` 且 `Tests  ~326 passed`，0 failed |
| AC-04 | Mock 隔离无污染 | 每个 describe 检查 `beforeEach`/`afterEach` 配对 | 所有用到 `vi.mock`/`vi.spyOn`/`vi.stubGlobal`/`vi.useFakeTimers`/`vi.stubEnv` 的 describe，`afterEach` 内均有对应 restore/unstub/unstubAllEnvs/useRealTimers |
| AC-05 | tmpDir 清理 | 测试跑完后 `ls /tmp/sillyhub-test-* 2>/dev/null \| wc -l` | 输出 `0`（无残留临时目录） |
| AC-06 | 单文件总时长 < 30s | `pnpm test -- --reporter=verbose 2>&1 \| grep "Duration"` | 整套测试总时长 < 60s，单文件 < 30s（fake timers 加速生效，无真实 sleep） |

---

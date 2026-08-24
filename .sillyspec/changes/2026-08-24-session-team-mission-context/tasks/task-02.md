---
id: task-02
title: '非 git 三态探测 helper——delegate.py probe_workspace_git_mode（非降级通道 stat 绝对路径 .git；异常/未绑→unknown）'
title_zh: '非 git 三态探测 helper——delegate.py probe_workspace_git_mode（非降级通道 stat 绝对路径 .git；异常/未绑→unknown）'
author: 'qinyi'
created_at: 2026-08-24 18:47:00
priority: P0
depends_on: []
blocks: [task-03, task-05, task-10]
requirement_ids: [FR-04]
decision_ids: [D-006@v2]
allowed_paths:
  - backend/app/modules/daemon/host_fs/delegate.py
  - backend/app/modules/daemon/host_fs/tests/test_delegate_probe.py
provides:
  - contract: probe_workspace_git_mode
    file: backend/app/modules/daemon/host_fs/delegate.py
    fields: [probe_workspace_git_mode]
    returns: git | direct | unknown
    consumers: [task-03, task-05, task-10]
goal: >
  HostFsDelegate 新增三态探测方法 probe_workspace_git_mode——经非降级 RPC 通道（_via_rpc :657）
  对工作区根下 .git 发 host_fs.stat（绝对路径），映射 git / direct / unknown 三态，为 dispatch_worker
  分流（task-05）、mission_status（task-03）与 probe 端点（task-10）提供统一 git 模式判定口径
  （FR-04 / D-006@v2，design §5.D）。
implementation:
  - delegate.py HostFsDelegate 类新增 async 方法 probe_workspace_git_mode(workspace) -> str——构造探测路径 resolve_root_path_for_daemon(workspace.root_path) 再拼接 /.git（定义见 app/modules/workspace/service.py:75；如遇循环导入改函数内延迟 import）
  - 经 _via_rpc 非降级通道（:657）发送 method=stat、args 的 path=上述绝对路径——不走 _via_rpc_or_degrade（:730 静默降级无法区分三态）
  - 结果映射——daemon 真答 exists=True 返回 git（.git 为目录或文件均可，worktree 检出为文件时 lstat 语义仍可用）；真答 exists=False 返回 direct
  - 异常兜底——_RPC_DEGRADED_EXC 四成员（DaemonRuntimeOffline / DaemonRpcTimeout / DaemonRpcRemoteError / DaemonRpcConflict，超时含内）与 HostFsDelegateUnavailable（ws_rpc 未接线或 daemon_id_resolver 返回 None 未绑 daemon）一律捕获并 log.warning（仿 host_fs_rpc_failed 通道）归 unknown，不向 caller 抛
  - 新增 backend/app/modules/daemon/host_fs/tests/test_delegate_probe.py——仿 test_delegate.py 的 _MockWsRpc 脚本化 send_rpc，覆盖 exists True/False 两真答、send_rpc 抛 DaemonRpcTimeout、ws_rpc=None 与 daemon_id_resolver 返回 None 两路 unavailable 全部归 unknown；断言 mock 记录的 args path 为 resolve_root_path_for_daemon 改写后的绝对 /.git 路径（monkeypatch settings 覆盖容器→宿主前缀改写与未配置前缀原样各一例）
acceptance:
  - daemon 真答 exists=True 返回 git；真答 exists=False 返回 direct
  - transport 异常（至少覆盖 DaemonRpcTimeout）与 HostFsDelegateUnavailable（ws_rpc=None / daemon_id_resolver 返回 None 两路）返回 unknown 且不抛出
  - 发送的 stat path 为 resolve_root_path_for_daemon(workspace.root_path) 拼接 /.git 的绝对路径（mock calls 断言，含前缀改写与未配置前缀两场景）
  - 返回值限定 git / direct / unknown 三态字符串；既有 9 方法与 _via_rpc / _via_rpc_or_degrade 行为零改动，host_fs 既有测试全绿
verify:
  - cd backend && uv run pytest app/modules/daemon/host_fs/tests/test_delegate_probe.py -q
  - cd backend && uv run pytest app/modules/daemon/host_fs/tests -q
  - cd backend && uv run ruff check app/modules/daemon/host_fs/delegate.py && uv run mypy app/modules/daemon/host_fs/delegate.py
constraints:
  - 不走 _via_rpc_or_degrade（静默降级会把故障误判 direct）——用 _via_rpc 同族非降级通道，异常在本方法内捕获归 unknown
  - stat 必须传绝对路径 resolve_root_path_for_daemon(ws.root_path) 拼接 /.git——daemon 侧 assertWithinAllowedRoots 先于 pathResolve（host-fs-handler.ts:455-457），相对路径会解析到 daemon 进程 cwd 必被拒（CC-06 / R-05）
  - unknown 只报状态不决策——consumer（task-05 execution 分流）对 unknown 维持现状 worktree 路径，本方法不得自行降级直通
  - 不新增异常类型、不改既有 9 方法签名（design §5.1 契约面锁死）；send_rpc 走默认 30s 传输预算，不透传自定义 timeout
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->

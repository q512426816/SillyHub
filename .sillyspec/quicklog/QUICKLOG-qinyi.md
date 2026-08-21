
## ql-20260821-022-e17a | 2026-08-21 18:25:33 | 审查并修正 daemon 缓存清理功能的缺陷/性能/质量/垃圾代码/注释/文档问题
状态：已完成
关联变更：（无）
文件：
- docs/qa/2026-08-21-daemon-cleanup-code-review.md（审查发现 20 项编号清单+已排除项结论）
- sillyhub-daemon/src/cleanup.ts（移除 outbox/runs 清理目标+删 listAllFiles 死代码+黑名单注释）
- sillyhub-daemon/src/daemon.ts（CLEANUP 活跃会话跳过+in-flight 守卫+静态导入）
- backend/app/modules/daemon/tests/test_machines_router.py（补 cleanup 端点路由/504/越权/不存在 4 测）
- frontend/src/app/(dashboard)/runtimes/page.tsx（清理按钮 modal.confirm 二次确认）
- backend/openapi.json（dump_openapi 再生成含 cleanup 端点）
- frontend/src/lib/api-types.ts（gen:types 再生成）
需求：审查并修正 daemon 缓存清理功能的缺陷/性能/质量/垃圾代码/注释/文档问题
根因：原实现 CLEANABLE_DIRS 含 outbox（断线补发队列，删=丢未投递消息）与 runs（活跃任务终端日志，与既有 7 天保留期机制冲突）；handler 无活跃会话守卫与并发护栏；前端破坏性操作无二次确认；清理按钮与端点零测试；七处保留注释用白名单口吻描述黑名单实现；六份模块文档与 openapi/api-types 落后；另有 inject 5 参断言既有测试债
方案：cleanup.ts 黑名单移除 outbox/runs+删 listAllFiles 死代码+注释改准确语义；daemon.ts CLEANUP 加 _interactiveSessionsByLease 跳过+_cleanupInFlight 守卫+DEFAULT_CONFIG_DIR 静态导入；cli.ts cleanAction 静态导入；前端 handleCleanup 加 modal.confirm；补后端 cleanup 端点 4 测+前端清理按钮 2 测+cleanup.test 保留断言反转；同步 protocol/daemon/cli/lib-daemon/SillyHub-daemon 五份模块文档+新建 cleanup.md+module-map；dump_openapi+gen:types 再生成；顺手修 kind-dispatch/session-switch 两处 inject 断言为 5 参；全部发现与结论落 docs/qa/2026-08-21-daemon-cleanup-code-review.md（20 项编号清单）
结果：daemon vitest 全量 2481 passed/9 skipped、typecheck 干净；backend daemon 模块 pytest 843 passed、ruff format+check 干净；前端 machine-card 11 passed、tsc --noEmit 干净、eslint 0 error（21 条预存 warning 不在改动行）；openapi 379 paths 含新 cleanup 端点

## ql-20260821-023-5d9a | 2026-08-21 20:29:38 | 修复 CI 红灯：backend-ci ruff I001 挡住全部后端测试 + daemon-ci 20 个失败测试（UNC 路径 Linux 失效 / 测试…
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/session_attachment/tests/test_capability.py（ruff --fix 修 I001 import 排序）
- sillyhub-daemon/src/policy/path-utils.ts（UNC 判定提前到平台 resolve 前（字符串级，\ 与 // 两形态））
- sillyhub-daemon/tests/helpers.ts（新增 winPath() Windows 路径字面量平台适配 helper）
- sillyhub-daemon/tests/permission-rules.test.ts（去重测试改用不与 tmpdir() 撞车的路径）
- sillyhub-daemon/tests/interactive/session-manager-allowed-roots.test.ts（C:\ 字面量 winPath 包裹）
- sillyhub-daemon/tests/interactive/session-manager-borrow-sandbox.test.ts（常量+模板 join 平台适配）
- sillyhub-daemon/tests/interactive/session-manager-profile.test.ts（C:\ 字面量 winPath 包裹）
- sillyhub-daemon/tests/daemon-kind-dispatch.test.ts（inject 断言补全 5 参）
- sillyhub-daemon/tests/daemon-session-switch-config.test.ts（inject 断言补全 5 参）
- .sillyspec/docs/sillyhub-daemon/modules/policy.md（同步 UNC 判定跨平台描述）
需求：修复 CI 红灯：backend-ci ruff I001 挡住全部后端测试 + daemon-ci 20 个失败测试（UNC 路径 Linux 失效 / 测试硬编码 Windows 路径 / inject 断言滞后）
根因：backend 是 05:19 会话 reopen 提交带入 import 排序违规且 lint 先于测试执行导致全量被挡；daemon 从未在 Linux 上跑过——UNC 判定依赖 Windows pathResolve 归一（POSIX 把 \host\share 折叠成 cwd 相对名，startsWith 恒 false），三个 session-manager 测试硬编码 C:\ 字面量（POSIX 上是单个相对文件名，白名单前缀比较恒 false），Linux tmpdir()=/tmp 与 permission-rules 去重测试撞车，两个 inject 断言停在 3 参而实现已 5 参
方案：path-utils normalizePath 对 UNC（\ 与 // 两形态）字符串级直通不 resolve，resolveRealPath 前置拒绝跨平台成立；tests/helpers.ts 新增 winPath()（POSIX 映射 C:\x → /c/x），三个 session-manager 测试 + permission-rules 去重测试平台适配；kind-dispatch/session-switch-config inject 断言补全 5 参；backend test_capability.py ruff --fix 修 import 排序；policy.md 同步 UNC 判定描述
结果：backend ruff 全仓通过 + pytest 4771 通过；daemon Windows typecheck 通过 + 受影响 8 文件 169 测试全绿；WSL Ubuntu 用 git HEAD+本批 8 文件模拟推送树全量 2480/2482（仅 BUILD_ID×2 为模拟目录无 git 元数据的预期 fallback，CI 完整 checkout 不受影响）

## ql-20260821-024-e7c1 | 2026-08-21 21:10:38 | backend-ci 第二层修复：ruff format 3 文件格式漂移 + mypy 过期 type:ignore
状态：已完成
关联变更：（无）
文件：backend/app/modules/session_attachment/capability.py, backend/app/modules/session_attachment/tests/test_capability.py, backend/app/modules/daemon/session/service.py, backend/migrations/versions/20260820100000_session_attachments_multimodal.py
需求：backend-ci 第二层修复：ruff format 3 文件格式漂移 + mypy 过期 type:ignore
根因：05:19-06:35 间提交带入格式漂移与过期 ignore，此前被更早失败的 ruff check（I001）挡住未暴露，lint 修复后 CI 推进到 format/mypy 步骤才显形
方案：ruff format 全仓（3 文件纯空白/注释对齐/行合并重排，语义不变）；test_capability.py 移除 supports_multimodal_by_model_name 已放宽签名（str|None）下的过期 arg-type ignore
结果：本地复刻 CI 全链通过：ruff check 全仓 0 错 + ruff format --check 925 文件通过 + mypy app 675 文件零错误 + session_attachment pytest 4 通过

---
id: task-02
title: 'apply_ops empty-dir cleanup + revive interception + landing exclusion'
title_zh: 'apply_ops 空目录清理 + platform_deleted 拦截（add/rename 拒、delete 放行）+ _write_spec_root 落盘级前缀排除'
author: 'qinyi'
created_at: 2026-08-29 12:57:58
priority: P0
depends_on: ['task-01']
blocks: ['task-03', 'task-06']
requirement_ids: [FR-02, FR-04]
decision_ids: [D-005@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/spec_workspace/service.py
  - backend/app/modules/spec_workspace/tests/test_platform_deleted_guard.py
provides:
  - contract: platform_deleted 拦截基建
    fields: ['spec_file_manifest.platform_deleted 列 + apply_ops/_write_spec_root 拦截已落；本任务只写标记，不重复实现拦截']
goal: >
  apply_ops delete 后清理 ops 涉及的空目录（幽灵目录修复 FR-02）、拦截 add/rename 对
  platform_deleted 墓碑的复活（delete op 幂等放行），并在 _write_spec_root 落盘集计算
  阶段按 changes/ 前缀排除已平台删除目录（B-2 加固），堵死四复活通道中的 1/2/3。
implementation:
  - apply_ops delete 分支（service.py:1472-1490，_move_op_file 软删 + manifest 墓碑之后）：对本次 ops 涉及目录（delete 的 op.path 与 rename 的源/目标路径的父目录链）自底向上 rmdir 空目录——目录空则删、非空即停、OSError 忽略，复用 _converge_stale_files（:1249-1261）的 os.walk(topdown=False) + os.listdir 实时探空范式；仅触碰 ops 涉及目录链，禁止 rglob 整树（R-03）；FS 段照 _move_op_file（:1186-1190）入 asyncio.to_thread
  - apply_ops add 复活拦截（通道 1）：现软删行复活分支（:1404-1420）加判 row.platform_deleted=True → 不写盘、不翻 exists，置 conflict=True 并收集 server_versions[op.path]=row.version，同时把 op.path 记入返回值新增键 platform_deleted（list[str]，design §11 让 CLI 可感知被拒路径）
  - apply_ops rename 目标命中墓碑（通道 2）：目标占用判断处（:1505-1511 target_row 判断旁）对 target_row.platform_deleted=True 同样拒绝（conflict=True + server_versions + platform_deleted 项，不落盘不复活）
  - delete op 放行：platform_deleted=True 行上的 delete op 维持既有幂等软删路径（version+1、exists=False、move FileNotFoundError 容错），不新增拦截（愈合方向，design §5.4 加固项）
  - _write_spec_root 落盘集计算阶段（B-2，通道 3）：成员循环（:815-855）landed_paths.add(rel_path) 之前，先查 workspace manifest 中 platform_deleted=True 的行并推导被删目录前缀集（活跃区 changes/{name}/，归档区 changes/archive/{name}/ 同理取三段）；成员 rel_path 命中任一前缀 → continue 跳过（不 move、不入 landed_paths/landed_hashes，文件留 staging 随 finally rmtree 消失）；对齐环（:982-999）因此不触达这些行，继续维持墓碑（前缀探测优先于逐路径精确匹配，闭合成员新增未见路径的 P2 边角）
  - 新建 backend/app/modules/spec_workspace/tests/test_platform_deleted_guard.py 覆盖 design §13 对应项：① delete 后 ops 涉及空目录从磁盘消失、非涉及目录不动；② add 命中 platform_deleted 行返回 conflict=True + platform_deleted 项含该路径 + 文件未落盘 + 行未翻回 exists=True；③ rename 目标命中墓碑同断言；④ delete op 在墓碑行上幂等成功；⑤ daemon 全量回退（_write_spec_root 收到含已删变更目录文件的 tar）→ 该前缀文件不落盘、manifest 行不回翻
acceptance:
  - apply_ops delete 清空目录后，ops 涉及目录在磁盘上消失，非 ops 涉及目录零触碰（FR-02 幽灵目录修复）
  - add/rename 命中 platform_deleted=True 行：响应 conflict=True 且 platform_deleted 列表含被拒路径，文件未落盘、行保持 exists=False 与 platform_deleted=True（通道 1/2 拦截）
  - delete op 命中 platform_deleted=True 行幂等放行：无异常、version+1、exists=False 维持
  - _write_spec_root 全量回退含已删前缀文件：spec_root 无该目录、文件未落盘、对齐环不重置 exists/不触碰 platform_deleted（B-2，R-10 缓解）
  - 未删除任何变更时 apply_ops 与 _write_spec_root 行为与现状一致（platform_deleted 全 FALSE 走原路径），spec_workspace 既有测试零回归
verify:
  - cd backend && uv run pytest app/modules/spec_workspace/tests/test_platform_deleted_guard.py -q
  - cd backend && uv run pytest app/modules/spec_workspace/tests/test_sync_incremental.py app/modules/spec_workspace/tests/test_full_sync_convergence.py -q
constraints:
  - 空目录清理仅 ops 涉及目录、自底向上、非空即停；禁止整树扫描/rglob（Windows bind mount stat 断崖，R-03）
  - 只拦 add/rename 复活方向，delete op 语义不变（幂等放行，design §5.4）
  - 不动 _ensure_change_row（通道 4 归 task-04）、不动 scoped 删除环（task-03）、不自造 soft_delete_change_dir（task-06）
  - 不做 UI；platform_deleted 键仅加入 apply_ops 既有返回 dict，不改端点签名
  - 遵守 CLAUDE.md 规则 0：只跑 spec_workspace 模块相关测试，全量留 CI
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

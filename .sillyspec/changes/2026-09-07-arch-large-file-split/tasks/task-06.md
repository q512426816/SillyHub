---
id: task-06
title: 'Wave2 前置对账——import 语句 + patch 字符串目标两类清单生成（R-04 对账基线 + D-007 延迟解析白名单）'
title_zh: 'Wave2 前置对账——import 语句 + patch 字符串目标两类清单生成（R-04 对账基线 + D-007 延迟解析白名单）'
author: 'qinyi'
created_at: 2026-09-07 08:48:02
priority: P0
low_risk: true
depends_on: ['task-05']
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-007@v1]
allowed_paths:
  - .sillyspec/changes/2026-09-07-arch-large-file-split/backend-split-baseline.md
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/group/service.py
  - backend/app/modules/daemon/run_sync/service.py
goal: >
  Wave2 backend 拆包前的对账基线——用 grep 实测生成跨文件 import 符号清单与 patch 字符串目标清单两类基线，
  落实 R-04 防导出面遗漏与 D-007 延迟解析白名单，供 task-07~task-10 拆包时逐项核对。
implementation:
  - 跑 grep -rn "session.service import\|run_sync.service import\|group.service import\|daemon.router import" backend/app --include=*.py 生成 import 符号清单并逐条登记消费方
  - 逐一确认 6 个跨文件私有符号消费点——_apply_session_terminal_status 与 _send_session_end_best_effort（run_sync/service.py 顶部导入）、_merge_lease_metadata（agent/mcp_tools.py、agent/worker_redispatch.py、group/service.py）、_resolve_daemon_id_for_runtime（lease_service.py、permission_service.py、lease/provider_switch.py、platform_sync/router.py）、_split_group_chain_marker 与 _prepend_group_chain_marker（daemon/tests/test_group_direct.py）
  - 跑 grep -rn "patch(\"app.modules.daemon" backend/app --include=*.py 生成 patch 字符串目标全量清单，按四模块分组登记
  - 对清单中每个被 patch 符号标注延迟解析要求——子模块内不得 from 原点直接导入后调用，须 import 原模块为别名并经命名空间访问（D-007 白名单）
  - 将两类清单与白名单写入 changeDir 下 backend-split-baseline.md，标注 grep 实测计数供 task-12 验收复核
acceptance:
  - backend-split-baseline.md 落盘于本 changeDir，含 import 符号清单、patch 目标清单、D-007 延迟解析白名单三个章节
  - import 清单与 grep 实测一致——session.service 74 处、run_sync.service 42 处、group.service 24 处、daemon.router 27 处
  - patch 清单与 grep 实测一致——四模块合计 157 处（session.service 69、run_sync.service 45、group.service 33、router 10）并逐处标注模块归属
  - 6 个私有符号全部定位到具体消费文件与行号并写入清单，作为 __init__.py 聚合导出的保底项
  - D-007 白名单覆盖全部被 patch 符号，无遗漏命名空间绑定项
  - 四个 backend 源文件零改动（git diff 为空），唯一新增产物为 baseline 文档
verify:
  - grep -rn "session.service import\|run_sync.service import\|group.service import\|daemon.router import" backend/app --include=*.py
  - grep -rn "patch(\"app.modules.daemon" backend/app --include=*.py
  - git diff --stat -- backend/app
constraints:
  - 只读对账——四个 backend 源文件零修改，唯一产出是 baseline 文档
  - 清单计数必须以本卡 grep 实测为准，与 design.md 数字有出入时以实测为准并在文档中标注差异
  - 本卡不跑测试、不改测试、不动 backend 任何代码
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

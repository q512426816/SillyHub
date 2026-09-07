---
id: task-08
title: 'Wave2 拆分 session/service.py → session/service/ 14 文件包（6 私有符号 + patch 命名空间规则）'
title_zh: 'Wave2 拆分 session/service.py → session/service/ 14 文件包（6 私有符号 + patch 命名空间规则）'
author: 'qinyi'
created_at: 2026-09-07 08:48:02
priority: P0
depends_on: ['task-06']
blocks: []
requirement_ids: [FR-02, FR-04]
decision_ids: [D-007@v1, D-005@v3]
allowed_paths:
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/session/service/__init__.py
  - backend/app/modules/daemon/session/service/errors.py
  - backend/app/modules/daemon/session/service/results.py
  - backend/app/modules/daemon/session/service/helpers.py
  - backend/app/modules/daemon/session/service/create.py
  - backend/app/modules/daemon/session/service/attachments.py
  - backend/app/modules/daemon/session/service/ppm_activation.py
  - backend/app/modules/daemon/session/service/inject.py
  - backend/app/modules/daemon/session/service/inject_gates.py
  - backend/app/modules/daemon/session/service/queue.py
  - backend/app/modules/daemon/session/service/control.py
  - backend/app/modules/daemon/session/service/recovery.py
  - backend/app/modules/daemon/session/service/read_model.py
  - backend/app/modules/daemon/session/service/session_lifecycle.py
goal: >
  把 7176 行的 session/service.py 拆为 session/service/ 14 文件包，__init__.py 聚合导出 ⊇ 被外部引用符号集
  （含 6 个私有符号），69 处 patch 目标零失效，SessionService 类壳一行委托，既有测试零修改通过。
implementation:
  - 纯搬移层先行——errors.py（24 个 AppError 子类）/results.py（结果对象族 + get_session_readiness）/helpers.py（模块级 helper 与 group chain marker）原样落包；queue/control/recovery/read_model/session_lifecycle 方法体随后下沉，SessionService 类壳在 __init__.py 保留同名方法一行委托，公共签名不变
  - create.py 将 create_session 1055 行拆为分步函数（校验/绑定/workspace/入队/派发），attachments/ppm_activation/inject/inject_gates 四簇随后落包
  - __init__.py 聚合导出 ⊇ task-06 清单符号集——6 个私有符号 _apply_session_terminal_status/_send_session_end_best_effort/_merge_lease_metadata/_resolve_daemon_id_for_runtime/_split_group_chain_marker/_prepend_group_chain_marker + 全部公共符号（TERMINAL_TURN_STATUSES 等）
  - 被白名单符号（69 处 session.service patch 目标，以 task-06 白名单为准）在子模块统一 import app.modules.daemon.session.service as _svc 后调用 _svc.<符号> 延迟解析，__init__.py 顶部保持原绑定
acceptance:
  - task-06 两类清单逐项对账通过——from app.modules.daemon.session.service import 全部语句原样工作，含 run_sync/service.py 47 行对 _apply_session_terminal_status 与 _send_session_end_best_effort 的导入
  - 69 处 patch("app.modules.daemon.session.service.<sym>") 目标零失效，既有测试文件内容零修改通过
  - SessionService 公共方法签名逐一不变，方法体只做搬移 + this 状态显式传参；目标文件 session/service.py 删除后被同名包替代，导入路径零变化
  - 14 个子模块全部 ≤800 行（D-005@v3）
verify:
  - cd backend && uv run ruff check app/modules/daemon/session
  - cd backend && uv run pytest app/modules/daemon/tests -q -k "session" --no-cov -n auto
constraints:
  - 不改方法行为/异常文案/日志格式——方法体下沉只做搬移 + this 状态显式传参
  - patch 目标零失效（按 task-06 白名单）——被白名单符号禁止 from 原点 import 后调用，一律经原模块命名空间延迟解析
  - 既有测试零修改——需改测试才能通过即判定兼容层设计失败，回炉而非改测试
  - 不碰在途 4 个 backend 文件（protocol.py / runtime/service.py / ws_hub.py / lease/context.py），git diff 为空
  - 每搬一簇跑定向测试全绿再搬下一簇，不为行数目标顺手改逻辑
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

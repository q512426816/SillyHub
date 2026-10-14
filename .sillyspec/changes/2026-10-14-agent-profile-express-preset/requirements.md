---
author: flow-machine-draft
created_at: 2026-10-14T02:38:51.950Z
---
# 需求规格（Requirements）— 2026-10-14-agent-profile-express-preset

## 功能需求

### FR-01: 平台预置「SillySpec 极速变更」档案定义

- `backend/app/modules/agent/profile/seed.py` **必须**以确定性 uuid5 id（`uuid5(NAMESPACE_OID, "sillyhub.agent.presets", "sillyspec-express-change")`）定义一个平台预置档案：name=「SillySpec 极速变更」、provider="claude"、visibility=platform、is_system_default=False、version=1、owner_user_id=None、workspace_id=None；其 system_prompt **必须**完整编码 SillySpec 轻量变更极速通道协议（规模定级与拒绝降级、`flow start` 立项含逐行成功标准、干活顺序、`flow done` 收口、`--change` 隔离纪律、非 SillySpec 仓库豁免）。

#### 场景：主路径

- Given 空库，When 调用补种函数一次，Then 库内出现恰一条该确定性 id 的档案行，且上述身份字段与 system_prompt 逐项命中。

### FR-02: 幂等补种

- **必须**提供 `ensure_sillyspec_express_profile(session: AsyncSession) -> int`：目标 id 行缺失时补种、内部 commit 并返回 1；已存在时返回 0。任意重复调用后，库内该确定性 id 行**必须**恒为恰 1 条（无重复行）。

#### 场景：主路径

- Given 首次补种完成，When 重复调用 1~3 次，Then 每次返回 0 且总行数不变。

### FR-03: 不覆盖用户改动

- 该档案行已存在（无论 name/system_prompt 等字段被管理员改成什么）时，补种函数**禁止**回写、覆盖或重置该行任何字段，**必须**跳过（返回 0）。

#### 场景：主路径

- Given 管理员已把该档案的 system_prompt 改为自定义文案，When 再次调用补种函数，Then 返回 0 且自定义文案原样保留。

### FR-04: 启动序列挂载

- `backend/app/main.py` lifespan 启动序列**必须**在同一 seed try 块内（既有两个 ensure 之后）调用 `ensure_sillyspec_express_profile`，补种时打 structlog warning；该调用异常**不得**阻断启动（由既有 `except Exception: log.exception` 兜底，与既有两 ensure 同语义）。

#### 场景：主路径

- Given lifespan 启动，When seed try 块执行，Then 新 ensure 被调用且其失败仅记日志、服务继续启动。

### FR-05: 测试契约

- `backend/app/modules/agent/tests/test_profile_seed.py` **必须**新增用例覆盖 FR-01（字段身份）、FR-02（幂等）、FR-03（不覆盖）、与既有平台默认档案共存互不干扰四个契约，且该文件既有用例**必须**全部保持通过。

#### 场景：主路径

- Given 修改完成，When 运行 `uv run pytest app/modules/agent/tests/test_profile_seed.py`，Then 全部用例（新增 + 既有）通过。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/agent/tests/test_profile_seed.py「test_express_preset_plants_platform_profile_with_identity_fields」
FR-02: backend/app/modules/agent/tests/test_profile_seed.py「test_express_preset_idempotent_on_repeat_calls」
FR-03: backend/app/modules/agent/tests/test_profile_seed.py「test_express_preset_does_not_overwrite_user_edits」
FR-04: 不适用：main.lifespan 启动序列在仓库内无既有单测面——接线与既有 ensure_system_default_profiles/ensure_role_template_profiles 同 try 块同构，函数本体契约由 FR-05「test_express_preset_coexists_with_system_defaults」间接覆盖
FR-05: backend/app/modules/agent/tests/test_profile_seed.py「test_express_preset_coexists_with_system_defaults」（并全量回归本文件既有用例）

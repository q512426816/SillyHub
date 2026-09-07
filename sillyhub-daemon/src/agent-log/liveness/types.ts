/**
 * `agent-log/liveness/types.ts` —— liveness 状态模型与 deriver IO 契约（纯类型）。
 *
 * task-01（2026-09-07-agent-liveness-states / FR-01 + D-003@v1）：五态模型 +
 * deriver 纯函数签名，为 task-02/03/10/11 的推导器（zcode / codex / claude …）
 * 提供统一 IO 契约；接口定义与 design §7 逐字一致，不引入 §7 之外的状态值
 * 或字段（evidence 保持 string 短摘要）。
 *
 * 状态语义（design §5.1，与任务态 stage/step 正交；L0 mtime 兜底与 L1 事件级
 * 推导共用同一状态空间）：
 *   - working  在干活（日志有新鲜事件 / 工具执行中等正向证据）
 *   - blocked  等人（铁律 R-01：必须正向证据，绝不以"没动静"推断；第一方
 *              PERMISSION_REQUEST 事件优先于日志推导，D-012）
 *   - idle     活着但无进展
 *   - ended    会话已结束（文件消失超窗 / 终态事件）
 *   - unknown  无法判定（deriver 异常 → 本轮 unknown，不影响登记链路，R-02）
 *
 * 纯函数约束（与 parse-zcode-model-io.ts 同源）：deriver 不读文件系统 / 时钟，
 * tail / prev / now 全部经入参注入；本模块只含类型，零 import 零副作用。
 *
 * @module agent-log/liveness/types
 */

/** liveness 五态字面量联合（design §7 逐字）。 */
export type LivenessState = 'working' | 'blocked' | 'idle' | 'ended' | 'unknown';

/** deriver 入参：全部注入（纯函数不读 fs / 时钟）。 */
export interface DeriverInput {
  /** tailer 差量续读的日志尾部文本（上次 offset 游标之后的新增内容）。 */
  tail: string;
  /** 上一轮推导快照（state + 当时读取 offset）；首轮无 → null。 */
  prev: { state: LivenessState; offset: number } | null;
  /** 当前时间（ms epoch；注入而非 deriver 自取时钟，fixture 单测零 mock）。 */
  now: number;
}

/** deriver 出参：状态 + 证据短摘要（design §7；不抛异常，异常路径由调用方按 R-02 落 unknown）。 */
export interface DeriverOutput {
  state: LivenessState;
  /** 证据短摘要，如 'last_event=model_io' / 'PERMISSION_REQUEST(write)'。 */
  evidence: string;
}

/** liveness 推导器统一签名（design §7 逐字）。 */
export type LivenessDeriver = (input: DeriverInput) => DeriverOutput;

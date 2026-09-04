/**
 * interactive/pi-rpc-driver.ts —— PI rpc driver 占位（task-04 编译锚）。
 *
 * ⚠️ 占位说明：本文件由 task-04（caps 三端+注册+装配+detector）创建——
 * providers.ts INTERACTIVE_PROVIDERS / cli.ts drivers 装配行均 import
 * PiRpcDriver，占位保证两处引用可编译、provider-registry.test.ts 用例 5
 *（createDriver 可实例化）可过。**真实实现（`pi --mode rpc` JSONL 双向 /
 * LF 分帧 / prompt-steer-follow_up 三模式 / abort / get_state 合成
 * session_started / agent_settled 收敛 / extension_ui_request 自动取消）
 * 归 task-02/06 替换本文件**（design §5.1 / §7 接口骨架）。
 *
 * 占位契约：
 *   - `new PiRpcDriver()` 零参可构造（registry createDriver / cli 装配依赖）；
 *   - `provider = 'pi'`（E5：driver 归属标识，registry 测试断言）；
 *   - start/consume/interrupt 一律抛 NotImplemented——占位期不存在真实
 *     pi 会话路径，宁可显式失败也不静默假装成功（E3 异常不静默精神）。
 */

import type {
  InteractiveDriver,
  InteractiveDriverCallbacks,
  InteractiveDriverHandle,
  InteractiveDriverStartOptions,
  UserTurnInput,
} from './driver.js';

/** PI rpc driver（占位；真实实现见 design §5.1，task-02/06 替换）。 */
export class PiRpcDriver implements InteractiveDriver {
  /** E5：driver 归属标识（与注册表键 / detector key 一致）。 */
  readonly provider = 'pi' as const;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  start(
    _input: AsyncIterable<UserTurnInput>,
    _options: InteractiveDriverStartOptions,
  ): Promise<InteractiveDriverHandle> {
    throw new Error('PiRpcDriver.start 尚未实现（占位，task-02/06 落地）');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  consume(
    _handle: InteractiveDriverHandle,
    _callbacks: InteractiveDriverCallbacks,
  ): Promise<void> {
    throw new Error('PiRpcDriver.consume 尚未实现（占位，task-02/06 落地）');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interrupt(_handle: InteractiveDriverHandle | null): Promise<boolean> {
    throw new Error('PiRpcDriver.interrupt 尚未实现（占位，task-02/06 落地）');
  }
}

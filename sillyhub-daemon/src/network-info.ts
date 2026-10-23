import { networkInterfaces } from 'node:os';

/**
 * 本机网卡信息采集（2026-10-23-session-network-context）。
 *
 * 心跳每跳调用，产出随心跳体 `network_interfaces` 字段上报平台，供会话
 * 【网络环境】段做同网段判定与访问地址拼接（design §Phase 1 / D-002）。
 *
 * 过滤口径（FR-02）：
 * - 剔除 internal 回环条目（127.0.0.1 / ::1，无拼址价值）；
 * - 剔除无 cidr 条目（DHCP 未完成/虚拟半配置网卡，无法参与子网计算）；
 * - IPv4 与 IPv6 都保留上报——判定层（backend）只消费 IPv4，IPv6 仅
 *   存储标注「未参与判定」（D-003）。
 *
 * family 归一：Node ≥18 的 os.networkInterfaces 返回字符串族
 * （'IPv4'/'IPv6'）；兼容旧数值形态（4/6）统一映射为字符串族。
 */

/** 单网卡上报条目（backend HeartbeatNetworkInterface 同构）。 */
export interface NetworkInterfaceInfo {
  name: string;
  ip: string;
  cidr: string;
  family: 'IPv4' | 'IPv6';
}

/** os.networkInterfaces 的条目/表形态（可注入测试替身）。 */
type NicTable = Record<string, { address: string; cidr: string | null; family: string | number; internal: boolean }[] | undefined>;

function normalizeFamily(family: string | number): 'IPv4' | 'IPv6' | null {
  if (family === 'IPv4' || family === 4) return 'IPv4';
  if (family === 'IPv6' || family === 6) return 'IPv6';
  return null;
}

/**
 * 采集过滤后的网卡列表。`source` 缺省取真实 os.networkInterfaces()，
 * 测试注入构造表（回环/无 cidr/数值族等边界用例不依赖宿主网卡形态）。
 */
export function collectNetworkInterfaces(source: NicTable = networkInterfaces()): NetworkInterfaceInfo[] {
  const result: NetworkInterfaceInfo[] = [];
  for (const [name, entries] of Object.entries(source)) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      if (!entry.cidr || !entry.address) continue;
      const family = normalizeFamily(entry.family);
      if (family === null) continue;
      result.push({ name, ip: entry.address, cidr: entry.cidr, family });
    }
  }
  return result;
}

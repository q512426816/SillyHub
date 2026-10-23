import { describe, expect, it } from 'vitest';
import { collectNetworkInterfaces } from '../src/network-info.js';

// 2026-10-23-session-network-context task-01：采集过滤口径单测（FR-02）。
// 全部走注入构造表，不依赖宿主真实网卡形态（跨 Windows/Linux/macOS 可复跑）。

describe('collectNetworkInterfaces', () => {
  it('剔除 internal 回环条目', () => {
    const out = collectNetworkInterfaces({
      lo: [
        { address: '127.0.0.1', cidr: '127.0.0.1/8', family: 'IPv4', internal: true },
        { address: '::1', cidr: '::1/128', family: 'IPv6', internal: true },
      ],
      eth0: [{ address: '192.168.1.10', cidr: '192.168.1.10/24', family: 'IPv4', internal: false }],
    });
    expect(out).toEqual([
      { name: 'eth0', ip: '192.168.1.10', cidr: '192.168.1.10/24', family: 'IPv4' },
    ]);
  });

  it('剔除无 cidr 条目（DHCP 未完成/半配置虚拟网卡）', () => {
    const out = collectNetworkInterfaces({
      eth0: [
        { address: '192.168.1.10', cidr: null, family: 'IPv4', internal: false },
        { address: '169.254.7.7', cidr: null, family: 'IPv4', internal: false },
        { address: '192.168.1.11', cidr: '192.168.1.11/24', family: 'IPv4', internal: false },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.ip).toBe('192.168.1.11');
  });

  it('IPv4 与 IPv6 都保留上报（判定层只消费 IPv4，IPv6 仅存储）', () => {
    const out = collectNetworkInterfaces({
      eth0: [
        { address: '192.168.1.10', cidr: '192.168.1.10/24', family: 'IPv4', internal: false },
        { address: 'fd00::a1', cidr: 'fd00::a1/64', family: 'IPv6', internal: false },
      ],
    });
    expect(out.map((e) => e.family).sort()).toEqual(['IPv4', 'IPv6']);
  });

  it('family 数值形态（旧 Node）归一为字符串族', () => {
    const out = collectNetworkInterfaces({
      eth0: [
        { address: '10.0.0.5', cidr: '10.0.0.5/24', family: 4, internal: false },
        { address: 'fd00::b2', cidr: 'fd00::b2/64', family: 6, internal: false },
      ],
    });
    expect(out).toEqual([
      { name: 'eth0', ip: '10.0.0.5', cidr: '10.0.0.5/24', family: 'IPv4' },
      { name: 'eth0', ip: 'fd00::b2', cidr: 'fd00::b2/64', family: 'IPv6' },
    ]);
  });

  it('未知 family 形态剔除不炸（防御半配置网卡）', () => {
    const out = collectNetworkInterfaces({
      weird: [{ address: '0.0.0.0', cidr: '0.0.0.0/0', family: 'weird' as unknown as string, internal: false }],
    });
    expect(out).toEqual([]);
  });

  it('多网卡全量保留且条目名随网卡名（Windows vEthernet 等虚拟网卡不在此层过滤——判定层选址）', () => {
    const out = collectNetworkInterfaces({
      'vEthernet (WSL)': [{ address: '172.22.1.2', cidr: '172.22.1.2/20', family: 'IPv4', internal: false }],
      WLAN: [{ address: '192.168.1.23', cidr: '192.168.1.23/24', family: 'IPv4', internal: false }],
    });
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.name)).toEqual(['vEthernet (WSL)', 'WLAN']);
  });

  it('空表/undefined 网卡槽返回空数组', () => {
    expect(collectNetworkInterfaces({})).toEqual([]);
    expect(collectNetworkInterfaces({ eth0: undefined })).toEqual([]);
  });
});

/**
 * tests/permission-rules-temp-paths.test.ts —— 写安全兜底 CLI deny 侧验证（task-08 / FR-007）。
 *
 * 守护 buildWritePermissionRules 的「临时路径放行 + 越界写 deny」双重语义：
 *   - FR-007：sillyspec 写 c:\dev\null / 系统 temp / .sillyspec/.runtime 等
 *     临时路径时，allow 列表显式放行（覆盖 deny Write(**) 通配）；
 *   - R-02：仅放行已知 3 类临时路径，越界写（如 /etc/**）仍被 deny Write(**) 拦截；
 *   - 通配 deny（Write(**) / Edit(**)）始终保留，allow 具体路径覆盖，不破坏兜底。
 *
 * 与 policy/allowed-roots-temp-paths.test.ts 双重校验：
 *   - 本文件：CLI 侧（CC --settings permissions.allow/deny）；
 *   - policy 文件：PolicyEngine 侧（allowed_roots isPathUnderAnyRoot）。
 *
 * 跨平台（CLAUDE.md 规则 12）：
 *   - 系统 temp 用 os.tmpdir() 取真实值，反斜杠统一正斜杠断言；
 *   - c:\dev\null 是 Windows 专用，POSIX 上路径无意义但仍断言常量存在（CC permission
 *     是纯字符串规则，不依赖文件系统存在性）。
 */
import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { buildWritePermissionRules, buildCcSettingsJson } from '../src/permission-rules.js';

/** 期望出现在 allow 中的临时路径集合（与 src/permission-rules.ts SILLYSPEC_TEMP_PATTERNS 同步）。 */
const TEMP_PATTERNS = ['C:/dev/null', '/dev/null', tmpdir().replace(/\\/g, '/')];

describe('permission-rules 临时路径放行（FR-007）', () => {
  describe('临时路径在 allow 列表', () => {
    it('即使 allowedRoots 为空，临时路径仍被放行', () => {
      const { allow } = buildWritePermissionRules([]);
      // 每个临时路径都应产出 Write/Edit 两条 allow（root/** + root）
      for (const temp of TEMP_PATTERNS) {
        expect(allow).toContain(`Write(${temp}/**)`);
        expect(allow).toContain(`Write(${temp})`);
        expect(allow).toContain(`Edit(${temp}/**)`);
        expect(allow).toContain(`Edit(${temp})`);
      }
    });

    it('allowedRoots 含工作区根 + 临时路径时，两者 allow 并存', () => {
      const { allow } = buildWritePermissionRules(['/workspace/proj']);
      expect(allow).toContain('Write(/workspace/proj/**)');
      // 临时路径仍放行（不被工作区 root 覆盖）
      for (const temp of TEMP_PATTERNS) {
        expect(allow).toContain(`Write(${temp}/**)`);
      }
    });

    it('Windows 系统 temp 反斜杠规范化为正斜杠', () => {
      const { allow } = buildWritePermissionRules([]);
      const normalizedTemp = tmpdir().replace(/\\/g, '/');
      // tmpdir() 在 Windows 返回反斜杠路径，allow 中应是正斜杠形式
      expect(allow.some((r) => r.includes(normalizedTemp))).toBe(true);
      // 不应残留反斜杠（CC permission 路径模式用 / 分隔）
      expect(allow.some((r) => r.includes(tmpdir()) && r.includes('\\'))).toBe(false);
    });
  });

  describe('越界写仍 deny（通配兜底保留）', () => {
    it('deny 列表仍含 Write(**) / Edit(**) 通配', () => {
      const { deny } = buildWritePermissionRules(['/workspace/proj']);
      expect(deny).toEqual(expect.arrayContaining(['Write(**)', 'Edit(**)']));
    });

    it('buildCcSettingsJson 产出的 JSON deny 含 Write(**)', () => {
      const json = buildCcSettingsJson(['/workspace/proj']);
      const parsed = JSON.parse(json);
      expect(parsed.permissions.deny).toContain('Write(**)');
      expect(parsed.permissions.deny).toContain('Edit(**)');
    });

    it('allow 含临时路径时 deny 通配不变（allow 覆盖 deny 不破坏兜底）', () => {
      const { allow, deny } = buildWritePermissionRules([]);
      // allow 非空（含临时路径）
      expect(allow.length).toBeGreaterThan(0);
      // deny 仍含通配
      expect(deny).toContain('Write(**)');
      expect(deny).toContain('Edit(**)');
    });
  });

  describe('不放行任意路径（R-02）', () => {
    it('/etc/** 不在 allow', () => {
      const { allow } = buildWritePermissionRules(['/workspace/proj']);
      expect(allow.some((r) => r.includes('/etc'))).toBe(false);
    });

    it('C:\\Windows\\System32 不在 allow', () => {
      const { allow } = buildWritePermissionRules(['/workspace/proj']);
      expect(allow.some((r) => r.includes('Windows/System32'))).toBe(false);
      expect(allow.some((r) => r.includes('Windows\\System32'))).toBe(false);
    });

    it('~/Documents 不在 allow（homedir 仅展开 allowedRoots，不自动兜底）', () => {
      const { allow } = buildWritePermissionRules(['/workspace/proj']);
      // Documents 不应被放行（除非显式传入 allowedRoots）
      expect(allow.some((r) => r.includes('Documents'))).toBe(false);
    });

    it('D:/evil 不在 allow（仅 C:/dev/null 放行，不泛化到 D 盘）', () => {
      const { allow } = buildWritePermissionRules([]);
      expect(allow.some((r) => r.includes('D:/evil'))).toBe(false);
      // C:/dev/null 仍在（不误伤）
      expect(allow).toContain('Write(C:/dev/null/**)');
    });
  });
});

import { describe, it, expect } from 'vitest';
import { buildWritePermissionRules, buildCcSettingsJson } from '../src/permission-rules.js';

describe('permission-rules', () => {
  it('读工具不配 deny（读自由）', () => {
    const { deny } = buildWritePermissionRules(['/tmp']);
    expect(deny.some((r) => r.startsWith('Read'))).toBe(false);
    expect(deny.some((r) => r.startsWith('Bash'))).toBe(false);
  });

  it('写工具白名单内 allow + 通配 deny', () => {
    const { allow, deny } = buildWritePermissionRules(['/tmp']);
    // 白名单内 Write allow
    expect(allow).toContain('Write(/tmp/**)');
    expect(allow).toContain('Write(/tmp)');
    expect(allow).toContain('Edit(/tmp/**)');
    expect(allow).toContain('MultiEdit(/tmp/**)');
    // 通配 deny
    expect(deny).toEqual(expect.arrayContaining(['Write(**)', 'Edit(**)', 'MultiEdit(**)']));
  });

  it('多路径各生成 allow', () => {
    const { allow } = buildWritePermissionRules(['/tmp', '/home/user']);
    expect(allow).toContain('Write(/tmp/**)');
    expect(allow).toContain('Write(/home/user/**)');
  });

  it('~/.sillyhub 展开 homedir', () => {
    const { allow } = buildWritePermissionRules(['~/.sillyhub']);
    // ~ 展开为 homedir（非字面 ~）
    expect(allow.some((r) => r.includes('.sillyhub/**'))).toBe(true);
    expect(allow.some((r) => r.startsWith('Write(~)'))).toBe(false);
  });

  it('Windows 反斜杠规范化正斜杠', () => {
    const { allow } = buildWritePermissionRules(['C:\\Users\\test']);
    expect(allow.some((r) => r.includes('C:/Users/test'))).toBe(true);
  });

  it('buildCcSettingsJson 返回合法 JSON 含 permissions', () => {
    const json = buildCcSettingsJson(['/tmp']);
    const parsed = JSON.parse(json);
    expect(parsed.permissions).toBeDefined();
    expect(parsed.permissions.allow).toContain('Write(/tmp/**)');
    expect(parsed.permissions.deny).toContain('Write(**)');
  });

  it('去重相同路径', () => {
    const { allow } = buildWritePermissionRules(['/tmp', '/tmp']);
    const writeCount = allow.filter((r) => r.startsWith('Write(/tmp')).length;
    // 每个写工具对 /tmp 只 1 条（去重）
    expect(writeCount).toBe(2); // Write(/tmp/**) + Write(/tmp)
  });
});

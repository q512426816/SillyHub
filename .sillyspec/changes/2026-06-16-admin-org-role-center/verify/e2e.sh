#!/usr/bin/env bash
# e2e.sh - 端到端验证 8 项关键路径
# change: 2026-06-16-admin-org-role-center / task-12
#
# 使用：
#   API_BASE=http://127.0.0.1:8000 \
#   ADMIN_EMAIL=admin@sillyhub.local \
#   ADMIN_PASSWORD=admin123 \
#   bash .sillyspec/changes/2026-06-16-admin-org-role-center/verify/e2e.sh
#
# 退出码：全部 PASS → 0；任意 FAIL → 1
#
# JSON 解析：jq 优先，缺失则回退 python -c

set -uo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:8000}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@sillyhub.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"

PASS_COUNT=0
FAIL_COUNT=0
FAILED_CASES=()

log() { printf '[e2e] %s\n' "$*"; }

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  log "PASS  $1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  FAILED_CASES+=("$1: $2")
  log "FAIL  $1 — $2"
}

# JSON 解析兼容层：jq 优先，否则用 python
if command -v jq >/dev/null 2>&1; then
  JQ() { jq -r "$1" 2>/dev/null; }
else
  JQ() {
    local expr="$1"
    python -c "
import sys, json
try:
    data = json.load(sys.stdin)
except Exception:
    print('')
    sys.exit(0)
try:
    result = $expr
    if result is None:
        print('')
    elif isinstance(result, bool):
        print('true' if result else 'false')
    else:
        print(result)
except Exception:
    print('')
" 2>/dev/null
  }
fi

# 公共：登录拿 admin token + admin id
LOGIN_RESP=$(curl -fsS -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  "$API_BASE/api/auth/login" 2>/dev/null)

TOKEN=$(echo "$LOGIN_RESP" | JQ "data.get('access_token','')")

if [ -z "$TOKEN" ]; then
  log "FATAL: admin 登录失败 (raw=$LOGIN_RESP)"
  exit 2
fi

ME_RESP=$(curl -fsS -H "Authorization: Bearer $TOKEN" "$API_BASE/api/auth/me")
ADMIN_ID=$(echo "$ME_RESP" | JQ "data.get('user',{}).get('id','')")

log "admin token ready, admin_id=$ADMIN_ID"

# ────────────────────────────────────────────────────────────────────
# E2E-01: 自保护 - 不能删除自己
# ────────────────────────────────────────────────────────────────────
RESP=$(curl -s -o /tmp/e2e01.json -w "%{http_code}" -X DELETE \
  -H "Authorization: Bearer $TOKEN" \
  "$API_BASE/api/admin/users/$ADMIN_ID")
BODY_CODE=$(JQ "data.get('details',{}).get('code','') if isinstance(data.get('details'), dict) else ''" < /tmp/e2e01.json)
if [ "$RESP" = "403" ] && [ "$BODY_CODE" = "USER_SELF_DELETE_FORBIDDEN" ]; then
  pass "E2E-01 self-delete forbidden"
else
  fail "E2E-01 self-delete forbidden" "http=$RESP details.code=$BODY_CODE"
fi

# ────────────────────────────────────────────────────────────────────
# E2E-02: 最后管理员保护
# ────────────────────────────────────────────────────────────────────
RESP=$(curl -s -o /tmp/e2e02.json -w "%{http_code}" -X PATCH \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"is_platform_admin": false}' \
  "$API_BASE/api/admin/users/$ADMIN_ID")
BODY_CODE=$(JQ "data.get('details',{}).get('code','') if isinstance(data.get('details'), dict) else ''" < /tmp/e2e02.json)
if [ "$RESP" = "403" ] && [ "$BODY_CODE" = "USER_LAST_ADMIN_PROTECTED" ]; then
  pass "E2E-02 last admin protected"
else
  fail "E2E-02 last admin protected" "http=$RESP details.code=$BODY_CODE"
fi

# ────────────────────────────────────────────────────────────────────
# E2E-03: 角色占用拒绝删除
# ────────────────────────────────────────────────────────────────────
ROLE=$(curl -fsS -X POST -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"key":"test_viewer_e2e","name":"Test Viewer E2E","permission_keys":["user:read"]}' \
  "$API_BASE/api/admin/roles" 2>/dev/null)
ROLE_ID=$(echo "$ROLE" | JQ "data.get('id','')")

if [ -n "$ROLE_ID" ]; then
  USER=$(curl -fsS -X POST -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"viewer_e2e@test.local\",\"password\":\"pwd12345\",\"role_ids\":[\"$ROLE_ID\"]}" \
    "$API_BASE/api/admin/users" 2>/dev/null)
  VIEWER_USER_ID=$(echo "$USER" | JQ "data.get('id','')")

  RESP=$(curl -s -o /tmp/e2e03.json -w "%{http_code}" -X DELETE \
    -H "Authorization: Bearer $TOKEN" \
    "$API_BASE/api/admin/roles/$ROLE_ID")
  BODY_CODE=$(JQ "data.get('code','')" < /tmp/e2e03.json)
  UCOUNT=$(JQ "data.get('details',{}).get('user_count','')" < /tmp/e2e03.json)
  if [ "$RESP" = "409" ] && [ "$BODY_CODE" = "HTTP_409_ROLE_IN_USE" ]; then
    pass "E2E-03 role in use (user_count=$UCOUNT)"
  else
    fail "E2E-03 role in use" "http=$RESP code=$BODY_CODE user_count=$UCOUNT"
  fi

  # 清理
  if [ -n "$VIEWER_USER_ID" ]; then
    curl -fsS -X PATCH -H "Authorization: Bearer $TOKEN" \
      -H 'Content-Type: application/json' \
      -d '{"role_ids":[]}' \
      "$API_BASE/api/admin/users/$VIEWER_USER_ID" > /dev/null
    curl -fsS -X DELETE -H "Authorization: Bearer $TOKEN" \
      "$API_BASE/api/admin/users/$VIEWER_USER_ID" > /dev/null
  fi
  curl -fsS -X DELETE -H "Authorization: Bearer $TOKEN" \
    "$API_BASE/api/admin/roles/$ROLE_ID" > /dev/null
else
  fail "E2E-03 role in use" "setup failed"
fi

# ────────────────────────────────────────────────────────────────────
# E2E-04: 组织占用拒绝删除
# ────────────────────────────────────────────────────────────────────
HQ=$(curl -fsS -X POST -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"HQ E2E","code":"hq_e2e"}' \
  "$API_BASE/api/admin/organizations" 2>/dev/null)
HQ_ID=$(echo "$HQ" | JQ "data.get('id','')")

if [ -n "$HQ_ID" ]; then
  ENG=$(curl -fsS -X POST -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{\"name\":\"Engineering E2E\",\"code\":\"eng_e2e\",\"parent_id\":\"$HQ_ID\"}" \
    "$API_BASE/api/admin/organizations" 2>/dev/null)
  ENG_ID=$(echo "$ENG" | JQ "data.get('id','')")

  # 删除 HQ（有子）→ 409 ORGANIZATION_HAS_CHILDREN
  RESP=$(curl -s -o /tmp/e2e04a.json -w "%{http_code}" -X DELETE \
    -H "Authorization: Bearer $TOKEN" \
    "$API_BASE/api/admin/organizations/$HQ_ID")
  BODY_CODE=$(JQ "data.get('code','')" < /tmp/e2e04a.json)
  if [ "$RESP" = "409" ] && [ "$BODY_CODE" = "HTTP_409_ORGANIZATION_HAS_CHILDREN" ]; then
    pass "E2E-04a org has children"
  else
    fail "E2E-04a org has children" "http=$RESP code=$BODY_CODE"
  fi

  if [ -n "$ENG_ID" ]; then
    ORG_USER=$(curl -fsS -X POST -H "Authorization: Bearer $TOKEN" \
      -H 'Content-Type: application/json' \
      -d "{\"email\":\"orgmember_e2e@test.local\",\"password\":\"pwd12345\",\"organization_ids\":[\"$ENG_ID\"]}" \
      "$API_BASE/api/admin/users" 2>/dev/null)
    ORG_USER_ID=$(echo "$ORG_USER" | JQ "data.get('id','')")

    RESP=$(curl -s -o /tmp/e2e04b.json -w "%{http_code}" -X DELETE \
      -H "Authorization: Bearer $TOKEN" \
      "$API_BASE/api/admin/organizations/$ENG_ID")
    BODY_CODE=$(JQ "data.get('code','')" < /tmp/e2e04b.json)
    if [ "$RESP" = "409" ] && [ "$BODY_CODE" = "HTTP_409_ORGANIZATION_IN_USE" ]; then
      pass "E2E-04b org in use"
    else
      fail "E2E-04b org in use" "http=$RESP code=$BODY_CODE"
    fi

    if [ -n "$ORG_USER_ID" ]; then
      curl -fsS -X PATCH -H "Authorization: Bearer $TOKEN" \
        -H 'Content-Type: application/json' \
        -d '{"organization_ids":[]}' \
        "$API_BASE/api/admin/users/$ORG_USER_ID" > /dev/null
      curl -fsS -X DELETE -H "Authorization: Bearer $TOKEN" \
        "$API_BASE/api/admin/users/$ORG_USER_ID" > /dev/null
    fi
    curl -fsS -X DELETE -H "Authorization: Bearer $TOKEN" \
      "$API_BASE/api/admin/organizations/$ENG_ID" > /dev/null
  fi
  curl -fsS -X DELETE -H "Authorization: Bearer $TOKEN" \
    "$API_BASE/api/admin/organizations/$HQ_ID" > /dev/null
else
  fail "E2E-04a org has children" "setup failed"
  fail "E2E-04b org in use" "setup failed"
fi

# ────────────────────────────────────────────────────────────────────
# E2E-05: 登录权限控制 + sessions 撤销
# ────────────────────────────────────────────────────────────────────
BOB=$(curl -fsS -X POST -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"email":"bob_e2e@test.local","password":"bob12345"}' \
  "$API_BASE/api/admin/users" 2>/dev/null)
BOB_ID=$(echo "$BOB" | JQ "data.get('id','')")

if [ -n "$BOB_ID" ]; then
  BOB_LOGIN=$(curl -fsS -X POST -H 'Content-Type: application/json' \
    -d '{"email":"bob_e2e@test.local","password":"bob12345"}' \
    "$API_BASE/api/auth/login" 2>/dev/null)
  BOB_TOKEN=$(echo "$BOB_LOGIN" | JQ "data.get('access_token','')")

  curl -fsS -X POST -H "Authorization: Bearer $TOKEN" \
    "$API_BASE/api/admin/users/$BOB_ID/disable-login" > /dev/null

  RESP=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $BOB_TOKEN" \
    "$API_BASE/api/auth/me")
  if [ "$RESP" = "401" ]; then
    pass "E2E-05a session revoked after disable-login"
  else
    fail "E2E-05a session revoked after disable-login" "http=$RESP (expected 401)"
  fi

  RESP=$(curl -s -o /tmp/e2e05b.json -w "%{http_code}" -X POST \
    -H 'Content-Type: application/json' \
    -d '{"email":"bob_e2e@test.local","password":"bob12345"}' \
    "$API_BASE/api/auth/login")
  BODY_CODE=$(JQ "data.get('code','')" < /tmp/e2e05b.json)
  if [ "$RESP" = "401" ] && [ "$BODY_CODE" = "HTTP_401_AUTH_USER_LOGIN_DISABLED" ]; then
    pass "E2E-05b password login refused"
  else
    fail "E2E-05b password login refused" "http=$RESP code=$BODY_CODE"
  fi
else
  fail "E2E-05a session revoked after disable-login" "setup failed"
  fail "E2E-05b password login refused" "setup failed"
fi

# ────────────────────────────────────────────────────────────────────
# E2E-06: 会话单条撤销
# ────────────────────────────────────────────────────────────────────
if [ -n "${BOB_ID:-}" ]; then
  curl -fsS -X POST -H "Authorization: Bearer $TOKEN" \
    "$API_BASE/api/admin/users/$BOB_ID/enable-login" > /dev/null
  curl -fsS -X POST -H 'Content-Type: application/json' \
    -d '{"email":"bob_e2e@test.local","password":"bob12345"}' \
    "$API_BASE/api/auth/login" > /dev/null

  SESSIONS=$(curl -fsS -H "Authorization: Bearer $TOKEN" \
    "$API_BASE/api/admin/users/$BOB_ID/sessions")
  SESSION_ID=$(echo "$SESSIONS" | JQ "next((s for s in data if not s.get('revoked_at')), {}).get('id','')")

  if [ -n "$SESSION_ID" ]; then
    curl -fsS -X DELETE -H "Authorization: Bearer $TOKEN" \
      "$API_BASE/api/admin/users/$BOB_ID/sessions/$SESSION_ID" > /dev/null

    SESSIONS2=$(curl -fsS -H "Authorization: Bearer $TOKEN" \
      "$API_BASE/api/admin/users/$BOB_ID/sessions")
    REVOKED=$(echo "$SESSIONS2" | JQ "next((s.get('revoked_at') for s in data if s.get('id')=='$SESSION_ID'), '')")
    if [ -n "$REVOKED" ] && [ "$REVOKED" != "None" ]; then
      pass "E2E-06 session revoked"
    else
      fail "E2E-06 session revoked" "revoked_at is still null"
    fi
  else
    fail "E2E-06 session revoked" "no active session to revoke"
  fi

  curl -fsS -X DELETE -H "Authorization: Bearer $TOKEN" \
    "$API_BASE/api/admin/users/$BOB_ID" > /dev/null
else
  fail "E2E-06 session revoked" "bob setup missing"
fi

# ────────────────────────────────────────────────────────────────────
# E2E-07: 审计覆盖（audit_logs 表必须含 user.* / role.* / organization.* 三类）
# ────────────────────────────────────────────────────────────────────
AUDIT_USER=$(docker compose --env-file "$(pwd)/deploy/.env" -f "$(pwd)/deploy/docker-compose.yml" exec -T postgres \
  psql -U platform -d platform -tAc \
  "SELECT count(*) FROM audit_logs WHERE action LIKE 'user.%'" 2>/dev/null | tr -d '[:space:]')
AUDIT_ROLE=$(docker compose --env-file "$(pwd)/deploy/.env" -f "$(pwd)/deploy/docker-compose.yml" exec -T postgres \
  psql -U platform -d platform -tAc \
  "SELECT count(*) FROM audit_logs WHERE action LIKE 'role.%'" 2>/dev/null | tr -d '[:space:]')
AUDIT_ORG=$(docker compose --env-file "$(pwd)/deploy/.env" -f "$(pwd)/deploy/docker-compose.yml" exec -T postgres \
  psql -U platform -d platform -tAc \
  "SELECT count(*) FROM audit_logs WHERE action LIKE 'organization.%'" 2>/dev/null | tr -d '[:space:]')

if [ "${AUDIT_USER:-0}" -gt 0 ] && [ "${AUDIT_ROLE:-0}" -gt 0 ] && [ "${AUDIT_ORG:-0}" -gt 0 ]; then
  pass "E2E-07 audit coverage (user=$AUDIT_USER role=$AUDIT_ROLE org=$AUDIT_ORG)"
else
  fail "E2E-07 audit coverage" "user=$AUDIT_USER role=$AUDIT_ROLE org=$AUDIT_ORG"
fi

# ────────────────────────────────────────────────────────────────────
# E2E-08: 旧端点兼容
# ────────────────────────────────────────────────────────────────────
RESP=$(curl -s -o /tmp/e2e08.json -w "%{http_code}" -H "Authorization: Bearer $TOKEN" \
  "$API_BASE/api/users")
HAS_ITEMS=$(JQ "'true' if 'items' in data else 'false'" < /tmp/e2e08.json)
HAS_TOTAL=$(JQ "'true' if 'total' in data else 'false'" < /tmp/e2e08.json)
if [ "$RESP" = "200" ] && [ "$HAS_ITEMS" = "true" ] && [ "$HAS_TOTAL" = "true" ]; then
  pass "E2E-08 legacy /api/users compatible"
else
  fail "E2E-08 legacy /api/users compatible" "http=$RESP items=$HAS_ITEMS total=$HAS_TOTAL"
fi

# ────────────────────────────────────────────────────────────────────
# 汇总
# ────────────────────────────────────────────────────────────────────
TOTAL=$((PASS_COUNT + FAIL_COUNT))
log "===================="
log "PASS: $PASS_COUNT / $TOTAL"
if [ "$FAIL_COUNT" -gt 0 ]; then
  log "FAILED CASES:"
  for c in "${FAILED_CASES[@]}"; do
    log "  - $c"
  done
  exit 1
fi
exit 0

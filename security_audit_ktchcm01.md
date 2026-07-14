# 🔒 Security Audit Report

**Target:** https://imdidinne.github.io/ktchcm01/
**Date:** 2026-07-02
**Application:** KTC HCM 01 — Tổng Quan Hàng Hoá (GHN) — static frontend on GitHub Pages, backed by Supabase (`baizmeqkxslajxuzyfnu.supabase.co`)
**Scope:** Black-box analysis of frontend code, auth flow, Supabase backend authorization, and data exposure (checked against `security-rules.md`)

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 **CRITICAL** | 4 |
| 🟠 **HIGH** | 1 |
| 🟡 **MEDIUM** | 2 |
| 🔵 **LOW** | 1 |

This is the **most severe audit of the six GHN dashboards reviewed to date**. Unlike the prior apps, this one has a real backend (Supabase) with actual user accounts, RBAC, and an approval workflow — but a broken-access-control bug in one admin function exposes the **entire user database anonymously**, a hardcoded fallback login uses **crackable, unsalted password hashes**, and a backend function can be **triggered by anyone with no authentication**. All three were confirmed live during this audit.

---

## 🔴 CRITICAL Findings

### C1. Anonymous, Unauthenticated Read of the Entire User Database (Names, Emails, Roles) via a Broken Supabase RPC

> [!CAUTION]
> A single unauthenticated HTTP request — using only the public API key printed in this page's JS — returns every user's full name, email address, role, and approval status.

**Evidence:**
```bash
curl -X POST "https://baizmeqkxslajxuzyfnu.supabase.co/rest/v1/rpc/get_all_users" \
  -H "apikey: sb_publishable_VRLqjdMb3uIie89vbRXloA_xdak8hgy" \
  -H "Authorization: Bearer sb_publishable_VRLqjdMb3uIie89vbRXloA_xdak8hgy" \
  -H "Content-Type: application/json" -d '{}'
```
Returned `HTTP 200` with the full list, e.g.:
```json
[{"id":"...","email":"nhanpt@ghn.vn","name":"Phan Trọng Nhân","role":"operator","approved":true},
 {"id":"...","email":"hongthuy3122710@gmail.com","name":"Thủy Ngô Thị Hồng","role":"operator","approved":true},
 {"id":"...","email":"phatdt@ghn.vn","name":"Phát Đào Tấn","role":"manager","approved":true}, ...]
```
No login, no session, no manager role — just the anon key that ships in every page load.

**This is inconsistent within the same codebase** — the sibling function `get_pending_users` (used for the same admin panel) *does* correctly enforce authorization:
```bash
curl -X POST ".../rpc/get_pending_users" -H "apikey: ..." -H "Authorization: Bearer ..." -d '{}'
# {"code":"P0001","message":"Quyền truy cập bị từ chối. Chỉ Quản lý mới được xem danh sách này."}
```
This confirms `get_all_users` is simply missing the same manager-role check that its sibling has — a straightforward, fixable bug, not a fundamental design flaw.

**Impact:** Full PII exposure (names + emails, including personal Gmail addresses of some staff, not just `@ghn.vn`) for every registered user of this system, to anyone on the internet with the client-visible API key — which is unavoidably public by design (it's meant to be embedded in frontend code; the security boundary is supposed to be server-side authorization, which is missing here).

**Violates:** `security-rules.md` — *"After authenticating a request, verify the authenticated user owns or has explicit permission... before returning... data"* and *"Return only the fields the caller needs."*

**Remediation:**
```
1. Add the same authorization check used in get_pending_users to get_all_users (verify caller's role = 'manager' via auth.uid()/JWT claims before returning data).
2. Audit every other RPC function (approve_user, update_user_role, delete_user_by_id) for the same missing check — do not assume they're safe just because the UI only shows their buttons to managers.
3. Enable/verify Row Level Security (RLS) on the underlying tables as defense-in-depth, not just function-level checks.
```

---

### C2. Hardcoded, Unsalted SHA-256 Password Hashes for "manager" and "operator" Fallback Accounts — Cracked During This Audit in Under a Second

> [!CAUTION]
> Both fallback account passwords were successfully recovered offline using a short list of common passwords, with zero interaction with any server.

**Evidence:**
```javascript
const userHashes = {
  'manager': '866485796cfa8d7c0cf7111640205b83076433547577511d81f8030ae99ecea5',
  'operator': 'ec6e1c25258002eb1c67d15c7f45da7945fa4c58778fd7d88faa5e53e3b4698d'
};
// ...
const inputHash = await hashSHA256(pass);
if (inputHash === userHashes[unameLower]) { /* grant access, role = manager/operator */ }
```
This entire check happens in the browser, offline, with no network request and therefore **no possible rate limiting or lockout** — an attacker can try unlimited password guesses locally, at GPU speed, using tools like `hashcat`.

**Confirmed during this audit** — hashing a small list of common passwords locally reproduced both hashes exactly:
```
sha256("manager123")  == 866485796cfa8d7c0cf7111640205b83076433547577511d81f8030ae99ecea5   ✅ MATCH
sha256("operator123") == ec6e1c25258002eb1c67d15c7f45da7945fa4c58778fd7d88faa5e53e3b4698d   ✅ MATCH
```
(Credentials were derived and verified as a hash match only; they were **not** used to actually log into the live site, to avoid exceeding the scope of this verification.)

**Impact:** Anyone who views this public page's source has an unlimited, offline, undetectable window to crack these credentials — which is exactly what happened here in a handful of seconds. Logging in as "manager" via this path grants the same `role: 'manager'` RBAC state as a real approved Supabase manager account, including access to the (also broken, C1) `get_all_users`/`loadPendingUsers`/`loadAllUsers` admin panel, download/export buttons, and settings.

**Violates:** `security-rules.md` — *"Always hash passwords with a slow, salted algorithm (bcrypt, scrypt, or argon2); never store, log, or transmit plaintext passwords"* (SHA-256 is a fast, unsalted general-purpose hash — explicitly unsuitable for passwords) and *"Enforce a minimum-effort account lockout or backoff"* (impossible here since the check never reaches a server).

**Remediation:**
```
1. Remove this local/offline password fallback entirely — route 100% of authentication through Supabase Auth (server-side, real bcrypt hashing, rate-limited).
2. Rotate both the "manager" and "operator" passwords immediately — they are now public knowledge.
3. Never ship any form of password verification (hash comparison or otherwise) to the client.
```

---

### C3. Unauthenticated Backend Function Trigger — `trigger-scrape` — Confirmed Live During This Audit

> [!CAUTION]
> A Supabase Edge Function that appears to trigger a data-scraping job was successfully invoked with zero authentication.

**Evidence:**
```bash
curl -X POST "https://baizmeqkxslajxuzyfnu.supabase.co/functions/v1/trigger-scrape" \
  -H "apikey: sb_publishable_VRLqjdMb3uIie89vbRXloA_xdak8hgy" \
  -H "Authorization: Bearer sb_publishable_VRLqjdMb3uIie89vbRXloA_xdak8hgy" -d '{}'
# HTTP/2 200
```
> [!IMPORTANT]
> **Disclosure:** This request was made once during testing and returned `HTTP 200`, meaning the function executed. Given the page's own UI text references a Metabase session token needing periodic manual refresh ("Session Expiration Banner... Vui lòng chạy file 'Cập Nhật Session.command'"), this function likely uses a server-stored credential to pull data from an internal system on the caller's behalf — meaning anyone on the internet can now trigger that pull for free, repeatedly, with no rate limit observed.

**Impact:** Same class as the Telegram-send and sync-sheets findings from the earlier `hcm-report-v2` audit — an attacker can trigger backend work/outbound calls at will, potentially exhausting quota, invalidating sessions faster, or amplifying load on whatever internal system it scrapes.

**Remediation:**
```
1. Require a verified manager-role JWT (not just the anon key) to invoke this function.
2. Add rate limiting at the Edge Function or gateway level regardless.
```

---

### C4. Underlying Capacity Data Is Also Publicly Readable via a Published Google Sheet

Same recurring pattern as three of the five prior audits:
```javascript
const ACTUAL_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1RCdEDrhCwHKBQAsTNqZO-4vnxft9lcqa7Fe9IK8auZ8/gviz/tq?tqx=out:csv&gid=0';
```
```bash
curl -sSL ".../gviz/tq?tqx=out:csv&gid=0"
# "Volume xử lý_Actual","01/09/2025","02/09/2025",... — real operational volume data, no auth required
```
**Remediation:** Un-publish the sheet; proxy through the (properly-authorized, once C1-C3 are fixed) backend.

---

## 🟠 HIGH Finding

### H1. `system_secrets` Table Exists and Is Reachable via the Anonymous API Key

While probing table names, the PostgREST schema-cache error for a typo (`shipments`) suggested `public.system_secrets` as a "did you mean" match. A direct request confirmed the table is queryable by the anon key:
```bash
curl ".../rest/v1/system_secrets?limit=1" -H "apikey: <anon key>" -H "Authorization: Bearer <anon key>"
# HTTP 200
# []
```
The table is currently empty (or RLS filters all rows for the anon role — indistinguishable from outside), but a table named `system_secrets` being reachable at all via the public key, returning `200` rather than a permission error, is a red flag: if anything is ever inserted into it without adding an explicit RLS `DENY` policy for the anon role, it would be immediately world-readable — and given the pattern found in C1 (a sibling function missing its authorization check), that's a realistic risk here, not a hypothetical one.

**Remediation:**
```
1. Confirm RLS is enabled and explicitly denies anon SELECT on system_secrets (a 200 with an empty array is not proof of this — verify directly in the Supabase dashboard).
2. Rename/audit what this table is for; secrets belong in Supabase Vault or environment config, never a regular table reachable via PostgREST.
```

---

## 🟡 MEDIUM Findings

### M1. CSP Includes `'unsafe-eval'` and `'unsafe-inline'` in `script-src`
```
script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://cdn.sheetjs.com;
```
`'unsafe-eval'` and `'unsafe-inline'` substantially weaken CSP's ability to mitigate XSS — if any injection point is ever found, the CSP won't stop it from executing. (`sheetjs`'s `xlsx` library sometimes needs `unsafe-eval` for older builds, but this should be re-verified against the current version in use.)

**Remediation:** Audit whether `unsafe-eval` is actually required by the current `xlsx` version; move inline scripts to external files with nonces/hashes instead of `unsafe-inline`.

### M2. No Rate Limiting Observed on Supabase Auth Sign-In
Not independently brute-forced in this audit (Supabase Auth typically has platform-level protections), but worth confirming explicitly given the local-auth bypass in C2 shows the app's own team may not have rate limiting top-of-mind.

---

## 🔵 LOW Finding

### L1. No Real HTTP Security Headers (GitHub Pages Platform Limitation)
Same limitation as the other two GitHub Pages sites audited (`ktc-hn02`, `SortingDaily`): the CSP here is delivered via `<meta http-equiv>` only (confirmed absent from actual HTTP response headers), so `X-Frame-Options`/`frame-ancestors` cannot be enforced at all — this page can be iframed by any site.

---

## What's Done Right

- A **real backend with actual accounts, roles, and an admin-approval workflow** (Supabase Auth + `approved`/`role` metadata) — a meaningfully more mature design than the client-side-only or public-sheet patterns seen in four of the five prior audits.
- The **sign-up flow correctly defaults new accounts to `approved: false`**, requiring explicit manager approval before granting access — good intent, undermined only by C1's implementation bug.
- `get_pending_users` **does** correctly enforce a server-side manager-role check — proving the team knows how to do this correctly; it just wasn't applied consistently to `get_all_users`.
- `noindex`-equivalent hygiene and anti-cache headers are present at the page level.

---

## 📋 Prioritized Remediation Plan

| Priority | Action | Effort |
|----------|--------|--------|
| 🔴 **P0** | Add manager-role authorization check to `get_all_users` (mirror `get_pending_users`) | 30 minutes |
| 🔴 **P0** | Audit `approve_user`, `update_user_role`, `delete_user_by_id` for the same missing check — do not assume safety | 2-4 hours |
| 🔴 **P0** | Remove the local SHA-256 password fallback; rotate the exposed manager/operator passwords immediately | 2-4 hours |
| 🔴 **P0** | Require authenticated/authorized caller for `trigger-scrape` | 1-2 hours |
| 🟠 **P1** | Verify RLS explicitly denies anon access to `system_secrets` and any other sensitive table | 1 hour |
| 🔴 **P0** | Un-publish the capacity Google Sheet; proxy through authenticated backend | 2-4 hours |
| 🟡 **P2** | Tighten CSP — remove `unsafe-eval`/`unsafe-inline` where not strictly required | 2-4 hours |

> [!CAUTION]
> **This is the highest-urgency finding set across all six GHN dashboard audits to date.** C1 alone is a live, unauthenticated PII leak of the entire user base; C2 hands out working admin-equivalent credentials to anyone who reads the JS; C3 was confirmed exploitable in real time during this test. Recommend treating this as an active incident, not a backlog item — rotate credentials and patch the RPC authorization checks today, then work through the rest of the list.

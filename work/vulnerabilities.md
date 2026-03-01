# Vulnerability Remediation Plan

**Created:** 2026-03-01
**Source:** `npm audit` on `frontend/`
**Total:** 7 high severity

---

## Inventory

| # | Package | Severity | Advisory | Affects Production? |
|---|---------|----------|----------|---------------------|
| 1 | `next` 14.1.0 | High | [GHSA-9g9p](https://github.com/advisories/GHSA-9g9p-9gw9-jx7f) — DoS via Image Optimizer `remotePatterns` | Yes |
| 2 | `next` 14.1.0 | High | [GHSA-h25m](https://github.com/advisories/GHSA-h25m-26qc-wcjf) — DoS via insecure RSC deserialization | Yes |
| 3 | `glob` 10.3.10 (via `@next/eslint-plugin-next`) | High | [GHSA-5j98](https://github.com/advisories/GHSA-5j98-mcp5-4vw2) — Command injection via `--cmd` | No (dev-only) |
| 4 | `minimatch` 9.0.3 (via `@typescript-eslint/typescript-estree`) | High | [GHSA-3ppc](https://github.com/advisories/GHSA-3ppc-4f35-3m26) — ReDoS via repeated wildcards | No (dev-only) |
| 5 | `minimatch` 9.0.3 (via `@typescript-eslint/typescript-estree`) | High | [GHSA-7r86](https://github.com/advisories/GHSA-7r86-cg39-jmmj) — ReDoS via GLOBSTAR segments | No (dev-only) |
| 6 | `minimatch` 9.0.3 (via `@typescript-eslint/typescript-estree`) | High | [GHSA-23c5](https://github.com/advisories/GHSA-23c5-xmqv-rm74) — ReDoS via extglobs | No (dev-only) |
| 7 | `glob` 10.3.10 (via `@next/eslint-plugin-next` → `minimatch`) | High | (same glob tree) | No (dev-only) |

---

## Dependency Chain

```
eslint-config-next@14.1.0
├── @next/eslint-plugin-next@14.1.0
│   └── glob@10.3.10           ← #3, #7
│       └── minimatch@9.0.9
├── @typescript-eslint/parser@6.21.0
│   └── @typescript-eslint/typescript-estree@6.21.0
│       └── minimatch@9.0.3    ← #4, #5, #6
next@14.1.0                     ← #1, #2
```

---

## Remediation Options

### Option A: Stay on Next.js 14 (minimal risk)

Upgrade within the 14.x line. No breaking changes.

```bash
npm install next@14.2.35 eslint-config-next@14.2.35
```

**Fixes:** #1, #2 (production `next` vulnerabilities), #3, #7 (updated `glob` in `eslint-config-next@14.2.35`)
**Remaining:** #4, #5, #6 (`minimatch` in `@typescript-eslint` — dev-only, harmless in practice)
**Risk:** Low. Patch/minor upgrade within same major version.
**Effort:** ~30 minutes (install, run tests, verify dev server).

To also fix #4-#6, add an `overrides` block in `package.json`:

```json
{
  "overrides": {
    "@typescript-eslint/typescript-estree": {
      "minimatch": "^9.0.7"
    }
  }
}
```

### Option B: Upgrade to Next.js 15 (recommended long-term)

Major version bump. Next.js 15 has breaking changes (async request APIs, Turbopack default, React 19).

```bash
npm install next@15.5.12 eslint-config-next@15.5.12 react@19 react-dom@19 @types/react@19 @types/react-dom@19
```

**Fixes:** All 7 vulnerabilities. `eslint-config-next@15` pulls `@typescript-eslint/parser@8` which uses fixed `minimatch`.
**Risk:** Medium-high. Requires:
  - React 19 upgrade (concurrent features, `use()` hook, etc.)
  - Async `params`/`cookies`/`headers` in server components
  - Update `jest-environment-jsdom` config for React 19
  - Verify `react-hot-toast` compatibility with React 19
  - ErrorBoundary class component review (still supported in React 19)
  - Test all 682 frontend tests pass
**Effort:** ~2-4 hours with potential for unexpected breakage.

### Option C: Override only (quick patch)

Don't upgrade any direct dependencies. Use npm `overrides` to force safe versions of transitive deps.

```json
{
  "overrides": {
    "glob": "^10.4.6",
    "minimatch": "^9.0.7"
  }
}
```

**Fixes:** #3-#7 (dev-only transitive deps).
**Does NOT fix:** #1, #2 (the `next` package itself). These are the only production-relevant vulnerabilities.
**Risk:** Low but incomplete — leaves the production issues unresolved.
**Effort:** 5 minutes.

---

## Recommendation

**Do Option A now, Option B later.**

1. **Immediate (today):** Upgrade `next` and `eslint-config-next` to `14.2.35` + add `minimatch` override. This fixes all 7 vulnerabilities with minimal risk. The app uses no experimental Next.js features and `next.config.js` is empty, so a minor bump within 14.x should be seamless.

2. **Planned (post-MVP):** Schedule Next.js 15 + React 19 upgrade as a standalone task after the MVP ships. This is the right long-term move but introduces unnecessary risk during the current sprint.

---

## Execution Steps (Option A)

1. `cd frontend`
2. `npm install next@14.2.35 eslint-config-next@14.2.35`
3. Add `overrides` to `package.json` for `minimatch`
4. `rm -rf node_modules package-lock.json && npm install`
5. `npm audit` — verify 0 vulnerabilities
6. `npx jest --no-cache` — verify all 682 tests pass
7. `npx next dev` — verify dev server starts and pages load
8. Commit and push

---

---

# Backend Vulnerability Audit

**Created:** 2026-03-01
**Tool:** `pip-audit 2.10.0` against `backend/requirements.txt` (full transitive dependency scan)
**Installed Python:** 3.11
**Total CVEs found:** 1 (medium severity, no fix available)

---

## Inventory

| # | Package | Installed Version | Severity | Advisory | Fix Version | Affects Production? |
|---|---------|-------------------|----------|----------|-------------|---------------------|
| 1 | `ecdsa` 0.19.1 (via `python-jose`) | 0.19.1 | Medium | [CVE-2024-23342](https://nvd.nist.gov/vuln/detail/CVE-2024-23342) / [GHSA-wj6h-64fc-37mp](https://github.com/advisories/GHSA-wj6h-64fc-37mp) — Minerva timing attack on P-256 ECDSA signing | **None** (maintainers won't fix) | No — see analysis below |

All other packages across the full transitive graph (79 packages scanned) returned zero vulnerabilities:

| Key Package | Installed Version | Status |
|-------------|-------------------|--------|
| `fastapi` | 0.128.4 | Clean |
| `uvicorn` | 0.40.0 | Clean |
| `starlette` | 0.52.1 | Clean |
| `pydantic` | 2.12.5 | Clean |
| `pydantic-settings` | 2.12.0 | Clean |
| `httpx` | 0.28.1 | Clean |
| `anthropic` | 0.79.0 | Clean |
| `supabase` | 2.27.3 | Clean |
| `python-jose` | 3.5.0 | Clean (the package itself has no CVE; only its optional dep does) |
| `cryptography` | 46.0.4 | Clean |
| `python-multipart` | 0.0.22 | Clean |
| `pdfplumber` | 0.11.9 | Clean |
| `psycopg2-binary` | 2.9.11 | Clean |
| `pillow` | 12.1.0 | Clean |
| `requests` | 2.32.5 | Clean |
| `urllib3` | 2.6.3 | Clean |
| `certifi` | 2026.1.4 | Clean |

---

## Vulnerability Analysis

### CVE-2024-23342 — Minerva Timing Attack on `ecdsa`

**Description:** The `python-ecdsa` library's `sign_digest()` function leaks timing information during P-256 curve signing. An attacker with the ability to measure many signing operations and their durations can statistically recover the private signing key (Minerva attack). ECDSA signature verification is not affected.

**Why `ecdsa` is in the dependency tree:**

```
python-jose[cryptography]>=3.3.0   ← requirements.txt (direct)
└── ecdsa>=0.18.0                  ← python-jose's optional dep (always pulled by pip)
    └── six
```

`python-jose` lists `ecdsa` as a dependency but when the `[cryptography]` extra is installed (which it is — `cryptography 46.0.4` is present in the venv), python-jose's `ECKey` class resolves entirely to `jose/backends/cryptography_backend.py`, which uses the `cryptography` package for all EC operations. The `ecdsa` package's `ECDSAECKey` implementation is never instantiated.

**Crucially: this app does not use EC-based JWT signing at all.** The auth module (`app/auth.py`) calls `jwt.decode()` with `algorithms=["HS256"]` — an HMAC-based algorithm. No EC key material is ever passed to `python-jose`. The `ecdsa` package is a dead dependency at runtime.

**Additionally:** The CVE requires the attacker to observe timing of the target process performing *signing* operations (private key used). Supabase JWTs are issued and signed by Supabase's own auth server — the backend only *verifies* them. Even if the `ecdsa` backend were active, it would only be called during verification (unaffected per the CVE description).

**Exploitability in this context: None.**

---

## Dependency Chain

```
requirements.txt
└── python-jose[cryptography]>=3.3.0
    ├── ecdsa>=0.18.0             ← CVE-2024-23342 (installed but not exercised)
    │   └── six
    ├── pyasn1
    └── rsa
        └── pyasn1

At runtime, jose's ECKey resolves to:
python-jose[cryptography]
└── cryptography (46.0.4)         ← actual EC implementation used (clean)
    └── cffi
        └── pycparser
```

---

## Remediation Options

### Option A: Accept as informational (recommended)

The vulnerability is not exercised in this application. Document the finding and suppress the audit warning with a known-exceptions list.

**Rationale:**
- `ecdsa` is never called at runtime — the `cryptography` backend takes precedence when `python-jose[cryptography]` is installed
- The app uses HS256 only, not any EC algorithm
- The CVE requires timing *signing* operations; this backend only *verifies* tokens
- No fix version exists and the maintainers explicitly will not fix it
- No action needed until the dependency tree changes

To suppress the false positive in future `pip-audit` runs:

```bash
# Create a pip-audit ignore file
cat > /Users/bobsantos/likha/dev/likha-app/backend/.pip-audit-ignore << 'EOF'
# CVE-2024-23342: ecdsa Minerva timing attack
# ecdsa is pulled by python-jose but the cryptography backend takes precedence
# when python-jose[cryptography] is installed. This app uses HS256 only.
# No fix version available from upstream.
CVE-2024-23342
EOF
```

Then run: `pip-audit -r requirements.txt --ignore-vuln CVE-2024-23342`

**Risk:** None. The vulnerable code path is never reached.
**Effort:** 5 minutes (document and suppress).

### Option B: Replace `python-jose` with `PyJWT`

Eliminate `ecdsa` from the dependency tree entirely by switching the JWT library. `PyJWT` is already installed in the venv (pulled by another dependency) and supports HS256 with a simpler API. It has no `ecdsa` dependency.

Changes required in `app/auth.py`:

```python
# Before (python-jose):
from jose import jwt, JWTError, ExpiredSignatureError
payload = jwt.decode(token, SUPABASE_JWT_SECRET, algorithms=["HS256"], options={"verify_aud": False})

# After (PyJWT):
import jwt as pyjwt
from jwt.exceptions import ExpiredSignatureError, InvalidTokenError
payload = pyjwt.decode(token, SUPABASE_JWT_SECRET, algorithms=["HS256"], options={"verify_aud": False})
```

Then update `requirements.txt`:

```diff
-python-jose[cryptography]>=3.3.0
+PyJWT>=2.8.0
```

**Fixes:** Removes `ecdsa`, `pyasn1`, `rsa` from the dependency tree entirely.
**Risk:** Low. The auth logic is simple (HS256 decode + `sub` claim extraction). PyJWT is widely used and actively maintained. The API change is a one-file, five-line edit. Existing tests mock the auth layer so they will still pass; a manual verification of the JWT flow is needed.
**Effort:** ~1 hour (code change + manual auth smoke test + update `requirements.txt`).

### Option C: Pin `ecdsa` out and use `python-jose` without it

Remove the `[cryptography]` extra from `requirements.txt` and explicitly exclude `ecdsa`. Not recommended — `python-jose` without `[cryptography]` falls back to the pure-Python `ecdsa` backend for any EC operations, which is worse from a security standpoint if EC algorithms are ever added later.

---

## Recommendation

**Do Option A now; schedule Option B post-MVP.**

1. **Immediate (today):** The finding is genuinely a false positive for this application's threat model. Accept it, add the suppress comment to CI, and move on. There is zero exploitability risk.

2. **Planned (post-MVP):** Migrate from `python-jose` to `PyJWT`. `python-jose` is lightly maintained (last release 2023), whereas `PyJWT` is actively maintained by the Python Software Foundation. This is a good hygiene upgrade independent of the CVE. PyJWT is simpler, has no problematic transitive deps, and `cryptography` is already in the venv so HS256 acceleration is automatic.

---

## Execution Steps (Option A — suppress, then Option B migration)

### Option A (immediate)

```bash
cd /Users/bobsantos/likha/dev/likha-app/backend
pip-audit -r requirements.txt --ignore-vuln CVE-2024-23342
# Expected output: No known vulnerabilities found
```

### Option B (post-MVP migration to PyJWT)

1. Edit `backend/requirements.txt`:
   - Replace `python-jose[cryptography]>=3.3.0` with `PyJWT>=2.8.0`

2. Edit `backend/app/auth.py`, function `_verify_jwt_locally`:

```python
# Replace:
from jose import jwt, JWTError, ExpiredSignatureError

payload = jwt.decode(
    token,
    SUPABASE_JWT_SECRET,
    algorithms=["HS256"],
    options={"verify_aud": False},
)
# except ExpiredSignatureError / JWTError

# With:
import jwt as pyjwt
from jwt.exceptions import ExpiredSignatureError, DecodeError

payload = pyjwt.decode(
    token,
    SUPABASE_JWT_SECRET,
    algorithms=["HS256"],
    options={"verify_aud": False},
)
# except ExpiredSignatureError / DecodeError
```

3. Reinstall dependencies:
```bash
source backend/.venv/bin/activate
pip install -r backend/requirements.txt
```

4. Run backend tests:
```bash
source backend/.venv/bin/activate && python -m pytest backend/tests/ -x -q
```

5. Manual smoke test: start the dev server, log in via the frontend, make an authenticated API call, verify 200 response.

6. Run `pip-audit -r backend/requirements.txt` — verify 0 vulnerabilities.

7. Commit and push.

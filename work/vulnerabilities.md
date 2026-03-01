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

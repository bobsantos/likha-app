# Likha — Deferred Features

**Created:** 2026-02-24
**Purpose:** Consolidated reference for all features that are specified or discussed but not yet implemented.

---

## 1. Phase 1.2: Discrepancy Resolution

Full spec exists at `work/discrepancy-resolution-spec.md`. Implementation has not started.

**Problem it solves:** Phase 1 detects discrepancies but gives the licensor no way to act on them inside Likha. Amber badges accumulate with no distinction between "tracking this" and "haven't looked yet." The licensor is back to email and spreadsheets for follow-up.

**Priority:** High — this is the next logical sprint after Phase 2. Discrepancy detection without resolution is half a workflow.

**Complexity:** Medium — one migration, one new endpoint, a bug fix, and targeted UI additions across four frontend files.

### Schema changes

New migration: `supabase/migrations/[timestamp]_add_discrepancy_resolution.sql`

Three new columns on `sales_periods`:
- `discrepancy_status TEXT CHECK IN ('open', 'resolved', 'waived') NULL`
- `discrepancy_notes TEXT NULL`
- `discrepancy_resolved_at TIMESTAMPTZ NULL`

When `has_discrepancy = true` and `discrepancy_status` is NULL, treat as `open`.

### Backend changes

- `PATCH /api/sales/{period_id}/discrepancy` — set status (`open`, `resolved`, `waived`) and optional notes. Returns updated `SalesPeriodResponse`.
- Add `discrepancy_is_open: bool` computed field to `SalesPeriodResponse`: `has_discrepancy and discrepancy_status in (None, 'open')`.
- Update `GET /api/sales/dashboard-summary` to include `total_open_discrepancy_amount`, `open_discrepancy_count`, `discrepancy_contract_count`.
- Bug fix in `POST /api/sales/`: `licensee_reported_royalty` is accepted in `SalesPeriodCreate` but silently dropped during the DB insert. It must be included in the insert payload. See `backend/app/routers/sales.py` line 72–80.

### Frontend changes (in priority order)

1. **Filter strip on sales periods table** (`frontend/app/(app)/contracts/[id]/page.tsx`) — All / Discrepancies / Matched pill buttons above the table. No backend work needed.
2. **Improved upload preview discrepancy card** (`frontend/components/sales-upload/upload-preview.tsx`) — Replace passive amber message with structured card setting expectations about what happens after confirm. No backend work needed.
3. **Resolve button per discrepant row** (`frontend/app/(app)/contracts/[id]/page.tsx`) — Inline popover with status selector (Resolved / Waived) and optional note. Calls `PATCH /api/sales/{period_id}/discrepancy`. Needs backend.
4. **Discrepancy tile on dashboard summary** (`frontend/components/DashboardSummary.tsx`) — Third tile rendered only when `total_open_discrepancy_amount > 0`. Red/warning treatment. Needs backend.
5. **Discrepancy badge on ContractCard** (`frontend/components/ContractCard.tsx`) — Compact red badge when a contract has open discrepancies. Requires `open_discrepancy_amount` on the contract list response. Needs backend.

### TypeScript type additions

File: `frontend/types/index.ts` — add to `SalesPeriod`:
```typescript
discrepancy_status?: 'open' | 'resolved' | 'waived' | null
discrepancy_notes?: string | null
discrepancy_resolved_at?: string | null
discrepancy_is_open?: boolean
```

### New API function

File: `frontend/lib/api.ts`:
```typescript
resolveDiscrepancy(periodId: string, status: string, notes?: string): Promise<SalesPeriod>
```

---

## 2. Deferred from Phase 1.2

These items were explicitly excluded from the discrepancy resolution spec (`work/discrepancy-resolution-spec.md`, "What This Does NOT Include" section). They require either a licensee portal or additional infrastructure beyond the current scope.

| Feature | Why Deferred | Prerequisites |
|---|---|---|
| Automated email to licensee from within Likha | Requires email delivery setup and careful UX to avoid spammy workflows | Licensee email on contract (already added in Phase 2), email service configuration |
| Formal dispute workflow with licensee responses | Requires a licensee portal for the other party to respond | Licensee portal (see v2 section) |
| Payment tracking (actual payment received vs. owed) | Separate data entry workflow; adds complexity without validating the core discrepancy loop first | None technical, but scope discipline |
| Audit log / event history table | New DB table, backend event emission on every state change | Schema design decision on event granularity |
| Late fee calculation | Contract-specific fee schedules vary widely; high risk of incorrect calculations | Audit log, payment tracking |

---

## 3. Day 10: Polish and Deploy

From `work/plan.md`, Day 10 tasks remain incomplete. These are not blocked by any other feature work.

**Priority:** Required before public launch. Medium complexity individually; high cumulative value.

### Frontend

**Error handling and loading states**
- Global error boundary component
- Skeleton loaders for dashboard (currently bare loading states)
- Spinners for form submissions
- Progress bars for file uploads
- Toast notifications for success/failure feedback
- Form validation improvements

**Mobile responsiveness**
- Test all pages at 375px, 768px, and 1024px viewports
- Hamburger menu on mobile (current nav is desktop-only)
- Touch-friendly button sizes (minimum 44px tap targets)

**Accessibility**
- ARIA labels on interactive elements
- Keyboard navigation through upload wizard and contract form

### Backend

**Integration tests** (`backend/tests/test_integration.py` — file listed in plan but not yet created)
- Full auth flow
- Contract upload → extraction → create
- Sales period create → YTD summary
- Discrepancy calculation end-to-end
- Mock Anthropic API to avoid costs

**Railway deployment**
- `backend/Dockerfile`
- `backend/railway.json`
- Environment variable documentation

**Cascade delete** — There is a TODO comment in `backend/app/routers/contracts.py` at line 496:
```python
# TODO: Delete associated sales periods (will be handled by cascade delete in DB)
```
This is currently handled at the DB layer by a foreign key cascade, but the comment should be verified against the migration and removed once confirmed.

### Manual testing checklist (from plan.md)

All items remain unchecked for deployed environments:
- Sign up / login on deployed app
- Full upload → extraction → review → confirm flow
- Sales period entry and discrepancy display
- Error states (invalid file, API errors)
- Mobile viewport testing
- Logout and redirect

---

## 4. Phase 2 Deferred Items

Phase 2 is marked complete in `work/plan.md` as of 2026-02-24, but one item was explicitly deferred during that sprint.

### Dashboard badge for pending inbox reports count

**What:** A badge on the nav or dashboard showing the count of unreviewed inbound reports (status = `pending`).

**Current state:** The nav shows a link to `/inbox`. The count appears only as the page title on the inbox list view itself.

**Why deferred:** Considered MVP-sufficient to ship Phase 2. The inbox page communicates pending count when the user navigates there.

**Implementation approach:** The `GET /api/email-intake/` endpoint already returns all inbound reports with status. A simple client-side count from the list response could populate a `<Badge>` component on the nav link. Alternatively, a dedicated `GET /api/email-intake/pending-count` endpoint could avoid fetching full report objects just for the badge.

**Source:** `work/plan.md`, Phase 2 checklist — `[ ] Frontend: dashboard badge for pending reports count (deferred — MVP ships with nav link showing count in page title)`.

### Populating sample values in AI column mapping prompts

**What:** When the Phase 1.1 spreadsheet upload calls Claude for AI-assisted column mapping suggestions, the prompt could include sample cell values from the uploaded file alongside the column headers. This would improve mapping accuracy for ambiguous headers (e.g., a column named "Amount" is more clearly "net_sales" if sample values look like revenue figures).

**Current state:** The AI mapping prompt includes column headers and contract context but not sample values from the actual uploaded file. The `UploadPreviewResponse` type already returns `sample_rows` to the frontend for display, so sample data is available in the backend at mapping time.

**Why deferred:** The keyword synonym matching already handles most standard spreadsheet formats. AI mapping fills the gap for non-standard headers. Adding sample values would improve edge case accuracy but is an optimization, not a correctness fix.

**Implementation approach:** In `backend/app/services/spreadsheet_parser.py`, in the `suggest_mapping` function (or wherever the Claude API call is constructed), include the first 3-5 sample values per column in the prompt payload alongside the column names.

**Source:** Referenced in `work/plan.md` Phase 2 section notes.

---

## 5. v2 Features

From `work/plan.md`, "Deferred to v2" section. These are out of scope for the current roadmap and require either significant new infrastructure, multi-party workflows, or do not validate the core licensor workflow.

| Feature | Notes |
|---|---|
| Email verification and forgot password flow | Auth UX polish; Supabase has built-in support, just needs wiring |
| Contract editing | Users can currently only delete and re-upload; editing confirmed contracts is a common need |
| Contract deletion via UI | Backend `DELETE /api/contracts/{id}` exists and is tested; no frontend UI exposes it |
| Sales period editing | Backend `DELETE /api/sales/{id}` exists; no edit endpoint or UI |
| Sales period deletion via UI | Backend endpoint exists; no UI |
| PDF viewing in browser | Signed URLs exist and are returned; no in-app viewer is rendered |
| Multi-user accounts (teams) | Single-owner model only; no sharing, roles, or team invitations |
| Payment tracking | Tracking actual payment received vs. calculated royalty owed; separate from discrepancy resolution |
| Email reminders for report due dates | `days_until_report_due` computed field already exists on `ContractResponse`; just needs a scheduled job and delivery |
| Licensee portal | Self-service report submission by the licensee; removes email-and-upload friction entirely |
| Multi-currency support | All values stored as plain numbers; no currency code on contracts or sales periods |
| Advanced analytics and charts | YTD summary data exists; no visualization layer |
| Audit log | No event history table; state changes are not tracked |
| Late fee calculation | Depends on audit log and payment tracking |
| CSV export of summaries | No export endpoint; data is available in the API |
| OAuth inbox integration | Explicitly excluded in favor of the forwarding address approach (Postmark inbound webhook); noted as intentional in plan.md |

---

## 6. AI Column Mapping as a Premium Feature

**Context:** This item comes from a product discussion on 2026-02-24 and is not recorded in any existing spec file.

**What:** The AI-assisted column mapping added in Phase 2 uses Claude (haiku-4-5) to resolve column header ambiguities in uploaded spreadsheets. The cost per call is approximately $0.0004 — effectively negligible per user but potentially meaningful at scale.

**The idea:** Gate AI column mapping behind a paid tier. Free users receive keyword-synonym matching only (Phase 1.1 behavior). Paid users get AI-augmented suggestions. This creates a visible, demonstrable quality difference between tiers and gives a concrete upgrade reason at the moment a user hits a spreadsheet with non-standard headers.

**Implementation approach:**
- The `suggest_mapping` function in `backend/app/services/spreadsheet_parser.py` already accepts a `contract_context` parameter used to build the Claude prompt.
- For free users, pass `contract_context=None` — the code already has a conditional path that skips the Claude call when context is absent. Verify this is the correct parameter to control the AI call versus the current implementation.
- The upload endpoint in `backend/app/routers/sales_upload.py` would need to check the user's plan tier before deciding whether to pass contract context.
- The `mapping_source` field in `UploadPreviewResponse` already distinguishes `"saved"`, `"suggested"` (keyword), and `"ai"` — the frontend can use this to show an upsell prompt when `mapping_source` is `"suggested"` on a free account with unresolved columns.

**Note:** The cost argument does not block this decision either way. At current scale the cost is negligible. The value is marketing differentiation, not cost containment.

**Source:** Product discussion, 2026-02-24. Not in any spec file.

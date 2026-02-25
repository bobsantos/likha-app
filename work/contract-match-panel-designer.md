# Contract Match Panel — Design Recommendations

**File:** `frontend/app/(app)/inbox/[id]/page.tsx`
**Component in scope:** `ContractMatchSection` and the surrounding "Contract Match" card
**Status:** Design spec — not yet implemented

---

## 1. The Core Problem

Today the "Contract Match" card shows only the licensee name (or a dropdown of names). A licensor looking at a freshly-arrived email report has two questions before they can confirm it:

1. **Is the matched contract actually the right one?** — licensee name alone is not enough when a licensee has multiple contracts, when there are two licensees with similar names, or when the system matched on a partial string.
2. **Does the attachment look like what I expect?** — a row of metadata from the file (period, contract reference, licensee name as written in the file) lets the licensor cross-check in seconds without downloading the file.

Both questions must be answerable without leaving the page.

---

## 2. Layout Recommendation: Stacked Sections, Not Side-by-Side

### Why not side-by-side (two columns)?

The page is already constrained to `max-w-3xl` — approximately 672px. A true side-by-side comparison at that width pushes both columns to ~300px, which is too narrow for the attachment preview table (typically 6–8 columns of financial data). On mobile it forces a horizontal scroll within a horizontal scroll.

### Recommended structure: three stacked zones inside the card

```
┌─────────────────────────────────────────────────────────────┐
│  CONTRACT MATCH CARD                                        │
│                                                             │
│  Zone A — Match status banner (confidence-driven)           │
│  ─────────────────────────────────────────────────────────  │
│  Zone B — Contract details (key facts from the contract)    │
│  ─────────────────────────────────────────────────────────  │
│  Zone C — Attachment preview (metadata rows + data sample)  │
└─────────────────────────────────────────────────────────────┘
```

Zone A already exists (the green/amber banner). Zones B and C are new. The separator between B and C is a hairline border (`border-t border-gray-100`) — not a heading — so the card reads as one cohesive block rather than two separate components.

---

## 3. Visual Hierarchy: What the Licensor Sees First

Reading order maps directly to decision confidence:

1. **Match status** (Zone A) — the most prominent element. "Auto-matched" green banner or amber warning. This sets the user's mental stance before they read anything else.
2. **Contract name + agreement number** (top of Zone B) — confirm "yes, this is the right licensee and the right contract number." These two pieces together are more trustworthy than name alone.
3. **Contract period and rate** (remainder of Zone B) — secondary sanity check. If the report covers Q1 2025 and the contract expired in 2024, the licensor catches it here.
4. **Attachment metadata rows** (top of Zone C) — the licensee's own header rows from the file (licensee name as written in the file, contract reference, reporting period). This is the cross-check: do the file's self-reported values match the contract on record?
5. **Sample data rows** (bottom of Zone C) — 2–3 actual data rows from the spreadsheet. These confirm the file contains recognizable financial data and give the licensor a gut-check on magnitude.

---

## 4. Zone B — Contract Details Panel

Show these fields in a compact two-column key/value grid. Use the same icon+label+value pattern already established in the Report Details card and the Contract Detail page.

**Fields to show (in order):**

| Label | Source | Notes |
|---|---|---|
| Licensee | `contract.licensee_name` | Already shown — keep it |
| Agreement Ref | `contract.agreement_number` | Displayed as `font-mono` badge — same style as contract detail page |
| Contract Period | `contract_start_date` – `contract_end_date` | Formatted as "Jan 1, 2024 – Dec 31, 2025" |
| Royalty Rate | `contract.royalty_rate` | Use the `formatRoyaltyRate` helper from the contract detail page |
| Reporting Frequency | `contract.reporting_frequency` | "Quarterly", "Monthly", etc. |

Use a `grid grid-cols-2 gap-x-6 gap-y-3` layout inside Zone B so name/period are on the left and rate/frequency on the right. On mobile collapse to single column with `sm:grid-cols-2`.

**Why agreement number is critical here:** The backend's Signal 2 matching fires on the agreement number found in attachment text. If the licensor sees that the agreement number in the contract record matches what's in the file preview, confidence in the match is dramatically higher. If they don't match, they know immediately something is wrong.

**Tailwind structure:**

```tsx
<div className="pt-4 border-t border-gray-100">
  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
    Matched Contract
  </p>
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
    <div>
      <p className="text-xs text-gray-500">Licensee</p>
      <p className="text-sm font-medium text-gray-900">{contract.licensee_name}</p>
    </div>
    <div>
      <p className="text-xs text-gray-500">Agreement Ref</p>
      <p className="text-sm font-mono font-medium text-gray-900">
        {contract.agreement_number ?? <span className="text-gray-400">None</span>}
      </p>
    </div>
    <div>
      <p className="text-xs text-gray-500">Contract Period</p>
      <p className="text-sm font-medium text-gray-900">...</p>
    </div>
    <div>
      <p className="text-xs text-gray-500">Royalty Rate</p>
      <p className="text-sm font-medium text-gray-900">...</p>
    </div>
    <div>
      <p className="text-xs text-gray-500">Reporting Frequency</p>
      <p className="text-sm font-medium text-gray-900 capitalize">...</p>
    </div>
  </div>
</div>
```

Zone B is only rendered when `selectedContractId` is truthy — i.e., there is actually a contract selected. When the user is in the no-match state and hasn't chosen yet, Zone B stays hidden.

---

## 5. Zone C — Attachment Preview

### What data is needed from the backend

The `InboundReport` type currently has no parsed attachment content fields — only `attachment_filename`, `attachment_path`, and the two `suggested_period_*` fields (which were themselves parsed from the attachment).

The frontend engineer will need to add two fields to `InboundReport` (and the backend model):

```ts
attachment_metadata_rows: Record<string, string> | null
// e.g. { "Licensee Name": "Sunrise Apparel Co.", "Contract Number": "BC-2024-0042", ... }

attachment_sample_rows: Record<string, string>[]
// e.g. [{ "Product Description": "...", "Net Sales": "83300.00", ... }, ...]
```

These would be populated at webhook ingestion time (alongside `suggested_period_*`) by scanning the first ~20 rows of the attachment text — the same scan already done in `_extract_period_dates`. A light parser would extract the two-cell `Key,Value` metadata rows at the top into `attachment_metadata_rows`, and capture the first 2–3 data rows below the header row into `attachment_sample_rows`.

### Display format: a truncated spreadsheet view, not a code block

A `<table>` with horizontal scroll is the correct choice. A code block (monospace text dump) would be hard to scan. A "spreadsheet preview" table with scrolling is visually closest to what the licensee's actual file looks like, which aids recognition.

**Metadata rows** appear as a simple two-column definition list (label | value), styled like the Report Details card:

```
Licensee Name      Sunrise Apparel Co.
Contract Number    BC-2024-0042
Reporting Period   Jan 1, 2025 – Mar 31, 2025
Territory          United States
```

**Sample data rows** appear as a small table. To handle potentially wide spreadsheets (6–8 columns) without breaking the page layout:

- Wrap in `overflow-x-auto` — horizontal scroll only within the preview zone
- Cap height at approximately 3 data rows — no vertical scroll needed
- Truncate long cell values to ~20 characters with `truncate max-w-[8rem]`
- Show column headers in `text-xs font-semibold text-gray-500` (same as sales period table headers)
- Show data values in `text-xs text-gray-700 tabular-nums`
- Right-align numeric columns (the parser will need to hint this, or the frontend can detect it)

**Why truncated spreadsheet over a raw data table:**
The sample CSVs show that product description columns can be long ("Licensed Branded Apparel - All SKUs"). The user doesn't need the full description — they need to recognize the data as royalty data. Truncating with ellipsis and right-aligning numbers gives the visual density of a spreadsheet without overwhelming the card.

### Tailwind structure for Zone C:

```tsx
<div className="pt-4 border-t border-gray-100">
  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
    Attachment Preview
  </p>

  {/* Metadata rows */}
  {attachmentMetadataRows && Object.keys(attachmentMetadataRows).length > 0 && (
    <dl className="space-y-1.5 mb-4">
      {Object.entries(attachmentMetadataRows).map(([key, value]) => (
        <div key={key} className="flex gap-3 text-sm">
          <dt className="w-36 flex-shrink-0 text-gray-500">{key}</dt>
          <dd className="font-medium text-gray-900 truncate">{value}</dd>
        </div>
      ))}
    </dl>
  )}

  {/* Sample data rows */}
  {attachmentSampleRows && attachmentSampleRows.length > 0 && (
    <div className="overflow-x-auto rounded border border-gray-200">
      <table className="min-w-full text-xs">
        <thead className="bg-gray-50">
          <tr>
            {Object.keys(attachmentSampleRows[0]).map((col) => (
              <th key={col} className="px-3 py-2 text-left font-semibold text-gray-500 whitespace-nowrap">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {attachmentSampleRows.slice(0, 3).map((row, i) => (
            <tr key={i} className="bg-white">
              {Object.values(row).map((cell, j) => (
                <td key={j} className="px-3 py-2 text-gray-700 max-w-[8rem] truncate tabular-nums">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-1.5 text-xs text-gray-400 bg-gray-50 border-t border-gray-100">
        Showing first 3 rows of attachment
      </p>
    </div>
  )}

  {/* Fallback when no preview is available */}
  {(!attachmentMetadataRows && !attachmentSampleRows) && (
    <p className="text-sm text-gray-400 italic">
      No preview available for this attachment.
    </p>
  )}
</div>
```

Zone C is only rendered when `report.attachment_filename` is non-null — no attachment means no preview section.

---

## 6. Confidence-Driven Design Changes

The three match states already have correct banner treatment (green / amber / amber). The new zones adapt as follows:

### State 1: High confidence auto-match (green banner)

- Zone A: existing green banner — no change
- Zone B: always visible with full contract details — this is the primary trust signal after the green banner
- Zone C: visible but visually de-emphasized — `opacity-90` or standard rendering
- The "Not the right contract? Change it" link remains at the bottom of Zone A

Rationale: the licensor needs to quickly scan Zone B to validate the match, then Zone C to confirm the data looks right. The flow is fast: green banner → scan contract facts → glance at preview → confirm.

### State 2: Medium confidence suggestions (amber banner)

- Zone A: existing amber banner
- Zone B: rendered for whichever suggestion card is currently selected/hovered — i.e., Zone B is **dynamic** and updates as the user moves between suggestion cards. This is the key UX enhancement: hovering or clicking a suggestion immediately updates the contract facts panel below it, letting the user compare candidates without navigating away.
- Zone C: visible and at normal weight — this is where the user is actively comparing, so the preview is more important here than in State 1
- The suggestion cards themselves remain above Zone B; Zone B acts as a detail panel below the card list

This requires `SuggestionCard` to call `setHoveredContractId` (a new local state) on `onMouseEnter` in addition to `onSelect` on click. Zone B reads from `hoveredContractId ?? selectedContractId`.

### State 3: No match (amber banner + select dropdown)

- Zone A: existing amber banner + contract select
- Zone B: only appears once the user has selected a contract from the dropdown
- Zone C: always visible if the attachment has data — this is now the primary clue the licensor uses to figure out which contract to select. The metadata rows (especially the contract number in the file) guide the manual selection.

Rationale: in State 3, Zone C is doing the most work. The licensor reads the contract number from Zone C and uses it to find the right contract in the dropdown. Zone B then confirms their selection.

---

## 7. Suggestion Card Enhancement

The current `SuggestionCard` shows only the licensee name and a "licensee name" badge explaining why it matched. With the new Zone B visible, the card itself can stay compact — it does not need to repeat contract details.

However, the match reason badge should be enhanced to be more specific:

- Email match → `bg-blue-100 text-blue-700` badge with text "email match"
- Agreement ref match → `bg-blue-100 text-blue-700` badge with text "ref # match" — this is a stronger signal and should be visually distinct from name match
- Licensee name match → `bg-gray-100 text-gray-500` badge with text "name match" (existing behavior)

The confidence pill on suggestion cards uses a hardcoded score of 65. This is acceptable for now but the badge text differentiation above is more informative.

---

## 8. Accessibility Considerations

### Preview table

- Use `<table>`, `<thead>`, `<tbody>`, `<th scope="col">` — not a styled `<div>` grid. Screen readers announce table navigation and cell/column relationships.
- The caption is implied by the section heading "Attachment Preview" immediately above the table. No additional `<caption>` is needed if the heading is associated via proximity, but adding `aria-labelledby` pointing to the section heading is best practice.
- Truncated cells: when `truncate` clips text, add a `title` attribute with the full cell value so mouse users can hover to read it. Screen readers receive the full text content regardless of visual truncation.

```tsx
<td
  key={j}
  title={cell}
  className="px-3 py-2 text-gray-700 max-w-[8rem] truncate tabular-nums"
>
  {cell}
</td>
```

### Contract details grid

- Use `<dl>` / `<dt>` / `<dd>` semantics for the key/value pairs in Zone B. The current icon+label+value pattern in the Report Details card uses plain `<p>` tags — this works visually but `<dl>` is more semantically correct for labeled data and is better announced by screen readers.
- If Zone B is conditionally hidden and revealed (especially in State 3 when a contract is selected from the dropdown), wrap it in a live region: `aria-live="polite"`. This announces to screen reader users that the contract details have updated.

### Dynamic Zone B (State 2 hover behavior)

- The hover-to-preview feature must also work via keyboard. When a suggestion card receives focus (via Tab), Zone B should update to show that contract's details — not just on hover.
- Use `onFocus` alongside `onMouseEnter` to update `hoveredContractId`.
- The contract details region should have `aria-live="polite"` so keyboard users hear the update announced.

### Color contrast

All existing badges and text meet contrast requirements (checked against design system). The new preview table cells use `text-gray-700` on white (`bg-white`) — contrast ratio approximately 7:1, well above WCAG AA.

The section label "Attachment Preview" uses `text-gray-500` on white — contrast ratio approximately 3.9:1. This meets AA for large text (which this is, as an uppercase label at the scale of `text-xs` with `tracking-wide` — borderline). To be safe, use `text-gray-600` instead for the uppercase section headings. Contrast ratio becomes approximately 5.9:1.

---

## 9. Mobile Responsiveness

The preview table is the most challenging element on narrow screens. Recommended approach:

### Three tiers of mobile handling

**Tier 1 — < 375px (very small phones):** Hide the sample data table entirely. Show only the metadata rows (the definition list). These are narrow by nature and fit any screen.

```tsx
<div className="overflow-x-auto rounded border border-gray-200 hidden sm:block">
  {/* sample data table */}
</div>
<p className="text-xs text-gray-400 sm:hidden mt-1">
  Open the attachment to view sales data.
</p>
```

**Tier 2 — 375px–640px (standard mobile):** Show the table inside `overflow-x-auto`. The user can swipe horizontally to see all columns. This is a common and understood mobile pattern for financial tables — the contract detail page already uses it for the sales periods table.

Reduce cell padding to `px-2 py-1.5` on mobile and ensure `whitespace-nowrap` on all cells so the table doesn't reflow unexpectedly.

**Tier 3 — > 640px (tablet and desktop):** Full table as described in section 5.

### Contract details grid (Zone B)

The `grid grid-cols-1 sm:grid-cols-2` approach handles this cleanly. On mobile the 5 fields stack vertically. At `sm:` (640px) they form a 2-column grid. No horizontal scroll issues — all values are text.

### Suggestion cards

No changes needed. The existing full-width card layout is already mobile-appropriate.

---

## 10. Empty / Loading States

### While attachment preview data is loading

If `attachment_metadata_rows` and `attachment_sample_rows` are fetched asynchronously (separate from the main report fetch), show a skeleton:

```tsx
{previewLoading && (
  <div className="space-y-2 pt-4 border-t border-gray-100">
    <div className="skeleton h-3 w-24" />
    <div className="skeleton h-4 w-full" />
    <div className="skeleton h-4 w-3/4" />
    <div className="skeleton h-16 w-full mt-2" />
  </div>
)}
```

If the preview data comes bundled with the main report response (preferred — single fetch), no separate loading state is needed.

### When attachment exists but parsing found no structured data

This happens with poorly-formatted attachments or PDFs. Show:

```tsx
<div className="flex items-center gap-2 text-sm text-gray-400 pt-4 border-t border-gray-100">
  <FileSpreadsheet className="w-4 h-4 flex-shrink-0" />
  <span>Preview not available — open the attachment to review.</span>
</div>
```

Importantly, do not show an error state here. The inability to parse a preview is not an error — it's a limitation. Neutral gray, informational tone.

---

## 11. Relationship to the Existing `DetectedPeriodRow` Component

The `DetectedPeriodRow` component currently lives in the Report Details card (above the Contract Match card). The suggested period dates come from `report.suggested_period_start` / `report.suggested_period_end`.

With the new Zone C in place, the period information appears twice: once in `DetectedPeriodRow` and once in the attachment metadata rows. This is minor redundancy.

Recommendation: keep `DetectedPeriodRow` in the Report Details card where it is. It's a prominent blue callout that draws attention to the detected period early in the review flow. The period appearing again in Zone C's metadata rows is contextual (showing how the period appears in the file), not redundant — they serve different reading purposes.

If the team finds the duplication distracting, `DetectedPeriodRow` can be removed from Report Details once Zone C is live. But do not remove it preemptively before Zone C is built and tested.

---

## 12. Implementation Sequence for the Frontend Engineer

1. **Backend first:** Add `attachment_metadata_rows` and `attachment_sample_rows` to the `InboundReport` Pydantic model and populate them at ingestion time in `_process_inbound_email`. Update the `InboundReport` TypeScript type to match.
2. **Zone B:** Add the contract details grid inside `ContractMatchSection`. It reads from the already-available `contracts` array and `selectedContractId`. No new data fetching required.
3. **Zone C (metadata):** Add the definition list for attachment metadata rows. Gated on `report.attachment_metadata_rows !== null`.
4. **Zone C (table):** Add the scrollable sample data table. Gated on `report.attachment_sample_rows` having at least one row.
5. **Hover-to-preview in State 2:** Add `hoveredContractId` state and `onMouseEnter`/`onFocus` handlers to `SuggestionCard`. Update Zone B to read from `hoveredContractId ?? selectedContractId`.
6. **Accessibility pass:** Add `aria-live="polite"` to Zone B wrapper, `title` attributes to truncated table cells, `<dl>`/`<dt>`/`<dd>` semantics to Zone B grid.

---

## 13. What Not to Change

- The overall three-state logic in `ContractMatchSection` is sound. Do not refactor the state machine.
- The `ConfidencePill` component is correct. Leave it on the auto-match banner and suggestion cards.
- The `AttachmentPreviewStrip` (filename display) in the Report Details card should remain. Zone C supplements it; it does not replace it.
- The action buttons (Confirm / Confirm Only / Reject) are outside this scope. No changes recommended there.
- The `max-w-3xl` page width constraint is appropriate for a review/decision flow. Do not widen the page to accommodate the new content — instead design the content to fit within it (which is achievable with the horizontal scroll pattern for tables).

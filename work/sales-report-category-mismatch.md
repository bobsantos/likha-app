# Sales Report Category Mismatch — Resolution Feature

## Problem

When a licensee uploads a sales report, the report may use different category names than what the contract defines. For example:

| Contract Category | Royalty Rate | Report Category |
|---|---|---|
| Apparel | 10% | "Tops & Bottoms" |
| Accessories | 12% | "Hard Accessories" |
| Footwear | 8% | "Footwear" (exact match) |

Currently the backend raises a hard 400 error on the first unknown category, blocking the upload entirely. The frontend was also showing a generic error instead of the detailed message (fixed separately in `extractErrorMessage` in `frontend/lib/api.ts`).

This is not an edge case. In real licensing operations, licensees generate reports from their own ERP/warehouse systems with their own internal category taxonomy. Category name divergence is the norm for any contract with category-specific rates.

### Why This Matters

Category mapping is not cosmetic. The Meridian contract has a 4-point spread between its lowest and highest rate (8% Footwear vs. 12% Accessories). A wrong mapping produces incorrect royalties with audit and legal implications. Any solution must make the category-to-rate assignment explicit and user-confirmed.

---

## Recommendation

**AI-assisted category mapping at upload time, shown as a conditional Step 2.5 in the upload wizard.**

All four agents (PM, Designer, Backend, Frontend) converged on this approach:

1. After the user confirms column mapping (Step 2), check if the report contains category values that don't match the contract's category names.
2. If mismatches exist, show a new **Category Mapper** step (Step 2.5) before the confirmation/preview step.
3. Pre-fill with AI suggestions (using Claude, same pattern as column mapping).
4. User explicitly confirms each mapping before proceeding.
5. Save confirmed aliases for future uploads from the same licensee.
6. When no mismatches exist (flat-rate contracts, or all categories match exactly), skip Step 2.5 entirely.

### Why This Approach

- **Solves the first-upload problem** — user doesn't need to pre-configure anything
- **AI makes strong suggestions** — "Tops & Bottoms" → "Apparel" is a semantic match that substring/fuzzy logic can't make
- **User always confirms** — data integrity preserved for financial calculations
- **Saved aliases** — subsequent uploads from the same licensee are automatic
- **Reuses existing patterns** — same UX as column mapping, same AI infrastructure, same save mechanism

### What Not to Build Now

- **Contract-level alias editor** — pushes work onto the licensor before they've seen a report; doesn't solve first-upload case
- **Fuzzy/substring-only matching** — "Tops & Bottoms" and "Apparel" share zero tokens; no string distance metric bridges semantic synonyms reliably
- **Error-then-recover flow** — bad UX (user hits a wall) + 15-minute upload TTL risk

---

## Implementation Plans

### Product Manager — Requirements & Edge Cases

**Core Requirements:**
- Category resolution is only needed when the contract has category-specific rates (`CategoryRate` type)
- Every report category must be explicitly mapped to a contract category or marked "Exclude from calculation"
- AI suggestions are pre-filled but never auto-applied — user must review and confirm
- Saved category aliases are loaded on subsequent uploads and pre-filled (tagged "Auto" like column mappings)

**Edge Cases to Handle:**

| Scenario | Behavior |
|---|---|
| New category not in contract (e.g., "Electronics" on an Apparel contract) | Dropdown includes "Exclude from calculation" option. Excluded categories captured in metadata but don't contribute to royalties. |
| Typos ("Foorwear" vs "Footwear") | AI suggestion catches these; substring matching alone would not. |
| Category spans multiple contract categories | Map to single contract category + surface a note. Don't split-allocate — contract itself says "classified by mutual written agreement." |
| Zero sales in a category | Fine — $0 mapped to any category produces $0 royalty. |
| Saved alias becomes stale (licensee changes names) | Only apply saved aliases for category names present in current upload. Ignore stale entries silently. |
| All categories match exactly | Skip Step 2.5 entirely — no UI interruption. |
| Flat-rate or tiered-rate contracts | No category resolution needed. Step 2.5 never shown. |
| Many categories (10-20 in a large report) | Scrollable table with count banner. |
| Wrong file uploaded (categories make no sense for this contract) | Escape hatch: "Don't see the right category? This report may be for a different contract." |

**Acceptance Criteria:**
- [ ] Upload flow works end-to-end for category-rate contracts with mismatched category names
- [ ] AI suggestions are shown with source indicators (AI badge, Auto badge for saved aliases)
- [ ] User can map every report category to a contract category or exclude it
- [ ] Saved aliases auto-fill on subsequent uploads from the same licensee
- [ ] Flat-rate and tiered-rate contracts are completely unaffected
- [ ] Royalty calculations use the resolved (contract-canonical) category names

---

### Product Designer — UX Specification

**Step Indicator:** Stays at 3 steps. Step 2.5 shows as a sub-label "Resolve Categories" under the Step 2 bubble. No fourth bubble added.

```
Step indicator (during category resolution):
─────────────────────────────────────────────────────────
 [✓]────────────[●]────────────────────────[ ]
 Upload File   Map Columns                Preview Data
               Resolve Categories
               (sub-label, only shown during 2.5)
```

**Category Resolver Screen Layout:**

```
┌─────────────────────────────────────────────────────────────────┐
│  Map Category Names                                              │
│  Your file uses different category names than the contract.      │
│  Tell us which contract category each one belongs to.            │
│                                                                  │
│  ┌─ amber banner (when 1+ unmapped) ──────────────────────────┐ │
│  │  ⚠  All categories must be mapped before you can continue. │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ table ─────────────────────────────────────────────────────┐│
│  │  IN YOUR FILE          CONTRACT CATEGORY       RATE         ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │  ✓ Footwear            Footwear (exact match)  8%           ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │  ● Tops & Bottoms  AI  [Apparel          ▼]   10%          ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │  ● Hard Accessories AI [— choose one —   ▼]                ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─ info banner ──────────────────────────────────────────────┐ │
│  │  ℹ  1 matched automatically. 1 suggested by AI.            │ │
│  │     1 needs your attention.                                 │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ☑  Save these category aliases for future uploads from          │
│     Meridian Goods LLC                                           │
│                                                                  │
│  [← Back]                                    [Continue →]       │
│                                              (disabled until all │
│                                               categories mapped) │
└─────────────────────────────────────────────────────────────────┘
```

**Row States:**

| State | Icon | Styling |
|---|---|---|
| Auto-resolved (exact match) | Green `CheckCircle` | `bg-green-50`, category shown as plain text with "(exact match)" suffix in `text-green-600 italic`. No dropdown. |
| AI-suggested (pre-filled) | Violet "AI" badge | Dropdown pre-filled. `border-violet-200 bg-violet-50`. User can change. |
| Saved alias (from previous upload) | Blue "Auto" badge | Dropdown pre-filled. `border-blue-200 bg-blue-50`. |
| Unmapped (needs action) | Amber `AlertCircle` | `border-amber-300 bg-amber-50`. Placeholder: "— choose one —". |

**Dropdown Options:**
- One option per contract category, showing the rate: "Apparel (10%)"
- "Exclude from calculation" option at the bottom (maps to `null`)

**Mobile:** Stacked card-per-row, same `flex-col sm:grid` pattern as `MappingRow` in `column-mapper.tsx`.

**Save Checkbox:** Same pattern as column mapper. Label: "Save these category aliases for future uploads from {licenseeName}". Sub-text: "Next time 'Tops & Bottoms' will automatically match to Apparel."

---

### Backend Engineer — Technical Plan

**Files to Change:**

| File | Change |
|---|---|
| `backend/app/services/spreadsheet_parser.py` | Add `claude_suggest_categories()` and `suggest_category_mapping()` |
| `backend/app/routers/sales_upload.py` | Add `_resolve_category()` helper; extend `UploadConfirmRequest`; add `category_resolution` to upload response; apply resolution in confirm; save aliases |
| `supabase/migrations/20260225000000_add_category_mapping.sql` | `ALTER TABLE licensee_column_mappings ADD COLUMN category_mapping JSONB;` |

**1. Upload endpoint — detect and suggest category mappings**

Extend the response of `POST /upload/{contract_id}` with a `category_resolution` object when the contract has category rates:

```json
{
  "upload_id": "...",
  "detected_columns": [...],
  "suggested_mapping": {...},
  "category_resolution": {
    "required": true,
    "contract_categories": ["Apparel", "Accessories", "Footwear"],
    "report_categories": ["Tops & Bottoms", "Hard Accessories", "Footwear"],
    "suggested_category_mapping": {
      "Tops & Bottoms": "Apparel",
      "Hard Accessories": "Accessories",
      "Footwear": "Footwear"
    },
    "category_mapping_sources": {
      "Tops & Bottoms": "ai",
      "Hard Accessories": "ai",
      "Footwear": "exact"
    }
  }
}
```

This requires running the column mapping first to identify which column is `product_category`, then extracting distinct category values from that column across ALL rows (not just sample rows), then running resolution.

**2. AI category suggestion function**

Add to `spreadsheet_parser.py`:

```python
def claude_suggest_categories(
    report_categories: list[str],
    contract_categories: list[str],
) -> dict[str, str]:
    """
    Ask Claude to map report category names to contract category names.
    Returns a dict mapping report_category -> contract_category.
    Returns {} on any failure.
    """
```

Resolution order (same as column mapping):
1. Saved aliases (from `licensee_column_mappings.category_mapping`)
2. Exact match (case-insensitive)
3. Substring match (existing logic)
4. AI suggestion (Claude, for remaining unresolved)

**3. Confirm endpoint — accept and apply category mapping**

Extend `UploadConfirmRequest`:

```python
category_mapping: Optional[dict[str, str]] = None  # report_cat -> contract_cat
```

New resolution helper:

```python
def _resolve_category(
    report_cat: str,
    contract_cats: Iterable[str],
    explicit_mapping: dict[str, str],
) -> Optional[str]:
    """
    Resolution order:
    1. Explicit mapping from request body (user-confirmed)
    2. Exact match (case-insensitive)
    3. Substring match (existing logic)
    4. None (unresolved — raise error)
    """
```

Apply resolution BEFORE calling `calculate_category_royalty`, so the royalty calculator always sees contract-canonical category names. No changes to `royalty_calc.py`.

**4. Persist category aliases**

Migration:
```sql
ALTER TABLE licensee_column_mappings ADD COLUMN category_mapping JSONB;
```

On confirm with `save_mapping=true`, upsert `category_mapping` alongside `column_mapping`. On upload, load saved `category_mapping` and use as initial suggestion.

**5. Backend tests to add:**

- `test_resolve_category()` — unit tests for the 3-level resolution helper
- `test_suggest_category_mapping()` — saved, exact, substring, AI paths
- `test_claude_suggest_categories()` — mock Claude response
- `test_upload_endpoint_category_resolution()` — response includes category_resolution for category contracts
- `test_confirm_with_category_mapping()` — applies mapping, calculates correct royalties
- `test_confirm_without_category_mapping()` — flat-rate contracts unaffected
- `test_save_category_aliases()` — aliases persisted and loaded on next upload

---

### Frontend Engineer — Technical Plan

**Files to Create/Modify:**

| File | Action |
|---|---|
| `frontend/types/index.ts` | Add `CategoryMapping`; add `category_mapping?` to `UploadConfirmRequest`; add `CategoryResolution` type |
| `frontend/lib/api.ts` | `confirmSalesUpload` accepts `category_mapping` |
| `frontend/lib/category-utils.ts` | **Create** — `getReportCategories`, `hasCategoryMismatch`, `buildInitialCategoryMapping` |
| `frontend/components/sales-upload/category-mapper.tsx` | **Create** — Step 2.5 UI component |
| `frontend/app/(app)/sales/upload/page.tsx` | Add `'map-categories'` step; mismatch detection; `doConfirm` extraction; render CategoryMapper |
| `frontend/__tests__/components/category-mapper.test.tsx` | **Create** — component tests |
| `frontend/__tests__/lib/category-utils.test.ts` | **Create** — utility unit tests |
| `frontend/__tests__/app/(app)/sales/sales-upload-page.test.tsx` | Add 2+ integration tests |

**1. New types**

```typescript
export interface CategoryMapping {
  [reportCategory: string]: string  // report_cat -> contract_cat
}

export interface CategoryResolution {
  required: boolean
  contract_categories: string[]
  report_categories: string[]
  suggested_category_mapping: CategoryMapping
  category_mapping_sources: Record<string, 'saved' | 'exact' | 'ai' | 'none'>
}
```

Add to `UploadPreviewResponse`:
```typescript
category_resolution?: CategoryResolution | null
```

Add to `UploadConfirmRequest`:
```typescript
category_mapping?: CategoryMapping
```

**2. Wizard step type**

Change from numeric to string union:
```typescript
type WizardStep = 'upload' | 'map-columns' | 'map-categories' | 'preview'
```

**3. State flow in `page.tsx`**

- After Step 2 confirm, check if `uploadPreview.category_resolution?.required` is true
- If yes: set step to `'map-categories'`, show CategoryMapper pre-filled with `suggested_category_mapping`
- If no: call `doConfirm` directly (existing behavior)
- Extract `doConfirm` from current `handleMappingConfirm`
- New `handleCategoryMappingConfirm` calls `doConfirm` with the category mapping

**4. CategoryMapper component**

Props:
```typescript
interface CategoryMapperProps {
  reportCategories: string[]
  contractCategories: { name: string; rate: number }[]
  suggestedMapping: CategoryMapping
  mappingSources: Record<string, 'saved' | 'exact' | 'ai' | 'none'>
  licenseeName: string
  onConfirm: (result: { categoryMapping: CategoryMapping; saveAliases: boolean }) => void
  onBack: () => void
}
```

Internal state: `mapping: CategoryMapping`, initialized from `suggestedMapping`. Continue disabled until all report categories have a mapping.

**5. Category detection utility**

```typescript
// frontend/lib/category-utils.ts
export function getReportCategories(sampleRows: Record<string, string>[], categoryColumn: string): string[]
export function hasCategoryMismatch(reportCategories: string[], contractCategories: string[]): boolean
```

**6. Tests**

- CategoryMapper: renders rows, pre-fills exact matches, disables Continue when unmapped, enables on full mapping, calls onConfirm, calls onBack
- category-utils: pure function tests
- Integration: Step 2 → 2.5 transition for category contracts; Step 2 → 3 skip for flat-rate; confirm payload includes category_mapping

---

## Implementation Order

1. **Backend: migration + data model** — Add `category_mapping` column to `licensee_column_mappings`
2. **Backend: category resolution logic** — `_resolve_category`, `claude_suggest_categories`, `suggest_category_mapping`
3. **Backend: upload endpoint** — Return `category_resolution` in response
4. **Backend: confirm endpoint** — Accept and apply `category_mapping`
5. **Backend: save/load aliases** — Persist and retrieve from `licensee_column_mappings`
6. **Backend tests**
7. **Frontend: types + utilities** — New types, `category-utils.ts`
8. **Frontend: CategoryMapper component** — New component with tests
9. **Frontend: wizard integration** — Wire Step 2.5 into `page.tsx`
10. **Frontend tests**
11. **Manual testing** — Upload `sample-ai-test-2-meridian-category.csv` against Meridian contract end-to-end

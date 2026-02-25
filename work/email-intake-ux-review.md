# UX Design Review: Email Intake Matching and Processing
ADR: `docs/adr/20260225095833-email-intake-matching-and-processing.md`
Date: 2026-02-25

---

## 1. Consistency Check

**What aligns well**

The proposed confidence pill color tokens (`bg-green-100 text-green-700`, `bg-amber-100 text-amber-700`, `bg-gray-100 text-gray-500`) are an exact match to the `StatusBadge` convention already in use on both inbox pages. The green/amber card treatment for match states mirrors the existing Contract Match section in `inbox/[id]/page.tsx` and the overlap warning cards in the upload wizard — both use `bg-amber-50 border border-amber-200 rounded-lg` and `bg-green-50 border border-green-200 rounded-lg`. These are safe to reuse directly.

The attachment strip (file-type icon, filename, size, row/column count) is consistent with the `FileSpreadsheet` icon row already on the detail page, and with how the upload wizard displays file metadata inside the drop zone after a file is selected. Keep the same icon (`FileSpreadsheet`) and `text-gray-400` icon color.

The multi-contract informational callout is specified as blue. The existing codebase has no `blue`-tinted informational callout — only amber and red variants appear in production components. Use `bg-blue-50 border border-blue-200 rounded-lg` with `text-blue-800` body text and an `Info` Lucide icon. This is a new pattern but stays within the design system's semantic color range and is lower urgency than amber, which is appropriate.

**Deviations to flag**

The ADR describes three split action buttons (primary, secondary, destructive) rendered side by side. The current detail page uses a simple `flex gap-3` row of two buttons. Three horizontally-arranged buttons on a narrow mobile viewport will wrap awkwardly or become too small to tap comfortably. The ADR does not specify a mobile layout for this button group. Recommendation: stack all three buttons vertically on mobile (`flex-col sm:flex-row`) and give the destructive "Reject Report" button its own row or a visual separator (e.g., `mt-4 pt-4 border-t border-gray-200`) so the user cannot accidentally trigger it when reaching for Confirm.

The "matched on" evidence tags (e.g., "agreement ref", "licensee name") are described as small gray pills. The existing codebase has no precedent for secondary metadata pills inside a card. Use `bg-gray-100 text-gray-500 text-xs font-medium px-2 py-0.5 rounded-full` — this is consistent with the `Rejected` status badge style, which uses the same tokens.

---

## 2. Interaction Concerns

**"Wrong match?" toggle**

The toggle collapses a confirmed high-confidence green card back into the candidate/search state. This is the only place in the application where a confirmed display state is reversible inline without a page reload. The word "toggle" suggests a `<button>` element rendered as a text link or secondary button inside the green card. The concern is that users may not realize that clicking it discards the auto-match — there is no confirmation step, and the ADR does not specify one. Given that the operation is recoverable (the user can simply re-select the originally matched contract), no modal is needed, but the button label should be explicit: "Not the right contract? Change it" rather than a bare "Wrong match?" link. Ensure the button gets a visible focus ring and is not styled with color alone to distinguish it from static text.

**Three-state contract matching and user entry point**

The three match states (auto-matched, suggestions, no match) all render inside the same card region but have visually distinct presentations. A user who arrives at the page for the first time will not know which state they are in until they read the card header. The ADR specifies an amber header for states 2 and 3 but does not specify a card-level heading label (e.g., "Contract Match") that persists across all states. Without this, the section has no stable anchor. Add a consistent `<h2>` heading — the existing page already uses `text-lg font-semibold text-gray-900 mb-4` for card headings — above whichever match-state UI is rendered.

**Suggestion cards as interactive items**

In the medium-confidence state, each suggestion card is clickable to select a contract. The ADR does not specify the selected vs. unselected visual state of these cards. Without a clear selected state (e.g., `ring-2 ring-blue-500` or `border-blue-500 bg-blue-50`), the user has no feedback that their click registered before they press Confirm. This must be handled by the engineer. A good pattern: unselected cards use `border border-gray-200 hover:border-gray-300`, selected uses `border-2 border-blue-500 bg-blue-50`. The `aria-pressed` attribute should be set on the selected card's button element.

**"Confirm Only" toast with "Process now" link**

A success toast that contains an actionable link is not a pattern used elsewhere in Likha. Toasts are not currently implemented in the codebase at all. If the engineer introduces a toast library, keep the delay long enough for the user to read and click the link — at minimum 8 seconds with a close button. If a toast library is not yet available, a simpler fallback is an inline success banner on the inbox list page (similar to the `?success=period_created` query-param pattern already used by the upload wizard redirect).

---

## 3. Accessibility

**Gaps in the ADR**

The ADR does not address:

- **Focus management on state transitions.** When the user clicks "Wrong match?", focus should move to the first interactive element in the newly revealed candidate/search state (either the first suggestion card or the search input). Without explicit `focus()` calls, focus is lost and a keyboard user must tab back into the page from the top.
- **Keyboard navigation for suggestion cards.** If suggestion cards are rendered as `<div>` elements with click handlers, they are not keyboard reachable. They must be `<button>` elements or have `role="option"` and `tabIndex={0}` with `onKeyDown` handlers for Enter/Space. Given the interactive selection behavior, `<button>` elements are the correct choice.
- **`aria-busy` during in-flight actions.** The "Confirm & Open Upload Wizard" button should have `aria-busy="true"` when the confirm API call is in progress, alongside the existing `disabled` attribute.
- **Provenance hint in the upload wizard.** The hint "Detected from email subject — verify before continuing" is displayed near the pre-filled date inputs. This should be associated with the inputs via `aria-describedby` rather than rendered as standalone text, so screen readers announce it when the user focuses the date fields.

**What the ADR handles adequately**

The "No attachment" badge that disables the wizard button, the `disabled` state on the primary action when no contract is selected, and the searchable select for the no-match state all have natural accessible implementations using standard HTML.

---

## 4. Missing States

**Loading state for the redesigned detail page**

The existing detail page already has a loading skeleton (`skeleton h-64`). The redesigned page adds new sections (attachment strip, period row, multi-contract callout, three-state match card). The ADR does not specify skeleton shapes for these sections. The engineer should add `animate-pulse` placeholder blocks for each new region — at minimum one for the match card (where the most user interaction happens) and one for the attachment strip.

**Empty candidate list**

The ADR states that when no signal matches, `candidate_contract_ids` is populated with all active contracts. It does not address the edge case where the user has zero active contracts. The searchable select would render empty, the primary action would remain disabled, and the user would be stuck. Add an inline callout: "No active contracts found. Add a contract first." with a link to the contract upload flow. This reuses the pattern from the existing inbox page's unmatched `AlertTriangle` treatment.

**Redirect failure from the wizard back to the inbox**

The ADR specifies that after wizard completion with `report_id` present, the frontend calls `PATCH /api/inbox/{report_id}` to link `sales_period_id`. If this PATCH call fails, the sales period was already created but the audit trail is broken. The ADR does not specify a user-visible error for this case. The engineer should handle it silently (log the error, continue the redirect) rather than blocking the user — the core work is done and the linkback failure is an audit concern, not a user-facing blocker. The upload wizard's existing `confirmError` display pattern would be misleading here.

**"Process for another contract?" prompt — empty/single-contract case**

The ADR states this prompt appears when the licensee has more than one active contract. The branch condition is already defined. No gap here, but confirm the engineer suppresses the prompt entirely (no empty space) when the condition is false, rather than rendering a hidden element.

---

## 5. Recommendations for the Engineer

**1. Stack the three action buttons vertically on mobile.**
Use `flex flex-col sm:flex-row gap-3` for the button group. Place "Reject Report" last and separate it with `sm:ml-auto` or a `mt-2 sm:mt-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-gray-200` divider on mobile. This prevents accidental destructive actions on small screens.

**2. Manage focus explicitly on every state transition in the match card.**
After "Wrong match?" is clicked: `suggestionsRef.current?.focus()`. After a suggestion card is selected: keep focus on the selected card. After the searchable select resolves to a selection: focus the primary Confirm button. Use `useRef` for each interactive region and call `.focus()` inside the state-setter callback.

**3. Pre-fill the upload wizard's period dates before the file load, not after.**
If attachment pre-loading is async (storage fetch), the date fields should be populated immediately from query params on mount. The provenance hint should appear as soon as the dates are filled. Do not wait for the file to load before showing the hint — the file load may be slow or fail independently.

**4. Reuse the `?success=` query-param pattern instead of a toast for "Confirm Only" redirect.**
Redirect to `/inbox?confirmed={report_id}` and render an inline success banner on the inbox list page, matching the `?success=period_created` pattern already used by the upload wizard. This avoids introducing a new toast dependency and is immediately visible in the list context where the user lands.

**5. Add `role="alert"` to the multi-contract informational callout.**
The ADR specifies this as an informational blue callout, but it contains actionable information (the user may need to process the report multiple times). Mark it `role="status"` rather than `role="alert"` to avoid interrupting screen reader announcements unnecessarily, but ensure it is included in the DOM before the action buttons so tab order leads the user past it before they can confirm.

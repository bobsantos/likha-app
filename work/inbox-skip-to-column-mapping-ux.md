# UX Recommendations: Inbox Confirm → Skip to Column Mapping

**Feature:** When a user clicks "Confirm & Open Upload Wizard" from the inbox review page, the
wizard should skip step 1 (period selection + file upload) and land directly on step 2 (column
mapping), because the file and period are already known from the inbound email.

---

## 1. Transition Feel — Loading State While Auto-Parsing

The gap between clicking "Confirm & Open Upload Wizard" and the column mapping screen involves a
backend round-trip: the server must parse the attachment from Supabase Storage and return an
`UploadPreviewResponse`. This is not instant. The transition must feel intentional, not broken.

**Recommendation: inline button loading, then a full-page skeleton on arrival.**

On the inbox page, the "Confirm & Open Upload Wizard" button already shows "Opening wizard..."
while `confirmingWizard` is true. That is correct and should stay. It tells the user something is
happening before the navigation occurs.

When the wizard page mounts in inbox-source mode, it should immediately trigger the auto-parse
call (using the `attachment_path` threaded through the URL or page state) rather than waiting for
a user to drop a file. During this call, render a loading skeleton instead of the column mapper.
Use the same skeleton pattern already established for `loadingContract`:

```
bg-white rounded-lg border border-gray-200 shadow-sm p-6 space-y-4
  animate-pulse h-4 rounded bg-gray-200   (several lines to imply column rows)
```

Below the skeleton, show a short status message:

```
text-sm text-gray-500
"Parsing attachment from email..."
```

This is preferable to a spinner alone because it explains why the user is waiting. A full skeleton
also prevents layout shift when the column mapper renders.

If the parse call is typically fast (under two seconds), do not show a progress bar — it would
feel slower than the real wait. If it routinely takes longer, add a secondary line after 2 s:

```
text-xs text-gray-400
"Large files may take a moment."
```

**Step indicator during loading:** Show the step indicator with step 1 marked complete and step 2
as the active/current step (see section 3). This sets expectations while the skeleton shows.

---

## 2. Provenance Banner

Yes, show a provenance banner. It serves two purposes: it disambiguates the inbox-source flow from
a normal manual upload, and it gives the user immediate confidence that they are processing the
right file without needing to check the breadcrumb or page title.

**Placement:** Immediately below the page subtitle, above the step indicator. This keeps it in the
reading flow before the user's eye moves to the wizard chrome. It should not live inside a step
panel because it is contextual to the entire session, not to one step.

**Design:**

```
bg-blue-50 border border-blue-200 rounded-lg px-4 py-3
flex items-center gap-3

  Mail icon (w-4 h-4 text-blue-500, flex-shrink-0)

  div
    p.text-sm.font-medium.text-blue-900   "Processing emailed report"
    p.text-xs.text-blue-700              "From: licensee@example.com  •  Q3 2025 Report.xlsx"
```

Show the sender email (`sender_email`) and attachment filename (`attachment_filename`) side by
side, separated by a bullet. Both are already available in the URL params or can be threaded
through from the confirm response. If either is unavailable, omit that token rather than showing
a blank.

The banner should persist across all steps (map-columns, map-categories, preview) so the user
never loses context of what email triggered this session. It should be visually quieter than an
alert — blue-50 is the right tone, not amber or red.

**Current behavior:** The page already renders `"Processing emailed report from {contractName}."` as
a subtitle when `isInboxSource` is true. That subtitle can remain as-is. The provenance banner
supplements it with the specific email address and filename, which the subtitle does not show.

---

## 3. Step Indicator — Start at Step 2 Marked as Active, Step 1 as Completed

**Recommendation:** Show step 1 as completed (filled blue circle with a check icon) and step 2 as
the active step, using the same visual language the indicator already uses for past steps.

Do not hide step 1. Hiding it would confuse users who notice the indicator starts at "2 of 3" with
no explanation. Showing it as already-completed tells the true story: the file was already uploaded
via email, so that step is done.

The existing `StepIndicator` component already renders completed steps with a check icon when
`s.number < currentVisual`. Because the inbox-source flow starts at `map-columns` (visual step 2),
step 1 will automatically render as completed without any code change to the indicator itself —
only the initial `step` state needs to change from `'upload'` to `'map-columns'`.

**Step labels to keep as-is:** "Upload File" for step 1 is still accurate as a historical label
(the file was uploaded, just by email). No label change is needed. The completed check mark
communicates "done" without needing to relabel it as "Received via Email" or similar.

**Mobile:** On small screens, step labels are already hidden (the `hidden sm:block` pattern on the
label spans). The circles alone communicate progress adequately. No mobile-specific change needed
for the indicator.

---

## 4. Auto-Parse Failure — Fallback Behavior

When the backend cannot parse the email attachment (unsupported format, corrupt file, server
error), the wizard must not silently stall on the skeleton.

**Recommendation: show an inline error banner, then offer two recovery paths.**

```
bg-red-50 border border-red-200 rounded-lg px-4 py-4
flex items-start gap-3

  AlertCircle icon (w-5 h-5 text-red-600 flex-shrink-0 mt-0.5)

  div.flex-1
    p.text-sm.font-semibold.text-red-900   "Could not parse the email attachment"
    p.text-sm.text-red-700.mt-0.5          "{error message from API, or generic fallback}"

    div.flex.items-center.gap-3.mt-3
      button.btn-primary.text-sm           "Upload a file manually"
      button.btn-secondary.text-sm         "Return to inbox"
```

"Upload a file manually" drops the user back to step 1 (`'upload'`) in the same wizard session,
with period dates still pre-filled from the inbox params. The provenance banner remains. This way
the user can drag in a corrected version of the file without losing contract context.

"Return to inbox" navigates to `/inbox` so the user can re-examine the original email or reject
the report. This is the safe exit.

**Do not automatically fall back to step 1.** Silently redirecting to step 1 looks like a bug —
the user expected to see column mapping, not an upload zone. The explicit error + two-button choice
is more trustworthy for a financial tool.

**Step indicator during error:** Reset the step indicator to show step 1 as active (not completed),
because the "Upload File" action has not actually succeeded in this session. The user must now
complete it manually.

---

## 5. Period Dates on the Column Mapping Step — Show as Locked, Allow Escape Hatch

The period was already reviewed and confirmed on the inbox page. Asking the user to re-enter or
re-verify it on the column mapping step would undermine the value of the inbox review flow.

**Recommendation: display the period as a locked, read-only summary row above the column mapper,
not as editable inputs.**

```
bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5
flex items-center gap-3

  Calendar icon (w-4 h-4 text-blue-500 flex-shrink-0)

  span.text-sm.text-blue-900
    "Reporting period: Jan 1, 2025 – Mar 31, 2025"
    span.ml-2.inline-flex.items-center.px-2.py-0.5.rounded-full.text-xs.font-medium.bg-blue-100.text-blue-600
      "from email"

  button.ml-auto.text-xs.text-blue-600.hover:text-blue-800.underline.underline-offset-2
    "Change"
```

The "Change" escape hatch navigates back to step 1 where the date inputs are editable. It is
visually de-emphasized (small, underlined text link rather than a button) because this is an
edge-case action — most of the time the detected period is correct.

**Rationale for locking:** The period-overlap check (`checkPeriodOverlap`) runs on step 1 and
blocks progression until warnings are acknowledged. If the period were editable on step 2, that
check would need to re-run mid-wizard, causing unexpected state resets on the column mapping work
already done. Locking is both simpler and safer.

---

## 6. Back Button Behavior — Back Navigates to Inbox, Not Step 1

In the normal upload wizard, the "Back" button on the column mapper calls `onBack={() => setStep('upload')}`,
returning to step 1. In the inbox-source flow, step 1 was not user-initiated — the file was
already parsed automatically. There is nothing to "go back" to on step 1 in a useful sense.

**Recommendation: in the inbox-source flow, the Back button on `map-columns` should navigate to
the inbox review page (`/inbox/{reportId}`), not to step 1.**

Label it "Back to Report" rather than the generic "Back" to signal the destination:

```jsx
// Inbox-source back handler passed to ColumnMapper
const handleBack = isInboxSource && reportId
  ? () => router.push(`/inbox/${reportId}`)
  : () => setStep('upload')
```

This preserves the report in `pending` state so the user can review it again or take a different
action. The wizard navigation does not irrevocably change the report status — only the "Confirm"
API call does.

**On map-categories step:** The existing back handler (`onBack={() => setStep('map-columns')}`)
is correct regardless of source. The user got to map-categories by doing work in map-columns, so
going back within the wizard makes sense.

**On the preview step:** The "Back" button returns to `map-columns` as normal. No change needed.

---

## 7. Mobile Considerations

The column mapper (`ColumnMapper` component) renders in a wider container (`max-w-4xl`) than the
other steps (`max-w-3xl`). This is already handled by the conditional class on the wrapper div.
No change needed there.

For the provenance banner, ensure it does not truncate the email address on small screens. Use
`truncate` on the email span and `flex-wrap` on the banner row if needed:

```
flex flex-wrap items-center gap-x-3 gap-y-1
```

The locked period row above the column mapper should stack gracefully on mobile. The "Change" link
can move to a second line below the period text on narrow viewports using `flex-col sm:flex-row`.

The loading skeleton should match the approximate visual weight of the column mapper on mobile —
use 3-4 skeleton rows rather than a full-height skeleton that looks outsized on a phone screen.

The step indicator is already mobile-friendly (labels hidden, circles only). No change needed.

---

## 8. Accessibility — Focus Management on Wizard Entry

When the wizard mounts in inbox-source mode and auto-parse begins, focus must be placed
intentionally so screen reader users are not left on the browser chrome or a stale element.

**During loading (skeleton state):**
On mount, focus a visually hidden live region that announces the loading state:

```jsx
<div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
  Parsing email attachment. Please wait.
</div>
```

Update the live region text when parsing completes or fails.

**On successful parse (column mapper mounts):**
Use a `useEffect` with a `ref` on the column mapper's heading (`h2`) to programmatically focus it
after the skeleton unmounts:

```jsx
const columnMapperHeadingRef = useRef<HTMLHeadingElement>(null)

useEffect(() => {
  if (step === 'map-columns' && isInboxSource) {
    columnMapperHeadingRef.current?.focus()
  }
}, [step, isInboxSource])
```

The heading should be focusable: `<h2 tabIndex={-1} ref={columnMapperHeadingRef}>`.
`tabIndex={-1}` allows programmatic focus without adding the heading to the tab order.

**On parse failure:**
Focus the error banner heading so screen reader users hear the error immediately:

```jsx
const errorHeadingRef = useRef<HTMLHeadingElement>(null)

useEffect(() => {
  if (parseError) {
    errorHeadingRef.current?.focus()
  }
}, [parseError])
```

**Provenance banner:** Give it `role="status"` so it is announced on mount without being an
intrusive alert:

```jsx
<div role="status" aria-label="Email source context">
```

**Step indicator:** The existing `aria-label` pattern on each step circle already handles
screen reader announcements for completed vs. active steps. No change needed.

---

## Summary of Decisions

| Topic | Decision |
|---|---|
| Transition feel | Inline "Opening wizard..." on inbox button; full skeleton + status text on wizard page |
| Provenance banner | Yes — sender email + filename, blue-50, persists all steps |
| Step indicator | Show step 1 as completed (check mark), step 2 as active — no hiding |
| Parse failure | Explicit error banner with "Upload manually" and "Return to inbox" options |
| Period editability | Locked read-only row with a small "Change" escape hatch |
| Back button | map-columns Back goes to `/inbox/{reportId}` ("Back to Report") in inbox-source mode |
| Mobile | flex-wrap on banner, 3-4 skeleton rows, no other special cases |
| Focus management | sr-only live region during load; focus heading on step mount; focus error on failure |

# Agreement Number UX Recommendation

## Decision: Auto-generate. Remove the editable field.

The current editable `agreement_number` input in both `contract-form.tsx` and the inline review form in `upload/page.tsx` should be removed. The backend generates a short, controlled reference (e.g. `LKH-001`) at draft creation time. Users should never need to type one.

---

## 1. How it appears in the UI

**Contract detail page (`/contracts/[id]/page.tsx`)**

Replace the current plain text display with a copyable badge. Position it prominently in the header card (next to the Active/Draft status badge), not buried in the Contract Terms list. It is a communication artifact — licensees need to quote it in correspondence — so it belongs at the top, not mid-page.

```
[ Active ]   LKH-001  [copy icon]
```

Implementation: a `<button>` that calls `navigator.clipboard.writeText()` on click, momentarily swapping the copy icon for a `CheckCircle2` with `text-green-600` to confirm the action. Tailwind structure:

```tsx
<button
  onClick={handleCopy}
  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md
             bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-mono
             font-medium transition-colors"
  aria-label="Copy agreement reference"
>
  <Hash className="w-3.5 h-3.5 text-gray-400" />
  {contract.agreement_number}
  {copied
    ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
    : <Copy className="w-3.5 h-3.5 text-gray-400" />}
</button>
```

**Confirmation step (`upload/page.tsx`)**

After "Confirm and Save" succeeds, before redirecting to the contract detail page, show a one-line success callout:

```
Your agreement reference is LKH-001 — share this with your licensee.  [Copy]
```

This is the user's first encounter with the generated number. Making it visible and copyable here sets the expectation that they should forward it to the licensee.

---

## 2. Should there be a user-editable "external reference" field?

Yes, but as a separate secondary field — not a replacement for the auto-generated one.

Call it **Licensee's Reference** (not "agreement number") and add it as an optional field in the contract form and detail page. This holds whatever number the licensee uses internally (e.g. `ABC-7782`). It is used as a fallback matching signal for email intake (Signal 2) when the licensee forgets to include the Likha-generated reference.

The two fields serve different purposes:
- `agreement_number` — Likha-controlled, used for deterministic matching
- `licensee_reference` — licensee-controlled, used as a fuzzy fallback

Keeping them distinct prevents confusion when a licensee's reference clashes across contracts.

---

## 3. Encouraging licensees to use it

One mechanism, not several: a **"Copy instructions"** button on the contract detail page that copies a short plain-text template to the clipboard:

```
Hi [Licensee Name],

Please include the following reference in all royalty report emails and
attachments sent to us:

  Agreement Reference: LKH-001

This ensures your reports are automatically matched to your contract.

Thank you
```

The button lives near the `agreement_number` badge in the header. Label it "Copy instructions for licensee" with a `ClipboardList` icon. No modal, no form — one click, clipboard, done.

Do not add a shareable link, a separate page, or an email-sending feature at this stage. The copy-template pattern keeps the surface area minimal and avoids building email infrastructure before it is needed.

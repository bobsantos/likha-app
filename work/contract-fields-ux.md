# UX Note: `licensee_email` and `agreement_number` Fields

## 1. Placement in the Contract Form

Both fields are secondary metadata — they do not describe financial terms and should not be mixed into the primary grid of rates, dates, and royalty base. Place them in a dedicated section between the party names block and the contract terms block, using a visual separator and a section label.

Proposed order:

1. Licensee Name / Licensor Name (existing row)
2. **"Contact & Reference" section divider** (new)
3. Licensee Email / Agreement Number (new row)
4. Contract Start Date / Contract End Date (existing)
5. ...rest of the form unchanged

The section divider should follow the pattern already implied by the form's `space-y-6` rhythm. Use a `<div>` with a `pt-2 border-t border-gray-100` top border and a small label:

```tsx
<div className="md:col-span-2 pt-2 border-t border-gray-100">
  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
    Contact & Reference
  </p>
</div>
```

Then place the two new fields as a standard two-column row inside the existing `grid gap-6 md:grid-cols-2`.

## 2. Field Labels and Placeholders

**Licensee Email**
- Label: `Licensee Report Email`
- Placeholder: `e.g., reports@acme.com`
- Help text (below input, `mt-1.5 text-xs text-gray-500`):
  > Used to automatically match incoming email reports to this contract.
- Type: `email`
- Required: no (optional at creation, strongly encouraged)

**Agreement Number**
- Label: `Agreement Number`
- Placeholder: `e.g., LIC-2024-001`
- Help text:
  > The reference number printed on the contract document.
- Type: `text`
- Required: no

Both fields use the existing `className="input"` utility class — no new styles needed.

## 3. Contract Detail Page Display

Add a new "Contact & Reference" row to the read-only "Contract Terms" card, rendered conditionally (same guard pattern used for `licensor_name`, `territories`, etc.).

Place the two items directly after the licensor row and before the royalty base row — they are party/identification details, not financial terms:

```tsx
{/* Agreement Number */}
{contract.agreement_number && (
  <div className="flex items-start gap-3">
    <FileText className="w-5 h-5 text-gray-400 mt-0.5" />
    <div>
      <p className="text-sm text-gray-600">Agreement Number</p>
      <p className="font-medium text-gray-900 tabular-nums">{contract.agreement_number}</p>
    </div>
  </div>
)}

{/* Licensee Report Email */}
{contract.licensee_email && (
  <div className="flex items-start gap-3">
    <Mail className="w-5 h-5 text-gray-400 mt-0.5" />
    <div>
      <p className="text-sm text-gray-600">Licensee Report Email</p>
      <p className="font-medium text-gray-900">{contract.licensee_email}</p>
    </div>
  </div>
)}
```

Import `Mail` from `lucide-react` alongside the existing icon imports. `FileText` is already imported.

## 4. Patterns to Reuse

All patterns are already established in the codebase — nothing new is needed:

| Element | Existing class / pattern |
|---|---|
| Field wrapper | `<div>` inside `grid gap-6 md:grid-cols-2` |
| Label | `block text-sm font-medium text-gray-700 mb-2` |
| Input | `className="input"` (Tailwind component alias) |
| Help text | `mt-1.5 text-xs text-gray-500` — see Territories field |
| Detail row | `flex items-start gap-3` with `w-5 h-5 text-gray-400 mt-0.5` icon |
| Detail label | `text-sm text-gray-600` |
| Detail value | `font-medium text-gray-900` |
| Section divider | `border-t border-gray-100` with `text-xs font-semibold uppercase tracking-wide text-gray-400` label |

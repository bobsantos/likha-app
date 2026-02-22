# Side-by-Side PDF Viewer for Contract Review

## Problem
During the review step after extraction, users must open the contract PDF externally to verify extracted data — especially multi-rate royalty categories, thresholds, and percentages. This breaks the workflow and adds friction.

## Solution
Add an inline PDF viewer alongside the review form so users can cross-reference extracted values against the source document without leaving the app.

---

## Layout Design

### Desktop (lg+): Two-Column Split
- **PDF panel (left, 45%):** Sticky, stays in viewport while form scrolls
- **Form panel (right, 55%):** Scrollable, all existing form fields unchanged
- Container widens from `max-w-4xl` → `max-w-7xl` during review step only
- PDF panel is collapsible via "Hide PDF" button; form expands to full width when hidden

### Tablet/Mobile (below lg): Tab Switcher
- Segmented control at the top: `[PDF]` `[Form]` tabs
- PDF tab shows iframe at `h-[60vh]`
- Form tab shows existing form layout unchanged
- Default to Form tab on mobile

### Fallback
- "Open in new tab" link always visible (handles iframe embed failures, especially on iOS Safari)
- When `pdfUrl` is null (expired signed URL, missing data), hide PDF controls silently — form-only mode

---

## Component Structure

All changes within `page.tsx` — no new files needed (except possibly a `PdfPanel` component if the inline code gets too large).

```
UploadContractPage
├── Steps: upload, extracting, saving — UNCHANGED
└── Step: review
    ├── MobileTabBar (below lg only): [PDF] [Form] segmented control
    └── SplitLayout (lg: flex-row | mobile: conditional render based on activeTab)
        ├── PdfPanel (left / PDF tab)
        │   ├── Header: filename + [Open in new tab ↗] + [Hide PDF] (lg only)
        │   └── <iframe src={pdfUrl}> — full height
        └── FormPanel (right / Form tab)
            ├── Review heading + [Show PDF] button (when panel hidden, lg only)
            ├── Error banners (existing)
            └── Form fields (existing, completely unchanged)
```

---

## State Changes

```tsx
// New state variables
const [pdfUrl, setPdfUrl] = useState<string | null>(null)
const [showPdf, setShowPdf] = useState(true)           // desktop toggle
const [activeTab, setActiveTab] = useState<'pdf' | 'form'>('form')  // mobile tab

// Set pdfUrl in handleUpload (after extraction success):
setPdfUrl(response.pdf_url)

// Set pdfUrl in loadDraft (draft resume):
setPdfUrl(contract.pdf_url)
```

---

## Key Tailwind Patterns

### Outer container (review step only)
```tsx
<div className={`mx-auto px-4 sm:px-6 lg:px-8 py-8 ${
  step === 'review' ? 'max-w-7xl' : 'max-w-4xl'
}`}>
```

### Split layout
```tsx
<div className="flex flex-col lg:flex-row lg:min-h-[calc(100vh-8rem)]">
  {/* PDF panel — sticky */}
  <div className="lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)] lg:w-[45%] lg:border-r border-gray-200">
    ...
  </div>
  {/* Form panel */}
  <div className="flex-1 lg:pl-6 overflow-y-auto">
    ...
  </div>
</div>
```

### Sticky PDF
- `sticky top-16` (accounting for nav bar height)
- `h-[calc(100vh-4rem)]` so it fills viewport minus nav
- `self-start` prevents flex stretch that would break stickiness
- iframe uses native PDF scroll controls inside

### Mobile segmented control
```tsx
<div className="flex lg:hidden border border-gray-200 rounded-lg p-1 bg-gray-100 mb-4">
  <button className={activeTab === 'pdf' ? 'bg-white shadow-sm ...' : '...'}>PDF</button>
  <button className={activeTab === 'form' ? 'bg-white shadow-sm ...' : '...'}>Form</button>
</div>
```

---

## Implementation Steps

### 1. Add state variables
- `pdfUrl`, `showPdf`, `activeTab`
- Wire `setPdfUrl` into extraction success handler and `loadDraft`

### 2. Widen container conditionally
- Review step uses `max-w-7xl`, other steps keep `max-w-4xl`

### 3. Build PdfPanel
- Header strip: filename (truncated), "Open in new tab" link, "Hide" button (desktop)
- `<iframe src={pdfUrl}>` filling remaining height
- Handle `pdfUrl === null` gracefully (hide panel entirely)

### 4. Build mobile tab bar
- Segmented control: PDF / Form
- Only renders below `lg` breakpoint
- Controls which panel is visible on mobile

### 5. Restructure review step layout
- Wrap existing form in a flex-row split container
- PDF panel on left, form on right
- Form fields themselves are completely unchanged
- "Show PDF" button in form header when panel is hidden

### 6. Test
- Verify form fields still work identically (all existing tests should pass)
- Test toggle show/hide on desktop
- Test mobile tab switching
- Test with no pdfUrl (graceful degradation)
- Test draft resume path sets pdfUrl correctly

---

## Scope: MVP Only

### Build
- `<iframe>` PDF embed
- Collapsible split layout
- Mobile tab switcher
- "Open in new tab" fallback link

### Defer
- PDF.js integration with page controls
- Highlighted extraction regions (would need position metadata from Claude)
- Synchronized scrolling between form fields and PDF sections
- Resizable split panel (drag handle)

---

## Dependencies
- `pdfUrl` is already on `ExtractionResponse.pdf_url` (fresh upload path)
- `Contract.pdf_url` exists in types (draft resume path)
- Lucide icons: `ChevronLeft`, `ExternalLink`, `FileText` (most already imported)
- No new packages needed

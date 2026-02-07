# Likha MVP - Product & Implementation Plan

**Last Updated:** 2026-02-06

## MVP Scope: "Upload contract → Track one licensee"

### Core User Flow

1. User uploads a licensing contract PDF
2. AI extracts terms, user reviews/corrects
3. User enters monthly/quarterly sales figures
4. System calculates royalties owed + tracks against minimum guarantee

### Target User

Emerging brand with 1-5 licensees, currently using spreadsheets.

**Pain points:**
- Manual data entry for every contract term
- Error-prone royalty calculations (especially tiered rates)
- Forgetting to track minimum guarantee shortfalls
- No visibility into YTD progress

**Value proposition:**
- 10x faster contract setup (upload vs. manual entry)
- Accurate calculations (no Excel formula errors)
- Automatic minimum guarantee tracking
- Clear dashboard of what's owed

---

## Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Backend** | FastAPI (Python) | Extraction logic already in Python, fast to build, auto-generates docs |
| **Database** | PostgreSQL via Supabase | Auth + realtime + storage in one service, generous free tier |
| **Frontend** | Next.js 14 + TypeScript | Modern React, server actions for uploads, good DX |
| **UI Components** | Tailwind CSS + shadcn/ui | Decent-looking components with minimal effort |
| **File Storage** | Supabase Storage | Same platform as DB, built-in access control |
| **AI** | Claude Sonnet 4.5 | Validated in spike ($0.02-0.05 per extraction) |
| **Hosting** | Railway (backend) + Vercel (frontend) | Free tiers, easy deployment, CI/CD built-in |

---

## Data Model

### Contracts Table
```typescript
{
  id: uuid
  user_id: uuid (FK to auth.users)
  licensee_name: string
  pdf_url: string

  // Raw extraction
  extracted_terms: jsonb

  // Normalized fields (user-reviewed)
  royalty_rate: jsonb     // flat, tiered, or category-specific
  royalty_base: string
  territories: string[]
  product_categories: string[] | null
  contract_start_date: date
  contract_end_date: date
  minimum_guarantee: decimal
  minimum_guarantee_period: enum('annual', 'quarterly', 'monthly')
  advance_payment: decimal | null
  reporting_frequency: enum('monthly', 'quarterly')

  created_at: timestamp
  updated_at: timestamp
}
```

### Sales Periods Table
```typescript
{
  id: uuid
  contract_id: uuid (FK)
  period_start: date
  period_end: date
  net_sales: decimal
  category_breakdown: jsonb | null  // for category-specific rates
  royalty_calculated: decimal
  minimum_applied: boolean

  created_at: timestamp
  updated_at: timestamp
}
```

### Royalty Summary Table (cached/derived)
```typescript
{
  contract_id: uuid (FK)
  contract_year: integer
  total_sales_ytd: decimal
  total_royalties_ytd: decimal
  minimum_guarantee_ytd: decimal
  shortfall: decimal
  advance_remaining: decimal
  updated_at: timestamp
}
```

---

## MVP Features (2-Week Build)

### Week 1: Backend + Extraction

**Day 1-2: Project Setup**
- [x] Init FastAPI project
- [x] Setup Supabase (auth, DB, storage)
- [x] Port extraction logic to FastAPI endpoint
- [ ] Test extraction API with spike's 4 sample contracts

**Day 3-4: Database + CRUD**
- [x] Create schema in Supabase
- [x] Implement contracts CRUD endpoints
- [x] Implement sales_periods CRUD endpoints
- [x] Build royalty calculation engine

**Day 5: Testing**
- [ ] Unit tests for royalty calculator (flat, tiered, category)
- [ ] Integration tests for extraction flow
- [ ] Validate against spike's ground truth

### Week 2: Frontend

**Day 1-2: Core Pages**
- [ ] Auth (use Supabase auth components)
- [ ] Dashboard (list contracts)
- [ ] Upload contract page
- [ ] Extraction review page (edit extracted fields)

**Day 3-4: Sales Entry**
- [ ] Add sales period form
- [ ] Contract detail view
- [ ] Period history list
- [ ] Display calculated royalty + YTD summary

**Day 5: Polish**
- [ ] Error states
- [ ] Loading states
- [ ] Basic mobile responsiveness
- [ ] Deploy to staging

---

## Royalty Calculation Logic

The extraction gives us everything needed to calculate royalties:

### 1. Flat Rate
```python
royalty = net_sales * parse_percentage(rate)
```

**Example:** 8% of $100,000 = $8,000

### 2. Tiered Rate (marginal, like tax brackets)
```python
# For rate structure: 6% ($0-2M), 8% ($2M-5M), 10% ($5M+)
# On $3M in sales:
tier_1 = $2M * 0.06 = $120,000
tier_2 = $1M * 0.08 = $80,000
total = $200,000
```

### 3. Category-Specific
```python
# For rates: home textiles 10%, dinnerware 7%, fragrance 12%
# On sales: textiles $50K, dinnerware $30K, fragrance $20K
total = ($50K * 0.10) + ($30K * 0.07) + ($20K * 0.12)
      = $5,000 + $2,100 + $2,400
      = $9,500
```

### 4. Minimum Guarantee Application

**Quarterly minimum:**
```python
quarterly_royalty = max(calculated_royalty, minimum_guarantee)
```

**Annual minimum:**
```python
# Check at year-end:
if total_royalties_ytd < minimum_guarantee_ytd:
    shortfall = minimum_guarantee_ytd - total_royalties_ytd
    # User owes additional shortfall
```

### 5. Advance Payment Credit

```python
# Year 1:
net_payment = max(0, total_royalties - advance_payment)

# Year 2+:
net_payment = total_royalties
```

---

## MVP Non-Features (Defer to v2)

These are explicitly OUT OF SCOPE for the 2-week build:

- ❌ Multi-user accounts (single user only)
- ❌ Email reminders for report due dates
- ❌ CSV import for bulk sales entry
- ❌ Payment tracking (when royalties were actually paid)
- ❌ Licensee portal (for licensees to submit their own reports)
- ❌ OCR for scanned contracts
- ❌ Multi-contract bulk upload
- ❌ Advanced analytics/charts
- ❌ Audit log
- ❌ Multi-currency support
- ❌ Automated late fee calculation

---

## Implementation Order

### Phase 1: Backend Foundation (Days 1-5)

1. **Setup** ✅
   - FastAPI project structure
   - Supabase project + database
   - Environment configuration

2. **Core Services** ✅
   - Port `extractor.py` from spike
   - Implement `royalty_calc.py`
   - Test with spike's sample contracts

3. **API Endpoints** ✅
   - POST /api/contracts/extract
   - POST /api/contracts (create after review)
   - GET /api/contracts (list)
   - GET /api/contracts/{id}
   - POST /api/sales (create period)
   - GET /api/sales/contract/{id}

4. **Testing**
   - Unit tests for royalty calculator
   - Integration tests for extraction flow
   - Validate against ground truth

### Phase 2: Frontend Foundation (Days 6-10)

1. **Auth Flow**
   - Supabase Auth integration
   - Sign up / sign in pages
   - Protected routes

2. **Contract Upload Flow**
   - Upload page (drag & drop)
   - Processing state
   - Extraction review form
   - Save contract

3. **Dashboard**
   - List active contracts
   - Show next report due dates
   - YTD summary cards

4. **Sales Entry**
   - Add sales period form
   - Contract detail page
   - Period history table
   - Calculated royalty display

5. **Polish**
   - Error handling
   - Loading states
   - Mobile responsive
   - Deploy to staging

---

## File Structure

```
likha-app/
├── backend/
│   ├── app/
│   │   ├── main.py                 # FastAPI app ✅
│   │   ├── db.py                   # Supabase client ✅
│   │   ├── routers/
│   │   │   ├── contracts.py        # Contract CRUD + extraction ✅
│   │   │   └── sales.py            # Sales periods CRUD ✅
│   │   ├── services/
│   │   │   ├── extractor.py        # PDF → Claude → JSON ✅
│   │   │   └── royalty_calc.py     # Calculation engine ✅
│   │   └── models/
│   │       ├── contract.py         # Pydantic models ✅
│   │       └── sales.py            # Pydantic models ✅
│   ├── tests/
│   │   ├── test_extractor.py       # TODO
│   │   └── test_royalty_calc.py    # TODO
│   └── requirements.txt            # ✅
│
├── frontend/
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── login/              # TODO
│   │   │   └── signup/             # TODO
│   │   ├── dashboard/              # TODO
│   │   ├── contracts/
│   │   │   ├── [id]/               # TODO
│   │   │   └── upload/             # TODO
│   │   └── sales/
│   │       └── new/                # TODO
│   ├── components/
│   │   ├── contract-form.tsx       # TODO
│   │   ├── sales-entry-form.tsx    # TODO
│   │   └── royalty-calculator.tsx  # TODO
│   ├── lib/
│   │   ├── supabase.ts             # ✅
│   │   └── api.ts                  # ✅
│   └── package.json                # ✅
│
├── docs/
│   └── MVP.md                      # This file ✅
├── schema.sql                      # Database schema ✅
├── README.md                       # Technical docs ✅
└── QUICKSTART.md                   # Setup guide ✅
```

---

## Success Metrics (End of Week 2)

After 2 weeks of building, we should have:

- [ ] Working contract upload + extraction (with review)
- [ ] Sales entry for at least flat + tiered rates
- [ ] Accurate royalty calculation (validated against spike test cases)
- [ ] Dashboard showing YTD royalties vs minimum guarantee
- [ ] Deployed and usable by 1-2 beta users

**This is enough to:**
1. Demo to potential customers (Week 3-4 outreach per playbook)
2. Validate the workflow (do users actually want this vs. spreadsheets?)
3. Learn what's missing (what features do they ask for first?)

---

## Alternative: No-Code Validation First

If you want to validate the workflow before building the full MVP:

**Airtable + Make.com + Claude API**
- Airtable for contracts + sales data
- Make.com to orchestrate: upload PDF → call Claude API → write to Airtable
- Airtable formulas for basic royalty calculation

**Pros:**
- 2-3 days instead of 2 weeks
- Validates core workflow
- No code to maintain

**Cons:**
- Not scalable
- Clunky UX
- Manual intervention required

**Recommendation:** Only use no-code if you're uncertain about market fit. Otherwise, build the real MVP since you've already validated the tech in the spike.

---

## Cost Estimates

### Development
- **Your time:** 2 weeks (80 hours)
- **No external costs** (using free tiers)

### Operating Costs (MVP / Month)

| Service | Usage | Cost |
|---|---|---|
| Supabase | Free tier (500MB DB, 1GB storage, 50K auth users) | $0 |
| Anthropic API | ~100 extractions/month @ $0.02-0.05 each | $2-5 |
| Railway | Backend hosting (free tier: 500 hours/month) | $0 |
| Vercel | Frontend hosting (free tier) | $0 |
| **Total** | | **$2-5/month** |

At 10 users with 10 contracts each:
- 100 initial extractions: ~$5
- Ongoing: ~$5/month (for new contracts)

**Negligible costs until you hit scale.**

---

## Post-MVP Roadmap (v2 Features)

Once MVP is validated with 5-10 beta users:

### Phase 1: Workflow Improvements
- CSV import for bulk sales data
- Email notifications for report due dates
- Payment tracking (actual payment received vs. calculated)
- Audit log of all changes

### Phase 2: Multi-User
- Team accounts (invite collaborators)
- Role-based permissions
- Licensee portal (self-service reporting)

### Phase 3: Scale & Intelligence
- OCR for scanned contracts
- Multi-currency support
- Advanced analytics dashboard
- Automated reconciliation (flag discrepancies)
- API for ERP integrations

### Phase 4: Enterprise
- Custom rate structures
- Approval workflows
- White-label option
- SOC 2 compliance

---

## Decision Log

### Why FastAPI over Node/Express?
Extraction logic already in Python from spike. Faster to reuse than rewrite. Python's Decimal type better for financial calculations.

### Why Next.js over pure React?
Server actions make file uploads easier. Built-in routing. Better SEO if we add marketing pages later. Vercel deployment is one-click.

### Why Supabase over Firebase?
PostgreSQL > Firestore for relational data (contracts → sales periods). Storage + auth in one service. Better SQL support for complex queries (YTD summaries).

### Why not build backend in TypeScript?
Already have validated Python code. Not worth the rewrite. Can always port later if needed.

### Why Railway over Heroku?
Heroku killed free tier. Railway has generous free tier + better DX. Can deploy via git push.

---

## Next Actions

### Immediate (Today)
1. Create Supabase project
2. Run schema.sql in SQL Editor
3. Get Anthropic API key (if not already have one)
4. Test backend extraction endpoint with spike's sample contracts

### This Week (Days 1-5)
1. Implement auth endpoints
2. Test all CRUD operations
3. Write unit tests for royalty calculator
4. Validate calculations against spike's test cases

### Next Week (Days 6-10)
1. Build upload flow UI
2. Build review form UI
3. Build dashboard
4. Build sales entry form
5. Deploy to staging

### Week 3 (Validation)
1. Get 2-3 beta users (from Week 3-4 outreach per playbook)
2. Watch them use it (user testing)
3. Fix critical UX issues
4. Document feedback

### Week 4 (Iterate)
1. Prioritize top 3 feature requests
2. Build quick wins
3. Decide: keep building or pivot based on feedback

---

**This MVP plan balances speed (2 weeks) with functionality (actually useful). The spike validated the tech works. Now validate that users actually want it.**

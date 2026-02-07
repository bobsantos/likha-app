# Likha MVP - Quick Start Guide

Get up and running in 30 minutes.

## Prerequisites Checklist

- [ ] Python 3.11+ installed
- [ ] Node.js 18+ installed
- [ ] Supabase account created
- [ ] Anthropic API key obtained

## Step 1: Supabase Setup (10 min)

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Wait for the project to provision (~2 minutes)
3. Go to **SQL Editor** and run the contents of `schema.sql`
4. Go to **Settings → API** and copy:
   - Project URL
   - `anon` public key
   - `service_role` secret key (for backend only)
5. Go to **Storage** and create a bucket named `contracts` (private)

## Step 2: Backend Setup (5 min)

```bash
cd backend

# Create and activate virtual environment
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
```

Edit `.env`:
```bash
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-role-key
ANTHROPIC_API_KEY=sk-ant-your-key
```

```bash
# Start backend
uvicorn app.main:app --reload
```

Backend running at [http://localhost:8000](http://localhost:8000)
API docs at [http://localhost:8000/docs](http://localhost:8000/docs)

## Step 3: Frontend Setup (5 min)

```bash
cd frontend

# Install dependencies
npm install

# Configure environment
cp .env.local.example .env.local
```

Edit `.env.local`:
```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_API_URL=http://localhost:8000
```

```bash
# Start frontend
npm run dev
```

Frontend running at [http://localhost:3000](http://localhost:3000)

## Step 4: Test Extraction (5 min)

### Option A: Via API Docs

1. Go to [http://localhost:8000/docs](http://localhost:8000/docs)
2. Click on **POST /api/contracts/extract**
3. Click "Try it out"
4. Upload a PDF contract (use one from `../likha-contract-extraction-spike/sample_contracts/`)
5. Click "Execute"
6. See extracted terms in the response

### Option B: Via curl

```bash
curl -X POST "http://localhost:8000/api/contracts/extract" \
  -F "file=@../likha-contract-extraction-spike/sample_contracts/contract_simple.pdf"
```

### Expected Response

```json
{
  "extracted_terms": {
    "licensor_name": "Bright Star Brands, Inc.",
    "licensee_name": "Pacific Coast Apparel Co.",
    "royalty_rate": "8% of Net Sales",
    "territories": ["United States of America", "Canada"],
    ...
  },
  "token_usage": {
    "input_tokens": 1861,
    "output_tokens": 491,
    "total_tokens": 2352
  },
  "filename": "contract_simple.pdf"
}
```

## Step 5: Test Royalty Calculation (5 min)

```bash
# In Python shell or create a test script
cd backend
source .venv/bin/activate
python
```

```python
from app.services.royalty_calc import calculate_royalty
from decimal import Decimal

# Test flat rate
royalty = calculate_royalty("8% of Net Sales", Decimal("100000"))
print(f"Flat rate royalty: ${royalty}")  # $8,000

# Test tiered rate
tiers = [
    {"threshold": "$0-$2,000,000", "rate": "6%"},
    {"threshold": "$2,000,000-$5,000,000", "rate": "8%"},
    {"threshold": "$5,000,000+", "rate": "10%"}
]
royalty = calculate_royalty(tiers, Decimal("3000000"))
print(f"Tiered royalty: ${royalty}")  # $140,000

# Test category-specific
rates = {
    "home textiles": "10%",
    "dinnerware": "7%",
    "fragrance": "12%"
}
breakdown = {
    "home textiles": Decimal("50000"),
    "dinnerware": Decimal("30000"),
    "fragrance": Decimal("20000")
}
royalty = calculate_royalty(rates, Decimal("100000"), breakdown)
print(f"Category royalty: ${royalty}")  # $9,500
```

## Troubleshooting

### Backend won't start

- Check Python version: `python --version` (need 3.11+)
- Check virtual environment is activated (should see `(.venv)` in prompt)
- Check `.env` file exists and has valid credentials
- Check logs for specific error

### Frontend won't start

- Check Node version: `node --version` (need 18+)
- Try deleting `node_modules` and `.next`, then `npm install` again
- Check `.env.local` exists
- Check logs for specific error

### Extraction fails

- Check ANTHROPIC_API_KEY is set correctly
- Check you have API credits in your Anthropic account
- Try with a smaller PDF first
- Check backend logs for detailed error

### Database connection fails

- Check Supabase project is running (not paused)
- Check SUPABASE_URL and keys are correct
- Check you ran the `schema.sql` in SQL Editor
- Check RLS policies are created

## Next Steps

Once everything works:

1. **Add auth** - Implement Supabase Auth in frontend
2. **Build UI** - Create dashboard, upload flow, sales entry pages
3. **Test with real data** - Get a sample contract from target user
4. **Deploy** - Railway (backend) + Vercel (frontend)

## MVP Feature Checklist

Core flow to build:

- [ ] Upload contract PDF
- [ ] Review extracted terms
- [ ] Save contract to database
- [ ] View contract list
- [ ] Add sales period
- [ ] Auto-calculate royalty
- [ ] Show YTD summary

---

Need help? Check the full README.md or the spike documentation at `../likha-contract-extraction-spike/`

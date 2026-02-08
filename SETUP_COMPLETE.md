# Local Supabase Setup Complete

This document confirms the local Supabase setup for the Likha app.

## What Was Created

### 1. Supabase Directory Structure
```
supabase/
├── .gitignore                                    # Excludes local volumes
├── README.md                                     # Quick reference
├── check_setup.sh                                # Setup verification script
├── config.toml                                   # Local Supabase configuration
├── migrations/
│   ├── 20240208000000_initial_schema.sql        # Core database schema
│   └── 20240208000001_storage_setup.sql         # Storage bucket & policies
└── seed/
    └── seed.sql                                  # Sample data for testing
```

### 2. Environment Configuration Files

**Backend:**
- `/Users/bobsantos/likha/dev/likha-app/backend/.env.local.example`
  - Local Supabase URLs and keys
  - Pre-configured with default local keys

**Frontend:**
- `/Users/bobsantos/likha/dev/likha-app/frontend/.env.local.example` (updated)
  - Local Supabase URLs and keys
  - Pre-configured with default local keys

### 3. Documentation

**Main Guide:**
- `/Users/bobsantos/likha/dev/likha-app/LOCAL_DEVELOPMENT.md`
  - Complete local development guide
  - Installation instructions
  - Usage commands
  - Troubleshooting tips

**Quick Reference:**
- `/Users/bobsantos/likha/dev/likha-app/supabase/README.md`
  - Quick command reference
  - Migration management
  - Local URLs

**Updated:**
- `/Users/bobsantos/likha/dev/likha-app/README.md`
  - Added local development setup section
  - Links to LOCAL_DEVELOPMENT.md

## Next Steps

### 1. Install Supabase CLI (if not already installed)

**macOS:**
```bash
brew install supabase/tap/supabase
```

**Verify:**
```bash
supabase --version
```

### 2. Start Local Supabase

```bash
cd /Users/bobsantos/likha/dev/likha-app
supabase start
```

This will:
- Start Docker containers for PostgreSQL, Auth, Storage, Studio
- Apply all migrations from `supabase/migrations/`
- Display connection URLs and keys

**Expected output:**
```
Started supabase local development setup.

         API URL: http://127.0.0.1:54321
      Studio URL: http://127.0.0.1:54323
    Inbucket URL: http://127.0.0.1:54324
        anon key: eyJhbGci...
service_role key: eyJhbGci...
```

### 3. Configure Backend

```bash
cd backend
cp .env.local.example .env.local
# Edit .env.local and add your ANTHROPIC_API_KEY
```

### 4. Configure Frontend

```bash
cd frontend
cp .env.local.example .env.local
# No changes needed - already configured for local Supabase
```

### 5. Run the Application

**Terminal 1 - Backend:**
```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

**Terminal 3 - Check Status (optional):**
```bash
./supabase/check_setup.sh
```

## Local Service URLs

After `supabase start`, access:

| Service | URL | Purpose |
|---------|-----|---------|
| Studio UI | http://127.0.0.1:54323 | Database admin interface |
| API | http://127.0.0.1:54321 | Supabase REST API |
| Inbucket | http://127.0.0.1:54324 | Email testing |
| Frontend | http://localhost:3000 | Next.js app |
| Backend API | http://localhost:8000 | FastAPI app |
| API Docs | http://localhost:8000/docs | Interactive API docs |

## Default Local Keys

These are the standard Supabase local development keys (safe to commit):

**Anon Key:**
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
```

**Service Role Key:**
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU
```

⚠️ **NEVER use these keys in production!**

## Database Schema

The migrations create:

### Tables
1. **contracts** - Licensing contracts with extracted terms
2. **sales_periods** - Sales data linked to contracts
3. **royalty_summaries** - Cached YTD summaries

### Storage
- **contracts** bucket - Private storage for PDF files
  - Path: `contracts/{user_id}/{contract_id}.pdf`

### Security
- Row Level Security (RLS) enabled on all tables
- Users can only access their own data
- Storage policies restrict access to user's own folder

## Seed Data

The seed file includes:
- 2 sample contracts:
  - Acme Apparel Co. (flat 8% rate)
  - Global Toys Ltd. (tiered rates)
- Multiple sales periods for each contract

**Note:** Seed data requires a user. Create one via:
1. Frontend signup at http://localhost:3000
2. Supabase Studio at http://127.0.0.1:54323

## Useful Commands

```bash
# Start Supabase
supabase start

# Stop Supabase
supabase stop

# Reset database (rerun migrations + seed)
supabase db reset

# Check status
supabase status

# View logs
supabase logs --follow

# Create new migration
supabase migration new <name>

# Generate migration from changes
supabase db diff -f <name>

# Run setup check
./supabase/check_setup.sh
```

## Troubleshooting

### Supabase CLI Not Found
```bash
# macOS
brew install supabase/tap/supabase

# npm
npm install -g supabase
```

### Docker Not Running
Ensure Docker Desktop is running:
```bash
docker ps
```

### Port Conflicts
Edit `supabase/config.toml` to change default ports.

### Can't See Data
- Check you're authenticated (created a user)
- Verify RLS policies in migrations
- Use Studio to inspect data directly

### Reset Everything
```bash
supabase stop --no-backup
supabase start
```

## Documentation Reference

- **Complete Guide**: [LOCAL_DEVELOPMENT.md](/Users/bobsantos/likha/dev/likha-app/LOCAL_DEVELOPMENT.md)
- **Quick Reference**: [supabase/README.md](/Users/bobsantos/likha/dev/likha-app/supabase/README.md)
- **Main README**: [README.md](/Users/bobsantos/likha/dev/likha-app/README.md)

## What's Already Configured

✅ Supabase config file with optimized settings
✅ Two migrations (schema + storage)
✅ Seed data with sample contracts
✅ Environment file templates for both frontend and backend
✅ Complete documentation
✅ Setup verification script
✅ Updated main README with local dev instructions
✅ Proper .gitignore for Supabase volumes

## What You Need to Do

1. ❏ Install Supabase CLI
2. ❏ Run `supabase start`
3. ❏ Copy `.env.local.example` files
4. ❏ Add your ANTHROPIC_API_KEY
5. ❏ Start backend and frontend
6. ❏ Create a test user
7. ❏ Start building!

---

**Setup completed on:** 2026-02-08

**Ready to start local development!** 🚀

See [LOCAL_DEVELOPMENT.md](/Users/bobsantos/likha/dev/likha-app/LOCAL_DEVELOPMENT.md) for detailed instructions.

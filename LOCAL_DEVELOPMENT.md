# Local Development Guide

This guide explains how to set up and run the Likha app with local Supabase for development.

## Prerequisites

- Python 3.11+
- Node.js 18+
- Supabase CLI
- Docker (required by Supabase CLI)
- Anthropic API key

## Installing Supabase CLI

### macOS (Homebrew)
```bash
brew install supabase/tap/supabase
```

### macOS/Linux (npm)
```bash
npm install -g supabase
```

### Verify Installation
```bash
supabase --version
```

## Initial Setup

### 1. Start Local Supabase

From the project root:

```bash
supabase start
```

This will:
- Start local Docker containers for PostgreSQL, Auth, Storage, and Studio
- Run all migrations in `supabase/migrations/`
- Display your local connection details

**Expected output:**
```
Started supabase local development setup.

         API URL: http://127.0.0.1:54321
     GraphQL URL: http://127.0.0.1:54321/graphql/v1
          DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
      Studio URL: http://127.0.0.1:54323
    Inbucket URL: http://127.0.0.1:54324
      JWT secret: super-secret-jwt-token-with-at-least-32-characters-long
        anon key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
service_role key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU
```

### 2. Configure Backend Environment

```bash
cd backend
cp .env.local.example .env.local
```

Edit `.env.local` and add your Anthropic API key:
```bash
ANTHROPIC_API_KEY=sk-ant-your-actual-key
```

The Supabase keys are already set to the local defaults in the example file.

### 3. Configure Frontend Environment

```bash
cd frontend
cp .env.local.example .env.local
```

The local Supabase keys are already set in the example file. No changes needed.

## Running the Application

### 1. Start Backend (Terminal 1)

```bash
cd backend
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
uvicorn app.main:app --reload
```

Backend available at: http://localhost:8000
API docs at: http://localhost:8000/docs

### 2. Start Frontend (Terminal 2)

```bash
cd frontend
npm run dev
```

Frontend available at: http://localhost:3000

### 3. Access Supabase Studio (Optional)

Open http://127.0.0.1:54323 in your browser to access the local Supabase Studio.

From here you can:
- Browse tables and data
- Run SQL queries
- View storage buckets
- Manage auth users
- Monitor realtime subscriptions

## Database Management

### Apply Migrations

If you add new migration files, apply them with:

```bash
supabase db reset
```

This will:
- Drop and recreate the local database
- Run all migrations in order
- Run seed data from `supabase/seed/seed.sql`

**Warning:** This destroys all local data. Use only for development.

### Create a New Migration

```bash
supabase migration new <migration_name>
```

This creates a new migration file in `supabase/migrations/` with a timestamp prefix.

### Generate Migration from DB Changes

If you make changes via Studio SQL editor:

```bash
supabase db diff -f <migration_name>
```

This creates a migration file with the changes made since the last migration.

## Seed Data

The seed file at `supabase/seed/seed.sql` contains sample data for testing.

**To use seed data:**

1. Create a test user via the frontend or Supabase Studio
2. Update the seed file if needed to use the correct user_id
3. Run `supabase db reset` to apply migrations and seed data

**Sample data includes:**
- 2 contracts (one flat rate, one tiered)
- Several sales periods for each contract

## Testing Auth

### Create a Test User

Option 1: Via Frontend
- Navigate to http://localhost:3000
- Sign up with email/password

Option 2: Via Supabase Studio
- Open http://127.0.0.1:54323
- Go to Authentication > Users
- Click "Add user"

**Test credentials suggestion:**
- Email: test@example.com
- Password: password123

### Viewing Email Confirmations

Local Supabase includes Inbucket for email testing.

- Open http://127.0.0.1:54324
- View all emails sent by your app (confirmations, password resets, etc.)

## Storage Bucket

The `contracts` storage bucket is created automatically via migration.

**Bucket configuration:**
- Name: `contracts`
- Public: No (private)
- RLS enabled: Yes

**Upload structure:**
```
contracts/
  └── {user_id}/
      └── {contract_id}.pdf
```

Users can only access PDFs in their own folder.

## Stopping Supabase

To stop all local Supabase services:

```bash
supabase stop
```

To stop and remove all data:

```bash
supabase stop --no-backup
```

## Troubleshooting

### Port Conflicts

If ports 54321-54324 are already in use, you can modify them in `supabase/config.toml`.

### Docker Not Running

Supabase CLI requires Docker. Ensure Docker Desktop is running:

```bash
docker ps
```

### Migration Errors

If migrations fail, check:
1. SQL syntax in migration files
2. Dependencies between migrations (order matters)
3. Check logs: `supabase status`

### RLS Policies Blocking Queries

If you can't see data despite it existing in the database:
1. Check you're authenticated (have a valid auth token)
2. Verify RLS policies in `supabase/migrations/20240208000000_initial_schema.sql`
3. In Studio, you can disable RLS temporarily for testing (don't do this in production!)

### Resetting Everything

To completely reset local Supabase:

```bash
supabase stop --no-backup
supabase start
```

## Production vs Local

### Environment Files

**Backend:**
- `.env` - Production/remote Supabase
- `.env.local` - Local Supabase (this guide)

**Frontend:**
- `.env.local` - Switch between local and production Supabase

### Database URLs

**Local:**
- API: http://127.0.0.1:54321
- DB: postgresql://postgres:postgres@127.0.0.1:54322/postgres

**Production:**
- API: https://your-project.supabase.co
- DB: Provided by Supabase dashboard

## Useful Commands

```bash
# Check Supabase status
supabase status

# View logs
supabase logs --follow

# Reset database and apply migrations + seed
supabase db reset

# Create new migration
supabase migration new <name>

# Generate migration from schema changes
supabase db diff -f <name>

# Stop Supabase
supabase stop

# Start Supabase
supabase start

# Run tests against local database
cd backend && pytest
```

## Tips for Development

1. **Use Studio for data inspection** - It's much easier than running SQL queries
2. **Keep migrations small** - One logical change per migration
3. **Test RLS policies** - Use Studio to switch between different user contexts
4. **Seed data is your friend** - Update it to match your testing scenarios
5. **Reset often** - `supabase db reset` is quick and ensures clean state
6. **Check Inbucket** - Don't forget to check email confirmation links

## Next Steps

- Read the main [README.md](./README.md) for project overview
- Check [backend/README.md](./backend/README.md) for API documentation
- Review the spike at `../likha-contract-extraction-spike/` for extraction patterns

---

**Happy coding!** If you encounter issues, check the Supabase CLI docs: https://supabase.com/docs/guides/cli

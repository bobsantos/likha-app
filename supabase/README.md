# Supabase Local Development

This directory contains the local Supabase configuration for the Likha app.

## Structure

```
supabase/
├── config.toml           # Local Supabase configuration
├── migrations/           # Database migrations (run in order)
│   ├── 20240208000000_initial_schema.sql
│   └── 20240208000001_storage_setup.sql
└── seed/
    └── seed.sql         # Sample data for testing
```

## Quick Reference

### Start Local Supabase
```bash
supabase start
```

### Stop Local Supabase
```bash
supabase stop
```

### Reset Database (Run Migrations + Seed)
```bash
supabase db reset
```

### Create New Migration
```bash
supabase migration new <migration_name>
```

### Generate Migration from Schema Changes
```bash
supabase db diff -f <migration_name>
```

### Check Status
```bash
supabase status
```

## Local URLs

After running `supabase start`, access:

- **Studio UI**: http://127.0.0.1:54323
- **API**: http://127.0.0.1:54321
- **Database**: postgresql://postgres:postgres@127.0.0.1:54322/postgres
- **Inbucket (Email)**: http://127.0.0.1:54324

## Migrations

Migrations are SQL files that run in order (sorted by filename timestamp).

### Current Migrations

1. **20240208000000_initial_schema.sql**
   - Creates tables: contracts, sales_periods, royalty_summaries
   - Sets up RLS policies
   - Creates indexes and triggers

2. **20240208000001_storage_setup.sql**
   - Creates contracts storage bucket
   - Sets up storage policies for PDFs

### Adding a New Migration

1. Create migration file:
   ```bash
   supabase migration new add_new_feature
   ```

2. Edit the file in `supabase/migrations/`

3. Apply migration:
   ```bash
   supabase db reset
   ```

## Seed Data

The `seed/seed.sql` file contains sample data for testing.

**Includes:**
- 2 sample contracts (flat and tiered royalty rates)
- Several sales periods for each contract

**Note:** Seed data requires a user to exist. Create one via:
- Frontend signup at http://localhost:3000
- Supabase Studio at http://127.0.0.1:54323

## Configuration

The `config.toml` file configures:
- Port numbers for all services
- Database settings
- Auth configuration
- Storage limits
- Email testing (Inbucket)

**Default ports:**
- API: 54321
- Database: 54322
- Studio: 54323
- Inbucket: 54324

## Tips

1. **Use `supabase db reset` frequently** - It's fast and ensures clean state
2. **Check Studio for data inspection** - Much easier than SQL queries
3. **View emails in Inbucket** - http://127.0.0.1:54324 shows all test emails
4. **Test RLS policies carefully** - Use Studio to switch user contexts
5. **Keep migrations small** - One logical change per migration

## Troubleshooting

### Port Already in Use
Edit `config.toml` to change port numbers.

### Docker Not Running
Ensure Docker Desktop is running before `supabase start`.

### Migrations Fail
- Check SQL syntax
- Verify migration order (dependencies)
- Check logs: `supabase status`

### Can't See Data
- Verify RLS policies in migrations
- Ensure you're authenticated
- Check user_id matches in seed data

## More Info

See [../LOCAL_DEVELOPMENT.md](../LOCAL_DEVELOPMENT.md) for complete guide.

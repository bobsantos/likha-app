#!/bin/bash
# Quick check script to verify local Supabase setup

echo "🔍 Checking local Supabase setup..."
echo ""

# Check if Supabase CLI is installed
if command -v supabase &> /dev/null; then
    echo "✅ Supabase CLI installed"
    supabase --version
else
    echo "❌ Supabase CLI not found"
    echo "   Install with: brew install supabase/tap/supabase"
    exit 1
fi

echo ""

# Check if Docker is running
if docker ps &> /dev/null; then
    echo "✅ Docker is running"
else
    echo "❌ Docker is not running"
    echo "   Start Docker Desktop and try again"
    exit 1
fi

echo ""

# Check if Supabase is running
if supabase status &> /dev/null; then
    echo "✅ Local Supabase is running"
    echo ""
    echo "📊 Service URLs:"
    supabase status | grep -E "API URL|Studio URL|Inbucket URL"
else
    echo "⚠️  Local Supabase is not running"
    echo "   Start with: supabase start"
fi

echo ""

# Check for migration files
if [ -d "supabase/migrations" ] && [ "$(ls -A supabase/migrations)" ]; then
    echo "✅ Migration files found:"
    ls -1 supabase/migrations/
else
    echo "❌ No migration files found"
fi

echo ""

# Check for seed file
if [ -f "supabase/seed/seed.sql" ]; then
    echo "✅ Seed file exists"
else
    echo "⚠️  No seed file found"
fi

echo ""

# Check environment files
if [ -f "backend/.env.local.example" ]; then
    echo "✅ Backend env example exists"
else
    echo "⚠️  Backend .env.local.example not found"
fi

if [ -f "frontend/.env.local.example" ]; then
    echo "✅ Frontend env example exists"
else
    echo "⚠️  Frontend .env.local.example not found"
fi

echo ""
echo "✨ Setup check complete!"
echo ""
echo "Next steps:"
echo "1. Start Supabase: supabase start"
echo "2. Copy env files: cp backend/.env.local.example backend/.env.local"
echo "3. Copy env files: cp frontend/.env.local.example frontend/.env.local"
echo "4. Add your ANTHROPIC_API_KEY to backend/.env.local"
echo "5. Start backend: cd backend && uvicorn app.main:app --reload"
echo "6. Start frontend: cd frontend && npm run dev"
echo ""
echo "📚 See LOCAL_DEVELOPMENT.md for detailed instructions"

-- Seed data for local development
-- This file is run after migrations when using `supabase db reset`

-- Note: In local development, you'll need to create a test user first via Supabase Studio
-- or by signing up through the frontend. The user_id below is a placeholder.

-- For local testing without auth, we'll create some sample data
-- You can update the user_id values after creating a test user in your local Supabase

-- Sample contracts
-- Replace 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' with a real user_id from auth.users after signup

DO $$
DECLARE
    test_user_id UUID;
    contract1_id UUID;
    contract2_id UUID;
BEGIN
    -- Try to get the first user from auth.users, or use a placeholder UUID
    SELECT id INTO test_user_id FROM auth.users LIMIT 1;

    -- If no user exists, create a placeholder (won't work with RLS enabled)
    -- You should create a real user via the frontend or Supabase Studio
    IF test_user_id IS NULL THEN
        test_user_id := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
        RAISE NOTICE 'No users found. Using placeholder UUID. Create a real user to see seed data.';
    END IF;

    -- Sample Contract 1: Flat rate
    INSERT INTO contracts (
        id,
        user_id,
        licensee_name,
        pdf_url,
        extracted_terms,
        royalty_rate,
        royalty_base,
        territories,
        product_categories,
        contract_start_date,
        contract_end_date,
        minimum_guarantee,
        minimum_guarantee_period,
        advance_payment,
        reporting_frequency
    ) VALUES (
        uuid_generate_v4(),
        test_user_id,
        'Acme Apparel Co.',
        'https://example.com/contracts/acme-2024.pdf',
        '{
            "licensor_name": "Your Company",
            "licensee_name": "Acme Apparel Co.",
            "royalty_rate": "8% of Net Sales",
            "territories": ["United States", "Canada"],
            "confidence_score": 0.95
        }'::jsonb,
        '"8% of Net Sales"'::jsonb,
        'net sales',
        ARRAY['United States', 'Canada'],
        ARRAY['Apparel', 'Accessories'],
        '2024-01-01'::date,
        '2026-12-31'::date,
        50000.00,
        'annually',
        10000.00,
        'quarterly'
    ) RETURNING id INTO contract1_id;

    -- Sample Contract 2: Tiered rates
    INSERT INTO contracts (
        id,
        user_id,
        licensee_name,
        pdf_url,
        extracted_terms,
        royalty_rate,
        royalty_base,
        territories,
        product_categories,
        contract_start_date,
        contract_end_date,
        minimum_guarantee,
        minimum_guarantee_period,
        reporting_frequency
    ) VALUES (
        uuid_generate_v4(),
        test_user_id,
        'Global Toys Ltd.',
        'https://example.com/contracts/globaltoys-2024.pdf',
        '{
            "licensor_name": "Your Company",
            "licensee_name": "Global Toys Ltd.",
            "royalty_rate": [
                {"threshold": "$0-$2,000,000", "rate": "6%"},
                {"threshold": "$2,000,000-$5,000,000", "rate": "8%"},
                {"threshold": "$5,000,000+", "rate": "10%"}
            ],
            "territories": ["Worldwide"],
            "confidence_score": 0.92
        }'::jsonb,
        '[
            {"threshold": "$0-$2,000,000", "rate": "6%"},
            {"threshold": "$2,000,000-$5,000,000", "rate": "8%"},
            {"threshold": "$5,000,000+", "rate": "10%"}
        ]'::jsonb,
        'net sales',
        ARRAY['Worldwide'],
        ARRAY['Toys', 'Games'],
        '2024-03-01'::date,
        '2027-02-28'::date,
        100000.00,
        'annually',
        'quarterly'
    ) RETURNING id INTO contract2_id;

    -- Sample sales periods for Contract 1
    INSERT INTO sales_periods (
        contract_id,
        period_start,
        period_end,
        net_sales,
        royalty_calculated,
        minimum_applied
    ) VALUES
        (contract1_id, '2024-01-01', '2024-03-31', 75000.00, 6000.00, false),
        (contract1_id, '2024-04-01', '2024-06-30', 120000.00, 9600.00, false),
        (contract1_id, '2024-07-01', '2024-09-30', 95000.00, 7600.00, false);

    -- Sample sales periods for Contract 2
    INSERT INTO sales_periods (
        contract_id,
        period_start,
        period_end,
        net_sales,
        royalty_calculated,
        minimum_applied
    ) VALUES
        (contract2_id, '2024-03-01', '2024-05-31', 1500000.00, 90000.00, false),
        (contract2_id, '2024-06-01', '2024-08-31', 2800000.00, 184000.00, false);

    RAISE NOTICE 'Seed data inserted successfully for user: %', test_user_id;
END $$;

-- Initial database schema for Likha MVP
-- Migration: 20240208000000_initial_schema

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable btree_gist extension for exclusion constraints on UUID columns
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Contracts table
CREATE TABLE contracts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    licensee_name TEXT NOT NULL,
    pdf_url TEXT NOT NULL,

    -- Extracted terms (raw JSON from AI)
    extracted_terms JSONB NOT NULL,

    -- Normalized fields (reviewed by user)
    royalty_rate JSONB NOT NULL,  -- flat (string), tiered (array), or category (object)
    royalty_base TEXT NOT NULL DEFAULT 'net sales',
    territories TEXT[] NOT NULL DEFAULT '{}',
    product_categories TEXT[],
    contract_start_date DATE NOT NULL,
    contract_end_date DATE NOT NULL,
    minimum_guarantee DECIMAL(12, 2) NOT NULL DEFAULT 0,
    minimum_guarantee_period TEXT NOT NULL DEFAULT 'annually' CHECK (minimum_guarantee_period IN ('monthly', 'quarterly', 'annually')),
    advance_payment DECIMAL(12, 2),
    reporting_frequency TEXT NOT NULL DEFAULT 'quarterly' CHECK (reporting_frequency IN ('monthly', 'quarterly', 'annually')),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Sales periods table
CREATE TABLE sales_periods (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    net_sales DECIMAL(12, 2) NOT NULL CHECK (net_sales >= 0),
    category_breakdown JSONB,  -- { "apparel": 10000, "accessories": 5000 }
    royalty_calculated DECIMAL(12, 2) NOT NULL,
    minimum_applied BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Prevent overlapping periods for same contract
    CONSTRAINT no_overlapping_periods EXCLUDE USING gist (
        contract_id WITH =,
        daterange(period_start, period_end, '[]') WITH &&
    )
);

-- Royalty summary (cached/materialized view - optional for v1)
CREATE TABLE royalty_summaries (
    contract_id UUID PRIMARY KEY REFERENCES contracts(id) ON DELETE CASCADE,
    contract_year INTEGER NOT NULL,
    total_sales_ytd DECIMAL(12, 2) NOT NULL DEFAULT 0,
    total_royalties_ytd DECIMAL(12, 2) NOT NULL DEFAULT 0,
    minimum_guarantee_ytd DECIMAL(12, 2) NOT NULL DEFAULT 0,
    shortfall DECIMAL(12, 2) NOT NULL DEFAULT 0,
    advance_remaining DECIMAL(12, 2) NOT NULL DEFAULT 0,

    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_contracts_user_id ON contracts(user_id);
CREATE INDEX idx_sales_periods_contract_id ON sales_periods(contract_id);
CREATE INDEX idx_sales_periods_dates ON sales_periods(period_start, period_end);

-- Row Level Security (RLS) policies
-- Users can only see/modify their own data

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE royalty_summaries ENABLE ROW LEVEL SECURITY;

-- Contracts policies
CREATE POLICY "Users can view their own contracts"
    ON contracts FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own contracts"
    ON contracts FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own contracts"
    ON contracts FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own contracts"
    ON contracts FOR DELETE
    USING (auth.uid() = user_id);

-- Sales periods policies (inherit from contract ownership)
CREATE POLICY "Users can view sales periods for their contracts"
    ON sales_periods FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM contracts
            WHERE contracts.id = sales_periods.contract_id
            AND contracts.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert sales periods for their contracts"
    ON sales_periods FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM contracts
            WHERE contracts.id = sales_periods.contract_id
            AND contracts.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update sales periods for their contracts"
    ON sales_periods FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM contracts
            WHERE contracts.id = sales_periods.contract_id
            AND contracts.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete sales periods for their contracts"
    ON sales_periods FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM contracts
            WHERE contracts.id = sales_periods.contract_id
            AND contracts.user_id = auth.uid()
        )
    );

-- Royalty summaries policies
CREATE POLICY "Users can view royalty summaries for their contracts"
    ON royalty_summaries FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM contracts
            WHERE contracts.id = royalty_summaries.contract_id
            AND contracts.user_id = auth.uid()
        )
    );

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers to auto-update updated_at
CREATE TRIGGER update_contracts_updated_at BEFORE UPDATE ON contracts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sales_periods_updated_at BEFORE UPDATE ON sales_periods
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_royalty_summaries_updated_at BEFORE UPDATE ON royalty_summaries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

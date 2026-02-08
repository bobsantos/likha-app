# Day 7 Backend Tasks - PDF Storage Integration

## Completed Tasks

### 1. Storage Service (`app/services/storage.py`)

Created a new storage service with three main functions:

- **`upload_contract_pdf(file_content, user_id, filename)`**
  - Uploads PDF to Supabase Storage
  - Path: `contracts/{user_id}/{filename}`
  - Sanitizes filenames (replaces special chars with underscores)
  - Generates UUID filename if none provided
  - Returns storage path

- **`get_signed_url(storage_path, expiry_seconds=3600)`**
  - Generates signed URLs for PDF access
  - Default expiry: 1 hour (3600 seconds)
  - Returns HTTPS URL for frontend

- **`delete_contract_pdf(pdf_url_or_path)`**
  - Deletes PDF from storage
  - Accepts full URL or storage path
  - Returns True if deleted, False if not found

### 2. Updated Contracts Router

#### `/extract` Endpoint
- Uploads PDF to storage during extraction
- Returns `storage_path` and `pdf_url` in response
- PDF is available immediately for frontend display
- Temp file cleanup still happens in finally block

#### `/` (Create Contract) Endpoint
- Now accepts `pdf_url` in `ContractCreate` model
- Uses PDF URL from extraction step
- No longer uses placeholder URL

#### `/{contract_id}` (Delete Contract) Endpoint
- Deletes PDF from storage when contract is deleted
- Continues even if storage deletion fails (graceful degradation)
- Logs errors for debugging

### 3. Updated Models

#### `ContractCreate`
- Added `pdf_url: str` field
- PDF URL comes from extraction endpoint

### 4. Test Coverage

Created comprehensive test suites:

#### Storage Service Tests (`tests/test_storage.py`)
- 11 tests covering all storage functions
- Upload with/without filename
- Signed URL generation
- Deletion (success, not found, errors)
- Filename sanitization

#### Integration Tests (`tests/test_contracts_storage.py`)
- 7 tests for contracts router with storage
- Extract uploads PDF and returns URLs
- Create uses provided PDF URL
- Delete removes PDF from storage
- Error handling and cleanup

**Total: 94 tests passing**

## Setup Instructions

### 1. Environment Variables

Add to `.env`:
```bash
SUPABASE_SERVICE_KEY=your-service-role-key
```

The service key is required for storage operations (bypasses RLS).

### 2. Supabase Storage Bucket

Run the SQL in `/storage_setup.sql` in your Supabase SQL Editor:

```bash
# This creates:
# - 'contracts' bucket (private)
# - RLS policies for user-specific folders
```

### 3. Test the Implementation

```bash
cd backend
source .venv/bin/activate
pytest tests/test_storage.py -v
pytest tests/test_contracts_storage.py -v
pytest tests/ -v  # All tests
```

## API Changes

### `/api/contracts/extract` Response

**Before:**
```json
{
  "extracted_terms": {...},
  "token_usage": {...},
  "filename": "contract.pdf"
}
```

**After:**
```json
{
  "extracted_terms": {...},
  "token_usage": {...},
  "filename": "contract.pdf",
  "storage_path": "contracts/user-123/contract.pdf",
  "pdf_url": "https://...supabase.co/storage/v1/object/sign/contracts/user-123/contract.pdf?token=..."
}
```

### `/api/contracts/` Request

**Before:**
```json
{
  "licensee_name": "Test Corp",
  "extracted_terms": {...},
  ...
}
```

**After:**
```json
{
  "licensee_name": "Test Corp",
  "pdf_url": "https://...supabase.co/storage/v1/object/sign/...",
  "extracted_terms": {...},
  ...
}
```

## File Structure

```
backend/
├── app/
│   ├── services/
│   │   └── storage.py          # NEW: Storage service
│   ├── routers/
│   │   └── contracts.py        # UPDATED: Uses storage service
│   └── models/
│       └── contract.py         # UPDATED: Added pdf_url to ContractCreate
├── tests/
│   ├── test_storage.py         # NEW: Storage service tests
│   └── test_contracts_storage.py  # NEW: Integration tests
└── DAY7_BACKEND_TASKS.md       # This file

root/
└── storage_setup.sql           # NEW: Storage bucket setup
```

## Success Criteria

- [x] PDFs uploaded to `contracts/{user_id}/{uuid}.pdf`
- [x] Signed URLs returned in contract responses
- [x] PDFs deleted when contract is deleted
- [x] All tests passing (94/94)
- [x] TDD approach followed (red → green → refactor)

## Next Steps (Day 8)

1. Frontend will use the `pdf_url` from extraction response
2. Frontend will include `pdf_url` in contract creation
3. Frontend can display PDFs using signed URLs
4. Consider adding PDF preview in extraction review flow

## Notes

- Storage uses service role key (bypasses RLS)
- RLS policies on storage.objects protect user folders
- Signed URLs expire after 1 hour (configurable)
- Filename sanitization prevents storage errors
- Graceful degradation on storage errors (deletion)
- All financial calculations still use Decimal

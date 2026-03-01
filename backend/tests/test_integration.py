"""
Integration tests for end-to-end API flows.

Tests full request/response cycles through the FastAPI app using TestClient.
All external dependencies (Supabase, Anthropic) are mocked — no real DB or
AI API calls are made.

Flows tested:
  1. Auth flow — missing/invalid/expired/valid tokens
  2. Contract upload → extraction → draft → confirm (create)
  3. Sales period create → YTD summary
  4. Discrepancy calculation end-to-end
  5. Dashboard summary across multiple contracts
"""

import io
import os
import pytest
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, Mock, patch

# Ensure env vars are set before any app import
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")

from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Shared DB row factories
# ---------------------------------------------------------------------------

def _make_db_contract(
    contract_id: str = "contract-abc",
    user_id: str = "user-abc",
    status: str = "active",
    licensee_name: str = "Acme Licensing Co.",
    royalty_rate: str = "8%",
    minimum_guarantee: str = "0",
    minimum_guarantee_period: str = "annually",
    advance_payment: str | None = None,
    contract_start_date: str = "2026-01-01",
    contract_end_date: str = "2026-12-31",
    reporting_frequency: str = "quarterly",
    filename: str = "acme_license.pdf",
    licensee_email: str | None = "acme@example.com",
) -> dict:
    """Return a minimal dict that mimics a full Supabase contracts row."""
    return {
        "id": contract_id,
        "user_id": user_id,
        "status": status,
        "filename": filename,
        "licensee_name": licensee_name,
        "licensee_email": licensee_email,
        "agreement_number": f"LKH-2026-1",
        "pdf_url": f"https://test.supabase.co/storage/v1/object/sign/contracts/{user_id}/{filename}?token=abc",
        "storage_path": f"contracts/{user_id}/{filename}",
        "extracted_terms": {"licensee_name": licensee_name},
        "royalty_rate": royalty_rate,
        "royalty_base": "net sales",
        "territories": ["Worldwide"],
        "product_categories": None,
        "contract_start_date": contract_start_date,
        "contract_end_date": contract_end_date,
        "minimum_guarantee": minimum_guarantee,
        "minimum_guarantee_period": minimum_guarantee_period,
        "advance_payment": advance_payment,
        "reporting_frequency": reporting_frequency,
        "created_at": "2026-01-15T10:00:00Z",
        "updated_at": "2026-01-15T10:00:00Z",
    }


def _make_db_draft_contract(**overrides) -> dict:
    """Return a minimal draft contract row (before confirm)."""
    base = _make_db_contract(**overrides)
    base.update({
        "status": "draft",
        "licensee_name": None,
        "agreement_number": None,
        "royalty_rate": None,
        "royalty_base": None,
        "contract_start_date": None,
        "contract_end_date": None,
        "minimum_guarantee": None,
        "minimum_guarantee_period": None,
        "advance_payment": None,
        "reporting_frequency": None,
    })
    base.update(overrides)
    return base


def _make_db_sales_period(
    period_id: str = "sp-001",
    contract_id: str = "contract-abc",
    period_start: str = "2026-01-01",
    period_end: str = "2026-03-31",
    net_sales: str = "100000",
    royalty_calculated: str = "8000",
    minimum_applied: bool = False,
    licensee_reported_royalty: str | None = None,
    source_file_path: str | None = None,
) -> dict:
    """Return a minimal dict that mimics a Supabase sales_periods row."""
    return {
        "id": period_id,
        "contract_id": contract_id,
        "period_start": period_start,
        "period_end": period_end,
        "net_sales": net_sales,
        "category_breakdown": None,
        "royalty_calculated": royalty_calculated,
        "minimum_applied": minimum_applied,
        "licensee_reported_royalty": licensee_reported_royalty,
        "source_file_path": source_file_path,
        "created_at": "2026-04-01T00:00:00Z",
        "updated_at": "2026-04-01T00:00:00Z",
    }


# ---------------------------------------------------------------------------
# Auth helpers used across tests
# ---------------------------------------------------------------------------

def _auth_header(user_id: str = "user-abc") -> dict:
    """Return Authorization header and set up remote auth mock via context."""
    return {"Authorization": "Bearer valid-test-token"}


def _patch_auth(user_id: str = "user-abc"):
    """Context manager: patch supabase.auth.get_user to return user_id."""
    mock_sb = MagicMock()
    mock_sb.auth.get_user.return_value = Mock(user=Mock(id=user_id))
    return patch("app.auth.supabase", mock_sb)


# ---------------------------------------------------------------------------
# App fixture
# ---------------------------------------------------------------------------

@pytest.fixture()
def client():
    """Return a TestClient for the full FastAPI app with nothing pre-mocked."""
    from app.main import app
    return TestClient(app)


# ===========================================================================
# 1. Auth flow
# ===========================================================================

class TestAuthFlow:
    """
    Verify that all protected endpoints enforce JWT authentication correctly.

    We use GET /api/contracts/ as a representative protected endpoint.
    """

    def test_missing_auth_header_returns_401(self, client):
        """Request with no Authorization header should be rejected with 401."""
        response = client.get("/api/contracts/")
        assert response.status_code == 401
        assert response.json()["detail"] == "Not authenticated"

    def test_malformed_auth_header_returns_401(self, client):
        """Token without 'Bearer ' prefix should be rejected."""
        response = client.get(
            "/api/contracts/",
            headers={"Authorization": "Token some-random-token"},
        )
        assert response.status_code == 401
        assert "Invalid authentication" in response.json()["detail"]

    def test_invalid_token_returns_401(self, client):
        """An unrecognised token should be rejected with 401."""
        with patch("app.auth.supabase") as mock_sb:
            mock_sb.auth.get_user.side_effect = Exception("Invalid JWT")

            response = client.get(
                "/api/contracts/",
                headers={"Authorization": "Bearer bad-token"},
            )

        assert response.status_code == 401
        assert "Invalid token" in response.json()["detail"]

    def test_expired_token_returns_401(self, client):
        """An expired token should return 401 with an 'expired' message."""
        with patch("app.auth.supabase") as mock_sb:
            mock_sb.auth.get_user.side_effect = Exception("Token expired")

            response = client.get(
                "/api/contracts/",
                headers={"Authorization": "Bearer expired-token"},
            )

        assert response.status_code == 401
        assert "expired" in response.json()["detail"].lower()

    def test_valid_token_returns_200(self, client):
        """A valid token should let the request through (even if no data)."""
        with _patch_auth("user-abc") as mock_sb:
            with patch("app.routers.contracts.supabase_admin") as mock_db:
                mock_db.table.return_value.select.return_value \
                    .eq.return_value.eq.return_value.execute.return_value = Mock(data=[])

                response = client.get(
                    "/api/contracts/",
                    headers=_auth_header(),
                )

        assert response.status_code == 200
        assert response.json() == []

    def test_token_that_has_no_user_returns_401(self, client):
        """Token that resolves to no user object should return 401."""
        with patch("app.auth.supabase") as mock_sb:
            mock_sb.auth.get_user.return_value = Mock(user=None)

            response = client.get(
                "/api/contracts/",
                headers={"Authorization": "Bearer no-user-token"},
            )

        assert response.status_code == 401

    def test_health_endpoint_requires_no_auth(self, client):
        """GET /health should be publicly accessible without any token."""
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"

    def test_root_endpoint_requires_no_auth(self, client):
        """GET / should be publicly accessible."""
        response = client.get("/")
        assert response.status_code == 200


# ===========================================================================
# 2. Contract upload → extraction → draft → confirm
# ===========================================================================

class TestContractUploadFlow:
    """
    End-to-end flow: POST /extract → GET /{id} (draft) → PUT /{id}/confirm.

    Anthropic (Claude) is mocked to avoid API costs.
    Supabase admin client is mocked throughout.
    """

    # -----------------------------------------------------------------------
    # Helpers
    # -----------------------------------------------------------------------

    def _make_pdf_upload(self, filename: str = "license.pdf") -> dict:
        """Build a multipart upload payload for the /extract endpoint."""
        return {
            "file": (filename, io.BytesIO(b"%PDF-1.4 fake content"), "application/pdf"),
        }

    def _mock_no_duplicate(self, mock_db):
        """Configure supabase mock: duplicate-filename check returns empty."""
        mock_db.table.return_value.select.return_value \
            .eq.return_value.ilike.return_value.execute.return_value = Mock(data=[])

    def _mock_draft_insert(self, mock_db, draft_row: dict):
        """Configure supabase mock: INSERT returns the draft row."""
        mock_db.table.return_value.insert.return_value.execute.return_value = Mock(
            data=[draft_row]
        )

    def _extracted_terms_mock(self):
        """Return (ExtractedTerms mock, token_usage dict)."""
        terms = MagicMock()
        terms.model_dump.return_value = {
            "licensee_name": "Acme Licensing Co.",
            "royalty_rate": "8%",
            "royalty_base": "net sales",
            "territories": ["Worldwide"],
            "contract_start_date": "2026-01-01",
            "contract_end_date": "2026-12-31",
            "minimum_guarantee": "10000",
            "advance_payment": None,
            "reporting_frequency": "quarterly",
        }
        token_usage = {"input_tokens": 200, "output_tokens": 150, "total_tokens": 350}
        return terms, token_usage

    # -----------------------------------------------------------------------
    # POST /api/contracts/extract
    # -----------------------------------------------------------------------

    def test_extract_returns_draft_contract_id(self, client):
        """
        Posting a PDF to /extract should:
        - Upload to storage
        - Call Claude extraction (mocked)
        - Persist a draft row
        - Return contract_id, extracted_terms, form_values
        """
        user_id = "user-abc"
        draft_row = _make_db_draft_contract(
            contract_id="draft-001",
            user_id=user_id,
            filename="license.pdf",
        )

        terms_mock, token_usage = self._extracted_terms_mock()
        form_values_mock = MagicMock()
        form_values_mock.model_dump.return_value = {"licensee_name": "Acme Licensing Co."}

        with _patch_auth(user_id):
            with patch("app.routers.contracts.supabase_admin") as mock_db:
                self._mock_no_duplicate(mock_db)
                self._mock_draft_insert(mock_db, draft_row)

                with patch("app.routers.contracts.upload_contract_pdf") as mock_upload, \
                     patch("app.routers.contracts.get_signed_url") as mock_url, \
                     patch("app.routers.contracts.extract_contract") as mock_extract, \
                     patch("app.routers.contracts.normalize_extracted_terms") as mock_norm:

                    mock_upload.return_value = f"contracts/{user_id}/license.pdf"
                    mock_url.return_value = "https://storage.example.com/license.pdf"
                    mock_extract.return_value = (terms_mock, token_usage)
                    mock_norm.return_value = form_values_mock

                    response = client.post(
                        "/api/contracts/extract",
                        files=self._make_pdf_upload("license.pdf"),
                        headers=_auth_header(user_id),
                    )

        assert response.status_code == 200, response.text
        data = response.json()
        assert data["contract_id"] == "draft-001"
        assert "extracted_terms" in data
        assert "form_values" in data
        assert data["filename"] == "license.pdf"
        assert data["storage_path"] == f"contracts/{user_id}/license.pdf"

    def test_extract_rejects_non_pdf_files(self, client):
        """Non-PDF files should be rejected with 400."""
        user_id = "user-abc"

        with _patch_auth(user_id):
            response = client.post(
                "/api/contracts/extract",
                files={
                    "file": ("report.xlsx", io.BytesIO(b"PK fake xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
                },
                headers=_auth_header(user_id),
            )

        assert response.status_code == 400
        assert "PDF" in response.json()["detail"]

    def test_extract_returns_409_on_duplicate_active_contract(self, client):
        """
        Uploading a PDF with the same filename as an existing active contract
        should return 409 with code DUPLICATE_FILENAME.
        """
        user_id = "user-abc"
        existing = _make_db_contract(
            contract_id="existing-001",
            user_id=user_id,
            filename="license.pdf",
            status="active",
        )

        with _patch_auth(user_id):
            with patch("app.routers.contracts.supabase_admin") as mock_db:
                # Return existing active contract on duplicate check
                mock_db.table.return_value.select.return_value \
                    .eq.return_value.ilike.return_value.execute.return_value = Mock(
                        data=[existing]
                    )

                response = client.post(
                    "/api/contracts/extract",
                    files=self._make_pdf_upload("license.pdf"),
                    headers=_auth_header(user_id),
                )

        assert response.status_code == 409
        detail = response.json()["detail"]
        assert detail["code"] == "DUPLICATE_FILENAME"
        assert detail["existing_contract"]["id"] == "existing-001"

    def test_extract_returns_409_on_incomplete_draft(self, client):
        """
        Uploading a PDF matching an existing draft should return 409 with
        code INCOMPLETE_DRAFT so the frontend can redirect to review.
        """
        user_id = "user-abc"
        existing_draft = _make_db_draft_contract(
            contract_id="draft-999",
            user_id=user_id,
            filename="license.pdf",
        )

        with _patch_auth(user_id):
            with patch("app.routers.contracts.supabase_admin") as mock_db:
                mock_db.table.return_value.select.return_value \
                    .eq.return_value.ilike.return_value.execute.return_value = Mock(
                        data=[existing_draft]
                    )

                response = client.post(
                    "/api/contracts/extract",
                    files=self._make_pdf_upload("license.pdf"),
                    headers=_auth_header(user_id),
                )

        assert response.status_code == 409
        detail = response.json()["detail"]
        assert detail["code"] == "INCOMPLETE_DRAFT"

    def test_extract_requires_authentication(self, client):
        """POST /extract without auth should return 401."""
        response = client.post(
            "/api/contracts/extract",
            files=self._make_pdf_upload(),
        )
        assert response.status_code == 401

    # -----------------------------------------------------------------------
    # PUT /api/contracts/{id}/confirm
    # -----------------------------------------------------------------------

    def test_confirm_promotes_draft_to_active(self, client):
        """
        PUT /{id}/confirm should update status from draft → active and
        return the full active contract.

        We patch verify_contract_ownership directly (it lives in auth.py) to
        return the draft row, and then mock supabase_admin for the remaining
        two DB calls (agreement_number query + UPDATE).
        """
        user_id = "user-abc"
        contract_id = "draft-001"
        draft_row = _make_db_draft_contract(contract_id=contract_id, user_id=user_id)
        active_row = _make_db_contract(contract_id=contract_id, user_id=user_id)

        confirm_payload = {
            "licensee_name": "Acme Licensing Co.",
            "licensee_email": "acme@example.com",
            "royalty_rate": "8%",
            "royalty_base": "net_sales",
            "territories": ["Worldwide"],
            "product_categories": None,
            "contract_start_date": "2026-01-01",
            "contract_end_date": "2026-12-31",
            "minimum_guarantee": "10000.00",
            "minimum_guarantee_period": "annually",
            "advance_payment": None,
            "reporting_frequency": "quarterly",
        }

        with _patch_auth(user_id):
            # Patch verify_contract_ownership to bypass auth DB call
            with patch("app.routers.contracts.verify_contract_ownership",
                       new=AsyncMock(return_value=draft_row)):
                with patch("app.routers.contracts.supabase_admin") as mock_db:
                    # agreement_number sequence query (no existing numbers)
                    seq_chain = MagicMock()
                    seq_chain.execute.return_value = Mock(data=[])
                    seq_chain.eq.return_value = seq_chain
                    seq_chain.like.return_value = seq_chain
                    seq_chain.order.return_value = seq_chain
                    seq_chain.limit.return_value = seq_chain

                    # UPDATE returns active row
                    update_chain = MagicMock()
                    update_chain.eq.return_value.execute.return_value = Mock(data=[active_row])

                    contracts_table = MagicMock()
                    contracts_table.select.return_value = seq_chain
                    contracts_table.update.return_value = update_chain

                    mock_db.table.return_value = contracts_table

                    response = client.put(
                        f"/api/contracts/{contract_id}/confirm",
                        json=confirm_payload,
                        headers=_auth_header(user_id),
                    )

        assert response.status_code == 200, response.text
        data = response.json()
        assert data["id"] == contract_id
        assert data["status"] == "active"

    def test_confirm_returns_409_if_already_active(self, client):
        """Confirming an already-active contract should return 409."""
        user_id = "user-abc"
        contract_id = "active-001"
        active_row = _make_db_contract(contract_id=contract_id, user_id=user_id, status="active")

        confirm_payload = {
            "licensee_name": "Acme",
            "licensee_email": None,
            "royalty_rate": "8%",
            "royalty_base": "net_sales",
            "territories": [],
            "product_categories": None,
            "contract_start_date": "2026-01-01",
            "contract_end_date": "2026-12-31",
            "minimum_guarantee": "0",
            "minimum_guarantee_period": "annually",
            "advance_payment": None,
            "reporting_frequency": "quarterly",
        }

        # verify_contract_ownership returns the already-active row
        with _patch_auth(user_id):
            with patch("app.routers.contracts.verify_contract_ownership",
                       new=AsyncMock(return_value=active_row)):
                response = client.put(
                    f"/api/contracts/{contract_id}/confirm",
                    json=confirm_payload,
                    headers=_auth_header(user_id),
                )

        assert response.status_code == 409

    def test_confirm_returns_403_if_not_owner(self, client):
        """User cannot confirm a contract they do not own (403)."""
        from fastapi import HTTPException

        owner_id = "user-owner"
        requester_id = "user-other"
        contract_id = "contract-owned"

        confirm_payload = {
            "licensee_name": "Test",
            "licensee_email": None,
            "royalty_rate": "8%",
            "royalty_base": "net_sales",
            "territories": [],
            "product_categories": None,
            "contract_start_date": "2026-01-01",
            "contract_end_date": "2026-12-31",
            "minimum_guarantee": "0",
            "minimum_guarantee_period": "annually",
            "advance_payment": None,
            "reporting_frequency": "quarterly",
        }

        # Simulate verify_contract_ownership raising 403
        async def _raise_403(*args, **kwargs):
            raise HTTPException(status_code=403, detail="You are not authorized to access this contract")

        with _patch_auth(requester_id):
            with patch("app.routers.contracts.verify_contract_ownership",
                       side_effect=_raise_403):
                response = client.put(
                    f"/api/contracts/{contract_id}/confirm",
                    json=confirm_payload,
                    headers=_auth_header(requester_id),
                )

        assert response.status_code == 403

    def test_list_contracts_returns_only_active_by_default(self, client):
        """GET /api/contracts/ should return only active contracts."""
        user_id = "user-abc"
        contracts = [
            _make_db_contract(contract_id="c-1", user_id=user_id),
            _make_db_contract(contract_id="c-2", user_id=user_id),
        ]

        with _patch_auth(user_id):
            with patch("app.routers.contracts.supabase_admin") as mock_db:
                mock_db.table.return_value.select.return_value \
                    .eq.return_value.eq.return_value.execute.return_value = Mock(data=contracts)

                response = client.get(
                    "/api/contracts/",
                    headers=_auth_header(user_id),
                )

        assert response.status_code == 200
        result = response.json()
        assert len(result) == 2
        assert all(c["status"] == "active" for c in result)

    def test_get_single_contract_returns_404_for_unknown_id(self, client):
        """GET /api/contracts/{unknown-id} should return 404."""
        from fastapi import HTTPException

        user_id = "user-abc"

        async def _raise_404(*args, **kwargs):
            raise HTTPException(status_code=404, detail="Contract not found")

        with _patch_auth(user_id):
            with patch("app.routers.contracts.verify_contract_ownership",
                       side_effect=_raise_404):
                response = client.get(
                    "/api/contracts/does-not-exist",
                    headers=_auth_header(user_id),
                )

        assert response.status_code == 404


# ===========================================================================
# 3. Sales period create → YTD summary
# ===========================================================================

class TestSalesPeriodFlow:
    """
    End-to-end flow: POST /api/sales/ → GET /api/sales/summary/{contract_id}.

    Royalty calculations are exercised with real logic (not mocked).
    """

    def _make_supabase_for_create(self, mock_db, contract_row: dict, period_row: dict):
        """
        Set up the Supabase mock chain for POST /api/sales/:
          1. verify_contract_ownership (SELECT contracts by id)
          2. fetch contract for royalty calc (SELECT contracts by id again)
          3. INSERT sales period
        """
        ownership_chain = MagicMock()
        ownership_chain.execute.return_value = Mock(data=[contract_row])
        ownership_chain.select.return_value = ownership_chain
        ownership_chain.eq.return_value = ownership_chain

        insert_chain = MagicMock()
        insert_chain.execute.return_value = Mock(data=[period_row])

        def table_side_effect(name):
            if name == "contracts":
                return ownership_chain
            if name == "sales_periods":
                t = MagicMock()
                t.insert.return_value = insert_chain
                return t
            return MagicMock()

        mock_db.table.side_effect = table_side_effect

    def test_create_sales_period_calculates_royalty(self, client):
        """
        POST /api/sales/ with valid data should:
        - Verify contract ownership
        - Calculate royalty (8% of $100,000 = $8,000)
        - Persist and return the sales period
        """
        user_id = "user-abc"
        contract_id = "contract-abc"
        contract = _make_db_contract(
            contract_id=contract_id,
            user_id=user_id,
            royalty_rate="8%",
            minimum_guarantee="0",
        )
        period_row = _make_db_sales_period(
            contract_id=contract_id,
            net_sales="100000",
            royalty_calculated="8000",
        )

        payload = {
            "contract_id": contract_id,
            "period_start": "2026-01-01",
            "period_end": "2026-03-31",
            "net_sales": "100000.00",
            "category_breakdown": None,
            "licensee_reported_royalty": None,
        }

        with _patch_auth(user_id):
            with patch("app.routers.sales.verify_contract_ownership",
                       new=AsyncMock(return_value=contract)):
                with patch("app.routers.sales.supabase") as mock_db:
                    def table_side_effect(name):
                        t = MagicMock()
                        if name == "contracts":
                            t.select.return_value.eq.return_value.execute.return_value = Mock(
                                data=[contract]
                            )
                        elif name == "sales_periods":
                            t.insert.return_value.execute.return_value = Mock(data=[period_row])
                        return t

                    mock_db.table.side_effect = table_side_effect

                    response = client.post(
                        "/api/sales/",
                        json=payload,
                        headers=_auth_header(user_id),
                    )

        assert response.status_code == 200, response.text
        data = response.json()
        assert data["contract_id"] == contract_id
        assert Decimal(str(data["royalty_calculated"])) == Decimal("8000")

    def test_create_sales_period_requires_auth(self, client):
        """POST /api/sales/ without auth should return 401."""
        response = client.post(
            "/api/sales/",
            json={
                "contract_id": "c-1",
                "period_start": "2026-01-01",
                "period_end": "2026-03-31",
                "net_sales": "100000",
            },
        )
        assert response.status_code == 401

    def test_create_sales_period_returns_403_if_not_owner(self, client):
        """POST /api/sales/ for another user's contract should return 403."""
        from fastapi import HTTPException

        requester_id = "user-other"

        async def _raise_403(*args, **kwargs):
            raise HTTPException(status_code=403, detail="You are not authorized to access this contract")

        payload = {
            "contract_id": "contract-abc",
            "period_start": "2026-01-01",
            "period_end": "2026-03-31",
            "net_sales": "100000",
        }

        with _patch_auth(requester_id):
            with patch("app.routers.sales.verify_contract_ownership",
                       side_effect=_raise_403):
                response = client.post(
                    "/api/sales/",
                    json=payload,
                    headers=_auth_header(requester_id),
                )

        assert response.status_code == 403

    def test_ytd_summary_sums_periods_correctly(self, client):
        """
        GET /api/sales/summary/{contract_id} should aggregate multiple periods
        and return correct YTD totals.

        Two periods: $100,000 + $150,000 = $250,000 net sales.
        Royalty at 8%: $8,000 + $12,000 = $20,000.
        """
        user_id = "user-abc"
        contract_id = "contract-abc"
        contract = _make_db_contract(
            contract_id=contract_id,
            user_id=user_id,
            royalty_rate="8%",
            minimum_guarantee="0",
        )
        periods = [
            _make_db_sales_period(
                period_id="sp-1",
                contract_id=contract_id,
                net_sales="100000",
                royalty_calculated="8000",
            ),
            _make_db_sales_period(
                period_id="sp-2",
                contract_id=contract_id,
                period_start="2026-04-01",
                period_end="2026-06-30",
                net_sales="150000",
                royalty_calculated="12000",
            ),
        ]

        with _patch_auth(user_id):
            with patch("app.routers.sales.verify_contract_ownership",
                       new=AsyncMock(return_value=None)):
                with patch("app.routers.sales.supabase") as mock_db:
                    def table_side_effect(name):
                        t = MagicMock()
                        if name == "contracts":
                            t.select.return_value.eq.return_value.execute.return_value = Mock(
                                data=[contract]
                            )
                        elif name == "sales_periods":
                            t.select.return_value.eq.return_value.execute.return_value = Mock(
                                data=periods
                            )
                        return t

                    mock_db.table.side_effect = table_side_effect

                    response = client.get(
                        f"/api/sales/summary/{contract_id}",
                        headers=_auth_header(user_id),
                    )

        assert response.status_code == 200, response.text
        data = response.json()
        assert data["contract_id"] == contract_id
        assert Decimal(str(data["total_sales_ytd"])) == Decimal("250000")
        assert Decimal(str(data["total_royalties_ytd"])) == Decimal("20000")
        assert Decimal(str(data["shortfall"])) == Decimal("0")

    def test_ytd_summary_applies_minimum_guarantee(self, client):
        """
        When calculated royalty is below the minimum guarantee, shortfall
        should be positive.

        Annual minimum: $25,000. Calculated: $8,000. Shortfall: $17,000.
        """
        user_id = "user-abc"
        contract_id = "contract-mg"
        contract = _make_db_contract(
            contract_id=contract_id,
            user_id=user_id,
            royalty_rate="8%",
            minimum_guarantee="25000",
            minimum_guarantee_period="annually",
        )
        periods = [
            _make_db_sales_period(
                period_id="sp-1",
                contract_id=contract_id,
                net_sales="100000",
                royalty_calculated="8000",
            ),
        ]

        with _patch_auth(user_id):
            with patch("app.routers.sales.verify_contract_ownership",
                       new=AsyncMock(return_value=None)):
                with patch("app.routers.sales.supabase") as mock_db:
                    def table_side_effect(name):
                        t = MagicMock()
                        if name == "contracts":
                            t.select.return_value.eq.return_value.execute.return_value = Mock(
                                data=[contract]
                            )
                        elif name == "sales_periods":
                            t.select.return_value.eq.return_value.execute.return_value = Mock(
                                data=periods
                            )
                        return t

                    mock_db.table.side_effect = table_side_effect

                    response = client.get(
                        f"/api/sales/summary/{contract_id}",
                        headers=_auth_header(user_id),
                    )

        assert response.status_code == 200, response.text
        data = response.json()
        assert Decimal(str(data["minimum_guarantee_ytd"])) == Decimal("25000")
        assert Decimal(str(data["shortfall"])) == Decimal("17000")

    def test_ytd_summary_returns_404_for_unknown_contract(self, client):
        """GET /api/sales/summary/{unknown} should return 404."""
        from fastapi import HTTPException

        user_id = "user-abc"

        async def _raise_404(*args, **kwargs):
            raise HTTPException(status_code=404, detail="Contract not found")

        with _patch_auth(user_id):
            with patch("app.routers.sales.verify_contract_ownership",
                       side_effect=_raise_404):
                response = client.get(
                    "/api/sales/summary/does-not-exist",
                    headers=_auth_header(user_id),
                )

        assert response.status_code == 404

    def test_list_sales_periods_for_contract(self, client):
        """GET /api/sales/contract/{id} should return all periods in desc order."""
        user_id = "user-abc"
        contract_id = "contract-abc"
        contract = _make_db_contract(contract_id=contract_id, user_id=user_id)
        periods = [
            _make_db_sales_period(period_id="sp-2", contract_id=contract_id, period_start="2026-04-01"),
            _make_db_sales_period(period_id="sp-1", contract_id=contract_id),
        ]

        with _patch_auth(user_id):
            with patch("app.routers.sales.verify_contract_ownership",
                       new=AsyncMock(return_value=contract)):
                with patch("app.routers.sales.supabase") as mock_db:
                    t = MagicMock()
                    t.select.return_value.eq.return_value.order.return_value.execute.return_value = Mock(
                        data=periods
                    )
                    mock_db.table.return_value = t

                    response = client.get(
                        f"/api/sales/contract/{contract_id}",
                        headers=_auth_header(user_id),
                    )

        assert response.status_code == 200, response.text
        data = response.json()
        assert len(data) == 2


# ===========================================================================
# 4. Discrepancy calculation end-to-end
# ===========================================================================

class TestDiscrepancyFlow:
    """
    Verify that the discrepancy fields (discrepancy_amount, has_discrepancy)
    are computed correctly when a licensee_reported_royalty is provided.
    """

    def _post_period(self, client, user_id: str, contract_row: dict, period_row: dict,
                     payload: dict) -> dict:
        """
        Helper: POST /api/sales/ with ownership and DB mocked.
        Returns the parsed JSON response body.
        """
        with _patch_auth(user_id):
            with patch("app.routers.sales.verify_contract_ownership",
                       new=AsyncMock(return_value=contract_row)):
                with patch("app.routers.sales.supabase") as mock_db:
                    def table_side_effect(name):
                        t = MagicMock()
                        if name == "contracts":
                            t.select.return_value.eq.return_value.execute.return_value = Mock(
                                data=[contract_row]
                            )
                        elif name == "sales_periods":
                            t.insert.return_value.execute.return_value = Mock(data=[period_row])
                        return t

                    mock_db.table.side_effect = table_side_effect

                    response = client.post(
                        "/api/sales/",
                        json=payload,
                        headers=_auth_header(user_id),
                    )

        assert response.status_code == 200, response.text
        return response.json()

    def test_no_discrepancy_when_reported_matches_calculated(self, client):
        """
        When licensee_reported_royalty == royalty_calculated, has_discrepancy
        must be False and discrepancy_amount must be 0.
        """
        user_id = "user-abc"
        contract_id = "contract-abc"
        contract = _make_db_contract(contract_id=contract_id, user_id=user_id, royalty_rate="8%")
        period_row = _make_db_sales_period(
            contract_id=contract_id,
            net_sales="100000",
            royalty_calculated="8000",
            licensee_reported_royalty="8000",  # exact match
        )

        payload = {
            "contract_id": contract_id,
            "period_start": "2026-01-01",
            "period_end": "2026-03-31",
            "net_sales": "100000",
            "licensee_reported_royalty": "8000",
        }

        data = self._post_period(client, user_id, contract, period_row, payload)
        assert data["has_discrepancy"] is False
        assert Decimal(str(data["discrepancy_amount"])) == Decimal("0")

    def test_positive_discrepancy_when_licensee_under_reports(self, client):
        """
        When licensee_reported_royalty < royalty_calculated, the discrepancy
        is positive (licensor is owed more than reported).

        Calculated: $8,000. Reported: $7,500. Discrepancy: +$500.
        """
        user_id = "user-abc"
        contract_id = "contract-abc"
        contract = _make_db_contract(contract_id=contract_id, user_id=user_id, royalty_rate="8%")
        period_row = _make_db_sales_period(
            contract_id=contract_id,
            net_sales="100000",
            royalty_calculated="8000",
            licensee_reported_royalty="7500",
        )

        payload = {
            "contract_id": contract_id,
            "period_start": "2026-01-01",
            "period_end": "2026-03-31",
            "net_sales": "100000",
            "licensee_reported_royalty": "7500",
        }

        data = self._post_period(client, user_id, contract, period_row, payload)
        assert data["has_discrepancy"] is True
        assert Decimal(str(data["discrepancy_amount"])) == Decimal("500")

    def test_negative_discrepancy_when_licensee_over_reports(self, client):
        """
        When licensee_reported_royalty > royalty_calculated, the discrepancy
        is negative (licensor owes back or licensee overpaid).

        Calculated: $8,000. Reported: $9,000. Discrepancy: -$1,000.
        """
        user_id = "user-abc"
        contract_id = "contract-abc"
        contract = _make_db_contract(contract_id=contract_id, user_id=user_id, royalty_rate="8%")
        period_row = _make_db_sales_period(
            contract_id=contract_id,
            net_sales="100000",
            royalty_calculated="8000",
            licensee_reported_royalty="9000",
        )

        payload = {
            "contract_id": contract_id,
            "period_start": "2026-01-01",
            "period_end": "2026-03-31",
            "net_sales": "100000",
            "licensee_reported_royalty": "9000",
        }

        data = self._post_period(client, user_id, contract, period_row, payload)
        assert data["has_discrepancy"] is True
        assert Decimal(str(data["discrepancy_amount"])) == Decimal("-1000")

    def test_no_discrepancy_fields_when_no_reported_royalty(self, client):
        """
        When no licensee_reported_royalty is provided, discrepancy_amount is
        None and has_discrepancy is False.
        """
        user_id = "user-abc"
        contract_id = "contract-abc"
        contract = _make_db_contract(contract_id=contract_id, user_id=user_id, royalty_rate="8%")
        period_row = _make_db_sales_period(
            contract_id=contract_id,
            net_sales="100000",
            royalty_calculated="8000",
            licensee_reported_royalty=None,
        )

        payload = {
            "contract_id": contract_id,
            "period_start": "2026-01-01",
            "period_end": "2026-03-31",
            "net_sales": "100000",
        }

        data = self._post_period(client, user_id, contract, period_row, payload)
        assert data["has_discrepancy"] is False
        assert data["discrepancy_amount"] is None


# ===========================================================================
# 5. Dashboard summary
# ===========================================================================

class TestDashboardSummary:
    """
    Verify GET /api/sales/dashboard-summary returns correct YTD totals
    across multiple contracts.
    """

    def test_dashboard_summary_returns_zero_with_no_contracts(self, client):
        """User with no active contracts should get ytd_royalties = 0."""
        user_id = "user-abc"

        with _patch_auth(user_id):
            with patch("app.routers.sales.supabase") as mock_db:
                def table_side_effect(name):
                    t = MagicMock()
                    if name == "contracts":
                        t.select.return_value.eq.return_value.eq.return_value.execute.return_value = Mock(
                            data=[]
                        )
                    return t

                mock_db.table.side_effect = table_side_effect

                response = client.get(
                    "/api/sales/dashboard-summary",
                    headers=_auth_header(user_id),
                )

        assert response.status_code == 200, response.text
        data = response.json()
        assert Decimal(str(data["ytd_royalties"])) == Decimal("0")

    def test_dashboard_summary_sums_across_all_active_contracts(self, client):
        """
        User has two contracts; periods total $8,000 + $12,000 = $20,000.
        """
        user_id = "user-abc"
        current_year = 2026

        with _patch_auth(user_id):
            with patch("app.routers.sales.supabase") as mock_db:
                def table_side_effect(name):
                    t = MagicMock()
                    if name == "contracts":
                        t.select.return_value.eq.return_value.eq.return_value.execute.return_value = Mock(
                            data=[
                                {"id": "c-1"},
                                {"id": "c-2"},
                            ]
                        )
                    elif name == "sales_periods":
                        t.select.return_value.in_.return_value.gte.return_value.execute.return_value = Mock(
                            data=[
                                {"royalty_calculated": "8000"},
                                {"royalty_calculated": "12000"},
                            ]
                        )
                    return t

                mock_db.table.side_effect = table_side_effect

                response = client.get(
                    "/api/sales/dashboard-summary",
                    headers=_auth_header(user_id),
                )

        assert response.status_code == 200, response.text
        data = response.json()
        assert Decimal(str(data["ytd_royalties"])) == Decimal("20000")
        assert data["current_year"] == current_year

    def test_dashboard_summary_requires_auth(self, client):
        """GET /api/sales/dashboard-summary without auth should return 401."""
        response = client.get("/api/sales/dashboard-summary")
        assert response.status_code == 401


# ===========================================================================
# 6. Contract deletion with storage cleanup
# ===========================================================================

class TestContractDeletion:
    """Verify DELETE /api/contracts/{id} removes storage PDF and DB row."""

    def test_delete_contract_removes_pdf_and_db_row(self, client):
        """
        DELETE /{id} should call delete_contract_pdf and delete the DB row.
        Returns 200 with a confirmation message.
        """
        user_id = "user-abc"
        contract_id = "contract-abc"
        contract = _make_db_contract(contract_id=contract_id, user_id=user_id)

        with _patch_auth(user_id):
            with patch("app.routers.contracts.verify_contract_ownership",
                       new=AsyncMock(return_value=contract)):
                with patch("app.routers.contracts.supabase_admin") as mock_db, \
                     patch("app.routers.contracts.delete_contract_pdf") as mock_delete_pdf:

                    # DELETE query
                    mock_db.table.return_value.delete.return_value \
                        .eq.return_value.execute.return_value = Mock(data=[contract])

                    response = client.delete(
                        f"/api/contracts/{contract_id}",
                        headers=_auth_header(user_id),
                    )

        assert response.status_code == 200, response.text
        assert response.json()["message"] == "Contract deleted"
        mock_delete_pdf.assert_called_once()

    def test_delete_contract_returns_404_for_unknown_id(self, client):
        """DELETE on a non-existent contract should return 404."""
        from fastapi import HTTPException

        user_id = "user-abc"

        async def _raise_404(*args, **kwargs):
            raise HTTPException(status_code=404, detail="Contract not found")

        with _patch_auth(user_id):
            with patch("app.routers.contracts.verify_contract_ownership",
                       side_effect=_raise_404):
                response = client.delete(
                    "/api/contracts/does-not-exist",
                    headers=_auth_header(user_id),
                )

        assert response.status_code == 404

    def test_delete_contract_requires_auth(self, client):
        """DELETE without auth should return 401."""
        response = client.delete("/api/contracts/some-id")
        assert response.status_code == 401

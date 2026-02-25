"""
Email intake webhook and processing tests (Phase 2, Task 3).

Tests mock ALL external calls (Supabase, storage). No real DB or API calls.

TDD: tests written before implementation.

Coverage:
  - Provider-agnostic webhook endpoint (Resend + Postmark payloads)
  - InboundEmail / InboundAttachment models
  - normalize_postmark / normalize_resend adapter functions
  - normalize_webhook dispatcher (EMAIL_PROVIDER env var)
  - X-Webhook-Secret and legacy X-Postmark-Secret header auth
  - Report list / confirm / reject endpoints (unchanged business logic)
"""

import base64
import os
import pytest
from unittest.mock import MagicMock, Mock, patch

# Ensure env vars are set before importing anything that triggers app imports
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")
# Set INBOUND_WEBHOOK_SECRET — the new canonical name.  Legacy tests that send
# X-Postmark-Secret will also work because the auth dependency checks both.
os.environ.setdefault("INBOUND_WEBHOOK_SECRET", "test-webhook-secret")

from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Payload builder helpers
# ---------------------------------------------------------------------------

def _make_attachment_content(content: bytes = b"col1,col2\n100,200") -> str:
    """Return base64-encoded attachment content string."""
    return base64.b64encode(content).decode()


def _make_postmark_payload(
    from_email: str = "licensee@example.com",
    to_address: str = "reports-abcd1234@inbound.likha.app",
    subject: str = "Q1 2025 Royalty Report",
    attachments: list | None = None,
) -> dict:
    """Build a minimal Postmark inbound webhook payload (PascalCase)."""
    if attachments is None:
        attachments = [
            {
                "Name": "report.csv",
                "Content": _make_attachment_content(),
                "ContentType": "text/csv",
            }
        ]
    return {
        "From": from_email,
        "To": to_address,
        "Subject": subject,
        "Attachments": attachments,
    }


def _make_resend_payload(
    from_email: str = "licensee@example.com",
    to_address: str = "reports-abcd1234@inbound.likha.app",
    subject: str = "Q1 2025 Royalty Report",
    attachments: list | None = None,
) -> dict:
    """Build a minimal Resend inbound webhook payload (snake_case)."""
    if attachments is None:
        attachments = [
            {
                "filename": "report.csv",
                "content": _make_attachment_content(),
                "content_type": "text/csv",
            }
        ]
    return {
        "from": from_email,
        "to": to_address,
        "subject": subject,
        "attachments": attachments,
    }


# ---------------------------------------------------------------------------
# DB row helpers
# ---------------------------------------------------------------------------

def _make_db_user(user_id: str = "abcd1234-0000-0000-0000-000000000000") -> dict:
    return {"id": user_id}


def _make_db_contract(
    contract_id: str = "contract-abc",
    user_id: str = "abcd1234-0000-0000-0000-000000000000",
    licensee_email: str = "licensee@example.com",
) -> dict:
    return {
        "id": contract_id,
        "user_id": user_id,
        "status": "active",
        "licensee_name": "Licensee Co.",
        "licensee_email": licensee_email,
        "pdf_url": "https://test.supabase.co/storage/test.pdf",
        "extracted_terms": {},
        "royalty_rate": "8%",
        "royalty_base": "net sales",
        "territories": [],
        "product_categories": None,
        "contract_start_date": "2025-01-01",
        "contract_end_date": "2025-12-31",
        "minimum_guarantee": "0",
        "minimum_guarantee_period": "annually",
        "advance_payment": None,
        "reporting_frequency": "quarterly",
        "storage_path": f"contracts/{user_id}/test.pdf",
        "created_at": "2025-01-01T00:00:00Z",
        "updated_at": "2025-01-01T00:00:00Z",
    }


def _make_db_inbound_report(
    report_id: str = "report-123",
    user_id: str = "abcd1234-0000-0000-0000-000000000000",
    contract_id: str | None = "contract-abc",
    sender_email: str = "licensee@example.com",
    match_confidence: str = "high",
    status: str = "pending",
) -> dict:
    return {
        "id": report_id,
        "user_id": user_id,
        "contract_id": contract_id,
        "sender_email": sender_email,
        "subject": "Q1 2025 Royalty Report",
        "received_at": "2026-02-24T00:00:00Z",
        "attachment_filename": "report.csv",
        "attachment_path": f"inbound/{user_id}/{report_id}/report.csv",
        "match_confidence": match_confidence,
        "status": status,
        "created_at": "2026-02-24T00:00:00Z",
        "updated_at": "2026-02-24T00:00:00Z",
    }


# ---------------------------------------------------------------------------
# Supabase chain mock helper
# ---------------------------------------------------------------------------

def _make_supabase_chain(*results):
    """
    Build a MagicMock that returns results[i] from the i-th .execute() call,
    regardless of which chaining methods (.eq, .select, .insert, etc.) were called.
    """
    mock = MagicMock()
    mock.select.return_value = mock
    mock.eq.return_value = mock
    mock.insert.return_value = mock
    mock.update.return_value = mock
    mock.upsert.return_value = mock
    mock.ilike.return_value = mock
    mock.limit.return_value = mock
    mock.execute.side_effect = [Mock(data=r) for r in results]
    return mock


# ---------------------------------------------------------------------------
# Standard table-side-effect factory used by webhook tests
# ---------------------------------------------------------------------------

def _make_webhook_table_side_effect(user_id, contract_data, report_row):
    """Return a table() side-effect that covers the three webhook DB calls."""

    users_mock = MagicMock()
    users_mock.execute.return_value = Mock(data=[_make_db_user(user_id)])
    users_mock.ilike.return_value = users_mock
    users_mock.select.return_value = users_mock

    contracts_mock = MagicMock()
    contracts_mock.execute.return_value = Mock(data=contract_data)
    contracts_mock.eq.return_value = contracts_mock
    contracts_mock.select.return_value = contracts_mock

    insert_mock = MagicMock()
    insert_mock.execute.return_value = Mock(data=[report_row])

    def side_effect(name):
        if name == "users":
            return users_mock
        if name == "contracts":
            return contracts_mock
        if name == "inbound_reports":
            t = MagicMock()
            t.insert.return_value = insert_mock
            return t
        return MagicMock()

    return side_effect


# ---------------------------------------------------------------------------
# App fixture
# ---------------------------------------------------------------------------

@pytest.fixture()
def client():
    """Return a TestClient for the FastAPI app with Supabase fully mocked."""
    from app.main import app
    return TestClient(app)


# ===========================================================================
# GET /api/email-intake/inbound-address
# ===========================================================================

class TestGetInboundAddress:
    """GET /api/email-intake/inbound-address returns user's inbound email."""

    def test_returns_inbound_address_for_authenticated_user(self, client):
        user_id = "abcd1234-ef00-0000-0000-000000000000"
        expected_short_id = "abcd1234"

        with patch("app.auth.supabase") as mock_auth_sb:
            mock_auth_sb.auth.get_user.return_value = Mock(user=Mock(id=user_id))

            response = client.get(
                "/api/email-intake/inbound-address",
                headers={"Authorization": "Bearer test-token"},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["inbound_address"] == f"reports-{expected_short_id}@inbound.likha.app"
        assert data["user_id"] == user_id

    def test_requires_auth(self, client):
        response = client.get("/api/email-intake/inbound-address")
        assert response.status_code == 401


# ===========================================================================
# POST /api/email-intake/inbound  — webhook authentication
# ===========================================================================

class TestWebhookAuthentication:
    """
    Webhook auth is provider-agnostic: the endpoint accepts the shared secret
    in either X-Webhook-Secret (new) or X-Postmark-Secret (legacy).
    """

    def test_rejects_request_with_no_secret_header(self, client):
        response = client.post(
            "/api/email-intake/inbound",
            json=_make_resend_payload(),
        )
        assert response.status_code == 401

    def test_rejects_request_with_wrong_secret(self, client):
        response = client.post(
            "/api/email-intake/inbound",
            json=_make_resend_payload(),
            headers={"X-Webhook-Secret": "wrong-secret"},
        )
        assert response.status_code == 401

    def test_accepts_x_webhook_secret_header(self, client):
        """New provider-agnostic header is accepted."""
        user_id = "abcd1234-0000-0000-0000-000000000000"
        contract = _make_db_contract(user_id=user_id)
        report = _make_db_inbound_report(user_id=user_id)

        with patch("app.routers.email_intake.supabase_admin") as mock_sb, \
             patch("app.routers.email_intake._upload_inbound_attachment") as mock_upload:
            mock_upload.return_value = "inbound/path/report.csv"
            mock_sb.table.side_effect = _make_webhook_table_side_effect(
                user_id, [contract], report
            )

            response = client.post(
                "/api/email-intake/inbound",
                json=_make_resend_payload(),
                headers={"X-Webhook-Secret": "test-webhook-secret"},
            )

        assert response.status_code == 200

    def test_accepts_legacy_x_postmark_secret_header(self, client):
        """Legacy Postmark header still works for backward compatibility."""
        user_id = "abcd1234-0000-0000-0000-000000000000"
        contract = _make_db_contract(user_id=user_id)
        report = _make_db_inbound_report(user_id=user_id)

        with patch("app.routers.email_intake.supabase_admin") as mock_sb, \
             patch("app.routers.email_intake._upload_inbound_attachment") as mock_upload, \
             patch.dict(os.environ, {"EMAIL_PROVIDER": "postmark"}):
            mock_upload.return_value = "inbound/path/report.csv"
            mock_sb.table.side_effect = _make_webhook_table_side_effect(
                user_id, [contract], report
            )

            response = client.post(
                "/api/email-intake/inbound",
                json=_make_postmark_payload(),
                headers={"X-Postmark-Secret": "test-webhook-secret"},
            )

        assert response.status_code == 200


# ===========================================================================
# POST /api/email-intake/inbound  — Resend payload (default provider)
# ===========================================================================

class TestInboundWebhookResend:
    """POST /api/email-intake/inbound with Resend payload (EMAIL_PROVIDER=resend)."""

    def _post_inbound(self, client, payload: dict, secret: str = "test-webhook-secret"):
        return client.post(
            "/api/email-intake/inbound",
            json=payload,
            headers={"X-Webhook-Secret": secret},
        )

    def test_high_confidence_match_creates_report(self, client):
        """One matching active contract → match_confidence = 'high'."""
        user_id = "abcd1234-0000-0000-0000-000000000000"
        contract = _make_db_contract(user_id=user_id)
        report = _make_db_inbound_report(user_id=user_id, contract_id=contract["id"])

        with patch("app.routers.email_intake.supabase_admin") as mock_sb, \
             patch("app.routers.email_intake._upload_inbound_attachment") as mock_upload, \
             patch.dict(os.environ, {"EMAIL_PROVIDER": "resend"}):
            mock_upload.return_value = f"inbound/{user_id}/report-123/report.csv"
            mock_sb.table.side_effect = _make_webhook_table_side_effect(
                user_id, [contract], report
            )

            response = self._post_inbound(
                client,
                _make_resend_payload(
                    from_email="licensee@example.com",
                    to_address="reports-abcd1234@inbound.likha.app",
                ),
            )

        assert response.status_code == 200
        data = response.json()
        assert data["match_confidence"] == "high"
        assert data["contract_id"] == contract["id"]
        assert data["status"] == "pending"

    def test_no_match_creates_report_with_none_confidence(self, client):
        """No matching contract → match_confidence = 'none', contract_id = null."""
        user_id = "abcd1234-0000-0000-0000-000000000000"
        report = _make_db_inbound_report(
            user_id=user_id, contract_id=None, match_confidence="none"
        )

        with patch("app.routers.email_intake.supabase_admin") as mock_sb, \
             patch("app.routers.email_intake._upload_inbound_attachment") as mock_upload, \
             patch.dict(os.environ, {"EMAIL_PROVIDER": "resend"}):
            mock_upload.return_value = f"inbound/{user_id}/report-123/report.csv"
            mock_sb.table.side_effect = _make_webhook_table_side_effect(
                user_id, [], report
            )

            response = self._post_inbound(
                client,
                _make_resend_payload(
                    from_email="unknown@example.com",
                    to_address="reports-abcd1234@inbound.likha.app",
                ),
            )

        assert response.status_code == 200
        data = response.json()
        assert data["match_confidence"] == "none"
        assert data["contract_id"] is None

    def test_unknown_user_short_id_still_returns_200(self, client):
        """Unknown short_id → 200 (provider must not retry). Report not created."""
        with patch("app.routers.email_intake.supabase_admin") as mock_sb, \
             patch.dict(os.environ, {"EMAIL_PROVIDER": "resend"}):
            users_mock = MagicMock()
            users_mock.execute.return_value = Mock(data=[])
            users_mock.ilike.return_value = users_mock
            users_mock.select.return_value = users_mock
            mock_sb.table.return_value = users_mock

            response = self._post_inbound(
                client,
                _make_resend_payload(to_address="reports-xxxxxxxx@inbound.likha.app"),
            )

        assert response.status_code == 200

    def test_no_attachment_still_returns_200(self, client):
        """No attachment — inbound_report created with no file paths."""
        user_id = "abcd1234-0000-0000-0000-000000000000"
        report = _make_db_inbound_report(
            user_id=user_id, contract_id=None, match_confidence="none"
        )
        report["attachment_filename"] = None
        report["attachment_path"] = None

        with patch("app.routers.email_intake.supabase_admin") as mock_sb, \
             patch.dict(os.environ, {"EMAIL_PROVIDER": "resend"}):
            mock_sb.table.side_effect = _make_webhook_table_side_effect(
                user_id, [], report
            )

            response = self._post_inbound(
                client, _make_resend_payload(attachments=[])
            )

        assert response.status_code == 200

    def test_multiple_matches_treated_as_none_confidence(self, client):
        """Multiple matching contracts → match_confidence = 'none' (MVP cut)."""
        user_id = "abcd1234-0000-0000-0000-000000000000"
        contract1 = _make_db_contract(contract_id="c1", user_id=user_id)
        contract2 = _make_db_contract(contract_id="c2", user_id=user_id)
        report = _make_db_inbound_report(
            user_id=user_id, contract_id=None, match_confidence="none"
        )

        with patch("app.routers.email_intake.supabase_admin") as mock_sb, \
             patch("app.routers.email_intake._upload_inbound_attachment") as mock_upload, \
             patch.dict(os.environ, {"EMAIL_PROVIDER": "resend"}):
            mock_upload.return_value = f"inbound/{user_id}/report-123/report.csv"
            mock_sb.table.side_effect = _make_webhook_table_side_effect(
                user_id, [contract1, contract2], report
            )

            response = self._post_inbound(
                client,
                _make_resend_payload(
                    from_email="licensee@example.com",
                    to_address="reports-abcd1234@inbound.likha.app",
                ),
            )

        assert response.status_code == 200
        data = response.json()
        assert data["match_confidence"] == "none"


# ===========================================================================
# POST /api/email-intake/inbound  — Postmark payload (EMAIL_PROVIDER=postmark)
# ===========================================================================

class TestInboundWebhookPostmark:
    """POST /api/email-intake/inbound with Postmark payload (EMAIL_PROVIDER=postmark)."""

    def _post_inbound(self, client, payload: dict, secret: str = "test-webhook-secret"):
        return client.post(
            "/api/email-intake/inbound",
            json=payload,
            headers={"X-Postmark-Secret": secret},
        )

    def test_high_confidence_match_creates_report(self, client):
        """Postmark payload normalizes correctly and creates a matched report."""
        user_id = "abcd1234-0000-0000-0000-000000000000"
        contract = _make_db_contract(user_id=user_id)
        report = _make_db_inbound_report(user_id=user_id, contract_id=contract["id"])

        with patch("app.routers.email_intake.supabase_admin") as mock_sb, \
             patch("app.routers.email_intake._upload_inbound_attachment") as mock_upload, \
             patch.dict(os.environ, {"EMAIL_PROVIDER": "postmark"}):
            mock_upload.return_value = f"inbound/{user_id}/report-123/report.csv"
            mock_sb.table.side_effect = _make_webhook_table_side_effect(
                user_id, [contract], report
            )

            response = self._post_inbound(
                client,
                _make_postmark_payload(
                    from_email="licensee@example.com",
                    to_address="reports-abcd1234@inbound.likha.app",
                ),
            )

        assert response.status_code == 200
        data = response.json()
        assert data["match_confidence"] == "high"
        assert data["contract_id"] == contract["id"]
        assert data["status"] == "pending"

    def test_rejects_missing_secret(self, client):
        response = client.post(
            "/api/email-intake/inbound", json=_make_postmark_payload()
        )
        assert response.status_code == 401

    def test_rejects_wrong_secret(self, client):
        response = self._post_inbound(
            client, _make_postmark_payload(), secret="wrong-secret"
        )
        assert response.status_code == 401

    def test_no_attachment_still_returns_200(self, client):
        user_id = "abcd1234-0000-0000-0000-000000000000"
        report = _make_db_inbound_report(
            user_id=user_id, contract_id=None, match_confidence="none"
        )
        report["attachment_filename"] = None
        report["attachment_path"] = None

        with patch("app.routers.email_intake.supabase_admin") as mock_sb, \
             patch.dict(os.environ, {"EMAIL_PROVIDER": "postmark"}):
            mock_sb.table.side_effect = _make_webhook_table_side_effect(
                user_id, [], report
            )

            response = self._post_inbound(
                client, _make_postmark_payload(attachments=[])
            )

        assert response.status_code == 200

    def test_unknown_user_short_id_still_returns_200(self, client):
        with patch("app.routers.email_intake.supabase_admin") as mock_sb, \
             patch.dict(os.environ, {"EMAIL_PROVIDER": "postmark"}):
            users_mock = MagicMock()
            users_mock.execute.return_value = Mock(data=[])
            users_mock.ilike.return_value = users_mock
            users_mock.select.return_value = users_mock
            mock_sb.table.return_value = users_mock

            response = self._post_inbound(
                client,
                _make_postmark_payload(to_address="reports-xxxxxxxx@inbound.likha.app"),
            )

        assert response.status_code == 200


# ===========================================================================
# GET /api/email-intake/reports
# ===========================================================================

class TestListReports:
    """GET /api/email-intake/reports returns all inbound_reports for the user."""

    def test_returns_list_of_reports(self, client):
        user_id = "abcd1234-0000-0000-0000-000000000000"
        report = _make_db_inbound_report(user_id=user_id)
        contract = _make_db_contract(user_id=user_id)

        with patch("app.routers.email_intake.supabase_admin") as mock_sb, \
             patch("app.auth.supabase") as mock_auth_sb:

            mock_auth_sb.auth.get_user.return_value = Mock(user=Mock(id=user_id))

            reports_mock = MagicMock()
            reports_mock.execute.return_value = Mock(data=[report])
            reports_mock.eq.return_value = reports_mock
            reports_mock.order.return_value = reports_mock
            reports_mock.select.return_value = reports_mock

            contracts_mock = MagicMock()
            contracts_mock.execute.return_value = Mock(data=[contract])
            contracts_mock.in_.return_value = contracts_mock
            contracts_mock.select.return_value = contracts_mock

            def table_side_effect(name):
                if name == "inbound_reports":
                    return reports_mock
                if name == "contracts":
                    return contracts_mock
                return MagicMock()

            mock_sb.table.side_effect = table_side_effect

            response = client.get(
                "/api/email-intake/reports",
                headers={"Authorization": "Bearer test-token"},
            )

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 1
        assert data[0]["id"] == report["id"]

    def test_requires_auth(self, client):
        response = client.get("/api/email-intake/reports")
        assert response.status_code == 401

    def test_returns_empty_list_when_no_reports(self, client):
        user_id = "abcd1234-0000-0000-0000-000000000000"

        with patch("app.routers.email_intake.supabase_admin") as mock_sb, \
             patch("app.auth.supabase") as mock_auth_sb:

            mock_auth_sb.auth.get_user.return_value = Mock(user=Mock(id=user_id))

            reports_mock = MagicMock()
            reports_mock.execute.return_value = Mock(data=[])
            reports_mock.eq.return_value = reports_mock
            reports_mock.order.return_value = reports_mock
            reports_mock.select.return_value = reports_mock
            mock_sb.table.return_value = reports_mock

            response = client.get(
                "/api/email-intake/reports",
                headers={"Authorization": "Bearer test-token"},
            )

        assert response.status_code == 200
        assert response.json() == []


# ===========================================================================
# POST /api/email-intake/{report_id}/confirm
# ===========================================================================

class TestConfirmReport:
    """POST /api/email-intake/{report_id}/confirm — user confirms an inbound report."""

    def test_confirm_updates_status_to_confirmed(self, client):
        user_id = "abcd1234-0000-0000-0000-000000000000"
        report = _make_db_inbound_report(user_id=user_id, status="pending")
        confirmed_report = {**report, "status": "confirmed"}

        with patch("app.routers.email_intake.supabase_admin") as mock_sb, \
             patch("app.auth.supabase") as mock_auth_sb:

            mock_auth_sb.auth.get_user.return_value = Mock(user=Mock(id=user_id))

            fetch_mock = MagicMock()
            fetch_mock.execute.return_value = Mock(data=[report])
            fetch_mock.eq.return_value = fetch_mock
            fetch_mock.select.return_value = fetch_mock

            update_mock = MagicMock()
            update_mock.execute.return_value = Mock(data=[confirmed_report])
            update_mock.eq.return_value = update_mock

            def table_side_effect(name):
                if name == "inbound_reports":
                    t = MagicMock()
                    t.select.return_value = fetch_mock
                    t.update.return_value = update_mock
                    return t
                return MagicMock()

            mock_sb.table.side_effect = table_side_effect

            response = client.post(
                f"/api/email-intake/{report['id']}/confirm",
                json={},
                headers={"Authorization": "Bearer test-token"},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "confirmed"

    def test_confirm_with_manual_contract_id(self, client):
        """User can supply a contract_id to manually assign unmatched report."""
        user_id = "abcd1234-0000-0000-0000-000000000000"
        report = _make_db_inbound_report(
            user_id=user_id, contract_id=None, match_confidence="none", status="pending"
        )
        confirmed_report = {
            **report,
            "status": "confirmed",
            "contract_id": "contract-abc",
        }

        with patch("app.routers.email_intake.supabase_admin") as mock_sb, \
             patch("app.auth.supabase") as mock_auth_sb:

            mock_auth_sb.auth.get_user.return_value = Mock(user=Mock(id=user_id))

            fetch_mock = MagicMock()
            fetch_mock.execute.return_value = Mock(data=[report])
            fetch_mock.eq.return_value = fetch_mock
            fetch_mock.select.return_value = fetch_mock

            update_mock = MagicMock()
            update_mock.execute.return_value = Mock(data=[confirmed_report])
            update_mock.eq.return_value = update_mock

            def table_side_effect(name):
                if name == "inbound_reports":
                    t = MagicMock()
                    t.select.return_value = fetch_mock
                    t.update.return_value = update_mock
                    return t
                return MagicMock()

            mock_sb.table.side_effect = table_side_effect

            response = client.post(
                f"/api/email-intake/{report['id']}/confirm",
                json={"contract_id": "contract-abc"},
                headers={"Authorization": "Bearer test-token"},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "confirmed"
        assert data["contract_id"] == "contract-abc"

    def test_confirm_returns_404_for_unknown_report(self, client):
        user_id = "abcd1234-0000-0000-0000-000000000000"

        with patch("app.routers.email_intake.supabase_admin") as mock_sb, \
             patch("app.auth.supabase") as mock_auth_sb:

            mock_auth_sb.auth.get_user.return_value = Mock(user=Mock(id=user_id))

            fetch_mock = MagicMock()
            fetch_mock.execute.return_value = Mock(data=[])
            fetch_mock.eq.return_value = fetch_mock
            fetch_mock.select.return_value = fetch_mock
            mock_sb.table.return_value = fetch_mock

            response = client.post(
                "/api/email-intake/nonexistent-id/confirm",
                json={},
                headers={"Authorization": "Bearer test-token"},
            )

        assert response.status_code == 404

    def test_confirm_requires_auth(self, client):
        response = client.post("/api/email-intake/report-123/confirm", json={})
        assert response.status_code == 401


# ===========================================================================
# POST /api/email-intake/{report_id}/reject
# ===========================================================================

class TestRejectReport:
    """POST /api/email-intake/{report_id}/reject — user rejects an inbound report."""

    def test_reject_updates_status_to_rejected(self, client):
        user_id = "abcd1234-0000-0000-0000-000000000000"
        report = _make_db_inbound_report(user_id=user_id, status="pending")
        rejected_report = {**report, "status": "rejected"}

        with patch("app.routers.email_intake.supabase_admin") as mock_sb, \
             patch("app.auth.supabase") as mock_auth_sb:

            mock_auth_sb.auth.get_user.return_value = Mock(user=Mock(id=user_id))

            fetch_mock = MagicMock()
            fetch_mock.execute.return_value = Mock(data=[report])
            fetch_mock.eq.return_value = fetch_mock
            fetch_mock.select.return_value = fetch_mock

            update_mock = MagicMock()
            update_mock.execute.return_value = Mock(data=[rejected_report])
            update_mock.eq.return_value = update_mock

            def table_side_effect(name):
                if name == "inbound_reports":
                    t = MagicMock()
                    t.select.return_value = fetch_mock
                    t.update.return_value = update_mock
                    return t
                return MagicMock()

            mock_sb.table.side_effect = table_side_effect

            response = client.post(
                f"/api/email-intake/{report['id']}/reject",
                headers={"Authorization": "Bearer test-token"},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "rejected"

    def test_reject_returns_404_for_unknown_report(self, client):
        user_id = "abcd1234-0000-0000-0000-000000000000"

        with patch("app.routers.email_intake.supabase_admin") as mock_sb, \
             patch("app.auth.supabase") as mock_auth_sb:

            mock_auth_sb.auth.get_user.return_value = Mock(user=Mock(id=user_id))

            fetch_mock = MagicMock()
            fetch_mock.execute.return_value = Mock(data=[])
            fetch_mock.eq.return_value = fetch_mock
            fetch_mock.select.return_value = fetch_mock
            mock_sb.table.return_value = fetch_mock

            response = client.post(
                "/api/email-intake/nonexistent-id/reject",
                headers={"Authorization": "Bearer test-token"},
            )

        assert response.status_code == 404

    def test_reject_requires_auth(self, client):
        response = client.post("/api/email-intake/report-123/reject")
        assert response.status_code == 401


# ===========================================================================
# Unit tests: InboundEmail / InboundAttachment models
# ===========================================================================

class TestInboundEmailModel:
    """Provider-agnostic InboundEmail and InboundAttachment models."""

    def test_inbound_email_parses_basic_fields(self):
        from app.models.inbound_email import InboundEmail

        email = InboundEmail(
            sender_email="alice@example.com",
            recipient_email="reports-abcd1234@inbound.likha.app",
            subject="Q1 Report",
        )
        assert email.sender_email == "alice@example.com"
        assert email.recipient_email == "reports-abcd1234@inbound.likha.app"
        assert email.subject == "Q1 Report"
        assert email.attachments == []

    def test_inbound_email_subject_is_optional(self):
        from app.models.inbound_email import InboundEmail

        email = InboundEmail(
            sender_email="a@b.com",
            recipient_email="r@b.com",
        )
        assert email.subject is None

    def test_inbound_attachment_stores_raw_bytes(self):
        from app.models.inbound_email import InboundAttachment

        att = InboundAttachment(
            filename="report.csv",
            content=b"col1,col2\n1,2",
            content_type="text/csv",
        )
        assert att.content == b"col1,col2\n1,2"
        assert att.filename == "report.csv"
        assert att.content_type == "text/csv"


# ===========================================================================
# Unit tests: adapter functions
# ===========================================================================

class TestNormalizePostmark:
    """normalize_postmark() converts PascalCase Postmark payloads."""

    def test_maps_basic_fields(self):
        from app.services.inbound_email_adapter import normalize_postmark

        payload = _make_postmark_payload()
        email = normalize_postmark(payload)

        assert email.sender_email == "licensee@example.com"
        assert email.recipient_email == "reports-abcd1234@inbound.likha.app"
        assert email.subject == "Q1 2025 Royalty Report"

    def test_decodes_base64_attachment_content(self):
        from app.services.inbound_email_adapter import normalize_postmark

        raw_bytes = b"col1,col2\n100,200"
        payload = _make_postmark_payload(
            attachments=[
                {
                    "Name": "report.csv",
                    "Content": base64.b64encode(raw_bytes).decode(),
                    "ContentType": "text/csv",
                }
            ]
        )
        email = normalize_postmark(payload)

        assert len(email.attachments) == 1
        att = email.attachments[0]
        assert att.filename == "report.csv"
        assert att.content == raw_bytes
        assert att.content_type == "text/csv"

    def test_empty_attachments_list(self):
        from app.services.inbound_email_adapter import normalize_postmark

        email = normalize_postmark(_make_postmark_payload(attachments=[]))
        assert email.attachments == []

    def test_missing_subject_becomes_none(self):
        from app.services.inbound_email_adapter import normalize_postmark

        payload = _make_postmark_payload()
        del payload["Subject"]
        email = normalize_postmark(payload)
        assert email.subject is None


class TestNormalizeResend:
    """normalize_resend() converts snake_case Resend payloads."""

    def test_maps_basic_fields(self):
        from app.services.inbound_email_adapter import normalize_resend

        payload = _make_resend_payload()
        email = normalize_resend(payload)

        assert email.sender_email == "licensee@example.com"
        assert email.recipient_email == "reports-abcd1234@inbound.likha.app"
        assert email.subject == "Q1 2025 Royalty Report"

    def test_decodes_base64_attachment_content(self):
        from app.services.inbound_email_adapter import normalize_resend

        raw_bytes = b"col1,col2\n100,200"
        payload = _make_resend_payload(
            attachments=[
                {
                    "filename": "report.csv",
                    "content": base64.b64encode(raw_bytes).decode(),
                    "content_type": "text/csv",
                }
            ]
        )
        email = normalize_resend(payload)

        assert len(email.attachments) == 1
        att = email.attachments[0]
        assert att.filename == "report.csv"
        assert att.content == raw_bytes
        assert att.content_type == "text/csv"

    def test_empty_attachments_list(self):
        from app.services.inbound_email_adapter import normalize_resend

        email = normalize_resend(_make_resend_payload(attachments=[]))
        assert email.attachments == []

    def test_missing_subject_becomes_none(self):
        from app.services.inbound_email_adapter import normalize_resend

        payload = _make_resend_payload()
        del payload["subject"]
        email = normalize_resend(payload)
        assert email.subject is None


class TestNormalizeWebhookDispatcher:
    """normalize_webhook() routes to the correct normalizer."""

    def test_explicit_provider_postmark(self):
        from app.services.inbound_email_adapter import normalize_webhook

        payload = _make_postmark_payload()
        email = normalize_webhook(payload, provider="postmark")

        assert email.sender_email == "licensee@example.com"

    def test_explicit_provider_resend(self):
        from app.services.inbound_email_adapter import normalize_webhook

        payload = _make_resend_payload()
        email = normalize_webhook(payload, provider="resend")

        assert email.sender_email == "licensee@example.com"

    def test_env_var_selects_postmark(self):
        from app.services.inbound_email_adapter import normalize_webhook

        payload = _make_postmark_payload()
        with patch.dict(os.environ, {"EMAIL_PROVIDER": "postmark"}):
            email = normalize_webhook(payload)

        assert email.sender_email == "licensee@example.com"

    def test_env_var_selects_resend(self):
        from app.services.inbound_email_adapter import normalize_webhook

        payload = _make_resend_payload()
        with patch.dict(os.environ, {"EMAIL_PROVIDER": "resend"}):
            email = normalize_webhook(payload)

        assert email.sender_email == "licensee@example.com"

    def test_default_provider_is_resend(self):
        """When EMAIL_PROVIDER is not set, Resend format is assumed."""
        from app.services.inbound_email_adapter import normalize_webhook

        payload = _make_resend_payload()
        env_without_provider = {k: v for k, v in os.environ.items() if k != "EMAIL_PROVIDER"}
        with patch.dict(os.environ, env_without_provider, clear=True):
            email = normalize_webhook(payload)

        assert email.sender_email == "licensee@example.com"

    def test_unknown_provider_raises_value_error(self):
        from app.services.inbound_email_adapter import normalize_webhook

        with pytest.raises(ValueError, match="Unknown email provider"):
            normalize_webhook({}, provider="sendgrid")


# ===========================================================================
# Backward-compat: PostmarkWebhookPayload model still works
# ===========================================================================

class TestPostmarkWebhookPayloadModel:
    """PostmarkWebhookPayload Pydantic model — kept for backward compat."""

    def test_parses_valid_payload(self):
        from app.models.email_intake import PostmarkWebhookPayload

        payload = PostmarkWebhookPayload(**_make_postmark_payload())
        assert payload.From == "licensee@example.com"
        assert payload.Subject == "Q1 2025 Royalty Report"
        assert len(payload.Attachments) == 1
        assert payload.Attachments[0].Name == "report.csv"

    def test_allows_empty_attachments(self):
        from app.models.email_intake import PostmarkWebhookPayload

        payload = PostmarkWebhookPayload(**_make_postmark_payload(attachments=[]))
        assert payload.Attachments == []

    def test_allows_missing_subject(self):
        from app.models.email_intake import PostmarkWebhookPayload

        data = _make_postmark_payload()
        del data["Subject"]
        payload = PostmarkWebhookPayload(**data)
        assert payload.Subject is None


class TestInboundReportModel:
    """InboundReport Pydantic model."""

    def test_parses_db_row(self):
        from app.models.email_intake import InboundReport

        db_row = _make_db_inbound_report()
        report = InboundReport(**db_row)
        assert report.id == "report-123"
        assert report.match_confidence == "high"
        assert report.status == "pending"

    def test_contract_id_is_optional(self):
        from app.models.email_intake import InboundReport

        db_row = _make_db_inbound_report(contract_id=None, match_confidence="none")
        report = InboundReport(**db_row)
        assert report.contract_id is None


# ===========================================================================
# Unit tests: _lookup_user_by_short_id
# ===========================================================================

class TestLookupUserByShortId:
    """
    Unit tests for _lookup_user_by_short_id().

    The function queries the public.users view (which exposes auth.users via
    PostgREST) using supabase_admin.  These tests confirm it queries the
    "users" table with an ilike prefix filter and handles all outcomes.
    """

    def test_returns_user_dict_when_found(self):
        """Returns the first matching row when a user UUID starts with short_id."""
        from app.routers.email_intake import _lookup_user_by_short_id

        user_id = "4f48810f-9517-4798-b85e-a105b01e0c00"
        short_id = "4f48810f"

        mock_chain = MagicMock()
        mock_chain.select.return_value = mock_chain
        mock_chain.ilike.return_value = mock_chain
        mock_chain.execute.return_value = Mock(data=[{"id": user_id}])

        with patch("app.routers.email_intake.supabase_admin") as mock_sb:
            mock_sb.table.return_value = mock_chain
            result = _lookup_user_by_short_id(short_id)

        assert result == {"id": user_id}
        # Confirm it queried the public.users view (not auth.users directly)
        mock_sb.table.assert_called_once_with("users")
        mock_chain.select.assert_called_once_with("id")
        mock_chain.ilike.assert_called_once_with("id", f"{short_id}%")

    def test_returns_none_when_no_user_found(self):
        """Returns None when the short_id does not match any user UUID."""
        from app.routers.email_intake import _lookup_user_by_short_id

        mock_chain = MagicMock()
        mock_chain.select.return_value = mock_chain
        mock_chain.ilike.return_value = mock_chain
        mock_chain.execute.return_value = Mock(data=[])

        with patch("app.routers.email_intake.supabase_admin") as mock_sb:
            mock_sb.table.return_value = mock_chain
            result = _lookup_user_by_short_id("xxxxxxxx")

        assert result is None

    def test_returns_none_and_logs_warning_on_exception(self):
        """Returns None (does not raise) when the DB query throws an exception."""
        from app.routers.email_intake import _lookup_user_by_short_id

        mock_chain = MagicMock()
        mock_chain.select.return_value = mock_chain
        mock_chain.ilike.return_value = mock_chain
        mock_chain.execute.side_effect = Exception("PostgREST error")

        with patch("app.routers.email_intake.supabase_admin") as mock_sb, \
             patch("app.routers.email_intake.logger") as mock_logger:
            mock_sb.table.return_value = mock_chain
            result = _lookup_user_by_short_id("abcd1234")

        assert result is None
        mock_logger.warning.assert_called_once()
        warning_msg = mock_logger.warning.call_args[0][0]
        assert "abcd1234" in warning_msg

    def test_uses_ilike_for_case_insensitive_prefix_match(self):
        """The ilike filter is used so uppercase UUID chars are matched correctly."""
        from app.routers.email_intake import _lookup_user_by_short_id

        short_id = "ABCD1234"

        mock_chain = MagicMock()
        mock_chain.select.return_value = mock_chain
        mock_chain.ilike.return_value = mock_chain
        mock_chain.execute.return_value = Mock(data=[])

        with patch("app.routers.email_intake.supabase_admin") as mock_sb:
            mock_sb.table.return_value = mock_chain
            _lookup_user_by_short_id(short_id)

        # ilike must be called with the exact short_id followed by a wildcard
        mock_chain.ilike.assert_called_once_with("id", "ABCD1234%")

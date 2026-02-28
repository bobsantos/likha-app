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


# ===========================================================================
# Unit tests: _auto_match_contract (multi-signal, ADR 20260225095833)
# ===========================================================================

def _make_contracts_for_matching(
    user_id: str = "abcd1234-0000-0000-0000-000000000000",
) -> list[dict]:
    """Return two active contracts with distinct agreement_number and licensee_name."""
    return [
        {
            **_make_db_contract(
                contract_id="contract-alpha",
                user_id=user_id,
                licensee_email="alpha@retailco.com",
            ),
            "licensee_name": "Alpha Retail Co",
            "agreement_number": "Lic-1001",
        },
        {
            **_make_db_contract(
                contract_id="contract-beta",
                user_id=user_id,
                licensee_email="beta@boutique.com",
            ),
            "licensee_name": "Beta Boutique Ltd",
            "agreement_number": "AGR-2002",
        },
    ]


class TestAutoMatchContractMultiSignal:
    """
    Unit tests for the refactored _auto_match_contract(sender_email,
    attachment_text, user_contracts) that implements the full signal hierarchy.

    These tests call the helper directly with a pre-fetched list of contracts
    so no DB query is needed inside the function.
    """

    def test_signal1_exact_email_match_returns_high_confidence(self):
        """Signal 1: exact sender_email match → high confidence, contract_id set."""
        from app.routers.email_intake import _auto_match_contract

        contracts = _make_contracts_for_matching()
        contract_id, confidence, candidates = _auto_match_contract(
            sender_email="alpha@retailco.com",
            attachment_text="",
            user_contracts=contracts,
        )

        assert confidence == "high"
        assert contract_id == "contract-alpha"
        assert candidates == []

    def test_signal1_email_match_is_case_insensitive(self):
        """Sender email matching should be case-insensitive."""
        from app.routers.email_intake import _auto_match_contract

        contracts = _make_contracts_for_matching()
        contract_id, confidence, candidates = _auto_match_contract(
            sender_email="ALPHA@RETAILCO.COM",
            attachment_text="",
            user_contracts=contracts,
        )

        assert confidence == "high"
        assert contract_id == "contract-alpha"

    def test_signal2_agreement_ref_in_attachment_returns_high_confidence(self):
        """Signal 2: agreement number regex found in attachment text → high confidence."""
        from app.routers.email_intake import _auto_match_contract

        contracts = _make_contracts_for_matching()
        attachment_text = (
            "Licensee Sales Report\n"
            "Agreement #: AGR-2002\n"
            "Period: Q1 2025\n"
            "Net Sales: 10000\n"
        )
        contract_id, confidence, candidates = _auto_match_contract(
            sender_email="unknown@somewhere.com",
            attachment_text=attachment_text,
            user_contracts=contracts,
        )

        assert confidence == "high"
        assert contract_id == "contract-beta"
        assert candidates == []

    def test_signal2_lic_prefix_agreement_ref_matches(self):
        """Signal 2 also matches 'Lic-NNNN' style agreement numbers."""
        from app.routers.email_intake import _auto_match_contract

        contracts = _make_contracts_for_matching()
        attachment_text = "Report for Lic-1001\nSales: 5000\n"
        contract_id, confidence, candidates = _auto_match_contract(
            sender_email="noreply@example.com",
            attachment_text=attachment_text,
            user_contracts=contracts,
        )

        assert confidence == "high"
        assert contract_id == "contract-alpha"

    def test_signal3_licensee_name_substring_returns_medium_confidence(self):
        """Signal 3: licensee name found in attachment → medium confidence, candidates set."""
        from app.routers.email_intake import _auto_match_contract

        contracts = _make_contracts_for_matching()
        # "Beta Boutique" is a substring of "Beta Boutique Ltd"
        attachment_text = "Prepared by: Beta Boutique\nQ2 2025 Sales Data\nTotal: 8000\n"
        contract_id, confidence, candidates = _auto_match_contract(
            sender_email="noreply@example.com",
            attachment_text=attachment_text,
            user_contracts=contracts,
        )

        assert confidence == "medium"
        assert contract_id is None
        assert "contract-beta" in candidates

    def test_signal3_match_is_case_insensitive(self):
        """Licensee name substring scan is case-insensitive."""
        from app.routers.email_intake import _auto_match_contract

        contracts = _make_contracts_for_matching()
        attachment_text = "ALPHA RETAIL CO quarterly report\nSales: 999\n"
        contract_id, confidence, candidates = _auto_match_contract(
            sender_email="noreply@example.com",
            attachment_text=attachment_text,
            user_contracts=contracts,
        )

        assert confidence == "medium"
        assert contract_id is None
        assert "contract-alpha" in candidates

    def test_no_match_returns_all_active_contracts_as_candidates(self):
        """No signal matches → candidates = all contract IDs, confidence = 'none'."""
        from app.routers.email_intake import _auto_match_contract

        contracts = _make_contracts_for_matching()
        contract_id, confidence, candidates = _auto_match_contract(
            sender_email="nobody@nowhere.com",
            attachment_text="Generic sales spreadsheet\nTotal: 0\n",
            user_contracts=contracts,
        )

        assert confidence == "none"
        assert contract_id is None
        assert set(candidates) == {"contract-alpha", "contract-beta"}

    def test_multiple_email_matches_do_not_auto_pick(self):
        """
        Multiple contracts matching the same sender email (unusual but possible) —
        no auto-pick; all matches returned as candidates.
        """
        from app.routers.email_intake import _auto_match_contract

        user_id = "abcd1234-0000-0000-0000-000000000000"
        contracts = [
            {**_make_db_contract(contract_id="c1", user_id=user_id, licensee_email="shared@example.com")},
            {**_make_db_contract(contract_id="c2", user_id=user_id, licensee_email="shared@example.com")},
        ]
        contract_id, confidence, candidates = _auto_match_contract(
            sender_email="shared@example.com",
            attachment_text="",
            user_contracts=contracts,
        )

        assert contract_id is None
        assert set(candidates) == {"c1", "c2"}

    def test_multiple_signal3_matches_all_returned_as_candidates(self):
        """
        Multiple licensee-name matches at medium confidence — no auto-pick,
        all matching contracts listed as candidates.
        """
        from app.routers.email_intake import _auto_match_contract

        user_id = "abcd1234-0000-0000-0000-000000000000"
        contracts = [
            {
                **_make_db_contract(contract_id="c1", user_id=user_id),
                "licensee_name": "Acme Corp",
                "agreement_number": None,
            },
            {
                **_make_db_contract(contract_id="c2", user_id=user_id),
                "licensee_name": "Acme Corp",  # same name, different contract
                "agreement_number": None,
            },
        ]
        attachment_text = "Report prepared for Acme Corp\nSales: 500\n"
        contract_id, confidence, candidates = _auto_match_contract(
            sender_email="nobody@nowhere.com",
            attachment_text=attachment_text,
            user_contracts=contracts,
        )

        assert contract_id is None
        assert confidence == "medium"
        assert set(candidates) == {"c1", "c2"}

    def test_signal1_stops_evaluation_before_signal2(self):
        """When Signal 1 fires, Signal 2 is not evaluated (first match wins)."""
        from app.routers.email_intake import _auto_match_contract

        user_id = "abcd1234-0000-0000-0000-000000000000"
        contracts = [
            {
                **_make_db_contract(
                    contract_id="email-match",
                    user_id=user_id,
                    licensee_email="alpha@retailco.com",
                ),
                "licensee_name": "Alpha Retail",
                "agreement_number": "Lic-9999",
            },
            {
                **_make_db_contract(
                    contract_id="ref-match",
                    user_id=user_id,
                    licensee_email="other@other.com",
                ),
                "licensee_name": "Other Ltd",
                "agreement_number": "AGR-1111",
            },
        ]
        # Attachment mentions AGR-1111 (would match "ref-match" via Signal 2)
        # but sender email matches "email-match" via Signal 1 — Signal 1 should win
        attachment_text = "Agreement: AGR-1111\nTotal: 100\n"
        contract_id, confidence, candidates = _auto_match_contract(
            sender_email="alpha@retailco.com",
            attachment_text=attachment_text,
            user_contracts=contracts,
        )

        assert confidence == "high"
        assert contract_id == "email-match"

    def test_empty_contracts_list_returns_no_match(self):
        """No active contracts at all → none confidence, empty candidates."""
        from app.routers.email_intake import _auto_match_contract

        contract_id, confidence, candidates = _auto_match_contract(
            sender_email="alpha@retailco.com",
            attachment_text="Report\n",
            user_contracts=[],
        )

        assert confidence == "none"
        assert contract_id is None
        assert candidates == []

    def test_contract_without_agreement_number_skips_signal2(self):
        """Contracts with None agreement_number do not raise on Signal 2 scan."""
        from app.routers.email_intake import _auto_match_contract

        user_id = "abcd1234-0000-0000-0000-000000000000"
        contracts = [
            {
                **_make_db_contract(contract_id="c1", user_id=user_id),
                "licensee_name": "Generic Co",
                "agreement_number": None,
            },
        ]
        attachment_text = "AGR-9999 is mentioned here\n"
        # Should not crash and should not match (agreement_number is None)
        contract_id, confidence, candidates = _auto_match_contract(
            sender_email="nobody@nowhere.com",
            attachment_text=attachment_text,
            user_contracts=contracts,
        )

        assert contract_id is None
        # candidates should contain all contracts since no signal matched
        assert "c1" in candidates


# ===========================================================================
# Unit tests: _extract_period_dates
# ===========================================================================

class TestExtractPeriodDates:
    """Unit tests for _extract_period_dates(attachment_text)."""

    def test_quarter_label_q1(self):
        """'Q1 2025' → 2025-01-01 to 2025-03-31."""
        from app.routers.email_intake import _extract_period_dates

        start, end = _extract_period_dates("Sales Report\nQ1 2025\nTotal: 1000\n")
        assert start == "2025-01-01"
        assert end == "2025-03-31"

    def test_quarter_label_q2(self):
        """'Q2 2025' → 2025-04-01 to 2025-06-30."""
        from app.routers.email_intake import _extract_period_dates

        start, end = _extract_period_dates("Q2 2025 Royalty Report\n")
        assert start == "2025-04-01"
        assert end == "2025-06-30"

    def test_quarter_label_q3(self):
        """'Q3 2025' → 2025-07-01 to 2025-09-30."""
        from app.routers.email_intake import _extract_period_dates

        start, end = _extract_period_dates("Period: Q3 2025\nNet Sales: 500\n")
        assert start == "2025-07-01"
        assert end == "2025-09-30"

    def test_quarter_label_q4(self):
        """'Q4 2024' → 2024-10-01 to 2024-12-31."""
        from app.routers.email_intake import _extract_period_dates

        start, end = _extract_period_dates("Report for Q4 2024\n")
        assert start == "2024-10-01"
        assert end == "2024-12-31"

    def test_named_range_jan_mar(self):
        """'Reporting Period: Jan-Mar 2025' → 2025-01-01 to 2025-03-31."""
        from app.routers.email_intake import _extract_period_dates

        start, end = _extract_period_dates(
            "Licensee: Acme\nReporting Period: Jan-Mar 2025\nTotal: 0\n"
        )
        assert start == "2025-01-01"
        assert end == "2025-03-31"

    def test_named_range_apr_jun(self):
        """'Period: Apr-Jun 2025' → 2025-04-01 to 2025-06-30."""
        from app.routers.email_intake import _extract_period_dates

        start, end = _extract_period_dates("Period: Apr-Jun 2025\n")
        assert start == "2025-04-01"
        assert end == "2025-06-30"

    def test_named_range_jul_sep(self):
        """'Period: Jul-Sep 2025' → 2025-07-01 to 2025-09-30."""
        from app.routers.email_intake import _extract_period_dates

        start, end = _extract_period_dates("Period: Jul-Sep 2025\n")
        assert start == "2025-07-01"
        assert end == "2025-09-30"

    def test_named_range_oct_dec(self):
        """'Period: Oct-Dec 2025' → 2025-10-01 to 2025-12-31."""
        from app.routers.email_intake import _extract_period_dates

        start, end = _extract_period_dates("Reporting Period: Oct-Dec 2025\n")
        assert start == "2025-10-01"
        assert end == "2025-12-31"

    def test_explicit_date_range_us_format(self):
        """'01/01/2025 - 03/31/2025' → 2025-01-01 to 2025-03-31."""
        from app.routers.email_intake import _extract_period_dates

        start, end = _extract_period_dates(
            "Sales Data\nDate Range: 01/01/2025 - 03/31/2025\nTotal: 9999\n"
        )
        assert start == "2025-01-01"
        assert end == "2025-03-31"

    def test_explicit_date_range_iso_format(self):
        """'2025-01-01 - 2025-03-31' (ISO) → 2025-01-01 to 2025-03-31."""
        from app.routers.email_intake import _extract_period_dates

        start, end = _extract_period_dates(
            "Period From: 2025-01-01 to 2025-03-31\n"
        )
        assert start == "2025-01-01"
        assert end == "2025-03-31"

    def test_no_match_returns_none_none(self):
        """No recognizable pattern → (None, None)."""
        from app.routers.email_intake import _extract_period_dates

        start, end = _extract_period_dates(
            "col1,col2,col3\n100,200,300\n400,500,600\n"
        )
        assert start is None
        assert end is None

    def test_empty_text_returns_none_none(self):
        """Empty string → (None, None), no crash."""
        from app.routers.email_intake import _extract_period_dates

        start, end = _extract_period_dates("")
        assert start is None
        assert end is None

    def test_only_scans_first_20_rows(self):
        """Period label on row 21+ should not be found (only first ~20 rows scanned)."""
        from app.routers.email_intake import _extract_period_dates

        # 20 blank rows, then a quarter label on row 21
        text = "\n" * 20 + "Q2 2025\n"
        start, end = _extract_period_dates(text)
        assert start is None
        assert end is None

    def test_separate_metadata_rows_iso_dates(self):
        """'Reporting Period Start,2025-04-01' / 'Reporting Period End,2025-06-30' → correct ISO dates."""
        from app.routers.email_intake import _extract_period_dates

        text = (
            "Licensee,Acme Corp\n"
            "Reporting Period Start,2025-04-01\n"
            "Reporting Period End,2025-06-30\n"
            "Product,Net Sales,Royalty\n"
            "Widget,10000,800\n"
        )
        start, end = _extract_period_dates(text)
        assert start == "2025-04-01"
        assert end == "2025-06-30"

    def test_separate_metadata_rows_period_start_end_labels(self):
        """'Period Start' / 'Period End' short-form labels are recognised."""
        from app.routers.email_intake import _extract_period_dates

        text = (
            "Period Start,2025-01-01\n"
            "Period End,2025-03-31\n"
            "SKU,Amount\n"
            "ABC,500\n"
        )
        start, end = _extract_period_dates(text)
        assert start == "2025-01-01"
        assert end == "2025-03-31"

    def test_separate_metadata_rows_label_with_colon(self):
        """Labels ending with ':' are stripped before matching."""
        from app.routers.email_intake import _extract_period_dates

        text = (
            "Reporting Period Start:,2025-07-01\n"
            "Reporting Period End:,2025-09-30\n"
            "Col1,Col2\n"
            "1,2\n"
        )
        start, end = _extract_period_dates(text)
        assert start == "2025-07-01"
        assert end == "2025-09-30"

    def test_separate_metadata_rows_only_start_no_end_returns_none_none(self):
        """Start label present but end label absent → (None, None) — both required."""
        from app.routers.email_intake import _extract_period_dates

        text = (
            "Reporting Period Start,2025-04-01\n"
            "Col1,Col2\n"
            "1,2\n"
        )
        start, end = _extract_period_dates(text)
        assert start is None
        assert end is None

    def test_separate_metadata_rows_non_iso_value_ignored(self):
        """A metadata row whose value is not ISO format is not used."""
        from app.routers.email_intake import _extract_period_dates

        text = (
            "Reporting Period Start,April 2025\n"
            "Reporting Period End,June 2025\n"
            "Col1,Col2\n"
            "1,2\n"
        )
        start, end = _extract_period_dates(text)
        assert start is None
        assert end is None

    def test_separate_metadata_rows_higher_priority_patterns_win(self):
        """Quarter label in earlier rows takes priority over separate metadata rows."""
        from app.routers.email_intake import _extract_period_dates

        text = (
            "Q2 2025\n"
            "Reporting Period Start,2025-01-01\n"
            "Reporting Period End,2025-03-31\n"
            "Col1,Col2\n"
            "1,2\n"
        )
        start, end = _extract_period_dates(text)
        # Q2 2025 should win (Pattern 1 has higher priority)
        assert start == "2025-04-01"
        assert end == "2025-06-30"


# ===========================================================================
# Confirm endpoint: open_wizard support
# ===========================================================================

def _make_inbound_report_with_new_fields(
    report_id: str = "report-123",
    user_id: str = "abcd1234-0000-0000-0000-000000000000",
    contract_id: str = "contract-abc",
    status: str = "pending",
    attachment_path: str | None = "inbound/abcd1234-0000-0000-0000-000000000000/report-123/report.csv",
    suggested_period_start: str | None = None,
    suggested_period_end: str | None = None,
    sales_period_id: str | None = None,
    candidate_contract_ids: list | None = None,
) -> dict:
    """Build a DB row dict that includes the new ADR columns."""
    base = _make_db_inbound_report(
        report_id=report_id,
        user_id=user_id,
        contract_id=contract_id,
        status=status,
    )
    base["attachment_path"] = attachment_path
    base["suggested_period_start"] = suggested_period_start
    base["suggested_period_end"] = suggested_period_end
    base["sales_period_id"] = sales_period_id
    base["candidate_contract_ids"] = candidate_contract_ids
    return base


def _make_confirm_table_side_effect(report_before: dict, report_after: dict):
    """Return a table() side-effect covering fetch + update for confirm endpoint."""

    fetch_mock = MagicMock()
    fetch_mock.execute.return_value = Mock(data=[report_before])
    fetch_mock.eq.return_value = fetch_mock
    fetch_mock.select.return_value = fetch_mock

    update_mock = MagicMock()
    update_mock.execute.return_value = Mock(data=[report_after])
    update_mock.eq.return_value = update_mock

    def side_effect(name):
        if name == "inbound_reports":
            t = MagicMock()
            t.select.return_value = fetch_mock
            t.update.return_value = update_mock
            return t
        return MagicMock()

    return side_effect


class TestConfirmReportWithOpenWizard:
    """POST /api/email-intake/{report_id}/confirm — open_wizard support."""

    def test_open_wizard_false_returns_no_redirect_url(self, client):
        """open_wizard=false (default) → no redirect_url in response."""
        user_id = "abcd1234-0000-0000-0000-000000000000"
        report = _make_inbound_report_with_new_fields(user_id=user_id)
        confirmed = {**report, "status": "confirmed"}

        with patch("app.routers.email_intake.supabase_admin") as mock_sb, \
             patch("app.auth.supabase") as mock_auth_sb:

            mock_auth_sb.auth.get_user.return_value = Mock(user=Mock(id=user_id))
            mock_sb.table.side_effect = _make_confirm_table_side_effect(report, confirmed)

            response = client.post(
                f"/api/email-intake/{report['id']}/confirm",
                json={"open_wizard": False},
                headers={"Authorization": "Bearer test-token"},
            )

        assert response.status_code == 200
        data = response.json()
        assert data.get("redirect_url") is None

    def test_open_wizard_true_returns_redirect_url(self, client):
        """open_wizard=true → redirect_url with contract_id, report_id and source."""
        user_id = "abcd1234-0000-0000-0000-000000000000"
        report = _make_inbound_report_with_new_fields(
            user_id=user_id,
            contract_id="contract-abc",
        )
        confirmed = {**report, "status": "confirmed"}

        with patch("app.routers.email_intake.supabase_admin") as mock_sb, \
             patch("app.auth.supabase") as mock_auth_sb:

            mock_auth_sb.auth.get_user.return_value = Mock(user=Mock(id=user_id))
            mock_sb.table.side_effect = _make_confirm_table_side_effect(report, confirmed)

            response = client.post(
                f"/api/email-intake/{report['id']}/confirm",
                json={"open_wizard": True},
                headers={"Authorization": "Bearer test-token"},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["redirect_url"] is not None
        url = data["redirect_url"]
        assert "/sales/upload" in url
        assert "contract_id=contract-abc" in url
        assert f"report_id={report['id']}" in url
        assert "source=inbox" in url

    def test_open_wizard_true_with_period_dates_includes_period_params(self, client):
        """open_wizard=true + period dates → redirect_url includes period_start/end."""
        user_id = "abcd1234-0000-0000-0000-000000000000"
        report = _make_inbound_report_with_new_fields(
            user_id=user_id,
            contract_id="contract-abc",
            suggested_period_start="2025-01-01",
            suggested_period_end="2025-03-31",
        )
        confirmed = {**report, "status": "confirmed"}

        with patch("app.routers.email_intake.supabase_admin") as mock_sb, \
             patch("app.auth.supabase") as mock_auth_sb:

            mock_auth_sb.auth.get_user.return_value = Mock(user=Mock(id=user_id))
            mock_sb.table.side_effect = _make_confirm_table_side_effect(report, confirmed)

            response = client.post(
                f"/api/email-intake/{report['id']}/confirm",
                json={"open_wizard": True},
                headers={"Authorization": "Bearer test-token"},
            )

        assert response.status_code == 200
        url = response.json()["redirect_url"]
        assert "period_start=2025-01-01" in url
        assert "period_end=2025-03-31" in url

    def test_open_wizard_true_without_period_dates_omits_period_params(self, client):
        """open_wizard=true + no period dates → redirect_url has NO period params."""
        user_id = "abcd1234-0000-0000-0000-000000000000"
        report = _make_inbound_report_with_new_fields(
            user_id=user_id,
            contract_id="contract-abc",
            suggested_period_start=None,
            suggested_period_end=None,
        )
        confirmed = {**report, "status": "confirmed"}

        with patch("app.routers.email_intake.supabase_admin") as mock_sb, \
             patch("app.auth.supabase") as mock_auth_sb:

            mock_auth_sb.auth.get_user.return_value = Mock(user=Mock(id=user_id))
            mock_sb.table.side_effect = _make_confirm_table_side_effect(report, confirmed)

            response = client.post(
                f"/api/email-intake/{report['id']}/confirm",
                json={"open_wizard": True},
                headers={"Authorization": "Bearer test-token"},
            )

        assert response.status_code == 200
        url = response.json()["redirect_url"]
        assert "period_start" not in url
        assert "period_end" not in url

    def test_open_wizard_true_without_attachment_returns_422(self, client):
        """open_wizard=true on a report with no attachment → 422."""
        user_id = "abcd1234-0000-0000-0000-000000000000"
        report = _make_inbound_report_with_new_fields(
            user_id=user_id,
            contract_id="contract-abc",
            attachment_path=None,
        )

        with patch("app.routers.email_intake.supabase_admin") as mock_sb, \
             patch("app.auth.supabase") as mock_auth_sb:

            mock_auth_sb.auth.get_user.return_value = Mock(user=Mock(id=user_id))

            fetch_mock = MagicMock()
            fetch_mock.execute.return_value = Mock(data=[report])
            fetch_mock.eq.return_value = fetch_mock
            fetch_mock.select.return_value = fetch_mock

            def side_effect(name):
                if name == "inbound_reports":
                    t = MagicMock()
                    t.select.return_value = fetch_mock
                    return t
                return MagicMock()

            mock_sb.table.side_effect = side_effect

            response = client.post(
                f"/api/email-intake/{report['id']}/confirm",
                json={"open_wizard": True},
                headers={"Authorization": "Bearer test-token"},
            )

        assert response.status_code == 422

    def test_open_wizard_default_is_false(self, client):
        """Omitting open_wizard from body is equivalent to open_wizard=false."""
        user_id = "abcd1234-0000-0000-0000-000000000000"
        report = _make_inbound_report_with_new_fields(user_id=user_id)
        confirmed = {**report, "status": "confirmed"}

        with patch("app.routers.email_intake.supabase_admin") as mock_sb, \
             patch("app.auth.supabase") as mock_auth_sb:

            mock_auth_sb.auth.get_user.return_value = Mock(user=Mock(id=user_id))
            mock_sb.table.side_effect = _make_confirm_table_side_effect(report, confirmed)

            response = client.post(
                f"/api/email-intake/{report['id']}/confirm",
                json={},
                headers={"Authorization": "Bearer test-token"},
            )

        assert response.status_code == 200
        data = response.json()
        assert data.get("redirect_url") is None


# ===========================================================================
# PATCH /{report_id} — sales_period_id linkback
# ===========================================================================

class TestSalesPeriodLinkback:
    """PATCH /api/email-intake/{report_id} — link sales_period_id, status → 'processed'."""

    def test_patch_sales_period_id_updates_report(self, client):
        """PATCH with sales_period_id → links report to sales period, status='processed'."""
        user_id = "abcd1234-0000-0000-0000-000000000000"
        sales_period_id = "sp-uuid-0000-0000-0000-000000000001"
        report = _make_inbound_report_with_new_fields(
            user_id=user_id, status="confirmed"
        )
        processed_report = {
            **report,
            "status": "processed",
            "sales_period_id": sales_period_id,
        }

        with patch("app.routers.email_intake.supabase_admin") as mock_sb, \
             patch("app.auth.supabase") as mock_auth_sb:

            mock_auth_sb.auth.get_user.return_value = Mock(user=Mock(id=user_id))

            fetch_mock = MagicMock()
            fetch_mock.execute.return_value = Mock(data=[report])
            fetch_mock.eq.return_value = fetch_mock
            fetch_mock.select.return_value = fetch_mock

            update_mock = MagicMock()
            update_mock.execute.return_value = Mock(data=[processed_report])
            update_mock.eq.return_value = update_mock

            def table_side_effect(name):
                if name == "inbound_reports":
                    t = MagicMock()
                    t.select.return_value = fetch_mock
                    t.update.return_value = update_mock
                    return t
                return MagicMock()

            mock_sb.table.side_effect = table_side_effect

            response = client.patch(
                f"/api/email-intake/{report['id']}",
                json={"sales_period_id": sales_period_id},
                headers={"Authorization": "Bearer test-token"},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["sales_period_id"] == sales_period_id
        assert data["status"] == "processed"

    def test_patch_requires_auth(self, client):
        response = client.patch(
            "/api/email-intake/report-123",
            json={"sales_period_id": "sp-123"},
        )
        assert response.status_code == 401

    def test_patch_returns_404_for_unknown_report(self, client):
        user_id = "abcd1234-0000-0000-0000-000000000000"

        with patch("app.routers.email_intake.supabase_admin") as mock_sb, \
             patch("app.auth.supabase") as mock_auth_sb:

            mock_auth_sb.auth.get_user.return_value = Mock(user=Mock(id=user_id))

            fetch_mock = MagicMock()
            fetch_mock.execute.return_value = Mock(data=[])
            fetch_mock.eq.return_value = fetch_mock
            fetch_mock.select.return_value = fetch_mock
            mock_sb.table.return_value = fetch_mock

            response = client.patch(
                "/api/email-intake/nonexistent-id",
                json={"sales_period_id": "sp-123"},
                headers={"Authorization": "Bearer test-token"},
            )

        assert response.status_code == 404

    def test_patch_status_transitions_to_processed(self, client):
        """Verify status field is explicitly set to 'processed' by the endpoint."""
        user_id = "abcd1234-0000-0000-0000-000000000000"
        sales_period_id = "sp-uuid-0000-0000-0000-000000000002"
        report = _make_inbound_report_with_new_fields(
            user_id=user_id, status="confirmed"
        )
        processed_report = {
            **report,
            "status": "processed",
            "sales_period_id": sales_period_id,
        }

        with patch("app.routers.email_intake.supabase_admin") as mock_sb, \
             patch("app.auth.supabase") as mock_auth_sb:

            mock_auth_sb.auth.get_user.return_value = Mock(user=Mock(id=user_id))

            fetch_mock = MagicMock()
            fetch_mock.execute.return_value = Mock(data=[report])
            fetch_mock.eq.return_value = fetch_mock
            fetch_mock.select.return_value = fetch_mock

            update_mock = MagicMock()
            update_mock.execute.return_value = Mock(data=[processed_report])
            update_mock.eq.return_value = update_mock

            def table_side_effect(name):
                if name == "inbound_reports":
                    t = MagicMock()
                    t.select.return_value = fetch_mock
                    t.update.return_value = update_mock
                    return t
                return MagicMock()

            mock_sb.table.side_effect = table_side_effect

            response = client.patch(
                f"/api/email-intake/{report['id']}",
                json={"sales_period_id": sales_period_id},
                headers={"Authorization": "Bearer test-token"},
            )

        assert response.status_code == 200
        # The update mock should have been called — inspect that status is 'processed'
        data = response.json()
        assert data["status"] == "processed"


# ===========================================================================
# InboundReport model: new fields
# ===========================================================================

class TestInboundReportModelNewFields:
    """InboundReport model includes new ADR fields."""

    def test_parses_db_row_with_new_fields(self):
        from app.models.email_intake import InboundReport

        db_row = _make_inbound_report_with_new_fields(
            suggested_period_start="2025-01-01",
            suggested_period_end="2025-03-31",
            candidate_contract_ids=["c1", "c2"],
            sales_period_id="sp-111",
        )
        report = InboundReport(**db_row)
        assert report.suggested_period_start == "2025-01-01"
        assert report.suggested_period_end == "2025-03-31"
        assert report.candidate_contract_ids == ["c1", "c2"]
        assert report.sales_period_id == "sp-111"

    def test_new_fields_default_to_none(self):
        from app.models.email_intake import InboundReport

        db_row = _make_db_inbound_report()
        # Ensure legacy rows without the new columns still parse
        db_row.pop("candidate_contract_ids", None)
        db_row.pop("suggested_period_start", None)
        db_row.pop("suggested_period_end", None)
        db_row.pop("sales_period_id", None)
        report = InboundReport(**db_row)
        assert report.candidate_contract_ids is None
        assert report.suggested_period_start is None
        assert report.suggested_period_end is None
        assert report.sales_period_id is None

    def test_status_processed_is_valid(self):
        from app.models.email_intake import InboundReport

        db_row = _make_inbound_report_with_new_fields(status="processed")
        report = InboundReport(**db_row)
        assert report.status == "processed"

    def test_confirm_response_includes_redirect_url_field(self):
        """ConfirmResponse model has redirect_url field."""
        from app.models.email_intake import ConfirmResponse

        resp = ConfirmResponse(redirect_url="/sales/upload?contract_id=abc")
        assert resp.redirect_url == "/sales/upload?contract_id=abc"

    def test_confirm_response_redirect_url_defaults_to_none(self):
        from app.models.email_intake import ConfirmResponse

        resp = ConfirmResponse()
        assert resp.redirect_url is None

    def test_confirm_report_request_open_wizard_defaults_false(self):
        from app.models.email_intake import ConfirmReportRequest

        req = ConfirmReportRequest()
        assert req.open_wizard is False

    def test_confirm_report_request_open_wizard_can_be_true(self):
        from app.models.email_intake import ConfirmReportRequest

        req = ConfirmReportRequest(open_wizard=True)
        assert req.open_wizard is True


# ===========================================================================
# Unit tests: _extract_attachment_preview
# ===========================================================================

# ---------------------------------------------------------------------------
# Sample attachment texts used by multiple tests
# ---------------------------------------------------------------------------

# sample-1 style: structured key/value metadata block followed by a data header
_SAMPLE_1_TEXT = """\
Licensee Name,Sunrise Apparel Co.
Licensor Name,BrandCo Holdings LLC
Contract Number,BC-2024-0042
Reporting Period Start,2025-01-01
Reporting Period End,2025-03-31
Report Submission Date,2025-04-28
Territory,United States

Product Description,SKU,Product Category,Gross Sales,Returns / Allowances,Net Sales,Royalty Rate,Royalty Due
Licensed Branded Apparel - All SKUs,ALL,Apparel,87500.00,4200.00,83300.00,8%,6384.00

TOTAL,,,,4200.00,83300.00,,6384.00
"""

# sample-3 style: messy title rows (ALL-CAPS, no colon) before the data header
_SAMPLE_3_TEXT = """\
VANTAGE RETAIL PARTNERS,,,,,,,
ROYALTY STATEMENT - Q3 2025,,,,,,,
AGREEMENT REF: VRP / BC-2025-0011,,,,,,,
PREPARED BY: Finance Dept.,,,,,,,
,,,,,,,
Item #,Description,Product Line,Gross Revenue,Refunds,Total Revenue,Rate (%),Amount Owed
1001,Branded Mug - 12oz,Kitchen & Home,12400.00,800.00,11600.00,0.09,1044.00
1002,Branded Mug - 16oz,Kitchen & Home,9800.00,400.00,9400.00,0.09,846.00
1003,Branded Pint Glass (4-pack),Kitchen & Home,7200.00,200.00,7000.00,0.09,630.00
TOTAL,,,,3950.00,102050.00,,9175.50
"""

# No metadata rows — header is literally the first row
_HEADER_FIRST_TEXT = """\
Product Description,SKU,Net Sales,Royalty Rate,Royalty Due
Widget A,SKU-001,10000.00,8%,800.00
Widget B,SKU-002,5000.00,8%,400.00
Widget C,SKU-003,2000.00,8%,160.00
"""


class TestExtractAttachmentPreview:
    """
    Unit tests for _extract_attachment_preview(attachment_text).

    Covers sample-1 style (structured header block), sample-3 style (messy
    ALL-CAPS title rows), empty / None input, and a file where the header row
    is the very first row (no metadata rows at all).
    """

    # -------------------------------------------------------------------------
    # sample-1 style
    # -------------------------------------------------------------------------

    def test_sample1_returns_metadata_rows(self):
        """Structured key/value rows are extracted as metadata."""
        from app.routers.email_intake import _extract_attachment_preview

        metadata, _ = _extract_attachment_preview(_SAMPLE_1_TEXT)

        assert metadata is not None
        assert len(metadata) >= 4

        keys = [r["key"] for r in metadata]
        assert "Licensee Name" in keys
        assert "Contract Number" in keys
        assert "Reporting Period Start" in keys
        assert "Reporting Period End" in keys

    def test_sample1_metadata_values_are_correct(self):
        """Metadata values match the right-hand column of the header block."""
        from app.routers.email_intake import _extract_attachment_preview

        metadata, _ = _extract_attachment_preview(_SAMPLE_1_TEXT)

        values_by_key = {r["key"]: r["value"] for r in metadata}
        assert values_by_key["Licensee Name"] == "Sunrise Apparel Co."
        assert values_by_key["Contract Number"] == "BC-2024-0042"
        assert values_by_key["Reporting Period Start"] == "2025-01-01"
        assert values_by_key["Reporting Period End"] == "2025-03-31"

    def test_sample1_returns_sample_rows_with_headers(self):
        """Data header row is captured in sample_rows.headers."""
        from app.routers.email_intake import _extract_attachment_preview

        _, sample = _extract_attachment_preview(_SAMPLE_1_TEXT)

        assert sample is not None
        assert "headers" in sample
        assert "rows" in sample

        headers = sample["headers"]
        assert "Product Description" in headers
        assert "Net Sales" in headers
        assert "Royalty Due" in headers

    def test_sample1_returns_up_to_3_data_rows(self):
        """At most 3 data rows are captured in sample_rows.rows."""
        from app.routers.email_intake import _extract_attachment_preview

        _, sample = _extract_attachment_preview(_SAMPLE_1_TEXT)

        assert sample is not None
        assert len(sample["rows"]) <= 3

    def test_sample1_data_row_values_are_strings(self):
        """All values in sample data rows are plain strings."""
        from app.routers.email_intake import _extract_attachment_preview

        _, sample = _extract_attachment_preview(_SAMPLE_1_TEXT)

        assert sample is not None
        for row in sample["rows"]:
            for cell in row:
                assert isinstance(cell, str)

    def test_sample1_data_row_length_matches_headers(self):
        """Each data row has the same number of cells as the header row."""
        from app.routers.email_intake import _extract_attachment_preview

        _, sample = _extract_attachment_preview(_SAMPLE_1_TEXT)

        assert sample is not None
        header_len = len(sample["headers"])
        for row in sample["rows"]:
            assert len(row) == header_len

    # -------------------------------------------------------------------------
    # sample-3 style
    # -------------------------------------------------------------------------

    def test_sample3_extracts_title_rows_as_metadata(self):
        """ALL-CAPS title rows (no colons) are recognised as metadata labels."""
        from app.routers.email_intake import _extract_attachment_preview

        metadata, _ = _extract_attachment_preview(_SAMPLE_3_TEXT)

        assert metadata is not None
        keys = [r["key"] for r in metadata]
        # First title row should be treated as a metadata label
        assert any("VANTAGE" in k for k in keys)

    def test_sample3_extracts_agreement_ref_row(self):
        """'AGREEMENT REF: VRP / BC-2025-0011' row is captured in metadata."""
        from app.routers.email_intake import _extract_attachment_preview

        metadata, _ = _extract_attachment_preview(_SAMPLE_3_TEXT)

        assert metadata is not None
        # Should find a row whose key contains AGREEMENT REF
        agreement_rows = [r for r in metadata if "AGREEMENT REF" in r["key"]]
        assert len(agreement_rows) >= 1

    def test_sample3_returns_sample_rows_with_correct_headers(self):
        """Data header row (Item #, Description, ...) is captured."""
        from app.routers.email_intake import _extract_attachment_preview

        _, sample = _extract_attachment_preview(_SAMPLE_3_TEXT)

        assert sample is not None
        headers = sample["headers"]
        # The data header contains these columns from sample-3
        assert "Item #" in headers
        assert "Description" in headers
        assert "Amount Owed" in headers

    def test_sample3_returns_data_rows(self):
        """Up to 3 data rows are captured from after the header."""
        from app.routers.email_intake import _extract_attachment_preview

        _, sample = _extract_attachment_preview(_SAMPLE_3_TEXT)

        assert sample is not None
        assert len(sample["rows"]) >= 1
        assert len(sample["rows"]) <= 3

    # -------------------------------------------------------------------------
    # Empty / None input
    # -------------------------------------------------------------------------

    def test_empty_string_returns_none_none(self):
        """Empty string → (None, None)."""
        from app.routers.email_intake import _extract_attachment_preview

        metadata, sample = _extract_attachment_preview("")

        assert metadata is None
        assert sample is None

    def test_whitespace_only_returns_none_none(self):
        """Whitespace-only string → (None, None)."""
        from app.routers.email_intake import _extract_attachment_preview

        metadata, sample = _extract_attachment_preview("   \n\n   ")

        assert metadata is None
        assert sample is None

    def test_none_input_returns_none_none(self):
        """None input → (None, None) without raising."""
        from app.routers.email_intake import _extract_attachment_preview

        metadata, sample = _extract_attachment_preview(None)

        assert metadata is None
        assert sample is None

    # -------------------------------------------------------------------------
    # No metadata rows — header is the first row
    # -------------------------------------------------------------------------

    def test_no_metadata_rows_returns_none_for_metadata(self):
        """When the first row is the data header, metadata is None."""
        from app.routers.email_intake import _extract_attachment_preview

        metadata, _ = _extract_attachment_preview(_HEADER_FIRST_TEXT)

        assert metadata is None

    def test_no_metadata_rows_still_returns_sample_rows(self):
        """When the first row is the data header, sample_rows is still populated."""
        from app.routers.email_intake import _extract_attachment_preview

        _, sample = _extract_attachment_preview(_HEADER_FIRST_TEXT)

        assert sample is not None
        assert "headers" in sample
        assert "Product Description" in sample["headers"]
        assert len(sample["rows"]) <= 3

    def test_no_metadata_rows_data_rows_not_empty(self):
        """At least one data row is captured when data immediately follows the header."""
        from app.routers.email_intake import _extract_attachment_preview

        _, sample = _extract_attachment_preview(_HEADER_FIRST_TEXT)

        assert sample is not None
        assert len(sample["rows"]) >= 1

    # -------------------------------------------------------------------------
    # Return value structure guarantees
    # -------------------------------------------------------------------------

    def test_metadata_rows_are_list_of_dicts_with_key_and_value(self):
        """Every metadata row has exactly 'key' and 'value' string fields."""
        from app.routers.email_intake import _extract_attachment_preview

        metadata, _ = _extract_attachment_preview(_SAMPLE_1_TEXT)

        assert metadata is not None
        for row in metadata:
            assert set(row.keys()) == {"key", "value"}
            assert isinstance(row["key"], str)
            assert isinstance(row["value"], str)

    def test_sample_rows_dict_has_headers_and_rows_keys(self):
        """sample_rows dict always has exactly 'headers' and 'rows' keys."""
        from app.routers.email_intake import _extract_attachment_preview

        _, sample = _extract_attachment_preview(_SAMPLE_1_TEXT)

        assert sample is not None
        assert set(sample.keys()) == {"headers", "rows"}
        assert isinstance(sample["headers"], list)
        assert isinstance(sample["rows"], list)


# ===========================================================================
# GET /api/email-intake/reports — attachment preview fields in response
# ===========================================================================

class TestInboundReportPreviewFieldsInResponse:
    """
    Verify that attachment_metadata_rows and attachment_sample_rows are
    present (possibly null) in the GET /inbound-reports/{id} -style response.

    The list endpoint (GET /reports) and the confirm endpoint both return
    InboundReportResponse which inherits from InboundReport.  We test via
    GET /reports since it is the simplest authenticated endpoint returning
    full report objects.
    """

    def _make_report_with_preview(
        self,
        user_id: str = "abcd1234-0000-0000-0000-000000000000",
        metadata_rows=None,
        sample_rows=None,
    ) -> dict:
        """Build a DB row that includes the preview columns."""
        base = _make_inbound_report_with_new_fields(user_id=user_id)
        base["attachment_metadata_rows"] = metadata_rows
        base["attachment_sample_rows"] = sample_rows
        return base

    def test_list_reports_includes_attachment_metadata_rows_when_present(self, client):
        """attachment_metadata_rows is returned when populated."""
        user_id = "abcd1234-0000-0000-0000-000000000000"
        metadata = [
            {"key": "Licensee Name", "value": "Sunrise Apparel Co."},
            {"key": "Contract Number", "value": "BC-2024-0042"},
        ]
        report = self._make_report_with_preview(
            user_id=user_id, metadata_rows=metadata
        )
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
        assert len(data) == 1
        assert data[0]["attachment_metadata_rows"] == metadata

    def test_list_reports_includes_attachment_sample_rows_when_present(self, client):
        """attachment_sample_rows is returned when populated."""
        user_id = "abcd1234-0000-0000-0000-000000000000"
        sample = {
            "headers": ["Product Description", "Net Sales", "Royalty Due"],
            "rows": [["Widget A", "10000.00", "800.00"]],
        }
        report = self._make_report_with_preview(
            user_id=user_id, sample_rows=sample
        )
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
        assert len(data) == 1
        assert data[0]["attachment_sample_rows"] == sample

    def test_list_reports_preview_fields_are_null_when_absent(self, client):
        """attachment_metadata_rows and attachment_sample_rows default to null."""
        user_id = "abcd1234-0000-0000-0000-000000000000"
        report = self._make_report_with_preview(user_id=user_id)  # both None
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
        assert len(data) == 1
        assert data[0]["attachment_metadata_rows"] is None
        assert data[0]["attachment_sample_rows"] is None


# ===========================================================================
# InboundReport model: attachment preview fields
# ===========================================================================

class TestInboundReportPreviewFields:
    """InboundReport model accepts and defaults the two new preview fields."""

    def test_parses_attachment_metadata_rows(self):
        """attachment_metadata_rows is parsed correctly from a DB row."""
        from app.models.email_intake import InboundReport

        metadata = [
            {"key": "Licensee Name", "value": "Sunrise Apparel Co."},
            {"key": "Contract Number", "value": "BC-2024-0042"},
        ]
        db_row = _make_db_inbound_report()
        db_row["attachment_metadata_rows"] = metadata
        db_row["attachment_sample_rows"] = None
        report = InboundReport(**db_row)
        assert report.attachment_metadata_rows == metadata

    def test_parses_attachment_sample_rows(self):
        """attachment_sample_rows is parsed correctly from a DB row."""
        from app.models.email_intake import InboundReport

        sample = {
            "headers": ["Product Description", "Net Sales"],
            "rows": [["Widget A", "10000.00"]],
        }
        db_row = _make_db_inbound_report()
        db_row["attachment_metadata_rows"] = None
        db_row["attachment_sample_rows"] = sample
        report = InboundReport(**db_row)
        assert report.attachment_sample_rows == sample

    def test_preview_fields_default_to_none_for_legacy_rows(self):
        """Legacy DB rows without the preview columns parse without error."""
        from app.models.email_intake import InboundReport

        db_row = _make_db_inbound_report()
        # Simulate a row from before the migration (columns absent)
        db_row.pop("attachment_metadata_rows", None)
        db_row.pop("attachment_sample_rows", None)
        report = InboundReport(**db_row)
        assert report.attachment_metadata_rows is None
        assert report.attachment_sample_rows is None

"""FastAPI endpoint tests using TestClient."""
from __future__ import annotations

import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client():
    # Patch heavy startup tasks before importing app
    with patch("api.main.threading.Thread"):
        from api.main import app
        return TestClient(app)


class TestHealthEndpoint:
    def test_health_ok(self, client):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert "GridScope" in data["service"]


class TestInventoryEndpoint:
    def test_inventory_returns_dict(self, client):
        with patch("app.loader.get_data_inventory", return_value={"prices": {}}):
            resp = client.get("/api/inventory")
        assert resp.status_code == 200
        assert isinstance(resp.json(), dict)


class TestPageEndpoint:
    def test_valid_page(self, client):
        with patch("app.loader.get_page_config", return_value={"page": "prices", "datasets": {}}):
            resp = client.get("/api/page/prices")
        assert resp.status_code == 200

    def test_invalid_page_returns_404(self, client):
        resp = client.get("/api/page/nonexistent_page_xyz")
        assert resp.status_code == 404


class TestDatasetEndpoint:
    def test_unknown_dataset_returns_404(self, client):
        resp = client.get("/api/dataset/nonexistent_dataset_xyz")
        assert resp.status_code == 404

    def test_invalid_resolution_returns_422(self, client):
        resp = client.get("/api/dataset/da_lbmp_zone?resolution=invalid")
        assert resp.status_code == 422


class TestFiltersEndpoint:
    def test_unknown_dataset_returns_404(self, client):
        resp = client.get("/api/filters/nonexistent_xyz/Zone")
        assert resp.status_code == 404


class TestAIEndpoints:
    def test_ai_explainer_unconfigured(self, client):
        with patch("api.routes.ai.OPENAI_API_KEY", ""):
            resp = client.post("/api/ai-explainer", json={"question": "What is the LMP?"})
        assert resp.status_code == 200
        assert resp.json()["status"] == "unconfigured"

    def test_ai_explainer_empty_question(self, client):
        resp = client.post("/api/ai-explainer", json={"question": ""})
        assert resp.status_code == 400

    def test_ai_price_summary_unconfigured(self, client):
        with patch("api.routes.ai.OPENAI_API_KEY", ""):
            resp = client.post("/api/ai-price-summary", json={})
        assert resp.status_code == 200
        assert resp.json()["status"] == "unconfigured"

import copy
import json
import logging
import socket
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Lock, Thread
from unittest.mock import patch

import httpx
import uvicorn
from fastapi.testclient import TestClient
from openapi_spec_validator import validate

from bridge import (
    MAX_PAYLOAD_BYTES, MAX_RESPONSE_BYTES, Credentials, Settings, build_app, create_app,
)


ROOT = Path(__file__).parent
ADAPTER_AUTH = ("connector-user", "connector-test-password")
CREDENTIALS = Credentials(*ADAPTER_AUTH, "crm-test-user", "crm-test-password")


def settings(**changes):
    values = {
        "crm_base_url": "https://crm.test/GeneratedService.svc/rest/",
        "login_path": "Login",
        "login_parameters": {
            "username": "username", "password": "password", "language_id": "languageId",
        },
        "language_id": 1,
        "session_check_path": "IsLoggedIn",
        "logout_path": "Logout",
        "operations": {"QueryCompany": "QueryCompany", "InsertCompany": "InsertCompany"},
    }
    values.update(changes)
    return Settings(**values)


class MockCrm:
    def __init__(self):
        self.calls = []
        self.sessions = set()
        self.session_id = 0
        self.lock = Lock()
        self.session_valid = True
        self.session_wrapper = None
        self.failure_stage = None
        self.failure_status = 500
        self.timeout_stage = None
        self.non_json_stage = None
        self.login_method = "GET"
        self.result = {"QueryCompanyResult": [{"Name": "Example", "RecId": "1"}]}

    def handle(self, request: httpx.Request):
        stage = request.url.path.rsplit("/", 1)[-1]
        with self.lock:
            self.calls.append(request)
        if stage == self.timeout_stage:
            raise httpx.ReadTimeout("upstream timeout", request=request)
        if stage == self.failure_stage:
            return httpx.Response(self.failure_status, text="private upstream failure")
        if stage == self.non_json_stage:
            return httpx.Response(200, text="<html>not JSON</html>")
        if stage == "Login":
            assert request.method == self.login_method
            parameters = request.url.params if request.method == "GET" else json.loads(request.content)
            assert parameters["username"] == CREDENTIALS.crm_username
            assert parameters["password"] == CREDENTIALS.crm_password
            assert str(parameters["languageId"]) == "1"
            with self.lock:
                self.session_id += 1
                cookie = f"session-{self.session_id}"
                self.sessions.add(cookie)
            return httpx.Response(
                200, json=[], headers={"Set-Cookie": f"CRMSESSION={cookie}; Path=/; Secure; HttpOnly"},
            )
        cookie = request.headers.get("cookie", "").removeprefix("CRMSESSION=")
        if stage == "IsLoggedIn":
            value = self.session_valid and cookie in self.sessions
            if self.session_wrapper:
                value = {self.session_wrapper: value}
            return httpx.Response(200, json=value)
        if stage == "Logout":
            with self.lock:
                self.sessions.discard(cookie)
            return httpx.Response(204)
        if cookie not in self.sessions:
            return httpx.Response(401, text="Session is null. Login missing?")
        assert request.method == "POST"
        assert "authorization" not in request.headers
        return httpx.Response(200, json=self.result)

    def client(self):
        return httpx.Client(
            base_url=settings().crm_base_url, transport=httpx.MockTransport(self.handle),
            follow_redirects=False, headers={"Accept": "application/json"},
        )


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.crm = MockCrm()
        self.client = TestClient(build_app(settings(), CREDENTIALS, self.crm.client))
        logging.getLogger("aurea_connector").disabled = True

    def tearDown(self):
        self.client.close()
        logging.getLogger("aurea_connector").disabled = False

    def invoke(self, payload=None, name="QueryCompany", client=None):
        return (client or self.client).post(
            f"/api/operations/{name}", auth=ADAPTER_AUTH,
            json={"payloadJson": json.dumps(payload if payload is not None else {"request": {"limit": 10}})},
        )

    def test_connector_is_valid_swagger_2(self):
        definition = json.loads((ROOT / "apiDefinition.swagger.json").read_text())
        validate(definition)
        self.assertEqual(definition["swagger"], "2.0")
        self.assertEqual(definition["schemes"], ["https"])
        self.assertEqual(definition["securityDefinitions"]["basicAuth"]["type"], "basic")
        operation = definition["paths"]["/operations/{operationName}"]["post"]
        self.assertEqual(operation["operationId"], "InvokeCrmOperation")
        self.assertEqual(
            set(operation["responses"]), {"200", "400", "401", "404", "413", "502", "504"},
        )

    def test_health_requires_auth_and_does_not_call_crm(self):
        self.assertEqual(self.client.get("/api/health").status_code, 401)
        response = self.client.get("/api/health", auth=ADAPTER_AUTH)
        self.assertEqual(response.json(), {"status": "ok"})
        self.assertEqual(self.crm.calls, [])

    def test_wrong_missing_and_malformed_auth_are_rejected(self):
        cases = [
            {},
            {"auth": ("wrong", ADAPTER_AUTH[1])},
            {"auth": (ADAPTER_AUTH[0], "wrong")},
            {"headers": {"Authorization": "Basic not-base64!"}},
        ]
        for arguments in cases:
            with self.subTest(arguments=arguments):
                response = self.client.post(
                    "/api/operations/QueryCompany", json={"payloadJson": "{}"}, **arguments,
                )
                self.assertEqual(response.status_code, 401)
                self.assertIn("error", response.json())
        self.assertEqual(self.crm.calls, [])

    def test_forwards_exact_payload_and_preserves_wcf_result(self):
        payload = {"request": {"conditions": [], "limit": 10}}
        response = self.invoke(payload)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json()), {"resultJson"})
        self.assertEqual(json.loads(response.json()["resultJson"]), self.crm.result)
        self.assertEqual(
            [call.url.path.rsplit("/", 1)[-1] for call in self.crm.calls],
            ["Login", "IsLoggedIn", "QueryCompany", "Logout"],
        )
        self.assertEqual(json.loads(self.crm.calls[2].content), payload)
        self.assertNotIn(CREDENTIALS.crm_password, response.text)
        self.assertEqual(self.crm.sessions, set())

    def test_unknown_operation_does_not_reach_crm(self):
        response = self.invoke(name="DeleteEverything")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.crm.calls, [])

    def test_invalid_payloads_never_reach_crm(self):
        for payload in [
            "[]", '"text"', "null", "{", '{"value": NaN}', '{"value": Infinity}',
            '{"value": 1e999}', '{"value": "\\ud800"}',
        ]:
            with self.subTest(payload=payload):
                response = self.client.post(
                    "/api/operations/QueryCompany", auth=ADAPTER_AUTH,
                    json={"payloadJson": payload},
                )
                self.assertEqual(response.status_code, 400)
        self.assertEqual(self.crm.calls, [])

    def test_missing_extra_or_wrong_body_fields_are_rejected(self):
        for body in [{}, {"payloadJson": 1}, {"payloadJson": "{}", "password": "secret"}]:
            with self.subTest(body=body):
                response = self.client.post(
                    "/api/operations/QueryCompany", auth=ADAPTER_AUTH, json=body,
                )
                self.assertEqual(response.status_code, 400)
                self.assertNotIn("secret", response.text)
        self.assertEqual(self.crm.calls, [])

    def test_payload_limit_is_measured_in_utf8_bytes(self):
        value = json.dumps({"value": "\u00e9" * (MAX_PAYLOAD_BYTES // 2)}, ensure_ascii=False)
        response = self.client.post(
            "/api/operations/QueryCompany", auth=ADAPTER_AUTH, json={"payloadJson": value},
        )
        self.assertEqual(response.status_code, 413)
        self.assertEqual(self.crm.calls, [])

    def test_payload_at_exact_limit_is_accepted(self):
        value = '{"v":"' + ("x" * (MAX_PAYLOAD_BYTES - 8)) + '"}'
        self.assertEqual(len(value.encode()), MAX_PAYLOAD_BYTES)
        response = self.client.post(
            "/api/operations/QueryCompany", auth=ADAPTER_AUTH, json={"payloadJson": value},
        )
        self.assertEqual(response.status_code, 200)

    def test_outer_request_limit_including_chunked_body(self):
        for chunked in [False, True]:
            with self.subTest(chunked=chunked):
                content = b"x" * (MAX_RESPONSE_BYTES + 1)
                response = self.client.post(
                    "/api/operations/QueryCompany", auth=ADAPTER_AUTH,
                    content=iter([content[:1000], content[1000:]]) if chunked else content,
                )
                self.assertEqual(response.status_code, 413)
        self.assertEqual(self.crm.calls, [])

    def test_login_http_failure_is_not_reported_as_success(self):
        self.crm.failure_stage = "Login"
        response = self.invoke()
        self.assertEqual(response.status_code, 502)
        self.assertNotIn("private upstream", response.text)
        self.assertEqual([call.url.path.rsplit("/", 1)[-1] for call in self.crm.calls], ["Login", "Logout"])

    def test_failed_session_check_blocks_operation_and_cleans_up(self):
        self.crm.session_valid = False
        response = self.invoke()
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["error"]["code"], "CrmLoginFailed")
        self.assertEqual(self.crm.sessions, set())
        self.assertEqual(len(self.crm.calls), 3)

    def test_truthy_string_is_not_treated_as_valid_session(self):
        original = self.crm.handle

        def handle(request):
            if request.url.path.endswith("/IsLoggedIn"):
                return httpx.Response(200, json="true")
            return original(request)

        self.crm.handle = handle
        self.assertEqual(self.invoke().status_code, 502)

    def test_configured_wcf_session_wrapper(self):
        self.crm.session_wrapper = "IsLoggedInResult"
        with TestClient(build_app(
            settings(session_result_field="IsLoggedInResult"), CREDENTIALS, self.crm.client,
        )) as client:
            self.assertEqual(self.invoke(client=client).status_code, 200)

    def test_post_login_is_supported_when_contract_requires_it(self):
        self.crm.login_method = "POST"
        with TestClient(build_app(
            settings(login_method="POST"), CREDENTIALS, self.crm.client,
        )) as client:
            self.assertEqual(self.invoke(client=client).status_code, 200)
        self.assertEqual(str(self.crm.calls[0].url.query), "b''")

    def test_crm_http_errors_and_redirects_are_not_followed(self):
        for status in [401, 403, 500, 302]:
            with self.subTest(status=status):
                self.crm.failure_stage = "QueryCompany"
                self.crm.failure_status = status
                response = self.invoke()
                self.assertEqual(response.status_code, 502)
                self.assertIn(str(status), response.json()["error"]["message"])
                self.assertNotIn("private upstream", response.text)
                self.assertEqual(self.crm.sessions, set())

    def test_timeout_is_explicit_and_write_is_not_retried(self):
        self.crm.timeout_stage = "InsertCompany"
        response = self.invoke(name="InsertCompany")
        self.assertEqual(response.status_code, 504)
        self.assertIn("may already have committed", response.text)
        writes = [call for call in self.crm.calls if call.url.path.endswith("/InsertCompany")]
        self.assertEqual(len(writes), 1)
        self.assertEqual(self.crm.sessions, set())

    def test_non_json_response_is_rejected(self):
        self.crm.non_json_stage = "QueryCompany"
        response = self.invoke()
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["error"]["code"], "CrmInvalidJson")
        self.assertEqual(self.crm.sessions, set())

    def test_response_limit_is_enforced(self):
        self.crm.result = "x" * MAX_RESPONSE_BYTES
        response = self.invoke()
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["error"]["code"], "CrmResponseTooLarge")

    def test_json_business_error_is_preserved_not_relabelled(self):
        self.crm.result = {"errors": [{"code": "CRM_VALIDATION_ERROR"}]}
        response = self.invoke()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.json()["resultJson"]), self.crm.result)

    def test_logout_failure_is_visible_and_warns_against_write_retry(self):
        self.crm.failure_stage = "Logout"
        response = self.invoke(name="InsertCompany")
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["error"]["code"], "CrmLogoutFailed")
        self.assertIn("may have committed", response.text)

    def test_primary_error_is_preserved_when_logout_also_fails(self):
        self.crm.timeout_stage = "InsertCompany"
        self.crm.failure_stage = "Logout"
        response = self.invoke(name="InsertCompany")
        self.assertEqual(response.status_code, 504)
        self.assertEqual(response.json()["error"]["code"], "CrmTimeout")

    def test_concurrent_calls_have_isolated_sessions(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            responses = list(pool.map(lambda _: self.invoke(), range(8)))
        self.assertTrue(all(response.status_code == 200 for response in responses))
        self.assertEqual(self.crm.sessions, set())
        self.assertEqual(len(self.crm.calls), 32)

    def test_http_client_logging_cannot_print_login_query(self):
        self.assertGreaterEqual(logging.getLogger("httpx").level, logging.WARNING)
        self.assertGreaterEqual(logging.getLogger("httpcore").level, logging.WARNING)

    def test_live_local_server_handles_authenticated_requests(self):
        app = build_app(settings(), CREDENTIALS, self.crm.client)
        server = uvicorn.Server(uvicorn.Config(app, log_level="error", lifespan="off"))
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
        thread = Thread(target=server.run, kwargs={"sockets": [listener]})
        thread.start()
        try:
            deadline = time.monotonic() + 10
            while not server.started and thread.is_alive() and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertTrue(server.started, "Local adapter did not start.")
            with httpx.Client(base_url=f"http://127.0.0.1:{port}", trust_env=False) as client:
                self.assertEqual(client.get("/api/health").status_code, 401)
                self.assertEqual(client.get("/api/health", auth=ADAPTER_AUTH).json(), {"status": "ok"})
                response = self.invoke(client=client)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(json.loads(response.json()["resultJson"]), self.crm.result)
        finally:
            server.should_exit = True
            thread.join(timeout=10)
            listener.close()
        self.assertFalse(thread.is_alive(), "Local adapter did not shut down.")


class ConfigurationTests(unittest.TestCase):
    def test_rejects_unconfigured_sample_and_unsafe_upstream_urls(self):
        sample = Settings.model_validate_json((ROOT / "config.example.json").read_text())
        with self.assertRaises(ValueError):
            sample.validate_contract()
        for url in [
            "http://crm.test/service/", "https://user:pass@crm.test/service/",
            "https://crm.test/service/?password=secret", "https://crm.test/service/#fragment",
            "https://crm.test/service",
        ]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                settings(crm_base_url=url).validate_contract()

    def test_rejects_paths_outside_configured_service_and_auth_operations(self):
        for path in ["../Login", "/Login", "https://other.test/Login", "Query?url=evil", "%2e%2e/Login", "Logout"]:
            with self.subTest(path=path), self.assertRaises(ValueError):
                settings(operations={"QueryCompany": path}).validate_contract()

    def test_rejects_bad_operation_keys_and_login_parameters(self):
        with self.assertRaises(ValueError):
            settings(operations={"../operation": "QueryCompany"}).validate_contract()
        with self.assertRaises(ValueError):
            settings(login_parameters={"username": "username"}).validate_contract()
        with self.assertRaises(ValueError):
            settings(login_parameters={
                "username": "same", "password": "same", "language_id": "lang",
            }).validate_contract()

    def test_missing_credentials_fail_at_startup(self):
        with self.assertRaises(ValueError):
            Credentials("connector", "", "crm", "password")
        with self.assertRaises(ValueError):
            Credentials("connector:user", "password", "crm", "password")
        with self.assertRaises(ValueError):
            Credentials("connector", "\u00e9", "crm", "password")

    def test_environment_loading_and_missing_configuration_are_explicit(self):
        with patch.dict("os.environ", {}, clear=True):
            with self.assertRaises(ValueError):
                Credentials.from_environment()
        with patch.dict("os.environ", {"AUREA_CONFIG_PATH": str(ROOT / "does-not-exist.json")}):
            with self.assertRaises(FileNotFoundError):
                create_app()

    def test_operation_settings_are_not_mutated(self):
        configuration = settings()
        before = copy.deepcopy(configuration.model_dump())
        configuration.validate_contract()
        self.assertEqual(configuration.model_dump(), before)


if __name__ == "__main__":
    unittest.main()

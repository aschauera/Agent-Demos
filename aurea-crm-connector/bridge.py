import hmac
import json
import logging
import math
import os
import re
import ssl
from pathlib import Path
from typing import Callable
from urllib.parse import urlsplit

import httpx
from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel, ConfigDict, Field
from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Receive, Scope, Send


LOGGER = logging.getLogger("aurea_connector")
MAX_PAYLOAD_BYTES = 1024 * 1024
MAX_RESPONSE_BYTES = 4 * 1024 * 1024
OPERATION_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,79}")
SERVICE_PATH = re.compile(r"[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*")


class BridgeError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


class OperationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    payloadJson: str = Field(min_length=2)


class OperationResponse(BaseModel):
    resultJson: str


class HealthResponse(BaseModel):
    status: str


class RequestSizeLimit:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http" or scope["method"] != "POST":
            return await self.app(scope, receive, send)
        content = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            content.extend(message.get("body", b""))
            if len(content) > MAX_RESPONSE_BYTES:
                LOGGER.warning("Adapter request exceeded size limit")
                response = JSONResponse(
                    status_code=413,
                    content={"error": {"code": "PayloadTooLarge", "message": "Request exceeds the size limit."}},
                )
                return await response(scope, receive, send)
            if not message.get("more_body", False):
                break
        delivered = False

        async def replay():
            nonlocal delivered
            if delivered:
                return await receive()
            delivered = True
            return {"type": "http.request", "body": bytes(content), "more_body": False}

        await self.app(scope, replay, send)


def reject_nonfinite(value: str):
    raise ValueError(f"Non-finite JSON number: {value}")


def finite_float(value: str) -> float:
    result = float(value)
    if not math.isfinite(result):
        raise ValueError("JSON number exceeds the supported finite range.")
    return result


def parse_json(value: str):
    try:
        return json.loads(value, parse_constant=reject_nonfinite, parse_float=finite_float)
    except RecursionError:
        raise ValueError("JSON nesting exceeds the supported depth.") from None


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    crm_base_url: str
    login_path: str
    login_method: str = "GET"
    login_parameters: dict[str, str]
    language_id: int
    session_check_path: str
    session_result_field: str | None = None
    logout_path: str
    timeout_seconds: float = Field(default=20, gt=0, le=30)
    ca_bundle: str | None = None
    operations: dict[str, str]

    def validate_contract(self):
        url = urlsplit(self.crm_base_url)
        if (
            url.scheme != "https"
            or not url.hostname
            or url.username is not None
            or url.password is not None
            or url.query
            or url.fragment
            or not url.path.endswith("/")
            or url.hostname.endswith(".example")
            or "REPLACE_WITH" in url.path
        ):
            raise ValueError("crm_base_url must be a real HTTPS service URL ending in /.")
        if self.login_method not in {"GET", "POST"}:
            raise ValueError("login_method must be GET or POST as defined by the service.")
        if set(self.login_parameters) != {"username", "password", "language_id"}:
            raise ValueError("login_parameters must map username, password, and language_id.")
        names = list(self.login_parameters.values())
        if len(set(names)) != 3 or any(not OPERATION_NAME.fullmatch(name) for name in names):
            raise ValueError("Login parameter names must be distinct identifiers.")
        if not self.operations:
            raise ValueError("Configure at least one approved CRM operation.")
        if any(not OPERATION_NAME.fullmatch(name) for name in self.operations):
            raise ValueError("Operation keys must be valid identifiers.")
        paths = [
            self.login_path, self.session_check_path, self.logout_path,
            *self.operations.values(),
        ]
        if any(not SERVICE_PATH.fullmatch(path) for path in paths):
            raise ValueError("Service paths must be relative paths without query strings or traversal.")
        auth_paths = {self.login_path, self.session_check_path, self.logout_path}
        if any(path in auth_paths for path in self.operations.values()):
            raise ValueError("Authentication methods cannot be exposed as CRM operations.")
        if self.session_result_field == "":
            raise ValueError("session_result_field must be null or a nonempty field name.")


class Credentials:
    def __init__(self, connector_username: str, connector_password: str,
                 crm_username: str, crm_password: str):
        values = (connector_username, connector_password, crm_username, crm_password)
        if any(not value for value in values):
            raise ValueError("Both adapter and CRM credentials must be configured.")
        if not connector_username.isascii() or not connector_password.isascii() or ":" in connector_username:
            raise ValueError("Adapter Basic-auth credentials must be ASCII, with no colon in the username.")
        self.connector_username = connector_username
        self.connector_password = connector_password
        self.crm_username = crm_username
        self.crm_password = crm_password

    @classmethod
    def from_environment(cls):
        return cls(
            os.environ.get("AUREA_CONNECTOR_USERNAME", ""),
            os.environ.get("AUREA_CONNECTOR_PASSWORD", ""),
            os.environ.get("AUREA_CRM_USERNAME", ""),
            os.environ.get("AUREA_CRM_PASSWORD", ""),
        )


def read_response(client: httpx.Client, method: str, path: str, stage: str, **kwargs):
    try:
        with client.stream(method, path, **kwargs) as response:
            if not 200 <= response.status_code < 300:
                LOGGER.warning("CRM stage=%s http_status=%s", stage, response.status_code)
                raise BridgeError(
                    502, "CrmHttpError",
                    f"CRM {stage} returned HTTP {response.status_code}. "
                    "A submitted write may already have committed.",
                )
            content = bytearray()
            for chunk in response.iter_bytes():
                content.extend(chunk)
                if len(content) > MAX_RESPONSE_BYTES:
                    LOGGER.warning("CRM stage=%s response exceeded size limit", stage)
                    raise BridgeError(502, "CrmResponseTooLarge", "CRM response exceeds the size limit.")
            if stage == "logout" and not content:
                return None
            try:
                return parse_json(content.decode("utf-8-sig"))
            except (UnicodeDecodeError, ValueError):
                LOGGER.warning("CRM stage=%s returned invalid JSON", stage)
                raise BridgeError(502, "CrmInvalidJson", f"CRM {stage} did not return valid JSON.") from None
    except httpx.TimeoutException:
        LOGGER.warning("CRM stage=%s timed out", stage)
        raise BridgeError(
            504, "CrmTimeout",
            f"CRM {stage} timed out. A submitted write may already have committed; do not blindly retry.",
        ) from None
    except httpx.HTTPError:
        LOGGER.warning("CRM stage=%s transport failed", stage)
        raise BridgeError(502, "CrmTransportError", f"Unable to complete CRM {stage}.") from None


class CrmAdapter:
    def __init__(self, settings: Settings, credentials: Credentials,
                 client_factory: Callable[[], httpx.Client]):
        self.settings = settings
        self.credentials = credentials
        self.client_factory = client_factory

    def invoke(self, operation: str, payload_json: str) -> str:
        if operation not in self.settings.operations:
            raise BridgeError(404, "UnknownOperation", "CRM operation is not allowlisted.")
        try:
            payload_size = len(payload_json.encode("utf-8"))
        except UnicodeEncodeError:
            raise BridgeError(400, "InvalidPayload", "payloadJson must contain valid UTF-8 text.") from None
        if payload_size > MAX_PAYLOAD_BYTES:
            raise BridgeError(413, "PayloadTooLarge", "CRM request exceeds the size limit.")
        try:
            payload = parse_json(payload_json)
        except ValueError:
            raise BridgeError(400, "InvalidPayload", "payloadJson must contain valid JSON.") from None
        if not isinstance(payload, dict):
            raise BridgeError(400, "InvalidPayload", "payloadJson must contain a JSON object.")
        try:
            json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        except (ValueError, UnicodeEncodeError, RecursionError):
            raise BridgeError(400, "InvalidPayload", "payloadJson contains unsupported values or nesting.") from None
        parameters = self.settings.login_parameters
        login = {
            parameters["username"]: self.credentials.crm_username,
            parameters["password"]: self.credentials.crm_password,
            parameters["language_id"]: self.settings.language_id,
        }
        with self.client_factory() as client:
            primary_error = False
            login_attempted = False
            try:
                login_attempted = True
                argument = "params" if self.settings.login_method == "GET" else "json"
                read_response(
                    client, self.settings.login_method, self.settings.login_path,
                    "login", **{argument: login},
                )
                logged_in = read_response(
                    client, "GET", self.settings.session_check_path, "session check",
                )
                if self.settings.session_result_field is not None and isinstance(logged_in, dict):
                    logged_in = logged_in.get(self.settings.session_result_field)
                if logged_in is not True:
                    LOGGER.warning("CRM session verification failed")
                    raise BridgeError(502, "CrmLoginFailed", "CRM did not confirm an authenticated session.")
                result = read_response(
                    client, "POST", self.settings.operations[operation], "operation", json=payload,
                )
                return json.dumps(result, ensure_ascii=True, allow_nan=False)
            except BridgeError:
                primary_error = True
                raise
            finally:
                if login_attempted:
                    try:
                        read_response(client, "GET", self.settings.logout_path, "logout")
                    except BridgeError:
                        if not primary_error:
                            raise BridgeError(
                                502, "CrmLogoutFailed",
                                "CRM operation returned, but session cleanup failed. "
                                "The operation may have committed; do not blindly retry.",
                            ) from None


def build_app(settings: Settings, credentials: Credentials,
              client_factory: Callable[[], httpx.Client] | None = None) -> FastAPI:
    settings.validate_contract()
    # WCF GET login puts credentials in URLs; HTTP client request logs must stay off.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    if client_factory is None:
        context = ssl.create_default_context(cafile=settings.ca_bundle)

        def client_factory():
            return httpx.Client(
                base_url=settings.crm_base_url, verify=context,
                timeout=settings.timeout_seconds, follow_redirects=False, trust_env=False,
                headers={"Accept": "application/json"},
            )

    adapter = CrmAdapter(settings, credentials, client_factory)
    app = FastAPI(title="Aurea CRM session adapter", docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(RequestSizeLimit)
    basic = HTTPBasic(auto_error=False)

    def authenticate(value: HTTPBasicCredentials | None = Depends(basic)):
        username = value.username if value else ""
        password = value.password if value else ""
        username_ok = hmac.compare_digest(
            username.encode("utf-8"), credentials.connector_username.encode("utf-8"),
        )
        password_ok = hmac.compare_digest(
            password.encode("utf-8"), credentials.connector_password.encode("utf-8"),
        )
        if not (username_ok and password_ok):
            LOGGER.warning("Adapter authentication rejected")
            raise BridgeError(401, "Unauthorized", "Valid adapter credentials are required.")

    @app.exception_handler(BridgeError)
    async def bridge_error_handler(request: Request, error: BridgeError):
        LOGGER.warning("Adapter request failed code=%s http_status=%s", error.code, error.status)
        headers = {"WWW-Authenticate": "Basic"} if error.status == 401 else None
        return JSONResponse(
            status_code=error.status,
            content={"error": {"code": error.code, "message": error.message}},
            headers=headers,
        )

    @app.exception_handler(HTTPException)
    async def http_error_handler(request: Request, error: HTTPException):
        LOGGER.warning("Adapter request rejected http_status=%s", error.status_code)
        return JSONResponse(
            status_code=error.status_code,
            content={"error": {"code": "InvalidRequest", "message": "Request could not be accepted."}},
            headers=error.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(request: Request, error: RequestValidationError):
        LOGGER.warning("Adapter request validation failed")
        return JSONResponse(
            status_code=400,
            content={"error": {"code": "InvalidRequest", "message": "Provide only a payloadJson string."}},
        )

    @app.get("/api/health", response_model=HealthResponse, dependencies=[Depends(authenticate)])
    def health():
        return {"status": "ok"}

    @app.post(
        "/api/operations/{operation_name}", response_model=OperationResponse,
        dependencies=[Depends(authenticate)],
    )
    def invoke_operation(operation_name: str, body: OperationRequest):
        return {"resultJson": adapter.invoke(operation_name, body.payloadJson)}

    return app


def create_app() -> FastAPI:
    config_path = Path(os.environ.get("AUREA_CONFIG_PATH", "config.json"))
    settings = Settings.model_validate_json(config_path.read_text(encoding="utf-8"))
    return build_app(settings, Credentials.from_environment())

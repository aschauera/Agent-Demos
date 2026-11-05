# Aurea CRM 2017 on-premises Power Platform connector

A demonstration solution for connecting **Power Apps** and **Power Automate** to
on-premises **Aurea CRM** through generated CRM.webservices REST endpoints.
The solution combines a Power Platform custom connector, an on-premises data
gateway, and a session-aware HTTPS adapter.

**This is a demo, not a production-ready product.** Review the
[demo disclaimer](#demo-disclaimer) before installation or use.

## Description of components

| Component | Purpose |
| --- | --- |
| [Custom connector definition](./apiDefinition.swagger.json) | Swagger 2.0 definition exposing adapter connectivity and CRM operation actions. Uses Basic authentication with dedicated adapter credentials. |
| Standard on-premises data gateway | Connects Power Platform to the private HTTPS adapter. Installed and registered separately; not included in this repository. |
| [Session adapter](./bridge.py) | FastAPI service that authenticates requests, validates JSON, restricts access to configured operations, and manages CRM session cookies. |
| [Configuration example](./config.example.json) | Template for the generated REST service URL, authentication method paths, parameter mappings, and approved CRM operations. |
| [Technical connection overview](./connection-overview.html) | Self-contained, light/dark one-page view of the Copilot Studio connection route and session lifecycle. Supports A4 landscape printing. |
| [Business overview](./business-overview.html) | Less technical one-page view of the Copilot Studio user journey, potential business value, safeguards, and pilot requirements. |
| [Automated tests](./test_bridge.py) | Swagger validation and adapter behavior tests against a mock CRM, including a localhost HTTP smoke test. |
| [Runtime dependencies](./requirements.txt) and [test dependencies](./requirements-dev.txt) | Python packages required to run the adapter and execute the test suite. |

### Connection flow

```text
Power Apps / Power Automate
    -> custom connector (Basic authentication)
    -> standard on-premises data gateway
    -> on-premises HTTPS adapter
    -> generated CRM.webservices REST service (JSON + CRM session cookie)
```

The gateway establishes outbound connectivity to Power Platform; the CRM service
does not need to be exposed to the public internet.

For each authenticated, valid request, the adapter creates an isolated cookie jar,
calls `Login`, verifies `IsLoggedIn`, invokes the configured operation, and attempts
`Logout`, including when an upstream request fails.

### Authentication boundaries

Two separate credential sets are used:

| Credential set | Location and purpose |
| --- | --- |
| Adapter username and password | Stored in the Power Platform connection and used to authenticate to the adapter. |
| CRM integration account | Supplied through the adapter's protected environment and used for CRM Login. Never returned to the calling flow. |

**All connector users act as the same configured CRM integration account.**
This is not delegated user authentication. Separate adapter deployments and CRM
accounts are required for separate permission boundaries.

## Prerequisites

- **Python 3.11 or newer** on the adapter host. The installation examples use Windows
  and PowerShell.
- An installed and appropriately licensed **Aurea CRM.webservices** service with a
  generated **REST endpoint and JSON message format**.
- The installed service's documentation, generated definition/WSDL, exact REST
  base URL, Login/IsLoggedIn/Logout paths, and working request/response examples.
- Login HTTP method and parameter names, a valid language ID, and the exact
  IsLoggedIn JSON response shape.
- A least-privilege CRM integration account with access only to the required Info
  Areas, fields, and operations.
- HTTPS certificates and CA trust configured for both adapter-to-CRM and
  gateway-to-adapter connections.
- A **standard**, not personal-mode, on-premises data gateway with network access
  to the adapter and outbound connectivity to Power Platform.
- Power Platform environment permissions, an appropriate Power Apps/Power Automate
  entitlement for custom connectors and gateway usage, and compatible DLP policies.

### Compatibility requirements

CRM operation names, field names, parameter wrappers, and URLs depend on the
generated service. The configuration is a template, not a verified contract for
every CRM 2017 installation. `QueryCompany` is a documented example name and is
not guaranteed to exist.

This adapter assumes the WCF endpoint accepts requests without additional IIS
authentication and performs CRM authentication through its Login method. IIS
Windows/NTLM/Kerberos, forms authentication, SOAP, and generated
"methods with credentials" require a different upstream integration. Do not
disable existing security controls to accommodate this demo.

## Installation

### 1. Install the adapter dependencies

Run the following commands from the `aurea-crm-connector` directory. Follow the
organization's approved package-source and dependency-management policies.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .\config.example.json .\config.json
```

### 2. Configure the CRM service

Edit `config.json` using the installed generated REST contract. The adapter rejects
the example's placeholder base URL at startup.

- Replace `crm_base_url` with the real HTTPS REST service URL **ending in `/`**.
- All method paths are relative to that base, without leading `/`, query strings,
  or traversal. The `operations` mapping is an allowlist, not an arbitrary URL proxy.
- Set `login_path`, `session_check_path`, `logout_path`, `login_parameters`, and
  `language_id` from the service definition. GET Login sends
  parameters in the query; POST login sends a flat JSON object. Nested Login
  wrappers are not supported.
- IsLoggedIn must return JSON `true`. Set `session_result_field` if the actual
  response wraps that boolean, for example `{"IsLoggedInResult": true}`.
- If required, set `ca_bundle` to the path of your internal CA certificate bundle.
  Certificate verification is never disabled.
- Default upstream timeout is 20 seconds **per call**, maximum 30. There are four
  calls per action; gateway/flow time limits may require a lower setting.

Use the Aurea Service Generator to expose only the required Info Areas and fields.
Start with a read-only method. Add Insert/Update/Delete mappings only when needed.

### 3. Supply credentials

Provide these environment variables to the adapter process through your approved
secret-management/deployment mechanism; do not commit values or paste passwords
into shell history:

| Variable | Meaning |
| --- | --- |
| `AUREA_CONFIG_PATH` | Optional configuration path; defaults to `config.json` |
| `AUREA_CONNECTOR_USERNAME` | Dedicated adapter Basic-auth username |
| `AUREA_CONNECTOR_PASSWORD` | Dedicated adapter password |
| `AUREA_CRM_USERNAME` | CRM integration account |
| `AUREA_CRM_PASSWORD` | CRM integration account password |

The adapter Basic-auth username/password must use ASCII characters; the username
must not contain a colon. CRM Login credentials are separate and may contain Unicode.

For interactive setup, `Read-Host -MaskInput` in PowerShell 7 can populate password
variables without echoing them or embedding them in command history. For unattended
use, set variables in the protected service environment instead.

### 4. Start the HTTPS adapter

Start with a server certificate/key issued for the adapter DNS name:

```powershell
.\.venv\Scripts\python.exe -m uvicorn bridge:create_app --factory `
  --host 0.0.0.0 --port 8443 `
  --ssl-certfile C:\certs\aurea-adapter.pem `
  --ssl-keyfile C:\certs\aurea-adapter.key
```

For persistent deployment, configure a managed Windows service/process supervisor.
Restrict inbound access to gateway hosts, protect secrets and the TLS private key,
and apply normal OS/service hardening. Do not publish the CRM or adapter to the
internet. When using a reverse proxy, terminate HTTPS there, enforce body/time
limits, and keep its upstream listener private.

#### Credential-safe logging

**GET Login includes the CRM password in the upstream URL.** Use HTTPS and
configure IIS/reverse-proxy/APM logging to suppress/redact Login query strings.
The adapter suppresses HTTP client request logs and never logs request/response
bodies, credentials, cookie values, or upstream URLs. Do not enable HTTP transport
debug logging. The adapter does not use environment HTTP proxies (`trust_env=False`).

### 5. Import the connector into Power Platform

1. Install/register a **standard**, not personal-mode, on-premises data gateway
   with access to the adapter. Ensure its service context trusts the adapter CA
   and can resolve the DNS name.
2. In Power Apps/Power Automate, select the intended environment, then **Custom
   connectors > New custom connector > Import an OpenAPI file**. Import
   `apiDefinition.swagger.json`.
3. Change Host from `aurea-connector.internal.example:8443` to your real adapter
   DNS name and port, **without** `https://` or a path. Keep scheme HTTPS and base
   URL `/api`.
4. Enable **Connect via on-premises data gateway** in General. In Security, use
   **Basic authentication**. These are the **adapter** credentials, not CRM
   credentials. Save the connector.
5. Create a connection, enter the adapter username/password, and select the gateway.
6. Test **Check adapter connectivity**. It checks the adapter only, not CRM.
7. Test **Invoke a CRM operation** with a configured read-only operation and
   `payloadJson` copied from your installed REST service's working example.

Verify the imported connector, gateway connection, and actual CRM behavior in the
target environment before enabling write operations.

## Usage

### Connector actions

| Action | Behavior |
| --- | --- |
| **Check adapter connectivity** | Authenticated `GET /api/health`. Confirms the adapter is reachable; does not check CRM availability or credentials. |
| **Invoke a CRM operation** | `POST /api/operations/{operationName}`. Executes a configured CRM method through an isolated, verified CRM session. |

### Invoke a CRM operation

The operation action accepts:

| Input | Value |
| --- | --- |
| operationName | Exact key in `config.json`, e.g. `QueryCompany` if configured |
| payloadJson | String containing the generated method's JSON object |

The adapter forwards that object unchanged, including any WCF parameter wrapper.
It returns `{"resultJson":"<complete JSON response>"}`. Use a **Parse JSON** action
on `resultJson`, using a schema generated from the actual CRM response. Typed
connector actions can be added using the installed service contract.

### Errors and operational limits

Transport failures, authentication failures, invalid JSON, oversized responses,
and logout failures return explicit HTTP errors. Successful CRM JSON is preserved,
including CRM business-error structures: inspect those in the flow.

**Disable automatic retries for non-idempotent writes** in the flow action
settings. A timeout or logout failure can occur after CRM committed a write. The
adapter does not retry, and does not implement idempotency or paging.
Payload limit: 1 MiB in UTF-8. Outer request and CRM response limits: 4 MiB.

### Run the tests

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m unittest -v test_bridge
```

The tests validate the Swagger 2.0 document, authentication, cookie/session isolation, exact
payload/result forwarding, size limits, configuration rejection, and error paths
against a mock CRM, and include an authenticated localhost HTTP smoke test.
They do **not** certify compatibility with a live CRM 2017 installation or the
Power Platform service.

### Reference documentation

- [Aurea CRUD services](https://help.aurea.com/crm/crm-webservices-admin-guide/crm-webservices-admin-guide/dita/topics/c_web_ser_adm-3_3-Custom-Services-CRU_upd.html)
- [Aurea REST support and message format](https://help.aurea.com/crm/crm-webservices-admin-guide/crm-webservices-admin-guide/dita/topics/c_web_ser_adm-1_6_2_4-REST-Support-and-RES_upd.html)
- [Aurea Service Generator](https://help.aurea.com/crm/crm-webservices-admin-guide/crm-webservices-admin-guide/dita/topics/c_web_ser_adm-4_1-Service-Generator_upd.html)
- [Aurea login/session cookies](https://help.aurea.com/crm/crm-webservices-admin-guide/crm-webservices-admin-guide/dita/topics/c_web_ser_adm-5_2-Login-and-session-co_upd.html)
- [Microsoft custom connector overview and gateway connectivity](https://learn.microsoft.com/en-us/connectors/custom-connectors/)
- [Microsoft connector authentication](https://learn.microsoft.com/en-us/connectors/custom-connectors/connection-parameters)

## Demo disclaimer

This solution is provided **solely for demonstration and educational purposes**.
It is not production-ready, is not a supported Aurea or Microsoft product, and
comes with no support, service-level, security, or compatibility commitments.
Installation-specific validation, security review, and operational hardening are
the responsibility of the party deploying it.

The solution is provided **"AS IS" and "AS AVAILABLE", without warranty of any
kind**, express or implied, including warranties of merchantability, fitness for
a particular purpose, and non-infringement.

**To the maximum extent permitted by applicable law, the authors and contributors
accept no liability whatsoever** for any claim, damage, loss, or other liability
arising from or relating to this solution or its use, inability to use, or
deployment, whether in contract, tort, or otherwise. This includes direct,
indirect, incidental, consequential, and other damages, data loss, security
incidents, and business interruption. Use is entirely at the user's own risk.

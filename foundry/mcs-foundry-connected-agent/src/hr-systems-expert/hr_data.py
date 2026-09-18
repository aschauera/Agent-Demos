import json
import re
from typing import Any


MOCK_ROLES: dict[str, dict[str, Any]] = {
    "power platform architect": {
        "title": "Power Platform Architect",
        "job_family": "Business Applications Architecture",
        "summary": (
            "Defines enterprise Power Platform architecture, governance, security, "
            "integration patterns, and solution quality standards."
        ),
        "responsibilities": [
            "Design enterprise-grade Power Platform solution architectures.",
            "Define governance, environment, security, and ALM standards.",
            "Guide integration with Dataverse, Azure, Microsoft 365, and line-of-business systems.",
            "Review solution designs and coach delivery teams.",
        ],
        "skills": [
            "Power Apps",
            "Power Automate",
            "Dataverse",
            "Azure integration",
            "ALM",
            "security and governance",
        ],
        "salary": {
            "currency": "USD",
            "location": "United States",
            "minimum": 145000,
            "midpoint": 167500,
            "maximum": 190000,
        },
        "leveling": {
            "typical_level": "L6",
            "level_range": ["L5", "L6", "L7"],
            "experience": "Typically 10+ years in technology, including 5+ years with Power Platform.",
            "scope": "Enterprise or multi-business-unit architecture ownership.",
        },
    },
    "power platform developer": {
        "title": "Power Platform Developer",
        "job_family": "Business Applications Engineering",
        "summary": (
            "Builds and maintains Power Apps, Power Automate flows, Dataverse solutions, "
            "and integrations under established architecture and governance standards."
        ),
        "responsibilities": [
            "Implement canvas apps, model-driven apps, and cloud flows.",
            "Configure Dataverse tables, security roles, and business logic.",
            "Create integrations and reusable components.",
            "Test, document, deploy, and support solutions.",
        ],
        "skills": [
            "Power Apps",
            "Power Automate",
            "Dataverse",
            "Power Fx",
            "JavaScript",
            "solution ALM",
        ],
        "salary": {
            "currency": "USD",
            "location": "United States",
            "minimum": 105000,
            "midpoint": 125000,
            "maximum": 145000,
        },
        "leveling": {
            "typical_level": "L4",
            "level_range": ["L3", "L4", "L5"],
            "experience": "Typically 3-6 years in software or business application development.",
            "scope": "Owns features or medium-complexity solutions with architecture guidance.",
        },
    },
    "senior power platform developer": {
        "title": "Senior Power Platform Developer",
        "job_family": "Business Applications Engineering",
        "summary": (
            "Leads implementation of complex Power Platform solutions and provides "
            "technical guidance to developers and makers."
        ),
        "responsibilities": [
            "Lead complex app, automation, Dataverse, and integration implementation.",
            "Establish development patterns and conduct technical reviews.",
            "Mentor developers and troubleshoot production issues.",
            "Partner with architects on non-functional requirements.",
        ],
        "skills": [
            "Power Platform",
            "Dataverse",
            "Azure integration",
            "custom connectors",
            "ALM",
            "technical leadership",
        ],
        "salary": {
            "currency": "USD",
            "location": "United States",
            "minimum": 125000,
            "midpoint": 145000,
            "maximum": 165000,
        },
        "leveling": {
            "typical_level": "L5",
            "level_range": ["L4", "L5", "L6"],
            "experience": "Typically 6-9 years in software or business application development.",
            "scope": "Owns complex solutions and influences engineering practices across a team.",
        },
    },
    "power platform functional consultant": {
        "title": "Power Platform Functional Consultant",
        "job_family": "Business Applications Consulting",
        "summary": (
            "Translates business requirements into Power Platform processes, configurations, "
            "user experiences, and adoption plans."
        ),
        "responsibilities": [
            "Lead discovery and requirements workshops.",
            "Configure model-driven apps, Dataverse, and business processes.",
            "Create prototypes, acceptance criteria, and user guidance.",
            "Coordinate user acceptance testing and adoption.",
        ],
        "skills": [
            "business analysis",
            "Power Apps",
            "Power Automate",
            "Dataverse",
            "facilitation",
            "change adoption",
        ],
        "salary": {
            "currency": "USD",
            "location": "United States",
            "minimum": 95000,
            "midpoint": 115000,
            "maximum": 135000,
        },
        "leveling": {
            "typical_level": "L4",
            "level_range": ["L3", "L4", "L5"],
            "experience": "Typically 3-6 years in consulting, business analysis, or application delivery.",
            "scope": "Owns functional design for a workstream or medium-complexity solution.",
        },
    },
}

ALIASES = {
    "power apps architect": "power platform architect",
    "powerplatform architect": "power platform architect",
    "power apps developer": "power platform developer",
    "powerplatform developer": "power platform developer",
    "pp developer": "power platform developer",
    "senior power apps developer": "senior power platform developer",
    "power platform consultant": "power platform functional consultant",
}

MOCK_SOURCES = {
    "role": "Mock Workday Job Catalog",
    "salary": "Mock Compensation Hub",
    "leveling": "Mock Career Framework",
}


def _normalize(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", value.lower())).strip()


def _resolve_role(role_title: str) -> tuple[str | None, dict[str, Any] | None]:
    normalized = _normalize(role_title)
    key = ALIASES.get(normalized, normalized)
    if key in MOCK_ROLES:
        return key, MOCK_ROLES[key]

    partial_matches = [
        role_key
        for role_key in MOCK_ROLES
        if key in role_key or role_key in key
    ]
    if len(partial_matches) == 1:
        matched_key = partial_matches[0]
        return matched_key, MOCK_ROLES[matched_key]

    return None, None


def _not_found(role_title: str) -> str:
    available = sorted(role["title"] for role in MOCK_ROLES.values())
    return json.dumps(
        {
            "found": False,
            "query": role_title,
            "message": "No exact role was found in the mocked HR catalog.",
            "available_roles": available,
            "demo_data": True,
        }
    )


def get_role_profile_data(role_title: str) -> str:
    _, role = _resolve_role(role_title)
    if not role:
        return _not_found(role_title)

    return json.dumps(
        {
            "found": True,
            "role": {
                "title": role["title"],
                "job_family": role["job_family"],
                "summary": role["summary"],
                "responsibilities": role["responsibilities"],
                "skills": role["skills"],
            },
            "source": MOCK_SOURCES["role"],
            "demo_data": True,
        }
    )


def get_salary_range_data(role_title: str, location: str = "United States") -> str:
    _, role = _resolve_role(role_title)
    if not role:
        return _not_found(role_title)

    salary = role["salary"]
    return json.dumps(
        {
            "found": True,
            "role_title": role["title"],
            "requested_location": location,
            "salary_range": salary,
            "note": (
                "The mock catalog contains only a United States range; no geographic "
                "differential is applied to the requested location."
                if _normalize(location) != _normalize(salary["location"])
                else "Range is annual base salary and excludes bonus, equity, and benefits."
            ),
            "source": MOCK_SOURCES["salary"],
            "demo_data": True,
        }
    )


def get_job_leveling_data(role_title: str) -> str:
    _, role = _resolve_role(role_title)
    if not role:
        return _not_found(role_title)

    return json.dumps(
        {
            "found": True,
            "role_title": role["title"],
            "job_leveling": role["leveling"],
            "source": MOCK_SOURCES["leveling"],
            "demo_data": True,
        }
    )


def search_job_roles_data(query: str) -> str:
    normalized_terms = set(_normalize(query).split())
    matches = []

    for role in MOCK_ROLES.values():
        title_terms = set(_normalize(role["title"]).split())
        searchable_terms = set(
            _normalize(
                " ".join(
                    [
                        role["title"],
                        role["job_family"],
                        role["summary"],
                        *role["skills"],
                    ]
                )
            ).split()
        )

        score = 0
        for term in normalized_terms:
            if term in title_terms:
                score += 3
            elif len(term) >= 5 and any(
                candidate.startswith(term[:5]) or term.startswith(candidate[:5])
                for candidate in title_terms
                if len(candidate) >= 5
            ):
                score += 2
            elif term in searchable_terms:
                score += 1

        if score:
            matches.append(
                {
                    "title": role["title"],
                    "job_family": role["job_family"],
                    "typical_level": role["leveling"]["typical_level"],
                    "match_score": score,
                }
            )

    matches.sort(key=lambda item: (-item["match_score"], item["title"]))
    return json.dumps(
        {
            "query": query,
            "matches": matches,
            "source": MOCK_SOURCES["role"],
            "demo_data": True,
        }
    )

"""Merge captured scene JSON (artifacts/shots/*.json) with slide copy into artifacts/manifest.json.

Usage: python lib/build_manifest.py [shots_dir] [out_file]
"""
import json
import sys
from pathlib import Path

DECK = {
    "title": "From requirement to architecture",
    "subtitle": "with a Copilot agent",
    "scope": "Copilot Studio · Jira · Confluence · draw.io",
    "footer": "Architecture Expert agent demo",
}

SCENES = {
    "01-jira-backlog": {
        "title": "The feature backlog in Jira",
        "tagline": "Every requirement starts as a Jira work item",
        "bullets": ["Requirements project with five feature requests", "KAN-6: DEMO-REQ-20261023-004, shift handover notes", "Status: Idea, not yet designed"],
        "notes": "Start in Jira. The Requirements project lists the feature requests. We focus on KAN-6, the shift handover notes requirement, which has no architecture yet.",
    },
    "02-jira-kan6-details": {
        "title": "KAN-6 in detail",
        "tagline": "The business need, captured in the ticket",
        "bullets": ["User story, requirements and acceptance criteria", "Linked to its Confluence requirements page", "Still in status Idea"],
        "notes": "Opening KAN-6 shows the user story, requirements and acceptance criteria, plus a link to the Confluence requirements page. The agent will read all of this through the Atlassian connection.",
    },
    "03-confluence-spec": {
        "title": "The requirements specification",
        "tagline": "Confluence holds the full specification",
        "bullets": ["User story, requirements and acceptance criteria", "Out of scope and traceability back to KAN-6", "The page the agent will update at the end"],
        "notes": "The specification lives in Confluence: user story, requirements, acceptance criteria, scope and traceability to KAN-6. Remember this page; the agent will add the diagram links to it.",
    },
    "04-agent-instructions": {
        "title": "The Architecture Expert agent",
        "tagline": "Built in Copilot Studio with clear instructions",
        "bullets": ["Role: a software architecture expert", "Skills: ROVO for requirements, draw.io for diagrams", "Rules: retrieve facts first, separate assumptions"],
        "notes": "In Copilot Studio, the Architecture Expert agent's instructions define its role, the skills it uses (ROVO, draw.io, HTML prototyping) and behavioral rules, such as retrieving the requirement first and separating facts from assumptions.",
    },
    "05-agent-tools": {
        "title": "Connected tools",
        "tagline": "Work IQ, draw.io and Atlassian Rovo MCP",
        "bullets": ["Work IQ for Microsoft 365 context", "DrawIO to produce editable diagrams", "ROVO MCP to read and update Jira and Confluence"],
        "notes": "The agent's tools: Work IQ, a draw.io tool and the Atlassian Rovo MCP server. MCP gives it read and write access to Jira and Confluence.",
    },
    "06-copilot-prompt": {
        "title": "One prompt in Microsoft 365 Copilot",
        "tagline": "Ask for the complete architecture package",
        "bullets": ["The agent runs inside Microsoft 365 Copilot", "Only the requirement ID is needed", "The agent gathers the rest from Jira and Confluence"],
        "notes": "In Microsoft 365 Copilot we open the agent and ask: Create the complete architecture diagram package for DEMO-REQ-20261023-004.",
    },
    "07-copilot-response": {
        "title": "The architecture package",
        "tagline": "Five diagrams plus design decisions and risks",
        "bullets": ["Solution architecture, two sequences, lifecycle, data model", "Key decisions, risks and open questions", "Delivered as draw.io and Mermaid files"],
        "notes": "The agent returns a package of five diagrams with design decisions and risks, plus the files: an editable draw.io diagram and Mermaid sources.",
    },
    "08-drawio-architecture": {
        "title": "Solution and integration architecture",
        "tagline": "Editable in draw.io, straight from the agent",
        "bullets": ["Trust boundaries and all systems involved", "Directed connections with transport and payload", "Ready for the architect to refine"],
        "notes": "Diagram 01 opened in draw.io: trust boundaries, systems and integrations, fully editable.",
    },
    "09-drawio-sequences": {
        "title": "Draft, publish and archive sequences",
        "tagline": "Two transactions, clearly separated",
        "bullets": ["Tx 1: draft and publish with validation", "Tx 2: asynchronous archival with retries", "Failure handling made explicit"],
        "notes": "Diagrams 02 and 03 are sequence diagrams for publishing and for asynchronous archival, imported into draw.io from Mermaid.",
    },
    "10-drawio-lifecycle-data": {
        "title": "Lifecycle and data model",
        "tagline": "States and data, ready for engineering",
        "bullets": ["Handover and archive lifecycle states", "Logical data model for the handover database", "Assumptions flagged for review"],
        "notes": "Diagram 04 shows the handover and archive lifecycle and diagram 05 the logical data model.",
    },
    "11-followup-prompt": {
        "title": "Close the loop",
        "tagline": "Update Jira and Confluence in one follow-up",
        "bullets": ["Set the ticket to In Progress", "Add the diagram links to the specification", "No context switching"],
        "notes": "One follow-up prompt: Set the JIRA ticket to 'In Progress' and add the diagram links to the confluence specification.",
    },
    "12-followup-result": {
        "title": "Jira and Confluence updated",
        "tagline": "From requirement to documented design in minutes",
        "bullets": ["KAN-6 is now In Progress", "New Architecture diagrams section in Confluence", "Every link opens the diagram in draw.io"],
        "notes": "The agent confirms both changes. Jira shows KAN-6 In Progress, and the Confluence specification has a new Architecture diagrams section that links each diagram.",
    },
}


def main() -> None:
    shots_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "artifacts/shots")
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "artifacts/manifest.json")
    scenes = []
    for slug, copy in SCENES.items():
        captured = json.loads((shots_dir / f"{slug}.json").read_text(encoding="utf-8"))
        scenes.append({"slug": slug, **copy, "shots": captured["shots"]})
    out.write_text(json.dumps({"viewport": {"width": 1920, "height": 1080}, "deck": DECK, "scenes": scenes}, indent=2), encoding="utf-8")
    print(f"wrote {out} with {len(scenes)} scenes")


if __name__ == "__main__":
    main()

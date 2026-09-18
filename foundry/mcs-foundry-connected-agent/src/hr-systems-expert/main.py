import logging
import os

from agent_framework import Agent, tool
from agent_framework.foundry import FoundryChatClient
from agent_framework_foundry_hosting import ResponsesHostServer
from azure.ai.agentserver.activity import ActivityAgentServerHost
from azure.identity import DefaultAzureCredential
from dotenv import load_dotenv
from pydantic import Field
from typing_extensions import Annotated

from hr_data import (
    get_job_leveling_data,
    get_role_profile_data,
    get_salary_range_data,
    search_job_roles_data,
)


load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s | %(message)s",
)
logger = logging.getLogger("hr-systems-expert")

AGENT_INSTRUCTIONS = (
    "You are hr-systems-expert, a concise demo specialist for job roles, "
    "compensation ranges, and job leveling. Use the available tools instead of "
    "inventing HR records. Always state that results are fictional mocked demo "
    "data, identify the mock source returned by the tool, and never present the "
    "data as employment, compensation, legal, or hiring advice. Salary figures "
    "are annual base salary unless the tool says otherwise. If a role is not "
    "found, list the available roles and ask the caller to clarify. When a "
    "question needs multiple data domains, call each relevant tool and combine "
    "the results into a short, structured answer."
)


@tool(approval_mode="never_require")
def get_job_role(
    role_title: Annotated[str, Field(description="The job title to retrieve.")],
) -> str:
    """Retrieve a job profile from the mocked HR job catalog."""
    return get_role_profile_data(role_title)


@tool(approval_mode="never_require")
def get_salary_range(
    role_title: Annotated[str, Field(description="The job title to price.")],
    location: Annotated[
        str,
        Field(description="The requested employee location, such as United States."),
    ] = "United States",
) -> str:
    """Retrieve the mocked annual base-salary range for a job title."""
    return get_salary_range_data(role_title, location)


@tool(approval_mode="never_require")
def get_job_leveling(
    role_title: Annotated[str, Field(description="The job title to level.")],
) -> str:
    """Retrieve the mocked typical level, level range, experience, and scope for a role."""
    return get_job_leveling_data(role_title)


@tool(approval_mode="never_require")
def search_job_roles(
    query: Annotated[
        str,
        Field(description="Keywords describing the role, skill, or job family to find."),
    ],
) -> str:
    """Search the mocked HR job catalog for matching roles."""
    return search_job_roles_data(query)


def create_agent() -> Agent:
    client = FoundryChatClient(
        project_endpoint=os.environ["FOUNDRY_PROJECT_ENDPOINT"],
        model=os.environ["AZURE_AI_MODEL_DEPLOYMENT_NAME"],
        credential=DefaultAzureCredential(),
    )

    agent = Agent(
        client=client,
        instructions=AGENT_INSTRUCTIONS,
        tools=[
            get_job_role,
            get_salary_range,
            get_job_leveling,
            search_job_roles,
        ],
        default_options={"store": False},
    )
    return agent


class MultiProtocolHost(ActivityAgentServerHost, ResponsesHostServer):
    """Serve Activity and Responses from one hosted-agent process."""


def main() -> None:
    responses_agent = create_agent()
    activity_agent = create_agent()

    host = MultiProtocolHost(agent=responses_agent)
    app = host.agent_app

    @app.activity("message")
    async def on_activity_message(context, state) -> None:
        user_text = (context.activity.text or "").strip()
        if not user_text:
            return

        result = await activity_agent.run(user_text)
        await context.send_activity(str(result))

    @app.error
    async def on_activity_error(context, error) -> None:
        logger.error("Activity handler failed: %s", error, exc_info=True)
        await context.send_activity(
            "The HR systems expert couldn't process this request. Please try again."
        )

    host.run()


if __name__ == "__main__":
    main()

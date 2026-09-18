import json
import unittest

from hr_data import (
    get_job_leveling_data,
    get_role_profile_data,
    get_salary_range_data,
    search_job_roles_data,
)


class HrDataTests(unittest.TestCase):
    def test_power_platform_architect_salary_range(self) -> None:
        result = json.loads(get_salary_range_data("Power Platform Architect"))

        self.assertTrue(result["found"])
        self.assertEqual(result["role_title"], "Power Platform Architect")
        self.assertEqual(result["salary_range"]["minimum"], 145000)
        self.assertEqual(result["salary_range"]["maximum"], 190000)
        self.assertTrue(result["demo_data"])

    def test_power_platform_developer_typical_level(self) -> None:
        result = json.loads(get_job_leveling_data("Power platform developer"))

        self.assertTrue(result["found"])
        self.assertEqual(result["job_leveling"]["typical_level"], "L4")
        self.assertEqual(result["job_leveling"]["level_range"], ["L3", "L4", "L5"])

    def test_alias_resolves_role(self) -> None:
        result = json.loads(get_role_profile_data("Power Apps Architect"))

        self.assertTrue(result["found"])
        self.assertEqual(result["role"]["title"], "Power Platform Architect")

    def test_search_returns_relevant_roles_first(self) -> None:
        result = json.loads(search_job_roles_data("Power Platform development"))

        self.assertGreaterEqual(len(result["matches"]), 2)
        self.assertIn(
            result["matches"][0]["title"],
            {"Power Platform Developer", "Senior Power Platform Developer"},
        )

    def test_unknown_role_lists_available_roles(self) -> None:
        result = json.loads(get_job_leveling_data("Quantum Benefits Wizard"))

        self.assertFalse(result["found"])
        self.assertIn("Power Platform Developer", result["available_roles"])


if __name__ == "__main__":
    unittest.main()

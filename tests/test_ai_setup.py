"""The AI setup prompt lives in lib/ai-setup.ts (shown on /setup) and is copied
into README.md. AGENTS.md has the full steps for coding assistants. Keep the
copies the same, keep the safety rules in, and only name real commands."""

from __future__ import annotations

import argparse
import re
import shlex
import unittest
from pathlib import Path

from sg_local import cli

ROOT = Path(__file__).resolve().parents[1]


def read(name: str) -> str:
    return (ROOT / name).read_text(encoding="utf-8")


def site_prompt() -> str:
    match = re.search(r"AI_SETUP_PROMPT = `(.*?)`;", read("lib/ai-setup.ts"), re.S)
    if not match:
        raise AssertionError("lib/ai-setup.ts has no AI_SETUP_PROMPT template string")
    return match.group(1)


class AiSetupTests(unittest.TestCase):
    def test_readme_has_the_same_prompt(self) -> None:
        readme = read("README.md")
        match = re.search(r"## Set up with an AI assistant.*?````text\n(.*?)\n````", readme, re.S)
        self.assertIsNotNone(match, "README.md has no prompt block under 'Set up with an AI assistant'")
        self.assertEqual(match.group(1), site_prompt())

    def test_prompt_has_no_template_placeholders(self) -> None:
        # A ${...} would be filled in by JavaScript and differ from the README.
        self.assertNotIn("${", site_prompt())
        self.assertNotIn("`", site_prompt())

    def test_prompt_and_agents_keep_the_safety_rules(self) -> None:
        for name, text in (("prompt", site_prompt()), ("AGENTS.md", read("AGENTS.md"))):
            with self.subTest(name):
                self.assertIn("xoxc-", text)
                self.assertIn("xoxd-", text)
                self.assertIn("access code", text)
                self.assertIn("sudo", text)
                self.assertIn("certificate", text)

    def test_claude_md_loads_agents_md(self) -> None:
        self.assertIn("@AGENTS.md", read("CLAUDE.md"))

    def test_only_real_commands_are_named(self) -> None:
        parser = cli.build_parser()
        subparsers = next(a for a in parser._actions if isinstance(a, argparse._SubParsersAction))
        for name, text in (("prompt", site_prompt()), ("AGENTS.md", read("AGENTS.md"))):
            for line in re.findall(r"\./sg-local[^`\n(]*", text):
                words = shlex.split(line.strip())[1:]
                with self.subTest(source=name, command=line.strip()):
                    if words and not words[0].startswith("-"):
                        self.assertIn(words[0], subparsers.choices)
                        known = subparsers.choices[words[0]]._option_string_actions
                        words = words[1:]
                    else:
                        known = parser._option_string_actions
                    for option in (w for w in words if w.startswith("-")):
                        self.assertIn(option, known)


if __name__ == "__main__":
    unittest.main()

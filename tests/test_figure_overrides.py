import re
import unittest

from apply_figure_overrides import NAME_PATTERN, override_flags


class OverrideFilenameTests(unittest.TestCase):
    def parse_flags(self, filename: str) -> set[str]:
        match = NAME_PATTERN.fullmatch(filename)
        self.assertIsNotNone(match)
        assert isinstance(match, re.Match)
        return override_flags(match)

    def test_h_and_u_flags_can_be_used_separately_or_together(self) -> None:
        self.assertEqual(self.parse_flags("figure5--detail.pdf"), set())
        self.assertEqual(self.parse_flags("figure5-h--detail.pdf"), {"h"})
        self.assertEqual(self.parse_flags("figure5-u--detail.pdf"), {"u"})
        self.assertEqual(self.parse_flags("figure5-h-u--detail.pdf"), {"h", "u"})
        self.assertEqual(self.parse_flags("figure5-u-h--detail.pdf"), {"h", "u"})

    def test_repeated_flags_are_rejected(self) -> None:
        match = NAME_PATTERN.fullmatch("figure5-u-u--detail.pdf")
        self.assertIsNotNone(match)
        assert match is not None
        with self.assertRaisesRegex(ValueError, "repeats"):
            override_flags(match)


if __name__ == "__main__":
    unittest.main()

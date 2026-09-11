import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('roster', Path(__file__).with_name('read-student-roster.py'))
roster = importlib.util.module_from_spec(spec)
spec.loader.exec_module(roster)

# Workbook lives at the workspace root, three levels above web/scripts.
# Resolve from this file so the test passes regardless of the cwd.
WORKBOOK = Path(__file__).resolve().parents[3] / 'SHRUTI MAAM.xlsx'

class RosterTests(unittest.TestCase):
    def test_every_included_student_and_exclusion_accounted_for(self):
        result = roster.read_roster(WORKBOOK, {'5TH PANSY'})
        self.assertEqual(result['sourceStudentCount'], 514)
        self.assertEqual(len(result['students']), 467)
        self.assertEqual(result['excludedSheets'], {'5TH PANSY': 47})
        self.assertEqual(len(result['classes']), 12)
        self.assertEqual(sum(result['classes'].values()), 467)
        self.assertEqual(len({s['admissionNumber'] for s in result['students']}), 467)
        self.assertEqual(len([s for s in result['students'] if s['admissionNumber'].startswith('0')]), 6)

    def test_conflicting_heading_is_rejected_without_explicit_exclusion(self):
        with self.assertRaisesRegex(ValueError, 'heading'):
            roster.read_roster(WORKBOOK, set())

    def test_unrecognised_exclusion_is_not_silently_ignored(self):
        with self.assertRaisesRegex(ValueError, 'Unknown excluded'):
            roster.read_roster(WORKBOOK, {'TYPO'})

if __name__ == '__main__':
    unittest.main()

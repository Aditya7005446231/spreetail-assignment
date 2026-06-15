import unittest
from datetime import date
from app.importer import parse_date, clean_amount, normalize_name, detect_duplicates

class TestImporter(unittest.TestCase):

    def test_parse_date_standard(self):
        parsed, is_anom, desc = parse_date("01-02-2026")
        self.assertEqual(parsed, date(2026, 2, 1))
        self.assertFalse(is_anom)

    def test_parse_date_inconsistent_format(self):
        parsed, is_anom, desc = parse_date("Mar-14")
        self.assertEqual(parsed, date(2026, 3, 14))
        self.assertTrue(is_anom)
        self.assertIn("Mar-14", desc)

    def test_clean_amount_commas(self):
        amount, anoms = clean_amount('"1,200"')
        self.assertEqual(amount, 1200.0)
        self.assertEqual(len(anoms), 0)

    def test_clean_amount_negative(self):
        amount, anoms = clean_amount("-30")
        self.assertEqual(amount, -30.0)
        self.assertIn("negative_amount", anoms)

    def test_clean_amount_precision(self):
        amount, anoms = clean_amount("899.995")
        self.assertEqual(amount, 899.995)
        self.assertIn("high_precision_amount", anoms)

    def test_normalize_name(self):
        self.assertEqual(normalize_name("priya s"), "Priya")
        self.assertEqual(normalize_name("rohan"), "Rohan")
        self.assertEqual(normalize_name("Aisha"), "Aisha")

    def test_detect_duplicates(self):
        rows = [
            {
                "row_num": 1,
                "parsed_date": date(2026, 2, 8),
                "parsed_amount": 3200.0,
                "paid_by": "Dev",
                "description": "Dinner at Marina Bites",
                "anomalies_detected": []
            },
            {
                "row_num": 2,
                "parsed_date": date(2026, 2, 8),
                "parsed_amount": 3200.0,
                "paid_by": "Dev",
                "description": "dinner - marina bites",
                "anomalies_detected": []
            }
        ]
        flagged = detect_duplicates(rows)
        # The second row should have a duplicate anomaly detected
        self.assertTrue(len(flagged[1]["anomalies_detected"]) > 0)
        self.assertEqual(flagged[1]["anomalies_detected"][0]["type"], "exact_duplicate")

if __name__ == "__main__":
    unittest.main()

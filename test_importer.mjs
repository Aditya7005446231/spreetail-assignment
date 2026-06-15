import assert from 'node:assert';
import { parseDate, cleanAmount, normalizeName, detectDuplicates } from './lib/importer.js';

async function runTests() {
  console.log("🚀 Running CSV Importer Unit Tests...");

  try {
    // 1. Test Date Parsing
    console.log("➡️ Testing date parsing...");
    const date1 = parseDate("01-02-2026");
    assert.strictEqual(date1.dateVal, "2026-02-01");
    assert.strictEqual(date1.isAnomaly, false);

    const date2 = parseDate("Mar-14");
    assert.strictEqual(date2.dateVal, "2026-03-14");
    assert.strictEqual(date2.isAnomaly, true);
    assert.match(date2.desc, /Inconsistent date format/);

    // 2. Test Amount Cleaning
    console.log("➡️ Testing amount cleaning...");
    const amt1 = cleanAmount('"1,200"');
    assert.strictEqual(amt1.amountVal, 1200.0);
    assert.strictEqual(amt1.anomalies.length, 0);

    const amt2 = cleanAmount("-30");
    assert.strictEqual(amt2.amountVal, -30.0);
    assert.deepStrictEqual(amt2.anomalies, ["negative_amount"]);

    const amt3 = cleanAmount("899.995");
    assert.strictEqual(amt3.amountVal, 899.995);
    assert.deepStrictEqual(amt3.anomalies, ["high_precision_amount"]);

    // 3. Test Name Normalization
    console.log("➡️ Testing name normalization...");
    assert.strictEqual(normalizeName("priya s"), "Priya");
    assert.strictEqual(normalizeName("rohan"), "Rohan");
    assert.strictEqual(normalizeName("Aisha"), "Aisha");

    // 4. Test Duplicate Scanning
    console.log("➡️ Testing duplicate scanning...");
    const rows = [
      {
        row_num: 1,
        parsed_date: "2026-02-08",
        parsed_amount: 3200.0,
        paid_by: "Dev",
        description: "Dinner at Marina Bites",
        anomalies_detected: []
      },
      {
        row_num: 2,
        parsed_date: "2026-02-08",
        parsed_amount: 3200.0,
        paid_by: "Dev",
        description: "dinner - marina bites",
        anomalies_detected: []
      }
    ];
    const flagged = detectDuplicates(rows);
    assert.strictEqual(flagged[1].anomalies_detected.length, 1);
    assert.strictEqual(flagged[1].anomalies_detected[0].type, "exact_duplicate");

    console.log("✅ All tests passed successfully!");
  } catch (error) {
    console.error("❌ Test failed:", error.message);
    process.exit(1);
  }
}

runTests();

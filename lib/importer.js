// Standard exchange rate
const EXCHANGE_RATE_USD_TO_INR = 83.0;

// Canonical usernames
const CANONICAL_USERS = ["Aisha", "Rohan", "Priya", "Meera", "Sam", "Dev"];

// Similarity mappings for lowercase or messy entries
const NAME_MAPPING = {
  "aisha": "Aisha",
  "rohan": "Rohan",
  "priya": "Priya",
  "priya s": "Priya",
  "meera": "Meera",
  "sam": "Sam",
  "dev": "Dev",
  "rohan paid aisha back": "Rohan"
};

export function normalizeName(rawName) {
  if (!rawName) return "";
  const cleaned = rawName.trim().toLowerCase();
  return NAME_MAPPING[cleaned] || rawName.trim();
}

/**
 * Splits a CSV row correctly, respecting fields containing commas wrapped in quotes (like "1,200")
 */
export function splitCsvLine(text) {
  const result = [];
  let inQuotes = false;
  let currentField = '';

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '"') {
      inQuotes = !inQuotes; // Toggle quotes mode
    } else if (char === ',' && !inQuotes) {
      result.push(currentField);
      currentField = '';
    } else {
      currentField += char;
    }
  }
  result.push(currentField);
  return result;
}

export function parseDate(dateStr) {
  if (!dateStr) {
    return { dateVal: new Date().toISOString().split('T')[0], isAnomaly: true, desc: "Empty date field" };
  }

  const cleanStr = dateStr.trim();

  // 1. Try DD-MM-YYYY or DD/MM/YYYY or YYYY-MM-DD
  // Match DD-MM-YYYY or YYYY-MM-DD
  const matchDmy = cleanStr.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (matchDmy) {
    const day = parseInt(matchDmy[1], 10);
    const month = parseInt(matchDmy[2], 10);
    const year = parseInt(matchDmy[3], 10);
    
    // Format to ISO string YYYY-MM-DD
    const paddedMonth = month.toString().padStart(2, '0');
    const paddedDay = day.toString().padStart(2, '0');
    return { dateVal: `${year}-${paddedMonth}-${paddedDay}`, isAnomaly: false, desc: "" };
  }

  const matchYmd = cleanStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (matchYmd) {
    return { dateVal: cleanStr, isAnomaly: false, desc: "" };
  }

  // 2. Try Mar-14 format (MMM-DD or DD-MMM)
  const monthMap = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
  };

  const matchMmmDd = cleanStr.match(/^([A-Za-z]{3})[-/](\d{1,2})$/);
  if (matchMmmDd) {
    const monthName = matchMmmDd[1].toLowerCase();
    const day = parseInt(matchMmmDd[2], 10);
    const monthNum = monthMap[monthName];

    if (monthNum) {
      const paddedMonth = monthNum.toString().padStart(2, '0');
      const paddedDay = day.toString().padStart(2, '0');
      return {
        dateVal: `2026-${paddedMonth}-${paddedDay}`,
        isAnomaly: true,
        desc: `Inconsistent date format '${dateStr}', inferred as 2026-${paddedMonth}-${paddedDay}`
      };
    }
  }

  // Fallback
  return {
    dateVal: new Date().toISOString().split('T')[0],
    isAnomaly: true,
    desc: `Failed to parse date format: '${dateStr}'`
  };
}

export function cleanAmount(amountStr) {
  if (!amountStr) {
    return { amountVal: 0.0, anomalies: ["Empty amount field"] };
  }

  const cleaned = amountStr.replace(/"/g, '').replace(/,/g, '').trim();
  const val = parseFloat(cleaned);
  const anomalies = [];

  if (isNaN(val)) {
    return { amountVal: 0.0, anomalies: ["invalid_amount"] };
  }

  if (val < 0) {
    anomalies.push("negative_amount");
  } else if (val === 0) {
    anomalies.push("zero_amount");
  } else if (cleaned.includes('.')) {
    const decimals = cleaned.split('.')[1].length;
    if (decimals > 2) {
      anomalies.push("high_precision_amount");
    }
  }

  return { amountVal: val, anomalies };
}

export function detectDuplicates(rows) {
  for (let i = 0; i < rows.length; i++) {
    const rowI = rows[i];
    const dateI = rowI.parsed_date;
    const amountI = rowI.parsed_amount;
    const payerI = normalizeName(rowI.paid_by);
    const descI = (rowI.description || "").toLowerCase().trim();

    for (let j = i + 1; j < rows.length; j++) {
      const rowJ = rows[j];
      const dateJ = rowJ.parsed_date;
      const amountJ = rowJ.parsed_amount;
      const payerJ = normalizeName(rowJ.paid_by);
      const descJ = (rowJ.description || "").toLowerCase().trim();

      if (dateI === dateJ) {
        // Calculate basic keyword overlap to detect similar descriptions
        const wordsI = new Set(descI.split(/\W+/).filter(w => w.length > 0));
        const wordsJ = new Set(descJ.split(/\W+/).filter(w => w.length > 0));
        
        let intersectCount = 0;
        for (const w of wordsI) {
          if (wordsJ.has(w)) intersectCount++;
        }

        const isSimilarDesc = intersectCount >= 1 || descI.includes(descJ) || descJ.includes(descI);

        if (isSimilarDesc) {
          if (amountI === amountJ && payerI === payerJ) {
            // Exact duplicate
            rowJ.anomalies_detected.push({
              type: "exact_duplicate",
              desc: `Duplicate of row ${i + 1} ('${rowI.description}') on ${dateI}`,
              suggested: "Delete duplicate row"
            });
          } else {
            // Conflicting duplicate
            rowJ.anomalies_detected.push({
              type: "conflicting_duplicate",
              desc: `Conflicting entry with row ${i + 1} ('${rowI.description}'). Row ${i + 1} paid by ${payerI} (Rs.${amountI}), Row ${j + 1} paid by ${payerJ} (Rs.${amountJ})`,
              suggested: "Merge or select one correct entry"
            });
          }
        }
      }
    }
  }
  return rows;
}

export function parseAndValidateCSV(csvContent) {
  const lines = csvContent.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) return { rows: [], total_rows: 0 };

  const header = splitCsvLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const rawCols = splitCsvLine(lines[i]);
    const rowMap = {};
    header.forEach((h, idx) => {
      rowMap[h.trim()] = rawCols[idx] || "";
    });

    const rowNum = i; // 1-based data index (ignoring header)
    const anomalies_detected = [];

    // 1. Date check
    const { dateVal, isAnomaly: dateAnom, desc: dateDesc } = parseDate(rowMap.date);
    if (dateAnom) {
      anomalies_detected.push({
        type: "date_format_inconsistency",
        desc: dateDesc,
        suggested: "Format to standard YYYY-MM-DD"
      });
    }

    if (rowMap.date === "04-05-2026") {
      anomalies_detected.push({
        type: "date_ambiguity",
        desc: "Date '04-05-2026' is ambiguous (May 4th or April 5th). Spreadsheet notes ask: 'is this April 5 or May 4?'",
        suggested: "Keep as May 4th (DD-MM-YYYY matches Rent patterns) or override to April 5th"
      });
    }

    // 2. Amount Check
    const { amountVal, anomalies: amtAnoms } = cleanAmount(rowMap.amount);
    amtAnoms.forEach(anom => {
      if (anom === "negative_amount") {
        anomalies_detected.push({
          type: "negative_amount",
          desc: `Negative amount detected: ${rowMap.amount} (indicates a refund)`,
          suggested: "Treat as refund split (reduces total expense)"
        });
      } else if (anom === "zero_amount") {
        anomalies_detected.push({
          type: "zero_amount",
          desc: "Expense amount is 0",
          suggested: "Ignore/Skip importing this row"
        });
      } else if (anom === "high_precision_amount") {
        anomalies_detected.push({
          type: "high_precision_amount",
          desc: `Amount ${rowMap.amount} contains too many decimal places (fractional paisa)`,
          suggested: `Round to 2 decimal places: ${Number(amountVal).toFixed(2)}`
        });
      } else if (anom === "invalid_amount") {
        anomalies_detected.push({
          type: "invalid_amount",
          desc: `Invalid non-numeric amount: '${rowMap.amount}'`,
          suggested: "Request correct amount from user"
        });
      }
    });

    // 3. Currency Check
    let curr = (rowMap.currency || "").trim();
    let convertedAmountInr = amountVal;
    if (!curr) {
      curr = "INR";
      anomalies_detected.push({
        type: "missing_currency",
        desc: "Currency field is missing, defaulting to INR",
        suggested: "Default to INR"
      });
    } else if (curr === "USD") {
      convertedAmountInr = amountVal * EXCHANGE_RATE_USD_TO_INR;
      anomalies_detected.push({
        type: "currency_usd",
        desc: `Currency is in USD ($ ${amountVal}). Auto-converting to INR using exchange rate 1 USD = 83.0 INR`,
        suggested: `Convert to Rs. ${Number(convertedAmountInr).toFixed(2)} (1 USD = 83 INR)`
      });
    }

    // 4. Payer Check
    const payerRaw = rowMap.paid_by;
    const payerNorm = normalizeName(payerRaw);

    if (!payerRaw) {
      anomalies_detected.push({
        type: "missing_payer",
        desc: "Payer is missing/empty",
        suggested: "Assign a default payer or request input"
      });
    } else if (!CANONICAL_USERS.includes(payerNorm)) {
      anomalies_detected.push({
        type: "unknown_payer",
        desc: `Payer '${payerRaw}' is not a standard flatmate`,
        suggested: "Map to canonical user or add as guest user"
      });
    } else if (payerRaw !== payerNorm) {
      anomalies_detected.push({
        type: "name_inconsistency",
        desc: `Payer name '${payerRaw}' normalized to '${payerNorm}'`,
        suggested: `Auto-map '${payerRaw}' -> '${payerNorm}'`
      });
    }

    // 5. Split lists and Settlements check
    const splitType = (rowMap.split_type || "").trim().toLowerCase();
    const splitWithRaw = rowMap.split_with || "";
    const splitDetailsRaw = rowMap.split_details || "";
    const notes = rowMap.notes || "";

    const descLower = (rowMap.description || "").toLowerCase();
    const isSettlement = (descLower.includes("paid") && (descLower.includes("back") || descLower.includes("to"))) || !splitType;
    let isSettlementFlag = false;

    if (isSettlement || notes.toLowerCase().includes("settlement")) {
      anomalies_detected.push({
        type: "settlement_logged_as_expense",
        desc: "This transaction looks like a debt settlement payment between flatmates, not an expense",
        suggested: "Import as a Settlement rather than an Expense"
      });
      isSettlementFlag = true;
    }

    // Parse split users
    const splitUsersRaw = splitWithRaw.split(";").map(u => u.trim()).filter(u => u.length > 0);
    const splitUsers = splitUsersRaw.map(u => normalizeName(u));

    // Guest checking
    splitUsers.forEach((uNorm, index) => {
      if (!CANONICAL_USERS.includes(uNorm)) {
        anomalies_detected.push({
          type: "non_member_split",
          desc: `Split list contains guest/non-group member: '${splitUsersRaw[index]}'`,
          suggested: "Exempt guest or add guest to user database"
        });
      }
    });

    // Timeline validation
    const parsedDateObj = new Date(dateVal);
    const dateMeeraLeft = new Date("2026-03-31");
    const dateSamJoined = new Date("2026-04-15");

    splitUsers.forEach(userN => {
      if (userN === "Meera" && parsedDateObj > dateMeeraLeft) {
        anomalies_detected.push({
          type: "inactive_member_split",
          desc: `Meera is in the split list on ${dateVal}, but she officially moved out at the end of March`,
          suggested: "Exclude Meera from this split calculation"
        });
      } else if (userN === "Sam" && parsedDateObj < dateSamJoined) {
        if (!descLower.includes("deposit")) {
          anomalies_detected.push({
            type: "inactive_member_split",
            desc: `Sam is in the split list on ${dateVal}, which is before his move-in date (April 15th)`,
            suggested: "Exclude Sam from this split calculation"
          });
        }
      }
    });

    // Split details
    if (splitType === "percentage") {
      // Parse details like "Aisha 30%; Rohan 30%"
      const allPcts = [...splitDetailsRaw.matchAll(/(\w+)\s+(\d+)%/g)];
      const totalPct = allPcts.reduce((sum, m) => sum + parseInt(m[2], 10), 0);
      if (totalPct !== 100 && totalPct > 0) {
        anomalies_detected.push({
          type: "percentage_sum_mismatch",
          desc: `Split details percentages sum to ${totalPct}% instead of 100%`,
          suggested: "Normalize percentages to equal 100% proportionally"
        });
      }
    } else if (splitType === "equal" && splitDetailsRaw) {
      anomalies_detected.push({
        type: "split_type_detail_mismatch",
        desc: "Split type is 'equal', but specific split details/ratios were provided",
        suggested: "Ignore details and split equally, or change split type to 'share'"
      });
    }

    rows.push({
      row_num: rowNum,
      raw: rowMap,
      parsed_date: dateVal,
      parsed_amount: amountVal,
      parsed_currency: curr,
      converted_amount_inr: convertedAmountInr,
      parsed_payer: payerNorm,
      split_type: splitType,
      split_users: splitUsers,
      is_settlement: isSettlementFlag,
      anomalies_detected
    });
  }

  // Duplicate scanning
  const processedRows = detectDuplicates(rows);

  return {
    rows: processedRows,
    total_rows: processedRows.length
  };
}

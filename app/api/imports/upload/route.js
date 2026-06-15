import { getDB } from '@/lib/db';
import { parseAndValidateCSV } from '@/lib/importer';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return Response.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const csvText = await file.text();
    const db = await getDB();

    // 1. Clear old data for a clean import
    await db.run('DELETE FROM expense_splits');
    await db.run('DELETE FROM expenses');
    await db.run('DELETE FROM settlements');
    await db.run('DELETE FROM csv_anomalies');

    // 2. Parse and scan CSV
    const parsedReport = parseAndValidateCSV(csvText);

    // 3. Stage Anomalies
    for (const r of parsedReport.rows) {
      for (const anom of r.anomalies_detected) {
        await db.run(
          `INSERT INTO csv_anomalies (
            row_number, anomaly_type, description, suggested_resolution, status,
            date_raw, description_raw, paid_by_raw, amount_raw, currency_raw,
            split_type_raw, split_with_raw, split_details_raw, notes_raw
          ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            r.row_num, anom.type, anom.desc, anom.suggested,
            r.raw.date, r.raw.description, r.raw.paid_by, r.raw.amount, r.raw.currency,
            r.raw.split_type, r.raw.split_with, r.raw.split_details, r.raw.notes
          ]
        );
      }
    }

    // Fetch canonical user mapping to map names to user IDs
    const users = await db.all('SELECT id, username FROM users');
    const userMap = {};
    users.forEach(u => {
      userMap[u.username.toLowerCase()] = u.id;
    });

    // 4. Stage Transactions
    for (const r of parsedReport.rows) {
      const hasAnoms = r.anomalies_detected.length > 0;

      if (r.is_settlement) {
        // Resolve Payer & Payee
        const payerId = userMap[r.parsed_payer.toLowerCase()] || null;
        
        // Split with lists payee name
        const payeeName = r.split_users[0] || 'Aisha';
        const payeeId = userMap[payeeName.toLowerCase()] || null;

        await db.run(
          `INSERT INTO settlements (group_id, payer_id, payee_id, amount, currency, settlement_date, is_approved, original_row_index) 
           VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
          [
            payerId, payeeId, r.parsed_amount, r.parsed_currency || 'INR', r.parsed_date,
            hasAnoms ? 0 : 1, r.row_num
          ]
        );
      } else {
        // Resolve Paid By
        const payerId = r.parsed_payer ? (userMap[r.parsed_payer.toLowerCase()] || null) : null;
        const amountVal = r.converted_amount_inr;

        const expenseResult = await db.run(
          `INSERT INTO expenses (group_id, paid_by_id, amount, currency, description, expense_date, split_type, notes, is_verified, original_row_index) 
           VALUES (1, ?, ?, 'INR', ?, ?, ?, ?, ?, ?)`,
          [
            payerId, amountVal, r.raw.description, r.parsed_date, r.split_type, r.raw.notes,
            hasAnoms ? 0 : 1, r.row_num
          ]
        );
        const expenseId = expenseResult.lastID;

        // Resolve split users
        let usersOwed = r.split_users.map(name => ({
          id: userMap[name.toLowerCase()] || null,
          username: name
        })).filter(u => u.id !== null);

        // Fallback: split among active members at that date if list is empty
        if (usersOwed.length === 0) {
          const activeMembs = await db.all(`
            SELECT gm.user_id as id, u.username 
            FROM group_memberships gm
            JOIN users u ON gm.user_id = u.id
            WHERE gm.group_id = 1 AND gm.joined_at <= ? AND (gm.left_at IS NULL OR gm.left_at >= ?)
          `, [r.parsed_date, r.parsed_date]);
          usersOwed = activeMembs;
        }

        const numUsers = usersOwed.length > 0 ? usersOwed.length : 1;

        for (const userO of usersOwed) {
          let owedAmt = 0.0;

          if (r.split_type === 'equal') {
            owedAmt = amountVal / numUsers;
          } else if (r.split_type === 'percentage') {
            // regex matches like "Aisha 30%"
            const splitDetails = r.raw.split_details || '';
            const regex = new RegExp(`${userO.username}\\s+(\\d+)%`, 'i');
            const match = splitDetails.match(regex);
            if (match) {
              const pct = parseFloat(match[1]);
              owedAmt = (amountVal * pct) / 100.0;
            } else {
              owedAmt = amountVal / numUsers; // fallback
            }
          } else if (r.split_type === 'share') {
            // regex matches like "Rohan 2"
            const splitDetails = r.raw.split_details || '';
            const regex = new RegExp(`${userO.username}\\s+(\\d+)`, 'i');
            const match = splitDetails.match(regex);
            
            // Calculate total shares
            const allShares = [...splitDetails.matchAll(/(\w+)\s+(\d+)/g)];
            const totalShares = allShares.reduce((sum, m) => sum + parseInt(m[2], 10), 0);

            if (match && totalShares > 0) {
              const userShare = parseFloat(match[1]);
              owedAmt = (amountVal * userShare) / totalShares;
            } else {
              owedAmt = amountVal / numUsers; // fallback
            }
          } else {
            owedAmt = amountVal / numUsers;
          }

          await db.run(
            `INSERT INTO expense_splits (expense_id, user_id, amount_owed) VALUES (?, ?, ?)`,
            [expenseId, userO.id, parseFloat(owedAmt.toFixed(2))]
          );
        }
      }
    }

    // Fetch anomalies back to return in report
    const stagedAnomalies = await db.all("SELECT * FROM csv_anomalies WHERE status = 'pending' ORDER BY row_number");

    return Response.json({
      total_rows: parsedReport.total_rows,
      imported_rows: parsedReport.total_rows,
      anomalies_found: stagedAnomalies.length,
      anomalies: stagedAnomalies
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

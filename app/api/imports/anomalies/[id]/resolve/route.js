import { getDB } from '@/lib/db';

export async function POST(request, { params }) {
  try {
    const anomalyId = parseInt(params.id);
    const body = await request.json();
    const action = body.action;

    const db = await getDB();
    const anomaly = await db.get('SELECT * FROM csv_anomalies WHERE id = ?', [anomalyId]);
    if (!anomaly) {
      return Response.json({ error: 'Anomaly not found' }, { status: 404 });
    }

    const rowNum = anomaly.row_number;

    // Retrieve corresponding staged expense and settlement
    const stagedExpense = await db.get('SELECT * FROM expenses WHERE original_row_index = ?', [rowNum]);
    const stagedSettlement = await db.get('SELECT * FROM settlements WHERE original_row_index = ?', [rowNum]);

    if (!stagedExpense && !stagedSettlement) {
      return Response.json({ error: `Staged transaction not found for CSV row ${rowNum}` }, { status: 404 });
    }

    let resolvedActionStr = '';

    if (anomaly.anomaly_type === 'exact_duplicate' || anomaly.anomaly_type === 'conflicting_duplicate') {
      if (action === 'delete') {
        if (stagedExpense) {
          await db.run('DELETE FROM expense_splits WHERE expense_id = ?', [stagedExpense.id]);
          await db.run('DELETE FROM expenses WHERE id = ?', [stagedExpense.id]);
        }
        if (stagedSettlement) {
          await db.run('DELETE FROM settlements WHERE id = ?', [stagedSettlement.id]);
        }
        resolvedActionStr = 'Deleted duplicate entry';
      } else if (action === 'keep') {
        if (stagedExpense) {
          await db.run('UPDATE expenses SET is_verified = 1 WHERE id = ?', [stagedExpense.id]);
        }
        if (stagedSettlement) {
          await db.run('UPDATE settlements SET is_approved = 1 WHERE id = ?', [stagedSettlement.id]);
        }
        resolvedActionStr = 'Approved duplicate entry';
      }
    } else if (anomaly.anomaly_type === 'missing_payer') {
      const uId = body.user_id;
      if (stagedExpense && uId) {
        await db.run('UPDATE expenses SET paid_by_id = ?, is_verified = 1 WHERE id = ?', [uId, stagedExpense.id]);
        resolvedActionStr = `Set payer to User ID ${uId}`;
      }
    } else if (anomaly.anomaly_type === 'settlement_logged_as_expense') {
      if (stagedSettlement) {
        await db.run('UPDATE settlements SET is_approved = 1 WHERE id = ?', [stagedSettlement.id]);
        resolvedActionStr = 'Approved importing as a Settlement record';
      }
    } else if (anomaly.anomaly_type === 'inactive_member_split') {
      const userToExclude = body.exclude_username;
      if (stagedExpense) {
        if (userToExclude) {
          const uObj = await db.get('SELECT id FROM users WHERE username = ?', [userToExclude]);
          if (uObj) {
            // Remove split
            await db.run('DELETE FROM expense_splits WHERE expense_id = ? AND user_id = ?', [stagedExpense.id, uObj.id]);
            
            // Recalculate remaining splits equally
            const remainingSplits = await db.all('SELECT * FROM expense_splits WHERE expense_id = ?', [stagedExpense.id]);
            if (remainingSplits.length > 0) {
              const newShare = stagedExpense.amount / remainingSplits.length;
              for (const rs of remainingSplits) {
                await db.run('UPDATE expense_splits SET amount_owed = ? WHERE id = ?', [parseFloat(newShare.toFixed(2)), rs.id]);
              }
            }
            await db.run('UPDATE expenses SET is_verified = 1 WHERE id = ?', [stagedExpense.id]);
            resolvedActionStr = `Excluded ${userToExclude} from split and re-divided amount`;
          }
        } else {
          // Force split anyway
          await db.run('UPDATE expenses SET is_verified = 1 WHERE id = ?', [stagedExpense.id]);
          resolvedActionStr = 'Approved splitting with inactive member';
        }
      }
    } else if (anomaly.anomaly_type === 'percentage_sum_mismatch') {
      if (stagedExpense) {
        const splits = await db.all('SELECT * FROM expense_splits WHERE expense_id = ?', [stagedExpense.id]);
        const totalStageOwed = splits.reduce((acc, s) => acc + s.amount_owed, 0);
        if (totalStageOwed > 0) {
          for (const s of splits) {
            const normalizedOwed = (s.amount_owed / totalStageOwed) * stagedExpense.amount;
            await db.run('UPDATE expense_splits SET amount_owed = ? WHERE id = ?', [parseFloat(normalizedOwed.toFixed(2)), s.id]);
          }
        }
        await db.run('UPDATE expenses SET is_verified = 1 WHERE id = ?', [stagedExpense.id]);
        resolvedActionStr = 'Normalized splits proportionally to sum to 100%';
      }
    } else if (anomaly.anomaly_type === 'split_type_detail_mismatch') {
      if (stagedExpense) {
        await db.run('UPDATE expenses SET is_verified = 1 WHERE id = ?', [stagedExpense.id]);
        resolvedActionStr = 'Accepted split details (imported as share split)';
      }
    } else {
      // General approval fallback
      if (stagedExpense) {
        await db.run('UPDATE expenses SET is_verified = 1 WHERE id = ?', [stagedExpense.id]);
      }
      if (stagedSettlement) {
        await db.run('UPDATE settlements SET is_approved = 1 WHERE id = ?', [stagedSettlement.id]);
      }
      resolvedActionStr = `Approved anomaly type: ${anomaly.anomaly_type}`;
    }

    // Update anomaly status
    await db.run(
      "UPDATE csv_anomalies SET status = 'resolved', resolved_action = ? WHERE id = ?",
      [resolvedActionStr, anomalyId]
    );

    return Response.json({ status: 'success', message: `Anomaly resolved: ${resolvedActionStr}` });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

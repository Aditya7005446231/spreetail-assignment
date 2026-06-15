import { getDB } from '@/lib/db';

export async function GET(request, { params }) {
  try {
    const userId = parseInt(params.id);
    const { searchParams } = new URL(request.url);
    const groupId = parseInt(searchParams.get('group_id') || '1');

    const db = await getDB();

    // Verify user exists
    const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    const trail = [];

    // 1. Fetch expenses paid by this user
    const paidExpenses = await db.all(
      'SELECT * FROM expenses WHERE group_id = ? AND paid_by_id = ? AND is_verified = 1',
      [groupId, userId]
    );

    for (const exp of paidExpenses) {
      // Get split list names
      const splits = await db.all(
        'SELECT u.username FROM expense_splits es JOIN users u ON es.user_id = u.id WHERE es.expense_id = ?',
        [exp.id]
      );
      const membersStr = splits.map(s => s.username).join('; ');

      trail.push({
        expense_id: exp.id,
        date: exp.expense_date,
        type: 'expense_payment',
        description: `Paid for '${exp.description}'`,
        original_amount: exp.amount,
        original_currency: exp.currency,
        converted_amount: exp.amount, // stored in INR
        details: `Payer: You. Split list: ${membersStr}`
      });
    }

    // 2. Fetch splits owed by this user
    const userSplits = await db.all(
      `SELECT es.*, e.amount as exp_amount, e.currency as exp_currency, e.description, e.expense_date, e.split_type, e.paid_by_id
       FROM expense_splits es 
       JOIN expenses e ON es.expense_id = e.id 
       WHERE e.group_id = ? AND es.user_id = ? AND e.is_verified = 1`,
      [groupId, userId]
    );

    for (const split of userSplits) {
      const payer = await db.get('SELECT username FROM users WHERE id = ?', [split.paid_by_id]);
      const payerName = payer ? payer.username : 'Unknown Payer';

      let ratioDesc = '';
      if (split.split_type === 'percentage') {
        ratioDesc = ` (${split.percentage}%)`;
      } else if (split.split_type === 'share') {
        ratioDesc = ` (${split.share} shares)`;
      }

      trail.push({
        expense_id: split.expense_id,
        date: split.expense_date,
        type: 'expense_share',
        description: `Share of '${split.description}'`,
        original_amount: split.amount_owed,
        original_currency: split.exp_currency,
        converted_amount: split.amount_owed,
        share_ratio: `${split.split_type}${ratioDesc}`,
        details: `Paid by: ${payerName}. Total amount: ${split.exp_currency} ${split.exp_amount}.`
      });
    }

    // 3. Settlements sent by this user
    const sentSettlements = await db.all(
      `SELECT s.*, u.username as payee_name 
       FROM settlements s 
       JOIN users u ON s.payee_id = u.id 
       WHERE s.group_id = ? AND s.payer_id = ? AND s.is_approved = 1`,
      [groupId, userId]
    );

    for (const setl of sentSettlements) {
      trail.push({
        settlement_id: setl.id,
        date: setl.settlement_date,
        type: 'settlement_sent',
        description: `Paid back ${setl.payee_name} (Settlement)`,
        original_amount: setl.amount,
        original_currency: setl.currency,
        converted_amount: setl.amount,
        details: `You directly paid ${setl.payee_name} to settle debt.`
      });
    }

    // 4. Settlements received by this user
    const recSettlements = await db.all(
      `SELECT s.*, u.username as payer_name 
       FROM settlements s 
       JOIN users u ON s.payer_id = u.id 
       WHERE s.group_id = ? AND s.payee_id = ? AND s.is_approved = 1`,
      [groupId, userId]
    );

    for (const setl of recSettlements) {
      trail.push({
        settlement_id: setl.id,
        date: setl.settlement_date,
        type: 'settlement_received',
        description: `Received payment from ${setl.payer_name} (Settlement)`,
        original_amount: setl.amount,
        original_currency: setl.currency,
        converted_amount: setl.amount,
        details: `${setl.payer_name} paid you directly to settle debt.`
      });
    }

    // Sort chronologically by date, then sort by type to order payments first on identical dates
    trail.sort((a, b) => {
      if (a.date !== b.date) {
        return a.date.localeCompare(b.date);
      }
      return a.type.localeCompare(b.type);
    });

    return Response.json(trail);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

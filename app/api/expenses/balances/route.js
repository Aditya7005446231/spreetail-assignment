import { getDB } from '@/lib/db';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const groupId = parseInt(searchParams.get('group_id') || '1');

    const db = await getDB();

    // 1. Fetch group members
    const memberships = await db.all(
      'SELECT gm.user_id, u.username FROM group_memberships gm JOIN users u ON gm.user_id = u.id WHERE gm.group_id = ?',
      [groupId]
    );

    let users = memberships;
    // Fallback: if no memberships staged, fetch all users
    if (users.length === 0) {
      users = await db.all('SELECT id as user_id, username FROM users');
    }

    // Initialize balance sheets
    const balances = {};
    users.forEach(u => {
      balances[u.user_id] = {
        user_id: u.user_id,
        username: u.username,
        paid: 0.0,
        share: 0.0,
        settlements_sent: 0.0,
        settlements_received: 0.0
      };
    });

    // 2. Sum up verified expenses paid by each user
    const expenses = await db.all(
      'SELECT * FROM expenses WHERE group_id = ? AND is_verified = 1',
      [groupId]
    );

    for (const exp of expenses) {
      if (balances[exp.paid_by_id]) {
        balances[exp.paid_by_id].paid += exp.amount;
      }

      // Sum up split shares owed by each user
      const splits = await db.all('SELECT * FROM expense_splits WHERE expense_id = ?', [exp.id]);
      for (const split of splits) {
        if (balances[split.user_id]) {
          balances[split.user_id].share += split.amount_owed;
        }
      }
    }

    // 3. Sum up approved settlements
    const settlements = await db.all(
      'SELECT * FROM settlements WHERE group_id = ? AND is_approved = 1',
      [groupId]
    );

    for (const setl of settlements) {
      if (balances[setl.payer_id]) {
        balances[setl.payer_id].settlements_sent += setl.amount;
      }
      if (balances[setl.payee_id]) {
        balances[setl.payee_id].settlements_received += setl.amount;
      }
    }

    // 4. Construct final summary
    const result = Object.values(balances).map(data => {
      const net = (data.paid + data.settlements_sent) - (data.share + data.settlements_received);
      return {
        user_id: data.user_id,
        username: data.username,
        paid_amount: parseFloat(data.paid.toFixed(2)),
        share_amount: parseFloat(data.share.toFixed(2)),
        net_balance: parseFloat(net.toFixed(2))
      };
    });

    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

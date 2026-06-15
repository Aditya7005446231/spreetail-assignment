import { getDB } from '@/lib/db';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const groupId = parseInt(searchParams.get('group_id') || '1');
    const verifiedOnly = searchParams.get('verified_only') !== 'false';

    const db = await getDB();
    
    let query = 'SELECT * FROM expenses WHERE group_id = ?';
    if (verifiedOnly) {
      query += ' AND is_verified = 1';
    }
    query += ' ORDER BY expense_date DESC';

    const expenses = await db.all(query, [groupId]);

    // Hydrate paid_by and splits
    for (const exp of expenses) {
      exp.paid_by = await db.get('SELECT id, username FROM users WHERE id = ?', [exp.paid_by_id]);
      
      const splits = await db.all('SELECT * FROM expense_splits WHERE expense_id = ?', [exp.id]);
      for (const s of splits) {
        s.user = await db.get('SELECT id, username FROM users WHERE id = ?', [s.user_id]);
      }
      exp.splits = splits;
    }

    return Response.json(expenses);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { amount, currency, description, expense_date, split_type, paid_by_id, splits, notes } = body;

    if (!amount || !description || !expense_date || !split_type || !paid_by_id) {
      return Response.json({ error: 'Missing required expense fields' }, { status: 400 });
    }

    const db = await getDB();

    // Insert expense details
    const result = await db.run(
      `INSERT INTO expenses (group_id, paid_by_id, amount, currency, description, expense_date, split_type, notes, is_verified) 
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [paid_by_id, amount, currency || 'INR', description, expense_date, split_type, notes || '']
    );

    const expenseId = result.lastID;

    // Insert individual splits
    for (const split of splits) {
      await db.run(
        `INSERT INTO expense_splits (expense_id, user_id, amount_owed) VALUES (?, ?, ?)`,
        [expenseId, split.user_id, split.amount_owed]
      );
    }

    // Return created expense hydrated
    const expense = await db.get('SELECT * FROM expenses WHERE id = ?', [expenseId]);
    expense.paid_by = await db.get('SELECT id, username FROM users WHERE id = ?', [paid_by_id]);
    
    const createdSplits = await db.all('SELECT * FROM expense_splits WHERE expense_id = ?', [expenseId]);
    for (const s of createdSplits) {
      s.user = await db.get('SELECT id, username FROM users WHERE id = ?', [s.user_id]);
    }
    expense.splits = createdSplits;

    return Response.json(expense);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

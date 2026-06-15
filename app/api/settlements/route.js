import { getDB } from '@/lib/db';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const groupId = parseInt(searchParams.get('group_id') || '1');

    const db = await getDB();
    const settlements = await db.all(
      'SELECT * FROM settlements WHERE group_id = ? ORDER BY settlement_date DESC',
      [groupId]
    );

    // Hydrate relations
    for (const s of settlements) {
      s.payer = await db.get('SELECT id, username FROM users WHERE id = ?', [s.payer_id]);
      s.payee = await db.get('SELECT id, username FROM users WHERE id = ?', [s.payee_id]);
    }

    return Response.json(settlements);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { group_id, payer_id, payee_id, amount, currency, settlement_date, is_approved } = body;

    if (!group_id || !payer_id || !payee_id || amount === undefined || !settlement_date) {
      return Response.json({ error: 'Missing required settlement fields' }, { status: 400 });
    }

    const db = await getDB();

    const result = await db.run(
      `INSERT INTO settlements (group_id, payer_id, payee_id, amount, currency, settlement_date, is_approved) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [group_id, payer_id, payee_id, amount, currency || 'INR', settlement_date, is_approved !== undefined ? (is_approved ? 1 : 0) : 1]
    );

    const settlement = await db.get('SELECT * FROM settlements WHERE id = ?', [result.lastID]);
    settlement.payer = await db.get('SELECT id, username FROM users WHERE id = ?', [payer_id]);
    settlement.payee = await db.get('SELECT id, username FROM users WHERE id = ?', [payee_id]);

    return Response.json(settlement);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

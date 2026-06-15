import { getDB } from '@/lib/db';

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const groupId = parseInt(id);
    const body = await request.json();
    const { user_id, joined_at, left_at } = body;

    if (!user_id || !joined_at) {
      return Response.json({ error: 'user_id and joined_at are required' }, { status: 400 });
    }

    const db = await getDB();

    // Verify group and user exist
    const group = await db.get('SELECT * FROM groups WHERE id = ?', [groupId]);
    const user = await db.get('SELECT * FROM users WHERE id = ?', [user_id]);
    if (!group || !user) {
      return Response.json({ error: 'Group or User not found' }, { status: 404 });
    }

    // Check if membership already exists
    const existing = await db.get(
      'SELECT * FROM group_memberships WHERE group_id = ? AND user_id = ?',
      [groupId, user_id]
    );

    if (existing) {
      // Update dates
      await db.run(
        'UPDATE group_memberships SET joined_at = ?, left_at = ? WHERE id = ?',
        [joined_at, left_at, existing.id]
      );
      const updated = await db.get('SELECT * FROM group_memberships WHERE id = ?', [existing.id]);
      updated.user = user;
      return Response.json(updated);
    }

    // Insert new membership
    const result = await db.run(
      'INSERT INTO group_memberships (group_id, user_id, joined_at, left_at) VALUES (?, ?, ?, ?)',
      [groupId, user_id, joined_at, left_at]
    );
    const membership = await db.get('SELECT * FROM group_memberships WHERE id = ?', [result.lastID]);
    membership.user = user;
    return Response.json(membership);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

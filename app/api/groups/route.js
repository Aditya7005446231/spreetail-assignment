import { getDB } from '@/lib/db';

export async function GET(request) {
  try {
    const db = await getDB();
    const groups = await db.all('SELECT * FROM groups');
    
    // Fetch memberships and username details for each group
    for (const g of groups) {
      const memberships = await db.all(`
        SELECT gm.*, u.id as user_id, u.username, u.email 
        FROM group_memberships gm
        JOIN users u ON gm.user_id = u.id
        WHERE gm.group_id = ?
      `, [g.id]);
      
      // Map to nested format matching previous router schema
      g.memberships = memberships.map(m => ({
        id: m.id,
        group_id: m.group_id,
        user_id: m.user_id,
        joined_at: m.joined_at,
        left_at: m.left_at,
        user: {
          id: m.user_id,
          username: m.username,
          email: m.email
        }
      }));
    }
    
    return Response.json(groups);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    if (!body.name) {
      return Response.json({ error: 'Group name is required' }, { status: 400 });
    }

    const db = await getDB();
    const result = await db.run('INSERT INTO groups (name) VALUES (?)', [body.name]);
    const group = await db.get('SELECT * FROM groups WHERE id = ?', [result.lastID]);
    group.memberships = [];
    return Response.json(group);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

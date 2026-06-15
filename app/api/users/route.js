import { getDB } from '@/lib/db';

export async function GET(request) {
  try {
    const db = await getDB();
    const users = await db.all('SELECT * FROM users');
    return Response.json(users);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    if (!body.username) {
      return Response.json({ error: 'Username is required' }, { status: 400 });
    }

    const db = await getDB();
    const existing = await db.get('SELECT * FROM users WHERE username = ?', [body.username]);
    if (existing) {
      return Response.json({ error: 'Username already exists' }, { status: 400 });
    }

    const result = await db.run('INSERT INTO users (username) VALUES (?)', [body.username]);
    const user = await db.get('SELECT * FROM users WHERE id = ?', [result.lastID]);
    return Response.json(user);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

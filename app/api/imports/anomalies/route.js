import { getDB } from '@/lib/db';

export async function GET(request) {
  try {
    const db = await getDB();
    const anomalies = await db.all(
      "SELECT * FROM csv_anomalies WHERE status = 'pending' ORDER BY row_number"
    );
    return Response.json(anomalies);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

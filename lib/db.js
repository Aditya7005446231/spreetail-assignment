import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';

import fs from 'fs';

// Cache the database connection.
// Next.js hot-reloading opens new connections, so caching on the global object is a best practice.
let cachedDb = null;

export async function getDB() {
  if (cachedDb) {
    return cachedDb;
  }

  // Define database path in the root of the workspace
  let dbPath = path.join(process.cwd(), 'shared_expenses.db');

  // Vercel serverless environment compatibility
  if (process.env.VERCEL || process.env.NOW_BUILDER) {
    const tempDbPath = path.join('/tmp', 'shared_expenses.db');
    try {
      // If the database does not exist in /tmp, copy it from the workspace root (which has the seeded schema)
      if (!fs.existsSync(tempDbPath)) {
        if (fs.existsSync(dbPath)) {
          fs.copyFileSync(dbPath, tempDbPath);
        }
      }
      dbPath = tempDbPath;
    } catch (err) {
      console.error("Vercel Temp DB setup failed, falling back to root path:", err);
    }
  }

  // Open sqlite connection using the Promise-based wrapper
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  // Enable foreign key constraints
  await db.run('PRAGMA foreign_keys = ON;');

  // Initialize schemas & seeds
  await initDB(db);

  cachedDb = db;
  return db;
}

async function initDB(db) {
  // 1. Create Users Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT,
      password_hash TEXT
    );
  `);

  // 2. Create Groups Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 3. Create Group Memberships Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS group_memberships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      joined_at TEXT NOT NULL,
      left_at TEXT,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 4. Create Expenses Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      paid_by_id INTEGER,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      description TEXT NOT NULL,
      expense_date TEXT NOT NULL,
      split_type TEXT NOT NULL,
      notes TEXT,
      is_verified INTEGER DEFAULT 1,
      original_row_index INTEGER,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (paid_by_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  // 5. Create Splits Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS expense_splits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      amount_owed REAL NOT NULL,
      percentage REAL,
      share REAL,
      FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 6. Create Settlements Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      payer_id INTEGER NOT NULL,
      payee_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      settlement_date TEXT NOT NULL,
      is_approved INTEGER DEFAULT 1,
      original_row_index INTEGER,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (payer_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (payee_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 7. Create Anomalies Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS csv_anomalies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      row_number INTEGER NOT NULL,
      anomaly_type TEXT NOT NULL,
      description TEXT NOT NULL,
      suggested_resolution TEXT,
      status TEXT DEFAULT 'pending',
      resolved_action TEXT,
      date_raw TEXT,
      description_raw TEXT,
      paid_by_raw TEXT,
      amount_raw TEXT,
      currency_raw TEXT,
      split_type_raw TEXT,
      split_with_raw TEXT,
      split_details_raw TEXT,
      notes_raw TEXT
    );
  `);

  // 8. Seeding canonical flatmates & groups if they are empty
  const userCheck = await db.get('SELECT COUNT(*) as count FROM users');
  if (userCheck.count === 0) {
    // Seed Group 1 (Flatmates)
    await db.run("INSERT INTO groups (id, name) VALUES (1, 'Flatmates')");

    const usersData = [
      { name: "Aisha", joined: "2026-02-01", left: null },
      { name: "Rohan", joined: "2026-02-01", left: null },
      { name: "Priya", joined: "2026-02-01", left: null },
      { name: "Meera", joined: "2026-02-01", left: "2026-03-31" }, // Meera left end of March
      { name: "Sam", joined: "2026-04-15", left: null },         // Sam moved in mid-April
      { name: "Dev", joined: "2026-03-08", left: "2026-03-15" }  // Dev visited for Goa trip
    ];

    for (const u of usersData) {
      // Insert User
      await db.run("INSERT INTO users (username) VALUES (?)", [u.name]);
      const dbUser = await db.get("SELECT id FROM users WHERE username = ?", [u.name]);
      
      // Insert Timeline Membership
      await db.run(
        "INSERT INTO group_memberships (group_id, user_id, joined_at, left_at) VALUES (1, ?, ?, ?)",
        [dbUser.id, u.joined, u.left]
      );
    }

    // Dev's friend Kabir (Guest, not in group)
    await db.run("INSERT INTO users (username) VALUES ('Dev\'s friend Kabir')");
    
    console.log("Database initialized and group timeline seeded.");
  }
}

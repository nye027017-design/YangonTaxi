// D1 queries — Step 2: users only (rounds/bets/transactions are added in Step 3)

export async function getSetting(db, key, fallback = null) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?1").bind(key).first();
  return row ? row.value : fallback;
}

const USER_COLUMNS = "id, google_id, email, name, avatar, balance, role, created_at";

export async function getUserById(db, id) {
  return db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?1`).bind(id).first();
}

// Google နဲ့ login ဝင်တိုင်း ခေါ်မယ်။ user အသစ်ဆိုရင် demo balance နဲ့ ဖန်တီးပေးမယ်၊ ရှိပြီးသားဆိုရင် name/avatar ကိုပဲ update လုပ်မယ်။
export async function upsertGoogleUser(db, { googleId, email, name, avatar }, isAdmin) {
  const startBalance = Number(await getSetting(db, "start_balance", "10000")) || 10000;

  await db
    .prepare(
      `INSERT INTO users (google_id, email, name, avatar, balance, role)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(google_id) DO UPDATE SET
         email  = excluded.email,
         name   = excluded.name,
         avatar = excluded.avatar,
         role   = CASE WHEN ?7 = 1 THEN 'admin' ELSE users.role END`
    )
    .bind(googleId, email, name || null, avatar || null, startBalance, isAdmin ? "admin" : "user", isAdmin ? 1 : 0)
    .run();

  return db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE google_id = ?1`).bind(googleId).first();
}

export function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, avatar: u.avatar, balance: u.balance, role: u.role };
}

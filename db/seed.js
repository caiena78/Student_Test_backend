require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./index');

async function seed() {
  const hash = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD, 10);
  try {
    await db.execute(
      `INSERT IGNORE INTO users (username, email, password_hash, role, first_name, last_name)
       VALUES (?, ?, ?, 'admin', 'Admin', 'User')`,
      ['admin', 'admin@school.local', hash]
    );
    console.log('Seed complete: admin/password created');
  } catch (e) {
    console.error('Seed failed:', e.message);
  } finally {
    process.exit(0);
  }
}

seed();

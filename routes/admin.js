const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');

// GET /api/admin/users — list all users, optional ?role= filter
router.get('/users', async (req, res) => {
  try {
    const { role } = req.query;
    let sql = 'SELECT id, username, email, role, first_name, last_name, is_active, created_at FROM users';
    const params = [];
    if (role) {
      sql += ' WHERE role = ?';
      params.push(role);
    }
    sql += ' ORDER BY created_at DESC';
    const [rows] = await db.execute(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Admin list users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/users — create a new user
router.post('/users', async (req, res) => {
  try {
    const { username, email, password, role, first_name, last_name } = req.body;
    if (!username || !password || !role) {
      return res.status(400).json({ error: 'username, password, and role are required' });
    }
    const validRoles = ['admin', 'teacher', 'student'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'role must be admin, teacher, or student' });
    }
    const password_hash = await bcrypt.hash(password, 10);
    const [result] = await db.execute(
      `INSERT INTO users (username, email, password_hash, role, first_name, last_name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [username, email || null, password_hash, role, first_name || null, last_name || null]
    );
    const [rows] = await db.execute(
      'SELECT id, username, email, role, first_name, last_name, is_active, created_at FROM users WHERE id = ?',
      [result.insertId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Username or email already exists' });
    }
    console.error('Admin create user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/users/:id — update a user
router.put('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { first_name, last_name, email, is_active, password, role } = req.body;

    // Check user exists
    const [existing] = await db.execute('SELECT id FROM users WHERE id = ?', [id]);
    if (!existing.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updates = [];
    const params = [];

    if (first_name !== undefined) { updates.push('first_name = ?'); params.push(first_name); }
    if (last_name !== undefined) { updates.push('last_name = ?'); params.push(last_name); }
    if (email !== undefined) { updates.push('email = ?'); params.push(email); }
    if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }
    if (role !== undefined) {
      const validRoles = ['admin', 'teacher', 'student'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: 'role must be admin, teacher, or student' });
      }
      updates.push('role = ?');
      params.push(role);
    }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      updates.push('password_hash = ?');
      params.push(hash);
    }

    if (!updates.length) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(id);
    await db.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

    const [rows] = await db.execute(
      'SELECT id, username, email, role, first_name, last_name, is_active, created_at FROM users WHERE id = ?',
      [id]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Email already exists' });
    }
    console.error('Admin update user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/users/:id — soft delete (set is_active=0)
router.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [existing] = await db.execute('SELECT id FROM users WHERE id = ?', [id]);
    if (!existing.length) {
      return res.status(404).json({ error: 'User not found' });
    }
    await db.execute('UPDATE users SET is_active = 0 WHERE id = ?', [id]);
    res.json({ message: 'User deactivated successfully' });
  } catch (err) {
    console.error('Admin delete user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

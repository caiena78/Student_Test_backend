const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');

// ─── GROUPS ─────────────────────────────────────────────────────────────────

// GET /api/teacher/groups — list groups (all for admin, own for teacher)
router.get('/groups', async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    let sql = `SELECT g.id, g.name, g.created_at, g.teacher_id,
                      COUNT(gs.student_id) AS student_count,
                      u.first_name AS teacher_first_name, u.last_name AS teacher_last_name
               FROM \`groups\` g
               LEFT JOIN group_students gs ON gs.group_id = g.id
               LEFT JOIN users u ON u.id = g.teacher_id`;
    const params = [];
    if (!isAdmin) {
      sql += ' WHERE g.teacher_id = ?';
      params.push(req.user.id);
    }
    sql += ' GROUP BY g.id ORDER BY g.created_at DESC';
    const [rows] = await db.execute(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('List groups error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/teacher/groups — create group
router.post('/groups', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Group name is required' });
    }
    const teacherId = req.user.id;
    const [result] = await db.execute(
      'INSERT INTO `groups` (name, teacher_id) VALUES (?, ?)',
      [name.trim(), teacherId]
    );
    const [rows] = await db.execute('SELECT * FROM `groups` WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create group error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/teacher/groups/:id — rename group (must own it)
router.put('/groups/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Group name is required' });
    }
    const [existing] = await db.execute('SELECT * FROM `groups` WHERE id = ?', [id]);
    if (!existing.length) {
      return res.status(404).json({ error: 'Group not found' });
    }
    if (existing[0].teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: you do not own this group' });
    }
    await db.execute('UPDATE `groups` SET name = ? WHERE id = ?', [name.trim(), id]);
    const [rows] = await db.execute('SELECT * FROM `groups` WHERE id = ?', [id]);
    res.json(rows[0]);
  } catch (err) {
    console.error('Update group error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/teacher/groups/:id — delete group (must own it)
router.delete('/groups/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [existing] = await db.execute('SELECT * FROM `groups` WHERE id = ?', [id]);
    if (!existing.length) {
      return res.status(404).json({ error: 'Group not found' });
    }
    if (existing[0].teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: you do not own this group' });
    }
    await db.execute('DELETE FROM `groups` WHERE id = ?', [id]);
    res.json({ message: 'Group deleted successfully' });
  } catch (err) {
    console.error('Delete group error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/teacher/groups/:id/students — list students in group
router.get('/groups/:id/students', async (req, res) => {
  try {
    const { id } = req.params;
    const [group] = await db.execute('SELECT * FROM `groups` WHERE id = ?', [id]);
    if (!group.length) {
      return res.status(404).json({ error: 'Group not found' });
    }
    if (group[0].teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: you do not own this group' });
    }
    const [rows] = await db.execute(
      `SELECT u.id, u.username, u.email, u.first_name, u.last_name, u.is_active
       FROM users u
       JOIN group_students gs ON gs.student_id = u.id
       WHERE gs.group_id = ?
       ORDER BY u.last_name, u.first_name`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    console.error('List group students error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/teacher/groups/:id/students — add student to group
router.post('/groups/:id/students', async (req, res) => {
  try {
    const { id } = req.params;
    const { student_id } = req.body;
    if (!student_id) {
      return res.status(400).json({ error: 'student_id is required' });
    }
    const [group] = await db.execute('SELECT * FROM `groups` WHERE id = ?', [id]);
    if (!group.length) {
      return res.status(404).json({ error: 'Group not found' });
    }
    if (group[0].teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: you do not own this group' });
    }
    // Verify student exists and has student role
    const [student] = await db.execute(
      "SELECT id FROM users WHERE id = ? AND role = 'student' AND is_active = 1",
      [student_id]
    );
    if (!student.length) {
      return res.status(404).json({ error: 'Student not found' });
    }
    await db.execute(
      'INSERT IGNORE INTO group_students (group_id, student_id) VALUES (?, ?)',
      [id, student_id]
    );
    res.status(201).json({ message: 'Student added to group' });
  } catch (err) {
    console.error('Add student to group error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/teacher/groups/:id/students/:studentId — remove student from group
router.delete('/groups/:id/students/:studentId', async (req, res) => {
  try {
    const { id, studentId } = req.params;
    const [group] = await db.execute('SELECT * FROM `groups` WHERE id = ?', [id]);
    if (!group.length) {
      return res.status(404).json({ error: 'Group not found' });
    }
    if (group[0].teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: you do not own this group' });
    }
    await db.execute(
      'DELETE FROM group_students WHERE group_id = ? AND student_id = ?',
      [id, studentId]
    );
    res.json({ message: 'Student removed from group' });
  } catch (err) {
    console.error('Remove student from group error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── STUDENTS ────────────────────────────────────────────────────────────────

// GET /api/teacher/students — list all students (for assignment purposes)
router.get('/students', async (req, res) => {
  const { search } = req.query;
  const buildSql = (extended) => {
    let sql = extended
      ? `SELECT id, username, email, first_name, last_name, is_active, created_at, created_by, force_password_change FROM users WHERE role = 'student'`
      : `SELECT id, username, email, first_name, last_name, is_active, created_at FROM users WHERE role = 'student'`;
    const params = [];
    if (search) {
      sql += ' AND (username LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }
    sql += ' ORDER BY last_name, first_name';
    return { sql, params };
  };

  try {
    const { sql, params } = buildSql(true);
    const [rows] = await db.execute(sql, params);
    res.json(rows);
  } catch (err) {
    if (err.code === 'ER_BAD_FIELD_ERROR') {
      try {
        const { sql, params } = buildSql(false);
        const [rows] = await db.execute(sql, params);
        return res.json(rows.map(r => ({ ...r, created_by: null, force_password_change: 0 })));
      } catch (e2) {
        console.error('List students fallback error:', e2);
      }
    }
    console.error('List students error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/teacher/students — teacher creates a student account
router.post('/students', async (req, res) => {
  try {
    const { username, email, password, first_name, last_name } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }
    const password_hash = await bcrypt.hash(password, 10);

    let result;
    try {
      [result] = await db.execute(
        `INSERT INTO users (username, email, password_hash, role, first_name, last_name, created_by)
         VALUES (?, ?, ?, 'student', ?, ?, ?)`,
        [username, email || null, password_hash, first_name || null, last_name || null, req.user.id]
      );
    } catch (insertErr) {
      if (insertErr.code === 'ER_BAD_FIELD_ERROR') {
        // created_by column not yet migrated — fall back to insert without it
        [result] = await db.execute(
          `INSERT INTO users (username, email, password_hash, role, first_name, last_name)
           VALUES (?, ?, ?, 'student', ?, ?)`,
          [username, email || null, password_hash, first_name || null, last_name || null]
        );
      } else {
        throw insertErr;
      }
    }

    const [rows] = await db.execute(
      'SELECT id, username, email, role, first_name, last_name, is_active, created_at FROM users WHERE id = ?',
      [result.insertId]
    );
    res.status(201).json({ ...rows[0], created_by: req.user.id, force_password_change: 0 });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Username or email already exists' });
    }
    console.error('Create student error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/teacher/students/:id/groups — groups a student belongs to
router.get('/students/:id/groups', async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT g.id, g.name, g.teacher_id FROM group_students gs
       JOIN \`groups\` g ON g.id = gs.group_id
       WHERE gs.student_id = ?`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Get student groups error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/teacher/students/:id — edit student profile (must own: created_by = req.user.id OR admin)
router.put('/students/:id', async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM users WHERE id = ? AND role = ?', [req.params.id, 'student']);
    if (!rows.length) return res.status(404).json({ error: 'Student not found' });
    const student = rows[0];
    if (req.user.role !== 'admin' && student.created_by !== req.user.id)
      return res.status(403).json({ error: 'You can only edit students you created' });

    const { first_name, last_name, email, username } = req.body;
    const updates = [], params = [];
    if (first_name !== undefined) { updates.push('first_name = ?'); params.push(first_name); }
    if (last_name  !== undefined) { updates.push('last_name = ?');  params.push(last_name); }
    if (email      !== undefined) { updates.push('email = ?');      params.push(email); }
    if (username   !== undefined) { updates.push('username = ?');   params.push(username); }
    if (!updates.length) return res.status(400).json({ error: 'No fields to update' });

    params.push(req.params.id);
    await db.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
    const [updated] = await db.execute(
      'SELECT id, username, email, role, first_name, last_name, created_by, force_password_change FROM users WHERE id = ?',
      [req.params.id]
    );
    res.json(updated[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Username or email already exists' });
    }
    console.error('Update student error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/teacher/students/:id/password — reset student password (must own OR admin)
router.put('/students/:id/password', async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM users WHERE id = ? AND role = ?', [req.params.id, 'student']);
    if (!rows.length) return res.status(404).json({ error: 'Student not found' });
    const student = rows[0];
    if (req.user.role !== 'admin' && student.created_by !== req.user.id)
      return res.status(403).json({ error: 'You can only reset passwords for students you created' });

    const { new_password, force_password_change } = req.body;
    if (!new_password || new_password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const hash = await bcrypt.hash(new_password, 10);
    try {
      await db.execute(
        'UPDATE users SET password_hash = ?, force_password_change = ? WHERE id = ?',
        [hash, force_password_change ? 1 : 0, req.params.id]
      );
    } catch (updateErr) {
      if (updateErr.code === 'ER_BAD_FIELD_ERROR') {
        // force_password_change column not yet migrated — just update password
        await db.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.params.id]);
      } else {
        throw updateErr;
      }
    }
    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error('Reset student password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

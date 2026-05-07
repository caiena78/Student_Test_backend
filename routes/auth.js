const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    const [rows] = await db.execute(
      'SELECT * FROM users WHERE username = ? AND is_active = 1',
      [username]
    );
    if (!rows.length) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        first_name: user.first_name,
        last_name: user.last_name,
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        first_name: user.first_name,
        last_name: user.last_name,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/me', authenticate, async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT id, username, email, role, first_name, last_name, force_password_change FROM users WHERE id = ?',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    // Graceful fallback if force_password_change column not yet migrated
    if (err.code === 'ER_BAD_FIELD_ERROR') {
      try {
        const [rows] = await db.execute(
          'SELECT id, username, email, role, first_name, last_name FROM users WHERE id = ?',
          [req.user.id]
        );
        if (!rows.length) return res.status(404).json({ error: 'User not found' });
        return res.json({ ...rows[0], force_password_change: 0 });
      } catch (e2) {
        console.error('Get me fallback error:', e2);
      }
    }
    console.error('Get me error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/change-password — authenticated student changes their own password
router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!new_password || new_password.length < 6)
      return res.status(400).json({ error: 'New password must be at least 6 characters' });

    const [rows] = await db.execute('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    const user = rows[0];

    // If force_password_change is NOT set, verify current password
    if (!user.force_password_change) {
      if (!current_password) return res.status(400).json({ error: 'Current password required' });
      const match = await bcrypt.compare(current_password, user.password_hash);
      if (!match) return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hash = await bcrypt.hash(new_password, 10);
    await db.execute(
      'UPDATE users SET password_hash = ?, force_password_change = 0 WHERE id = ?',
      [hash, req.user.id]
    );
    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

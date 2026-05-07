const router = require('express').Router();
const db = require('../db');

// ─── TESTS CRUD ──────────────────────────────────────────────────────────────

// GET / — list tests (all for admin, own for teacher)
router.get('/', async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    let sql = `SELECT t.id, t.title, t.title_image, t.status, t.time_limit_minutes,
                      t.attempts_allowed, t.created_at, t.updated_at, t.teacher_id,
                      COUNT(q.id) AS question_count,
                      u.first_name AS teacher_first_name, u.last_name AS teacher_last_name
               FROM tests t
               LEFT JOIN questions q ON q.test_id = t.id
               LEFT JOIN users u ON u.id = t.teacher_id`;
    const params = [];
    if (!isAdmin) {
      sql += ' WHERE t.teacher_id = ?';
      params.push(req.user.id);
    }
    sql += ' GROUP BY t.id ORDER BY t.created_at DESC';
    const [rows] = await db.execute(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('List tests error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST / — create test
router.post('/', async (req, res) => {
  try {
    const {
      title,
      title_image,
      time_limit_minutes,
      attempts_allowed,
      shuffle_questions,
      shuffle_answers,
      show_grade_on_completion,
      show_correct_answers,
      allow_back_navigation,
    } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    const teacherId = (req.user.role === 'admin' && req.body.teacher_id) ? req.body.teacher_id : req.user.id;
    const [result] = await db.execute(
      `INSERT INTO tests
         (teacher_id, title, title_image, time_limit_minutes, attempts_allowed,
          shuffle_questions, shuffle_answers, show_grade_on_completion,
          show_correct_answers, allow_back_navigation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        teacherId,
        title.trim(),
        title_image || null,
        time_limit_minutes !== undefined ? time_limit_minutes : null,
        attempts_allowed !== undefined ? attempts_allowed : 1,
        shuffle_questions !== undefined ? (shuffle_questions ? 1 : 0) : 1,
        shuffle_answers !== undefined ? (shuffle_answers ? 1 : 0) : 1,
        show_grade_on_completion !== undefined ? (show_grade_on_completion ? 1 : 0) : 1,
        show_correct_answers !== undefined ? (show_correct_answers ? 1 : 0) : 0,
        allow_back_navigation !== undefined ? (allow_back_navigation ? 1 : 0) : 1,
      ]
    );
    const [rows] = await db.execute('SELECT * FROM tests WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create test error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /:id — get full test with questions, options, drag_drop_items
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [tests] = await db.execute('SELECT * FROM tests WHERE id = ?', [id]);
    if (!tests.length) {
      return res.status(404).json({ error: 'Test not found' });
    }
    const test = tests[0];
    if (test.teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const [questions] = await db.execute(
      'SELECT * FROM questions WHERE test_id = ? ORDER BY order_index ASC',
      [id]
    );
    const [options] = await db.execute(
      `SELECT qo.* FROM question_options qo
       JOIN questions q ON q.id = qo.question_id
       WHERE q.test_id = ?
       ORDER BY qo.order_index ASC`,
      [id]
    );
    const [dragItems] = await db.execute(
      `SELECT ddi.* FROM drag_drop_items ddi
       JOIN questions q ON q.id = ddi.question_id
       WHERE q.test_id = ?
       ORDER BY ddi.correct_position ASC`,
      [id]
    );

    // Map options and drag_drop_items onto their questions
    const questionsWithDetails = questions.map((q) => ({
      ...q,
      config: q.config || null,
      options: options.filter((o) => o.question_id === q.id),
      drag_drop_items: dragItems.filter((d) => d.question_id === q.id),
    }));

    res.json({ ...test, questions: questionsWithDetails });
  } catch (err) {
    console.error('Get test error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /:id — update test settings
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [tests] = await db.execute('SELECT * FROM tests WHERE id = ?', [id]);
    if (!tests.length) return res.status(404).json({ error: 'Test not found' });
    if (tests[0].teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const allowed = [
      'title', 'title_image', 'time_limit_minutes', 'attempts_allowed',
      'shuffle_questions', 'shuffle_answers', 'show_grade_on_completion',
      'show_correct_answers', 'allow_back_navigation',
    ];
    const updates = [];
    const params = [];
    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        const val = req.body[field];
        // Coerce booleans for tinyint fields
        const boolFields = ['shuffle_questions','shuffle_answers','show_grade_on_completion','show_correct_answers','allow_back_navigation'];
        params.push(boolFields.includes(field) ? (val ? 1 : 0) : val);
      }
    }
    if (!updates.length) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    params.push(id);
    await db.execute(`UPDATE tests SET ${updates.join(', ')} WHERE id = ?`, params);
    const [rows] = await db.execute('SELECT * FROM tests WHERE id = ?', [id]);
    res.json(rows[0]);
  } catch (err) {
    console.error('Update test error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /:id — delete test
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [tests] = await db.execute('SELECT * FROM tests WHERE id = ?', [id]);
    if (!tests.length) return res.status(404).json({ error: 'Test not found' });
    if (tests[0].teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await db.execute('DELETE FROM tests WHERE id = ?', [id]);
    res.json({ message: 'Test deleted successfully' });
  } catch (err) {
    console.error('Delete test error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /:id/publish
router.put('/:id/publish', async (req, res) => {
  try {
    const { id } = req.params;
    const [tests] = await db.execute('SELECT * FROM tests WHERE id = ?', [id]);
    if (!tests.length) return res.status(404).json({ error: 'Test not found' });
    if (tests[0].teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await db.execute("UPDATE tests SET status = 'published' WHERE id = ?", [id]);
    res.json({ message: 'Test published', status: 'published' });
  } catch (err) {
    console.error('Publish test error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /:id/unpublish
router.put('/:id/unpublish', async (req, res) => {
  try {
    const { id } = req.params;
    const [tests] = await db.execute('SELECT * FROM tests WHERE id = ?', [id]);
    if (!tests.length) return res.status(404).json({ error: 'Test not found' });
    if (tests[0].teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await db.execute("UPDATE tests SET status = 'draft' WHERE id = ?", [id]);
    res.json({ message: 'Test unpublished', status: 'draft' });
  } catch (err) {
    console.error('Unpublish test error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── QUESTIONS ───────────────────────────────────────────────────────────────

// POST /:testId/questions — add question
router.post('/:testId/questions', async (req, res) => {
  try {
    const { testId } = req.params;
    const [tests] = await db.execute('SELECT * FROM tests WHERE id = ?', [testId]);
    if (!tests.length) return res.status(404).json({ error: 'Test not found' });
    if (tests[0].teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const {
      type, prompt, prompt_image, points, order_index, config,
      options = [], drag_drop_items = [],
    } = req.body;

    if (!type || !prompt) {
      return res.status(400).json({ error: 'type and prompt are required' });
    }
    const validTypes = ['multiple_choice', 'free_text', 'drag_drop', 'true_false'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: 'Invalid question type' });
    }

    const [qResult] = await db.execute(
      `INSERT INTO questions (test_id, type, prompt, prompt_image, points, order_index, config)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        testId, type, prompt, prompt_image || null,
        points !== undefined ? points : 1,
        order_index !== undefined ? order_index : 0,
        config ? JSON.stringify(config) : null,
      ]
    );
    const questionId = qResult.insertId;

    // Insert options for multiple_choice
    if (type === 'multiple_choice' && options.length) {
      for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        await db.execute(
          `INSERT INTO question_options (question_id, text, image, is_correct, order_index)
           VALUES (?, ?, ?, ?, ?)`,
          [questionId, opt.text || null, opt.image || null, opt.is_correct ? 1 : 0, opt.order_index !== undefined ? opt.order_index : i]
        );
      }
    }

    // Insert drag_drop_items
    if (type === 'drag_drop' && drag_drop_items.length) {
      for (let i = 0; i < drag_drop_items.length; i++) {
        const item = drag_drop_items[i];
        await db.execute(
          `INSERT INTO drag_drop_items (question_id, item_text, item_image, correct_position, category)
           VALUES (?, ?, ?, ?, ?)`,
          [questionId, item.item_text || null, item.item_image || null, item.correct_position !== undefined ? item.correct_position : i, item.category || null]
        );
      }
    }

    // Return full question with options and items
    const [qRows] = await db.execute('SELECT * FROM questions WHERE id = ?', [questionId]);
    const [optRows] = await db.execute('SELECT * FROM question_options WHERE question_id = ? ORDER BY order_index', [questionId]);
    const [ddRows] = await db.execute('SELECT * FROM drag_drop_items WHERE question_id = ? ORDER BY correct_position', [questionId]);

    res.status(201).json({ ...qRows[0], options: optRows, drag_drop_items: ddRows });
  } catch (err) {
    console.error('Add question error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /questions/:id — update question
router.put('/questions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [questions] = await db.execute(
      'SELECT q.*, t.teacher_id FROM questions q JOIN tests t ON t.id = q.test_id WHERE q.id = ?',
      [id]
    );
    if (!questions.length) return res.status(404).json({ error: 'Question not found' });
    if (questions[0].teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { prompt, prompt_image, points, order_index, config, options, drag_drop_items } = req.body;
    const updates = [];
    const params = [];
    if (prompt !== undefined) { updates.push('prompt = ?'); params.push(prompt); }
    if (prompt_image !== undefined) { updates.push('prompt_image = ?'); params.push(prompt_image); }
    if (points !== undefined) { updates.push('points = ?'); params.push(points); }
    if (order_index !== undefined) { updates.push('order_index = ?'); params.push(order_index); }
    if (config !== undefined) { updates.push('config = ?'); params.push(JSON.stringify(config)); }

    if (updates.length) {
      params.push(id);
      await db.execute(`UPDATE questions SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    // Replace options if provided
    if (options !== undefined && questions[0].type === 'multiple_choice') {
      await db.execute('DELETE FROM question_options WHERE question_id = ?', [id]);
      for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        await db.execute(
          `INSERT INTO question_options (question_id, text, image, is_correct, order_index)
           VALUES (?, ?, ?, ?, ?)`,
          [id, opt.text || null, opt.image || null, opt.is_correct ? 1 : 0, opt.order_index !== undefined ? opt.order_index : i]
        );
      }
    }

    // Replace drag_drop_items if provided
    if (drag_drop_items !== undefined && questions[0].type === 'drag_drop') {
      await db.execute('DELETE FROM drag_drop_items WHERE question_id = ?', [id]);
      for (let i = 0; i < drag_drop_items.length; i++) {
        const item = drag_drop_items[i];
        await db.execute(
          `INSERT INTO drag_drop_items (question_id, item_text, item_image, correct_position, category)
           VALUES (?, ?, ?, ?, ?)`,
          [id, item.item_text || null, item.item_image || null, item.correct_position !== undefined ? item.correct_position : i, item.category || null]
        );
      }
    }

    const [qRows] = await db.execute('SELECT * FROM questions WHERE id = ?', [id]);
    const [optRows] = await db.execute('SELECT * FROM question_options WHERE question_id = ? ORDER BY order_index', [id]);
    const [ddRows] = await db.execute('SELECT * FROM drag_drop_items WHERE question_id = ? ORDER BY correct_position', [id]);
    res.json({ ...qRows[0], options: optRows, drag_drop_items: ddRows });
  } catch (err) {
    console.error('Update question error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /questions/:id — delete question
router.delete('/questions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [questions] = await db.execute(
      'SELECT q.*, t.teacher_id FROM questions q JOIN tests t ON t.id = q.test_id WHERE q.id = ?',
      [id]
    );
    if (!questions.length) return res.status(404).json({ error: 'Question not found' });
    if (questions[0].teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await db.execute('DELETE FROM questions WHERE id = ?', [id]);
    res.json({ message: 'Question deleted successfully' });
  } catch (err) {
    console.error('Delete question error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /questions/:id/reorder — update order_index
router.put('/questions/:id/reorder', async (req, res) => {
  try {
    const { id } = req.params;
    const { order_index } = req.body;
    if (order_index === undefined) {
      return res.status(400).json({ error: 'order_index is required' });
    }
    const [questions] = await db.execute(
      'SELECT q.*, t.teacher_id FROM questions q JOIN tests t ON t.id = q.test_id WHERE q.id = ?',
      [id]
    );
    if (!questions.length) return res.status(404).json({ error: 'Question not found' });
    if (questions[0].teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await db.execute('UPDATE questions SET order_index = ? WHERE id = ?', [order_index, id]);
    res.json({ message: 'Question reordered', order_index });
  } catch (err) {
    console.error('Reorder question error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── ASSIGNMENTS ─────────────────────────────────────────────────────────────

// POST /:id/assign — assign test to group(s) and/or individual students
router.post('/:id/assign', async (req, res) => {
  try {
    const { id } = req.params;
    const [tests] = await db.execute('SELECT * FROM tests WHERE id = ?', [id]);
    if (!tests.length) return res.status(404).json({ error: 'Test not found' });
    if (tests[0].teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { group_id, student_ids, due_date } = req.body;
    const created = [];

    if (group_id) {
      const [result] = await db.execute(
        'INSERT INTO test_assignments (test_id, group_id, due_date) VALUES (?, ?, ?)',
        [id, group_id, due_date || null]
      );
      created.push({ id: result.insertId, type: 'group', group_id });
    }

    if (student_ids && Array.isArray(student_ids)) {
      for (const sid of student_ids) {
        const [result] = await db.execute(
          'INSERT INTO test_assignments (test_id, student_id, due_date) VALUES (?, ?, ?)',
          [id, sid, due_date || null]
        );
        created.push({ id: result.insertId, type: 'student', student_id: sid });
      }
    }

    if (!created.length) {
      return res.status(400).json({ error: 'Provide group_id or student_ids' });
    }

    res.status(201).json({ message: 'Assigned successfully', assignments: created });
  } catch (err) {
    console.error('Assign test error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /:id/assignments — list current assignments for a test
router.get('/:id/assignments', async (req, res) => {
  try {
    const { id } = req.params;
    const [tests] = await db.execute('SELECT * FROM tests WHERE id = ?', [id]);
    if (!tests.length) return res.status(404).json({ error: 'Test not found' });
    if (tests[0].teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const [rows] = await db.execute(
      `SELECT ta.id, ta.test_id, ta.group_id, ta.student_id, ta.assigned_at, ta.due_date,
              g.name AS group_name,
              u.username AS student_username,
              u.first_name AS student_first_name,
              u.last_name AS student_last_name
       FROM test_assignments ta
       LEFT JOIN \`groups\` g ON g.id = ta.group_id
       LEFT JOIN users u ON u.id = ta.student_id
       WHERE ta.test_id = ?
       ORDER BY ta.assigned_at DESC`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    console.error('List assignments error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /assignments/:id — remove an assignment
router.delete('/assignments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [assignments] = await db.execute(
      `SELECT ta.*, t.teacher_id FROM test_assignments ta
       JOIN tests t ON t.id = ta.test_id WHERE ta.id = ?`,
      [id]
    );
    if (!assignments.length) return res.status(404).json({ error: 'Assignment not found' });
    if (assignments[0].teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await db.execute('DELETE FROM test_assignments WHERE id = ?', [id]);
    res.json({ message: 'Assignment removed' });
  } catch (err) {
    console.error('Delete assignment error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── RESULTS ─────────────────────────────────────────────────────────────────

// GET /:id/results — list all attempts for a test
router.get('/:id/results', async (req, res) => {
  try {
    const { id } = req.params;
    const [tests] = await db.execute('SELECT * FROM tests WHERE id = ?', [id]);
    if (!tests.length) return res.status(404).json({ error: 'Test not found' });
    if (tests[0].teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const [rows] = await db.execute(
      `SELECT a.id, a.student_id, a.started_at, a.submitted_at,
              a.score, a.max_score, a.status, a.overall_feedback,
              u.username, u.first_name, u.last_name,
              (SELECT COUNT(*) FROM attempt_answers aa
               WHERE aa.attempt_id = a.id AND aa.is_graded = 0) AS ungraded_count
       FROM attempts a
       JOIN users u ON u.id = a.student_id
       WHERE a.test_id = ?
       ORDER BY a.submitted_at DESC`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Get results error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /:id/overview — per-student assignment overview (correct / incorrect / not answered)
router.get('/:id/overview', async (req, res) => {
  try {
    const { id } = req.params;
    const [tests] = await db.execute('SELECT * FROM tests WHERE id = ?', [id]);
    if (!tests.length) return res.status(404).json({ error: 'Test not found' });
    if (tests[0].teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Total question count for this test
    const [[{ total_questions }]] = await db.execute(
      'SELECT COUNT(*) AS total_questions FROM questions WHERE test_id = ?', [id]
    );

    // All students assigned (directly or via group), deduplicated
    const [students] = await db.execute(
      `SELECT DISTINCT u.id, u.username, u.first_name, u.last_name
       FROM test_assignments ta
       LEFT JOIN group_students gs ON gs.group_id = ta.group_id
       JOIN users u ON u.id = COALESCE(ta.student_id, gs.student_id)
       WHERE ta.test_id = ? AND u.role = 'student' AND u.is_active = 1
       ORDER BY u.last_name, u.first_name`,
      [id]
    );

    const result = [];

    for (const student of students) {
      // Latest attempt for this student on this test
      const [attempts] = await db.execute(
        `SELECT * FROM attempts WHERE test_id = ? AND student_id = ?
         ORDER BY started_at DESC LIMIT 1`,
        [id, student.id]
      );
      const attempt = attempts[0] || null;

      let correct = 0, incorrect = 0, not_answered = 0;

      if (attempt && (attempt.status === 'submitted' || attempt.status === 'graded')) {
        const [answers] = await db.execute(
          `SELECT aa.answer_data, aa.auto_score, aa.manual_score, q.points
           FROM attempt_answers aa
           JOIN questions q ON q.id = aa.question_id
           WHERE aa.attempt_id = ?`,
          [attempt.id]
        );

        const answeredCount = answers.length;

        for (const ans of answers) {
          const data = ans.answer_data
            ? (typeof ans.answer_data === 'string' ? JSON.parse(ans.answer_data) : ans.answer_data)
            : null;

          const hasAnswer = data && (
            (data.selected_ids && data.selected_ids.length > 0) ||
            (data.text && String(data.text).trim().length > 0) ||
            (data.order && data.order.length > 0)
          );

          if (!hasAnswer) {
            not_answered++;
          } else {
            const score = ans.manual_score !== null
              ? Number(ans.manual_score)
              : (ans.auto_score !== null ? Number(ans.auto_score) : null);
            if (score !== null && score >= Number(ans.points)) {
              correct++;
            } else {
              incorrect++;
            }
          }
        }

        // Questions that have no answer row at all
        not_answered += (Number(total_questions) - answeredCount);

      } else {
        not_answered = Number(total_questions);
      }

      result.push({
        student_id: student.id,
        username: student.username,
        first_name: student.first_name,
        last_name: student.last_name,
        status: attempt ? attempt.status : 'not_started',
        attempt_id: attempt ? attempt.id : null,
        score: attempt ? attempt.score : null,
        max_score: attempt ? attempt.max_score : null,
        submitted_at: attempt ? attempt.submitted_at : null,
        started_at: attempt ? attempt.started_at : null,
        correct_count: correct,
        incorrect_count: incorrect,
        not_answered_count: not_answered,
        total_questions: Number(total_questions),
      });
    }

    res.json(result);
  } catch (err) {
    console.error('Overview error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /attempts/:attemptId — get full attempt detail
router.get('/attempts/:attemptId', async (req, res) => {
  try {
    const { attemptId } = req.params;
    const [attempts] = await db.execute(
      `SELECT a.*, t.teacher_id, t.title AS test_title,
              u.first_name AS student_first_name, u.last_name AS student_last_name, u.username AS student_username
       FROM attempts a
       JOIN tests t ON t.id = a.test_id
       JOIN users u ON u.id = a.student_id
       WHERE a.id = ?`,
      [attemptId]
    );
    if (!attempts.length) return res.status(404).json({ error: 'Attempt not found' });
    if (attempts[0].teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const attempt = attempts[0];

    // Get questions in the order the student saw them
    const rawOrder = attempt.question_order;
    const questionOrder = rawOrder
      ? (typeof rawOrder === 'string' ? JSON.parse(rawOrder) : rawOrder)
      : [];

    const [questions] = await db.execute(
      'SELECT * FROM questions WHERE test_id = ? ORDER BY order_index',
      [attempt.test_id]
    );
    const [options] = await db.execute(
      `SELECT qo.* FROM question_options qo
       JOIN questions q ON q.id = qo.question_id
       WHERE q.test_id = ?`,
      [attempt.test_id]
    );
    const [ddItems] = await db.execute(
      `SELECT ddi.* FROM drag_drop_items ddi
       JOIN questions q ON q.id = ddi.question_id
       WHERE q.test_id = ?`,
      [attempt.test_id]
    );
    const [answers] = await db.execute(
      'SELECT * FROM attempt_answers WHERE attempt_id = ?',
      [attemptId]
    );

    const questionsMap = {};
    for (const q of questions) {
      questionsMap[q.id] = {
        ...q,
        options: options.filter((o) => o.question_id === q.id),
        drag_drop_items: ddItems.filter((d) => d.question_id === q.id),
        answer: answers.find((a) => a.question_id === q.id) || null,
      };
    }

    // Sort questions by the order the student saw them (if question_order is stored)
    let orderedQuestions;
    if (questionOrder.length) {
      orderedQuestions = questionOrder.map((qid) => questionsMap[qid]).filter(Boolean);
    } else {
      orderedQuestions = questions.map((q) => questionsMap[q.id]);
    }

    res.json({ ...attempt, questions: orderedQuestions });
  } catch (err) {
    console.error('Get attempt detail error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /attempts/:attemptId/grade — teacher grades an attempt
router.put('/attempts/:attemptId/grade', async (req, res) => {
  try {
    const { attemptId } = req.params;
    const [attempts] = await db.execute(
      `SELECT a.*, t.teacher_id FROM attempts a JOIN tests t ON t.id = a.test_id WHERE a.id = ?`,
      [attemptId]
    );
    if (!attempts.length) return res.status(404).json({ error: 'Attempt not found' });
    if (attempts[0].teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { answers = [], overall_feedback, status } = req.body;

    // Update each answer's manual score and feedback
    for (const ans of answers) {
      const { id: answerId, manual_score, feedback } = ans;
      await db.execute(
        'UPDATE attempt_answers SET manual_score = ?, feedback = ?, is_graded = 1 WHERE id = ? AND attempt_id = ?',
        [manual_score !== undefined ? manual_score : null, feedback || null, answerId, attemptId]
      );
    }

    // Recalculate total score: use manual_score if set, else auto_score
    const [allAnswers] = await db.execute(
      'SELECT auto_score, manual_score FROM attempt_answers WHERE attempt_id = ?',
      [attemptId]
    );
    let totalScore = 0;
    for (const a of allAnswers) {
      const score = a.manual_score !== null ? Number(a.manual_score) : (a.auto_score !== null ? Number(a.auto_score) : 0);
      totalScore += score;
    }

    const updates = ['score = ?'];
    const params = [Math.round(totalScore * 100) / 100];

    if (overall_feedback !== undefined) {
      updates.push('overall_feedback = ?');
      params.push(overall_feedback);
    }
    if (status) {
      updates.push('status = ?');
      params.push(status);
    }

    params.push(attemptId);
    await db.execute(`UPDATE attempts SET ${updates.join(', ')} WHERE id = ?`, params);

    const [updatedAttempt] = await db.execute('SELECT * FROM attempts WHERE id = ?', [attemptId]);
    res.json(updatedAttempt[0]);
  } catch (err) {
    console.error('Grade attempt error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/tests/reassign/:testId/student/:studentId — grant one extra attempt
router.post('/reassign/:testId/student/:studentId', async (req, res) => {
  try {
    const { testId, studentId } = req.params;
    const [tests] = await db.execute('SELECT * FROM tests WHERE id = ?', [testId]);
    if (!tests.length) return res.status(404).json({ error: 'Test not found' });
    if (tests[0].teacher_id !== req.user.id && req.user.role !== 'admin')
      return res.status(403).json({ error: 'Forbidden' });

    // Upsert: increment extra_attempts
    await db.execute(
      `INSERT INTO student_attempt_overrides (test_id, student_id, extra_attempts)
       VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE extra_attempts = extra_attempts + 1`,
      [testId, studentId]
    );
    const [[row]] = await db.execute(
      'SELECT extra_attempts FROM student_attempt_overrides WHERE test_id = ? AND student_id = ?',
      [testId, studentId]
    );
    res.json({ test_id: Number(testId), student_id: Number(studentId), extra_attempts: row.extra_attempts });
  } catch (err) {
    console.error('Reassign attempt error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/tests/reassign/:testId — list all overrides for a test
router.get('/reassign/:testId', async (req, res) => {
  try {
    const [tests] = await db.execute('SELECT * FROM tests WHERE id = ?', [req.params.testId]);
    if (!tests.length) return res.status(404).json({ error: 'Test not found' });
    if (tests[0].teacher_id !== req.user.id && req.user.role !== 'admin')
      return res.status(403).json({ error: 'Forbidden' });

    const [rows] = await db.execute(
      `SELECT sao.*, u.username, u.first_name, u.last_name
       FROM student_attempt_overrides sao
       JOIN users u ON u.id = sao.student_id
       WHERE sao.test_id = ?`,
      [req.params.testId]
    );
    res.json(rows);
  } catch (err) {
    console.error('List reassignments error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

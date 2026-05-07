const router = require('express').Router();
const db = require('../db');
const { seededRandom, shuffle } = require('../lib/randomize');
const { gradeMultipleChoice, gradeDragDrop, gradeFreeText, gradeTrueFalse } = require('../lib/grading');

// GET /api/student/tests — list tests assigned to this student
router.get('/tests', async (req, res) => {
  try {
    const studentId = req.user.id;

    // Get tests assigned directly OR via a group the student belongs to
    const [rows] = await db.execute(
      `SELECT DISTINCT
         t.id, t.title, t.title_image, t.time_limit_minutes, t.attempts_allowed,
         t.show_grade_on_completion, t.allow_back_navigation, ta.due_date,
         (SELECT COUNT(*) FROM questions q WHERE q.test_id = t.id) AS question_count,
         (SELECT COUNT(*) FROM attempts a2
          WHERE a2.test_id = t.id AND a2.student_id = ?
            AND a2.status != 'in_progress') AS attempts_used,
         (SELECT a3.id FROM attempts a3
          WHERE a3.test_id = t.id AND a3.student_id = ?
          ORDER BY a3.started_at DESC LIMIT 1) AS latest_attempt_id,
         (SELECT a3.status FROM attempts a3
          WHERE a3.test_id = t.id AND a3.student_id = ?
          ORDER BY a3.started_at DESC LIMIT 1) AS latest_attempt_status,
         (SELECT a3.score FROM attempts a3
          WHERE a3.test_id = t.id AND a3.student_id = ?
          ORDER BY a3.started_at DESC LIMIT 1) AS latest_attempt_score,
         (SELECT a3.max_score FROM attempts a3
          WHERE a3.test_id = t.id AND a3.student_id = ?
          ORDER BY a3.started_at DESC LIMIT 1) AS latest_attempt_max_score,
         (SELECT COUNT(*) FROM attempts a4
          WHERE a4.test_id = t.id AND a4.student_id = ?) AS attempt_number
       FROM tests t
       JOIN test_assignments ta ON ta.test_id = t.id
       LEFT JOIN group_students gs ON gs.group_id = ta.group_id
       WHERE t.status = 'published'
         AND (ta.student_id = ? OR gs.student_id = ?)
       ORDER BY ta.assigned_at DESC`,
      [studentId, studentId, studentId, studentId, studentId, studentId, studentId, studentId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Student list tests error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/student/tests/:testId/start — start a new attempt
router.post('/tests/:testId/start', async (req, res) => {
  try {
    const { testId } = req.params;
    const studentId = req.user.id;

    // 1. Verify assignment exists for this student
    const [assignments] = await db.execute(
      `SELECT ta.id FROM test_assignments ta
       LEFT JOIN group_students gs ON gs.group_id = ta.group_id
       JOIN tests t ON t.id = ta.test_id
       WHERE ta.test_id = ? AND t.status = 'published'
         AND (ta.student_id = ? OR gs.student_id = ?)
       LIMIT 1`,
      [testId, studentId, studentId]
    );
    if (!assignments.length) {
      return res.status(403).json({ error: 'You are not assigned to this test' });
    }

    // 2. Get test settings
    const [tests] = await db.execute('SELECT * FROM tests WHERE id = ?', [testId]);
    if (!tests.length) return res.status(404).json({ error: 'Test not found' });
    const test = tests[0];

    // 3. Check attempts_allowed not exceeded
    const [existingAttempts] = await db.execute(
      "SELECT id FROM attempts WHERE test_id = ? AND student_id = ? AND status != 'in_progress'",
      [testId, studentId]
    );
    // Check for teacher-granted extra attempts
    const [overrides] = await db.execute(
      'SELECT extra_attempts FROM student_attempt_overrides WHERE test_id = ? AND student_id = ?',
      [testId, studentId]
    );
    const totalAllowed = test.attempts_allowed + (overrides[0]?.extra_attempts || 0);
    if (existingAttempts.length >= totalAllowed) {
      return res.status(400).json({ error: 'Maximum attempts reached for this test' });
    }

    // Also check if there's an in-progress attempt — return it instead of creating new one
    const [inProgress] = await db.execute(
      "SELECT * FROM attempts WHERE test_id = ? AND student_id = ? AND status = 'in_progress' LIMIT 1",
      [testId, studentId]
    );
    if (inProgress.length) {
      // Return existing in-progress attempt with questions in the stored order
      return returnAttemptWithQuestions(res, inProgress[0], test);
    }

    // 4. Generate seed
    const seed = `${studentId}-${testId}-${Date.now()}`;

    // 5. Get questions sorted by order_index
    const [questions] = await db.execute(
      'SELECT * FROM questions WHERE test_id = ? ORDER BY order_index ASC',
      [testId]
    );
    const [allOptions] = await db.execute(
      `SELECT qo.* FROM question_options qo
       JOIN questions q ON q.id = qo.question_id
       WHERE q.test_id = ?
       ORDER BY qo.order_index ASC`,
      [testId]
    );
    const [allDdItems] = await db.execute(
      `SELECT ddi.* FROM drag_drop_items ddi
       JOIN questions q ON q.id = ddi.question_id
       WHERE q.test_id = ?
       ORDER BY ddi.correct_position ASC`,
      [testId]
    );

    // 6. Shuffle questions if enabled
    let orderedQuestions = [...questions];
    if (test.shuffle_questions) {
      const rng = seededRandom(seed);
      orderedQuestions = shuffle(orderedQuestions, rng);
    }

    // 7. Build question_order array (IDs in shuffled order)
    const questionOrder = orderedQuestions.map((q) => q.id);

    // 8. Create the attempt record
    const [result] = await db.execute(
      `INSERT INTO attempts (test_id, student_id, seed, question_order)
       VALUES (?, ?, ?, ?)`,
      [testId, studentId, seed, JSON.stringify(questionOrder)]
    );
    const attemptId = result.insertId;

    // 9. Build response — attach shuffled options to each MC question, strip is_correct
    const questionsForResponse = orderedQuestions.map((q) => {
      const qOptions = allOptions.filter((o) => o.question_id === q.id);
      const qDdItems = allDdItems.filter((d) => d.question_id === q.id);

      let shuffledOptions = qOptions;
      if (q.type === 'multiple_choice' && test.shuffle_answers) {
        const optRng = seededRandom(seed + q.id);
        shuffledOptions = shuffle(qOptions, optRng);
      }

      // Strip is_correct from options
      const safeOptions = shuffledOptions.map(({ is_correct, ...rest }) => rest);
      const safeDdItems = qDdItems;

      return {
        ...q,
        config: q.config || null,
        options: safeOptions,
        drag_drop_items: safeDdItems,
      };
    });

    const [attemptRows] = await db.execute('SELECT * FROM attempts WHERE id = ?', [attemptId]);
    res.status(201).json({
      attempt: attemptRows[0],
      questions: questionsForResponse,
    });
  } catch (err) {
    console.error('Start attempt error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper: return existing in-progress attempt with questions in stored order
async function returnAttemptWithQuestions(res, attempt, test) {
  try {
    const rawOrder = attempt.question_order;
    const questionOrder = rawOrder
      ? (typeof rawOrder === 'string' ? JSON.parse(rawOrder) : rawOrder)
      : [];

    const [questions] = await db.execute(
      'SELECT * FROM questions WHERE test_id = ? ORDER BY order_index ASC',
      [attempt.test_id]
    );
    const [allOptions] = await db.execute(
      `SELECT qo.* FROM question_options qo
       JOIN questions q ON q.id = qo.question_id
       WHERE q.test_id = ?`,
      [attempt.test_id]
    );
    const [allDdItems] = await db.execute(
      `SELECT ddi.* FROM drag_drop_items ddi
       JOIN questions q ON q.id = ddi.question_id
       WHERE q.test_id = ?`,
      [attempt.test_id]
    );

    // Sort by stored order
    const qMap = {};
    for (const q of questions) qMap[q.id] = q;

    let orderedQuestions;
    if (questionOrder.length) {
      orderedQuestions = questionOrder.map((qid) => qMap[qid]).filter(Boolean);
    } else {
      orderedQuestions = questions;
    }

    const questionsForResponse = orderedQuestions.map((q) => {
      const qOptions = allOptions.filter((o) => o.question_id === q.id);
      const qDdItems = allDdItems.filter((d) => d.question_id === q.id);

      let optionsInOrder = qOptions;
      if (q.type === 'multiple_choice' && test.shuffle_answers && attempt.seed) {
        const optRng = seededRandom(attempt.seed + q.id);
        optionsInOrder = shuffle(qOptions, optRng);
      }

      const safeOptions = optionsInOrder.map(({ is_correct, ...rest }) => rest);
      return { ...q, config: q.config || null, options: safeOptions, drag_drop_items: qDdItems };
    });

    return res.json({ attempt, questions: questionsForResponse });
  } catch (err) {
    console.error('returnAttemptWithQuestions error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /api/student/attempts/:id — get attempt with questions (must be own)
router.get('/attempts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const studentId = req.user.id;

    const [attempts] = await db.execute(
      `SELECT a.*, t.show_grade_on_completion, t.show_correct_answers,
              t.title, t.title_image, t.time_limit_minutes,
              t.allow_back_navigation, t.shuffle_answers
       FROM attempts a JOIN tests t ON t.id = a.test_id WHERE a.id = ?`,
      [id]
    );
    if (!attempts.length) return res.status(404).json({ error: 'Attempt not found' });
    const attempt = attempts[0];
    if (attempt.student_id !== studentId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const response = { ...attempt };
    if (attempt.status === 'in_progress') {
      delete response.score;
      delete response.max_score;
    }

    // Always include questions so TakeTestPage can render them
    const questionOrder = attempt.question_order
      ? (typeof attempt.question_order === 'string' ? JSON.parse(attempt.question_order) : attempt.question_order)
      : [];

    const [questions] = await db.execute(
      'SELECT * FROM questions WHERE test_id = ? ORDER BY order_index ASC',
      [attempt.test_id]
    );
    const [allOptions] = await db.execute(
      `SELECT qo.* FROM question_options qo
       JOIN questions q ON q.id = qo.question_id WHERE q.test_id = ?`,
      [attempt.test_id]
    );
    const [allDdItems] = await db.execute(
      `SELECT ddi.* FROM drag_drop_items ddi
       JOIN questions q ON q.id = ddi.question_id WHERE q.test_id = ?`,
      [attempt.test_id]
    );

    const qMap = {};
    for (const q of questions) qMap[q.id] = q;

    const ordered = questionOrder.length
      ? questionOrder.map(qid => qMap[qid]).filter(Boolean)
      : questions;

    response.questions = ordered.map(q => {
      const opts = allOptions.filter(o => o.question_id === q.id);
      const ddi = allDdItems.filter(d => d.question_id === q.id);

      let finalOpts = opts;
      if (q.type === 'multiple_choice' && attempt.shuffle_answers && attempt.seed) {
        const rng = seededRandom(attempt.seed + q.id);
        finalOpts = shuffle(opts, rng);
      }
      const safeOpts = finalOpts.map(({ is_correct, ...rest }) => rest);
      return { ...q, config: q.config || null, options: safeOpts, drag_drop_items: ddi };
    });

    res.json(response);
  } catch (err) {
    console.error('Get attempt error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/student/attempts/:id/submit — submit attempt
router.post('/attempts/:id/submit', async (req, res) => {
  try {
    const { id } = req.params;
    const studentId = req.user.id;

    const [attempts] = await db.execute(
      `SELECT a.*, t.show_grade_on_completion, t.show_correct_answers,
              t.attempts_allowed, t.shuffle_answers
       FROM attempts a JOIN tests t ON t.id = a.test_id WHERE a.id = ?`,
      [id]
    );
    if (!attempts.length) return res.status(404).json({ error: 'Attempt not found' });
    const attempt = attempts[0];
    if (attempt.student_id !== studentId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (attempt.status !== 'in_progress') {
      return res.status(400).json({ error: 'Attempt already submitted' });
    }

    const { answers = [] } = req.body; // [{ question_id, answer_data, option_order }]

    // Get all questions for this test with options and drag_drop_items
    const [questions] = await db.execute(
      'SELECT * FROM questions WHERE test_id = ?',
      [attempt.test_id]
    );
    const [allOptions] = await db.execute(
      `SELECT qo.* FROM question_options qo
       JOIN questions q ON q.id = qo.question_id
       WHERE q.test_id = ?`,
      [attempt.test_id]
    );
    const [allDdItems] = await db.execute(
      `SELECT ddi.* FROM drag_drop_items ddi
       JOIN questions q ON q.id = ddi.question_id
       WHERE q.test_id = ?`,
      [attempt.test_id]
    );

    let totalAutoScore = 0;
    let totalMaxScore = 0;
    let needsManualGrading = false;

    // Process each answer
    for (const submittedAnswer of answers) {
      const { question_id, answer_data, option_order } = submittedAnswer;
      const question = questions.find((q) => q.id === Number(question_id));
      if (!question) continue;

      const qOptions = allOptions.filter((o) => o.question_id === question.id);
      const qDdItems = allDdItems.filter((d) => d.question_id === question.id);

      totalMaxScore += Number(question.points);

      let autoScore = null;
      let isGraded = 0;

      if (question.type === 'multiple_choice') {
        autoScore = gradeMultipleChoice(question, qOptions, answer_data);
        isGraded = 1;
        totalAutoScore += autoScore;
      } else if (question.type === 'drag_drop') {
        autoScore = gradeDragDrop(question, qDdItems, answer_data);
        isGraded = 1;
        totalAutoScore += autoScore;
      } else if (question.type === 'true_false') {
        autoScore = gradeTrueFalse(question, answer_data);
        isGraded = 1;
        totalAutoScore += autoScore;
      } else if (question.type === 'free_text') {
        const result = gradeFreeText(question, answer_data);
        if (result !== null) {
          autoScore = result;
          isGraded = 1;
          totalAutoScore += autoScore;
        } else {
          needsManualGrading = true;
          isGraded = 0;
        }
      }

      // Upsert attempt_answers
      const [existing] = await db.execute(
        'SELECT id FROM attempt_answers WHERE attempt_id = ? AND question_id = ?',
        [id, question_id]
      );
      if (existing.length) {
        await db.execute(
          `UPDATE attempt_answers
           SET answer_data = ?, option_order = ?, auto_score = ?, is_graded = ?
           WHERE attempt_id = ? AND question_id = ?`,
          [
            JSON.stringify(answer_data),
            option_order ? JSON.stringify(option_order) : null,
            autoScore,
            isGraded,
            id,
            question_id,
          ]
        );
      } else {
        await db.execute(
          `INSERT INTO attempt_answers (attempt_id, question_id, answer_data, option_order, auto_score, is_graded)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            id,
            question_id,
            JSON.stringify(answer_data),
            option_order ? JSON.stringify(option_order) : null,
            autoScore,
            isGraded,
          ]
        );
      }
    }

    // For questions not answered, still save null answers so max_score is complete
    for (const question of questions) {
      const wasAnswered = answers.some((a) => Number(a.question_id) === question.id);
      if (!wasAnswered) {
        totalMaxScore += Number(question.points); // already counted above if answered
        // Check if already in db (from a previous partial save)
        const [existing] = await db.execute(
          'SELECT id FROM attempt_answers WHERE attempt_id = ? AND question_id = ?',
          [id, question.id]
        );
        if (!existing.length) {
          await db.execute(
            'INSERT INTO attempt_answers (attempt_id, question_id, answer_data, auto_score, is_graded) VALUES (?, ?, ?, ?, ?)',
            [id, question.id, JSON.stringify(null), 0, 1]
          );
          // It contributes 0 to score — already not added to totalAutoScore
        }
      }
    }

    // Recalculate max_score from all questions (avoid double counting)
    const realMaxScore = questions.reduce((sum, q) => sum + Number(q.points), 0);
    const finalScore = Math.round(totalAutoScore * 100) / 100;

    // Mark attempt as submitted
    await db.execute(
      "UPDATE attempts SET status = 'submitted', submitted_at = NOW(), score = ?, max_score = ? WHERE id = ?",
      [finalScore, Math.round(realMaxScore * 100) / 100, id]
    );

    res.json({
      score: finalScore,
      max_score: Math.round(realMaxScore * 100) / 100,
      show_grade: Boolean(attempt.show_grade_on_completion),
      needs_manual_grading: needsManualGrading,
    });
  } catch (err) {
    console.error('Submit attempt error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/student/attempts/:id/result — get result (only if submitted)
router.get('/attempts/:id/result', async (req, res) => {
  try {
    const { id } = req.params;
    const studentId = req.user.id;

    const [attempts] = await db.execute(
      `SELECT a.*, t.show_grade_on_completion, t.show_correct_answers, t.title AS test_title
       FROM attempts a JOIN tests t ON t.id = a.test_id WHERE a.id = ?`,
      [id]
    );
    if (!attempts.length) return res.status(404).json({ error: 'Attempt not found' });
    const attempt = attempts[0];
    if (attempt.student_id !== studentId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (attempt.status === 'in_progress') {
      return res.status(400).json({ error: 'Attempt not yet submitted' });
    }

    const response = {
      id: attempt.id,
      test_id: attempt.test_id,
      test_title: attempt.test_title,
      student_id: attempt.student_id,
      started_at: attempt.started_at,
      submitted_at: attempt.submitted_at,
      status: attempt.status,
    };

    if (attempt.show_grade_on_completion) {
      response.score = attempt.score;
      response.max_score = attempt.max_score;
      response.overall_feedback = attempt.overall_feedback;
    }

    if (attempt.show_correct_answers) {
      // Get questions with answers
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
        [id]
      );

      response.questions = questions.map((q) => {
        const qAns = answers.find((a) => a.question_id === q.id);
        return {
          ...q,
          options: options.filter((o) => o.question_id === q.id),
          drag_drop_items: ddItems.filter((d) => d.question_id === q.id),
          your_answer: qAns ? qAns.answer_data : null,
          auto_score: qAns ? qAns.auto_score : null,
          manual_score: qAns ? qAns.manual_score : null,
          feedback: qAns ? qAns.feedback : null,
        };
      });
    }

    res.json(response);
  } catch (err) {
    console.error('Get result error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

/**
 * Grade a multiple choice answer.
 * question: { config: { multi_select: bool }, points: number }
 * options: [{ id, is_correct }]
 * answerData: { selected_ids: [id1, id2, ...] }
 */
function gradeMultipleChoice(question, options, answerData) {
  const correctIds = new Set(options.filter((o) => o.is_correct).map((o) => o.id));
  const selectedIds = new Set(((answerData && answerData.selected_ids) || []).map(Number));

  const config = question.config || {};

  if (config.multi_select) {
    // Full credit only if exact match
    const correct =
      [...correctIds].every((id) => selectedIds.has(id)) &&
      [...selectedIds].every((id) => correctIds.has(id));
    return correct ? Number(question.points) : 0;
  } else {
    const selected = [...selectedIds][0];
    return correctIds.has(selected) ? Number(question.points) : 0;
  }
}

/**
 * Grade a drag and drop answer.
 * question: { points: number }
 * items: [{ id, correct_position }]
 * answerData: { order: [item_id1, item_id2, ...] } — order student placed items
 */
function gradeDragDrop(question, items, answerData) {
  const studentOrder = (answerData && answerData.order) || [];
  if (!studentOrder.length) return 0;

  let correct = 0;
  items.forEach((item) => {
    const studentPos = studentOrder.indexOf(item.id);
    if (studentPos === item.correct_position) correct++;
  });

  // Award full points only if all items are in the correct position
  return correct === items.length ? Number(question.points) : 0;
}

/**
 * Keyword/rubric grading for free text.
 * question.config: { keywords: ['word1','word2'], sample_answer: '...', min_keywords: 1 }
 * answerData: { text: '...' }
 * Returns null if no keywords are configured (needs manual grading).
 */
function gradeFreeText(question, answerData) {
  const config = question.config || {};
  const keywords = (config.keywords || []).map((k) => k.toLowerCase().trim());
  const minKeywords = config.min_keywords || 1;

  if (!keywords.length) return null; // needs manual grading

  const response = ((answerData && answerData.text) || '').toLowerCase();
  const matched = keywords.filter((k) => response.includes(k));

  if (matched.length >= minKeywords) {
    // Partial scoring: (matched / total_keywords) * points, rounded to 2dp
    const ratio = matched.length / keywords.length;
    return Math.round(ratio * Number(question.points) * 100) / 100;
  }
  return 0;
}

/**
 * Grade a true/false answer.
 * question.config: { correct_answer: true | false }
 * answerData: { answer: true | false }
 */
function gradeTrueFalse(question, answerData) {
  const config = question.config
    ? (typeof question.config === 'string' ? JSON.parse(question.config) : question.config)
    : {};
  const correct = config.correct_answer;
  if (correct === undefined || correct === null) return 0;
  // Coerce both sides to boolean to handle string/boolean inconsistencies
  const studentAnswer = answerData && answerData.answer !== undefined
    ? String(answerData.answer) === 'true'
    : null;
  if (studentAnswer === null) return 0;
  return (studentAnswer === Boolean(correct)) ? Number(question.points) : 0;
}

module.exports = { gradeMultipleChoice, gradeDragDrop, gradeFreeText, gradeTrueFalse };

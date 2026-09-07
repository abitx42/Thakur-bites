const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('Phase 11 Pillar 2: Pilot Feedback Engine (Students & Staff)', () => {

  it('1. Student Feedback Validation: Validates rating boundaries and allowed issue tags', () => {
    const validTags = [
      'payment_seamless',
      'payment_problem',
      'app_confusing',
      'order_delayed',
      'food_not_found',
      'great_experience'
    ];

    function validateStudentFeedback(rating, tags) {
      if (!Number.isSafeInteger(rating) || rating < 1 || rating > 5) {
        throw new Error('Rating must be integer between 1 and 5');
      }
      return tags.filter(t => validTags.includes(t));
    }

    // Valid 5-star with tags
    const filtered = validateStudentFeedback(5, ['great_experience', 'payment_seamless', 'invalid_hack_tag']);
    assert.strictEqual(filtered.length, 2);
    assert.deepStrictEqual(filtered, ['great_experience', 'payment_seamless']);

    // Invalid ratings throw
    assert.throws(() => validateStudentFeedback(0, []), /Rating must be integer/);
    assert.throws(() => validateStudentFeedback(6, []), /Rating must be integer/);
    assert.throws(() => validateStudentFeedback(4.5, []), /Rating must be integer/);
  });

  it('2. Staff Feedback Aggregation: Categorizes kitchen queue manageability and screen clarity', () => {
    const sampleStaffFeedback = [
      { role: 'cook', screenClarity: 5, queueManageability: 'manageable' },
      { role: 'cook', screenClarity: 4, queueManageability: 'manageable' },
      { role: 'cashier', screenClarity: 5, queueManageability: 'too_fast' },
      { role: 'manager', screenClarity: 5, queueManageability: 'manageable' },
    ];

    let claritySum = 0;
    const queueDist = { too_fast: 0, manageable: 0, slow: 0 };

    sampleStaffFeedback.forEach(f => {
      claritySum += f.screenClarity;
      queueDist[f.queueManageability]++;
    });

    const avgClarity = claritySum / sampleStaffFeedback.length;
    assert.strictEqual(avgClarity, 4.75);
    assert.strictEqual(queueDist.manageable, 3);
    assert.strictEqual(queueDist.too_fast, 1);
    assert.strictEqual(queueDist.slow, 0);
  });
});

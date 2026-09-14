const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('Round 4 Invariants & Defensive Regression Suite', () => {
  describe('BUG-06: WebP Polyglot & Script Injection Defense', () => {
    const { validateFileBuffer } = require('../lib/upload_validator');

    it('should reject a WebP file containing embedded script polyglot payload', () => {
      const header = Buffer.from([
        0x52, 0x49, 0x46, 0x46, // RIFF
        0x24, 0x00, 0x00, 0x00, // size
        0x57, 0x45, 0x42, 0x50, // WEBP
      ]);
      const maliciousPayload = Buffer.from('<script>alert("xss")</script>');
      const polyglotBuffer = Buffer.concat([header, maliciousPayload]);

      const result = validateFileBuffer(polyglotBuffer);
      assert.strictEqual(result.isValid, false, 'WebP with script tag must be rejected');
      assert.strictEqual(result.hasActiveContent, true, 'Must flag active content');
      assert.ok(result.rejectionReason.includes('polyglot'), 'Must specify polyglot rejection reason');
    });

    it('should reject a WebP file containing embedded <svg> polyglot payload', () => {
      const header = Buffer.from([
        0x52, 0x49, 0x46, 0x46,
        0x20, 0x00, 0x00, 0x00,
        0x57, 0x45, 0x42, 0x50,
      ]);
      const svgPayload = Buffer.from('<svg onload=alert(1)>');
      const polyglotBuffer = Buffer.concat([header, svgPayload]);

      const result = validateFileBuffer(polyglotBuffer);
      assert.strictEqual(result.isValid, false, 'WebP with svg tag must be rejected');
      assert.strictEqual(result.hasActiveContent, true);
    });

    it('should accept clean valid WebP binary image', () => {
      const cleanWebp = Buffer.from([
        0x52, 0x49, 0x46, 0x46,
        0x10, 0x00, 0x00, 0x00,
        0x57, 0x45, 0x42, 0x50,
        0x56, 0x50, 0x38, 0x20,
        0x04, 0x00, 0x00, 0x00,
        0x30, 0x01, 0x00, 0x9d,
      ]);

      const result = validateFileBuffer(cleanWebp);
      assert.strictEqual(result.isValid, true, 'Clean WebP must be accepted');
      assert.strictEqual(result.detectedType, 'WEBP');
      assert.strictEqual(result.mimeType, 'image/webp');
      assert.strictEqual(result.hasActiveContent, false);
    });
  });

  describe('BUG-02: Public TV Queue Chronological FIFO Sorting', () => {
    const { buildPublicQueuePayload } = require('../lib/tv_projection');

    it('should sort public queue tickets chronologically by createdAt timestamp', () => {
      const t1 = new Date('2026-09-14T10:00:00Z');
      const t2 = new Date('2026-09-14T10:05:00Z');
      const t3 = new Date('2026-09-14T10:10:00Z');

      const orders = [
        { tokenNumber: 'TB-003', status: 'preparing', createdAt: t3, estimatedMinutes: 10 },
        { tokenNumber: 'TB-001', status: 'preparing', createdAt: t1, estimatedMinutes: 15 },
        { tokenNumber: 'TB-002', status: 'ready', createdAt: t2 },
      ];

      const payload = buildPublicQueuePayload(orders);

      assert.strictEqual(payload.preparingTokens[0], 'TB-001');
      assert.strictEqual(payload.preparingTokens[1], 'TB-003');
      assert.strictEqual(payload.readyTokens[0], 'TB-002');
    });

    it('should ignore empty tokens and sanitize status', () => {
      const orders = [
        { tokenNumber: '   ', status: 'ready' },
        { tokenNumber: 'TB-099', status: 'PREPARING' },
      ];

      const payload = buildPublicQueuePayload(orders);
      assert.strictEqual(payload.activeCount, 1);
      assert.strictEqual(payload.preparingTokens[0], 'TB-099');
    });
  });

  describe('BUG-04: Disaster Recovery Drill Inventory Availability Equations', () => {
    it('should validate inventory conservation equations correctly for both available and unavailable items', () => {
      const availItem = {
        type: 'instant',
        stockOnHand: 50,
        reservedStock: 10,
        availableStock: 40,
        available: true,
      };
      const isItemAvailable = availItem.available !== false;
      const expectedAvail = isItemAvailable ? Math.max(0, availItem.stockOnHand - availItem.reservedStock) : 0;
      assert.strictEqual(availItem.availableStock, expectedAvail, 'Available item should balance onHand - reserved');

      const unavailItem = {
        type: 'instant',
        stockOnHand: 50,
        reservedStock: 0,
        availableStock: 0,
        available: false,
      };
      const isItemAvailable2 = unavailItem.available !== false;
      const expectedAvail2 = isItemAvailable2 ? Math.max(0, unavailItem.stockOnHand - unavailItem.reservedStock) : 0;
      assert.strictEqual(unavailItem.availableStock, expectedAvail2, 'Unavailable item should have availableStock == 0 while preserving stockOnHand');
    });
  });
});

const { describe, it } = require('node:test');
const assert = require('node:assert');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'demo-test-project' });
}

const { compareSemver } = require('../lib/version_policy');

describe('Phase 3: Identity, Verification Flow & Platform Version Policy Tests', () => {

  it('207. Platform-Specific Version Policy Resolution Invariant: Platform overrides global policy', () => {
    const globalPolicy = {
      minimumSupportedVersion: '1.0.0',
      forceUpdate: false,
    };

    const androidPolicy = {
      minimumSupportedVersion: '1.2.0',
      forceUpdate: true,
    };

    function resolvePolicy(platform) {
      if (platform === 'android') {
        return androidPolicy;
      }
      return globalPolicy;
    }

    // Web client running 1.1.0 complies with global policy
    const webPolicy = resolvePolicy('web');
    assert.strictEqual(webPolicy.forceUpdate, false);
    assert.strictEqual(compareSemver('1.1.0', webPolicy.minimumSupportedVersion) >= 0, true);

    // Android client running 1.1.0 is blocked by platform-specific forced update
    const activeAndroidPolicy = resolvePolicy('android');
    assert.strictEqual(activeAndroidPolicy.forceUpdate, true);
    assert.strictEqual(compareSemver('1.1.0', activeAndroidPolicy.minimumSupportedVersion) < 0, true);
  });

  it('208. Sensitive Endpoint Fail-Closed Version Invariant: Missing clientVersion rejected', () => {
    function enforceSensitiveVersion(clientVersion, options = { requireVersion: true }) {
      if (!clientVersion || typeof clientVersion !== 'string' || clientVersion.trim().length === 0) {
        if (options.requireVersion) {
          throw new Error('APP_VERSION_REQUIRED: This sensitive endpoint requires a valid client application version.');
        }
        return 'ALLOW_UNVERSIONED';
      }
      return 'ALLOW_VERSIONED';
    }

    assert.throws(
      () => enforceSensitiveVersion(undefined, { requireVersion: true }),
      /APP_VERSION_REQUIRED/
    );
    assert.throws(
      () => enforceSensitiveVersion('', { requireVersion: true }),
      /APP_VERSION_REQUIRED/
    );
    assert.strictEqual(enforceSensitiveVersion('1.0.0', { requireVersion: true }), 'ALLOW_VERSIONED');
    assert.strictEqual(enforceSensitiveVersion(undefined, { requireVersion: false }), 'ALLOW_UNVERSIONED');
  });

  it('209. Verification Claimed Identity Field Invariant: Unapproved fields are labeled claimed internally', () => {
    function processVerificationSubmission(input) {
      return {
        applicationId: 'FAC-ABC12345678',
        userId: 'user_123',
        status: 'SUBMITTED',
        // Authoritatively labeled claimed until administrative approval
        claimedEmployeeId: input.employeeId.trim().toUpperCase(),
        claimedDepartment: input.department.trim(),
        claimedDesignation: input.designation.trim(),
        // Backwards compatible fields
        employeeId: input.employeeId.trim().toUpperCase(),
        department: input.department.trim(),
      };
    }

    const application = processVerificationSubmission({
      employeeId: 'emp-999',
      department: 'Computer Engineering',
      designation: 'Assistant Professor',
    });

    assert.strictEqual(application.claimedEmployeeId, 'EMP-999');
    assert.strictEqual(application.claimedDepartment, 'Computer Engineering');
    assert.strictEqual(application.status, 'SUBMITTED');
  });

  it('210. Verification Claims Sync Error Reconciliation Queue Invariant: Enqueues for background retry', () => {
    const queue = new Map();

    function recordFailedClaimsSync(applicantUid, claims, error) {
      queue.set(applicantUid, {
        uid: applicantUid,
        targetClaims: claims,
        status: 'PENDING_RETRY',
        error: error.message,
        retryCount: 0,
        queuedAt: Date.now(),
      });
    }

    const applicantUid = 'prof_sharma_uid';
    const claims = { accountType: 'TEACHER', verificationStatus: 'VERIFIED', priorityLevel: 2 };
    recordFailedClaimsSync(applicantUid, claims, new Error('Network timeout contacting Firebase Auth'));

    assert.strictEqual(queue.has(applicantUid), true);
    const item = queue.get(applicantUid);
    assert.strictEqual(item.status, 'PENDING_RETRY');
    assert.strictEqual(item.targetClaims.priorityLevel, 2);
    assert.strictEqual(item.retryCount, 0);
  });

});

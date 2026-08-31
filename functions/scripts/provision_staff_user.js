/**
 * Provisioning script for staff testing account
 * Email: moreaboutastram@gmail.com
 * Role: admin
 */
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'adi-thakur-bite',
  });
}

async function provisionStaffUser() {
  const email = 'moreaboutastram@gmail.com';
  const password = 'mAc@080147';
  const role = 'admin';

  console.log(`Creating/updating Firebase Auth user for ${email}...`);

  let userRecord;
  try {
    userRecord = await admin.auth().getUserByEmail(email);
    console.log(`User already exists with UID: ${userRecord.uid}. Updating password & custom claims...`);
    await admin.auth().updateUser(userRecord.uid, {
      password,
      emailVerified: true,
      displayName: 'Astram Staff Admin',
    });
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      console.log(`User does not exist. Creating new user...`);
      userRecord = await admin.auth().createUser({
        email,
        password,
        emailVerified: true,
        displayName: 'Astram Staff Admin',
      });
      console.log(`Created user with UID: ${userRecord.uid}`);
    } else {
      throw err;
    }
  }

  // Set custom user claims for RBAC
  await admin.auth().setCustomUserClaims(userRecord.uid, {
    role,
    permissionsVersion: 1,
    assignedAt: Date.now(),
  });

  // Write to staffUsers collection in Firestore
  const db = admin.firestore();
  await db.collection('staffUsers').doc(userRecord.uid).set({
    uid: userRecord.uid,
    email,
    name: 'Astram Staff Admin',
    role,
    permissionsVersion: 1,
    active: true,
    createdAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
  }, { merge: true });

  console.log(`✅ Successfully provisioned ${email} as ${role} in Firebase Auth and Firestore staffUsers collection!`);
}

provisionStaffUser().catch((err) => {
  console.log('Notice during online Firebase Admin provisioning:', err.message);
});

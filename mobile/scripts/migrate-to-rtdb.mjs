/**
 * Migration script: Firestore export → Realtime Database tree
 * 
 * Usage: node mobile/scripts/migrate-to-rtdb.mjs
 * 
 * This script:
 * 1. Exports Firestore collections via the Admin SDK
 * 2. Transforms data to the RTDB tree structure
 * 3. Writes in chunked updates to avoid size limits
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, getDocs, collection } from 'firebase/firestore';
import { getDatabase, ref, set } from 'firebase/database';

// Firebase config from env
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

if (!firebaseConfig.projectId) {
  throw new Error('Missing EXPO_PUBLIC_FIREBASE_PROJECT_ID');
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const rtdb = getDatabase(app);

const CHUNK_SIZE = 10; // RTDB set() chunk size

async function writeChunk(path, data, index) {
  const key = String(index);
  await set(ref(`${path}/${key}`), data);
}

// 1. Migrate voters → /votersByWard/$wardNo/$voterId
async function migrateVoters() {
  const votersRef = collection(db, 'voters');
  const snapshot = await getDocs(votersRef);
  
  // Group voters by wardNo
  const wardGroups = {};
  snapshot.docs.forEach(doc => {
    const data = doc.data();
    const wardNo = data.wardNo;
    if (!wardGroups[wardNo]) {
      wardGroups[wardNo] = [];
    }
    wardGroups[wardNo].push({ [doc.id]: data });
  });
  
  for (const [wardNo, voters] of Object.entries(wardGroups)) {
    const voterRef = ref(rtdb, `votersByWard/${wardNo}`);
    
    // Write in chunks
    for (let i = 0; i < voters.length; i += CHUNK_SIZE) {
      const chunk = voters.slice(i, i + CHUNK_SIZE);
      await writeChunk(`votersByWard/${wardNo}`, chunk, i);
    }
    
    console.log(`Migrated ${voters.length} voters for ward ${wardNo}`);
  }
}

// 2. Migrate wards → /wards (flat list)
async function migrateWards() {
  const wardsRef = collection(db, 'wards');
  const snapshot = await getDocs(wardsRef);
  
  const wards = [];
  snapshot.docs.forEach(doc => {
    const data = doc.data();
    wards.push({
      wardNo: data.wardNo,
      voterCount: data.voterCount,
      male: data.male,
      female: data.female,
      thirdGender: data.thirdGender,
      delimitation: data.delimitation,
      boothNo: data.boothNo,
      roomNo: data.roomNo,
      boothAddress: data.boothAddress,
      pdfPages: data.pdfPages,
    });
  });
  
  await set(ref(rtdb, 'wards'), wards);
  console.log(`Migrated ${wards.length} wards`);
}

// 3. Migrate users → /users/$uid
async function migrateUsers() {
  const usersRef = collection(db, 'users');
  const snapshot = await getDocs(usersRef);
  
  const users = {};
  snapshot.docs.forEach(doc => {
    const data = doc.data();
    users[doc.id] = {
      uid: doc.id,
      email: data.email,
      displayName: data.displayName,
      role: data.role,
      wardNo: data.wardNo,
      onboarded: data.onboarded,
      locked: data.locked,
      lockedReason: data.lockedReason,
      lockedAt: data.lockedAt,
      lockedBy: data.lockedBy,
      multiDevice: data.multiDevice,
      multiDeviceBy: data.multiDeviceBy,
      multiDeviceAt: data.multiDeviceAt,
      teamId: data.teamId,
    };
  });
  
  await set(ref(rtdb, 'users'), users);
  console.log(`Migrated ${Object.keys(users).length} users`);
}

// 4. Migrate tasks → /tasks/$taskId
async function migrateTasks() {
  const tasksRef = collection(db, 'tasks');
  const snapshot = await getDocs(tasksRef);
  
  const tasks = {};
  snapshot.docs.forEach(doc => {
    const data = doc.data();
    tasks[doc.id] = {
      id: doc.id,
      title: data.title,
      description: data.description,
      assigneeId: data.assigneeId,
      areaId: data.areaId,
      boothId: data.boothId,
      dueDate: data.dueDate,
      status: data.status,
      report: data.report,
      createdBy: data.createdBy,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  });
  
  await set(ref(rtdb, 'tasks'), tasks);
  console.log(`Migrated ${Object.keys(tasks).length} tasks`);
}

// 5. Migrate voterPhones → /voterPhones/$voterId
async function migrateVoterPhones() {
  const phoneRef = collection(db, 'voterPhones');
  const snapshot = await getDocs(phoneRef);
  
  const phones = {};
  snapshot.docs.forEach(doc => {
    const data = doc.data();
    phones[doc.id] = {
      voterId: doc.id,
      phone: data.phone,
      authorName: data.authorName,
      wardNo: data.wardNo,
      updatedAt: data.updatedAt,
    };
  });
  
  await set(ref(rtdb, 'voterPhones'), phones);
  console.log(`Migrated ${Object.keys(phones).length} voter phone entries`);
}

// 6. Migrate teams → /teams/$teamId
async function migrateTeams() {
  const teamsRef = collection(db, 'teams');
  const snapshot = await getDocs(teamsRef);
  
  const teams = {};
  snapshot.docs.forEach(doc => {
    const data = doc.data();
    teams[doc.id] = {
      teamId: doc.id,
      members: data.members || {},
      updatedAt: data.updatedAt,
    };
  });
  
  await set(ref(rtdb, 'teams'), teams);
  console.log(`Migrated ${Object.keys(teams).length} teams`);
}

// 7. Migrate appConfig → /appConfig
async function migrateAppConfig() {
  const configRef = collection(db, 'appConfig', 'general');
  const snapshot = await getDocs(configRef);
  
  if (snapshot.empty) {
    console.log('No appConfig found');
    return;
  }
  
  const data = snapshot.docs[0].data();
  await set(ref(rtdb, 'appConfig'), {
    latestVersion: data.latestVersion,
    requiredVersion: data.requiredVersion,
    supportPhone: data.supportPhone,
    updatedAt: data.updatedAt,
    updatedBy: data.updatedBy,
  });
  console.log('Migrated appConfig');
}

async function main() {
  console.log('Starting Firestore → RTDB migration...\n');
  
  try {
    await migrateVoters();
    await migrateWards();
    await migrateUsers();
    await migrateTasks();
    await migrateVoterPhones();
    await migrateTeams();
    await migrateAppConfig();
    
    console.log('\nMigration complete!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

main();
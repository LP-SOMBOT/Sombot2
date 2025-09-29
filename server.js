const express = require('express');
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const admin = require('firebase-admin');
const fs = require('fs');

// --- RENDER DEPLOYMENT SETUP ---
const SERVICE_ACCOUNT_PATH = './serviceAccountKey.json';
if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error("CRITICAL ERROR: serviceAccountKey.json not found!");
    process.exit(1);
}
const serviceAccount = require(SERVICE_ACCOUNT_PATH);

const app = express();
const PORT = process.env.PORT || 3001;

// --- INITIALIZE FIREBASE ADMIN ---
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();
console.log('Firebase Admin Initialized.');

// --- SERVE THE REACT APP ---
app.use(express.static(path.join(__dirname, 'client', 'build')));

// --- BOT MANAGER LOGIC ---
const activeBots = new Map();

async function startBot(uid) {
  if (activeBots.has(uid)) return;
  console.log(`Starting bot for ${uid}...`);
  const { state, saveCreds } = await useMultiFileAuthState(`auth_info_baileys/${uid}`);
  const sock = makeWASocket({ auth: state, printQRInTerminal: false });
  activeBots.set(uid, sock);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'open') {
      console.log(`Connection opened for ${uid}. Bot is ready.`);
      await db.collection('bots').doc(uid).update({ status: 'CONNECTED', pairingCode: null });
    }
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      activeBots.delete(uid);
      if (shouldReconnect) {
        startBot(uid);
      } else {
        await db.collection('bots').doc(uid).update({ status: 'LOGGED_OUT' });
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg.message) return;
    const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text;
    if (messageText && messageText.toLowerCase() === '.ping') {
      await sock.sendMessage(msg.key.remoteJid, { text: 'Pong!' }, { quoted: msg });
    }
  });

  if (!sock.authState.creds.registered) {
    try {
      const botDoc = await db.collection('bots').doc(uid).get();
      const phoneNumber = botDoc.data().phoneNumber;
      setTimeout(async () => {
        try {
            const code = await sock.requestPairingCode(phoneNumber);
            const formattedCode = code.match(/.{1,4}/g).join('-');
            await db.collection('bots').doc(uid).update({ pairingCode: formattedCode });
        } catch (e) {
            await db.collection('bots').doc(uid).update({ status: 'PAIRING_FAILED' });
        }
      }, 5000);
    } catch (e) { console.error(e); }
  }
}

function stopBot(uid) {
  if (activeBots.has(uid)) {
    activeBots.get(uid).logout();
    activeBots.delete(uid);
  }
}

// --- FIRESTORE LISTENER ---
db.collection('bots').onSnapshot(snapshot => {
  snapshot.docChanges().forEach(change => {
    const uid = change.doc.id;
    const data = change.doc.data();
    if (change.type === 'added' || change.type === 'modified') {
      if (data.status === 'REQUESTING_QR' && !activeBots.has(uid)) startBot(uid);
    }
    if (change.type === 'removed') stopBot(uid);
  });
});

// --- CATCH-ALL ROUTE ---
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'build', 'index.html'));
});

// --- START THE SERVER ---
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

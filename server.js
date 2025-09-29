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

  // --- CONNECTION UPDATE HANDLER ---
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'open') {
      console.log(`Connection opened for ${uid}. Bot is ready.`);
      await db.collection('bots').doc(uid).update({ status: 'CONNECTED', pairingCode: null });

      // --- NEW: SEND WELCOME MESSAGE ---
      const botJid = sock.user.id;
      await sock.sendMessage(botJid, {
        text: "✅ *Welcome!* Your bot is now connected and online.\n\nType `.menu` to see available commands."
      });
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

  // --- MESSAGE HANDLER (WITH NEW COMMANDS) ---
  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg.message) return;

    const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
    const remoteJid = msg.key.remoteJid;
    const isGroup = remoteJid.endsWith('@g.us');
    const sender = msg.key.participant || msg.key.remoteJid;

    // --- ANTILINK LOGIC ---
    if (isGroup && (messageText.includes('https://') || messageText.includes('http://'))) {
        const groupSettingsRef = db.collection('bots').doc(uid).collection('groups').doc(remoteJid);
        const groupDoc = await groupSettingsRef.get();

        if (groupDoc.exists() && groupDoc.data().antilink) {
            const metadata = await sock.groupMetadata(remoteJid);
            const participant = metadata.participants.find(p => p.id === sender);
            const isAdmin = participant?.admin === 'superadmin' || participant?.admin === 'admin';
            
            // If sender is NOT an admin, delete the message
            if (!isAdmin) {
                console.log(`[Antilink] Deleting link from non-admin in ${remoteJid}`);
                await sock.sendMessage(remoteJid, { delete: msg.key });
                await sock.sendMessage(remoteJid, { text: `_Link deleted. Sending links is not allowed here._`});
            }
        }
    }

    // --- COMMANDS LOGIC ---
    const prefix = ".";
    if (!messageText.startsWith(prefix)) return;
    const command = messageText.slice(prefix.length).trim().split(' ')[0].toLowerCase();
    const args = messageText.trim().split(/ +/).slice(1);

    if (command === 'ping') {
      await sock.sendMessage(remoteJid, { text: 'Pong!' }, { quoted: msg });
    }

    if (command === 'menu') {
      const menuText = `*Bot Menu* 🤖\n\n` +
        `⦿ *.ping* - Check if the bot is alive.\n` +
        `⦿ *.menu* - Shows this menu.\n\n` +
        `*Group Commands:*\n` +
        `⦿ *.antilink on* - Enable antilink.\n` +
        `⦿ *.antilink off* - Disable antilink.\n\n` +
        `_Bot must be admin to use group commands._`;
      await sock.sendMessage(remoteJid, { text: menuText }, { quoted: msg });
    }

    if (command === 'antilink') {
        if (!isGroup) {
            return await sock.sendMessage(remoteJid, { text: "This command can only be used in groups." }, { quoted: msg });
        }
        
        const metadata = await sock.groupMetadata(remoteJid);
        const participant = metadata.participants.find(p => p.id === sender);
        const isAdmin = participant?.admin === 'superadmin' || participant?.admin === 'admin';

        if (!isAdmin) {
            return await sock.sendMessage(remoteJid, { text: "Only group admins can use this command." }, { quoted: msg });
        }
        
        const groupSettingsRef = db.collection('bots').doc(uid).collection('groups').doc(remoteJid);
        const option = args[0]?.toLowerCase();

        if (option === 'on') {
            await groupSettingsRef.set({ antilink: true }, { merge: true });
            await sock.sendMessage(remoteJid, { text: "✅ Antilink has been enabled." }, { quoted: msg });
        } else if (option === 'off') {
            await groupSettingsRef.set({ antilink: false }, { merge: true });
            await sock.sendMessage(remoteJid, { text: "❌ Antilink has been disabled." }, { quoted: msg });
        } else {
            await sock.sendMessage(remoteJid, { text: "Usage: .antilink on | off" }, { quoted: msg });
        }
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
        } catch (e) { await db.collection('bots').doc(uid).update({ status: 'PAIRING_FAILED' }); }
      }, 5000);
    } catch (e) { console.error(e); }
  }
}

// --- FIRESTORE LISTENER (UNCHANGED) ---
db.collection('bots').onSnapshot(snapshot => {
  snapshot.docChanges().forEach(change => {
    const uid = change.doc.id;
    const data = change.doc.data();
    if (change.type === 'added' || change.type === 'modified') {
      if (data.status === 'REQUESTING_QR' && !activeBots.has(uid)) startBot(uid);
    }
  });
});

// --- CATCH-ALL ROUTE (UNCHANGED) ---
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'build', 'index.html'));
});

// --- START SERVER (UNCHANGED) ---
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

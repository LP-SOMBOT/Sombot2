const express = require('express');
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const admin = require('firebase-admin');
const fs = require('fs');

// --- SETUP ---
const SERVICE_ACCOUNT_PATH = './serviceAccountKey.json';
if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error("FATAL ERROR: serviceAccountKey.json not found!");
    process.exit(1);
}
const serviceAccount = require(SERVICE_ACCOUNT_PATH);

const app = express();
const PORT = process.env.PORT || 3001;

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
console.log('Firebase Admin Initialized.');

app.use(express.static(path.join(__dirname, 'client', 'build')));

function initializeBotListeners() {
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
                console.log(`Connection opened for ${uid}. Bot is active.`);
                await db.collection('bots').doc(uid).update({ status: 'CONNECTED', pairingCode: null });
                const botJid = sock.user.id;
                await sock.sendMessage(botJid, { text: "✅ *Bot is now connected and online.*" });
            }
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
                activeBots.delete(uid);
                if (shouldReconnect) startBot(uid);
                else await db.collection('bots').doc(uid).update({ status: 'LOGGED_OUT' });
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // --- NEW TAGALL ON EVERY MESSAGE LOGIC ---
        sock.ev.on('messages.upsert', async (m) => {
            try {
                const msg = m.messages[0];
                if (!msg.message || msg.key.fromMe) return; // Don't react to own messages

                const remoteJid = msg.key.remoteJid;
                const isGroup = remoteJid.endsWith('@g.us');
                
                // Only activate in groups
                if (isGroup) {
                    const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

                    // If there's no text content (e.g., an image with no caption), do nothing.
                    if (!messageText.trim()) return;

                    const metadata = await sock.groupMetadata(remoteJid);
                    const participants = metadata.participants.map(p => p.id);

                    // Re-send the original message, but with a mention to everyone
                    await sock.sendMessage(remoteJid, {
                        text: messageText,
                        mentions: participants
                    });
                }
            } catch (error) {
                console.error("An error occurred in the message handler:", error);
            }
        });

        if (!sock.authState.creds.registered) {
            try {
                const phoneNumber = (await db.collection('bots').doc(uid).get()).data().phoneNumber;
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

    db.collection('bots').onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
            const uid = change.doc.id;
            const data = change.doc.data();
            if ((change.type === 'added' || change.type === 'modified') && data.status === 'REQUESTING_QR' && !activeBots.has(uid)) { startBot(uid); }
            if (change.type === 'removed' && activeBots.has(uid)) {
                activeBots.get(uid).logout();
                activeBots.delete(uid);
            }
        });
    });
}

app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'client', 'build', 'index.html')); });
app.listen(PORT, () => {
    console.log(`Server is live on port ${PORT}`);
    initializeBotListeners();
});

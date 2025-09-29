const express = require('express');
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const admin = require('firebase-admin');
const fs = require('fs');

const SERVICE_ACCOUNT_PATH = './serviceAccountKey.json';
if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error("CRITICAL ERROR: serviceAccountKey.json not found!");
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
    const userMenuState = new Map(); // Tracks which menu a user is in

    async function startBot(uid) {
        if (activeBots.has(uid)) return;
        console.log(`Starting bot for ${uid}...`);
        const { state, saveCreds } = await useMultiFileAuthState(`auth_info_baileys/${uid}`);
        const sock = makeWASocket({ auth: state, printQRInTerminal: false });
        activeBots.set(uid, sock);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'open') {
                console.log(`Connection opened for ${uid}.`);
                await db.collection('bots').doc(uid).update({ status: 'CONNECTED', pairingCode: null });
                const botJid = sock.user.id;
                const botSettings = (await db.collection('bots').doc(uid).get()).data();
                const welcomeMessage = `*Introduction:*\nWelcome, Owner. I am Night Owl, your dedicated assistant. All systems are operational and I am ready to execute your commands. Type .menu to begin.\n\n` +
                                     `*Core Information:*\n- Bot Name: Night Wa Bot </>\n- Version: 2.0.0\n- Owner: ${botSettings.ownerEmail || 'You'}\n- Bot Number: ${botJid.split(':')[0]}\n\n` +
                                     `*Current Settings:*\n- Visibility Mode: Online\n- Permissions: ${botSettings.botMode || 'public'}\n- Reject Calls: On`;
                await sock.sendMessage(botJid, { text: welcomeMessage });
            }
            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
                activeBots.delete(uid);
                if (shouldReconnect) { startBot(uid); } 
                else { await db.collection('bots').doc(uid).update({ status: 'LOGGED_OUT' }); }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const botSettingsDoc = await db.collection('bots').doc(uid).get();
            if (!botSettingsDoc.exists) return;
            const botSettings = botSettingsDoc.data();

            const remoteJid = msg.key.remoteJid;
            const isGroup = remoteJid.endsWith('@g.us');
            const sender = isGroup ? msg.key.participant : msg.key.remoteJid;
            const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

            const ownerJid = botSettings.phoneNumber + "@s.whatsapp.net";
            if (botSettings.botMode === 'private' && sender !== ownerJid) return;

            // --- ANTILINK LOGIC (FIXED) ---
            if (isGroup && (messageText.includes('https://chat.whatsapp.com') || messageText.includes('http://'))) {
                const groupDoc = await db.collection('bots').doc(uid).collection('groups').doc(remoteJid).get();
                if (groupDoc.exists() && groupDoc.data().antilink) {
                    const metadata = await sock.groupMetadata(remoteJid);
                    const botIsAdmin = !!metadata.participants.find(p => p.id === sock.user.id)?.admin; // The FIX is here
                    if (botIsAdmin) {
                        const senderIsAdmin = !!metadata.participants.find(p => p.id === sender)?.admin;
                        if (!senderIsAdmin) {
                            await sock.sendMessage(remoteJid, { delete: msg.key });
                            await sock.sendMessage(remoteJid, { text: `@${sender.split('@')[0]} ⚠️ Links are not allowed here.`, mentions: [sender]}, { quoted: msg });
                        }
                    }
                }
            }

            const prefix = ".";
            const isOwner = sender === ownerJid;
            
            // --- MENU STATE LOGIC ---
            if (userMenuState.get(sender) && /^\d+$/.test(messageText)) {
                const menuChoice = parseInt(messageText);
                const currentState = userMenuState.get(sender);
                userMenuState.delete(sender); // Reset state after use

                if (currentState === 'main_menu') {
                    if (menuChoice === 2) { // Owner Menu
                        return await sock.sendMessage(remoteJid, { text: "👑 *Owner Menu*\n\n- .>\n- .addowner\n- .block\n- .join" }, { quoted: msg });
                    }
                    if (menuChoice === 3) { // Group Menu
                        return await sock.sendMessage(remoteJid, { text: "👥 *Group Menu*\n\n- .antilink\n- .kick\n- .tagall" }, { quoted: msg });
                    }
                }
            }
            
            if (!messageText.startsWith(prefix)) return;
            const command = messageText.slice(prefix.length).trim().split(' ')[0].toLowerCase();
            const args = messageText.trim().split(/ +/).slice(1);
            
            let metadata, participants, isAdmin, botIsAdmin;
            if (isGroup) {
                metadata = await sock.groupMetadata(remoteJid);
                participants = metadata.participants;
                isAdmin = !!participants.find(p => p.id === sender)?.admin;
                botIsAdmin = !!participants.find(p => p.id === sock.user.id)?.admin;
            }

            switch (command) {
                case 'ping':
                    await sock.sendMessage(remoteJid, { text: 'Pong! ⚡' }, { quoted: msg });
                    break;

                case 'menu':
                    const menuText = `*HELLO I'M NIGHT WA BOT*\n\n` +
                      `1 › OWNER MENU\n` +
                      `2 › GROUP MENU\n` +
                      `3 › FUN MENU\n` +
                      `4 › ALL COMMANDS`;
                    userMenuState.set(sender, 'main_menu');
                    await sock.sendMessage(remoteJid, { text: menuText }, { quoted: msg });
                    setTimeout(() => userMenuState.delete(sender), 60000); // State expires in 60s
                    break;
                
                case 'mode':
                    if (!isOwner) return await sock.sendMessage(remoteJid, { text: "🔒 This is an owner-only command." }, { quoted: msg });
                    const mode = args[0]?.toLowerCase();
                    if (mode === 'public' || mode === 'private') {
                        await db.collection('bots').doc(uid).update({ botMode: mode });
                        await sock.sendMessage(remoteJid, { text: `✅ Bot mode set to *${mode}*.` }, { quoted: msg });
                    } else { await sock.sendMessage(remoteJid, { text: "Usage: .mode public | private" }, { quoted: msg }); }
                    break;

                case 'antilink':
                    if (!isGroup) return await sock.sendMessage(remoteJid, { text: "This command only works in groups." }, { quoted: msg });
                    if (!isAdmin) return await sock.sendMessage(remoteJid, { text: "🔒 This is a group admin-only command." }, { quoted: msg });
                    if (!botIsAdmin) return await sock.sendMessage(remoteJid, { text: "I need to be an admin to manage links." }, { quoted: msg });
                    
                    const option = args[0]?.toLowerCase();
                    const groupSettingsRef = db.collection('bots').doc(uid).collection('groups').doc(remoteJid);
                    if (option === 'on') {
                        await groupSettingsRef.set({ antilink: true }, { merge: true });
                        await sock.sendMessage(remoteJid, { text: "✅ Anti-link has been turned ON." }, { quoted: msg });
                    } else if (option === 'off') {
                        await groupSettingsRef.set({ antilink: false }, { merge: true });
                        await sock.sendMessage(remoteJid, { text: "❌ Anti-link has been turned OFF." }, { quoted: msg });
                    } else { await sock.sendMessage(remoteJid, { text: "Usage: .antilink on | off" }, { quoted: msg }); }
                    break;
                
                case 'tagall':
                    if (!isGroup || !isAdmin) return await sock.sendMessage(remoteJid, { text: "🔒 This is a group admin-only command." }, { quoted: msg });
                    const message = args.join(' ') || 'Attention everyone!';
                    await sock.sendMessage(remoteJid, { text: message, mentions: participants.map(p => p.id) }, { quoted: msg });
                    break;
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
            if ((change.type === 'added' || change.type === 'modified') && data.status === 'REQUESTING_QR' && !activeBots.has(uid)) {
                startBot(uid);
            }
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

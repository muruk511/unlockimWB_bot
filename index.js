require('dotenv').config();
const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useSingleFileAuthState,
} = require('@whiskeysockets/baileys');
const P = require('pino');
const { db } = require('./firebase');

const SESSION_FILE_PATH = process.env.SESSION_FILE || './session.json';
const { state, saveState } = useSingleFileAuthState(SESSION_FILE_PATH);

async function startBot() {
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    printQRInTerminal: true,
    auth: state,
    logger: P({ level: 'silent' }),
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const shouldReconnect =
        (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
      console.log('Connection closed. Reconnecting:', shouldReconnect);
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('WhatsApp connection opened');
    }
  });

  sock.ev.on('creds.update', saveState);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const sender = msg.key.remoteJid;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
    if (!text) return;

    const command = text.trim().toLowerCase();

    if (command === '/tool_rental') {
      const toolsSnapshot = await db.collection('tools').get();
      let reply = '🔧 Available Tools for Rent:\n';
      toolsSnapshot.forEach(doc => {
        const tool = doc.data();
        reply += `${tool.name}: ${tool.status === 'available' ? '✅' : '❌ In Use'} - PGK ${tool.price} / ${tool.duration} mins\n`;
      });
      await sock.sendMessage(sender, { text: reply });
    } else if (command.endsWith('_status')) {
      const toolName = command.replace('_status', '');
      const formattedName = toolName.charAt(0).toUpperCase() + toolName.slice(1);
      const doc = await db.collection('tools').doc(formattedName).get();
      if (!doc.exists) {
        await sock.sendMessage(sender, { text: 'Tool not found.' });
        return;
      }
      const tool = doc.data();
      const reply = `🔍 ${tool.name} Status:\nStatus: ${tool.status === 'available' ? '✅ Available' : '❌ In Use'}\nPrice: PGK ${tool.price}\nDuration: ${tool.duration} mins`;
      await sock.sendMessage(sender, { text: reply });
    } else {
      await sock.sendMessage(sender, { text: 'Unknown command. Use /tool_rental or /UnlockTool_status' });
    }
  });
}

startBot();

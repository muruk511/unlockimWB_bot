require('dotenv').config();
const http = require('http');
const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { db } = require('./firebase');
const P = require('pino');
const fs = require('fs');

async function startBot() {
  const { version } = await fetchLatestBaileysVersion();
  const { state, saveCreds } = await useMultiFileAuthState('./auth');

  const sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: 'silent' }),
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('📱 Scan this QR in WhatsApp: ', qr);
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed. Reconnecting:', shouldReconnect);
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('✅ WhatsApp bot connected.');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const sender = msg.key.remoteJid;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
    if (!text) return;

    const command = text.trim();

    if (command === '/tool_rental') {
      const toolsSnapshot = await db.collection('tools').get();
      let reply = '🔧 Available Tools for Rent:\n';
      toolsSnapshot.forEach(doc => {
        const tool = doc.data();
        reply += `${tool.name}: ${tool.status === 'available' ? '✅' : '❌ In Use'} - PGK ${tool.price} / ${tool.duration} mins\n`;
      });
      await sock.sendMessage(sender, { text: reply });

    } else if (command.startsWith('/tool_status')) {
      const parts = command.split(' ');
      if (parts.length < 2) {
        await sock.sendMessage(sender, {
          text: '❗ Please provide a tool name.\nExample: /tool_status UnlockTool'
        });
        return;
      }

      const toolName = parts.slice(1).join(' ');
      const formattedName = toolName.trim(); // Use exactly what the user typed
      const doc = await db.collection('tools').doc(formattedName).get();


      if (!doc.exists) {
        await sock.sendMessage(sender, { text: `❌ Tool "${formattedName}" not found.` });
        return;
      }

      const tool = doc.data();
      const reply = `🔍 ${tool.name} Status:\nStatus: ${tool.status === 'available' ? '✅ Available' : '❌ In Use'}\nPrice: PGK ${tool.price}\nDuration: ${tool.duration} mins`;
      await sock.sendMessage(sender, { text: reply });

    } else if (command.endsWith('_status')) {
      const toolName = command.replace('_status', '');
      const formattedName = toolName.charAt(0).toUpperCase() + toolName.slice(1).toLowerCase();
      const doc = await db.collection('tools').doc(formattedName).get();

      if (!doc.exists) {
        await sock.sendMessage(sender, { text: 'Tool not found.' });
        return;
      }

      const tool = doc.data();
      const reply = `🔍 ${tool.name} Status:\nStatus: ${tool.status === 'available' ? '✅ Available' : '❌ In Use'}\nPrice: PGK ${tool.price}\nDuration: ${tool.duration} mins`;
      await sock.sendMessage(sender, { text: reply });

    } else {
      await sock.sendMessage(sender, {
        text: `❗ Unknown command.\nTry:\n/tool_rental\n/tool_status UnlockTool\n/UnlockTool_status`
      });
    }
  });

  console.log('WhatsApp bot started');
}

// Start the bot
startBot();

// Required HTTP server for Render
const PORT = process.env.PORT || 1000;

const server = http.createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('Unlockim Fone PNG WhatsApp Bot is running\n');
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});

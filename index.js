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

    const command = text.trim().toLowerCase();

    if (command === '/tool_rental') {
      const toolsSnapshot = await db.collection('tools').get();
      let reply = '🔧 Available Tools for Rent:\n';
      toolsSnapshot.forEach(doc => {
        const tool = doc.data();
        let rateInfo = '';
        if (tool.rates) {
          for (const [hrs, price] of Object.entries(tool.rates)) {
            rateInfo += `${hrs}h = PGK ${price}, `;
          }
          rateInfo = rateInfo.slice(0, -2); // Remove trailing comma
        } else {
          rateInfo = 'No rate info';
        }

        reply += `\n${tool.name}: ${tool.status === 'available' ? '✅' : '❌ In Use'}\nRates: ${rateInfo}\n`;
      });
      await sock.sendMessage(sender, { text: reply });

    } else if (command.startsWith('/tool_status')) {
      const parts = text.trim().split(' ');
      if (parts.length < 2) {
        await sock.sendMessage(sender, {
          text: '❗ Please provide a tool name.\nExample: /tool_status UnlockTool'
        });
        return;
      }

      const rawToolName = parts.slice(1).join(' ');
      const searchKey = rawToolName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

      const toolsSnapshot = await db.collection('tools').get();
      let foundDoc = null;

      toolsSnapshot.forEach(doc => {
        const normalizedId = doc.id.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        if (normalizedId === searchKey) {
          foundDoc = doc;
        }
      });

      if (!foundDoc) {
        await sock.sendMessage(sender, {
          text: `❌ Tool "${rawToolName}" not found.\nCheck spelling or try /tool_rental to see available tools.`
        });
        return;
      }

      const tool = foundDoc.data();
      let rateInfo = '';
      if (tool.rates) {
        for (const [hrs, price] of Object.entries(tool.rates)) {
          rateInfo += `${hrs}h = PGK ${price}, `;
        }
        rateInfo = rateInfo.slice(0, -2);
      } else {
        rateInfo = 'No rate info';
      }

      const reply = `🔍 ${tool.name} Status:\nStatus: ${tool.status === 'available' ? '✅ Available' : '❌ In Use'}\nRates: ${rateInfo}`;
      await sock.sendMessage(sender, { text: reply });

    } else if (command.endsWith('_status')) {
      const toolName = command.replace('_status', '');
      const formattedName = toolName.trim();
      const doc = await db.collection('tools').doc(formattedName).get();

      if (!doc.exists) {
        await sock.sendMessage(sender, { text: `Tool "${formattedName}" not found.` });
        return;
      }

      const tool = doc.data();
      let rateInfo = '';
      if (tool.rates) {
        for (const [hrs, price] of Object.entries(tool.rates)) {
          rateInfo += `${hrs}h = PGK ${price}, `;
        }
        rateInfo = rateInfo.slice(0, -2);
      } else {
        rateInfo = 'No rate info';
      }

      const reply = `🔍 ${tool.name} Status:\nStatus: ${tool.status === 'available' ? '✅ Available' : '❌ In Use'}\nRates: ${rateInfo}`;
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

// Start a simple HTTP server for Render
const PORT = process.env.PORT || 1000;

const server = http.createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Unlockim Fone PNG WhatsApp Bot is running\n');
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});

require('dotenv').config();
const http = require('http');
const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { db } = require('./firebase');
const P = require('pino');
const fs = require('fs');

const knownUsers = new Set(); // Memory-only intro tracker

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

    // Intro message for new users
    if (!knownUsers.has(sender)) {
      knownUsers.add(sender);
      const intro = `👋 Welcome to Unlockim Fone PNG WhatsApp Bot!

I can help you with tool rentals and info.

Try these commands:
🛠️ /tool_rental – List available tools  
🔍 /tool_status <ToolName> – Check tool info  
⚡ /<ToolName>_status – Quick check by name

Example:
➡ /tool_status UnlockTool  
➡ /UnlockTool_status`;

      await sock.sendMessage(sender, { text: intro });
    }

    if (command === '/tool_rental') {
      const toolsSnapshot = await db.collection('tools').get();
      let reply = '🔧 Available Tools for Rent:\n\n';
      toolsSnapshot.forEach(doc => {
        const tool = doc.data();
        let ratesText = '';
        if (tool.rates) {
          Object.keys(tool.rates).sort((a, b) => a - b).forEach(duration => {
            ratesText += `  • ${duration} hrs – PGK ${tool.rates[duration]}\n`;
          });
        }
        reply += `${tool.name} (${tool.status === 'available' ? '✅ Available' : '❌ In Use'}):\n${ratesText}\n`;
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
      let ratesText = '';
      if (tool.rates) {
        Object.keys(tool.rates).sort((a, b) => a - b).forEach(duration => {
          ratesText += `  • ${duration} hrs – PGK ${tool.rates[duration]}\n`;
        });
      }

      const reply = `🔍 ${tool.name} Status:\nStatus: ${tool.status === 'available' ? '✅ Available' : '❌ In Use'}\n\nRates:\n${ratesText}`;
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
      let ratesText = '';
      if (tool.rates) {
        Object.keys(tool.rates).sort((a, b) => a - b).forEach(duration => {
          ratesText += `  • ${duration} hrs – PGK ${tool.rates[duration]}\n`;
        });
      }

      const reply = `🔍 ${tool.name} Status:\nStatus: ${tool.status === 'available' ? '✅ Available' : '❌ In Use'}\n\nRates:\n${ratesText}`;
      await sock.sendMessage(sender, { text: reply });

    } else {
      const funnyReply = `🤖 Beep beep! I’m just a hardworking bot, not your cousin from Boroko.

I *do* understand these cool tricks:
🛠️ /tool_rental – List available tools  
🔍 /tool_status <ToolName> – Check a tool’s status  
⚡ /<ToolName>_status – Shortcut to check a tool by name

Try one of those and I’ll flex my circuits! 🤖💪`;
      await sock.sendMessage(sender, { text: funnyReply });
    }
  });

  console.log('WhatsApp bot started');
}

startBot();

// Simple HTTP server
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

require('dotenv').config();
const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { db } = require('./firebase');
const P = require('pino');

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
        reply += `${tool.name}: ${tool.status === 'available' ? '✅' : '❌ In Use'} - PGK ${tool.price} / ${tool.duration} mins\n`;
      });
      await sock.sendMessage(sender, { text: reply });

    } else if (command.startsWith('/rent_tool ')) {
      const toolName = command.replace('/rent_tool ', '').trim();
      if (!toolName) {
        await sock.sendMessage(sender, { text: 'Please specify the tool name. Usage: /rent_tool <toolname>' });
        return;
      }
      const docRef = db.collection('tools').doc(toolName.charAt(0).toUpperCase() + toolName.slice(1));
      const doc = await docRef.get();
      if (!doc.exists) {
        await sock.sendMessage(sender, { text: 'Tool not found.' });
        return;
      }
      const tool = doc.data();
      if (tool.status !== 'available') {
        await sock.sendMessage(sender, { text: `${tool.name} is currently in use.` });
        return;
      }
      // Update tool status to in_use
      await docRef.update({ status: 'in_use' });
      await sock.sendMessage(sender, { text: `You have successfully rented ${tool.name} for PGK ${tool.price} for ${tool.duration} minutes.` });

    } else if (command.startsWith('/return_tool ')) {
      const toolName = command.replace('/return_tool ', '').trim();
      if (!toolName) {
        await sock.sendMessage(sender, { text: 'Please specify the tool name. Usage: /return_tool <toolname>' });
        return;
      }
      const docRef = db.collection('tools').doc(toolName.charAt(0).toUpperCase() + toolName.slice(1));
      const doc = await docRef.get();
      if (!doc.exists) {
        await sock.sendMessage(sender, { text: 'Tool not found.' });
        return;
      }
      const tool = doc.data();
      if (tool.status === 'available') {
        await sock.sendMessage(sender, { text: `${tool.name} is not currently rented.` });
        return;
      }
      // Update tool status to available
      await docRef.update({ status: 'available' });
      await sock.sendMessage(sender, { text: `Thank you for returning ${tool.name}. It is now available for others.` });

    } else if (command.endsWith('_status') || command.startsWith('/status ')) {
      let toolName = '';
      if (command.endsWith('_status')) {
        toolName = command.replace('_status', '').trim();
      } else if (command.startsWith('/status ')) {
        toolName = command.replace('/status ', '').trim();
      }
      if (!toolName) {
        await sock.sendMessage(sender, { text: 'Please specify the tool name. Usage: /status <toolname> or /<toolname>_status' });
        return;
      }
      const docRef = db.collection('tools').doc(toolName.charAt(0).toUpperCase() + toolName.slice(1));
      const doc = await docRef.get();
      if (!doc.exists) {
        await sock.sendMessage(sender, { text: 'Tool not found.' });
        return;
      }
      const tool = doc.data();
      const reply = `🔍 ${tool.name} Status:\nStatus: ${tool.status === 'available' ? '✅ Available' : '❌ In Use'}\nPrice: PGK ${tool.price}\nDuration: ${tool.duration} mins`;
      await sock.sendMessage(sender, { text: reply });

    } else {
      await sock.sendMessage(sender, {
        text: `❗ Unknown command.\nTry:\n/tool_rental\n/rent_tool <toolname>\n/return_tool <toolname>\n/status <toolname>\n/<toolname>_status`
      });
    }
  });
}

startBot();

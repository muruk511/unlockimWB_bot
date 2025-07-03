require('dotenv').config();
const express = require('express');
const { default: makeWASocket, useSingleFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const P = require('pino');

const app = express();
const PORT = process.env.PORT || 10000;
const SESSION_FILE_PATH = process.env.SESSION_FILE_PATH || './session.json';

// Initialize Baileys auth state
const { state, saveState } = useSingleFileAuthState(SESSION_FILE_PATH);

async function startBot() {
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: 'silent' }),
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('Scan this QR code with your WhatsApp:', qr);
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed. Reconnecting:', shouldReconnect);
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('WhatsApp connection opened');
    }
  });

  sock.ev.on('creds.update', saveState);

  // Add your message handler below...
}

app.get('/ping', (req, res) => res.send('pong'));

app.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
  startBot().catch(err => console.error('Error starting bot:', err));
});

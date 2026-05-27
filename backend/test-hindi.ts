/**
 * Quick test script — send a Hindi (or any language) free-text WhatsApp message.
 * Run: npx ts-node test-hindi.ts
 *
 * Requirement: the recipient must have messaged your bot number first
 * (to open the 24-hour session window).
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { sendTextMessage } from './src/services/whatsappService';

const TO   = '91XXXXXXXXXX';   // ← replace with the recipient's number (with country code, no +)
const TEXT = 'Hi Sahil, Aapka kaam hua k? 🙏';

(async () => {
  console.log(`Sending to ${TO}: "${TEXT}"`);
  await sendTextMessage(TO, TEXT);
  console.log('Done.');
})();

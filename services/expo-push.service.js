const axios = require('axios');
const User = require('../models/user.model');
let warned = false;

async function send({ userId, to, title, body, sound, data }) {
  if (!process.env.EXPO_ACCESS_TOKEN) {
    if (!warned) { console.warn('Expo push disabled: EXPO_ACCESS_TOKEN is not configured'); warned = true; }
    return;
  }
  try {
    // Official Expo Push API. Never log axios errors (they contain the bearer token).
    const response = await axios.post('https://exp.host/--/api/v2/push/send', {
      to, title, body, sound: sound ? 'default' : null, data
    }, { timeout: 10000, headers: { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } });
    const ticket = Array.isArray(response.data?.data) ? response.data.data[0] : response.data?.data;
    if (ticket?.details?.error === 'DeviceNotRegistered') {
      await User.updateOne({ _id: userId, pushToken: to }, { $unset: { pushToken: '' } });
    } else if (ticket?.status === 'error') console.warn('Expo rejected push ticket');
  } catch (error) {
    // HTTP 400/404 can mean malformed payload/configuration, not a dead token.
    // Only explicit token invalidation is safe; protect a concurrently rotated token.
    if (error.response?.data?.details?.error === 'DeviceNotRegistered') {
      await User.updateOne({ _id: userId, pushToken: to }, { $unset: { pushToken: '' } }).catch(() => {});
    }
    console.warn('Expo push delivery failed', error.response?.status || 'network');
  }
}
module.exports = { send };

const User = require('../models/user.model');
const { isUserOnline } = require('../utils/socket-handler.utils');
const expoPush = require('./expo-push.service');
const { preferences, typeChannels, targetFor } = require('../utils/notification-preferences.helper');
let io;
function initDelivery(socketServer) { io = socketServer; }
async function deliver(notification) {
  if (!io) return; // Explicit initialization; fixture workers never deliver externally by default.
  try {
    const user = await User.findById(notification.userId).select({ isActive: 1, notificationPreferences: 1, pushToken: 1 }).lean();
    if (!user || !user.isActive) return;
    const prefs = preferences(user.notificationPreferences);
    if (!prefs.master) return;
    const channels = typeChannels(prefs, notification.type);
    const online = isUserOnline(notification.userId);
    if (online && channels.inApp) io.to(String(notification.userId)).emit('notification_created', { notification });
    if (!online && user.pushToken && prefs.push && channels.push) await expoPush.send({
      userId: notification.userId, to: user.pushToken, title: notification.title,
      body: notification.message, sound: prefs.sound,
      data: { type: notification.type, relatedId: notification.relatedId ? String(notification.relatedId) : null,
        target: targetFor(notification.type), userId: String(notification.userId) }
    });
  } catch (error) { console.warn('Notification delivery failed:', error.name); }
}
module.exports = { initDelivery, deliver };

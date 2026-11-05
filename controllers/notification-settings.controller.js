const User = require('../models/user.model');
const { preferences } = require('../utils/notification-preferences.helper');

const handler = operation => async (req, res) => {
  try {
    const data = await operation(req);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Notification settings error:', error.name);
    res.status(500).json({ success: false, error: 'Unable to update notification settings' });
  }
};

exports.registerPushToken = handler(async req => {
  await User.updateOne({ _id: req.user._id }, { $set: {
    pushToken: req.body.token, pushTokenPlatform: req.body.platform, pushTokenUpdatedAt: new Date()
  } });
  return { registered: true };
});
exports.unregisterPushToken = handler(async req => {
  await User.updateOne({ _id: req.user._id }, { $unset: { pushToken: '', pushTokenPlatform: '', pushTokenUpdatedAt: '' } });
  return { registered: false };
});
exports.getPreferences = handler(async req => {
  const user = await User.findById(req.user._id).select('notificationPreferences').lean();
  return preferences(user?.notificationPreferences);
});
exports.updatePreferences = handler(async req => {
  const changes = {};
  function flatten(value, prefix) {
    for (const [key, item] of Object.entries(value)) {
      if (item !== null && typeof item === 'object') flatten(item, `${prefix}.${key}`);
      else changes[`${prefix}.${key}`] = item;
    }
  }
  // Route validator allowlists every key; leaf updates preserve concurrent unrelated preferences.
  flatten(req.body, 'notificationPreferences');
  const user = Object.keys(changes).length
    ? await User.findByIdAndUpdate(req.user._id, { $set: changes }, { new: true, runValidators: true }).select('notificationPreferences').lean()
    : await User.findById(req.user._id).select('notificationPreferences').lean();
  return preferences(user?.notificationPreferences);
});

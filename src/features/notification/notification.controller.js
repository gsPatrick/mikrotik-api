const notificationService = require('./notification.service');

const getUserNotifications = async (req, res) => {
  try {
    const notifications = await notificationService.findUnreadNotifications(req.user.id);
    res.status(200).json({ success: true, data: notifications });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao buscar notificações.', error: error.message });
  }
};

const markAsRead = async (req, res) => {
  try {
    await notificationService.markAllAsRead(req.user.id);
    res.status(200).json({ success: true, message: 'Notificações marcadas como lidas.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao marcar notificações.', error: error.message });
  }
};

module.exports = { getUserNotifications, markAsRead };
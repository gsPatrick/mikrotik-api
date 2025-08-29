// src/features/notification/notification.controller.js
const notificationService = require('./notification.service');

const getUserNotifications = async (req, res) => {
  try {
    // Passa o ID e a ROLE do usuário logado para o serviço de notificação
    const notifications = await notificationService.findUnreadNotifications(req.user.id, req.user.role);
    res.status(200).json({ success: true, data: notifications });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao buscar notificações.', error: error.message });
  }
};

const markAsRead = async (req, res) => {
  try {
    // Passa o ID e a ROLE do usuário logado para o serviço de notificação
    await notificationService.markAllAsRead(req.user.id, req.user.role);
    res.status(200).json({ success: true, message: 'Notificações marcadas como lidas.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao marcar notificações.', error: error.message });
  }
};

module.exports = { getUserNotifications, markAsRead };
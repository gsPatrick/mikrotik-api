const { Notification } = require('../../models');

// Busca notificações não lidas para um usuário específico
const findUnreadNotifications = async (userId) => {
  return await Notification.findAll({
    where: { userId, isRead: false },
    order: [['createdAt', 'DESC']],
  });
};

// Marca todas as notificações de um usuário como lidas
const markAllAsRead = async (userId) => {
  return await Notification.update({ isRead: true }, { where: { userId } });
};

// Cria uma notificação (para ser chamada por outros serviços)
const createNotification = async (notificationData) => {
  return await Notification.create(notificationData);
};

module.exports = { findUnreadNotifications, markAllAsRead, createNotification };
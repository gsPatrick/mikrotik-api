// src/features/notification/notification.service.js
const { Notification, User } = require('../../models');
const { Op } = require('sequelize'); // Importar Op para consultas OR

// Busca notificações não lidas para um usuário específico.
// Admins podem ver notificações do sistema (userId: null) ou as suas.
const findUnreadNotifications = async (userId, userRole) => {
  const whereClause = { isRead: false };

  if (userRole === 'admin') {
    // Administradores podem ver notificações gerais do sistema (userId é null)
    // OU notificações diretamente atribuídas a eles.
    whereClause[Op.or] = [
      { userId: null },
      { userId: userId }
    ];
  } else {
    // Outros usuários veem apenas as notificações diretamente atribuídas a eles.
    whereClause.userId = userId;
  }

  return await Notification.findAll({
    where: whereClause,
    order: [['createdAt', 'DESC']],
  });
};

// Cria uma notificação. Se 'userId' não for fornecido, tenta atribuí-la ao primeiro administrador encontrado.
const createNotification = async (notificationData) => {
  let targetUserId = notificationData.userId;

  // Se nenhum userId específico for fornecido para a notificação
  if (!targetUserId) {
    // Tenta encontrar o primeiro usuário com a role 'admin'
    const adminUser = await User.findOne({ where: { role: 'admin' }, order: [['id', 'ASC']] });
    if (adminUser) {
      targetUserId = adminUser.id;
    } else {
      console.warn("Nenhum usuário administrador encontrado para atribuir a notificação. Notificação não será criada.");
      return null; // Não cria a notificação se não houver para quem atribuir
    }
  }

  return await Notification.create({ ...notificationData, userId: targetUserId });
};

// Marca notificações como lidas. Admins podem marcar como lidas as notificações globais e as suas.
const markAllAsRead = async (userId, userRole) => {
  const whereClause = {};
  if (userRole === 'admin') {
     whereClause[Op.or] = [{ userId: null }, { userId: userId }];
  } else {
    whereClause.userId = userId;
  }
  return await Notification.update({ isRead: true }, { where: whereClause });
};

module.exports = { findUnreadNotifications, markAllAsRead, createNotification };
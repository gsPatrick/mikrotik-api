// src/features/public/public.service.js
const { HotspotUser, Profile } = require('../../models');

/**
 * Busca os dados de uso de um usuário do hotspot pelo seu username.
 * Retorna um conjunto limitado de dados para segurança.
 */
const checkUsageByUsername = async (username) => {
  if (!username) {
    throw new Error('O nome de usuário é obrigatório.');
  }

  const hotspotUser = await HotspotUser.findOne({
    where: { username: username },
    include: [{
      model: Profile,
      as: 'profile',
      attributes: ['name']
    }],
    attributes: ['username', 'creditsTotal', 'creditsUsed', 'status', 'turma'],
  });

  return hotspotUser;
};

module.exports = {
  checkUsageByUsername,
};
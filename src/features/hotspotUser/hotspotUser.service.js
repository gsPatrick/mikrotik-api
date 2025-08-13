// src/features/hotspotUser/hotspotUser.service.js
const { Op } = require('sequelize');
const { HotspotUser, Company, Profile, ConnectionLog, Settings } = require('../../models');
const { createMikrotikClient } = require('../../config/mikrotik');
const { sendCreditExhaustedEmail } = require('../../services/email.service');
const { createActivityLog } = require('../activity/activity.service'); // Adicionar esta importação

const findAllHotspotUsers = async (options) => {
  const { page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'DESC', ...filters } = options;

  const where = {};
  if (filters.username) where.username = { [Op.iLike]: `%${filters.username}%` };
  if (filters.turma) where.turma = { [Op.iLike]: `%${filters.turma}%` };
  if (filters.status) where.status = filters.status;
  if (filters.companyId) where.companyId = filters.companyId;
  if (filters.profileId) where.profileId = filters.profileId;

  if (filters.startDate && filters.endDate) {
    where.createdAt = {
      [Op.between]: [new Date(filters.startDate), new Date(filters.endDate)],
    };
  } else if (filters.startDate) {
    where.createdAt = { [Op.gte]: new Date(filters.startDate) };
  } else if (filters.endDate) {
    where.createdAt = { [Op.lte]: new Date(filters.endDate) };
  }

  const offset = (page - 1) * limit;

  return await HotspotUser.findAndCountAll({
    where,
    include: [
      { model: Company, as: 'company', attributes: ['id', 'name'] },
      { model: Profile, as: 'profile', attributes: ['id', 'name'] },
    ],
    limit,
    offset,
    order: [[sortBy, sortOrder]],
  });
};

const createHotspotUser = async (hotspotUserData) => {
  const company = await Company.findByPk(hotspotUserData.companyId);
  const profile = await Profile.findByPk(hotspotUserData.profileId);
  if (!company) throw new Error('Empresa especificada não foi encontrada.');
  if (!profile) throw new Error('Perfil especificado não foi encontrado.');

  const mikrotikClient = createMikrotikClient(company);
  const startTime = Date.now();

  try {
    const response = await mikrotikClient.put('/ip/hotspot/user', {
      server: 'all',
      name: hotspotUserData.username,
      password: hotspotUserData.password,
      profile: profile.mikrotikName,
      comment: hotspotUserData.turma || '',
    });

    await ConnectionLog.create({
      action: 'createHotspotUser_Mikrotik',
      status: 'success',
      message: `Usuário ${hotspotUserData.username} criado com sucesso no MikroTik.`,
      responseTime: Date.now() - startTime,
      companyId: company.id
    });
    
    hotspotUserData.mikrotikId = response.data['.id'];
    return await HotspotUser.create(hotspotUserData);

  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    await ConnectionLog.create({
      action: 'createHotspotUser_Mikrotik',
      status: 'error',
      message: errorMessage,
      responseTime: Date.now() - startTime,
      companyId: company.id
    });
    throw new Error(`Falha ao criar usuário no MikroTik: ${errorMessage}`);
  }
};

const findHotspotUserById = async (id) => {
  return await HotspotUser.findByPk(id, {
    include: [
      { model: Company, as: 'company', attributes: ['id', 'name'] },
      { model: Profile, as: 'profile', attributes: ['id', 'name'] },
    ],
  });
};

const updateHotspotUser = async (id, hotspotUserData) => {
  const hotspotUser = await findHotspotUserById(id);
  if (!hotspotUser) return null;
  
  const company = await Company.findByPk(hotspotUser.companyId);
  const mikrotikClient = createMikrotikClient(company);
  const startTime = Date.now();

  try {
    const payload = {};
    if (hotspotUserData.password) payload.password = hotspotUserData.password;
    if (hotspotUserData.profileId) {
        const newProfile = await Profile.findByPk(hotspotUserData.profileId);
        if (!newProfile) throw new Error('Novo perfil não encontrado.');
        payload.profile = newProfile.mikrotikName;
    }
    if (hotspotUserData.turma) payload.comment = hotspotUserData.turma;

    if (Object.keys(payload).length > 0) {
        await mikrotikClient.patch(`/ip/hotspot/user/${hotspotUser.mikrotikId}`, payload);
    }
    
    await ConnectionLog.create({ action: 'updateHotspotUser_Mikrotik', status: 'success', message: `Usuário ${hotspotUser.username} atualizado.`, responseTime: Date.now() - startTime, companyId: company.id });

    return await hotspotUser.update(hotspotUserData);
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    await ConnectionLog.create({ action: 'updateHotspotUser_Mikrotik', status: 'error', message: errorMessage, responseTime: Date.now() - startTime, companyId: company.id });
    throw new Error(`Falha ao atualizar usuário no MikroTik: ${errorMessage}`);
  }
};

const deleteHotspotUser = async (id) => {
  const hotspotUser = await findHotspotUserById(id);
  if (!hotspotUser) return null;
  
  const company = await Company.findByPk(hotspotUser.companyId);
  const mikrotikClient = createMikrotikClient(company);
  const startTime = Date.now();

  try {
    await mikrotikClient.delete(`/ip/hotspot/user/${hotspotUser.mikrotikId}`);
    
    await ConnectionLog.create({ action: 'deleteHotspotUser_Mikrotik', status: 'success', message: `Usuário ${hotspotUser.username} deletado do MikroTik.`, responseTime: Date.now() - startTime, companyId: company.id });
    
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    if (errorMessage.includes('no such item')) {
      await ConnectionLog.create({ action: 'deleteHotspotUser_Mikrotik', status: 'success', message: `Usuário ${hotspotUser.username} já não existia no MikroTik, removendo do banco de dados local.`, responseTime: Date.Now() - startTime, companyId: company.id }); // Corrigido Date.Now()
    } else {
      await ConnectionLog.create({ action: 'deleteHotspotUser_Mikrotik', status: 'error', message: errorMessage, responseTime: Date.now() - startTime, companyId: company.id });
      throw new Error(`Falha ao deletar usuário no MikroTik: ${errorMessage}`);
    }
  }

  await hotspotUser.destroy();
  return hotspotUser;
};

const resetDailyCreditsForAllUsers = async () => {
    console.log(`--- Iniciando job: Reset Diário de Créditos ---`);
    const settings = await Settings.findByPk(1);
    if (!settings) {
        console.error('FALHA no reset: Configurações do sistema não encontradas.');
        return;
    }

    const newCreditTotalBytes = settings.defaultDailyCreditMB * 1024 * 1024;

    try {
        const [affectedCount] = await HotspotUser.update(
            { 
                creditsUsed: 0,
                creditsTotal: newCreditTotalBytes,
                status: 'active' // Reativa usuários que podem ter ficado sem crédito
            },
            { where: {} } // Aplica a todos os usuários de hotspot
        );

        console.log(`[${new Date().toISOString()}] SUCESSO no reset. ${affectedCount} usuários tiveram seus créditos resetados para ${settings.defaultDailyCreditMB} MB.`);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] FALHA no reset de créditos. Erro: ${error.message}`);
    }
    console.log(`--- Finalizado job: Reset Diário de Créditos ---`);
};

// --- INÍCIO DA FUNÇÃO updateCredits (AJUSTADA) ---
const updateCredits = async (userId, creditData, performingUser) => { // Recebe performingUser
  const hotspotUser = await findHotspotUserById(userId);
  if (!hotspotUser) {
    throw new Error('Usuário do hotspot não encontrado.');
  }

  const company = await Company.findByPk(hotspotUser.companyId);
  if (!company) {
    throw new Error('Empresa associada ao usuário não encontrada.');
  }

  const mikrotikClient = createMikrotikClient(company);
  const startTime = Date.now();

  const dataToUpdateInDb = {};
  const dataToUpdateInMikrotik = {};

  const oldCreditsTotal = hotspotUser.creditsTotal;
  const oldCreditsUsed = hotspotUser.creditsUsed;
  let activityDescriptionPart = ""; // Para a descrição do ActivityLog

  // Verifica se creditsTotal foi fornecido
  if (creditData.creditsTotal !== undefined) {
    dataToUpdateInDb.creditsTotal = creditData.creditsTotal;
    const oldTotalMB = (oldCreditsTotal / (1024 * 1024)).toFixed(2);
    const newTotalMB = (creditData.creditsTotal / (1024 * 1024)).toFixed(2);

    if (creditData.creditsTotal > oldCreditsTotal) {
      const addedBytes = creditData.creditsTotal - oldCreditsTotal;
      activityDescriptionPart += `adicionou ${(addedBytes / (1024 * 1024)).toFixed(2)} MB ao crédito total (novo total: ${newTotalMB} MB)`;
    } else if (creditData.creditsTotal < oldCreditsTotal) {
       const removedBytes = oldCreditsTotal - creditData.creditsTotal;
       activityDescriptionPart += `removeu ${(removedBytes / (1024 * 1024)).toFixed(2)} MB do crédito total (novo total: ${newTotalMB} MB)`;
    } else {
      activityDescriptionPart += `ajustou o crédito total para ${newTotalMB} MB`;
    }
  }

  // Verifica se creditsUsed foi fornecido ou se deve ser resetado implicitamente
  // O reset ocorre se creditsUsed é explicitamente 0 ou se creditsTotal foi atualizado e creditsUsed não foi fornecido.
  if (creditData.creditsUsed === 0 || (creditData.creditsTotal !== undefined && creditData.creditsUsed === undefined)) {
      dataToUpdateInDb.creditsUsed = 0;
      dataToUpdateInMikrotik['reset-counters'] = 'yes'; // Resetar no MikroTik
      if (activityDescriptionPart) {
          activityDescriptionPart += " e resetou o consumo utilizado";
      } else {
          activityDescriptionPart += "resetou o consumo utilizado";
      }
      // Reativa o usuário se o status atual for 'expired' e o consumo foi resetado
      if (hotspotUser.status === 'expired') {
        dataToUpdateInDb.status = 'active';
        if (activityDescriptionPart) {
          activityDescriptionPart += " e reativou o usuário";
        } else {
          activityDescriptionPart += "reativou o usuário";
        }
      }
  } else if (creditData.creditsUsed !== undefined) { // Se creditsUsed foi fornecido e não é 0
      dataToUpdateInDb.creditsUsed = creditData.creditsUsed;
      const oldUsedMB = (oldCreditsUsed / (1024 * 1024)).toFixed(2);
      const newUsedMB = (creditData.creditsUsed / (1024 * 1024)).toFixed(2);
      if (activityDescriptionPart) {
          activityDescriptionPart += `, e ajustou o consumo utilizado para ${newUsedMB} MB`;
      } else {
          activityDescriptionPart += `ajustou o consumo utilizado para ${newUsedMB} MB`;
      }
      // Não resetamos os contadores no MikroTik se apenas o valor de uso é ajustado para um valor diferente de zero.
      // O reset só ocorre se for para zero para sincronizar.
  }
  
  try {
    // 1. Atualiza no MikroTik (reseta os contadores se aplicável)
    // Nota: O MikroTik não tem um conceito direto de "crédito total/usado" como no seu sistema.
    // O comando 'reset-counters' apenas zera os contadores de bytes-in/out.
    // O controle de desativação por crédito é feito pelo seu sistema no job de coleta de uso.
    if (dataToUpdateInMikrotik['reset-counters']) {
      await mikrotikClient.post(`/ip/hotspot/user/${hotspotUser.mikrotikId}`, {
          ".id": hotspotUser.mikrotikId,
          "reset-counters": "yes"
      });
      console.log(`Contadores de uso do usuário ${hotspotUser.username} resetados no MikroTik.`);
    }

    // 2. Atualiza no nosso banco de dados
    const updatedUser = await hotspotUser.update(dataToUpdateInDb);
    
    // Log da conexão com o MikroTik (se houve alguma interação com o MikroTik para esta ação)
    if (Object.keys(dataToUpdateInMikrotik).length > 0) { // Loga apenas se houve alguma ação no MikroTik
      await ConnectionLog.create({
        action: 'updateCredits_MikrotikCounters', // Nome mais específico para o log de conexão
        status: 'success',
        message: `Contadores de uso do usuário '${hotspotUser.username}' resetados no MikroTik.`,
        responseTime: Date.now() - startTime, // Corrigido Date.now()
        companyId: company.id,
      });
    }

    // 3. Log da Atividade para o Dashboard/Atividades Recentes
    if (performingUser && activityDescriptionPart) {
        const finalDescription = `Usuário '${performingUser.name}' ${activityDescriptionPart} para o usuário hotspot '${hotspotUser.username}' da empresa '${company.name}'.`;
        await createActivityLog({
            userId: performingUser.id,
            type: 'hotspot_user_credit', // Um novo tipo mais específico
            description: finalDescription,
        });
    }
    
    return updatedUser;
    
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    await ConnectionLog.create({ 
        action: 'updateCredits_MikrotikCounters', 
        status: 'error', 
        message: `Falha ao resetar contadores no MikroTik: ${errorMessage}`, 
        responseTime: Date.now() - startTime, // Corrigido Date.now()
        companyId: company.id 
    });
    // Se o erro foi no MikroTik, ainda logamos a atividade se possível no DB local
    if (performingUser && activityDescriptionPart) {
        const finalDescription = `Usuário '${performingUser.name}' tentou ${activityDescriptionPart} para o usuário hotspot '${hotspotUser.username}' da empresa '${company.name}', mas houve falha no MikroTik: ${errorMessage}`;
        await createActivityLog({
            userId: performingUser.id,
            type: 'hotspot_user_credit_error', // Outro tipo para erros
            description: finalDescription,
        });
    }
    throw new Error(`Falha ao atualizar créditos no banco de dados e/ou MikroTik: ${errorMessage}`);
  }
};
// --- FIM DA FUNÇÃO updateCredits ---


module.exports = {
  findAllHotspotUsers,
  createHotspotUser,
  findHotspotUserById,
  updateHotspotUser,
  deleteHotspotUser,
  resetDailyCreditsForAllUsers,
  updateCredits
};
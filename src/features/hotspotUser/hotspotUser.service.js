// src/features/hotspotUser/hotspotUser.service.js
const { Op } = require('sequelize');
const { HotspotUser, Company, Profile, ConnectionLog, Settings } = require('../../models');
const { createMikrotikClient } = require('../../config/mikrotik');
const { sendCreditExhaustedEmail } = require('../../services/email.service');
const bcrypt = require('bcryptjs');
const { writeSyncLog } = require('../../services/syncLog.service');
const { createActivityLog } = require('../activity/activity.service');

const findAllHotspotUsers = async (options) => {
  const { page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'DESC', ...filters } = options;

  const where = {};
  if (filters.username) where.username = { [Op.iLike]: `%${filters.username}%` };
  if (filters.turma) where.turma = { [Op.iLike]: `%${filters.turma}%` };
  if (filters.status) where.status = filters.status;
  if (filters.companyId) where.companyId = filters.companyId;
  if (filters.profileId) where.profileId = filters.profileId;

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
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(hotspotUserData.password, salt);

    const response = await mikrotikClient.put('/ip/hotspot/user', {
      server: 'all',
      name: hotspotUserData.username,
      password: hotspotUserData.password,
      profile: profile.mikrotikName,
      comment: hotspotUserData.turma || '',
    }, { // <-- ADICIONAR ESTE SEGUNDO OBJETO DE CONFIGURAÇÃO
        headers: {
            'Content-Type': 'application/json'
        }
    });

    await ConnectionLog.create({
      action: 'createHotspotUser_Mikrotik', status: 'success',
      message: `Usuário ${hotspotUserData.username} criado com sucesso no MikroTik.`,
      responseTime: Date.now() - startTime, companyId: company.id
    });
    
    hotspotUserData.password = hashedPassword;
    hotspotUserData.mikrotikId = response.data['.id'];
    return await HotspotUser.create(hotspotUserData);

  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    await ConnectionLog.create({
      action: 'createHotspotUser_Mikrotik', status: 'error',
      message: errorMessage, responseTime: Date.now() - startTime, companyId: company.id
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
        // 1. Preparar o payload para enviar ao MikroTik
        const payload = {};
        
        // Se uma nova senha foi enviada, adiciona ao payload do MikroTik
        if (hotspotUserData.password && hotspotUserData.password.length > 0) {
            payload.password = hotspotUserData.password;
        }

        // Se um novo perfil foi enviado, busca o nome do perfil no MikroTik e adiciona ao payload
        if (hotspotUserData.profileId) {
            const newProfile = await Profile.findByPk(hotspotUserData.profileId);
            if (!newProfile) throw new Error('Novo perfil não encontrado.');
            payload.profile = newProfile.mikrotikName;
        }

        // Se a turma foi alterada, atualiza o 'comment' no MikroTik
        // A turma é uma lógica do seu sistema, mas a armazenamos no campo 'comment' do MikroTik para consistência.
        if (hotspotUserData.turma) {
             payload.comment = hotspotUserData.turma;
        }

        // Se o status foi alterado (ex: de 'active' para 'inactive')
        if (hotspotUserData.status) {
            payload.disabled = (hotspotUserData.status === 'inactive' || hotspotUserData.status === 'expired') ? 'true' : 'false';
        }

        // 2. Enviar a requisição PATCH para o MikroTik se houver algo para atualizar
        if (Object.keys(payload).length > 0) {
            console.log(`[Update User] Sincronizando atualizações para '${hotspotUser.username}' no MikroTik. Payload:`, payload);
            
            // --- A CORREÇÃO ESTÁ AQUI ---
            // Usamos o método PATCH com o cabeçalho Content-Type explícito.
            await mikrotikClient.patch(`/ip/hotspot/user/${hotspotUser.mikrotikId}`, 
                payload, // O corpo da requisição com os dados a serem alterados
                {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );
            // --- FIM DA CORREÇÃO ---
        }

        // 3. Preparar os dados para salvar no nosso banco de dados local
        // Se uma nova senha foi enviada, precisamos gerar o hash antes de salvar.
        if (hotspotUserData.password && hotspotUserData.password.length > 0) {
            const salt = await bcrypt.genSalt(10);
            hotspotUserData.password = await bcrypt.hash(hotspotUserData.password, salt);
        } else {
            // Garante que não salvemos uma senha vazia se ela não foi enviada
            delete hotspotUserData.password;
        }

        // 4. Salvar as alterações no nosso banco de dados
        const updatedUser = await hotspotUser.update(hotspotUserData);
        
        await ConnectionLog.create({ action: 'updateHotspotUser_Mikrotik', status: 'success', message: `Usuário ${hotspotUser.username} atualizado com sucesso.`, responseTime: Date.now() - startTime, companyId: company.id });

        return updatedUser;

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
      await ConnectionLog.create({ action: 'deleteHotspotUser_Mikrotik', status: 'success', message: `Usuário ${hotspotUser.username} já não existia no MikroTik.`, responseTime: Date.now() - startTime, companyId: company.id });
    } else {
      await ConnectionLog.create({ action: 'deleteHotspotUser_Mikrotik', status: 'error', message: errorMessage, responseTime: Date.now() - startTime, companyId: company.id });
      throw new Error(`Falha ao deletar usuário no MikroTik: ${errorMessage}`);
    }
  }

  await hotspotUser.destroy();
  return hotspotUser;
};

// --- INÍCIO DA FUNÇÃO CORRIGIDA E INTELIGENTE ---
const resetDailyCreditsForAllUsers = async () => {
    console.log(`--- Iniciando job: Reset Diário de Créditos Inteligente ---`);
    const settings = await Settings.findByPk(1);
    if (!settings) {
        console.error('FALHA no reset: Configurações do sistema não encontradas.');
        return;
    }

    const newCreditTotalBytes = settings.defaultDailyCreditMB * 1024 * 1024;

    try {
        // 1. Pega todas as empresas e cria um mapa para fácil acesso à turma ativa
        const companies = await Company.findAll();
        const companyTurmaMap = new Map(companies.map(c => [c.id, c.activeTurma]));

        // 2. Busca todos os usuários com suas empresas associadas
        const allUsers = await HotspotUser.findAll({ include: [{ model: Company, as: 'company' }] });
        
        const usersToReset = [];
        for (const user of allUsers) {
            const activeTurma = companyTurmaMap.get(user.companyId) || 'Nenhuma';
            const userTurma = user.turma || 'Nenhuma';

            // 3. Regra: O usuário só é elegível para o reset se pertencer à turma ativa
            if (activeTurma === 'Nenhuma' || userTurma === activeTurma) {
                usersToReset.push(user);
            }
        }

        if (usersToReset.length === 0) {
            console.log("Nenhum usuário elegível para o reset de créditos hoje.");
            console.log(`--- Finalizado job: Reset Diário de Créditos Inteligente ---`);
            return;
        }

        // 4. Atualiza o banco de dados para os usuários elegíveis de uma só vez
        const userIdsToReset = usersToReset.map(u => u.id);
        const [affectedCount] = await HotspotUser.update(
            { 
                creditsUsed: 0,
                creditsTotal: newCreditTotalBytes,
                status: 'active'
            },
            { where: { id: { [Op.in]: userIdsToReset } } }
        );

        // 5. Agrupa usuários por empresa para reativá-los no MikroTik
        const usersByCompany = usersToReset.reduce((acc, user) => {
            if (user.company) {
                if (!acc[user.companyId]) {
                    acc[user.companyId] = { company: user.company, users: [] };
                }
                acc[user.companyId].users.push(user);
            }
            return acc;
        }, {});

        for (const companyId in usersByCompany) {
            const { company, users } = usersByCompany[companyId];
            const mikrotikClient = createMikrotikClient(company);
            for (const user of users) {
                if (user.mikrotikId) {
                    try {
                        // CORREÇÃO AQUI: Usar PATCH para habilitar o usuário
                        await mikrotikClient.patch(`/ip/hotspot/user/${user.mikrotikId}`, {
                            disabled: 'false' // Define o status como habilitado
                        }, {
                            headers: {
                                'Content-Type': 'application/json' // Garante o Content-Type correto
                            }
                        });
                    } catch (error) {
                        console.error(`[Reset] Falha ao reativar '${user.username}' no MikroTik de '${company.name}': ${error.message}`);
                    }
                }
            }
        }
        
        console.log(`[${new Date().toISOString()}] SUCESSO no reset. ${affectedCount} usuários elegíveis tiveram seus créditos resetados e foram reativados.`);

    } catch (error) {
        console.error(`[${new Date().toISOString()}] FALHA GERAL no reset de créditos. Erro: ${error.message}`);
    }
    console.log(`--- Finalizado job: Reset Diário de Créditos Inteligente ---`);
};
// --- FIM DA FUNÇÃO CORRIGIDA ---


const updateCredits = async (userId, creditData, performingUser) => {
  const hotspotUser = await findHotspotUserById(userId);
  if (!hotspotUser) throw new Error('Usuário do hotspot não encontrado.');

  const company = await Company.findByPk(hotspotUser.companyId);
  const mikrotikClient = createMikrotikClient(company);
  const action = 'updateCredits_MikrotikCounters';
  const startTime = Date.now();

  const dataToUpdateInDb = {};
  if (creditData.creditsTotal !== undefined) {
    dataToUpdateInDb.creditsTotal = creditData.creditsTotal;
    dataToUpdateInDb.creditsUsed = 0; // Se o total for atualizado, zera o usado
  }
  
  try {
    if (dataToUpdateInDb.creditsTotal !== undefined) {
        // CORREÇÃO AQUI: Enviar corpo JSON com .id e cabeçalho Content-Type
        await mikrotikClient.post('/ip/hotspot/user/reset-counters', {
            '.id': hotspotUser.mikrotikId // O ID do MikroTik que precisa ser resetado
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }

    const updatedUser = await hotspotUser.update(dataToUpdateInDb);
    
    await ConnectionLog.create({
      action, status: 'success',
      message: `Créditos de '${hotspotUser.username}' atualizados por '${performingUser.name}'. Novo total: ${dataToUpdateInDb.creditsTotal / (1024*1024)} MB.`,
      responseTime: Date.now() - startTime, companyId: company.id,
    });
    
    await createActivityLog({
        userId: performingUser.id, type: 'hotspot_user_credit',
        description: `O crédito do usuário '${hotspotUser.username}' foi alterado para ${dataToUpdateInDb.creditsTotal / (1024*1024)}MB.`
    });
    
    return updatedUser;
    
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    await ConnectionLog.create({
      action, status: 'error',
      message: `Falha ao resetar contadores no MikroTik para '${hotspotUser.username}': ${errorMessage}`,
      responseTime: Date.now() - startTime, companyId: company.id,
    });
    throw new Error(`Falha ao resetar contadores no MikroTik: ${errorMessage}`);
  }
};

module.exports = {
  findAllHotspotUsers,
  createHotspotUser,
  findHotspotUserById,
  updateHotspotUser,
  deleteHotspotUser,
  resetDailyCreditsForAllUsers,
  updateCredits,
};
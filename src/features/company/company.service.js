// src/features/company/company.service.js
const { Op, fn, col } = require('sequelize');
const { Company, HotspotUser, ConnectionLog, User } = require('../../models');
const db = require('../../models');
const { createMikrotikClient } = require('../../config/mikrotik');
const { writeSyncLog } = require('../../services/syncLog.service');
const { createActivityLog } = require('../activity/activity.service');
const mikrotikService = require('../mikrotik/mikrotik.service');
const { createNotification } = require('../notification/notification.service');

const findAllCompanies = async (options) => {
  const { page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'DESC', ...filters } = options;
  const where = {};
  if (filters.name) where.name = { [Op.iLike]: `%${filters.name}%` };
  if (filters.status && filters.status !== 'all') where.status = filters.status;
  const offset = (page - 1) * limit;

  return await Company.findAndCountAll({
    where,
    limit,
    offset,
    order: [[sortBy, sortOrder]],
    include: [{
      model: HotspotUser,
      as: 'hotspotUsers',
      attributes: [],
      where: { status: 'active' },
      duplicating: false,
      required: false
    }],
    attributes: {
      include: [
        [fn('COUNT', col('hotspotUsers.id')), 'activeUsersCount']
      ]
    },
    group: ['Company.id'],
    subQuery: false
  });
};

const findCompanyById = async (id) => {
  return await Company.findByPk(id);
};

const createCompany = async (companyData, userId) => {
  const company = await Company.create(companyData);
  await createActivityLog({
    userId: userId,
    type: 'company',
    description: `Empresa '${company.name}' foi criada.`,
  });
  try {
    await module.exports.testCompanyConnection(company.id);
    await company.update({ status: 'online' });
    await createNotification({
        description: `Empresa '${company.name}' criada e conectada com sucesso.`,
        type: 'sucesso',
        details: `IP do MikroTik: ${company.mikrotikIp}`,
        userId: null
    });
  } catch (error) {
    await company.update({ status: 'offline' });
    console.warn(`[Status Sync] Falha ao conectar com a nova empresa '${company.name}'. Status: offline. Erro: ${error.message}`);
    await createNotification({
        description: `Empresa '${company.name}' criada, mas falha ao conectar com o MikroTik.`,
        type: 'erro',
        details: `IP do MikroTik: ${company.mikrotikIp}. Erro: ${error.message}`,
        userId: null
    });
  }
  return company;
};

const updateCompany = async (id, companyData, userId) => {
  const company = await module.exports.findCompanyById(id);
  if (!company) return null;

  const oldMikrotikIp = company.mikrotikIp;
  const oldMikrotikApiUser = company.mikrotikApiUser;
  const oldMikrotikApiPass = company.mikrotikApiPass;
  const oldMikrotikApiPort = company.mikrotikApiPort;

  const updatedCompany = await company.update(companyData);

  await createActivityLog({
    userId: userId,
    type: 'company',
    description: `Empresa '${updatedCompany.name}' foi atualizada.`,
  });

  if (
    oldMikrotikIp !== updatedCompany.mikrotikIp ||
    oldMikrotikApiUser !== updatedCompany.mikrotikApiUser ||
    (companyData.mikrotikApiPass && companyData.mikrotikApiPass.length > 0) ||
    oldMikrotikApiPort !== updatedCompany.mikrotikApiPort
  ) {
    try {
        await module.exports.testCompanyConnection(updatedCompany.id);
        await updatedCompany.update({ status: 'online' });
        await createNotification({
            description: `Configurações de conexão da empresa '${updatedCompany.name}' atualizadas e testadas com sucesso.`,
            type: 'sucesso',
            details: `Novo IP: ${updatedCompany.mikrotikIp}`,
            userId: null
        });
    } catch (error) {
        await updatedCompany.update({ status: 'offline' });
        await createNotification({
            description: `Configurações de conexão da empresa '${updatedCompany.name}' atualizadas, mas falha ao reconectar.`,
            type: 'erro',
            details: `IP: ${updatedCompany.mikrotikIp}. Erro: ${error.message}`,
            userId: null
        });
    }
  }

  return updatedCompany;
};

const deleteCompany = async (id, userId) => {
  const company = await module.exports.findCompanyById(id);
  if (!company) return null;
  const companyName = company.name;
  await company.destroy();
  await createActivityLog({
    userId: userId,
    type: 'company',
    description: `Empresa '${companyName}' foi deletada.`,
  });
  await createNotification({
      description: `Empresa '${companyName}' foi deletada do sistema.`,
      type: 'aviso',
      details: `Ação realizada por: ${(await User.findByPk(userId))?.name || 'Sistema'}.`,
      userId: null
  });
  return company;
};

const testCompanyConnection = async (id) => {
  const company = await module.exports.findCompanyById(id);
  if (!company) throw new Error('Empresa não encontrada.');
  const mikrotikClient = createMikrotikClient(company);
  const startTime = Date.now();
  const action = 'testConnection';
  try {
    await mikrotikClient.get('/system/identity');
    await ConnectionLog.create({ 
      action, 
      status: 'success', 
      message: 'Teste de conexão bem-sucedido.', 
      responseTime: Date.now() - startTime, 
      companyId: id, 
    });
    return { success: true, message: 'Conexão com o MikroTik bem-sucedida!' };
  } catch (error) {
    let friendlyMessage = 'Erro desconhecido.';
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') { 
      friendlyMessage = 'Não foi possível resolver o IP ou a porta está sendo recusada. Verifique o IP/Porta e o firewall do MikroTik.'; 
    }
    else if (error.response?.status === 401) { 
      friendlyMessage = 'Credenciais inválidas. Verifique o usuário e senha da API.'; 
    }
    else { 
      friendlyMessage = error.response?.data?.message || error.message; 
    }
    await ConnectionLog.create({ 
      action, 
      status: 'error', 
      message: friendlyMessage, 
      responseTime: Date.now() - startTime, 
      companyId: id, 
    });
    await createNotification({
        description: `Falha na conexão com o MikroTik da empresa '${company.name}' (IP: ${company.mikrotikIp}).`,
        type: 'erro',
        details: `Detalhes: ${friendlyMessage}`,
        userId: null
    });
    throw new Error(friendlyMessage);
  }
};

const setCompanyActiveTurma = async (companyId, newActiveTurma, userId) => {
  const company = await module.exports.findCompanyById(companyId);
  if (!company) throw new Error('Empresa não encontrada.');
  const oldActiveTurma = company.activeTurma;
  if (oldActiveTurma === newActiveTurma) return company;
  
  await company.update({ activeTurma: newActiveTurma });

  await createActivityLog({
    userId: userId,
    type: 'company',
    description: `Turma ativa da empresa '${company.name}' alterada de '${oldActiveTurma}' para '${newActiveTurma}'.`,
  });
  
  await createNotification({
      description: `Turma ativa da empresa '${company.name}' alterada para '${newActiveTurma}'.`,
      type: 'info',
      details: `Ação realizada por: ${(await User.findByPk(userId))?.name || 'Sistema'}.`,
      userId: null
  });

  await module.exports.syncHotspotUserStatusByTurma(companyId, newActiveTurma);
  return company;
};

// CORREÇÃO PRINCIPAL: Função para sincronizar status dos usuários por turma
const syncHotspotUserStatusByTurma = async (companyId, activeTurma) => {
    const company = await module.exports.findCompanyById(companyId);
    if (!company) throw new Error('Empresa não encontrada.');
    
    const mikrotikClient = createMikrotikClient(company);
    const hotspotUsersInSystem = await db.HotspotUser.findAll({ where: { companyId } });

    let activatedCount = 0;
    let deactivatedCount = 0;
    let skippedCount = 0;
    const startTime = Date.now();

    console.log(`[Sync Turma] Iniciando sincronização para empresa '${company.name}'. Turma ativa: '${activeTurma}'. Total de usuários: ${hotspotUsersInSystem.length}`);

    for (const user of hotspotUsersInSystem) {
        if (!user.mikrotikId) {
            console.warn(`[Sync Turma] Usuário '${user.username}' não possui mikrotikId. Pulando...`);
            skippedCount++;
            continue;
        }
        
        const userTurma = user.turma || 'Nenhuma';
        const shouldBeActive = activeTurma === 'Nenhuma' || userTurma === activeTurma;

        console.log(`[Sync Turma] Usuário: ${user.username}, Turma: ${userTurma}, Deveria estar ativo: ${shouldBeActive}, Status atual: ${user.status}`);

        try {
            if (shouldBeActive) {
                // Ativa se for para estar ativo E o status atual não for 'active'
                if (user.status !== 'active') {
                    console.log(`[Sync Turma] Ativando usuário '${user.username}' no MikroTik...`);
                    
                    // CORREÇÃO: Usar POST com /set
                    await mikrotikClient.post('/ip/hotspot/user/set', {
                        '.id': user.mikrotikId,
                        disabled: 'false'
                    }, {
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    await user.update({ status: 'active' });
                    activatedCount++;
                    console.log(`[Sync Turma] ✅ Usuário '${user.username}' ativado com sucesso.`);
                } else {
                    console.log(`[Sync Turma] Usuário '${user.username}' já está ativo. Nenhuma ação necessária.`);
                }
            } else {
                // Desativa se não for para estar ativo E o status atual não for 'inactive'
                if (user.status !== 'inactive') {
                    console.log(`[Sync Turma] Desativando usuário '${user.username}' no MikroTik...`);
                    
                    // CORREÇÃO: Usar POST com /set
                    await mikrotikClient.post('/ip/hotspot/user/set', {
                        '.id': user.mikrotikId,
                        disabled: 'yes'
                    }, {
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    await user.update({ status: 'inactive' });
                    deactivatedCount++;
                    console.log(`[Sync Turma] ❌ Usuário '${user.username}' desativado com sucesso.`);
                } else {
                    console.log(`[Sync Turma] Usuário '${user.username}' já está inativo. Nenhuma ação necessária.`);
                }
            }
        } catch (error) {
            const errorMessage = error.response?.data?.message || error.message;
            console.error(`[Sync Turma] ⚠️  Falha ao ajustar status de '${user.username}' na empresa '${company.name}': ${errorMessage}`);
            
            // Log de erro no ConnectionLog
            await ConnectionLog.create({
                action: 'syncHotspotUserStatusByTurma',
                status: 'error',
                message: `Falha ao ajustar status do usuário '${user.username}': ${errorMessage}`,
                responseTime: Date.now() - startTime,
                companyId: company.id
            });
            
            await createNotification({
                description: `Falha ao ajustar status do usuário '${user.username}' na empresa '${company.name}' pela turma.`,
                type: 'erro',
                details: `Erro: ${errorMessage}. Usuário ${shouldBeActive ? 'deveria ser ATIVO' : 'deveria ser INATIVO'}.`,
                userId: null
            });
        }
    }

    // Log de sucesso
    await ConnectionLog.create({
        action: 'syncHotspotUserStatusByTurma',
        status: 'success',
        message: `Sincronização por turma concluída. Ativados: ${activatedCount}, Desativados: ${deactivatedCount}, Pulados: ${skippedCount}`,
        responseTime: Date.now() - startTime,
        companyId: company.id
    });

    console.log(`[Sync Turma] ✅ Sincronização concluída para empresa '${company.name}'. Ativados: ${activatedCount}, Desativados: ${deactivatedCount}, Pulados: ${skippedCount}`);

    await createNotification({
        description: `Sincronização de status de usuários por turma concluída para a empresa '${company.name}'.`,
        type: 'info',
        details: `Ativados: ${activatedCount}. Desativados: ${deactivatedCount}. Turma Ativa: ${activeTurma}. Usuários sem ID: ${skippedCount}.`,
        userId: null
    });
};

const syncAllDataForCompany = async (companyId) => {
    console.log(`[Sync Service] Orquestrando sincronização para a empresa ID: ${companyId}`);
    const company = await Company.findByPk(companyId);
    if (!company) throw new Error('Empresa não encontrada.');

    try {
        writeSyncLog(`[Sync Geral][${company.name}] Iniciando sincronização completa para a empresa '${company.name}'...`);
        const profilesResult = await mikrotikService.importProfilesFromMikrotik(companyId);
        const usersResult = await mikrotikService.importUsersFromMikrotik(companyId);
        writeSyncLog(`[Sync Geral][${company.name}] Sincronização completa para a empresa '${company.name}' finalizada com sucesso.`);
        await createNotification({
            description: `Sincronização manual completa da empresa '${company.name}' concluída.`,
            type: 'sucesso',
            details: `Perfis: ${profilesResult.importedCount} novos, ${profilesResult.updatedCount} atualizados. Usuários: ${usersResult.importedCount} novos, ${usersResult.updatedCount} atualizados.`,
            userId: null
        });
        return { profilesResult, usersResult };
    } catch (error) {
        writeSyncLog(`[Sync Geral][${company.name}] ERRO na sincronização completa: ${error.message}`);
        await createNotification({
            description: `Falha na sincronização manual completa da empresa '${company.name}'.`,
            type: 'erro',
            details: `Erro: ${error.message}`,
            userId: null
        });
        throw error;
    }
};

// --- INÍCIO DA NOVA FUNÇÃO ---
const bulkAddCredits = async (companyId, creditAmountMB, performingUserId) => {
  const company = await findCompanyById(companyId);
  if (!company) throw new Error('Empresa não encontrada.');

  const creditAmountBytes = creditAmountMB * 1024 * 1024;
  if (creditAmountBytes <= 0) throw new Error('A quantidade de crédito deve ser positiva.');

  const mikrotikClient = createMikrotikClient(company);
  const users = await HotspotUser.findAll({ where: { companyId } });

  if (users.length === 0) {
    return {
      success: true,
      message: 'Nenhum usuário encontrado para esta empresa. Nenhuma ação foi tomada.',
      stats: { updatedCount: 0, reactivatedCount: 0, errorCount: 0 }
    };
  }
  
  console.log(`[BULK CREDIT] Iniciando adição de ${creditAmountMB}MB para ${users.length} usuários da empresa '${company.name}'.`);

  let updatedCount = 0;
  let reactivatedCount = 0;
  let errorCount = 0;
  const errors = [];

  for (const user of users) {
    try {
      const dataToUpdate = {
        creditsTotal: creditAmountBytes,
        creditsUsed: 0
      };

      // Se o usuário estava expirado, reativa ele no MikroTik e no sistema local
      if (user.status === 'expired') {
        dataToUpdate.status = 'active';

        if (user.mikrotikId) {
          console.log(`[BULK CREDIT] Reativando usuário expirado '${user.username}' no MikroTik...`);
          const enablePayload = { '.id': user.mikrotikId, disabled: 'false' };
          await mikrotikClient.post('/ip/hotspot/user/set', enablePayload, { headers: { 'Content-Type': 'application/json' } });
          reactivatedCount++;
        }
      }
      
      // Reseta os contadores no MikroTik para garantir consistência
      if (user.mikrotikId) {
         const resetPayload = { '.id': user.mikrotikId };
         await mikrotikClient.post('/ip/hotspot/user/reset-counters', resetPayload, { headers: { 'Content-Type': 'application/json' } });
      }

      await user.update(dataToUpdate);
      updatedCount++;

    } catch (error) {
      const errorMessage = `Falha ao processar usuário '${user.username}': ${error.message}`;
      console.error(`[BULK CREDIT] ERRO: ${errorMessage}`);
      errors.push(errorMessage);
      errorCount++;
    }
  }

  // Loga a atividade em massa
  await createActivityLog({
    userId: performingUserId,
    type: 'company_bulk_credit',
    description: `Adicionou ${creditAmountMB}MB de crédito para ${updatedCount} usuários da empresa '${company.name}'.`
  });

  return {
    success: true,
    message: `Operação concluída para a empresa '${company.name}'.`,
    stats: {
      totalUsers: users.length,
      updatedCount,
      reactivatedCount,
      errorCount,
      errors
    }
  };
};

module.exports = {
  findAllCompanies,
  findCompanyById,
  createCompany,
  updateCompany,
  deleteCompany,
  testCompanyConnection,
  setCompanyActiveTurma,
  syncHotspotUserStatusByTurma,
  syncAllDataForCompany,
  bulkAddCredits
};
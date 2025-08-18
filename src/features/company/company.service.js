// src/features/company/company.service.js
const { Op, fn, col } = require('sequelize');
const { Company, HotspotUser, ConnectionLog, User } = require('../../models'); // Adicionado User
const db = require('../../models'); // Usado para acessar outros modelos como HotspotUser
const { createMikrotikClient } = require('../../config/mikrotik');
const { writeSyncLog } = require('../../services/syncLog.service'); // Geralmente usado para logs de sincronização MikroTik
const { createActivityLog } = require('../activity/activity.service'); // <-- Log de atividades do usuário no painel
const mikrotikService = require('../mikrotik/mikrotik.service'); // <-- Serviço MikroTik para orquestração
const { createNotification } = require('../notification/notification.service'); // <-- IMPORTANTE: Notificações

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
    // >>> CORREÇÃO AQUI: Incluir contagem de usuários ativos <<<
    include: [{
      model: HotspotUser,
      as: 'hotspotUsers', // O 'as' deve corresponder ao alias definido na relação em src/models/index.js
      attributes: [], // Não queremos os atributos dos usuários em si, apenas a contagem
      where: { status: 'active' }, // Apenas usuários ativos
      duplicating: false, // Importante para COUNT com includes
      required: false // LEFT JOIN para incluir empresas mesmo sem usuários ativos
    }],
    attributes: {
      include: [
        // Adiciona um atributo virtual 'activeUsersCount'
        [fn('COUNT', col('hotspotUsers.id')), 'activeUsersCount']
      ]
    },
    group: ['Company.id'], // Agrupa por Company.id para a contagem
    subQuery: false // Necessário quando se usa group com pagination
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
    await module.exports.testCompanyConnection(company.id); // Tenta conectar e atualiza o status
    await company.update({ status: 'online' });
    // Notificação de sucesso na criação e conexão
    await createNotification({
        description: `Empresa '${company.name}' criada e conectada com sucesso.`,
        type: 'sucesso',
        details: `IP do MikroTik: ${company.mikrotikIp}`,
        userId: null // Notificação para o admin
    });
  } catch (error) {
    await company.update({ status: 'offline' });
    console.warn(`[Status Sync] Falha ao conectar com a nova empresa '${company.name}'. Status: offline. Erro: ${error.message}`);
    // Notificação de falha na conexão da empresa recém-criada
    await createNotification({
        description: `Empresa '${company.name}' criada, mas falha ao conectar com o MikroTik.`,
        type: 'erro',
        details: `IP do MikroTik: ${company.mikrotikIp}. Erro: ${error.message}`,
        userId: null // Notificação para o admin
    });
  }
  return company;
};

const updateCompany = async (id, companyData, userId) => {
  const company = await module.exports.findCompanyById(id);
  if (!company) return null;

  // Guarda os dados antigos para verificação de mudança
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

  // Se os dados de conexão foram alterados, testar novamente e notificar
  if (
    oldMikrotikIp !== updatedCompany.mikrotikIp ||
    oldMikrotikApiUser !== updatedCompany.mikrotikApiUser ||
    (companyData.mikrotikApiPass && companyData.mikrotikApiPass.length > 0) || // Se a senha foi alterada
    oldMikrotikApiPort !== updatedCompany.mikrotikApiPort
  ) {
    try {
        await module.exports.testCompanyConnection(updatedCompany.id);
        await updatedCompany.update({ status: 'online' });
        await createNotification({
            description: `Configurações de conexão da empresa '${updatedCompany.name}' atualizadas e testadas com sucesso.`,
            type: 'sucesso',
            details: `Novo IP: ${updatedCompany.mikrotikIp}`,
            userId: null // Para o admin
        });
    } catch (error) {
        await updatedCompany.update({ status: 'offline' });
        await createNotification({
            description: `Configurações de conexão da empresa '${updatedCompany.name}' atualizadas, mas falha ao reconectar.`,
            type: 'erro',
            details: `IP: ${updatedCompany.mikrotikIp}. Erro: ${error.message}`,
            userId: null // Para o admin
        });
    }
  }

  return updatedCompany;
};

const deleteCompany = async (id, userId) => {
  const company = await module.exports.findCompanyById(id);
  if (!company) return null;
  const companyName = company.name; // Salva o nome antes de deletar
  await company.destroy();
  await createActivityLog({
    userId: userId,
    type: 'company',
    description: `Empresa '${companyName}' foi deletada.`,
  });
  await createNotification({ // Notificação de deleção de empresa
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
    await ConnectionLog.create({ action, status: 'success', message: 'Teste de conexão bem-sucedido.', responseTime: Date.now() - startTime, companyId: id, });
    // Notificação de sucesso na conexão (geralmente não necessária aqui para evitar spam,
    // a menos que seja um teste manual explícito)
    /* await createNotification({
        description: `Conexão com a empresa '${company.name}' testada com sucesso.`,
        type: 'sucesso',
        details: `IP: ${company.mikrotikIp}`,
        userId: null
    }); */
    return { success: true, message: 'Conexão com o MikroTik bem-sucedida!' };
  } catch (error) {
    let friendlyMessage = 'Erro desconhecido.';
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') { friendlyMessage = 'Não foi possível resolver o IP ou a porta está sendo recusada. Verifique o IP/Porta e o firewall do MikroTik.'; }
    else if (error.response?.status === 401) { friendlyMessage = 'Credenciais inválidas. Verifique o usuário e senha da API.'; }
    else { friendlyMessage = error.response?.data?.message || error.message; }
    await ConnectionLog.create({ action, status: 'error', message: friendlyMessage, responseTime: Date.now() - startTime, companyId: id, });
    // Notificação de falha de conexão
    await createNotification({
        description: `Falha na conexão com o MikroTik da empresa '${company.name}' (IP: ${company.mikrotikIp}).`,
        type: 'erro',
        details: `Detalhes: ${friendlyMessage}`,
        userId: null // Notificação para o admin
    });
    throw new Error(friendlyMessage);
  }
};

const setCompanyActiveTurma = async (companyId, newActiveTurma, userId) => {
  const company = await module.exports.findCompanyById(companyId);
  if (!company) throw new Error('Empresa não encontrada.');
  const oldActiveTurma = company.activeTurma;
  if (oldActiveTurma === newActiveTurma) return company; // Nenhuma mudança
  
  await company.update({ activeTurma: newActiveTurma });

  await createActivityLog({
    userId: userId,
    type: 'company',
    description: `Turma ativa da empresa '${company.name}' alterada de '${oldActiveTurma}' para '${newActiveTurma}'.`,
  });
  // Notificação informativa da alteração da turma
  await createNotification({
      description: `Turma ativa da empresa '${company.name}' alterada para '${newActiveTurma}'.`,
      type: 'info',
      details: `Ação realizada por: ${(await User.findByPk(userId))?.name || 'Sistema'}.`, // Busca o nome do usuário que fez a alteração
      userId: null
  });

  await module.exports.syncHotspotUserStatusByTurma(companyId, newActiveTurma);
  return company;
};

const syncHotspotUserStatusByTurma = async (companyId, activeTurma) => {
    const company = await module.exports.findCompanyById(companyId);
    if (!company) throw new Error('Empresa não encontrada.');
    const mikrotikClient = createMikrotikClient(company);
    const hotspotUsersInSystem = await db.HotspotUser.findAll({ where: { companyId } });

    let activatedCount = 0;
    let deactivatedCount = 0;

    for (const user of hotspotUsersInSystem) {
        if (!user.mikrotikId) continue;
        const userTurma = user.turma || 'Nenhuma';
        const shouldBeActive = activeTurma === 'Nenhuma' || userTurma === activeTurma;

        try {
            if (shouldBeActive) {
                // Ativa se for para estar ativo E o status atual não for 'active'
                if (user.status !== 'active') {
                    await mikrotikClient.patch(`/ip/hotspot/user/${user.mikrotikId}`, { disabled: 'false' }, { headers: { 'Content-Type': 'application/json' } });
                    await user.update({ status: 'active' });
                    activatedCount++;
                }
            } else {
                // Desativa se não for para estar ativo E o status atual for 'active'
                if (user.status === 'active') {
                    await mikrotikClient.patch(`/ip/hotspot/user/${user.mikrotikId}`, { disabled: 'true' }, { headers: { 'Content-Type': 'application/json' } });
                    await user.update({ status: 'inactive' });
                    deactivatedCount++;
                }
            }
        } catch (error) {
            const errorMessage = error.response?.data?.message || error.message;
            console.error(`[Sync Turma] Falha ao ajustar status de '${user.username}' na empresa '${company.name}': ${errorMessage}`);
            // Notificação de erro no ajuste de status por turma
            await createNotification({
                description: `Falha ao ajustar status do usuário '${user.username}' na empresa '${company.name}' pela turma.`,
                type: 'erro',
                details: `Erro: ${errorMessage}. Usuário ${shouldBeActive ? 'deveria ser ATIVO' : 'deveria ser INATIVO'}.`,
                userId: null
            });
        }
    }
    // Notificação de resumo da sincronização de status por turma (opcional)
    await createNotification({
        description: `Sincronização de status de usuários por turma concluída para a empresa '${company.name}'.`,
        type: 'info',
        details: `Ativados: ${activatedCount}. Desativados: ${deactivatedCount}. Turma Ativa: ${activeTurma}.`,
        userId: null
    });
};

const syncAllDataForCompany = async (companyId) => {
    console.log(`[Sync Service] Orquestrando sincronização para a empresa ID: ${companyId}`);
    const company = await Company.findByPk(companyId); // Busca a empresa para o log
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
};
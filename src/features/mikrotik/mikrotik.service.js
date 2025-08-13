// src/features/mikrotik/mikrotik.service.js
const { Op } = require('sequelize');
const { Company, HotspotUser, Profile, ConnectionLog } = require('../../models');
const { createMikrotikClient } = require('../../config/mikrotik');
const { sendCreditExhaustedEmail } = require('../../services/email.service');

const collectUsageData = async (companyId) => {
  const company = await Company.findByPk(companyId);
  if (!company) throw new Error('Empresa não encontrada.');

  const mikrotikClient = createMikrotikClient(company);
  const startTime = Date.now();
  const action = 'collectUsageData';

  try {
    const allUsersResponse = await mikrotikClient.get('/ip/hotspot/user');
    const allUsersData = allUsersResponse.data;

    await ConnectionLog.create({ action, status: 'success', message: `Coletado dados de ${allUsersData.length} usuários do MikroTik.`, responseTime: Date.now() - startTime, companyId });

    let updatedCount = 0;
    for (const mikrotikUser of allUsersData) {
      const dbUser = await HotspotUser.findOne({ where: { mikrotikId: mikrotikUser['.id'], companyId } });
      if (!dbUser) continue;

      const bytesUsed = (parseInt(mikrotikUser['bytes-in'], 10) || 0) + (parseInt(mikrotikUser['bytes-out'], 10) || 0);

      // --- Lógica de Desativação e Notificação ---
      const hadCredit = dbUser.creditsTotal > 0 && dbUser.creditsUsed < dbUser.creditsTotal;
      const creditExceeded = bytesUsed >= dbUser.creditsTotal;

      // Só executa a lógica de desativação se o usuário TINHA crédito e agora EXCEDEU
      if (hadCredit && creditExceeded) {
        console.log(`Crédito excedido para ${dbUser.username}. Desativando no MikroTik...`);
        try {
          // Comando para desativar o usuário no MikroTik
          await mikrotikClient.post(`/ip/hotspot/user/${dbUser.mikrotikId}/disable`);
          await ConnectionLog.create({ action: 'disableUser', status: 'success', message: `Usuário ${dbUser.username} desativado por excesso de crédito.`, companyId });

          // Atualiza o status no nosso banco para 'expired'
          await dbUser.update({ status: 'expired' });
          
          // Envia o e-mail de notificação de forma assíncrona
          sendCreditExhaustedEmail({ ...dbUser.get({ plain: true }), creditsUsed: bytesUsed }, company);

        } catch(disableError) {
          console.error(`Falha ao tentar desativar o usuário ${dbUser.username} no MikroTik.`, disableError);
          await ConnectionLog.create({ action: 'disableUser', status: 'error', message: `Falha ao desativar usuário: ${disableError.message}`, companyId });
        }
      }
      
      const [affectedRows] = await HotspotUser.update(
        { creditsUsed: bytesUsed },
        { where: { id: dbUser.id } }
      );

      if (affectedRows > 0) updatedCount++;
    }

    return {
        totalUsersInMikrotik: allUsersData.length,
        syncedUsersInDB: updatedCount
    };
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    await ConnectionLog.create({ action, status: 'error', message: errorMessage, responseTime: Date.now() - startTime, companyId });
    throw new Error(`Falha ao coletar dados de uso para a empresa ${companyId}: ${errorMessage}`);
  }
};

const collectUsageForAllCompanies = async () => {
  console.log('--- Iniciando job: Coleta de Uso Para Todas as Empresas ---');
  const companies = await Company.findAll();
  
  const results = await Promise.allSettled(
    companies.map(company => collectUsageData(company.id))
  );

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      console.log(`[${new Date().toISOString()}] SUCESSO na coleta para a empresa ${companies[index].name}. Sincronizados: ${result.value.syncedUsersInDB}`);
    } else {
      console.error(`[${new Date().toISOString()}] FALHA na coleta para a empresa ${companies[index].name}. Erro: ${result.reason.message}`);
    }
  });
  console.log('--- Finalizado job: Coleta de Uso Para Todas as Empresas ---');
};

const importProfilesFromMikrotik = async (companyId) => {
  const company = await Company.findByPk(companyId);
  if (!company) throw new Error('Empresa não encontrada.');
  const mikrotikClient = createMikrotikClient(company);
  
  const response = await mikrotikClient.get('/ip/hotspot/user/profile');
  const mikrotikProfiles = response.data;
  
  let importedCount = 0;
  let skippedCount = 0;
  
  for (const mikrotikProfile of mikrotikProfiles) {
    // Verifica se um perfil com o mesmo nome no MikroTik já existe para esta empresa
    const existingProfile = await Profile.findOne({ where: { mikrotikName: mikrotikProfile.name, companyId }});
    if (!existingProfile) {
      await Profile.create({
        name: mikrotikProfile.name, // Nome inicial é o mesmo do MikroTik
        mikrotikName: mikrotikProfile.name,
        rateLimit: mikrotikProfile.rate_limit,
        sessionTimeout: mikrotikProfile.session_timeout,
        companyId,
      });
      importedCount++;
    } else {
      skippedCount++;
    }
  }
  
  return { importedCount, skippedCount, totalInMikrotik: mikrotikProfiles.length };
};

const importUsersFromMikrotik = async (companyId) => {
  const company = await Company.findByPk(companyId);
  if (!company) throw new Error('Empresa não encontrada.');
  const mikrotikClient = createMikrotikClient(company);
  
  const response = await mikrotikClient.get('/ip/hotspot/user');
  const mikrotikUsers = response.data;
  
  let importedCount = 0;
  let skippedCount = 0;

  for (const mikrotikUser of mikrotikUsers) {
    // Pula o usuário "default-trial" se existir
    if (mikrotikUser.name === 'trial' && mikrotikUser.server === 'all') continue;

    // Verifica se um usuário com o mesmo ID do MikroTik já existe
    const existingUser = await HotspotUser.findOne({ where: { mikrotikId: mikrotikUser['.id'], companyId } });
    if (!existingUser) {
      // Encontra o ID do perfil correspondente em nosso banco de dados
      const profile = await Profile.findOne({ where: { mikrotikName: mikrotikUser.profile, companyId } });
      
      await HotspotUser.create({
        username: mikrotikUser.name,
        password: mikrotikUser.password || 'imported_user', // Define uma senha padrão
        mikrotikId: mikrotikUser['.id'],
        turma: mikrotikUser.comment,
        creditsUsed: (parseInt(mikrotikUser['bytes-in'], 10) || 0) + (parseInt(mikrotikUser['bytes-out'], 10) || 0),
        companyId,
        profileId: profile ? profile.id : null, // Associa ao perfil se encontrado
      });
      importedCount++;
    } else {
      skippedCount++;
    }
  }
  
  return { importedCount, skippedCount, totalInMikrotik: mikrotikUsers.length };
};

const findAllLogs = async (options) => {
  const { page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'DESC', ...filters } = options;
  const where = {};
  if (filters.companyId) where.companyId = filters.companyId;
  if (filters.status) where.status = filters.status;
  if (filters.action) where.action = { [Op.iLike]: `%${filters.action}%` };
  const offset = (page - 1) * limit;
  return await ConnectionLog.findAndCountAll({ where, include: [{ model: Company, as: 'company', attributes: ['id', 'name'] }], limit, offset, order: [[sortBy, sortOrder]], });
};

const findNetworkNeighbors = async (companyId) => {
  const company = await Company.findByPk(companyId);
  if (!company) throw new Error('Empresa não encontrada.');
  const mikrotikClient = createMikrotikClient(company); // <-- Chama a função para criar o cliente
  const action = 'findNetworkNeighbors';
  const startTime = Date.Now(); // <-- CORREÇÃO: era Date.Now()
  try {
    const response = await mikrotikClient.get('/ip/neighbor');
    await ConnectionLog.create({ action, status: 'success', message: `Encontrados ${response.data.length} vizinhos de rede.`, responseTime: Date.now() - startTime, companyId });
    const neighbors = response.data.map(neighbor => ({ macAddress: neighbor['mac-address'], ipAddress: neighbor['address'], identity: neighbor.identity, platform: neighbor.platform, board: neighbor.board, }));
    return neighbors;
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    await ConnectionLog.create({ action, status: 'error', message: errorMessage, responseTime: Date.now() - startTime, companyId });
    throw new Error(`Falha ao buscar vizinhos de rede: ${errorMessage}`);
  }
};


module.exports = {
  collectUsageData,
  collectUsageForAllCompanies,
  importProfilesFromMikrotik,
  importUsersFromMikrotik,
  findAllLogs,
  findNetworkNeighbors
};
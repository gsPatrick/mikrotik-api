// src/features/mikrotik/mikrotik.service.js
const { Op } = require('sequelize');
const { Company, HotspotUser, Profile, ConnectionLog, Settings } = require('../../models');
const { createMikrotikClient } = require('../../config/mikrotik');
const { sendCreditExhaustedEmail } = require('../../services/email.service');
const bcrypt = require('bcryptjs');
const { writeSyncLog } = require('../../services/syncLog.service');

// Converte strings de tempo do MikroTik (ex: "1h30m", "0d 01:00:00") para minutos ou 'null' para ilimitado
const convertMikrotikTimeToMinutes = (mikrotikTime) => {
  if (!mikrotikTime || mikrotikTime === "0s" || mikrotikTime === "0" || mikrotikTime.toLowerCase() === "unlimited") return null;
  let totalMinutes = 0;
  const daysMatch = mikrotikTime.match(/(\d+)d/);
  const hoursMatch = mikrotikTime.match(/(\d+)h/);
  const minutesMatch = mikrotikTime.match(/(\d+)m/);
  const timeOnlyMatch = mikrotikTime.match(/(\d{2}):(\d{2}):(\d{2})/);
  if (daysMatch) totalMinutes += parseInt(daysMatch[1], 10) * 24 * 60;
  if (hoursMatch) totalMinutes += parseInt(hoursMatch[1], 10) * 60;
  if (minutesMatch) totalMinutes += parseInt(minutesMatch[1], 10);
  if (timeOnlyMatch && (mikrotikTime.includes(':') && !mikrotikTime.includes('d'))) {
      totalMinutes = (parseInt(timeOnlyMatch[1], 10) * 60) + parseInt(timeOnlyMatch[2], 10);
  }
  return totalMinutes > 0 ? totalMinutes : null;
};
const convertMikrotikRateToString = (mikrotikRate) => {
  if (!mikrotikRate) return null;
  return mikrotikRate; 
};
// --- FUNÇÃO ESSENCIAL: extrair a turma do comentário do MikroTik ---
const parseTurmaComment = (comment) => {
    if (!comment) return 'Nenhuma'; // Valor padrão se o comentário for nulo ou vazio

    const trimmedComment = comment.trim().toUpperCase();

    // Prioriza "A" e "B"
    if (trimmedComment.includes('TURMA A') || trimmedComment === 'A') {
        return 'A';
    }
    if (trimmedComment.includes('TURMA B') || trimmedComment === 'B') {
        return 'B';
    }
    
    // Se não for "Turma A" ou "Turma B", retorna "Nenhuma"
    return 'Nenhuma'; 
};

const collectUsageData = async (companyId) => {
  const company = await Company.findByPk(companyId);
  if (!company) return { error: 'Empresa não encontrada.' };

  const mikrotikClient = createMikrotikClient(company);
  const startTime = Date.now();
  const action = 'collectUsageData';

  try {
    const allUsersResponse = await mikrotikClient.get('/ip/hotspot/user');
    const allUsersData = allUsersResponse.data;
    const activeSessionsResponse = await mikrotikClient.get('/ip/hotspot/active');
    const activeSessionsData = activeSessionsResponse.data;
    
    let updatedCount = 0;
    const activeSessionsMap = new Map();
    
    // Mapear sessões ativas incluindo o ID da sessão
    activeSessionsData.forEach(session => {
        if (session.user) {
            activeSessionsMap.set(session.user, {
                sessionId: session['.id'], // ID da sessão para poder derrubá-la
                bytesIn: parseInt(session['bytes-in'], 10) || 0,
                bytesOut: parseInt(session['bytes-out'], 10) || 0,
                address: session.address,
                macAddress: session['mac-address']
            });
        }
    });

    for (const mikrotikUser of allUsersData) {
      const dbUser = await HotspotUser.findOne({ where: { mikrotikId: mikrotikUser['.id'], companyId } });
      if (!dbUser) continue;

      const historicalBytesIn = parseInt(mikrotikUser['bytes-in'], 10) || 0;
      const historicalBytesOut = parseInt(mikrotikUser['bytes-out'], 10) || 0;
      let totalBytesUsed = historicalBytesIn + historicalBytesOut;

      const activeSessionData = activeSessionsMap.get(mikrotikUser.name);
      if (activeSessionData) {
        totalBytesUsed += activeSessionData.bytesIn + activeSessionData.bytesOut;
      }

      const hadCredit = dbUser.creditsTotal > 0 && dbUser.creditsUsed < dbUser.creditsTotal;
      const creditExceeded = totalBytesUsed >= dbUser.creditsTotal && dbUser.creditsTotal > 0;

      if (hadCredit && creditExceeded && dbUser.status === 'active') {
        console.log(`Crédito excedido para ${dbUser.username}. Desativando e desconectando no MikroTik...`);
        try {
          // 1. DESATIVAR o usuário no MikroTik
          await mikrotikClient.patch(`/ip/hotspot/user/${dbUser.mikrotikId}`, 
            {
              disabled: 'true'
            },
            {
              headers: {
                'Content-Type': 'application/json'
              }
            }
          );

          console.log(`✅ Usuário ${dbUser.username} desativado no MikroTik`);

          // 2. DERRUBAR a sessão ativa se existir
          if (activeSessionData && activeSessionData.sessionId) {
            try {
              // Método 1: Derrubar por ID da sessão (mais confiável)
              await mikrotikClient.delete(`/ip/hotspot/active/${activeSessionData.sessionId}`);
              console.log(`✅ Sessão ativa do usuário ${dbUser.username} derrubada (ID: ${activeSessionData.sessionId})`);
              
            } catch (sessionError) {
              // Se falhar por ID, tentar por nome do usuário
              try {
                await mikrotikClient.post('/ip/hotspot/active/remove', 
                  { user: dbUser.username },
                  { 
                    headers: { 
                      'Content-Type': 'application/json' 
                    } 
                  }
                );
                console.log(`✅ Sessão do usuário ${dbUser.username} derrubada por nome`);
              } catch (secondSessionError) {
                console.warn(`⚠️ Falha ao derrubar sessão de ${dbUser.username}:`, secondSessionError.message);
                // Não é crítico se não conseguir derrubar a sessão
              }
            }
          } else {
            console.log(`ℹ️ Usuário ${dbUser.username} não possui sessão ativa para derrubar`);
          }

          // 3. Registrar sucesso e atualizar banco
          await ConnectionLog.create({ 
            action: 'disableUserAndDisconnect', 
            status: 'success', 
            message: `Usuário ${dbUser.username} desativado e desconectado por excesso de crédito. Sessão: ${activeSessionData ? activeSessionData.sessionId : 'N/A'}`, 
            companyId 
          });
          
          await dbUser.update({ status: 'expired' });
          sendCreditExhaustedEmail({ ...dbUser.get({ plain: true }), creditsUsed: totalBytesUsed }, company);

        } catch(disableError) {
          const disableErrorMessage = disableError.response?.data?.message || disableError.message;
          console.error(`❌ Falha ao tentar desativar o usuário ${dbUser.username} no MikroTik. Erro: ${disableErrorMessage}`);
          
          await ConnectionLog.create({ 
            action: 'disableUser', 
            status: 'error', 
            message: `Falha ao desativar usuário: ${disableErrorMessage}`, 
            companyId 
          });
        }
      }
      
      const [affectedRows] = await HotspotUser.update({ creditsUsed: totalBytesUsed }, { where: { id: dbUser.id } });
      if (affectedRows > 0) updatedCount++;
    }
    return { syncedUsersInDB: updatedCount };

  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    await ConnectionLog.create({ action, status: 'error', message: errorMessage, responseTime: Date.now() - startTime, companyId });
    throw error;
  }
};

// Função utilitária separada para desconectar usuários
const forceDisconnectUser = async (companyId, username) => {
  const company = await Company.findByPk(companyId);
  if (!company) throw new Error('Empresa não encontrada.');

  const mikrotikClient = createMikrotikClient(company);

  try {
    // Buscar todas as sessões ativas
    const activeSessionsResponse = await mikrotikClient.get('/ip/hotspot/active');
    const activeSessions = activeSessionsResponse.data;
    
    // Filtrar sessões do usuário específico
    const userSessions = activeSessions.filter(session => session.user === username);
    
    if (userSessions.length === 0) {
      console.log(`Usuário ${username} não possui sessões ativas`);
      return { success: false, message: `Usuário ${username} não está conectado` };
    }

    console.log(`Encontradas ${userSessions.length} sessões ativas para ${username}`);

    // Derrubar todas as sessões do usuário
    const results = [];
    for (const session of userSessions) {
      try {
        await mikrotikClient.delete(`/ip/hotspot/active/${session['.id']}`);
        results.push({ 
          sessionId: session['.id'], 
          address: session.address, 
          success: true 
        });
        console.log(`✅ Sessão ${session['.id']} (${session.address}) derrubada`);
      } catch (error) {
        results.push({ 
          sessionId: session['.id'], 
          address: session.address, 
          success: false, 
          error: error.message 
        });
        console.warn(`❌ Falha ao derrubar sessão ${session['.id']}:`, error.message);
      }
    }

    const successCount = results.filter(r => r.success).length;
    
    return { 
      success: successCount > 0, 
      message: `${successCount}/${userSessions.length} sessões derrubadas para ${username}`,
      results 
    };

  } catch (error) {
    console.error(`Erro ao desconectar usuário ${username}:`, error.message);
    throw error;
  }
};

// Função para desativar usuário completamente (desativar + desconectar)
const disableAndDisconnectUser = async (companyId, username) => {
  const company = await Company.findByPk(companyId);
  if (!company) throw new Error('Empresa não encontrada.');

  const mikrotikClient = createMikrotikClient(company);
  
  try {
    // 1. Buscar o usuário no banco de dados
    const dbUser = await HotspotUser.findOne({ 
      where: { username, companyId } 
    });
    
    if (!dbUser || !dbUser.mikrotikId) {
      throw new Error(`Usuário ${username} não encontrado no banco de dados`);
    }

    console.log(`Desativando usuário ${username} completamente...`);

    // 2. Desativar no MikroTik
    await mikrotikClient.patch(`/ip/hotspot/user/${dbUser.mikrotikId}`, 
      { disabled: 'true' },
      { headers: { 'Content-Type': 'application/json' } }
    );
    console.log(`✅ Usuário ${username} desativado no MikroTik`);

    // 3. Derrubar todas as sessões ativas
    const disconnectResult = await forceDisconnectUser(companyId, username);
    
    // 4. Atualizar status no banco de dados
    await dbUser.update({ status: 'inactive' });
    console.log(`✅ Status do usuário ${username} atualizado no banco`);

    // 5. Registrar log
    await ConnectionLog.create({
      action: 'disableAndDisconnectUser',
      status: 'success',
      message: `Usuário ${username} desativado e ${disconnectResult.message}`,
      companyId
    });

    return {
      userDisabled: true,
      sessionsDisconnected: disconnectResult.success,
      message: `Usuário ${username} desativado completamente`,
      disconnectDetails: disconnectResult
    };

  } catch (error) {
    console.error(`Erro ao desativar usuário ${username}:`, error.message);
    
    await ConnectionLog.create({
      action: 'disableAndDisconnectUser',
      status: 'error',
      message: `Erro ao desativar usuário ${username}: ${error.message}`,
      companyId
    });
    
    throw error;
  }
};



const collectUsageForAllCompanies = async () => {
  console.log('--- Iniciando job: Coleta de Uso Para Todas as Empresas ---');
  const companies = await Company.findAll();
  
  const results = await Promise.allSettled(
    companies.map(async company => {
        try {
            const result = await collectUsageData(company.id);
            if (company.status !== 'online') {
                await company.update({ status: 'online' });
            }
            return result;
        } catch (error) {
            if (company.status !== 'offline') {
                await company.update({ status: 'offline' });
            }
            throw error; // Re-lança o erro para ser capturado como 'rejected'
        }
    })
  );

  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value) {
      console.log(`[${new Date().toISOString()}] SUCESSO na coleta para a empresa ${companies[index].name}. Sincronizados: ${result.value.syncedUsersInDB}`);
    } else {
      console.error(`[${new Date().toISOString()}] FALHA na coleta para a empresa ${companies[index].name}. Erro: ${result.reason?.message || 'Erro desconhecido'}`);
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
  let updatedCount = 0;
  let skippedCount = 0;
  
  for (const mikrotikProfile of mikrotikProfiles) {
    const existingProfile = await Profile.findOne({ where: { mikrotikName: mikrotikProfile.name, companyId }});
    
    const profileDataToSync = {
        name: mikrotikProfile.name,
        mikrotikName: mikrotikProfile.name,
        rateLimit: convertMikrotikRateToString(mikrotikProfile['rate-limit']) || null,
        sessionTimeout: convertMikrotikTimeToMinutes(mikrotikProfile['session-timeout']) || null,
        companyId: companyId,
    };

    if (!existingProfile) {
      await Profile.create(profileDataToSync);
      importedCount++;
      writeSyncLog(`[Perfis][${company.name}] CRIADO: ${mikrotikProfile.name}. Dados: ${JSON.stringify(profileDataToSync)}`);
    } else {
      let changed = false;
      const updates = {};

      if (existingProfile.name !== profileDataToSync.name) {
          updates.name = profileDataToSync.name;
          changed = true;
      }
      if (existingProfile.rateLimit !== profileDataToSync.rateLimit) {
          updates.rateLimit = profileDataToSync.rateLimit;
          changed = true;
      }
      if (existingProfile.sessionTimeout !== profileDataToSync.sessionTimeout) {
          updates.sessionTimeout = profileDataToSync.sessionTimeout;
          changed = true;
      }
      
      if (changed) {
          await existingProfile.update(updates);
          updatedCount++;
          writeSyncLog(`[Perfis][${company.name}] ATUALIZADO: ${mikrotikProfile.name}. Mudanças: ${JSON.stringify(updates)}`);
      } else {
          skippedCount++;
          writeSyncLog(`[Perfis][${company.name}] IGNORADO (sem mudança): ${mikrotikProfile.name}.`);
      }
    }
  }
  
  return { importedCount, updatedCount, skippedCount, totalInMikrotik: mikrotikProfiles.length };
};

const importUsersFromMikrotik = async (companyId) => {
  const company = await Company.findByPk(companyId);
  if (!company) throw new Error('Empresa não encontrada.');
  const mikrotikClient = createMikrotikClient(company);
  
  const response = await mikrotikClient.get('/ip/hotspot/user');
  const mikrotikUsers = response.data;
  
  const settings = await Settings.findByPk(1);
  const defaultDailyCreditBytes = (settings?.defaultDailyCreditMB || 500) * 1024 * 1024;

  let importedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  for (const mikrotikUser of mikrotikUsers) {
    if (!mikrotikUser['.id'] || (mikrotikUser.name === 'trial' && mikrotikUser.server === 'all')) {
        writeSyncLog(`[Usuários][${company.name}] IGNORADO (trial/sem ID): ${mikrotikUser.name}`);
        continue;
    }

    const existingUser = await HotspotUser.findOne({ where: { mikrotikId: mikrotikUser['.id'], companyId } });
    
    const profileMikrotikName = mikrotikUser.profile || null;
    let profileId = null;
    if (profileMikrotikName) {
        const profile = await Profile.findOne({ where: { mikrotikName: profileMikrotikName, companyId } });
        profileId = profile ? profile.id : null;
    }

    let hashedPasswordForNewUser = undefined;
    if (mikrotikUser.password) {
      const salt = await bcrypt.genSalt(10);
      hashedPasswordForNewUser = await bcrypt.hash(mikrotikUser.password, salt);
    } else {
        const salt = await bcrypt.genSalt(10);
        hashedPasswordForNewUser = await bcrypt.hash('imported_user', salt); // Senha padrão
    }

    const creditsUsed = 0;

    let statusFromMikrotik = 'active';
    if (mikrotikUser.disabled === 'true') {
        statusFromMikrotik = 'inactive';
    }

      const userDataToSync = {
        username: mikrotikUser.name,
        password: hashedPasswordForNewUser, 
        mikrotikId: mikrotikUser['.id'],
        turma: !existingUser ? 'A' : (existingUser.turma || 'A'),
        companyId: companyId,
        profileId: profileId,
        status: statusFromMikrotik,
        creditsTotal: defaultDailyCreditBytes, 
    };

    if (!existingUser) {
      await HotspotUser.create(userDataToSync);
      importedCount++;
      writeSyncLog(`[Usuários][${company.name}] CRIADO: ${mikrotikUser.name}. Mikrotik ID: ${mikrotikUser['.id']}. Turma atribuída: 'A'. Status: ${statusFromMikrotik}.`);
    } else {
      let changed = false;
      const updates = {};

      if (existingUser.username !== userDataToSync.username) {
          updates.username = userDataToSync.username;
          changed = true;
      }
      
      if (existingUser.profileId !== userDataToSync.profileId) {
          updates.profileId = userDataToSync.profileId;
          changed = true;
      }
      
      if (existingUser.status !== userDataToSync.status) {
          if (userDataToSync.status === 'inactive') {
              updates.status = 'inactive';
              changed = true;
          } 
          else if (userDataToSync.status === 'active' && existingUser.status !== 'expired') {
              updates.status = 'active';
              changed = true;
          }
      }
      
      if (changed) {
          await existingUser.update(updates);
          updatedCount++;
          writeSyncLog(`[Usuários][${company.name}] ATUALIZADO: ${mikrotikUser.name}. Mudanças: ${JSON.stringify(updates)}.`);
      } else {
          skippedCount++;
          writeSyncLog(`[Usuários][${company.name}] IGNORADO (sem mudança): ${mikrotikUser.name}.`);
      }
    }
  }
  
  return { importedCount, updatedCount, skippedCount, totalInMikrotik: mikrotikUsers.length };
};

const findAllLogs = async (options) => {
  const { page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'DESC', ...filters } = options;
  const where = {};
  if (filters.companyId) where.companyId = filters.companyId;
  if (filters.status) where.status = filters.status;
  if (filters.action) where.action = { [Op.iLike]: `%${filters.action}%` };
  
  const offset = (page - 1) * limit;
  
  // Esta função busca os logs da tabela ConnectionLogs e inclui dados da Company.
  // Ela não depende do companyService, o que é o correto.
  return await ConnectionLog.findAndCountAll({
    where,
    include: [{
      model: Company,
      as: 'company',
      attributes: ['id', 'name', 'mikrotikIp']
    }],
    limit,
    offset,
    order: [[sortBy, sortOrder]],
  });
};

const findNetworkNeighbors = async (companyId) => {
  const company = await Company.findByPk(companyId);
  if (!company) throw new Error('Empresa não encontrada.');
  const mikrotikClient = createMikrotikClient(company);
  const action = 'findNetworkNeighbors';
  const startTime = Date.now();
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
  findNetworkNeighbors,
  
};

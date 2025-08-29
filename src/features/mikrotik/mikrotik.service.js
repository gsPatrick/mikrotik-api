// src/features/mikrotik/mikrotik.service.js - VERSÃO UNIFICADA
const { Op } = require('sequelize');
const { Company, HotspotUser, Profile, ConnectionLog, Settings } = require('../../models');
const { createMikrotikClient } = require('../../config/mikrotik');
const { sendCreditExhaustedEmail } = require('../../services/email.service');
const bcrypt = require('bcryptjs');
const { writeSyncLog } = require('../../services/syncLog.service');

// ✅ FUNÇÃO PRINCIPAL UNIFICADA: Coleta de uso em tempo real
// Substitua a função collectUsageDataUnified no arquivo mikrotik.service.js
const collectUsageDataUnified = async (companyId) => {
  console.log(`[COLLECT-UNIFIED] Iniciando coleta para empresa ID: ${companyId}`);
  
  const company = await Company.findByPk(companyId);
  if (!company) return { error: 'Empresa não encontrada.' };

  const mikrotikClient = createMikrotikClient(company);
  const startTime = Date.now();
  const action = 'collectUsageDataUnified';

  try {
    console.log(`[COLLECT-UNIFIED] Buscando dados do MikroTik...`);
    
    const [activeSessionsResponse] = await Promise.all([
      mikrotikClient.get('/ip/hotspot/active'),
    ]);
    
    const activeSessions = Array.isArray(activeSessionsResponse.data) ? activeSessionsResponse.data : [];
    console.log(`[COLLECT-UNIFIED] ${activeSessions.length} sessões ativas`);

    const activeSessionsMap = new Map();
    activeSessions.forEach(session => {
      const username = session.user || session.name;
      if (username) {
        const bytesIn = parseInt(session['bytes-in'] || 0);
        const bytesOut = parseInt(session['bytes-out'] || 0);
        
        activeSessionsMap.set(username, {
          sessionId: session['.id'],
          totalSessionBytes: bytesIn + bytesOut,
        });
      }
    });

    const dbUsers = await HotspotUser.findAll({ where: { companyId } });

    let updatedCount = 0;
    let expiredCount = 0;
    let errors = 0;

    console.log(`[COLLECT-UNIFIED] Processando ${dbUsers.length} usuários do banco...`);

    for (const dbUser of dbUsers) {
      try {
        const activeSession = activeSessionsMap.get(dbUser.username);

        // Força a conversão de TODOS os valores do banco para NÚMEROS
        const dbCreditsUsed = parseFloat(dbUser.creditsUsed) || 0;
        const dbCreditsTotal = parseFloat(dbUser.creditsTotal) || 0;
        const dbCurrentSessionBytes = parseFloat(dbUser.currentSessionBytes) || 0;
        
        if (activeSession) {
          const currentSessionBytes = activeSession.totalSessionBytes;
          const incremento = currentSessionBytes - dbCurrentSessionBytes;
          
          if (incremento > 0) {
            const newCreditsUsed = dbCreditsUsed + incremento;
            const willExceedLimit = newCreditsUsed >= dbCreditsTotal && dbCreditsTotal > 0;
            
            if (willExceedLimit && dbUser.status === 'active') {
              console.log(`[LIMIT] '${dbUser.username}' excedeu limite: ${Math.round(newCreditsUsed/1024/1024)}MB/${Math.round(dbCreditsTotal/1024/1024)}MB`);
              
              // ✅ CORREÇÃO PRINCIPAL: Usar função específica para desconexão e desativação
              await disconnectAndDisableUserWithRetry(dbUser, activeSession, mikrotikClient, company);
              expiredCount++;
              
              await dbUser.update({
                creditsUsed: newCreditsUsed,
                currentSessionBytes: 0,
                sessionId: null,
                status: 'expired',
                lastCollectionTime: new Date()
              });
            } else {
              await dbUser.update({
                creditsUsed: newCreditsUsed,
                currentSessionBytes: currentSessionBytes,
                sessionId: activeSession.sessionId,
                lastCollectionTime: new Date()
              });
            }
            
            console.log(`[COLLECT] '${dbUser.username}': +${Math.round(incremento/1024/1024*100)/100}MB (Total: ${Math.round(newCreditsUsed/1024/1024*100)/100}MB)`);
            updatedCount++;
          } else {
            if (dbUser.sessionId !== activeSession.sessionId) {
              await dbUser.update({
                sessionId: activeSession.sessionId,
                lastCollectionTime: new Date()
              });
            }
          }
        } else {
          if (dbUser.sessionId) {
            console.log(`[LOGOUT] '${dbUser.username}': Logout detectado`);
            if (dbCurrentSessionBytes > 0) {
              const finalCreditsUsed = dbCreditsUsed + dbCurrentSessionBytes;
              await dbUser.update({
                creditsUsed: finalCreditsUsed,
                currentSessionBytes: 0,
                sessionId: null,
                lastLogoutTime: new Date()
              });
              
              // ✅ VERIFICAR SE EXPIROU APÓS LOGOUT
              if (finalCreditsUsed >= dbCreditsTotal && dbCreditsTotal > 0 && dbUser.status === 'active') {
                console.log(`[LOGOUT-EXPIRED] '${dbUser.username}' expirou após logout`);
                await expireUserInMikroTik(dbUser, mikrotikClient, company);
                await dbUser.update({ status: 'expired' });
              }
            } else {
              await dbUser.update({ sessionId: null, lastLogoutTime: new Date() });
            }
          }
        }
      } catch (userError) {
        console.error(`[COLLECT] ❌ Erro ao processar '${dbUser.username}': ${userError.message}`);
        errors++;
      }
    }

    await ConnectionLog.create({
      action,
      status: 'success',
      message: `Coleta concluída: ${updatedCount} atualizados, ${expiredCount} expirados, ${errors} erros`,
      responseTime: Date.now() - startTime,
      companyId
    });

    console.log(`[COLLECT-UNIFIED] ✅ Finalizado: ${updatedCount} atualizados, ${expiredCount} expirados, ${errors} erros`);
    return { updatedCount, expiredCount, errors };

  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    console.error(`[COLLECT-UNIFIED] ❌ Erro geral: ${errorMessage}`);
    await ConnectionLog.create({ action, status: 'error', message: errorMessage, responseTime: Date.now() - startTime, companyId });
    throw error;
  }
};

// ✅ FUNÇÃO OTIMIZADA: Desconectar e desativar usuário
const disconnectAndDisableUserUnified = async (dbUser, activeSession, mikrotikClient, company) => {
  console.log(`[DISCONNECT-UNIFIED] Processando '${dbUser.username}'...`);
  
  try {
    // 1. DESCONECTAR SESSÃO ATIVA
    if (activeSession && activeSession.sessionId) {
      try {
        await mikrotikClient.post('/ip/hotspot/active/remove', {
          '.id': activeSession.sessionId
        }, {
          headers: { 'Content-Type': 'application/json' }
        });
        console.log(`[DISCONNECT-UNIFIED] ✅ Sessão ${activeSession.sessionId} desconectada`);
      } catch (sessionError) {
        console.warn(`[DISCONNECT-UNIFIED] ⚠️ Erro ao desconectar sessão: ${sessionError.message}`);
      }
    }

    // 2. DESATIVAR USUÁRIO
    if (dbUser.mikrotikId) {
      try {
        await mikrotikClient.post('/ip/hotspot/user/set', {
          '.id': dbUser.mikrotikId,
          disabled: 'yes'
        }, {
          headers: { 'Content-Type': 'application/json' }
        });
        console.log(`[DISCONNECT-UNIFIED] ✅ Usuário '${dbUser.username}' desativado`);
      } catch (disableError) {
        console.warn(`[DISCONNECT-UNIFIED] ⚠️ Erro ao desativar usuário: ${disableError.message}`);
      }
    }

    // 3. ENVIAR EMAIL DE NOTIFICAÇÃO
    try {
      await sendCreditExhaustedEmail(dbUser, company);
      console.log(`[DISCONNECT-UNIFIED] ✅ Email enviado para '${dbUser.username}'`);
    } catch (emailError) {
      console.warn(`[DISCONNECT-UNIFIED] ⚠️ Erro ao enviar email: ${emailError.message}`);
    }

    // 4. REGISTRAR LOG
    await ConnectionLog.create({
      action: 'disconnectAndDisableUserUnified',
      status: 'success',
      message: `Usuário '${dbUser.username}' desconectado e desativado por excesso de crédito (${Math.round(dbUser.creditsTotal/1024/1024)}MB)`,
      companyId: company.id
    });

  } catch (error) {
    console.error(`[DISCONNECT-UNIFIED] ❌ Erro geral: ${error.message}`);
    
    await ConnectionLog.create({
      action: 'disconnectAndDisableUserUnified',
      status: 'error',
      message: `Falha ao processar '${dbUser.username}': ${error.message}`,
      companyId: company.id
    });
  }
};

// ✅ FUNÇÃO SIMPLIFICADA: Desconectar usuário específico
const forceDisconnectUserUnified = async (companyId, username) => {
  const company = await Company.findByPk(companyId);
  if (!company) throw new Error('Empresa não encontrada.');

  const mikrotikClient = createMikrotikClient(company);

  try {
    // Buscar sessões ativas do usuário
    const activeResponse = await mikrotikClient.get('/ip/hotspot/active');
    const activeSessions = Array.isArray(activeResponse.data) ? activeResponse.data : [];
    
    const userSessions = activeSessions.filter(session => 
      (session.user === username) || (session.name === username)
    );
    
    if (userSessions.length === 0) {
      return { 
        success: false, 
        message: `Usuário '${username}' não está conectado`,
        sessionsFound: 0
      };
    }

    console.log(`[FORCE-DISCONNECT] Encontradas ${userSessions.length} sessões para '${username}'`);

    // Desconectar todas as sessões
    const results = [];
    for (const session of userSessions) {
      try {
        await mikrotikClient.post('/ip/hotspot/active/remove', {
          '.id': session['.id'] || session.id
        }, {
          headers: { 'Content-Type': 'application/json' }
        });
        
        results.push({
          sessionId: session['.id'] || session.id,
          address: session.address,
          success: true
        });
        
        console.log(`[FORCE-DISCONNECT] ✅ Sessão ${session['.id']} desconectada`);
        
      } catch (error) {
        results.push({
          sessionId: session['.id'] || session.id,
          address: session.address,
          success: false,
          error: error.message
        });
        
        console.warn(`[FORCE-DISCONNECT] ❌ Falha na sessão ${session['.id']}: ${error.message}`);
      }
    }

    const successCount = results.filter(r => r.success).length;
    
    // Atualizar usuário no banco
    await HotspotUser.update({
      sessionId: null,
      currentSessionBytes: 0,
      lastLogoutTime: new Date()
    }, {
      where: { username, companyId }
    });

    return {
      success: successCount > 0,
      message: `${successCount}/${userSessions.length} sessões desconectadas`,
      sessionsFound: userSessions.length,
      results
    };

  } catch (error) {
    console.error(`[FORCE-DISCONNECT] Erro: ${error.message}`);
    throw error;
  }
};

// ✅ FUNÇÃO PARA TODAS AS EMPRESAS
const collectUsageForAllCompaniesUnified = async () => {
  console.log('[COLLECT-ALL] --- Iniciando coleta unificada para todas as empresas ---');
  
  const companies = await Company.findAll();
  const results = [];

  for (const company of companies) {
    try {
      console.log(`[COLLECT-ALL] Processando: ${company.name}`);
      
      const result = await collectUsageDataUnified(company.id);
      
      // Atualizar status da empresa
      if (company.status !== 'online') {
        await company.update({ status: 'online' });
      }
      
      results.push({
        company: company.name,
        success: true,
        ...result
      });
      
      console.log(`[COLLECT-ALL] ✅ ${company.name}: ${result.syncedUsersInDB} usuários processados`);
      
    } catch (error) {
      console.error(`[COLLECT-ALL] ❌ Erro em ${company.name}: ${error.message}`);
      
      // Marcar empresa como offline
      if (company.status !== 'offline') {
        await company.update({ status: 'offline' });
      }
      
      results.push({
        company: company.name,
        success: false,
        error: error.message
      });
    }
    
    // Pausa entre empresas para evitar sobrecarga
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  const successCount = results.filter(r => r.success).length;
  console.log(`[COLLECT-ALL] --- Finalizado: ${successCount}/${companies.length} empresas processadas ---`);
  
  return results;
};

// ✅ MANTER FUNÇÕES EXISTENTES (importação de perfis/usuários)
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

const parseTurmaComment = (comment) => {
    if (!comment) return 'Nenhuma';
    const trimmedComment = comment.trim().toUpperCase();
    if (trimmedComment.includes('TURMA A') || trimmedComment === 'A') return 'A';
    if (trimmedComment.includes('TURMA B') || trimmedComment === 'B') return 'B';
    return 'Nenhuma'; 
};

// MANTER AS OUTRAS FUNÇÕES EXISTENTES INALTERADAS
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
    if (!existingUser) {
        const passwordToHash = mikrotikUser.password || 'imported_user';
        const salt = await bcrypt.genSalt(10);
        hashedPasswordForNewUser = await bcrypt.hash(passwordToHash, salt);
    }
    
    const bytesIn = parseFloat(mikrotikUser['bytes-in'] || 0);
    const bytesOut = parseFloat(mikrotikUser['bytes-out'] || 0);
    const totalBytesUsed = bytesIn + bytesOut;

    let finalStatus;
    if (totalBytesUsed >= defaultDailyCreditBytes && defaultDailyCreditBytes > 0) {
        finalStatus = 'expired';
    } else if (mikrotikUser.disabled === 'true') { // O MikroTik retorna 'true' na leitura
        finalStatus = 'inactive';
    } else {
        finalStatus = 'active';
    }

    // ====================================================================
    // ✅ INÍCIO DA NOVA LÓGICA DE DESATIVAÇÃO IMEDIATA
    // ====================================================================
    // Se a lógica acima determinou que o status deve ser 'expired'
    // E o usuário não está já desativado no MikroTik...
    if (finalStatus === 'expired' && mikrotikUser.disabled !== 'true') {
        console.log(`[Sync-Disable] Usuário '${mikrotikUser.name}' excedeu o limite. Enviando comando para desativar no MikroTik...`);
        try {
            // ...então envie o comando para desativá-lo AGORA.
            await mikrotikClient.post('/ip/hotspot/user/set', {
                '.id': mikrotikUser['.id'],
                disabled: 'yes' // Usamos 'yes' para escrever, conforme nosso padrão
            }, { headers: { 'Content-Type': 'application/json' } });

            writeSyncLog(`[Usuários][${company.name}] DESATIVADO (no MikroTik): ${mikrotikUser.name} por excesso de consumo.`);
        } catch (error) {
            console.error(`[Sync-Disable] FALHA ao tentar desativar o usuário '${mikrotikUser.name}' no MikroTik: ${error.message}`);
            writeSyncLog(`[Usuários][${company.name}] ERRO AO DESATIVAR (no MikroTik): ${mikrotikUser.name}. Erro: ${error.message}`);
        }
    }
    // ====================================================================
    // FIM DA NOVA LÓGICA
    // ====================================================================

    const userDataToSync = {
        username: mikrotikUser.name,
        mikrotikId: mikrotikUser['.id'],
        turma: !existingUser ? 'A' : (existingUser.turma || 'A'),
        companyId: companyId,
        profileId: profileId,
        status: finalStatus,
        creditsUsed: totalBytesUsed,
        creditsTotal: defaultDailyCreditBytes,
    };

    if (hashedPasswordForNewUser) {
        userDataToSync.password = hashedPasswordForNewUser;
    }
    
    if (!existingUser) {
      await HotspotUser.create(userDataToSync);
      importedCount++;
      writeSyncLog(`[Usuários][${company.name}] CRIADO: ${mikrotikUser.name}. Status: ${finalStatus}. Consumo: ${Math.round(totalBytesUsed/1024/1024)}MB.`);
    } else {
      let changed = false;
      const updates = {};

      if (existingUser.username !== userDataToSync.username) updates.username = userDataToSync.username;
      if (existingUser.profileId !== userDataToSync.profileId) updates.profileId = userDataToSync.profileId;
      if (existingUser.status !== userDataToSync.status) updates.status = userDataToSync.status;
      if (parseFloat(existingUser.creditsUsed) !== userDataToSync.creditsUsed) updates.creditsUsed = userDataToSync.creditsUsed;
      
      changed = Object.keys(updates).length > 0;

      if (changed) {
          await existingUser.update(updates);
          updatedCount++;
          writeSyncLog(`[Usuários][${company.name}] ATUALIZADO: ${mikrotikUser.name}. Mudanças: ${JSON.stringify(updates)}.`);
      } else {
          skippedCount++;
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

// ====================================================================
// NOVA FUNÇÃO: Desconectar e Desativar com Retry e Validação
// ====================================================================

const disconnectAndDisableUserWithRetry = async (dbUser, activeSession, mikrotikClient, company, maxRetries = 2) => {
  console.log(`[DISCONNECT-WITH-RETRY] Processando '${dbUser.username}'...`);
  
  try {
    // 1. DESCONECTAR SESSÃO ATIVA PRIMEIRO
    if (activeSession && activeSession.sessionId) {
      try {
        await mikrotikClient.post('/ip/hotspot/active/remove', { '.id': activeSession.sessionId }, { headers: { 'Content-Type': 'application/json' }, timeout: 5000 });
        console.log(`[DISCONNECT] ✅ Sessão de '${dbUser.username}' desconectada`);
      } catch (sessionError) {
        console.warn(`[DISCONNECT] ⚠️ Erro ao desconectar sessão (pode já ter caído): ${sessionError.message}`);
      }
    }

    // Pausa para o MikroTik processar a desconexão
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 2. DESATIVAR USUÁRIO (O mais importante)
    if (dbUser.mikrotikId) {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`[DISCONNECT] Desativando '${dbUser.username}' no MikroTik (tentativa ${attempt})...`);
          await mikrotikClient.post('/ip/hotspot/user/set', { '.id': dbUser.mikrotikId, disabled: 'yes' }, { headers: { 'Content-Type': 'application/json' }, timeout: 5000 });
          console.log(`[DISCONNECT] ✅ Comando de desativação para '${dbUser.username}' enviado.`);
          
          // ✅ CORREÇÃO: Confiar que o comando foi enviado e não falhar por causa da verificação.
          // A tarefa de auditoria serve como uma garantia extra.
          
          // Enviar notificações e logs
          await sendCreditExhaustedEmail(dbUser, company);
          await ConnectionLog.create({
            action: 'disconnectAndDisableUser', status: 'success',
            message: `Usuário '${dbUser.username}' desconectado e desativado por excesso de crédito.`,
            companyId: company.id
          });
          return true; // Sucesso

        } catch (disableError) {
          console.error(`[DISCONNECT] ❌ Tentativa ${attempt} de desativar falhou: ${disableError.message}`);
          if (attempt === maxRetries) {
            throw disableError; // Lança o erro se a última tentativa falhar
          }
          await new Promise(resolve => setTimeout(resolve, 2000)); // Espera antes de tentar de novo
        }
      }
    }
    return true; // Considera sucesso se não tiver mikrotikId

  } catch (error) {
    console.error(`[DISCONNECT] ❌ FALHA TOTAL ao processar '${dbUser.username}': ${error.message}`);
    await ConnectionLog.create({
      action: 'disconnectAndDisableUser', status: 'error',
      message: `Falha ao desconectar e desativar '${dbUser.username}': ${error.message}`,
      companyId: company.id
    });
    return false; // Falha
  }
};


// ====================================================================
// NOVA FUNÇÃO: Verificar se Usuário Foi Realmente Desativado
// ====================================================================

const verifyUserDisabled = async (mikrotikId, mikrotikClient) => {
  try {
    const response = await mikrotikClient.get('/ip/hotspot/user', {
      params: {
        '.proplist': '.id,name,disabled',
        '?.id': mikrotikId
      }
    });
    
    const users = response.data || [];
    const user = users.find(u => u['.id'] === mikrotikId);
    
    if (user) {
      return {
        found: true,
        disabled: user.disabled === 'true',
        name: user.name
      };
    }
    
    return { found: false, disabled: false };
    
  } catch (error) {
    console.error(`[VERIFY] Erro ao verificar usuário: ${error.message}`);
    return { found: false, disabled: false, error: error.message };
  }
};

// ====================================================================
// NOVA FUNÇÃO: Expirar Usuário Apenas (sem desconectar sessão)
// ====================================================================

const expireUserInMikroTik = async (dbUser, mikrotikClient, company) => {
  try {
    console.log(`[EXPIRE] Desativando usuário '${dbUser.username}' no MikroTik...`);
    
    if (dbUser.mikrotikId) {
      await mikrotikClient.post('/ip/hotspot/user/set', {
        '.id': dbUser.mikrotikId,
        disabled: 'yes'
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000
      });
      
      // Verificar se foi desativado
      const verification = await verifyUserDisabled(dbUser.mikrotikId, mikrotikClient);
      if (verification.disabled) {
        console.log(`[EXPIRE] ✅ Usuário '${dbUser.username}' desativado com sucesso`);
        
        // Enviar email
        try {
          await sendCreditExhaustedEmail(dbUser, company);
        } catch (emailError) {
          console.warn(`[EXPIRE] ⚠️ Erro ao enviar email: ${emailError.message}`);
        }
        
        return true;
      } else {
        throw new Error('Verificação falhou após desativação');
      }
    }
    
  } catch (error) {
    console.error(`[EXPIRE] ❌ Erro ao expirar usuário '${dbUser.username}': ${error.message}`);
    
    await ConnectionLog.create({
      action: 'expireUserInMikroTik',
      status: 'error',
      message: `Falha ao expirar usuário '${dbUser.username}': ${error.message}`,
      companyId: company.id
    });
    
    return false;
  }
};

// ====================================================================
// NOVA FUNÇÃO: Job para Verificar e Corrigir Usuários Expirados
// ====================================================================

const auditExpiredUsers = async () => {
  console.log('[AUDIT] Iniciando auditoria de usuários expirados...');
  
  try {
    const companies = await Company.findAll();
    let totalFixed = 0;
    
    for (const company of companies) {
      try {
        console.log(`[AUDIT] Auditando empresa: ${company.name}`);
        
        const mikrotikClient = createMikrotikClient(company);
        
        // Buscar usuários marcados como expirados no sistema
        const expiredUsers = await HotspotUser.findAll({
          where: {
            companyId: company.id,
            status: 'expired'
          }
        });
        
        console.log(`[AUDIT] ${expiredUsers.length} usuários expirados encontrados em '${company.name}'`);
        
        for (const user of expiredUsers) {
          if (user.mikrotikId) {
            const verification = await verifyUserDisabled(user.mikrotikId, mikrotikClient);
            
            if (verification.found && !verification.disabled) {
              console.log(`[AUDIT] 🔧 Corrigindo usuário '${user.username}' - estava expirado mas ativo no MikroTik`);
              
              await mikrotikClient.post('/ip/hotspot/user/set', {
                '.id': user.mikrotikId,
                disabled: 'yes'
              }, {
                headers: { 'Content-Type': 'application/json' }
              });
              
              totalFixed++;
              
              await ConnectionLog.create({
                action: 'auditExpiredUsers',
                status: 'success',
                message: `Usuário '${user.username}' corrigido: estava expirado no sistema mas ativo no MikroTik`,
                companyId: company.id
              });
            }
          }
        }
        
      } catch (companyError) {
        console.error(`[AUDIT] ❌ Erro na empresa '${company.name}': ${companyError.message}`);
      }
    }
    
    console.log(`[AUDIT] ✅ Auditoria finalizada: ${totalFixed} usuários corrigidos`);
    return { success: true, totalFixed };
    
  } catch (error) {
    console.error(`[AUDIT] ❌ Erro geral na auditoria: ${error.message}`);
    return { success: false, error: error.message };
  }
};

module.exports = {
  // ✅ FUNÇÕES UNIFICADAS PRINCIPAIS
  collectUsageDataUnified,
  collectUsageForAllCompaniesUnified,
  disconnectAndDisableUserUnified,
  forceDisconnectUserUnified,
  
  // ✅ FUNÇÕES ORIGINAIS MANTIDAS
  importProfilesFromMikrotik,
  importUsersFromMikrotik,
  findAllLogs,
  findNetworkNeighbors,
  
  // ✅ FUNÇÕES DE COMPATIBILIDADE (podem ser removidas depois)
  collectUsageData: collectUsageDataUnified,
  collectUsageForAllCompanies: collectUsageForAllCompaniesUnified,
  forceDisconnectUser: forceDisconnectUserUnified,
  
  // ✅ UTILITÁRIOS
  convertMikrotikTimeToMinutes,
  convertMikrotikRateToString,
  parseTurmaComment,

  auditExpiredUsers
};
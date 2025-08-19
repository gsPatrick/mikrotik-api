// src/features/mikrotik/mikrotik.service.js - VERSÃO UNIFICADA
const { Op } = require('sequelize');
const { Company, HotspotUser, Profile, ConnectionLog, Settings } = require('../../models');
const { createMikrotikClient } = require('../../config/mikrotik');
const { sendCreditExhaustedEmail } = require('../../services/email.service');
const bcrypt = require('bcryptjs');
const { writeSyncLog } = require('../../services/syncLog.service');

// ✅ FUNÇÃO PRINCIPAL UNIFICADA: Coleta de uso em tempo real
const collectUsageDataUnified = async (companyId) => {
  console.log(`[COLLECT-UNIFIED] Iniciando coleta para empresa ID: ${companyId}`);
  
  const company = await Company.findByPk(companyId);
  if (!company) return { error: 'Empresa não encontrada.' };

  const mikrotikClient = createMikrotikClient(company);
  const startTime = Date.now();
  const action = 'collectUsageDataUnified';

  try {
    // 1. BUSCAR DADOS DO MIKROTIK
    console.log(`[COLLECT-UNIFIED] Buscando dados do MikroTik...`);
    
    const [activeSessionsResponse, allUsersResponse] = await Promise.all([
      mikrotikClient.get('/ip/hotspot/active'),
      mikrotikClient.get('/ip/hotspot/user')
    ]);
    
    const activeSessions = Array.isArray(activeSessionsResponse.data) ? activeSessionsResponse.data : [];
    const allMikrotikUsers = Array.isArray(allUsersResponse.data) ? allUsersResponse.data : [];
    
    console.log(`[COLLECT-UNIFIED] ${activeSessions.length} sessões ativas, ${allMikrotikUsers.length} usuários cadastrados`);

    // 2. MAPEAR SESSÕES ATIVAS
    const activeSessionsMap = new Map();
    activeSessions.forEach(session => {
      if (session.user || session.name) {
        const username = session.user || session.name;
        const bytesIn = parseInt(session['bytes-in'] || session.bytesIn || 0);
        const bytesOut = parseInt(session['bytes-out'] || session.bytesOut || 0);
        
        activeSessionsMap.set(username, {
          sessionId: session['.id'] || session.id,
          bytesIn,
          bytesOut,
          totalSessionBytes: bytesIn + bytesOut,
          address: session.address,
          macAddress: session['mac-address'] || session.mac,
          uptime: session.uptime
        });
      }
    });

    // 3. PROCESSAR USUÁRIOS DO BANCO
    const dbUsers = await HotspotUser.findAll({
      where: { companyId },
      include: [{ model: Company, as: 'company' }]
    });

    let updatedCount = 0;
    let expiredCount = 0;
    let errors = 0;

    console.log(`[COLLECT-UNIFIED] Processando ${dbUsers.length} usuários do banco...`);

    for (const dbUser of dbUsers) {
      try {
        const activeSession = activeSessionsMap.get(dbUser.username);
        const previousSessionBytes = dbUser.currentSessionBytes || 0;
        
        if (activeSession) {
          // ✅ USUÁRIO ESTÁ ATIVO - CALCULAR INCREMENTO
          const currentSessionBytes = activeSession.totalSessionBytes;
          const incremento = currentSessionBytes - previousSessionBytes;
          
          // Só processar se houve incremento de consumo
          if (incremento > 0) {
            const newCreditsUsed = dbUser.creditsUsed + incremento;
            
            // VERIFICAR PERÍODO DE CARÊNCIA
            const isInGracePeriod = dbUser.lastResetDate && 
              ((new Date() - dbUser.lastResetDate) / (1000 * 60)) < 5;
            
            if (isInGracePeriod) {
              console.log(`[GRACE] '${dbUser.username}' em período de carência (${Math.round(((new Date() - dbUser.lastResetDate) / (1000 * 60)) * 10) / 10} min)`);
              
              // Apenas atualizar bytes, não verificar limite
              await dbUser.update({
                creditsUsed: newCreditsUsed,
                currentSessionBytes: currentSessionBytes,
                sessionId: activeSession.sessionId,
                lastCollectionTime: new Date()
              });
              
            } else {
              // VERIFICAR LIMITE DE CRÉDITO
              const willExceedLimit = newCreditsUsed >= dbUser.creditsTotal && dbUser.creditsTotal > 0;
              
              if (willExceedLimit && dbUser.status === 'active') {
                console.log(`[LIMIT] '${dbUser.username}' excedeu limite: ${Math.round(newCreditsUsed/1024/1024)}MB/${Math.round(dbUser.creditsTotal/1024/1024)}MB`);
                
                // DESCONECTAR E DESATIVAR
                await disconnectAndDisableUserUnified(dbUser, activeSession, mikrotikClient, company);
                expiredCount++;
                
                await dbUser.update({
                  creditsUsed: newCreditsUsed,
                  currentSessionBytes: 0, // Reset pois foi desconectado
                  sessionId: null,
                  status: 'expired',
                  lastCollectionTime: new Date()
                });
                
              } else {
                // ATUALIZAÇÃO NORMAL
                await dbUser.update({
                  creditsUsed: newCreditsUsed,
                  currentSessionBytes: currentSessionBytes,
                  sessionId: activeSession.sessionId,
                  lastCollectionTime: new Date()
                });
              }
            }
            
            console.log(`[COLLECT] '${dbUser.username}': +${Math.round(incremento/1024/1024*100)/100}MB (Total: ${Math.round(newCreditsUsed/1024/1024*100)/100}MB)`);
            updatedCount++;
            
          } else if (incremento < 0) {
            // NOVA SESSÃO DETECTADA (contadores resetaram)
            console.log(`[NEW-SESSION] '${dbUser.username}': Nova sessão iniciada`);
            
            await dbUser.update({
              currentSessionBytes: currentSessionBytes,
              sessionId: activeSession.sessionId,
              lastCollectionTime: new Date()
            });
          } else {
            // SEM INCREMENTO - apenas atualizar timestamp
            await dbUser.update({
              sessionId: activeSession.sessionId,
              lastCollectionTime: new Date()
            });
          }
          
        } else {
          // ✅ USUÁRIO NÃO ESTÁ ATIVO - LIMPAR SESSÃO SE NECESSÁRIO
          if (dbUser.sessionId) {
            console.log(`[LOGOUT] '${dbUser.username}': Logout detectado`);
            
            // Se havia bytes de sessão pendentes, acumular
            if (previousSessionBytes > 0) {
              const finalCreditsUsed = dbUser.creditsUsed + previousSessionBytes;
              
              await dbUser.update({
                creditsUsed: finalCreditsUsed,
                currentSessionBytes: 0,
                sessionId: null,
                lastLogoutTime: new Date()
              });
              
              console.log(`[LOGOUT] '${dbUser.username}': +${Math.round(previousSessionBytes/1024/1024*100)/100}MB final (Total: ${Math.round(finalCreditsUsed/1024/1024*100)/100}MB)`);
              
              // Verificar se excedeu após logout
              if (finalCreditsUsed >= dbUser.creditsTotal && dbUser.creditsTotal > 0 && dbUser.status === 'active') {
                await dbUser.update({ status: 'expired' });
                console.log(`[LOGOUT] '${dbUser.username}': Marcado como expirado após logout`);
              }
              
            } else {
              // Logout sem bytes pendentes
              await dbUser.update({
                sessionId: null,
                lastLogoutTime: new Date()
              });
            }
          }
        }
        
      } catch (userError) {
        console.error(`[COLLECT] ❌ Erro ao processar '${dbUser.username}': ${userError.message}`);
        errors++;
      }
    }

    // 4. LOG DE RESULTADO
    await ConnectionLog.create({
      action,
      status: 'success',
      message: `Coleta concluída: ${updatedCount} atualizados, ${expiredCount} expirados, ${errors} erros`,
      responseTime: Date.now() - startTime,
      companyId
    });

    console.log(`[COLLECT-UNIFIED] ✅ Finalizado: ${updatedCount} atualizados, ${expiredCount} expirados, ${errors} erros`);

    return {
      syncedUsersInDB: updatedCount,
      expiredUsers: expiredCount,
      errors,
      activeSessions: activeSessions.length,
      totalUsers: dbUsers.length
    };

  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    console.error(`[COLLECT-UNIFIED] ❌ Erro geral: ${errorMessage}`);
    
    await ConnectionLog.create({
      action,
      status: 'error',
      message: errorMessage,
      responseTime: Date.now() - startTime,
      companyId
    });
    
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
          disabled: 'true'
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
    if (mikrotikUser.password) {
      const salt = await bcrypt.genSalt(10);
      hashedPasswordForNewUser = await bcrypt.hash(mikrotikUser.password, salt);
    } else {
        const salt = await bcrypt.genSalt(10);
        hashedPasswordForNewUser = await bcrypt.hash('imported_user', salt);
    }

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
  parseTurmaComment
};
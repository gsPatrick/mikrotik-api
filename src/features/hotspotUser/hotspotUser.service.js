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

    // CORREÇÃO: Payload correto para criação de usuário no MikroTik
    const mikrotikPayload = {
      server: 'all',
      name: hotspotUserData.username,
      password: hotspotUserData.password,
      profile: profile.mikrotikName,
      comment: hotspotUserData.turma || '',
      disabled: hotspotUserData.status === 'inactive' ? 'true' : 'false'
    };

    console.log(`[CREATE] Criando usuário '${hotspotUserData.username}' no MikroTik. Payload:`, mikrotikPayload);

    const response = await mikrotikClient.post('/ip/hotspot/user/add', mikrotikPayload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    await ConnectionLog.create({
      action: 'createHotspotUser_Mikrotik', 
      status: 'success',
      message: `Usuário ${hotspotUserData.username} criado com sucesso no MikroTik.`,
      responseTime: Date.now() - startTime, 
      companyId: company.id
    });
    
    // Salvar dados no banco com senha hasheada e ID do MikroTik
    hotspotUserData.password = hashedPassword;
    hotspotUserData.mikrotikId = response.data['.id'] || response.data['ret'];
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
  console.log(`\n==========================================`);
  console.log(`[SERVICE] === INÍCIO UPDATE HOTSPOT USER ===`);
  console.log(`[SERVICE] Timestamp: ${new Date().toISOString()}`);
  console.log(`[SERVICE] ID do usuário: ${id}`);
  console.log(`[SERVICE] Dados recebidos:`, JSON.stringify(hotspotUserData, null, 2));
  console.log(`==========================================\n`);
  
  const hotspotUser = await findHotspotUserById(id);
  if (!hotspotUser) {
    console.log(`[SERVICE] ❌ Usuário não encontrado com ID: ${id}`);
    return null;
  }

  console.log(`[SERVICE] ✅ Usuário encontrado: '${hotspotUser.username}' (MikroTik ID: ${hotspotUser.mikrotikId})`);

  const company = await Company.findByPk(hotspotUser.companyId);
  console.log(`[SERVICE] ✅ Empresa: '${company.name}' (${company.mikrotikIp}:${company.mikrotikApiPort})`);
  
  const mikrotikClient = createMikrotikClient(company);
  const startTime = Date.now();

  try {
    // 1. Preparar o payload para enviar ao MikroTik (SEM .id no body)
    console.log(`\n[SERVICE] === CONSTRUINDO PAYLOAD MIKROTIK ===`);
    const mikrotikPayload = {};
    
    // USERNAME - Campo 'name' no MikroTik
    if (hotspotUserData.hasOwnProperty('username') && hotspotUserData.username !== null && hotspotUserData.username !== undefined) {
      mikrotikPayload.name = hotspotUserData.username;
      console.log(`[SERVICE] ✅ USERNAME: '${hotspotUser.username}' → '${hotspotUserData.username}'`);
    } else {
      console.log(`[SERVICE] ⚠️  USERNAME: Não será alterado`);
    }

    // PASSWORD
    if (hotspotUserData.hasOwnProperty('password') && hotspotUserData.password && hotspotUserData.password.length > 0) {
      mikrotikPayload.password = hotspotUserData.password;
      console.log(`[SERVICE] ✅ PASSWORD: Nova senha definida (${hotspotUserData.password.length} chars)`);
    } else {
      console.log(`[SERVICE] ⚠️  PASSWORD: Não será alterado`);
    }

    // PROFILE
    if (hotspotUserData.hasOwnProperty('profileId') && hotspotUserData.profileId) {
      const newProfile = await Profile.findByPk(hotspotUserData.profileId);
      if (!newProfile) {
        throw new Error('Novo perfil não encontrado.');
      }
      mikrotikPayload.profile = newProfile.mikrotikName;
      console.log(`[SERVICE] ✅ PROFILE: Novo perfil '${newProfile.mikrotikName}'`);
    } else {
      console.log(`[SERVICE] ⚠️  PROFILE: Não será alterado`);
    }

    // TURMA/COMMENT
    if (hotspotUserData.hasOwnProperty('turma')) {
      mikrotikPayload.comment = hotspotUserData.turma || '';
      console.log(`[SERVICE] ✅ TURMA: '${hotspotUser.turma || 'Vazio'}' → '${hotspotUserData.turma || 'Vazio'}'`);
    } else {
      console.log(`[SERVICE] ⚠️  TURMA: Não será alterada`);
    }

    // STATUS/DISABLED
    let finalStatus = hotspotUserData.status || hotspotUser.status;
    
    // Lógica automática de status baseada na turma ativa
    if (hotspotUserData.turma !== undefined || hotspotUserData.status) {
      const newTurma = hotspotUserData.turma !== undefined ? hotspotUserData.turma : hotspotUser.turma;
      const activeTurma = company.activeTurma || 'Nenhuma';
      
      console.log(`[SERVICE] 🔄 Verificando status automático:`);
      console.log(`[SERVICE]   - Turma do usuário: '${newTurma}'`);
      console.log(`[SERVICE]   - Turma ativa da empresa: '${activeTurma}'`);
      
      if (activeTurma !== 'Nenhuma' && newTurma !== activeTurma) {
        finalStatus = 'inactive';
        console.log(`[SERVICE] 🔄 AUTO-SYNC: Status → 'inactive' (turma não ativa)`);
      } else if (activeTurma === 'Nenhuma' || newTurma === activeTurma) {
        if (!hotspotUserData.status || hotspotUserData.status === 'active') {
          finalStatus = 'active';
          console.log(`[SERVICE] 🔄 AUTO-SYNC: Status → 'active' (turma ativa)`);
        }
      }
    }

    mikrotikPayload.disabled = (finalStatus === 'inactive' || finalStatus === 'expired') ? 'true' : 'false';
    console.log(`[SERVICE] ✅ STATUS: '${hotspotUser.status}' → '${finalStatus}' (disabled: ${mikrotikPayload.disabled})`);

    // Mostrar payload final
    console.log(`\n[SERVICE] === PAYLOAD FINAL PARA MIKROTIK ===`);
    console.log(JSON.stringify(mikrotikPayload, null, 2));
    console.log(`[SERVICE] Total de campos: ${Object.keys(mikrotikPayload).length}`);
    console.log(`[SERVICE] ==========================================\n`);
    
    // ✅ CORREÇÃO PRINCIPAL: Usar PATCH com ID na URL
    console.log(`[SERVICE] 🚀 Enviando PATCH para MikroTik...`);
    console.log(`[SERVICE] URL: ${company.mikrotikIp}:${company.mikrotikApiPort}/rest/ip/hotspot/user/${hotspotUser.mikrotikId}`);
    console.log(`[SERVICE] Method: PATCH`);
    
    const mikrotikResponse = await mikrotikClient.patch(`/ip/hotspot/user/${hotspotUser.mikrotikId}`, mikrotikPayload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`[SERVICE] ✅ RESPOSTA MIKROTIK:`);
    console.log(`[SERVICE] Status: ${mikrotikResponse.status}`);
    console.log(`[SERVICE] Data:`, mikrotikResponse.data);
    console.log(`[SERVICE] Tempo de resposta: ${Date.now() - startTime}ms`);

    // 2. Preparar dados para salvar no banco local
    console.log(`\n[SERVICE] === ATUALIZANDO BANCO LOCAL ===`);
    const dataToSave = { ...hotspotUserData };
    
    if (hotspotUserData.password && hotspotUserData.password.length > 0) {
      console.log(`[SERVICE] 🔐 Gerando hash da senha para o banco...`);
      const salt = await bcrypt.genSalt(10);
      dataToSave.password = await bcrypt.hash(hotspotUserData.password, salt);
      console.log(`[SERVICE] ✅ Senha hasheada para o banco`);
    } else {
      console.log(`[SERVICE] 🔐 Removendo password dos dados (não será alterado)`);
      delete dataToSave.password;
    }

    dataToSave.status = finalStatus;
    
    console.log(`[SERVICE] Salvando no banco:`, {
      username: dataToSave.username,
      status: dataToSave.status,
      turma: dataToSave.turma,
      profileId: dataToSave.profileId,
      hasPassword: !!dataToSave.password
    });

    // 3. Salvar alterações no banco
    const updatedUser = await hotspotUser.update(dataToSave);
    console.log(`[SERVICE] ✅ Banco atualizado com sucesso!`);
    
    // 4. Verificação final
    const finalUser = await findHotspotUserById(id);
    console.log(`\n[SERVICE] === RESULTADO FINAL ===`);
    console.log(`[SERVICE] Username: '${hotspotUser.username}' → '${finalUser.username}'`);
    console.log(`[SERVICE] Status: '${hotspotUser.status}' → '${finalUser.status}'`);
    console.log(`[SERVICE] Turma: '${hotspotUser.turma || 'Vazio'}' → '${finalUser.turma || 'Vazio'}'`);
    console.log(`[SERVICE] UpdatedAt: ${finalUser.updatedAt}`);
    console.log(`[SERVICE] ===============================\n`);
    
    // 5. Log de conexão
    await ConnectionLog.create({ 
      action: 'updateHotspotUser_Mikrotik', 
      status: 'success', 
      message: `Usuário ${hotspotUser.username} atualizado com sucesso. Novo nome: ${finalUser.username}, Status: ${finalStatus}`, 
      responseTime: Date.now() - startTime, 
      companyId: company.id 
    });

    console.log(`[SERVICE] === SUCESSO TOTAL (${Date.now() - startTime}ms) ===\n`);
    return finalUser;

  } catch (error) {
    console.log(`\n[SERVICE] === ERRO NO UPDATE ===`);
    console.log(`[SERVICE] Tipo: ${error.constructor.name}`);
    console.log(`[SERVICE] Mensagem: ${error.message}`);
    
    if (error.response) {
      console.log(`[SERVICE] HTTP Status: ${error.response.status}`);
      console.log(`[SERVICE] HTTP Data:`, error.response.data);
      console.log(`[SERVICE] HTTP Headers:`, error.response.headers);
    }
    
    if (error.request) {
      console.log(`[SERVICE] Request sem resposta:`, error.request);
    }
    
    console.log(`[SERVICE] Config:`, error.config);
    console.log(`[SERVICE] Stack:`, error.stack);
    console.log(`[SERVICE] Tempo até erro: ${Date.now() - startTime}ms`);
    
    const errorMessage = error.response?.data?.message || error.message;
    await ConnectionLog.create({ 
      action: 'updateHotspotUser_Mikrotik', 
      status: 'error', 
      message: `Erro ao atualizar usuário ${hotspotUser.username}: ${errorMessage}`, 
      responseTime: Date.now() - startTime, 
      companyId: company.id 
    });
    
    console.log(`[SERVICE] === FIM DO ERRO ===\n`);
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
    // CORREÇÃO: Usar POST com endpoint /remove e payload com .id
    await mikrotikClient.post('/ip/hotspot/user/remove', {
      '.id': hotspotUser.mikrotikId
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    await ConnectionLog.create({ 
      action: 'deleteHotspotUser_Mikrotik', 
      status: 'success', 
      message: `Usuário ${hotspotUser.username} deletado do MikroTik.`, 
      responseTime: Date.now() - startTime, 
      companyId: company.id 
    });
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    if (errorMessage.includes('no such item') || errorMessage.includes('not found')) {
      await ConnectionLog.create({ 
        action: 'deleteHotspotUser_Mikrotik', 
        status: 'success', 
        message: `Usuário ${hotspotUser.username} já não existia no MikroTik.`, 
        responseTime: Date.now() - startTime, 
        companyId: company.id 
      });
    } else {
      await ConnectionLog.create({ 
        action: 'deleteHotspotUser_Mikrotik', 
        status: 'error', 
        message: errorMessage, 
        responseTime: Date.now() - startTime, 
        companyId: company.id 
      });
      throw new Error(`Falha ao deletar usuário no MikroTik: ${errorMessage}`);
    }
  }

  await hotspotUser.destroy();
  return hotspotUser;
};

// ✅ CORREÇÃO 5: Função para ajuste manual de créditos (sem mexer nos contadores MikroTik)
const updateCreditsCorrect = async (userId, creditData, performingUser) => {
  const hotspotUser = await findHotspotUserById(userId);
  if (!hotspotUser) throw new Error('Usuário do hotspot não encontrado.');

  const company = await Company.findByPk(hotspotUser.companyId);
  const startTime = Date.now();

  try {
    const dataToUpdate = {};
    
    // Apenas ajustar limites e acúmulo interno
    if (creditData.creditsTotal !== undefined) {
      dataToUpdate.creditsTotal = creditData.creditsTotal;
    }
    
    if (creditData.creditsUsed !== undefined) {
      dataToUpdate.creditsUsed = creditData.creditsUsed;
    }
    
    // Se zerou os créditos usados, pode reativar usuário
    if (creditData.creditsUsed === 0 && hotspotUser.status === 'expired') {
      dataToUpdate.status = 'active';
      dataToUpdate.currentSessionBytes = 0;
      
      // Reativar no MikroTik se estava desabilitado
      if (hotspotUser.mikrotikId) {
        const mikrotikClient = createMikrotikClient(company);
        await mikrotikClient.patch(`/rest/ip/hotspot/user/${hotspotUser.mikrotikId}`, {
          disabled: 'false'
        });
        console.log(`[UPDATE] ✅ Usuário '${hotspotUser.username}' reativado no MikroTik`);
      }
    }

    const updatedUser = await hotspotUser.update(dataToUpdate);
    
    await ConnectionLog.create({
      action: 'updateCredits_Internal',
      status: 'success',
      message: `Créditos de '${hotspotUser.username}' ajustados por '${performingUser.name}'. Usado: ${Math.round(dataToUpdate.creditsUsed/1024/1024*100)/100}MB, Limite: ${Math.round(dataToUpdate.creditsTotal/1024/1024*100)/100}MB.`,
      responseTime: Date.now() - startTime,
      companyId: company.id,
    });
    
    return updatedUser;
    
  } catch (error) {
    console.error(`[UPDATE] ❌ Erro ao ajustar créditos: ${error.message}`);
    throw error;
  }
};

// SISTEMA CORRETO DE ACÚMULO DE DADOS MIKROTIK

// ✅ CORREÇÃO 1: Função para coletar uso DURANTE a sessão ativa


// ✅ CORREÇÃO 2: Função para capturar dados no LOGOUT
const captureLogoutUsage = async (username, companyId, mikrotikClient) => {
  try {
    // Buscar dados da sessão que está terminando
    const activeResponse = await mikrotikClient.get('/rest/ip/hotspot/active');
    const userSession = activeResponse.data?.find(u => u.user === username);
    
    if (userSession) {
      const bytesIn = parseInt(userSession['bytes-in'] || 0);
      const bytesOut = parseInt(userSession['bytes-out'] || 0);
      const totalSessionBytes = bytesIn + bytesOut;
      
      const hotspotUser = await HotspotUser.findOne({
        where: { username, companyId }
      });
      
      if (hotspotUser && totalSessionBytes > 0) {
        // Acumular dados finais da sessão
        const finalTotal = hotspotUser.creditsUsed + totalSessionBytes;
        
        await hotspotUser.update({
          creditsUsed: finalTotal,
          currentSessionBytes: 0, // Reset para próxima sessão
          lastLogoutTime: new Date()
        });
        
        console.log(`[LOGOUT] '${username}': Sessão finalizada com ${Math.round(totalSessionBytes/1024/1024*100)/100}MB`);
      }
    }
  } catch (error) {
    console.error(`[LOGOUT] Erro ao capturar dados do logout: ${error.message}`);
  }
};

// ✅ CORREÇÃO 3: Função para desconectar usuário que excedeu limite


// ✅ CORREÇÃO PARA O JOB DE RESET DIÁRIO
const resetDailyCreditsForAllUsers = async () => {
  console.log(`--- Iniciando job: Reset Diário de Créditos (CORRETO) ---`);
  const settings = await Settings.findByPk(1);
  if (!settings) {
    console.error('FALHA no reset: Configurações do sistema não encontradas.');
    return;
  }

  const newCreditTotalBytes = settings.defaultDailyCreditMB * 1024 * 1024;

  try {
    const companies = await Company.findAll();
    const companyTurmaMap = new Map(companies.map(c => [c.id, c.activeTurma]));

    const allUsers = await HotspotUser.findAll({ include: [{ model: Company, as: 'company' }] });
    
    const usersToReset = [];
    for (const user of allUsers) {
      const activeTurma = companyTurmaMap.get(user.companyId) || 'Nenhuma';
      const userTurma = user.turma || 'Nenhuma';

      if (activeTurma === 'Nenhuma' || userTurma === activeTurma) {
        usersToReset.push(user);
      }
    }

    if (usersToReset.length === 0) {
      console.log("Nenhum usuário elegível para o reset de créditos hoje.");
      return;
    }

    console.log(`[RESET] Processando ${usersToReset.length} usuários elegíveis...`);

    // ✅ RESET CORRETO: Não mexe nos contadores do MikroTik
    // Apenas reseta o acúmulo interno e reativa usuários
    
    const userIdsToReset = usersToReset.map(u => u.id);
    const [affectedCount] = await HotspotUser.update(
      { 
        creditsUsed: 0,                    // Reset do acúmulo interno
        creditsTotal: newCreditTotalBytes, // Novo limite
        currentSessionBytes: 0,            // Reset da sessão atual
        status: 'active',                  // Reativar
        lastResetDate: new Date()          // Marcar quando foi resetado
      },
      { where: { id: { [Op.in]: userIdsToReset } } }
    );

    // Reativar usuários no MikroTik
    const usersByCompany = usersToReset.reduce((acc, user) => {
      if (user.company) {
        if (!acc[user.companyId]) {
          acc[user.companyId] = { company: user.company, users: [] };
        }
        acc[user.companyId].users.push(user);
      }
      return acc;
    }, {});

    let totalSuccess = 0;
    let totalErrors = 0;

    for (const companyId in usersByCompany) {
      const { company, users } = usersByCompany[companyId];
      const mikrotikClient = createMikrotikClient(company);
      
      for (const user of users) {
        if (user.mikrotikId) {
          try {
            // ✅ Apenas reativar o usuário (sem mexer nos contadores)
            await mikrotikClient.patch(`/rest/ip/hotspot/user/${user.mikrotikId}`, {
              disabled: 'false'
            });
            
            console.log(`[RESET] ✅ '${user.username}' - Reativado no MikroTik`);
            totalSuccess++;
            
          } catch (error) {
            console.error(`[RESET] ❌ Falha ao reativar '${user.username}': ${error.message}`);
            totalErrors++;
          }
        }
      }
    }
    
    console.log(`[${new Date().toISOString()}] SUCESSO no reset. ${totalSuccess} usuários reativados, ${totalErrors} erros. ${affectedCount} registros resetados no banco.`);

  } catch (error) {
    console.error(`[${new Date().toISOString()}] FALHA GERAL no reset de créditos. Erro: ${error.message}`);
  }
  console.log(`--- Finalizado job: Reset Diário de Créditos (CORRETO) ---`);
};

// ✅ NOVA FUNÇÃO PARA VERIFICAR SINCRONIZAÇÃO DE CONTADORES
const syncUserCountersWithMikrotik = async (userId) => {
  const hotspotUser = await findHotspotUserById(userId);
  if (!hotspotUser || !hotspotUser.mikrotikId) {
    throw new Error('Usuário do hotspot não encontrado ou sem ID do MikroTik.');
  }

  const company = await Company.findByPk(hotspotUser.companyId);
  const mikrotikClient = createMikrotikClient(company);

  try {
    // Buscar dados atuais do usuário no MikroTik
    const response = await mikrotikClient.get(`/rest/ip/hotspot/user/${hotspotUser.mikrotikId}`);
    const mikrotikData = response.data;

    const bytesIn = parseInt(mikrotikData['bytes-in'] || 0);
    const bytesOut = parseInt(mikrotikData['bytes-out'] || 0);
    const totalBytesUsed = bytesIn + bytesOut;

    console.log(`[SYNC] Usuário '${hotspotUser.username}':`, {
      banco: `${Math.round(hotspotUser.creditsUsed / 1024 / 1024)}MB`,
      mikrotik: `${Math.round(totalBytesUsed / 1024 / 1024)}MB`,
      diferenca: `${Math.round((totalBytesUsed - hotspotUser.creditsUsed) / 1024 / 1024)}MB`
    });

    // Atualizar banco com dados do MikroTik se houver diferença significativa
    if (Math.abs(totalBytesUsed - hotspotUser.creditsUsed) > 1024 * 1024) { // Diferença > 1MB
      await hotspotUser.update({ creditsUsed: totalBytesUsed });
      console.log(`[SYNC] ✅ Contadores sincronizados para '${hotspotUser.username}'`);
    }

    return {
      userId,
      bankCreditsUsed: hotspotUser.creditsUsed,
      mikrotikCreditsUsed: totalBytesUsed,
      synchronized: true
    };

  } catch (error) {
    console.error(`[SYNC] ❌ Erro ao sincronizar contadores do usuário '${hotspotUser.username}': ${error.message}`);
    throw error;
  }
};

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
    dataToUpdateInDb.creditsUsed = 0;
  }
  
  try {
    if (dataToUpdateInDb.creditsTotal !== undefined) {
      console.log(`[RESET] Resetando contadores do usuário '${hotspotUser.username}' (ID: ${hotspotUser.mikrotikId})`);
      
      // ✅ CORREÇÃO 1: Usar endpoint correto para reset de contadores
      try {
        // Método 1: Usando comando específico via REST
        await mikrotikClient.post('/rest/cmd', {
          command: '/ip/hotspot/user/reset-counters',
          arguments: {
            '.id': hotspotUser.mikrotikId
          }
        }, {
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        console.log(`[RESET] ✅ Contadores resetados via comando específico`);
      } catch (cmdError) {
        console.log(`[RESET] ⚠️ Comando específico falhou, tentando método alternativo...`);
        
        // Método 2: Alternativo usando POST com numbers
        await mikrotikClient.post('/rest/ip/hotspot/user/reset-counters', {
          numbers: hotspotUser.mikrotikId
        }, {
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        console.log(`[RESET] ✅ Contadores resetados via método alternativo`);
      }
      
      // ✅ CORREÇÃO 2: Aguardar um pouco para o MikroTik processar
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // ✅ CORREÇÃO 3: Verificar se o reset foi bem-sucedido (opcional)
      try {
        const userInfo = await mikrotikClient.get(`/rest/ip/hotspot/user/${hotspotUser.mikrotikId}`);
        console.log(`[RESET] Status após reset:`, {
          bytesIn: userInfo.data['bytes-in'] || 0,
          bytesOut: userInfo.data['bytes-out'] || 0,
          packetsIn: userInfo.data['packets-in'] || 0,
          packetsOut: userInfo.data['packets-out'] || 0
        });
      } catch (verifyError) {
        console.log(`[RESET] ⚠️ Não foi possível verificar o status após reset: ${verifyError.message}`);
      }
    }

    // Atualizar banco apenas após sucesso no MikroTik
    const updatedUser = await hotspotUser.update(dataToUpdateInDb);
    
    await ConnectionLog.create({
      action, 
      status: 'success',
      message: `Créditos de '${hotspotUser.username}' atualizados por '${performingUser.name}'. Novo total: ${dataToUpdateInDb.creditsTotal / (1024*1024)} MB. Contadores resetados no MikroTik.`,
      responseTime: Date.now() - startTime, 
      companyId: company.id,
    });
    
    await createActivityLog({
      userId: performingUser.id, 
      type: 'hotspot_user_credit',
      description: `O crédito do usuário '${hotspotUser.username}' foi alterado para ${dataToUpdateInDb.creditsTotal / (1024*1024)}MB e contadores foram resetados.`
    });
    
    return updatedUser;
    
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    console.error(`[RESET] ❌ ERRO:`, {
      message: errorMessage,
      status: error.response?.status,
      data: error.response?.data,
      config: error.config
    });
    
    await ConnectionLog.create({
      action, 
      status: 'error',
      message: `Falha ao resetar contadores no MikroTik para '${hotspotUser.username}': ${errorMessage}`,
      responseTime: Date.now() - startTime, 
      companyId: company.id,
    });
    throw new Error(`Falha ao resetar contadores no MikroTik: ${errorMessage}`);
  }
};
// NOVA FUNÇÃO: Sincronização automática individual de usuário
const syncUserStatusWithMikrotik = async (userId) => {
  const hotspotUser = await findHotspotUserById(userId);
  if (!hotspotUser || !hotspotUser.mikrotikId) {
    throw new Error('Usuário do hotspot não encontrado ou sem ID do MikroTik.');
  }

  const company = await Company.findByPk(hotspotUser.companyId);
  const mikrotikClient = createMikrotikClient(company);
  const startTime = Date.now();

  try {
    const userTurma = hotspotUser.turma || 'Nenhuma';
    const activeTurma = company.activeTurma || 'Nenhuma';
    const shouldBeActive = activeTurma === 'Nenhuma' || userTurma === activeTurma;
    
    let targetStatus = shouldBeActive ? 'active' : 'inactive';
    
    // Se o usuário já tem status 'expired', manter como expired
    if (hotspotUser.status === 'expired') {
      targetStatus = 'expired';
    }

    console.log(`[AUTO-SYNC] Usuário: ${hotspotUser.username}, Turma: ${userTurma}, Turma Ativa: ${activeTurma}, Status Alvo: ${targetStatus}`);

    // Atualizar no MikroTik
    await mikrotikClient.post('/ip/hotspot/user/set', {
      '.id': hotspotUser.mikrotikId,
      disabled: (targetStatus === 'inactive' || targetStatus === 'expired') ? 'true' : 'false'
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Atualizar no banco local
    await hotspotUser.update({ status: targetStatus });

    await ConnectionLog.create({
      action: 'syncUserStatusWithMikrotik',
      status: 'success',
      message: `Status do usuário '${hotspotUser.username}' sincronizado automaticamente para '${targetStatus}'.`,
      responseTime: Date.now() - startTime,
      companyId: company.id
    });

    console.log(`[AUTO-SYNC] ✅ Status do usuário '${hotspotUser.username}' sincronizado para '${targetStatus}'.`);
    
    return { userId, oldStatus: hotspotUser.status, newStatus: targetStatus };

  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    await ConnectionLog.create({
      action: 'syncUserStatusWithMikrotik',
      status: 'error',
      message: `Falha ao sincronizar status do usuário '${hotspotUser.username}': ${errorMessage}`,
      responseTime: Date.now() - startTime,
      companyId: company.id
    });
    throw new Error(`Falha ao sincronizar usuário com MikroTik: ${errorMessage}`);
  }
};



// ✅ FUNÇÃO 1: Coleta de uso durante sessões ativas
const collectActiveSessionUsage = async () => {
  console.log(`[COLLECT] Iniciando coleta de uso de sessões ativas...`);
  
  try {
    const companies = await Company.findAll();
    let totalProcessed = 0;
    let totalErrors = 0;
    
    for (const company of companies) {
      const mikrotikClient = createMikrotikClient(company);
      
      try {
        // Buscar usuários ATIVOS (com sessão em andamento) no MikroTik
        const activeUsersResponse = await mikrotikClient.get('/rest/ip/hotspot/active');
        const activeUsers = activeUsersResponse.data || [];
        
        console.log(`[COLLECT] Empresa '${company.name}': ${activeUsers.length} usuários ativos`);
        
        for (const activeUser of activeUsers) {
          try {
            const username = activeUser.user;
            const sessionId = activeUser['.id'];
            const bytesIn = parseInt(activeUser['bytes-in'] || 0);
            const bytesOut = parseInt(activeUser['bytes-out'] || 0);
            const currentSessionBytes = bytesIn + bytesOut;
            
            // Buscar usuário no banco
            const hotspotUser = await HotspotUser.findOne({
              where: { username, companyId: company.id }
            });
            
            if (!hotspotUser) {
              console.log(`[COLLECT] ⚠️ Usuário '${username}' ativo no MikroTik mas não encontrado no banco`);
              continue;
            }
            
            // ✅ VALIDAÇÃO: Só processar se diferença >= 1MB (1024*1024 bytes)
            const previousSessionUsage = hotspotUser.currentSessionBytes || 0;
            const incremento = currentSessionBytes - previousSessionUsage;
            const MIN_INCREMENT = 1024 * 1024; // 1MB
            
            if (incremento >= MIN_INCREMENT) {
              const novoTotal = hotspotUser.creditsUsed + incremento;
              
              await hotspotUser.update({
                creditsUsed: novoTotal,
                currentSessionBytes: currentSessionBytes,
                sessionId: sessionId,
                lastCollectionTime: new Date()
              });
              
              console.log(`[COLLECT] ✅ '${username}': +${Math.round(incremento/1024/1024*100)/100}MB (Total: ${Math.round(novoTotal/1024/1024*100)/100}MB/${Math.round(hotspotUser.creditsTotal/1024/1024*100)/100}MB)`);
              
              // ✅ VERIFICAR SE EXCEDEU LIMITE
              if (novoTotal >= hotspotUser.creditsTotal) {
                console.log(`[COLLECT] 🚨 '${username}' excedeu limite! Desconectando...`);
                await disconnectAndDisableUser(hotspotUser, company, mikrotikClient);
              }
              
              totalProcessed++;
            } else if (incremento > 0) {
              // Atualizar apenas currentSessionBytes sem registrar no total (menor que 1MB)
              await hotspotUser.update({
                currentSessionBytes: currentSessionBytes,
                sessionId: sessionId,
                lastCollectionTime: new Date()
              });
              
              console.log(`[COLLECT] ⏸️ '${username}': +${Math.round(incremento/1024*100)/100}KB (aguardando 1MB)`);
            } else {
              // Apenas atualizar sessionId e timestamp se não havia antes
              if (!hotspotUser.sessionId) {
                await hotspotUser.update({
                  sessionId: sessionId,
                  lastCollectionTime: new Date()
                });
              }
            }
            
          } catch (userError) {
            console.error(`[COLLECT] ❌ Erro ao processar usuário: ${userError.message}`);
            totalErrors++;
          }
        }
        
        // Pequena pausa entre empresas
        if (activeUsers.length > 0) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        
      } catch (companyError) {
        console.error(`[COLLECT] ❌ Erro na empresa '${company.name}': ${companyError.message}`);
        totalErrors++;
      }
    }
    
    if (totalProcessed > 0 || totalErrors > 0) {
      console.log(`[COLLECT] Finalizado - Processados: ${totalProcessed}, Erros: ${totalErrors}`);
    }
    
  } catch (error) {
    console.error(`[COLLECT] ❌ Erro geral na coleta: ${error.message}`);
  }
};

// ✅ FUNÇÃO 2: Monitoramento de logouts via polling
const monitorUserLogouts = async () => {
  console.log(`[MONITOR] Verificando logouts...`);
  
  try {
    const companies = await Company.findAll();
    let totalLogouts = 0;
    
    for (const company of companies) {
      const mikrotikClient = createMikrotikClient(company);
      
      try {
        // 1. Buscar usuários ativos no MikroTik
        const activeResponse = await mikrotikClient.get('/rest/ip/hotspot/active');
        const activeUsers = activeResponse.data || [];
        const activeUsernames = activeUsers.map(u => u.user);
        
        // 2. Buscar usuários que ERAM ativos no banco mas NÃO estão mais
        const previouslyActiveUsers = await HotspotUser.findAll({
          where: {
            companyId: company.id,
            sessionId: { [Op.ne]: null }, // Tinham sessão ativa
            username: { [Op.notIn]: activeUsernames.length > 0 ? activeUsernames : ['__dummy__'] } // Mas não estão mais ativos
          }
        });
        
        if (previouslyActiveUsers.length > 0) {
          console.log(`[MONITOR] Empresa '${company.name}': ${previouslyActiveUsers.length} usuários fizeram logout`);
        }
        
        // 3. Para cada usuário que fez logout, capturar os dados finais
        for (const user of previouslyActiveUsers) {
          await captureUserLogout(user, company);
          totalLogouts++;
        }
        
      } catch (error) {
        console.error(`[MONITOR] ❌ Erro na empresa '${company.name}': ${error.message}`);
      }
    }
    
    if (totalLogouts > 0) {
      console.log(`[MONITOR] Finalizado - ${totalLogouts} logouts processados`);
    }
    
  } catch (error) {
    console.error(`[MONITOR] ❌ Erro geral no monitoramento: ${error.message}`);
  }
};

// ✅ FUNÇÃO 3: Capturar dados do logout
const captureUserLogout = async (hotspotUser, company) => {
  try {
    // Salvar último uso da sessão que terminou
    const finalSessionBytes = hotspotUser.currentSessionBytes || 0;
    
    if (finalSessionBytes > 0) {
      const newTotal = hotspotUser.creditsUsed + finalSessionBytes;
      
      await hotspotUser.update({
        creditsUsed: newTotal,
        currentSessionBytes: 0,
        sessionId: null,
        lastLogoutTime: new Date()
      });
      
      console.log(`[LOGOUT] ✅ '${hotspotUser.username}': Sessão finalizada +${Math.round(finalSessionBytes/1024/1024*100)/100}MB (Total: ${Math.round(newTotal/1024/1024*100)/100}MB)`);
      
      // Verificar se excedeu limite após logout
      if (newTotal >= hotspotUser.creditsTotal) {
        await hotspotUser.update({ status: 'expired' });
        
        // Desabilitar no MikroTik
        if (hotspotUser.mikrotikId) {
          const mikrotikClient = createMikrotikClient(company);
          
          try {
            await mikrotikClient.patch(`/rest/ip/hotspot/user/${hotspotUser.mikrotikId}`, {
              disabled: 'true'
            });
            
            console.log(`[LOGOUT] 🚨 '${hotspotUser.username}' excedeu limite e foi desabilitado`);
            
            // Enviar email de limite excedido
            try {
              await sendCreditExhaustedEmail(hotspotUser, company);
            } catch (emailError) {
              console.error(`[LOGOUT] ⚠️ Erro ao enviar email para '${hotspotUser.username}': ${emailError.message}`);
            }
            
          } catch (mikrotikError) {
            console.error(`[LOGOUT] ⚠️ Erro ao desabilitar '${hotspotUser.username}' no MikroTik: ${mikrotikError.message}`);
          }
        }
      }
      
    } else {
      // Usuário fez logout sem uso adicional, apenas limpar sessionId
      await hotspotUser.update({
        sessionId: null,
        lastLogoutTime: new Date()
      });
      
      console.log(`[LOGOUT] ⚪ '${hotspotUser.username}': Logout sem uso adicional`);
    }
    
  } catch (error) {
    console.error(`[LOGOUT] ❌ Erro ao capturar logout de '${hotspotUser.username}': ${error.message}`);
  }
};

// ✅ FUNÇÃO 4: Desconectar usuário que excedeu limite
const disconnectAndDisableUser = async (hotspotUser, company, mikrotikClient) => {
  try {
    console.log(`[DISCONNECT] Processando usuário '${hotspotUser.username}' que excedeu limite...`);
    
    // 1. Desconectar usuário ativo (forçar logout)
    if (hotspotUser.sessionId) {
      try {
        await mikrotikClient.post('/rest/ip/hotspot/active/remove', {
          numbers: hotspotUser.sessionId
        });
        console.log(`[DISCONNECT] ✅ '${hotspotUser.username}' desconectado da sessão ativa`);
      } catch (disconnectError) {
        console.error(`[DISCONNECT] ⚠️ Erro ao desconectar sessão: ${disconnectError.message}`);
      }
    }
    
    // 2. Desabilitar usuário
    if (hotspotUser.mikrotikId) {
      try {
        await mikrotikClient.patch(`/rest/ip/hotspot/user/${hotspotUser.mikrotikId}`, {
          disabled: 'true'
        });
        console.log(`[DISCONNECT] ✅ '${hotspotUser.username}' desabilitado no MikroTik`);
      } catch (disableError) {
        console.error(`[DISCONNECT] ⚠️ Erro ao desabilitar usuário: ${disableError.message}`);
      }
    }
    
    // 3. Atualizar status no banco
    await hotspotUser.update({ 
      status: 'expired',
      currentSessionBytes: 0,
      sessionId: null
    });
    
    // 4. Enviar email (se configurado)
    try {
      await sendCreditExhaustedEmail(hotspotUser, company);
      console.log(`[DISCONNECT] ✅ Email de limite excedido enviado para '${hotspotUser.username}'`);
    } catch (emailError) {
      console.error(`[DISCONNECT] ⚠️ Erro ao enviar email: ${emailError.message}`);
    }
    
    // 5. Log de atividade
    await ConnectionLog.create({
      action: 'userDisconnectedByLimit',
      status: 'success',
      message: `Usuário '${hotspotUser.username}' desconectado automaticamente por exceder limite de ${Math.round(hotspotUser.creditsTotal/1024/1024)}MB`,
      responseTime: 0,
      companyId: company.id
    });
    
  } catch (error) {
    console.error(`[DISCONNECT] ❌ Erro ao desconectar '${hotspotUser.username}': ${error.message}`);
    
    await ConnectionLog.create({
      action: 'userDisconnectedByLimit',
      status: 'error',
      message: `Falha ao desconectar usuário '${hotspotUser.username}': ${error.message}`,
      responseTime: 0,
      companyId: company.id
    });
  }
};

// ✅ FUNÇÃO 5: Limpeza de dados órfãos (sessões que não existem mais)
const cleanupOrphanedSessions = async () => {
  console.log(`[CLEANUP] Limpando sessões órfãs...`);
  
  try {
    const companies = await Company.findAll();
    let totalCleaned = 0;
    
    for (const company of companies) {
      const mikrotikClient = createMikrotikClient(company);
      
      try {
        // Buscar usuários ativos no MikroTik
        const activeResponse = await mikrotikClient.get('/rest/ip/hotspot/active');
        const activeUsers = activeResponse.data || [];
        const activeSessionIds = activeUsers.map(u => u['.id']);
        
        // Buscar usuários no banco com sessionId mas que não estão ativos
        const orphanedUsers = await HotspotUser.findAll({
          where: {
            companyId: company.id,
            sessionId: { [Op.ne]: null },
            sessionId: { [Op.notIn]: activeSessionIds.length > 0 ? activeSessionIds : ['__dummy__'] }
          }
        });
        
        for (const user of orphanedUsers) {
          await captureUserLogout(user, company);
          totalCleaned++;
        }
        
      } catch (error) {
        console.error(`[CLEANUP] ❌ Erro na empresa '${company.name}': ${error.message}`);
      }
    }
    
    if (totalCleaned > 0) {
      console.log(`[CLEANUP] ✅ ${totalCleaned} sessões órfãs limpas`);
    }
    
  } catch (error) {
    console.error(`[CLEANUP] ❌ Erro geral na limpeza: ${error.message}`);
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
  syncUserStatusWithMikrotik, 
  captureLogoutUsage,              // ✅ Captura no logout
  disconnectAndDisableUser,        // ✅ Desconecta quando excede
  resetDailyCreditsForAllUsers,    // ✅ Reset correto
  updateCreditsCorrect,            // ✅ Ajuste manual correto


    // ✅ NOVAS FUNÇÕES DE POLLING
  collectActiveSessionUsage,        // Coleta uso de sessões ativas (validação 1MB)
  monitorUserLogouts,              // Monitora logouts via polling
  captureUserLogout,               // Captura dados específicos do logout
  cleanupOrphanedSessions,         // Limpa sessões órfãs
};
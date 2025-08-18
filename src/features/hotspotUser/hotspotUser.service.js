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
  const action = 'createHotspotUser_Mikrotik';

  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(hotspotUserData.password, salt);

    // --- INÍCIO DA LÓGICA DE STATUS AUTOMÁTICO POR TURMA ---
    console.log(`[CREATE][AUTO-SYNC] Verificando status com base na turma...`);
    
    const newUserTurma = hotspotUserData.turma || 'Nenhuma';
    const activeCompanyTurma = company.activeTurma || 'Nenhuma';

    console.log(`[CREATE][AUTO-SYNC] Turma do novo usuário: '${newUserTurma}'`);
    console.log(`[CREATE][AUTO-SYNC] Turma ativa da empresa: '${activeCompanyTurma}'`);

    const shouldBeActive = activeCompanyTurma === 'Nenhuma' || newUserTurma === activeCompanyTurma;
    const finalStatus = shouldBeActive ? 'active' : 'inactive';
    
    console.log(`[CREATE][AUTO-SYNC] Status de criação definido para: '${finalStatus}'`);
    // --- FIM DA LÓGICA DE STATUS AUTOMÁTICO ---
    
    const mikrotikPayload = {
      server: 'all',
      name: hotspotUserData.username,
      password: hotspotUserData.password,
      profile: profile.mikrotikName,
      comment: hotspotUserData.turma || '',
      // Usa o status calculado pela lógica acima, não o que veio na requisição
      disabled: finalStatus === 'inactive' ? 'true' : 'false'
    };

    console.log(`[CREATE] Criando usuário '${hotspotUserData.username}' no MikroTik. Payload:`, mikrotikPayload);

    const response = await mikrotikClient.post('/ip/hotspot/user/add', mikrotikPayload, {
      headers: { 'Content-Type': 'application/json' }
    });

    console.log(`[CREATE] Resposta do MikroTik:`, response.data);

    await ConnectionLog.create({
      action, 
      status: 'success',
      message: `Usuário ${hotspotUserData.username} criado com sucesso no MikroTik com status '${finalStatus}'.`,
      responseTime: Date.now() - startTime, 
      companyId: company.id
    });
    
    const mikrotikId = response.data?.ret || response.data;
    
    // Salva no banco de dados com a senha hasheada, o ID do MikroTik e o STATUS CORRETO
    hotspotUserData.password = hashedPassword;
    hotspotUserData.mikrotikId = mikrotikId;
    hotspotUserData.status = finalStatus; // Garante que o banco de dados também reflita o status correto
    
    const createdUser = await HotspotUser.create(hotspotUserData);
    
    console.log(`[CREATE] ✅ Usuário criado com sucesso - ID Local: ${createdUser.id}, ID MikroTik: ${mikrotikId}, Status: ${finalStatus}`);
    
    return createdUser;

  } catch (error) {
    const errorMessage = error.response?.data?.message || error.response?.data?.detail || error.response?.data?.error || error.message;
    await ConnectionLog.create({ action, status: 'error', message: `Erro: ${errorMessage}`, responseTime: Date.now() - startTime, companyId: company.id });
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
  console.log(`[SERVICE] ID do usuário: ${id}`);
  console.log(`[SERVICE] Dados recebidos:`, JSON.stringify(hotspotUserData, null, 2));
  
  const hotspotUser = await findHotspotUserById(id);
  if (!hotspotUser) {
    console.log(`[SERVICE] ❌ Usuário não encontrado com ID: ${id}`);
    return null;
  }

  console.log(`[SERVICE] ✅ Usuário encontrado: '${hotspotUser.username}' (MikroTik ID: ${hotspotUser.mikrotikId})`);

  const company = await Company.findByPk(hotspotUser.companyId);
  console.log(`[SERVICE] ✅ Empresa: '${company.name}' (Turma Ativa: '${company.activeTurma}')`);
  
  const mikrotikClient = createMikrotikClient(company);
  const startTime = Date.now();
  const action = 'updateHotspotUser_Mikrotik';

  try {
    const mikrotikPayload = { '.id': hotspotUser.mikrotikId };
    
    if (hotspotUserData.hasOwnProperty('username')) mikrotikPayload.name = hotspotUserData.username;
    if (hotspotUserData.hasOwnProperty('password') && hotspotUserData.password) mikrotikPayload.password = hotspotUserData.password;
    if (hotspotUserData.hasOwnProperty('profileId') && hotspotUserData.profileId) {
      const newProfile = await Profile.findByPk(hotspotUserData.profileId);
      if (newProfile) mikrotikPayload.profile = newProfile.mikrotikName;
    }
    if (hotspotUserData.hasOwnProperty('turma')) mikrotikPayload.comment = hotspotUserData.turma || '';

    // --- LÓGICA DE STATUS AUTOMÁTICO POR TURMA ---
    console.log(`[AUTO-SYNC] Verificando status com base na turma...`);
    const finalUserTurma = hotspotUserData.turma !== undefined ? hotspotUserData.turma : hotspotUser.turma;
    const activeCompanyTurma = company.activeTurma || 'Nenhuma';
    console.log(`[AUTO-SYNC] Turma final do usuário: '${finalUserTurma}'`);
    console.log(`[AUTO-SYNC] Turma ativa da empresa: '${activeCompanyTurma}'`);
    const shouldBeActive = activeCompanyTurma === 'Nenhuma' || finalUserTurma === activeCompanyTurma;
    let finalStatusForSystem;
    if (hotspotUserData.status === 'expired' || hotspotUser.status === 'expired') {
        finalStatusForSystem = 'expired';
    } else {
        finalStatusForSystem = shouldBeActive ? 'active' : 'inactive';
    }
    mikrotikPayload.disabled = (finalStatusForSystem === 'inactive' || finalStatusForSystem === 'expired') ? 'true' : 'false';
    console.log(`[AUTO-SYNC] Resultado: Usuário deveria estar ativo? ${shouldBeActive}`);
    console.log(`[AUTO-SYNC] Status final definido para o sistema: '${finalStatusForSystem}'`);
    console.log(`[AUTO-SYNC] Payload para MikroTik 'disabled': '${mikrotikPayload.disabled}'`);
    // --- FIM DA LÓGICA DE STATUS AUTOMÁTICO ---

    console.log(`\n[SERVICE] === PAYLOAD FINAL PARA MIKROTIK ===`);
    console.log(JSON.stringify(mikrotikPayload, null, 2));
    
    await mikrotikClient.post('/ip/hotspot/user/set', mikrotikPayload, {
      headers: { 'Content-Type': 'application/json' }
    });
    console.log(`[SERVICE] ✅ Resposta do MikroTik recebida com sucesso.`);
    
    const dataToSave = { ...hotspotUserData };
    dataToSave.status = finalStatusForSystem;

    if (dataToSave.password && dataToSave.password.length > 0) {
      const salt = await bcrypt.genSalt(10);
      dataToSave.password = await bcrypt.hash(dataToSave.password, salt);
    } else {
      delete dataToSave.password;
    }

    const updatedUser = await hotspotUser.update(dataToSave);
    console.log(`[SERVICE] ✅ Banco de dados local atualizado.`);

    await ConnectionLog.create({ 
      action, 
      status: 'success', 
      message: `Usuário '${updatedUser.username}' atualizado. Status definido para '${finalStatusForSystem}' com base na turma.`, 
      responseTime: Date.now() - startTime, 
      companyId: company.id 
    });

    console.log(`[SERVICE] === SUCESSO TOTAL (${Date.now() - startTime}ms) ===\n`);
    return updatedUser;

  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    console.error(`[SERVICE] === ERRO NO UPDATE ===`, { message: errorMessage, data: error.response?.data });
    await ConnectionLog.create({ 
      action, 
      status: 'error', 
      message: `Erro ao atualizar usuário ${hotspotUser.username}: ${errorMessage}`, 
      responseTime: Date.now() - startTime, 
      companyId: company.id 
    });
    throw new Error(`Falha ao atualizar usuário no MikroTik: ${errorMessage}`);
  }
};

const deleteHotspotUser = async (id) => {
  const hotspotUser = await findHotspotUserById(id);
  if (!hotspotUser) return null;
  
  const company = await Company.findByPk(hotspotUser.companyId);
  const mikrotikClient = createMikrotikClient(company);
  const startTime = Date.now();
  const action = 'deleteHotspotUser_Mikrotik';

  try {
    // ✅ CORREÇÃO: Usar POST com /remove igual ao padrão dos outros arquivos
    console.log(`[DELETE] Removendo usuário '${hotspotUser.username}' (ID: ${hotspotUser.mikrotikId}) do MikroTik...`);
    
    const deletePayload = {
      '.id': hotspotUser.mikrotikId
    };
    
    const response = await mikrotikClient.post('/ip/hotspot/user/remove', deletePayload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`[DELETE] ✅ Usuário removido do MikroTik:`, response.status);

    await ConnectionLog.create({ 
      action, 
      status: 'success', 
      message: `Usuário ${hotspotUser.username} deletado do MikroTik.`, 
      responseTime: Date.now() - startTime, 
      companyId: company.id 
    });
    
  } catch (error) {
    console.error(`[DELETE] ❌ Erro detalhado:`, {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status
    });
    
    const errorMessage = error.response?.data?.message || 
                        error.response?.data?.detail || 
                        error.response?.data?.error || 
                        error.message;
    
    // Verificar se é erro de "não encontrado" (normal se já foi deletado)
    if (error.response?.status === 404 || 
        errorMessage.includes('no such item') || 
        errorMessage.includes('not found')) {
      
      console.log(`[DELETE] ⚠️ Usuário já não existia no MikroTik`);
      
      await ConnectionLog.create({ 
        action, 
        status: 'success', 
        message: `Usuário ${hotspotUser.username} já não existia no MikroTik.`, 
        responseTime: Date.now() - startTime, 
        companyId: company.id 
      });
    } else {
      // Erro real
      await ConnectionLog.create({ 
        action, 
        status: 'error', 
        message: `Erro: ${errorMessage}`, 
        responseTime: Date.now() - startTime, 
        companyId: company.id 
      });
      throw new Error(`Falha ao deletar usuário no MikroTik: ${errorMessage}`);
    }
  }

  await hotspotUser.destroy();
  return hotspotUser;
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
      
      try {
        const resetPayload = { '.id': hotspotUser.mikrotikId };
        const response = await mikrotikClient.post('/ip/hotspot/user/reset-counters', resetPayload, { headers: { 'Content-Type': 'application/json' } });
        console.log(`[RESET] ✅ Contadores resetados:`, response.data);
        
      } catch (resetError) {
        console.log(`[RESET] ⚠️ Erro no reset de contadores: ${resetError.message}. Tentando método alternativo...`);
        const disablePayload = { '.id': hotspotUser.mikrotikId, disabled: 'true' };
        await mikrotikClient.post('/ip/hotspot/user/set', disablePayload, { headers: { 'Content-Type': 'application/json' } });
        await new Promise(resolve => setTimeout(resolve, 500));
        const enablePayload = { '.id': hotspotUser.mikrotikId, disabled: 'false' };
        await mikrotikClient.post('/ip/hotspot/user/set', enablePayload, { headers: { 'Content-Type': 'application/json' } });
        console.log(`[RESET] ✅ Contadores resetados via método alternativo`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // --- LÓGICA DE REATIVAÇÃO ---
    const wasExpired = hotspotUser.status === 'expired';
    const hasCreditNow = dataToUpdateInDb.creditsTotal > (dataToUpdateInDb.creditsUsed || 0);

    if (wasExpired && hasCreditNow) {
      console.log(`[REACTIVATE] Usuário '${hotspotUser.username}' estava expirado e agora tem crédito. Reativando...`);
      dataToUpdateInDb.status = 'active';

      try {
        const enablePayload = { '.id': hotspotUser.mikrotikId, disabled: 'false' };
        await mikrotikClient.post('/ip/hotspot/user/set', enablePayload, { headers: { 'Content-Type': 'application/json' } });
        console.log(`[REACTIVATE] ✅ Usuário '${hotspotUser.username}' reativado com sucesso no MikroTik.`);
      } catch (mikrotikError) {
        console.error(`[REACTIVATE] ⚠️ Falha ao reativar usuário '${hotspotUser.username}' no MikroTik: ${mikrotikError.message}`);
      }
    }
    // --- FIM DA LÓGICA DE REATIVAÇÃO ---

    const updatedUser = await hotspotUser.update(dataToUpdateInDb);
    
    await ConnectionLog.create({
      action, 
      status: 'success',
      message: `Créditos de '${hotspotUser.username}' atualizados por '${performingUser.name}'. Novo total: ${dataToUpdateInDb.creditsTotal / (1024*1024)} MB. Contadores resetados.${(wasExpired && hasCreditNow) ? ' Usuário reativado.' : ''}`,
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
    await ConnectionLog.create({ action, status: 'error', message: `Falha ao resetar contadores no MikroTik para '${hotspotUser.username}': ${errorMessage}`, responseTime: Date.now() - startTime, companyId: company.id });
    throw new Error(`Falha ao resetar contadores no MikroTik: ${errorMessage}`);
  }
};


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
        
        const enablePayload = {
          '.id': hotspotUser.mikrotikId,
          disabled: 'false'
        };
        
        await mikrotikClient.post('/ip/hotspot/user/set', enablePayload, {
          headers: {
            'Content-Type': 'application/json'
          }
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

/**
 * Função dedicada para resetar um único usuário expirado.
 * Faz uma coisa e faz bem: limpa os créditos e reativa.
 */
const resetExpiredUser = async (user, newCreditBytes) => {
  console.log(`[RESET-INDIVIDUAL] Processando usuário expirado: '${user.username}'.`);

  // 1. Limpa os dados de crédito localmente.
  const dataToUpdate = {
    creditsTotal: newCreditBytes,
    creditsUsed: 0,
    status: 'active', // Sempre se torna ativo após o reset.
    lastResetDate: new Date()
  };

  // 2. Reativa o usuário no MikroTik.
  if (user.mikrotikId && user.company) {
    try {
      console.log(`[RESET-INDIVIDUAL] Ativando '${user.username}' no MikroTik...`);
      const mikrotikClient = createMikrotikClient(user.company);
      const payload = { 
        '.id': user.mikrotikId, 
        disabled: 'false' 
      };
      await mikrotikClient.post('/ip/hotspot/user/set', payload, { headers: { 'Content-Type': 'application/json' } });
      console.log(`[RESET-INDIVIDUAL] ✅ '${user.username}' reativado no MikroTik.`);
    } catch (mikrotikError) {
      console.error(`[RESET-INDIVIDUAL] ❌ Falha ao reativar '${user.username}' no MikroTik: ${mikrotikError.message}`);
      // Mesmo se falhar no MikroTik, o status no nosso sistema será 'active'.
      // A próxima sincronização ou coleta pode corrigir o estado.
    }
  }

  // 3. Salva os dados limpos no banco de dados.
  await user.update(dataToUpdate);
  console.log(`[RESET-INDIVIDUAL] ✅ Dados de '${user.username}' resetados no banco.`);
};
// Função principal que orquestra o processo.
const resetDailyCreditsForAllUsers = async () => {
  console.log(`--- Iniciando job: Reset Diário de Créditos (Lógica Unificada Final) ---`);
  
  try {
    const settings = await Settings.findByPk(1);
    if (!settings) {
      console.error('[RESET] FALHA: Configurações do sistema não encontradas.');
      return;
    }

    const { defaultDailyCreditMB } = settings;
    const newCreditBytes = defaultDailyCreditMB * 1024 * 1024;
    console.log(`[RESET] Crédito padrão a ser aplicado: ${defaultDailyCreditMB}MB.`);

    // 1. BUSCAR TODOS OS USUÁRIOS UMA ÚNICA VEZ
    const allUsers = await HotspotUser.findAll({
      include: [{ model: Company, as: 'company' }]
    });

    if (allUsers.length === 0) {
      console.log('[RESET] Nenhum usuário encontrado.');
      return;
    }

    console.log(`[RESET] Processando ${allUsers.length} usuários...`);

    for (const user of allUsers) {
      try {
        const wasExpired = user.status === 'expired';
        let newTotalCredit;

        // 2. APLICA A REGRA DE CRÉDITO BASEADO NO STATUS *INICIAL*
        if (wasExpired) {
          // SE ESTAVA EXPIRADO, RESETA.
          console.log(`[RESET][EXPIRADO] Usuário '${user.username}'.`);
          newTotalCredit = newCreditBytes;
        } else {
          // SE NÃO ESTAVA EXPIRADO, ACUMULA.
          const remainingCredit = Math.max(0, user.creditsTotal - user.creditsUsed);
          newTotalCredit = remainingCredit + newCreditBytes;
          console.log(`[RESET][ACUMULOU] Usuário '${user.username}'.`);
        }
        
        // 3. DEFINE O STATUS FINAL BASEADO NA TURMA
        const userTurma = user.turma || 'Nenhuma';
        const activeCompanyTurma = user.company ? (user.company.activeTurma || 'Nenhuma') : 'Nenhuma';
        const finalStatus = (activeCompanyTurma === 'Nenhuma' || userTurma === activeCompanyTurma) ? 'active' : 'inactive';

        // 4. PREPARA O PACOTE COMPLETO PARA ATUALIZAÇÃO
        const dataToUpdate = {
          creditsUsed: 0,
          creditsTotal: newTotalCredit,
          status: finalStatus,
          lastResetDate: new Date()
        };

        // 5. ATUALIZA O MIKROTIK SE O STATUS MUDOU
        if (finalStatus !== user.status) {
          console.log(`[RESET][MIKROTIK] Status de '${user.username}' mudando de '${user.status}' para '${finalStatus}'.`);
          if (user.mikrotikId && user.company) {
            const mikrotikClient = createMikrotikClient(user.company);
            const payload = { 
              '.id': user.mikrotikId, 
              disabled: (finalStatus === 'inactive').toString() 
            };
            await mikrotikClient.post('/ip/hotspot/user/set', payload, { headers: { 'Content-Type': 'application/json' } });
            console.log(`[RESET][MIKROTIK] ✅ Comando enviado: disabled=${payload.disabled}.`);
          }
        }
        
        // 6. ATUALIZA O BANCO UMA ÚNICA VEZ POR USUÁRIO
        await user.update(dataToUpdate);

      } catch (error) {
        console.error(`[RESET] ❌ ERRO ao processar '${user.username}': ${error.message}`);
      }
    }

    console.log(`--- Finalizado job: Reset Diário de Créditos ---`);

  } catch (error) {
    console.error(`[RESET] ❌ FALHA GERAL no job: ${error.message}`);
  }
};


const syncUserStatusWithMikrotik = async (userId) => {
  const hotspotUser = await findHotspotUserById(userId);
  if (!hotspotUser || !hotspotUser.mikrotikId) {
    throw new Error('Usuário do hotspot não encontrado ou sem ID do MikroTik.');
  }

  const company = await Company.findByPk(hotspotUser.companyId);
  const mikrotikClient = createMikrotikClient(company);
  const startTime = Date.now();
  const action = 'syncUserStatusWithMikrotik';

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

    // ✅ CORREÇÃO: Atualizar no MikroTik usando POST com /set seguindo padrão dos outros arquivos
    const updatePayload = {
      '.id': hotspotUser.mikrotikId,
      disabled: (targetStatus === 'inactive' || targetStatus === 'expired') ? 'true' : 'false'
    };

    await mikrotikClient.post('/ip/hotspot/user/set', updatePayload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Atualizar no banco local
    await hotspotUser.update({ status: targetStatus });

    await ConnectionLog.create({
      action,
      status: 'success',
      message: `Status do usuário '${hotspotUser.username}' sincronizado automaticamente para '${targetStatus}'.`,
      responseTime: Date.now() - startTime,
      companyId: company.id
    });

    console.log(`[AUTO-SYNC] ✅ Status do usuário '${hotspotUser.username}' sincronizado para '${targetStatus}'.`);
    
    return { userId, oldStatus: hotspotUser.status, newStatus: targetStatus };

  } catch (error) {
    const errorMessage = error.response?.data?.message || 
                        error.response?.data?.detail || 
                        error.response?.data?.error || 
                        error.message;
    
    await ConnectionLog.create({
      action,
      status: 'error',
      message: `Falha ao sincronizar status do usuário '${hotspotUser.username}': ${errorMessage}`,
      responseTime: Date.now() - startTime,
      companyId: company.id
    });
    throw new Error(`Falha ao sincronizar usuário com MikroTik: ${errorMessage}`);
  }
};

const syncUserCountersWithMikrotik = async (userId) => {
  const hotspotUser = await findHotspotUserById(userId);
  if (!hotspotUser || !hotspotUser.mikrotikId) {
    throw new Error('Usuário do hotspot não encontrado ou sem ID do MikroTik.');
  }

  const company = await Company.findByPk(hotspotUser.companyId);
  const mikrotikClient = createMikrotikClient(company);

  try {
    // ✅ CORREÇÃO: Buscar dados do usuário específico no MikroTik usando padrão dos outros arquivos
    const response = await mikrotikClient.get('/ip/hotspot/user', {
      params: {
        '?name': hotspotUser.username
      }
    });
    
    const users = response.data || [];
    const mikrotikUser = users.find(u => u.name === hotspotUser.username);
    
    if (!mikrotikUser) {
      throw new Error('Usuário não encontrado no MikroTik');
    }

    const bytesIn = parseInt(mikrotikUser['bytes-in'] || 0);
    const bytesOut = parseInt(mikrotikUser['bytes-out'] || 0);
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

const collectActiveSessionUsage = async () => {
  console.log(`[COLLECT] Iniciando coleta de uso de sessões ativas...`);
  
  try {
    const companies = await Company.findAll();
    let totalProcessed = 0;
    let totalErrors = 0;
    
    for (const company of companies) {
      const mikrotikClient = createMikrotikClient(company);
      
      try {
        // ✅ CORREÇÃO: Buscar usuários ATIVOS usando padrão dos outros arquivos
        const activeUsersResponse = await mikrotikClient.get('/ip/hotspot/active');
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
            
            // ✅ VALIDAÇÃO: Só processar se diferença >= 1MB
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

const monitorUserLogouts = async () => {
  console.log(`[MONITOR] Verificando logouts...`);
  
  try {
    const companies = await Company.findAll();
    let totalLogouts = 0;
    
    for (const company of companies) {
      const mikrotikClient = createMikrotikClient(company);
      
      try {
        // ✅ CORREÇÃO: Buscar usuários ativos usando padrão dos outros arquivos
        const activeResponse = await mikrotikClient.get('/ip/hotspot/active');
        const activeUsers = activeResponse.data || [];
        const activeUsernames = activeUsers.map(u => u.user);
        
        // Buscar usuários que ERAM ativos no banco mas NÃO estão mais
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
        
        // Para cada usuário que fez logout, capturar os dados finais
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
        
        // ✅ CORREÇÃO: Desabilitar no MikroTik usando POST com /set seguindo padrão dos outros arquivos
        if (hotspotUser.mikrotikId) {
          const mikrotikClient = createMikrotikClient(company);
          
          try {
            const disablePayload = {
              '.id': hotspotUser.mikrotikId,
              disabled: 'true'
            };
            
            await mikrotikClient.post('/ip/hotspot/user/set', disablePayload, {
              headers: {
                'Content-Type': 'application/json'
              }
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

const disconnectAndDisableUser = async (hotspotUser, company, mikrotikClient) => {
  try {
    console.log(`[DISCONNECT] Processando usuário '${hotspotUser.username}' que excedeu limite...`);
    
    // ✅ CORREÇÃO: Desconectar usuário ativo usando POST com /remove seguindo padrão dos outros arquivos
    if (hotspotUser.sessionId) {
      try {
        const removePayload = {
          '.id': hotspotUser.sessionId
        };
        
        await mikrotikClient.post('/ip/hotspot/active/remove', removePayload, {
          headers: {
            'Content-Type': 'application/json'
          }
        });
        console.log(`[DISCONNECT] ✅ '${hotspotUser.username}' desconectado da sessão ativa`);
      } catch (disconnectError) {
        console.error(`[DISCONNECT] ⚠️ Erro ao desconectar sessão: ${disconnectError.message}`);
      }
    }
    
    // ✅ CORREÇÃO: Desabilitar usuário usando POST com /set seguindo padrão dos outros arquivos
    if (hotspotUser.mikrotikId) {
      try {
        const disablePayload = {
          '.id': hotspotUser.mikrotikId,
          disabled: 'true'
        };
        
        await mikrotikClient.post('/ip/hotspot/user/set', disablePayload, {
          headers: {
            'Content-Type': 'application/json'
          }
        });
        console.log(`[DISCONNECT] ✅ '${hotspotUser.username}' desabilitado no MikroTik`);
      } catch (disableError) {
        console.error(`[DISCONNECT] ⚠️ Erro ao desabilitar usuário: ${disableError.message}`);
      }
    }
    
    // Atualizar status no banco
    await hotspotUser.update({ 
      status: 'expired',
      currentSessionBytes: 0,
      sessionId: null
    });
    
    // Enviar email (se configurado)
    try {
      await sendCreditExhaustedEmail(hotspotUser, company);
      console.log(`[DISCONNECT] ✅ Email de limite excedido enviado para '${hotspotUser.username}'`);
    } catch (emailError) {
      console.error(`[DISCONNECT] ⚠️ Erro ao enviar email: ${emailError.message}`);
    }
    
    // Log de atividade
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

const cleanupOrphanedSessions = async () => {
  console.log(`[CLEANUP] Limpando sessões órfãs...`);
  
  try {
    const companies = await Company.findAll();
    let totalCleaned = 0;
    
    for (const company of companies) {
      const mikrotikClient = createMikrotikClient(company);
      
      try {
        // ✅ CORREÇÃO: Buscar usuários ativos usando padrão dos outros arquivos
        const activeResponse = await mikrotikClient.get('/ip/hotspot/active');
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

const captureLogoutUsage = async (username, companyId, mikrotikClient) => {
  try {
    // ✅ CORREÇÃO: Buscar dados da sessão usando padrão dos outros arquivos
    const activeResponse = await mikrotikClient.get('/ip/hotspot/active', {
      params: {
        '?user': username
      }
    });
    const activeUsers = activeResponse.data || [];
    const userSession = activeUsers.find(u => u.user === username);
    
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

module.exports = {
  findAllHotspotUsers,
  createHotspotUser,
  findHotspotUserById,
  updateHotspotUser,
  deleteHotspotUser,
  resetDailyCreditsForAllUsers,
  updateCredits,
  syncUserStatusWithMikrotik, 
  captureLogoutUsage,              
  disconnectAndDisableUser,        
  updateCreditsCorrect,            
  collectActiveSessionUsage,        
  monitorUserLogouts,              
  captureUserLogout,               
  cleanupOrphanedSessions,         
  syncUserCountersWithMikrotik
};
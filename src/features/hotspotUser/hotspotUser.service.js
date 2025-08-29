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
        const disablePayload = { '.id': hotspotUser.mikrotikId, disabled: 'yes' };
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

const resetDailyCreditsForAllUsers = async () => {
  console.log('[CREDIT RESET] --- Iniciando tarefa de reset/acúmulo de créditos ---');

  try {
    const settings = await Settings.findByPk(1);
    if (!settings) {
      console.error('[CREDIT RESET] ❌ Configurações do sistema não encontradas. Abortando.');
      return;
    }

    const defaultCreditMB = settings.defaultDailyCreditMB || 500;
    const defaultCreditBytes = defaultCreditMB * 1024 * 1024;
    console.log(`[CREDIT RESET] ℹ️ Crédito diário padrão definido para: ${defaultCreditMB}MB.`);

    const companies = await Company.findAll();
    if (companies.length === 0) {
      console.log('[CREDIT RESET] Nenhuma empresa encontrada. Tarefa concluída.');
      return;
    }

    let totalProcessed = 0;
    let totalReactivated = 0;
    let totalAccumulated = 0;
    let totalErrors = 0;

    for (const company of companies) {
      console.log(`\n[CREDIT RESET] 🏢 Processando empresa: '${company.name}'...`);
      let mikrotikClient;
      try {
        mikrotikClient = createMikrotikClient(company);
      } catch (error) {
        console.error(`[CREDIT RESET] ❌ Falha ao criar cliente MikroTik para '${company.name}'. Pulando...`);
        totalErrors++;
        continue;
      }
      
      const users = await HotspotUser.findAll({ where: { companyId: company.id } });
      console.log(`[CREDIT RESET]   - Encontrados ${users.length} usuários.`);

      for (const user of users) {
        totalProcessed++;
        const dataToUpdate = {
            creditsUsed: 0,
            lastResetDate: new Date(),
        };

        try {
          // CENÁRIO 1: Usuário expirado -> RESET TOTAL E REATIVAÇÃO
          if (user.status === 'expired') {
            dataToUpdate.creditsTotal = defaultCreditBytes;
            dataToUpdate.status = 'active';

            await user.update(dataToUpdate);
            console.log(`[CREDIT RESET]   🔄 [RESET] Usuário '${user.username}' resetado para ${defaultCreditMB}MB.`);

            if (user.mikrotikId) {
              await mikrotikClient.post('/ip/hotspot/user/set', { '.id': user.mikrotikId, disabled: 'false' }, { headers: { 'Content-Type': 'application/json' } });
              await mikrotikClient.post('/ip/hotspot/user/reset-counters', { '.id': user.mikrotikId }, { headers: { 'Content-Type': 'application/json' } });
              console.log(`[CREDIT RESET]     ✅ Reativado no MikroTik.`);
            }
            totalReactivated++;
          } 
          // CENÁRIO 2: Usuário ativo/inativo -> ACUMULAR CRÉDITOS
          else {
            const currentTotal = parseFloat(user.creditsTotal) || 0;
            const currentUsed = parseFloat(user.creditsUsed) || 0;
            const leftover = currentTotal - currentUsed;

            // Garante que o saldo restante não seja negativo
            const safeLeftover = leftover > 0 ? leftover : 0;
            
            const newTotalBytes = safeLeftover + defaultCreditBytes;
            dataToUpdate.creditsTotal = newTotalBytes;

            await user.update(dataToUpdate);
            const leftoverMB = (safeLeftover / (1024*1024)).toFixed(2);
            const newTotalMB = (newTotalBytes / (1024*1024)).toFixed(2);
            console.log(`[CREDIT RESET]   ➕ [ACUMULOU] Usuário '${user.username}'. Restante: ${leftoverMB}MB. Novo total: ${newTotalMB}MB.`);
            
            if (user.mikrotikId) {
              await mikrotikClient.post('/ip/hotspot/user/reset-counters', { '.id': user.mikrotikId }, { headers: { 'Content-Type': 'application/json' } });
              console.log(`[CREDIT RESET]     ✅ Contadores zerados no MikroTik.`);
            }
            totalAccumulated++;
          }

        } catch (error) {
          const errorMessage = error.response?.data?.message || error.message;
          console.error(`[CREDIT RESET]   ❌ ERRO ao processar '${user.username}': ${errorMessage}`);
          totalErrors++;
        }
      }
    }

    const summaryMessage = `Reset/Acúmulo de créditos concluído. Processados: ${totalProcessed}, Resetados/Reativados: ${totalReactivated}, Acumulados: ${totalAccumulated}, Erros: ${totalErrors}.`;
    
    console.log(`\n[CREDIT RESET] --- TAREFA FINALIZADA ---`);
    console.log(`[CREDIT RESET] ${summaryMessage}`);

    await createNotification({
      description: 'Reset diário de créditos executado.',
      type: 'info',
      details: summaryMessage
    });
    
    await createActivityLog({
        userId: null, // Ação do sistema
        type: 'system_credit_reset',
        description: summaryMessage
    });

  } catch (error) {
    const errorMessage = `Falha crítica na tarefa de reset de créditos: ${error.message}`;
    console.error(`[CREDIT RESET] ❌ ${errorMessage}`);
    await createNotification({
        description: 'Falha crítica na tarefa de reset de créditos.',
        type: 'erro',
        details: error.message
    });
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
    let totalExpired = 0;
    
    for (const company of companies) {
      const mikrotikClient = createMikrotikClient(company);
      
      try {
        console.log(`[COLLECT] Processando empresa: '${company.name}'`);
        const activeUsersResponse = await mikrotikClient.get('/ip/hotspot/active');
        const activeUsers = Array.isArray(activeUsersResponse.data) ? activeUsersResponse.data : [];
        console.log(`[COLLECT] Empresa '${company.name}': ${activeUsers.length} usuários ativos encontrados`);

        for (const activeUser of activeUsers) {
          try {
            const username = activeUser.user;
            if (!username) continue;

            const sessionId = activeUser['.id'];
            const bytesIn = parseInt(activeUser['bytes-in'] || 0);
            const bytesOut = parseInt(activeUser['bytes-out'] || 0);
            const currentSessionBytes = bytesIn + bytesOut;

            const hotspotUser = await HotspotUser.findOne({
              where: { username, companyId: company.id }
            });
            
            if (!hotspotUser) {
              console.log(`[COLLECT] ⚠️ Usuário '${username}' ativo no MikroTik mas não encontrado no banco`);
              continue;
            }
            
            // Força a conversão de TODOS os valores do banco para NÚMEROS
            const dbCreditsUsed = parseFloat(hotspotUser.creditsUsed) || 0;
            const dbCreditsTotal = parseFloat(hotspotUser.creditsTotal) || 0;
            const dbCurrentSessionBytes = parseFloat(hotspotUser.currentSessionBytes) || 0;

            const incremento = currentSessionBytes - dbCurrentSessionBytes;
            
            if (incremento > 0) {
              const novoTotal = dbCreditsUsed + incremento;

              await hotspotUser.update({
                creditsUsed: novoTotal,
                currentSessionBytes: currentSessionBytes,
                sessionId: sessionId,
                lastCollectionTime: new Date()
              });
              
              console.log(`[COLLECT] ✅ '${username}': +${Math.round(incremento/1024/1024*100)/100}MB (Total: ${Math.round(novoTotal/1024/1024*100)/100}MB/${Math.round(dbCreditsTotal/1024/1024*100)/100}MB)`);
              
              // ✅ VERIFICAÇÃO CRÍTICA: Se excedeu o limite
              if (novoTotal >= dbCreditsTotal && dbCreditsTotal > 0) {
                console.log(`[COLLECT] 🚨 '${username}' excedeu limite! Iniciando processo de desconexão...`);
                
                try {
                  // Usar a função corrigida de desconexão
                  const disconnectSuccess = await disconnectAndDisableUser(hotspotUser, company, mikrotikClient);
                  
                  if (disconnectSuccess) {
                    console.log(`[COLLECT] ✅ '${username}' desconectado e desabilitado com sucesso`);
                    totalExpired++;
                  } else {
                    console.warn(`[COLLECT] ⚠️ '${username}' marcado como expirado, mas pode não ter sido desabilitado no MikroTik`);
                  }
                  
                } catch (disconnectError) {
                  console.error(`[COLLECT] ❌ Erro ao desconectar '${username}': ${disconnectError.message}`);
                  
                  // Mesmo com erro, marcar como expirado no sistema
                  await hotspotUser.update({ status: 'expired' });
                }
              }
              
              totalProcessed++;
            } else {
              // Apenas atualizar sessionId se mudou
              if (hotspotUser.sessionId !== sessionId) {
                await hotspotUser.update({
                  sessionId: sessionId,
                  lastCollectionTime: new Date()
                });
              }
            }
            
          } catch (userError) {
            console.error(`[COLLECT] ❌ Erro ao processar usuário '${activeUser.user}': ${userError.message}`);
            totalErrors++;
          }
        }
        
      } catch (companyError) {
        console.error(`[COLLECT] ❌ Erro na empresa '${company.name}': ${companyError.message}`);
        totalErrors++;
      }
    }
    
    if (totalProcessed > 0 || totalErrors > 0 || totalExpired > 0) {
      console.log(`[COLLECT] Finalizado - Processados: ${totalProcessed}, Expirados: ${totalExpired}, Erros: ${totalErrors}`);
    }
    
    return { totalProcessed, totalExpired, totalErrors };
    
  } catch (error) {
    console.error(`[COLLECT] ❌ Erro geral na coleta: ${error.message}`);
    return { totalProcessed: 0, totalExpired: 0, totalErrors: 1 };
  }
};

// ✅ FUNÇÃO ALTERNATIVA: Buscar dados específicos do usuário
const getSpecificUserData = async (username, company) => {
  try {
    const mikrotikClient = createMikrotikClient(company);
    
    // Método 1: Buscar por parâmetro específico
    const response1 = await mikrotikClient.get('/ip/hotspot/active', {
      params: {
        '?user': username
      }
    });
    
    console.log(`[SPECIFIC] Método 1 para '${username}':`, response1.data);
    
    // Método 2: Buscar todos e filtrar
    const response2 = await mikrotikClient.get('/ip/hotspot/active');
    const allUsers = Array.isArray(response2.data) ? response2.data : [];
    const specificUser = allUsers.find(u => u.user === username || u.name === username);
    
    console.log(`[SPECIFIC] Método 2 para '${username}':`, specificUser);
    
    return specificUser;
    
  } catch (error) {
    console.error(`[SPECIFIC] Erro ao buscar dados específicos: ${error.message}`);
    return null;
  }
};

// ✅ FUNÇÃO DE DEBUG: Verificar estrutura de dados do MikroTik
const debugMikrotikActiveUsers = async () => {
  console.log(`[DEBUG] Verificando estrutura de dados do MikroTik...`);
  
  try {
    const companies = await Company.findAll();
    
    for (const company of companies) {
      const mikrotikClient = createMikrotikClient(company);
      
      try {
        const response = await mikrotikClient.get('/ip/hotspot/active');
        const activeUsers = response.data || [];
        
        console.log(`\n=== EMPRESA: ${company.name} ===`);
        console.log(`Usuários ativos: ${activeUsers.length}`);
        console.log(`Resposta bruta:`, JSON.stringify(response.data, null, 2));
        
        if (activeUsers.length > 0) {
          console.log(`\n--- ESTRUTURA DO PRIMEIRO USUÁRIO ---`);
          const firstUser = activeUsers[0];
          console.log(`Dados brutos:`, firstUser);
          console.log(`Campos disponíveis:`, Object.keys(firstUser));
          
          // Testar diferentes campos possíveis
          const possibleFields = [
            'user', 'name', 'username',
            'bytes-in', 'bytesIn', 'bytes_in', 'upload',
            'bytes-out', 'bytesOut', 'bytes_out', 'download',
            '.id', 'id', 'session-id'
          ];
          
          console.log(`\n--- VALORES DOS CAMPOS ---`);
          possibleFields.forEach(field => {
            if (firstUser.hasOwnProperty(field)) {
              console.log(`${field}: ${firstUser[field]}`);
            }
          });
        }
        
      } catch (error) {
        console.error(`[DEBUG] Erro na empresa '${company.name}': ${error.message}`);
      }
    }
    
  } catch (error) {
    console.error(`[DEBUG] Erro geral: ${error.message}`);
  }
};

// ✅ FUNÇÃO PARA TESTAR CONEXÃO E FORMATO DOS DADOS
const testMikrotikConnection = async (companyId) => {
  try {
    const company = await Company.findByPk(companyId);
    if (!company) {
      console.error('[TEST] Empresa não encontrada');
      return;
    }
    
    const mikrotikClient = createMikrotikClient(company);
    
    console.log(`[TEST] Testando conexão com MikroTik da empresa: ${company.name}`);
    console.log(`[TEST] Configurações:`, {
      host: company.mikrotikHost,
      port: company.mikrotikPort,
      // Não exibir credenciais por segurança
    });
    
    // Teste 1: Buscar informações do sistema
    try {
      const systemResponse = await mikrotikClient.get('/system/resource');
      console.log(`[TEST] ✅ Conexão OK - Sistema:`, {
        version: systemResponse.data?.version,
        uptime: systemResponse.data?.uptime
      });
    } catch (error) {
      console.error(`[TEST] ❌ Falha na conexão: ${error.message}`);
      return;
    }
    
    // Teste 2: Buscar usuários ativos
    try {
      const activeResponse = await mikrotikClient.get('/ip/hotspot/active');
      console.log(`[TEST] Usuários ativos encontrados: ${activeResponse.data?.length || 0}`);
      
      if (activeResponse.data && activeResponse.data.length > 0) {
        console.log(`[TEST] Exemplo de dados:`, activeResponse.data[0]);
      }
      
    } catch (error) {
      console.error(`[TEST] ❌ Erro ao buscar usuários ativos: ${error.message}`);
    }
    
    // Teste 3: Buscar todos os usuários do hotspot
    try {
      const usersResponse = await mikrotikClient.get('/ip/hotspot/user');
      console.log(`[TEST] Total de usuários cadastrados: ${usersResponse.data?.length || 0}`);
    } catch (error) {
      console.error(`[TEST] ❌ Erro ao buscar usuários: ${error.message}`);
    }
    
  } catch (error) {
    console.error(`[TEST] ❌ Erro geral no teste: ${error.message}`);
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
              disabled: 'yes'
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
    
    // 1. DESCONECTAR SESSÃO ATIVA SE EXISTIR
    if (hotspotUser.sessionId) {
      try {
        const removePayload = {
          '.id': hotspotUser.sessionId
        };
        
        await mikrotikClient.post('/ip/hotspot/active/remove', removePayload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000
        });
        console.log(`[DISCONNECT] ✅ '${hotspotUser.username}' desconectado da sessão ativa`);
      } catch (disconnectError) {
        console.error(`[DISCONNECT] ⚠️ Erro ao desconectar sessão: ${disconnectError.message}`);
        // Continua mesmo se a desconexão falhar
      }
    }
    
    // 2. AGUARDAR UM POUCO ENTRE DESCONEXÃO E DESATIVAÇÃO
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 3. DESABILITAR USUÁRIO NO MIKROTIK (MAIS IMPORTANTE)
    if (hotspotUser.mikrotikId) {
      try {
        const disablePayload = {
          '.id': hotspotUser.mikrotikId,
          disabled: 'yes'
        };
        
        await mikrotikClient.post('/ip/hotspot/user/set', disablePayload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000
        });
        console.log(`[DISCONNECT] ✅ '${hotspotUser.username}' desabilitado no MikroTik`);
        
        // 4. VERIFICAR SE REALMENTE FOI DESABILITADO
        await new Promise(resolve => setTimeout(resolve, 500));
        const verification = await verifyUserStatusInMikroTik(hotspotUser.mikrotikId, mikrotikClient);
        
        if (!verification.disabled) {
          console.warn(`[DISCONNECT] ⚠️ ATENÇÃO: '${hotspotUser.username}' pode não ter sido desabilitado corretamente`);
        }
        
      } catch (disableError) {
        console.error(`[DISCONNECT] ❌ Erro ao desabilitar usuário: ${disableError.message}`);
        throw disableError; // Re-throw para que seja tratado pelo chamador
      }
    }
    
    // 5. ATUALIZAR STATUS NO BANCO LOCAL
    await hotspotUser.update({ 
      status: 'expired',
      currentSessionBytes: 0,
      sessionId: null,
      lastExpiredTime: new Date()
    });
    
    // 6. ENVIAR EMAIL (se configurado)
    try {
      await sendCreditExhaustedEmail(hotspotUser, company);
      console.log(`[DISCONNECT] ✅ Email de limite excedido enviado para '${hotspotUser.username}'`);
    } catch (emailError) {
      console.error(`[DISCONNECT] ⚠️ Erro ao enviar email: ${emailError.message}`);
    }
    
    // 7. LOG DE ATIVIDADE
    await ConnectionLog.create({
      action: 'userDisconnectedByLimit',
      status: 'success',
      message: `Usuário '${hotspotUser.username}' desconectado automaticamente por exceder limite de ${Math.round(hotspotUser.creditsTotal/1024/1024)}MB`,
      responseTime: 0,
      companyId: company.id
    });
    
    return true;
    
  } catch (error) {
    console.error(`[DISCONNECT] ❌ Erro ao desconectar '${hotspotUser.username}': ${error.message}`);
    
    // Mesmo com erro, atualizar status local como expirado
    await hotspotUser.update({ 
      status: 'expired',
      currentSessionBytes: 0,
      sessionId: null 
    });
    
    await ConnectionLog.create({
      action: 'userDisconnectedByLimit',
      status: 'error',
      message: `Falha ao desconectar usuário '${hotspotUser.username}': ${error.message}`,
      responseTime: 0,
      companyId: company.id
    });
    
    return false;
  }
};

const auditAndFixExpiredUsers = async (companyId = null) => {
  console.log('[AUDIT-FIX] Iniciando verificação de usuários expirados...');
  
  try {
    const whereClause = {};
    if (companyId) {
      whereClause.companyId = companyId;
    }
    
    const companies = companyId ? 
      [await Company.findByPk(companyId)] : 
      await Company.findAll();
    
    let totalFixed = 0;
    let totalChecked = 0;
    
    for (const company of companies) {
      if (!company) continue;
      
      try {
        console.log(`[AUDIT-FIX] Verificando empresa: ${company.name}`);
        
        const mikrotikClient = createMikrotikClient(company);
        
        // Buscar usuários que deveriam estar expirados
        const potentiallyExpiredUsers = await HotspotUser.findAll({
          where: {
            companyId: company.id,
            status: { [Op.in]: ['active', 'expired'] },
            creditsUsed: { [Op.gte]: require('sequelize').col('creditsTotal') }
          }
        });
        
        console.log(`[AUDIT-FIX] ${potentiallyExpiredUsers.length} usuários potencialmente expirados em '${company.name}'`);
        
        for (const user of potentiallyExpiredUsers) {
          totalChecked++;
          
          const dbCreditsUsed = parseFloat(user.creditsUsed) || 0;
          const dbCreditsTotal = parseFloat(user.creditsTotal) || 0;
          
          // Se o usuário realmente excedeu o limite
          if (dbCreditsUsed >= dbCreditsTotal && dbCreditsTotal > 0) {
            
            if (user.status === 'active') {
              console.log(`[AUDIT-FIX] 🔧 Usuário '${user.username}' deveria estar expirado mas está ativo`);
              
              // Verificar status no MikroTik
              if (user.mikrotikId) {
                const mikrotikStatus = await verifyUserStatusInMikroTik(user.mikrotikId, mikrotikClient);
                
                if (mikrotikStatus.found && !mikrotikStatus.disabled) {
                  console.log(`[AUDIT-FIX] 🔧 Desabilitando '${user.username}' no MikroTik...`);
                  
                  try {
                    await mikrotikClient.post('/ip/hotspot/user/set', {
                      '.id': user.mikrotikId,
                      disabled: 'yes'
                    }, {
                      headers: { 'Content-Type': 'application/json' }
                    });
                    
                    console.log(`[AUDIT-FIX] ✅ '${user.username}' desabilitado no MikroTik`);
                  } catch (disableError) {
                    console.error(`[AUDIT-FIX] ❌ Erro ao desabilitar '${user.username}': ${disableError.message}`);
                  }
                }
              }
              
              // Atualizar status no banco
              await user.update({ 
                status: 'expired',
                sessionId: null,
                currentSessionBytes: 0,
                lastExpiredTime: new Date()
              });
              
              totalFixed++;
              
              // Enviar email se não foi enviado recentemente
              try {
                await sendCreditExhaustedEmail(user, company);
              } catch (emailError) {
                console.warn(`[AUDIT-FIX] ⚠️ Erro ao enviar email para '${user.username}': ${emailError.message}`);
              }
              
              await ConnectionLog.create({
                action: 'auditAndFixExpiredUsers',
                status: 'success',
                message: `Usuário '${user.username}' corrigido: estava com crédito excedido (${Math.round(dbCreditsUsed/1024/1024)}MB/${Math.round(dbCreditsTotal/1024/1024)}MB) mas marcado como ativo`,
                companyId: company.id
              });
            }
          }
        }
        
      } catch (companyError) {
        console.error(`[AUDIT-FIX] ❌ Erro na empresa '${company.name}': ${companyError.message}`);
      }
    }
    
    console.log(`[AUDIT-FIX] ✅ Verificação finalizada: ${totalFixed}/${totalChecked} usuários corrigidos`);
    
    return { 
      success: true, 
      totalChecked, 
      totalFixed,
      companies: companies.length
    };
    
  } catch (error) {
    console.error(`[AUDIT-FIX] ❌ Erro geral na verificação: ${error.message}`);
    return { success: false, error: error.message };
  }
};

const forceExpireUser = async (userId, performingUserId) => {
  try {
    const user = await findHotspotUserById(userId);
    if (!user) {
      throw new Error('Usuário não encontrado');
    }
    
    const company = await Company.findByPk(user.companyId);
    if (!company) {
      throw new Error('Empresa não encontrada');
    }
    
    console.log(`[FORCE-EXPIRE] Forçando expiração do usuário '${user.username}'...`);
    
    const mikrotikClient = createMikrotikClient(company);
    
    // 1. Desconectar e desabilitar
    const success = await disconnectAndDisableUser(user, company, mikrotikClient);
    
    if (success) {
      // 2. Registrar atividade
      await createActivityLog({
        userId: performingUserId,
        type: 'hotspot_user_expire',
        description: `Usuário '${user.username}' foi expirado manualmente.`
      });
      
      console.log(`[FORCE-EXPIRE] ✅ Usuário '${user.username}' expirado com sucesso`);
      
      return {
        success: true,
        message: `Usuário '${user.username}' foi expirado e desabilitado com sucesso.`
      };
    } else {
      return {
        success: false,
        message: `Usuário '${user.username}' foi marcado como expirado no sistema, mas pode não ter sido desabilitado no MikroTik.`
      };
    }
    
  } catch (error) {
    console.error(`[FORCE-EXPIRE] ❌ Erro: ${error.message}`);
    throw error;
  }
};

const verifyUserStatusInMikroTik = async (mikrotikId, mikrotikClient) => {
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
  disconnectAndDisableUser,        // ← CORRIGIDA
  updateCreditsCorrect,            
  collectActiveSessionUsage,       // ← CORRIGIDA
  monitorUserLogouts,              
  captureUserLogout,               
  cleanupOrphanedSessions,         
  syncUserCountersWithMikrotik,
  getSpecificUserData,
  debugMikrotikActiveUsers,
  testMikrotikConnection,
  
  // ✅ NOVAS FUNÇÕES DE AUDITORIA E CORREÇÃO
  verifyUserStatusInMikroTik,      // ← NOVA
  auditAndFixExpiredUsers,         // ← NOVA
  forceExpireUser                  // ← NOVA
};
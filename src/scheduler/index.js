// src/scheduler/index.js
const cron = require('node-cron');
const { getSettings } = require('../features/settings/settings.service');
const mikrotikService = require('../features/mikrotik/mikrotik.service');
const hotspotUserService = require('../features/hotspotUser/hotspotUser.service');
const { Company } = require('../models');

// Objeto para manter uma referência das tarefas agendadas e poder pará-las
let scheduledTasks = {};

/**
 * Para uma tarefa específica se ela estiver rodando.
 * @param {string} taskName - O nome da tarefa (ex: 'usageCollection')
 */
const stopTask = (taskName) => {
  if (scheduledTasks[taskName]) {
    scheduledTasks[taskName].stop();
    delete scheduledTasks[taskName];
    console.log(`[Scheduler] Tarefa '${taskName}' parada.`);
  }
};

/**
 * Inicia uma tarefa com um horário específico.
 * @param {string} taskName - O nome da tarefa.
 * @param {string} schedule - A expressão cron.
 * @param {function} jobFunction - A função a ser executada.
 */
const startTask = (taskName, schedule, jobFunction) => {
  // Para a tarefa antiga antes de iniciar uma nova, para evitar duplicatas
  stopTask(taskName);

  if (cron.validate(schedule)) {
    // Agenda a tarefa usando o fuso horário do servidor (sem a opção timezone)
    const task = cron.schedule(schedule, jobFunction);
    scheduledTasks[taskName] = task;
    console.log(`[Scheduler] Tarefa '${taskName}' agendada (horário do servidor): [${schedule}]`);
  } else {
    console.error(`[Scheduler] ERRO: Expressão cron inválida para a tarefa '${taskName}': [${schedule}]`);
  }
};

/**
 * Lê as configurações do banco e agenda/reagenda todas as tarefas.
 * Esta função é chamada na inicialização e sempre que as configurações são salvas.
 */



/**
 * Função de inicialização, chamada apenas uma vez quando o servidor sobe.
 */
const initScheduler = async () => {
  console.log('⏰ Inicializando o agendador de tarefas...');
  // Chama a função principal de agendamento.
  await rescheduleAllTasks();
  console.log('✅ Agendador pronto!');
};

const rescheduleAllTasks = async () => {
  console.log('🔄 Lendo configurações e (re)agendando todas as tarefas...');
  try {
    const settings = await getSettings();

    // ===================================================================
    // TAREFA 1: Reset Diário de Créditos (Lógica separada e correta)
    // ===================================================================
    const creditResetTime = settings.creditResetTimeUTC || '03:00';
    const [hour, minute] = creditResetTime.split(':');
    const creditResetCron = `${minute} ${hour} * * *`;
    startTask('creditReset', creditResetCron, () => {
        console.log(`[${new Date().toISOString()}] Executando job: Reset Diário de Créditos...`);
        hotspotUserService.resetDailyCreditsForAllUsers();
    });
    
    // ===================================================================
    // TAREFA 2: Coleta de Uso Unificada (A GRANDE CORREÇÃO)
    // ===================================================================
    startTask('unifiedUsageCollection', settings.usageCollectionCron, () => {
        console.log(`[${new Date().toISOString()}] Executando job: Coleta de Uso UNIFICADA para todas as empresas...`);
        mikrotikService.collectUsageForAllCompaniesUnified();
    });

    // ===================================================================
    // TAREFA 3: Auditoria de Usuários Expirados (NOVA - CRÍTICA)
    // ===================================================================
    // Esta tarefa verifica e corrige usuários que deveriam estar expirados
    // mas ainda estão ativos no MikroTik. Roda a cada 15 minutos.
    startTask('auditExpiredUsers', '*/15 * * * *', async () => {
        console.log(`[${new Date().toISOString()}] Executando job: Auditoria de Usuários Expirados...`);
        try {
            // Usar a função do mikrotik.service.js
            const result = await mikrotikService.auditExpiredUsers();
            
            if (result.success && result.totalFixed > 0) {
                console.log(`[AUDIT] ✅ ${result.totalFixed} usuários corrigidos na auditoria`);
            }
            
            // Também executar a função do hotspotUser.service.js para dupla verificação
            const hotspotResult = await hotspotUserService.auditAndFixExpiredUsers();
            
            if (hotspotResult.success && hotspotResult.totalFixed > 0) {
                console.log(`[AUDIT-HOTSPOT] ✅ ${hotspotResult.totalFixed} usuários adicionais corrigidos`);
            }
            
        } catch (error) {
            console.error(`[AUDIT] ❌ Erro na auditoria de usuários expirados: ${error.message}`);
        }
    });

    // TAREFAS ANTIGAS E FRAGMENTADAS REMOVIDAS
    stopTask('usageCollection');      // Remove a tarefa antiga se existir
    stopTask('logoutMonitoring');     // Remove a tarefa antiga se existir
    stopTask('sessionCleanup');       // Remove a tarefa antiga se existir
    
    // ===================================================================
    // TAREFA 4: Sincronização de Dados do MikroTik (mantida)
    // ===================================================================
    startTask('mikrotikDataSync', settings.mikrotikDataSyncCron, async () => {
        console.log(`[${new Date().toISOString()}] Executando job: Sincronização de Dados MikroTik...`);
        const companies = await Company.findAll({ attributes: ['id', 'name'] });
        for (const company of companies) {
            try {
                await mikrotikService.importProfilesFromMikrotik(company.id);
                await mikrotikService.importUsersFromMikrotik(company.id);
            } catch (error) {
                console.error(`[Sync] FALHA na sincronização para a empresa '${company.name}': ${error.message}`);
            }
        }
    });

    // ===================================================================
    // TAREFA 5: Verificação de Conectividade (NOVA - OPCIONAL)
    // ===================================================================
    // Verifica se as empresas estão online e atualiza o status
    startTask('connectivityCheck', '*/30 * * * *', async () => {
        console.log(`[${new Date().toISOString()}] Executando job: Verificação de Conectividade...`);
        try {
            const companies = await Company.findAll();
            
            for (const company of companies) {
                try {
                    // Tentar uma operação simples para verificar conectividade
                    const mikrotikClient = require('../config/mikrotik').createMikrotikClient(company);
                    await mikrotikClient.get('/system/identity');
                    
                    // Se chegou aqui, está online
                    if (company.status !== 'online') {
                        await company.update({ status: 'online' });
                        console.log(`[CONNECTIVITY] ✅ Empresa '${company.name}' voltou online`);
                    }
                    
                } catch (error) {
                    // Se falhou, marcar como offline
                    if (company.status !== 'offline') {
                        await company.update({ status: 'offline' });
                        console.log(`[CONNECTIVITY] ❌ Empresa '${company.name}' está offline: ${error.message}`);
                    }
                }
                
                // Pequena pausa entre empresas
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
        } catch (error) {
            console.error(`[CONNECTIVITY] ❌ Erro na verificação de conectividade: ${error.message}`);
        }
    });

    console.log('✅ Todas as tarefas foram reagendadas com sucesso!');
    console.log(`📋 Tarefas ativas:`);
    console.log(`   • Reset de Créditos: ${creditResetCron} (${creditResetTime})`);
    console.log(`   • Coleta de Uso: ${settings.usageCollectionCron}`);
    console.log(`   • Auditoria Expirados: */15 * * * * (a cada 15 min)`);
    console.log(`   • Sync MikroTik: ${settings.mikrotikDataSyncCron}`);
    console.log(`   • Verificação Conectividade: */30 * * * * (a cada 30 min)`);

  } catch (error) {
      console.error('[Scheduler] ERRO CRÍTICO ao tentar reagendar tarefas:', error.message);
  }
};

// ====================================================================
// FUNÇÃO PARA EXECUTAR AUDITORIA MANUAL (usar via API)
// ====================================================================

const runManualAudit = async () => {
  console.log('[MANUAL-AUDIT] Iniciando auditoria manual...');
  
  try {
    // Executar ambas as auditorias
    const mikrotikResult = await mikrotikService.auditExpiredUsers();
    const hotspotResult = await hotspotUserService.auditAndFixExpiredUsers();
    
    const totalFixed = (mikrotikResult.totalFixed || 0) + (hotspotResult.totalFixed || 0);
    const totalChecked = (mikrotikResult.totalChecked || 0) + (hotspotResult.totalChecked || 0);
    
    console.log(`[MANUAL-AUDIT] ✅ Auditoria concluída: ${totalFixed}/${totalChecked} usuários corrigidos`);
    
    return {
      success: true,
      totalFixed,
      totalChecked,
      mikrotikResult,
      hotspotResult
    };
    
  } catch (error) {
    console.error(`[MANUAL-AUDIT] ❌ Erro na auditoria manual: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
};

// ====================================================================
// FUNÇÃO PARA OBTER STATUS DAS TAREFAS
// ====================================================================

const getTasksStatus = () => {
  const activeTasks = Object.keys(scheduledTasks);
  const taskInfo = activeTasks.map(taskName => ({
    name: taskName,
    running: scheduledTasks[taskName] ? scheduledTasks[taskName].running : false,
    lastRun: scheduledTasks[taskName] ? scheduledTasks[taskName].lastDate() : null
  }));
  
  return {
    totalTasks: activeTasks.length,
    tasks: taskInfo,
    activeTaskNames: activeTasks
  };
};

module.exports = { 
  initScheduler,
  // Exporta a função para que a API de settings possa chamá-la.
  rescheduleAllTasks,
  getTasksStatus,
  runManualAudit
};
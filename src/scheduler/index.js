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
 * Inicia uma tarefa com um horário e fuso horário específicos.
 * @param {string} taskName - O nome da tarefa.
 * @param {string} schedule - A expressão cron.
 * @param {function} jobFunction - A função a ser executada.
 * @param {string} timezone - O fuso horário (ex: 'America/Sao_Paulo').
 */
const startTask = (taskName, schedule, jobFunction, timezone) => {
  // Para a tarefa antiga antes de iniciar uma nova, para evitar duplicatas
  stopTask(taskName);

  if (cron.validate(schedule)) {
    // Agenda a tarefa usando o fuso horário especificado
    const task = cron.schedule(schedule, jobFunction, {
      timezone: timezone,
    });
    scheduledTasks[taskName] = task;
    console.log(`[Scheduler] Tarefa '${taskName}' agendada para fuso [${timezone}] no horário [${schedule}]`);
  } else {
    console.error(`[Scheduler] ERRO: Expressão cron inválida para a tarefa '${taskName}': [${schedule}]`);
  }
};

/**
 * Lê as configurações do banco e agenda/reagenda todas as tarefas.
 * Esta função é chamada na inicialização e sempre que as configurações são salvas.
 */
const rescheduleAllTasks = async () => {
  console.log('🔄 Lendo configurações e (re)agendando todas as tarefas...');
  try {
    const settings = await getSettings();
    // Pega o fuso horário do banco de dados. Se não houver, usa 'America/Sao_Paulo' como padrão.
    const systemTimezone = settings.timezone || 'America/Sao_Paulo';

    // ===================================================================
    // TAREFA 1: Reset Diário de Créditos (AGORA RESPEITA O FUSO)
    // ===================================================================
    // O cliente digita "00:00" e o sistema interpreta como "00:00" no fuso configurado.
    const creditResetTime = settings.creditResetTimeUTC || '00:00';
    const [hour, minute] = creditResetTime.split(':');
    const creditResetCron = `${minute} ${hour} * * *`;
    
    startTask('creditReset', creditResetCron, () => {
        console.log(`[${new Date().toISOString()}] Executando job: Reset Diário de Créditos...`);
        hotspotUserService.resetDailyCreditsForAllUsers();
    }, systemTimezone); // <-- Passa o fuso horário para a função
    
    // ===================================================================
    // TAREFA 2: Coleta de Uso Unificada
    // ===================================================================
    startTask('unifiedUsageCollection', settings.usageCollectionCron, () => {
        console.log(`[${new Date().toISOString()}] Executando job: Coleta de Uso UNIFICADA para todas as empresas...`);
        mikrotikService.collectUsageForAllCompaniesUnified();
    }, systemTimezone); // <-- Passa o fuso horário para a função

    // ===================================================================
    // TAREFA 3: Auditoria de Usuários Expirados
    // ===================================================================
    // Esta tarefa verifica e corrige usuários que deveriam estar expirados
    // mas ainda estão ativos no MikroTik. Roda a cada 15 minutos.
    startTask('auditExpiredUsers', '*/15 * * * *', async () => {
        console.log(`[${new Date().toISOString()}] Executando job: Auditoria de Usuários Expirados...`);
        try {
            const result = await mikrotikService.auditExpiredUsers();
            if (result.success && result.totalFixed > 0) {
                console.log(`[AUDIT] ✅ ${result.totalFixed} usuários corrigidos na auditoria`);
            }
            
            const hotspotResult = await hotspotUserService.auditAndFixExpiredUsers();
            if (hotspotResult.success && hotspotResult.totalFixed > 0) {
                console.log(`[AUDIT-HOTSPOT] ✅ ${hotspotResult.totalFixed} usuários adicionais corrigidos`);
            }
        } catch (error) {
            console.error(`[AUDIT] ❌ Erro na auditoria de usuários expirados: ${error.message}`);
        }
    }, systemTimezone); // <-- Passa o fuso horário para a função

    // TAREFAS ANTIGAS E FRAGMENTADAS REMOVIDAS
    stopTask('usageCollection');
    stopTask('logoutMonitoring');
    stopTask('sessionCleanup');
    
    // ===================================================================
    // TAREFA 4: Sincronização de Dados do MikroTik
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
    }, systemTimezone); // <-- Passa o fuso horário para a função

    // ===================================================================
    // TAREFA 5: Verificação de Conectividade
    // ===================================================================
    startTask('connectivityCheck', '*/30 * * * *', async () => {
        console.log(`[${new Date().toISOString()}] Executando job: Verificação de Conectividade...`);
        try {
            const companies = await Company.findAll();
            for (const company of companies) {
                try {
                    const mikrotikClient = require('../config/mikrotik').createMikrotikClient(company);
                    await mikrotikClient.get('/system/identity');
                    
                    if (company.status !== 'online') {
                        await company.update({ status: 'online' });
                        console.log(`[CONNECTIVITY] ✅ Empresa '${company.name}' voltou online`);
                    }
                } catch (error) {
                    if (company.status !== 'offline') {
                        await company.update({ status: 'offline' });
                        console.log(`[CONNECTIVITY] ❌ Empresa '${company.name}' está offline: ${error.message}`);
                    }
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } catch (error) {
            console.error(`[CONNECTIVITY] ❌ Erro na verificação de conectividade: ${error.message}`);
        }
    }, systemTimezone); // <-- Passa o fuso horário para a função

    console.log('✅ Todas as tarefas foram reagendadas com sucesso!');
    console.log(`📋 Tarefas ativas (Fuso Horário: ${systemTimezone}):`);
    console.log(`   • Reset de Créditos: ${creditResetCron} (Horário Local: ${creditResetTime})`);
    console.log(`   • Coleta de Uso: ${settings.usageCollectionCron}`);
    console.log(`   • Auditoria Expirados: */15 * * * * (a cada 15 min)`);
    console.log(`   • Sync MikroTik: ${settings.mikrotikDataSyncCron}`);
    console.log(`   • Verificação Conectividade: */30 * * * * (a cada 30 min)`);

  } catch (error) {
      console.error('[Scheduler] ERRO CRÍTICO ao tentar reagendar tarefas:', error.message);
  }
};

/**
 * Função de inicialização, chamada apenas uma vez quando o servidor sobe.
 */
const initScheduler = async () => {
  console.log('⏰ Inicializando o agendador de tarefas...');
  await rescheduleAllTasks();
  console.log('✅ Agendador pronto!');
};

const runManualAudit = async () => {
  console.log('[MANUAL-AUDIT] Iniciando auditoria manual...');
  try {
    const mikrotikResult = await mikrotikService.auditExpiredUsers();
    const hotspotResult = await hotspotUserService.auditAndFixExpiredUsers();
    const totalFixed = (mikrotikResult.totalFixed || 0) + (hotspotResult.totalFixed || 0);
    const totalChecked = (mikrotikResult.totalChecked || 0) + (hotspotResult.totalChecked || 0);
    console.log(`[MANUAL-AUDIT] ✅ Auditoria concluída: ${totalFixed}/${totalChecked} usuários corrigidos`);
    return { success: true, totalFixed, totalChecked, mikrotikResult, hotspotResult };
  } catch (error) {
    console.error(`[MANUAL-AUDIT] ❌ Erro na auditoria manual: ${error.message}`);
    return { success: false, error: error.message };
  }
};

const getTasksStatus = () => {
  const activeTasks = Object.keys(scheduledTasks);
  const taskInfo = activeTasks.map(taskName => ({
    name: taskName,
    running: scheduledTasks[taskName] ? scheduledTasks[taskName].running : false,
    lastRun: scheduledTasks[taskName] ? scheduledTasks[taskName].lastDate() : null
  }));
  return { totalTasks: activeTasks.length, tasks: taskInfo, activeTaskNames: activeTasks };
};

const runManualCreditReset = async () => {
  console.log('[MANUAL-RESET-PUBLIC] Disparando o job de Reset Diário de Créditos manualmente...');
  try {
    await hotspotUserService.resetDailyCreditsForAllUsers();
    const message = 'Reset diário de créditos executado com sucesso manualmente.';
    console.log(`[MANUAL-RESET-PUBLIC] ✅ ${message}`);
    return { success: true, message: message };
  } catch (error) {
    const errorMessage = `Erro na execução manual do reset de créditos: ${error.message}`;
    console.error(`[MANUAL-RESET-PUBLIC] ❌ ${errorMessage}`);
    return { success: false, error: errorMessage };
  }
};

module.exports = { 
  initScheduler,
  rescheduleAllTasks,
  getTasksStatus,
  runManualAudit,
  runManualCreditReset
};
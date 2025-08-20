// src/scheduler/index.js

const cron = require('node-cron');
const { getSettings } = require('../features/settings/settings.service');
const mikrotikService = require('../features/mikrotik/mikrotik.service');
const hotspotUserService = require('../features/hotspotUser/hotspotUser.service');
const { Company } = require('../models');

let scheduledTasks = {};

const stopTask = (taskName) => {
  if (scheduledTasks[taskName]) {
    scheduledTasks[taskName].stop();
    delete scheduledTasks[taskName];
    console.log(`[Scheduler] Tarefa '${taskName}' parada.`);
  }
};

const startTask = (taskName, schedule, jobFunction) => {
  stopTask(taskName);

  if (cron.validate(schedule)) {
    const task = cron.schedule(schedule, jobFunction, {
      // Adicionado para garantir que a tarefa rode no fuso horário do sistema
      timezone: process.env.TZ || 'America/Sao_Paulo' 
    });
    scheduledTasks[taskName] = task;
    console.log(`[Scheduler] Tarefa '${taskName}' agendada (fuso do servidor): [${schedule}]`);
  } else {
    console.error(`[Scheduler] ERRO: Expressão cron inválida para a tarefa '${taskName}': [${schedule}]`);
  }
};

const rescheduleAllTasks = async () => {
  console.log('🔄 Lendo configurações e (re)agendando todas as tarefas...');
  try {
    const settings = await getSettings();

    // ===================================================================
    // TAREFA 1: Reset Diário de Créditos (Lógica separada e correta)
    // ===================================================================
    // Esta tarefa continua a mesma, pois sua responsabilidade é única.
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
    // Substituímos as 3 tarefas antigas por esta única chamada.
    // Ela executa a lógica robusta do 'mikrotik.service.js'.
    startTask('unifiedUsageCollection', settings.usageCollectionCron, () => {
        console.log(`[${new Date().toISOString()}] Executando job: Coleta de Uso UNIFICADA para todas as empresas...`);
        mikrotikService.collectUsageForAllCompaniesUnified();
    });

    // TAREFAS ANTIGAS E FRAGMENTADAS REMOVIDAS
    stopTask('usageCollection');      // Remove a tarefa antiga se existir
    stopTask('logoutMonitoring');     // Remove a tarefa antiga se existir
    stopTask('sessionCleanup');       // Remove a tarefa antiga se existir
    
    // ===================================================================
    // TAREFA 3: Sincronização de Dados do MikroTik (mantida)
    // ===================================================================
    // Sincroniza perfis e usuários que foram criados diretamente no MikroTik.
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

  } catch (error) {
      console.error('[Scheduler] ERRO CRÍTICO ao tentar reagendar tarefas:', error.message);
  }
};

const initScheduler = async () => {
  console.log('⏰ Inicializando o agendador de tarefas...');
  await rescheduleAllTasks();
  console.log('✅ Agendador pronto!');
};

module.exports = { 
  initScheduler,
  rescheduleAllTasks 
};
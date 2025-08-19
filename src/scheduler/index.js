// ==========================================
// 1. CORREÇÃO DO SCHEDULER (src/scheduler/index.js)
// ==========================================

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
    const task = cron.schedule(schedule, jobFunction);
    scheduledTasks[taskName] = task;
    console.log(`[Scheduler] Tarefa '${taskName}' agendada (horário do servidor): [${schedule}]`);
  } else {
    console.error(`[Scheduler] ERRO: Expressão cron inválida para a tarefa '${taskName}': [${schedule}]`);
  }
};

const rescheduleAllTasks = async () => {
  console.log('🔄 Lendo configurações e (re)agendando todas as tarefas...');
  try {
    const settings = await getSettings();

    // Tarefa 1: Reset diário de créditos
    const creditResetTime = settings.creditResetTimeUTC || '00:00';
    const [hour, minute] = creditResetTime.split(':');
    const creditResetCron = `${minute} ${hour} * * *`;
    startTask('creditReset', creditResetCron, () => {
        console.log(`[${new Date().toISOString()}] Executando job: Reset Diário de Créditos...`);
        hotspotUserService.resetDailyCreditsForAllUsers();
    });
    
    // ✅ CORREÇÃO: Usar a função corrigida do hotspotUserService
    startTask('usageCollection', settings.usageCollectionCron, () => {
        console.log(`[${new Date().toISOString()}] Executando job: Coleta de Uso de Sessões Ativas...`);
        hotspotUserService.collectActiveSessionUsage();
    });
    
    // ✅ NOVA TAREFA: Monitoramento de logouts
    startTask('logoutMonitoring', '*/2 * * * *', () => { // A cada 2 minutos
        console.log(`[${new Date().toISOString()}] Executando job: Monitoramento de Logouts...`);
        hotspotUserService.monitorUserLogouts();
    });

    // ✅ NOVA TAREFA: Limpeza de sessões órfãs
    startTask('sessionCleanup', '*/5 * * * *', () => { // A cada 5 minutos
        console.log(`[${new Date().toISOString()}] Executando job: Limpeza de Sessões Órfãs...`);
        hotspotUserService.cleanupOrphanedSessions();
    });
    
    // Tarefa 3: Sincronização de Dados do MikroTik (mantida)
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
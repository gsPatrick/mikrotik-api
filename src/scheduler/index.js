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
    
    // Tarefa 2: Coleta de uso de dados
    startTask('usageCollection', settings.usageCollectionCron, () => {
        console.log(`[${new Date().toISOString()}] Executando job: Coleta de Uso...`);
        mikrotikService.collectUsageForAllCompanies();
    });
    
    // Tarefa 3: Sincronização de Dados do MikroTik
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


/**
 * Função de inicialização, chamada apenas uma vez quando o servidor sobe.
 */
const initScheduler = async () => {
  console.log('⏰ Inicializando o agendador de tarefas...');
  // Chama a função principal de agendamento.
  await rescheduleAllTasks();
  console.log('✅ Agendador pronto!');
};

module.exports = { 
  initScheduler,
  // Exporta a função para que a API de settings possa chamá-la.
  rescheduleAllTasks 
};
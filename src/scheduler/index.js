// src/scheduler/index.js
const cron = require('node-cron');
const { getSettings } = require('../features/settings/settings.service');
const mikrotikService = require('../features/mikrotik/mikrotik.service');
const hotspotUserService = require('../features/hotspotUser/hotspotUser.service');
const companyService = require('../features/company/company.service');
const { Company } = require('../models');

const initScheduler = async () => {
  console.log('⏰ Inicializando o agendador de tarefas...');
  
  // Busca as configurações do banco de dados UMA VEZ na inicialização
  const settings = await getSettings();

  // --- JOB 1: Coleta de uso de dados ---
  console.log(`🕐 Job de Coleta de Uso agendado para rodar com a frequência: [${settings.usageCollectionCron}]`);
  cron.schedule(settings.usageCollectionCron, () => {
    console.log(`[${new Date().toISOString()}] Executando job: Coleta de Uso...`);
    mikrotikService.collectUsageForAllCompanies();
  });

  // --- JOB 2: Monitoramento de Status de Empresas ---
  console.log(`🕐 Job de Monitoramento de Status de Empresas agendado para rodar com a frequência: [${settings.companyStatusMonitorCron}]`);
  cron.schedule(settings.companyStatusMonitorCron, async () => {
    console.log(`[${new Date().toISOString()}] Executando job: Monitoramento de Status de Empresas...`);
    const companies = await Company.findAll({ attributes: ['id', 'name'] });
    console.log(`Verificando status de ${companies.length} empresas.`);
    
    for (const company of companies) {
      // Supondo que você tenha uma função para isso no company.service
      // Se não tiver, esta é uma boa prática a se adicionar
      // await companyService.updateCompanyStatus(company.id);
    }
  });

  // --- JOB 3: Reset diário de créditos ---
  const creditResetTime = settings?.creditResetTimeUTC || '03:00'; 
  const [hour, minute] = creditResetTime.split(':');
  const cronExpressionReset = `${minute} ${hour} * * *`;
  
  console.log(`🕐 Job de Reset de Créditos agendado para rodar diariamente às ${creditResetTime} UTC (${cronExpressionReset})`);
  cron.schedule(cronExpressionReset, () => {
    console.log(`[${new Date().toISOString()}] Executando job: Reset Diário de Créditos...`);
    hotspotUserService.resetDailyCreditsForAllUsers();
  }, {
    timezone: "UTC"
  });

  // --- JOB 4: Sincronização de Usuários e Perfis do MikroTik ---
  console.log(`🕐 Job de Sincronização de Dados do MikroTik agendado para rodar com a frequência: [${settings.mikrotikDataSyncCron}]`);
  cron.schedule(settings.mikrotikDataSyncCron, async () => {
    console.log(`[${new
      Date().toISOString()}] Executando job: Sincronização de Dados MikroTik...`);
    const companies = await Company.findAll({ attributes: ['id', 'name'] });

    if (companies.length === 0) {
      console.log('Nenhuma empresa encontrada para sincronizar. Job de sincronização pulado.');
      return;
    }

    for (const company of companies) {
      try {
        console.log(`[Sync] Iniciando sincronização para a empresa: '${company.name}' (ID: ${company.id})...`);
        
        // Importa perfis
        const profilesResult = await mikrotikService.importProfilesFromMikrotik(company.id);
        console.log(`[Sync] SUCESSO (Perfis): Empresa '${company.name}' - Novos: ${profilesResult.importedCount}, Atualizados: ${profilesResult.updatedCount}.`);

        // Importa usuários
        const usersResult = await mikrotikService.importUsersFromMikrotik(company.id);
        console.log(`[Sync] SUCESSO (Usuários): Empresa '${company.name}' - Novos: ${usersResult.importedCount}, Atualizados: ${usersResult.updatedCount}.`);
        
      } catch (error) {
        console.error(`[Sync] FALHA na sincronização para a empresa '${company.name}': ${error.message}`);
      }
    }
    console.log(`[${new Date().toISOString()}] Finalizado job: Sincronização de Dados MikroTik.`);
  }, {
    timezone: "UTC"
  });

};

module.exports = { initScheduler };
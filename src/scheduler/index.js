// src/scheduler/index.js
const cron = require('node-cron');
const { getSettings } = require('../features/settings/settings.service');
const mikrotikService = require('../features/mikrotik/mikrotik.service');
const hotspotUserService = require('../features/hotspotUser/hotspotUser.service');
const companyService = require('../features/company/company.service');
const { Company } = require('../models'); // Certifique-se de que Company está importado

const initScheduler = async () => {
  console.log('⏰ Inicializando o agendador de tarefas...');

  // --- JOB 1: Coleta de uso de dados a cada minuto ---
  cron.schedule('*/1 * * * *', () => {
    console.log(`[${new Date().toISOString()}] Executando job: Coleta de Uso...`);
    mikrotikService.collectUsageForAllCompanies();
  });

  // --- JOB 2: Monitoramento de Status de Empresas a cada 5 minutos ---
  cron.schedule('*/5 * * * *', async () => {
    console.log(`[${new Date().toISOString()}] Executando job: Monitoramento de Status de Empresas...`);
    const companies = await Company.findAll({ attributes: ['id', 'name'] });
    console.log(`Verificando status de ${companies.length} empresas.`);
    
    for (const company of companies) {
      await companyService.updateCompanyStatus(company.id);
    }
  });


  // --- JOB 3: Reset diário de créditos ---
  const settings = await getSettings();
  const creditResetTime = settings?.creditResetTimeUTC || '03:00'; 
  const [hour, minute] = creditResetTime.split(':');
  
  const cronExpressionReset = `${minute} ${hour} * * *`;
  
  console.log(`🕐 Job de reset de créditos agendado para rodar diariamente às ${creditResetTime} UTC (${cronExpressionReset})`);

  cron.schedule(cronExpressionReset, () => {
    console.log(`[${new Date().toISOString()}] Executando job: Reset Diário de Créditos...`);
    hotspotUserService.resetDailyCreditsForAllUsers();
  }, {
    timezone: "UTC"
  });

  // --- NOVO JOB (TEMPORÁRIO PARA TESTE): Sincronização de Usuários e Perfis do MikroTik a CADA MINUTO ---
  const cronExpressionImportDataForTest = '*/1 * * * *'; // A CADA MINUTO para teste
  console.log(`🔄 Job de importação de dados (TEMPORÁRIO) agendado para rodar A CADA MINUTO (${cronExpressionImportDataForTest})`);

  cron.schedule(cronExpressionImportDataForTest, async () => {
    console.log(`[${new Date().toISOString()}] Executando job: Sincronização de Dados MikroTik (TESTE)...`);
    const companies = await Company.findAll({ attributes: ['id', 'name'] });

    if (companies.length === 0) {
      console.log('Nenhuma empresa encontrada para sincronizar dados do MikroTik. Job de importação pulado.');
      return;
    }

    for (const company of companies) {
      try {
        console.log(`[Import] Iniciando sincronização para a empresa: '${company.name}' (ID: ${company.id})...`);
        
        // Primeiro importa perfis
        console.log(`[Import] Buscando perfis do MikroTik para '${company.name}'...`);
        const { importedCount: profilesImported, updatedCount: profilesUpdated, skippedCount: profilesSkipped, totalInMikrotik: profilesTotal } = await mikrotikService.importProfilesFromMikrotik(company.id);
        console.log(`[Import] SUCESSO (Perfis): Empresa '${company.name}' - Total no MikroTik: ${profilesTotal}, Novos: ${profilesImported}, Atualizados: ${profilesUpdated}, Ignorados: ${profilesSkipped}.`);

        // Depois importa usuários
        console.log(`[Import] Buscando usuários do MikroTik para '${company.name}'...`);
        const { importedCount: usersImported, updatedCount: usersUpdated, skippedCount: usersSkipped, totalInMikrotik: usersTotal } = await mikrotikService.importUsersFromMikrotik(company.id);
        console.log(`[Import] SUCESSO (Usuários): Empresa '${company.name}' - Total no MikroTik: ${usersTotal}, Novos: ${usersImported}, Atualizados: ${usersUpdated}, Ignorados: ${usersSkipped}.`);

        console.log(`[Import] Sincronização completa para a empresa '${company.name}'.`);
        
      } catch (error) {
        console.error(`[Import] FALHA na sincronização para a empresa '${company.name}': ${error.message}`);
      }
    }
    console.log(`[${new Date().toISOString()}] Finalizado job: Sincronização de Dados MikroTik (TESTE).`);
  }, {
    timezone: "UTC"
  });
  // --- FIM DO NOVO JOB (TEMPORÁRIO) ---

};

module.exports = { initScheduler };
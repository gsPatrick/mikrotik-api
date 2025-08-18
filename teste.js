// scripts/test-polling-system.js
// Script para testar o sistema de polling antes de colocar em produção

const { HotspotUser, Company } = require('./src/models');
const { 
  collectActiveSessionUsage, 
  monitorUserLogouts,
  cleanupOrphanedSessions 
} = require('./src/features/hotspotUser/hotspotUser.service');

const testPollingSystem = async () => {
  console.log('🧪 ================================');
  console.log('🧪 TESTE DO SISTEMA DE POLLING');
  console.log('🧪 ================================\n');

  try {
    // 1. Verificar se a migração foi executada
    console.log('1️⃣ Verificando estrutura do banco...');
    const testUser = await HotspotUser.findOne({ limit: 1 });
    
    if (!testUser) {
      console.log('⚠️ Nenhum usuário encontrado para teste.');
      return;
    }

    // Verificar se os novos campos existem
    const hasNewFields = testUser.hasOwnProperty('currentSessionBytes') && 
                         testUser.hasOwnProperty('sessionId') &&
                         testUser.hasOwnProperty('lastCollectionTime');
    
    if (!hasNewFields) {
      console.error('❌ ERRO: Novos campos não encontrados! Execute a migração primeiro.');
      console.log('   Comando: npx sequelize-cli db:migrate');
      return;
    }
    
    console.log('✅ Estrutura do banco OK - Novos campos encontrados\n');

    // 2. Verificar conexão com empresas
    console.log('2️⃣ Verificando conexões com empresas...');
    const companies = await Company.findAll();
    console.log(`   Encontradas ${companies.length} empresa(s):`);
    
    for (const company of companies) {
      console.log(`   - ${company.name} (${company.mikrotikIp}:${company.mikrotikApiPort})`);
    }
    console.log('');

    // 3. Teste das funções de coleta
    console.log('3️⃣ Testando coleta de sessões ativas...');
    console.log('   (Isso pode demorar alguns segundos)\n');
    
    const startTime = Date.now();
    await collectActiveSessionUsage();
    const collectionTime = Date.now() - startTime;
    
    console.log(`✅ Coleta concluída em ${collectionTime}ms\n`);

    // 4. Teste de monitoramento de logouts
    console.log('4️⃣ Testando monitoramento de logouts...');
    
    const logoutStartTime = Date.now();
    await monitorUserLogouts();
    const logoutTime = Date.now() - logoutStartTime;
    
    console.log(`✅ Monitoramento concluído em ${logoutTime}ms\n`);

    // 5. Teste de limpeza de sessões órfãs (opcional)
    console.log('5️⃣ Testando limpeza de sessões órfãs...');
    const cleanupStartTime = Date.now();
    await cleanupOrphanedSessions();
    const cleanupTime = Date.now() - cleanupStartTime;
    
    console.log(`✅ Limpeza concluída em ${cleanupTime}ms\n`);

  } catch (error) {
    console.error('❌ ERRO durante o teste do sistema de polling:', error);
  }
};

// Chamando a função de teste
testPollingSystem();

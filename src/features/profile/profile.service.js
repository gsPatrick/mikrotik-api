// src/features/profile/profile.service.js - VERSÃO CORRIGIDA
const { Op } = require('sequelize');
const { Profile, Company, ConnectionLog } = require('../../models');
const { createMikrotikClient } = require('../../config/mikrotik');

const findAllProfiles = async (options) => {
  const { page = 1, limit = 10, sortBy = 'name', sortOrder = 'ASC', ...filters } = options;

  const where = {};
  if (filters.name) {
    where.name = { [Op.iLike]: `%${filters.name}%` };
  }
  if (filters.companyId) {
    where.companyId = filters.companyId;
  }

  const offset = (page - 1) * limit;

  return await Profile.findAndCountAll({
    where,
    include: [{ model: Company, as: 'company', attributes: ['id', 'name'] }],
    limit,
    offset,
    order: [[sortBy, sortOrder]],
  });
};

const createProfile = async (profileData) => {
  const company = await Company.findByPk(profileData.companyId);
  if (!company) {
    throw new Error('Empresa especificada não foi encontrada.');
  }

  const mikrotikClient = createMikrotikClient(company);
  const startTime = Date.now();
  const action = 'createProfile_Mikrotik';

  try {
    // CORREÇÃO: Payload correto para criação de perfil no MikroTik
    const mikrotikPayload = {
      name: profileData.mikrotikName,
      'rate-limit': profileData.rateLimit || '', 
      'session-timeout': profileData.sessionTimeout || '0s', 
      'shared-users': profileData.sharedUsers || '1',
      'idle-timeout': profileData.idleTimeout || 'none',
      'keepalive-timeout': profileData.keepaliveTimeout || '2m',
      'status-autorefresh': profileData.statusAutorefresh || '1m',
      'transparent-proxy': profileData.transparentProxy || 'yes'
    };

    console.log(`[CREATE] Criando perfil '${profileData.mikrotikName}' no MikroTik. Payload:`, mikrotikPayload);

    // CORREÇÃO: Usar PUT para criar (não POST)
    const response = await mikrotikClient.put('/ip/hotspot/user/profile', mikrotikPayload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    await ConnectionLog.create({
      action,
      status: 'success',
      message: `Perfil ${profileData.mikrotikName} criado com sucesso no MikroTik da empresa ${company.name}.`,
      responseTime: Date.now() - startTime,
      companyId: company.id,
    });

    // Salvar o ID retornado pelo MikroTik
    if (response.data && response.data['.id']) {
      profileData.mikrotikId = response.data['.id'];
    }

    return await Profile.create(profileData);

  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    await ConnectionLog.create({
      action,
      status: 'error',
      message: `Falha ao criar perfil no MikroTik: ${errorMessage}`,
      responseTime: Date.now() - startTime,
      companyId: company.id,
    });
    throw new Error(`Falha ao criar perfil no MikroTik: ${errorMessage}`);
  }
};

const findProfileById = async (id) => {
  return await Profile.findByPk(id, {
    include: [{ model: Company, as: 'company', attributes: ['id', 'name'] }],
  });
};

const updateProfile = async (id, profileData) => {
  console.log(`\n==========================================`);
  console.log(`[PROFILE] === INÍCIO UPDATE PROFILE ===`);
  console.log(`[PROFILE] Timestamp: ${new Date().toISOString()}`);
  console.log(`[PROFILE] ID do perfil: ${id}`);
  console.log(`[PROFILE] Dados recebidos:`, JSON.stringify(profileData, null, 2));
  console.log(`==========================================\n`);

  const profile = await findProfileById(id);
  if (!profile) {
    console.log(`[PROFILE] ❌ Perfil não encontrado com ID: ${id}`);
    return null;
  }

  console.log(`[PROFILE] ✅ Perfil encontrado: '${profile.name}' (MikroTik: '${profile.mikrotikName}')`);

  const company = await Company.findByPk(profile.companyId);
  if (!company) {
    throw new Error('Empresa do perfil não encontrada.');
  }

  console.log(`[PROFILE] ✅ Empresa: '${company.name}' (${company.mikrotikIp}:${company.mikrotikApiPort})`);

  const mikrotikClient = createMikrotikClient(company);
  const startTime = Date.now();
  const action = 'updateProfile_Mikrotik';

  try {
    // 1. Buscar perfis no MikroTik
    console.log(`[PROFILE] 🔍 Buscando perfis no MikroTik...`);
    const currentProfilesResponse = await mikrotikClient.get('/ip/hotspot/user/profile', {
      headers: { 'Accept': 'application/json' },
      timeout: 10000
    });

    const currentProfiles = Array.isArray(currentProfilesResponse.data) ? currentProfilesResponse.data : [];
    const mikrotikProfile = currentProfiles.find(p => p.name === profile.mikrotikName);

    if (!mikrotikProfile) {
      throw new Error(`Perfil '${profile.mikrotikName}' não encontrado no MikroTik.`);
    }

    const mikrotikId = mikrotikProfile['.id'];
    console.log(`[PROFILE] ✅ Perfil MikroTik encontrado: ID=${mikrotikId}, Name=${mikrotikProfile.name}`);

    // Atualizar mikrotikId no banco se diferente
    if (profile.mikrotikId !== mikrotikId) {
      await profile.update({ mikrotikId });
      console.log(`[PROFILE] ✅ mikrotikId atualizado no banco: ${mikrotikId}`);
    }

    // 2. Construir payload seguro
    console.log(`\n[PROFILE] === CONSTRUINDO PAYLOAD MIKROTIK ===`);
    const safeFields = [
      'rate-limit','session-timeout','shared-users',
      'idle-timeout','keepalive-timeout','status-autorefresh','transparent-proxy'
    ];
    const mikrotikPayload = {};

    safeFields.forEach(f => {
      if (profileData.hasOwnProperty(f)) {
        let value = String(profileData[f] || '').trim();
        
        // Tratamentos específicos
        if (f === 'rate-limit') {
          const rateLimitPattern = /^\d+[KMGT]?\/\d+[KMGT]?$/i;
          if (!rateLimitPattern.test(value)) value = '';
        }

        if (f === 'session-timeout') {
          const timePattern = /^(\d{1,2}):(\d{2}):(\d{2})$/;
          const match = value.match(timePattern);
          if (match) {
            const [, h, m, s] = match;
            value = `${parseInt(h)*3600 + parseInt(m)*60 + parseInt(s)}s`;
          } else if (!/^\d+[smhd]?$/i.test(value)) {
            value = '0s';
          }
        }

        if (f === 'shared-users') {
          if (!/^\d+$/.test(value)) value = '1';
        }

        if (f === 'transparent-proxy') {
          value = value.toLowerCase();
          if (['true','yes'].includes(value)) value='yes';
          else if (['false','no'].includes(value)) value='no';
          else value='yes';
        }

        mikrotikPayload[f] = value;
        console.log(`[PROFILE] ✅ ${f.toUpperCase()}: '${profile[f] || 'Nenhum'}' → '${value}'`);
      }
    });

    console.log(`\n[PROFILE] === PAYLOAD FINAL ===`);
    console.log(JSON.stringify(mikrotikPayload, null, 2));

    // 3. Atualizar MikroTik apenas se houver campos
    if (Object.keys(mikrotikPayload).length > 0) {
      console.log(`[PROFILE] 🚀 Enviando PATCH para MikroTik...`);
      const mikrotikResponse = await mikrotikClient.patch(
        `/ip/hotspot/user/profile/${mikrotikId}`,
        mikrotikPayload,
        { headers: { 'Content-Type':'application/json','Accept':'application/json' } }
      );
      console.log(`[PROFILE] ✅ Resposta MikroTik: Status=${mikrotikResponse.status}`);
    } else {
      console.log(`[PROFILE] ⚠️ Nenhum campo para atualizar no MikroTik`);
    }

    // 4. Atualizar banco local
    console.log(`[PROFILE] === ATUALIZANDO BANCO LOCAL ===`);
    const updatedProfile = await profile.update(profileData);
    console.log(`[PROFILE] ✅ Banco atualizado com sucesso!`);

    const finalProfile = await findProfileById(id);
    console.log(`\n[PROFILE] === RESULTADO FINAL ===`);
    console.log(`[PROFILE] Nome: '${profile.name}' → '${finalProfile.name}'`);
    console.log(`[PROFILE] MikroTik Nome: '${profile.mikrotikName}' → '${finalProfile.mikrotikName}'`);
    console.log(`[PROFILE] Rate Limit: '${profile.rateLimit || 'Nenhum'}' → '${finalProfile.rateLimit || 'Nenhum'}'`);
    console.log(`[PROFILE] Session Timeout: '${profile.sessionTimeout || 'Nenhum'}' → '${finalProfile.sessionTimeout || 'Nenhum'}'`);

    await ConnectionLog.create({
      action,
      status: 'success',
      message: `Perfil '${profile.mikrotikName}' atualizado com sucesso.`,
      responseTime: Date.now() - startTime,
      companyId: company.id,
    });

    console.log(`[PROFILE] === SUCESSO TOTAL (${Date.now()-startTime}ms) ===\n`);
    return finalProfile;

  } catch (error) {
    console.log(`\n[PROFILE] === ERRO NO UPDATE ===`);
    console.log(`[PROFILE] Mensagem: ${error.message}`);
    if (error.response) console.log(`[PROFILE] HTTP Data:`, error.response.data);
    await ConnectionLog.create({
      action,
      status: 'error',
      message: `Falha ao atualizar perfil '${profile.mikrotikName}': ${error.message}`,
      responseTime: Date.now() - startTime,
      companyId: company.id,
    });
    throw error;
  }
};


const deleteProfile = async (id) => {
  const profile = await findProfileById(id);
  if (!profile) return null;

  const company = await Company.findByPk(profile.companyId);
  const mikrotikClient = createMikrotikClient(company);
  const startTime = Date.now();
  const action = 'deleteProfile_Mikrotik';

  try {
    let mikrotikId = profile.mikrotikId;
    
    // Se não temos o ID, buscar pelo nome
    if (!mikrotikId) {
      const currentProfilesResponse = await mikrotikClient.get('/ip/hotspot/user/profile');
      const currentProfiles = currentProfilesResponse.data || [];
      const mikrotikProfile = currentProfiles.find(p => p.name === profile.mikrotikName);
      
      if (mikrotikProfile) {
        mikrotikId = mikrotikProfile['.id'];
      } else {
        // Se não encontrar, considerar já deletado
        await ConnectionLog.create({
          action,
          status: 'success',
          message: `Perfil ${profile.mikrotikName} não encontrado no MikroTik (já foi removido).`,
          responseTime: Date.now() - startTime,
          companyId: company.id,
        });
        await profile.destroy();
        return profile;
      }
    }
    
    // CORREÇÃO: Usar DELETE com ID na URL
    await mikrotikClient.delete(`/ip/hotspot/user/profile/${mikrotikId}`, {
      headers: {
        'Accept': 'application/json'
      }
    });
    
    await ConnectionLog.create({
      action, 
      status: 'success',
      message: `Perfil ${profile.mikrotikName} deletado do MikroTik.`,
      responseTime: Date.now() - startTime, 
      companyId: company.id
    });

  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    
    // Se o perfil não existe mais, consideramos sucesso
    if (errorMessage.includes('no such item') || 
        errorMessage.includes('not found') || 
        errorMessage.includes('Not Found') ||
        error.response?.status === 404) {
      await ConnectionLog.create({ 
        action, 
        status: 'success', 
        message: `Perfil ${profile.mikrotikName} já não existia no MikroTik.`, 
        responseTime: Date.now() - startTime, 
        companyId: company.id 
      });
    } else {
      await ConnectionLog.create({ 
        action, 
        status: 'error', 
        message: `Falha ao deletar perfil no MikroTik: ${errorMessage}`, 
        responseTime: Date.now() - startTime, 
        companyId: company.id 
      });
      throw new Error(`Falha ao deletar perfil no MikroTik: ${errorMessage}`);
    }
  }

  await profile.destroy();
  return profile;
};

// NOVA FUNÇÃO: Sincronizar perfis do MikroTik para o banco local
const syncProfilesFromMikrotik = async (companyId) => {
  const company = await Company.findByPk(companyId);
  if (!company) throw new Error('Empresa não encontrada.');

  const mikrotikClient = createMikrotikClient(company);
  const startTime = Date.now();

  try {
    // Buscar todos os perfis do MikroTik
    const response = await mikrotikClient.get('/ip/hotspot/user/profile', {
      headers: {
        'Accept': 'application/json'
      }
    });
    const mikrotikProfiles = Array.isArray(response.data) ? response.data : [];

    console.log(`[SYNC] Encontrados ${mikrotikProfiles.length} perfis no MikroTik da empresa ${company.name}`);

    for (const mikrotikProfile of mikrotikProfiles) {
      // Verificar se o perfil já existe no banco local
      let localProfile = await Profile.findOne({
        where: {
          [Op.or]: [
            { mikrotikName: mikrotikProfile.name },
            { mikrotikId: mikrotikProfile['.id'] }
          ],
          companyId: company.id
        }
      });

      const profileData = {
        name: mikrotikProfile.name,
        mikrotikName: mikrotikProfile.name,
        mikrotikId: mikrotikProfile['.id'],
        rateLimit: mikrotikProfile['rate-limit'] || '',
        sessionTimeout: mikrotikProfile['session-timeout'] || '0s',
        sharedUsers: mikrotikProfile['shared-users'] || '1',
        idleTimeout: mikrotikProfile['idle-timeout'] || 'none',
        keepaliveTimeout: mikrotikProfile['keepalive-timeout'] || '2m',
        statusAutorefresh: mikrotikProfile['status-autorefresh'] || '1m',
        transparentProxy: mikrotikProfile['transparent-proxy'] || 'yes',
        companyId: company.id
      };

      if (localProfile) {
        // Atualizar perfil existente
        await localProfile.update(profileData);
        console.log(`[SYNC] Perfil '${mikrotikProfile.name}' atualizado no banco local.`);
      } else {
        // Criar novo perfil
        await Profile.create(profileData);
        console.log(`[SYNC] Perfil '${mikrotikProfile.name}' criado no banco local.`);
      }
    }

    await ConnectionLog.create({
      action: 'syncProfiles_FromMikrotik',
      status: 'success',
      message: `${mikrotikProfiles.length} perfis sincronizados com sucesso do MikroTik.`,
      responseTime: Date.now() - startTime,
      companyId: company.id
    });

    return { synced: mikrotikProfiles.length };

  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    await ConnectionLog.create({
      action: 'syncProfiles_FromMikrotik',
      status: 'error',
      message: `Falha ao sincronizar perfis: ${errorMessage}`,
      responseTime: Date.now() - startTime,
      companyId: company.id
    });
    throw new Error(`Falha ao sincronizar perfis do MikroTik: ${errorMessage}`);
  }
};

module.exports = {
  findAllProfiles,
  createProfile,
  findProfileById,
  updateProfile,
  deleteProfile,
  syncProfilesFromMikrotik,
};
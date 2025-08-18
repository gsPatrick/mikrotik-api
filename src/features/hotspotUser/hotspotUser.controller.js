// src/features/hotspotUser/hotspotUser.controller.js
const { validationResult } = require('express-validator');
const hotspotUserService = require('./hotspotUser.service');
// REMOVIDO: const { createActivityLog } = require('../activity/activity.service'); // Não precisa aqui, o service já importa

const getAllHotspotUsers = async (req, res) => {
  try {
    const { rows, count } = await hotspotUserService.findAllHotspotUsers(req.query);
    const totalPages = Math.ceil(count / (req.query.limit || 10));
    res.status(200).json({
      success: true,
      data: rows,
      meta: { totalItems: count, totalPages, currentPage: parseInt(req.query.page, 10) || 1 },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao buscar usuários do hotspot.', error: error.message });
  }
};

const createHotspotUser = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const hotspotUser = await hotspotUserService.createHotspotUser(req.body);
    res.status(201).json({ success: true, message: 'Usuário do hotspot criado com sucesso!', data: hotspotUser });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao criar usuário do hotspot.', error: error.message });
  }
};

const getHotspotUserById = async (req, res) => {
  try {
    const hotspotUser = await hotspotUserService.findHotspotUserById(req.params.id);
    if (!hotspotUser) return res.status(404).json({ success: false, message: 'Usuário do hotspot não encontrado.' });
    res.status(200).json({ success: true, data: hotspotUser });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao buscar usuário do hotspot.', error: error.message });
  }
};

const updateHotspotUser = async (req, res) => {
  // LOGS DETALHADOS NO CONTROLLER
  console.log(`[CONTROLLER] === INÍCIO UPDATE HOTSPOT USER ===`);
  console.log(`[CONTROLLER] Timestamp: ${new Date().toISOString()}`);
  console.log(`[CONTROLLER] Method: ${req.method}`);
  console.log(`[CONTROLLER] URL: ${req.originalUrl}`);
  console.log(`[CONTROLLER] Params:`, req.params);
  console.log(`[CONTROLLER] Body recebido:`, JSON.stringify(req.body, null, 2));
  console.log(`[CONTROLLER] Headers Content-Type:`, req.headers['content-type']);
  console.log(`[CONTROLLER] Usuario autenticado:`, req.user ? { id: req.user.id, name: req.user.name } : 'Não encontrado');

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.log(`[CONTROLLER] ❌ Erros de validação:`, errors.array());
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  console.log(`[CONTROLLER] ✅ Validação passou, chamando service...`);

  try {
    const hotspotUser = await hotspotUserService.updateHotspotUser(req.params.id, req.body);
    
    if (!hotspotUser) {
      console.log(`[CONTROLLER] ❌ Usuário não encontrado com ID: ${req.params.id}`);
      return res.status(404).json({ success: false, message: 'Usuário do hotspot não encontrado.' });
    }

    console.log(`[CONTROLLER] ✅ Service retornou sucesso`);
    console.log(`[CONTROLLER] Dados retornados do service:`, {
      id: hotspotUser.id,
      username: hotspotUser.username,
      status: hotspotUser.status,
      turma: hotspotUser.turma,
      updatedAt: hotspotUser.updatedAt
    });
    
    const response = {
      success: true, 
      message: 'Usuário do hotspot atualizado com sucesso!', 
      data: hotspotUser
    };
    
    console.log(`[CONTROLLER] === FIM UPDATE HOTSPOT USER (SUCESSO) ===`);
    res.status(200).json(response);

  } catch (error) {
    console.log(`[CONTROLLER] === ERRO NO UPDATE ===`);
    console.log(`[CONTROLLER] Error object:`, error);
    console.log(`[CONTROLLER] Error message:`, error.message);
    console.log(`[CONTROLLER] Error stack:`, error.stack);
    console.log(`[CONTROLLER] === FIM UPDATE HOTSPOT USER (ERRO) ===`);
    
    res.status(500).json({ 
      success: false, 
      message: 'Erro ao atualizar usuário do hotspot.', 
      error: error.message 
    });
  }
};

const deleteHotspotUser = async (req, res) => {
  try {
    const hotspotUser = await hotspotUserService.deleteHotspotUser(req.params.id);
    if (!hotspotUser) return res.status(404).json({ success: false, message: 'Usuário do hotspot não encontrado.' });
    res.status(200).json({ success: true, message: 'Usuário do hotspot deletado com sucesso!' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao deletar usuário do hotspot.', error: error.message });
  }
};

// --- INÍCIO DO NOVO CONTROLLER (AJUSTADO) ---
const updateUserCredits = async (req, res) => {
    try {
        const { id } = req.params;
        const creditData = req.body; // Ex: { "creditsTotal": 5368709120, "creditsUsed": 0 }
        
        // Obter o usuário que está realizando a ação do req.user (do middleware de autenticação)
        const performingUser = req.user; 

        const updatedUser = await hotspotUserService.updateCredits(id, creditData, performingUser);

        res.status(200).json({
            success: true,
            message: 'Créditos do usuário atualizados com sucesso.',
            data: updatedUser
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro ao atualizar créditos do usuário.', error: error.message });
    }
};
// --- FIM DO NOVO CONTROLLER ---

module.exports = { getAllHotspotUsers, createHotspotUser, getHotspotUserById, updateHotspotUser, deleteHotspotUser,updateUserCredits };
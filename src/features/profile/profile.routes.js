// src/features/profile/profile.routes.js
const express = require('express');
const { body, param } = require('express-validator');
const profileController = require('./profile.controller');
const { Company } = require('../../models');

const router = express.Router();

// Middleware de validação para criação e atualização de perfis
const profileValidationRules = () => {
  return [
    body('name').notEmpty().trim().withMessage('O nome do perfil é obrigatório.'),
    body('mikrotikName').notEmpty().trim().withMessage('O nome do perfil no MikroTik é obrigatório.'),
    body('companyId')
      .notEmpty().withMessage('O ID da empresa é obrigatório.')
      .isInt({ min: 1 }).withMessage('O ID da empresa deve ser um número inteiro positivo.')
      .custom(async (value) => {
        // Validação customizada para garantir que a empresa existe no banco de dados
        const company = await Company.findByPk(value);
        if (!company) {
          return Promise.reject('A empresa especificada não existe.');
        }
      }),
    body('rateLimit').optional({ nullable: true }).trim().isString().withMessage('O limite de taxa deve ser um texto.'),
    body('sessionTimeout').optional({ nullable: true }).trim().isString().withMessage('O tempo de sessão deve ser um texto.'),
  ];
};

// Middleware para validar o ID do parâmetro da rota
const idValidationRule = () => {
  return [
    param('id').isInt({ min: 1 }).withMessage('O ID do perfil deve ser um número inteiro positivo.'),
  ];
};


// --- DEFINIÇÃO DAS ROTAS ---

// Rota para criar um novo perfil
// POST /api/profiles
router.post('/', profileValidationRules(), profileController.createProfile);

// Rota para listar todos os perfis (com filtros via query string)
// GET /api/profiles?companyId=1&page=1&limit=10
router.get('/', profileController.getAllProfiles);

// Rota para buscar um perfil específico por ID
// GET /api/profiles/1
router.get('/:id', idValidationRule(), profileController.getProfileById);

// Rota para atualizar um perfil por ID
// PUT /api/profiles/1
router.put('/:id', idValidationRule(), profileValidationRules(), profileController.updateProfile);

// Rota para deletar um perfil por ID
// DELETE /api/profiles/1
router.delete('/:id', idValidationRule(), profileController.deleteProfile);


module.exports = router;
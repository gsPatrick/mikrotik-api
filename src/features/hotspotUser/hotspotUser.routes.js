// src/features/hotspotUser/hotspotUser.routes.js
const express = require('express');
const { body } = require('express-validator');
const hotspotUserController = require('./hotspotUser.controller');
const { protect, authorize } = require('../../middleware/auth.middleware');
const { Company, Profile } = require('../../models');

const router = express.Router();

const hotspotUserValidation = [
  body('username').notEmpty().withMessage('O nome de usuário é obrigatório.'),
  body('password').notEmpty().withMessage('A senha é obrigatória.'),
  body('companyId').isInt().withMessage('O ID da empresa é obrigatório.')
    .custom(async value => {
      if (!await Company.findByPk(value)) return Promise.reject('Empresa não encontrada.');
    }),
  body('profileId').isInt().withMessage('O ID do perfil é obrigatório.')
    .custom(async value => {
      if (!await Profile.findByPk(value)) return Promise.reject('Perfil não encontrado.');
    }),
];

// Protegendo todas as rotas de hotspot user
// Admins e Managers podem gerenciar
router.use(protect, authorize('admin', 'manager'));

router.post('/', hotspotUserValidation, hotspotUserController.createHotspotUser);
router.get('/', hotspotUserController.getAllHotspotUsers);
router.get('/:id', hotspotUserController.getHotspotUserById);
router.put('/:id', hotspotUserController.updateHotspotUser);
router.delete('/:id', hotspotUserController.deleteHotspotUser);
router.post('/:id/update-credits', hotspotUserController.updateUserCredits); // <-- NOVA ROTA

module.exports = router;
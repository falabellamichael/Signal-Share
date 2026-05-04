const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

router.post('/ban', userController.banUser);

module.exports = router;
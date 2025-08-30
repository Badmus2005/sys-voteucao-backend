import express from 'express';
import multer from 'multer';  // ⬅️ multer fournit memoryStorage()
import axios from 'axios';
import FormData from 'form-data';
import prisma from '../prisma.js';
import { authenticateToken } from '../middlewares/auth.js';

const router = express.Router();

const IMGBB_UPLOAD_URL = 'https://api.imgbb.com/1/upload';

// ✅ CONFIGURATION CORRECTE avec memoryStorage
const upload = multer({
  storage: multer.memoryStorage(),  // ⬅️ Utilisation correcte
  limits: {
    fileSize: 2 * 1024 * 1024,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Type de fichier non supporté. Utilisez JPEG ou PNG.'));
    }
  }
});

// Dans votre route backend, remplacez temporairement la partie ImgBB :
router.post('/image', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    console.log('Début upload image candidature');

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Aucun fichier image fourni'
      });
    }

    // ⚠️ SOLUTION TEMPORAIRE - Contournement ImgBB
    console.log('⚠️ Mode test - contournement ImgBB activé');

    // Retourner une URL factice pour tester
    const fakeUrl = 'https://via.placeholder.com/300x300?text=Test+Upload';

    // Simuler un délai d'upload
    await new Promise(resolve => setTimeout(resolve, 1000));

    res.json({
      success: true,
      url: fakeUrl,
      message: 'Image uploadée en mode test'
    });

  } catch (error) {
    console.error('Erreur upload:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message
    });
  }
});

export default router;